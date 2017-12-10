"use strict";

const debug = require('debug')('scraping_queue');
const _statsDebug = require('debug')('scraping_stats');

function statsDebug() {
    // _statsDebug.apply(this, arguments);
    console.log.apply(this, arguments);
}

const ForumScrapper = require('./forum_scrapper');

class Sequence {
    constructor(queue, state = null) {
        this.queue = queue;
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
                // debug('redirect check url: "%s"', url);
                if (url === 'control:end_of_sequence') {
                    resolve('control:end_of_sequence');
                }
                if (url !== null) {
                    ForumScrapper.request({
                        url: url,
                        method: 'HEAD',
                        followRedirect: false
                    }, (err, res) => {
                        // debug('redirect res: "%o", "%o"', err, res.statusCode);
                        if (err) {
                            resolve(null);
                        }
                        if (res.statusCode === 301) {
                            debug('redirect location: "%s"', res.headers.location);
                            resolve(res.headers.location);
                            return;
                        }
                        // debug('redirect null');
                        resolve(null);
                    })
                }
            }).catch(reject);

        })
    }
}

class PostsSequence extends Sequence {
    next() {
        return new Promise((resolve, reject) => {
            super.next().then((url) => {
                // debug('redirect check url: "%s"', url);
                if (url === 'control:end_of_sequence') {
                    resolve('control:end_of_sequence');
                }
                if (url !== null) {
                    // get and update post's location
                    ForumScrapper.scrapPost(
                        this.queue.originBase +
                        '/ucp.php?i=pm&mode=compose&action=quotepost&p=' +
                        this.state.id)
                        .then((content) => {
                            this.queue.db.save_post_content(this.state.id, content);
                    }).catch(debug);
                }
                resolve(url);
            }).catch(reject);

        })
    }
}

class UsersSequence {
    constructor(queue, state = null) {
        this.queue = queue;
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
        this.sequences_keys = [ 'forums', 'groups', 'users', 'posts' ];
        this.sequence_idx = 0;
        this.pagingNavi = null;
        this.page = null;
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
                    "users_sequence" jsonb,
                    "posts_sequence" jsonb,
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
                        this.sequences.forums = new RedirectSequence(this, state.forums_sequence || { url_template: this.originBase + '/viewforum.php?f={ID}' });
                        this.sequences.groups = new RedirectSequence(this, state.groups_sequence || { url_template: this.originBase + '/group{ID}.html' });
                        this.sequences.users = new UsersSequence(this, state.users_sequence || { base: this.originBase });
                        this.sequences.posts = new PostsSequence(this, state.posts_sequence || { url_template: this.originBase + '/post{ID}.html' });
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
        this.client.query(update_state, query_data).catch(() => {});
    }

    next() {
        return new Promise((resolve, reject) => {
            if (this.pagingNavi) {
                if (this.page < this.pagingNavi.pages) {
                    const nextUrl = this.originBase + this.pagingNavi.pagerUrl.replace('{PAGE}', this.page).replace(this.base, this.originBase);
                    debug('paging... "%s", "%d" , "%s"', nextUrl, this.page, this.pagingNavi.pagerUrl);
                    resolve(nextUrl);
                    return;
                }
            }
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
            if (url === null) {
                return;
            }
            debug('url from queue: "%s", "%o"', url, this.sequences_keys[this.sequence_idx]);
            if (url === 'control:end_of_sequence') {
                this.save_state();
                return;
            }
            debug('scrap %s', url);
            ForumScrapper
                .scrap(url, this.base, this.originBase)
                .then((data) => {
                    if (data.statusCode === 200) {
                        this.page = data.navi.page;
                        if (data.navi.pages > 1 && this.pagingNavi === null) {
                            debug('pagination start for url "%s", %d pages', url, data.navi.pages);
                            this.pagingNavi = data.navi;
                        }
                        if (this.pagingNavi !== null && this.page === data.navi.pages) {
                            this.pagingNavi = null;
                            this.page = 1;
                        }
                        // debug('data.links.length: "%d"', data.links.length);
                        this.discoverIdsFromLinks(data.links);
                        delete data.links;
                        delete data.statusCode;
                        delete data.status;

                        this.db.save(data).catch((err) => {
                            debug('db save err: %o', err);
                        });
                        this.cache.save(data).catch((err) => {
                            debug('cache save err: %o', err);
                        });
                    } else {
                        debug('scraping error: %d "%s"', data.statusCode, data.status);
                    }
                })
                .catch(debug);
        });
    }

    stats() {
        debug('stats()');
        const select_counts_query = `
                SELECT 'json_cache' AS stat, "typeid" AS type, COUNT("typeid") AS count_type FROM "json_cache" GROUP BY ("typeid")
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
                for (let j = 0; j < results[i].rows.length; j++) {
                    statsDebug('%o', results[i].rows[j]);
                }
            }
            statsDebug('---------------------');
        }).catch(debug);
    }

    discoverIdsFromLinks(links) {
        if (links && links.length > 0) {
            // debug('discovering links.length: "%d"', links.length);
            for (let i = 0; i < links.length; i++) {
                const url = links[i].originUrl;
                if (url.indexOf(this.originBase) === 0 && ForumScrapper.cacheableType(links[i].type)) {
                    const postId = ForumScrapper.postIdFromUrl(url);
                    if (postId === 0) {
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