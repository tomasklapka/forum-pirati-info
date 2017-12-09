const debug = require('debug')('scraping_queue');
const statsDebug = require('debug')('scraping_stats');
const request = require('request');

const ForumScrapper = require('./forum_scrapper');

class Sequence {
    constructor(state = null) {
        this.state = state || {};
        this.state.id = this.state.id || 0;
        this.state.max_id = this.state.max_id || null;
    }
    discoveredId(id, url) {
        if (this.state.max_id === null || id > this.state.max_id) {
            this.state.max_id = id;
        }
    }
    next() {
        return new Promise((resolve, reject) => {
            if (this.state.max_id !== null && this.state.id >= this.state.max_id) {
                this.state.id = 0;
                resolve('control:end_of_sequence');
                return;
            }
            this.state.id++;
            resolve(this.state.url_template.replace('{ID}', this.state.id));
        });
    }
    asJson() {
        return this.state;
    }
}

class RedirectSequence extends Sequence {
    next() {
        return new Promise((resolve, reject) => {
            super.next().then((url) => {
                debug('redirect check url: "%s"', url);
                if (url === 'control:end_of_sequence') {
                    resolve('control:end_of_sequence');
                }
                if (url !== null) {
                    request({
                        url: url,
                        method: 'HEAD',
                        followRedirect: false
                    }, (err, res) => {
                        debug('redirect res: "%o", "%o"', err, res.statusCode);
                        if (err) {
                            resolve(null);
                        }
                        if (res.statusCode === 301) {
                            debug('redirect location: "%s"', res.headers.location);
                            resolve(res.headers.location);
                            return;
                        }
                        debug('redirect null');
                        resolve(null);
                    })
                }
            }).catch(reject);

        })
    }
}

class UsersSequence {
    constructor(state = null) {
        this.state = state || {};
        this.state.ids = this.state.ids || [];
        this.state.map = this.state.map || {};
        this.state.idx = this.state.idx || 0;
        this.state.base = this.state.base || '';
    }

    discoveredId(id, url) {
        if (this.state.ids.indexOf(id) === -1) {
            this.state.ids.push(id);
            this.state.map[id] = url.replace(this.state.base, '');
        }
    }

    next() {
        return new Promise((resolve, reject) => {
            if (this.state.idx > this.state.ids.length - 1) {
                this.state.idx = 0;
                resolve('control:end_of_sequence');
                return;
            }
            resolve(this.state.base + this.state.map[this.state.ids[this.state.idx++]]);
        });
    }

    asJson() {
        return this.state;
    }
}

class ScrapingQueue {

    constructor(client, app) {
        this.client = client;
        this.base = app.get('base');
        this.originBase = app.get('originBase');
        this.cache = app.get('jsonCache');
        this.db = app.get('db');
        this._queue = [];
        this._charging = false;
        this.runid = 0;
        this.sequences = {};
        this.sequences_keys = [ 'forums', 'groups', 'posts', 'users' ];
        this.sequence_idx = 0;
    }

    init() {
        debug('init()');
        return new Promise((resolve, reject) => {
            const create_table_scraping_queue = `
                CREATE TABLE IF NOT EXISTS "scraping_queue" (
                    "id" integer NOT NULL DEFAULT 1,
                    "runid" integer NOT NULL,
                    "sequence_idx" smallint NOT NULL DEFAULT 0,
                    "forums_sequence" jsonb,
                    "groups_sequence" jsonb,
                    "posts_sequence" jsonb,
                    "users_sequence" jsonb,
                    CONSTRAINT "scraping_queue_pkey" PRIMARY KEY ("id")
                )
            `;
            const insert_initial_values = `
                INSERT INTO "scraping_queue" ("runid") VALUES (1) ON CONFLICT DO NOTHING
            `;
            const select_current_state = `
                SELECT * FROM "scraping_queue" WHERE "id" = 1
            `;
            const promises = [];
            debug(create_table_scraping_queue);
            promises.push(this.client.query(create_table_scraping_queue));
            debug(insert_initial_values);
            promises.push(this.client.query(insert_initial_values));
            Promise.all(promises).then(() => {
                debug(select_current_state);
                this.client.query(select_current_state).then((result) => {
                    const state = result.rows[0];
                    if (state) {
                        this.runid = state.runid;
                        this.sequence_idx = state.sequence_idx || 0;
                        this.sequences.forums = new RedirectSequence(state.forums_sequence || { url_template: this.originBase + '/viewforum.php?f={ID}' });
                        this.sequences.groups = new RedirectSequence(state.groups_sequence || { url_template: this.originBase + '/group{ID}.html' });
                        this.sequences.posts = new RedirectSequence(state.posts_sequence || { url_template: this.originBase + '/post{ID}.html' });
                        this.sequences.users = new UsersSequence(state.users_sequence || { base: this.originBase });
                    }
                    resolve();
                }).catch(reject);
            }).catch(reject);
        });
    }

