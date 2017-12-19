"use strict";

const debug = require('debug')('scraping_queue');

function statsOut() {
    console.log.apply(this, arguments);
}

const Scrapper = require('./scrapper');
const scrapingSequences = require('./scraping_sequences');
const RedirectSequence = scrapingSequences.RedirectSequence;
const PostsSequence = scrapingSequences.PostsSequence;

class ScrapingQueue {

    constructor(options) {
        options = options || {};
        this.db = options.db;
        this.scrapper = options.scrapper;
        this.baseOrigin = options.baseOrigin;
        this.scrapInterval = options.scrapInterval || 500;
        this.maxScrapInterval = options.maxScrapInterval || 10000;

        this.scrapIntervalSet = this.scrapInterval;
        this.runid = 0;
        this.sequences = {};
        this.sequences_keys = [ 'forums', 'groups', 'users', 'posts' ];
        this.sequence_idx = 0;
        this.navi = null;
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
            Promise.all([
                this.db.client.query(create_table_scraping_queue),
                this.db.client.query(insert_initial_values)
            ]).then(() => {
                // debug(select_current_state);
                this.db.client.query(select_current_state).then((result) => {
                    const state = result.rows[0];
                    if (state) {
                        this.runid = state.runid;
                        this.sequence_idx = state.sequence_idx || 0;
                        this.sequences.forums = new RedirectSequence(this, state.forums_sequence || { url_template: this.baseOrigin + '/viewforum.php?f={ID}' });
                        this.sequences.groups = new RedirectSequence(this, state.groups_sequence || { url_template: this.baseOrigin + '/group{ID}.html' });
                        this.sequences.users = new RedirectSequence(this, state.users_sequence || { url_template: this.baseOrigin + '/user-u{ID}' });
                        this.sequences.posts = new PostsSequence(this, state.posts_sequence || { url_template: this.baseOrigin + '/post{ID}.html' });
                    }
                    resolve();
                }).catch(reject);
            }).catch(reject);
        });
    }

    saveState() {
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
            this.sequences.forums.toJson(),
            this.sequences.groups.toJson(),
            this.sequences.posts.toJson(),
            this.sequences.users.toJson(),
        ];
        this.db.client.query(update_state, query_data).catch(debug);
    }

    updateScrapInterval(err) {
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
            if (this.navi) {
                if (this.navi.page < this.navi.pages) {
                    const nextUrl = this.navi.pagerBased.replace('{PAGE}', this.navi.page);
                    debug('paging... "%s" "%s"', nextUrl, this.navi.last);
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

    tick(done) {
        this
            .next()
            .then((scrapUrl) => {
                console.log('tick %s', scrapUrl);
                if (scrapUrl === null) {
                    this.inc();
                }
                if (scrapUrl === null || scrapUrl === 'control:retry') {
                    done();
                    return;
                }


                if (scrapUrl.pathname === '/download/file.php') {
                    //this.scrapper.request(url.href).pipe(res);
                    return;
                }

                this.scrapper
                    .get({
                        url: scrapUrl,
                        nocache: true
                    }).then((data) => {
                        if (data.meta.statusCode === 200 || data.meta.statusCode === 404) {
                            if (data.navi.pages > 1 && this.navi === null && this.sequences_keys[this.sequence_idx] !== 'posts') {
                                debug('pagination start for url "%s", %d pages', scrapUrl, data.navi.pages);
                                this.navi = data.navi;
                            }
                            this.navi.page = data.navi.page;
                            if (this.navi !== null && data.navi.page === data.navi.pages) {
                                this.navi = null;
                            }
                            // debug('data.links.length: "%d"', data.links.length);
                            this.discoverIdsFromLinks(data.links);
                            delete data.links;

                            if (data.status === 200 && data.typeId > 0 && data.id !== null) {
                                // debug('saving: %d %s', data.id, data.url);
                                this.db.save(data).catch((err) => {
                                    debug('db save err: %o', err);
                                });
                                this.cache.save(data).catch((err) => {
                                    debug('cache save err: %o', err);
                                });
                            }
                            this.inc();
                            this.updateScrapInterval(false);
                        } else {
                            debug('queue scraping error: %d "%s"', data.meta.statusCode, data.meta.status);
                            this.updateScrapInterval(true);
                        }
                        done()
                    }).catch((err) => {
                        debug('scrapper error in tick: "%o"', err);
                        this.updateScrapInterval(err);
                        done()
                    });
            })
            .catch(debug);
    }

    stats() {
        const select_counts_query = `
                SELECT "typeid" AS typeid, COUNT("typeid") AS n FROM "json_cache" GROUP BY ("typeid")
            `;
        const promises = [];
        promises.push(this.db.client.query(select_counts_query));
        Promise.all(promises).then((results) => {
            statsOut('------- STATS -------');
            statsOut('runid: %d', this.runid);
            statsOut('interval(ms): %d', this.scrapInterval);
            const asteriskIfActive = (sequenceName) => {
                return this.sequences_keys[this.sequence_idx] === sequenceName ? '*' : ' ';
            };
            statsOut('forums seq: %s%s', asteriskIfActive('forums'), JSON.stringify(this.sequences.forums.toJson(), 0));
            statsOut('groups seq: %s%s', asteriskIfActive('groups'), JSON.stringify(this.sequences.groups.toJson(), 0));
            statsOut(' users seq: %s%s', asteriskIfActive('users'), JSON.stringify(this.sequences.users.toJson(), 0));
            statsOut(' posts seq: %s%s', asteriskIfActive('posts'), JSON.stringify(this.sequences.posts.toJson(), 0));
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
                const link = links[i];
                // debug(link);
                if (link.url.href.indexOf(this.baseOrigin) === 0 && Scrapper.isCacheable(link.typeId)) {
                    const postId = Scrapper.postIdFromUrl(link.url);
                    if (postId === 0) {
                        const sequence = {
                            5: 'users',
                            2: 'forums',
                            1: 'forums',
                            4: 'groups'
                        }[link.typeId];
                        if (sequence) {
                            // debug('discovered %s %d (%s) (%o)', sequence, link.id, link.url, link);
                            this.sequences[sequence].discoveredId(link.id, link.url);
                        }
                    } else {
                        // debug('discovered post %d (%s)', postId, link.url);
                        this.sequences.posts.discoveredId(postId, link.url);
                    }
                }
            }
        }
    }
}
module.exports = ScrapingQueue;