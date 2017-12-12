"use strict";

const debug = require('debug')('scraping_queue');

function statsOut() {
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
    discoveredId(id) {
        if (this.state.max_id === null || id > this.state.max_id) {
            this.state.max_id = id;
        }
    }
    next() {
        return new Promise((resolve) => {
            resolve(this.state.url_template.replace('{ID}', this.state.id));
        });
    }
    inc() {
        // debug('sequence inc %d++', this.state.id);
        if (this.state.max_id !== null && this.state.id >= this.state.max_id) {
            this.state.id = 0;
            return false;
        }
        this.state.id++;
        return true;
    }
    asJson() {
        return this.state;
    }
}

class RedirectSequence extends Sequence {
    next() {
        return new Promise((resolve, reject) => {
            super.next().then((url) => {
                debug('HEAD %s', url);
                if (url !== null) {
                    ForumScrapper.request({
                        url: url,
                        method: 'HEAD',
                        timeout: ForumScrapper.requestTimeout,
                        followRedirect: false
                    }, (err, res) => {
                        // debug('redirect res: "%o", "%o"', err, err ? null : res.statusCode);
                        if (this.queue.isBackendError(err)) {
                            resolve('control:retry');
                            return;
                        }
                        if (res.statusCode === 301) {
                            // debug('redirect location: "%s"', res.headers.location);
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
                if (url !== null && url !== 'control:retry') {
                    // get post's bbcode content
                    ForumScrapper.scrapPost(
                        this.queue.originBase +
                        '/ucp.php?i=pm&mode=compose&action=quotepost&p=' +
                        this.state.id
                    ).then((content) => {
                        if (content.length > 0) {
                            this.queue.db.save_post_content(this.state.id, content);
                        }
                    }).catch((err) => {
                        this.queue.isBackendError(err);
                        debug('scrap post error: "%o"', err);
                    });
                }
                resolve(url);
            }).catch(reject);
        })
    }
}

class ScrapingQueue {

    constructor(client, app) {
        this.client = client;
        this.base = app.get('base');
        this.originBase = app.get('originBase');
        this.cache = app.get('jsonCache');
        this.db = app.get('db');
        this.scrapInterval = app.get('config')['scrapInterval'];
        this.maxScrapInterval = app.get('config')['maxScrapInterval'];
        this.scrapIntervalSet = this.scrapInterval;
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
            // debug(create_table_scraping_queue);
            promises.push(this.client.query(create_table_scraping_queue));
            // debug(insert_initial_values);
            promises.push(this.client.query(insert_initial_values));
            Promise.all(promises).then(() => {
                // debug(select_current_state);
                this.client.query(select_current_state).then((result) => {
                    const state = result.rows[0];
                    if (state) {
                        this.runid = state.runid;
                        this.sequence_idx = state.sequence_idx || 0;
                        this.sequences.forums = new RedirectSequence(this, state.forums_sequence || { url_template: this.originBase + '/viewforum.php?f={ID}' });
                        this.sequences.groups = new RedirectSequence(this, state.groups_sequence || { url_template: this.originBase + '/group{ID}.html' });
                        this.sequences.users = new RedirectSequence(this, state.users_sequence || { url_template: this.originBase + '/user-u{ID}' });
                        this.sequences.posts = new PostsSequence(this, state.posts_sequence || { url_template: this.originBase + '/post{ID}.html' });
                    }
                    resolve();
                }).catch(reject);
            }).catch(reject);
        });
    }

    save_state() {
        debug('saving state');
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

    isBackendError(err) {
        if (err) {
            const maxInterval = this.maxScrapInterval;
            debug('backend error "%s" set: %d max: %d current: %d', err.code, this.scrapIntervalSet, maxInterval, this.scrapInterval);
            if (this.scrapInterval < maxInterval) {
                let incInterval = this.scrapInterval * 1.1;
                if (incInterval > maxInterval) {
                    incInterval = maxInterval;
                }
                debug('inc scrap interval: %d', incInterval);
                this.scrapInterval = incInterval;
            }
            return true;
        } else {
            if (this.scrapInterval !== this.scrapIntervalSet) {
                this.scrapInterval *= 0.9;
                if (this.scrapInterval < this.scrapIntervalSet) {
                    this.scrapInterval = this.scrapIntervalSet;
                }
                debug('dec scrap interval: %d', this.scrapInterval);
            }
        }
        return false;
    }

    next() {
        return new Promise((resolve) => {
            if (this.pagingNavi) {
                if (this.page < this.pagingNavi.pages) {
                    const nextUrl = this.originBase + this.pagingNavi.pagerUrl.replace('{PAGE}', this.page).replace(this.base, this.originBase);
                    debug('paging... "%s"', nextUrl);
                    resolve(nextUrl);
                    return;
                }
            }
            const sequence = this.sequences[this.sequences_keys[this.sequence_idx]];
            sequence.next().then(resolve);
        });
    }

    inc() {
        const sequence = this.sequences[this.sequences_keys[this.sequence_idx]];
        if (sequence.inc() === false) {
            this.sequence_idx++;
            if (this.sequence_idx > this.sequences_keys.length - 1) {
                this.sequence_idx = 0;
                this.runid++;
            }
            this.next().then().catch();
        }
    }

    scrapTick(done) {
        this.next().then((url) => {
            console.log('scrapTick %s', url);
            if (url === null) {
                this.inc();
            }
            if (url === null || url === 'control:retry') {
                done();
                return;
            }
            ForumScrapper
                .scrap(url, this.base, this.originBase)
                .then((data) => {
                    if (data.statusCode === 200 || data.statusCode === 404) {
                        this.page = data.navi.page;
                        if (data.navi.pages > 1 && this.pagingNavi === null && this.sequences_keys[this.sequence_idx] !== 'posts') {
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

                        if (data.typeid > 0 && data.phpbbid !== null) {
                            // debug('saving: %d %s', data.phpbbid, data.url);
                            this.db.save(data).catch((err) => {
                                debug('db save err: %o', err);
                            });
                            this.cache.save(data).catch((err) => {
                                debug('cache save err: %o', err);
                            });
                        }
                        this.inc();
                    } else {
                        debug('queue scraping error: %d "%s"', data.statusCode, data.status);
                    }
                    this.isBackendError(null);
                    done();
                })
                .catch((err) => {
                    this.isBackendError(err);
                    done();
                });

        }).catch(debug);
    }

    stats() {
        const select_counts_query = `
                SELECT "typeid" AS typeid, COUNT("typeid") AS n FROM "json_cache" GROUP BY ("typeid")
            `;
        const promises = [];
        promises.push(this.client.query(select_counts_query));
        Promise.all(promises).then((results) => {
            statsOut('------- STATS -------');
            statsOut('runid: %d', this.runid);
            statsOut('interval(ms): %d', this.scrapInterval);
            const asteriskIfActive = (sequenceName) => {
                return this.sequences_keys[this.sequence_idx] === sequenceName ? '*' : ' ';
            };
            statsOut('forums seq: %s%s', asteriskIfActive('forums'), JSON.stringify(this.sequences.forums.asJson(), 0));
            statsOut('groups seq: %s%s', asteriskIfActive('groups'), JSON.stringify(this.sequences.groups.asJson(), 0));
            statsOut(' users seq: %s%s', asteriskIfActive('users'), JSON.stringify(this.sequences.users.asJson(), 0));
            statsOut(' posts seq: %s%s', asteriskIfActive('posts'), JSON.stringify(this.sequences.posts.asJson(), 0));
            for (let i = 0; i < results.length; i++) {
                for (let j = 0; j < results[i].rows.length; j++) {
                    statsOut('json cache:  %s', JSON.stringify(results[i].rows[j], 0));
                }
            }
            statsOut('---------------------');
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