    save_state() {
        debug('saving stats');
        const update_state = `
                UPDATE "scraping_queue"
                SET "runid" = $1, "sequence_idx" = $2,
                    "forums_sequence" = $3, "groups_sequence" = $4,
                    "posts_sequence" = $5, "users_sequence" = $6
                WHERE "id" = 1
            `;
        const query_data = [
            this.runid,
            this.sequence_idx,
            this.sequences.forums.asJson(),
            this.sequences.groups.asJson(),
            this.sequences.posts.asJson(),
            this.sequences.users.asJson(),
        ];
        this.client.query(update_state, query_data).catch(debug);
    }

    next() {
        return new Promise((resolve, reject) => {
            this.sequences[this.sequences_keys[this.sequence_idx]].next().then((nextUrl) => {
                if (nextUrl === 'control:end_of_sequence') {
                    this.sequence_idx++;
                    if (this.sequence_idx > this.sequences_keys.length - 1) {
                        this.sequence_idx = 0;
                        this.runid++;
                        resolve('control:end_of_sequence');
                        return;
                    }
                    this.next().then(resolve).catch(reject);
                    return;
                }
                resolve(nextUrl);
            });
        });
    }

    scrapTick() {
        debug('tick');

        this.next().then((url) => {
            debug('url from queue: "%s", "%o"', url, this.sequences_keys[this.sequence_idx]);

            if (url === null) {
                return;
            }
            if (url === 'control:end_of_sequence') {
                this.save_state();
                return;
            }
            debug('scrap');
            ForumScrapper
                .scrap(url, this.base, this.originBase)
                .then((data) => {

                    debug('data.links.length: "%d"', data.links.length);
                    this.discoverIdsFromLinks(data.links);
                    delete data.links;

                    this.cache.save(data).catch(debug);
                })
                .catch(debug);
        });
    }

    stats() {
        debug('stats()');
        const select_counts_query = `
                SELECT 'json_cache' AS stat, "typeid" AS type, COUNT(DISTINCT("typeid")) AS count_type FROM "json_cache" GROUP BY ("typeid")
            `;
        const promises = [];
        promises.push(this.client.query(select_counts_query));
        Promise.all(promises).then((results) => {
            statsDebug('------- STATS -------');
            statsDebug('runid: %d', this.runid);
            statsDebug('forums seq: %o', this.sequences.forums.asJson());
            statsDebug('groups seq: %o', this.sequences.groups.asJson());
            statsDebug('posts seq: %o', this.sequences.posts.asJson());
            statsDebug('users seq: %o', {
                n_ids: this.sequences.users.state.ids.length,
                idx: this.sequences.users.state.idx
            });
            for (let i = 0; i < results.length; i++) {
                statsDebug('%o', results[i].rows[0]);
            }
            statsDebug('---------------------');
        }).catch(debug);
    }

    discoverIdsFromLinks(links) {
        if (links && links.length > 0) {
            debug('links.length: "%d"', links.length);
            for (let i = 0; i < links.length; i++) {
                const url = links[i].originUrl;
                if (url.indexOf(this.originBase) === 0 && ForumScrapper.cacheableType(links[i].type)) {
                    const postId = ForumScrapper.postIdFromUrl(url);
                    if (postId === null) {
                        const data = ForumScrapper.parseForumUrl(url);
                        const sequence = {
                            5: 'users',
                            2: 'forums',
                            1: 'forums',
                            4: 'groups'
                        }[data.typeid];
                        if (sequence) {
                            // debug('discovered %s %d (%s) (%o)', sequence, data.phpbbid, url, data);
                            this.sequences[sequence].discoveredId(data.phpbbid, url);
                        }
                    } else {
                        // debug('discovered post %d (%s)', postId, url);
                        this.sequences.posts.discoveredId(postId, url);
                    }
                }
            }
        }
    }
}
module.exports = ScrapingQueue;