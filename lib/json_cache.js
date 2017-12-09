const debug = require('debug')('json_cache');
const moment = require('moment');

const ForumScrapper = require('../lib/forum_scrapper');

class JsonCache {

    constructor(client, ttl = 3600, lastPageTtl = 60) {
        this.ttl = ttl;
        this.lastPageTtl = lastPageTtl;
        this.client = client;
    }

    init() {
        return new Promise((resolve, reject) => {
            const create_table_post_urls = `
                CREATE TABLE IF NOT EXISTS "post_urls" (
                    "phpbbid" integer NOT NULL,
                    "url" text NOT NULL,
                    CONSTRAINT "post_urls_pkey" PRIMARY KEY ("phpbbid")
                )
            `;
            const create_table_json_cache = `
                CREATE TABLE IF NOT EXISTS "json_cache" (
                    "typeid" smallint NOT NULL,
                    "phpbbid" int NOT NULL,
                    "page" int NOT NULL DEFAULT 1,
                    "url" text NOT NULL,
                    "queue" int NOT NULL DEFAULT 0,
                    "is_last_page" boolean NOT NULL DEFAULT false,
                    "content" jsonb NOT NULL,
                    "scrapped_at" timestamp without time zone,
                    "created_at" timestamp without time zone NOT NULL DEFAULT now(),
                    "updated_at" timestamp without time zone NOT NULL DEFAULT now(),
                    CONSTRAINT "json_cache_pkey" PRIMARY KEY ("typeid", "phpbbid", "page")
                )
            `;
            const promises = [];
            promises.push(this.client.query(create_table_post_urls));
            promises.push(this.client.query(create_table_json_cache));
            Promise.all(promises).then(resolve).catch(reject);
        })
    }

    save(data) {
        return new Promise((resolve, reject) => {
            debug('saving cache');
            if (ForumScrapper.cacheableType(data.typeid)) {
                const phpbbid = data.phpbbid || 0;
                const page = data.navi.page === 0 ? 1 : data.navi.page;
                const pages = data.navi.pages === 0 ? 1 : data.navi.pages;
                const is_last_page = pages === page;

                debug('saving info (typeid="%d", id="%d", page="%d", is_last_page="%o"', data.typeid, phpbbid, page, is_last_page);

                const store_query = `INSERT INTO "json_cache" ("typeid", "phpbbid", "page", "url", "is_last_page", "content", "scrapped_at")
                    VALUES ($1, $2, $3, $4, $5, $6, now()) ` +
                    `ON CONFLICT ON CONSTRAINT "json_cache_pkey" DO `+
                    `UPDATE SET "is_last_page" = $5, "content" = $6, "scrapped_at" = now(), "queue" = 0, "updated_at" = now()`;

                debug('save "%s", "%o"', store_query, [data.typeid, phpbbid, page, data.url, is_last_page, 'data']);

                this.client.query(store_query, [data.typeid, phpbbid, page, data.url, is_last_page, data]).then(() => {
                    if (is_last_page && page > 1) {
                        const update_last_page_query = `UPDATE "json_cache" SET "is_last_page" = false, "queue" = 100 WHERE "typeid" = $1 AND "phpbbid" = $2 AND "page" = $3`;
                        debug('update_last_page "%s", "%o"', update_last_page_query, [ data.typeid, phpbbid, page - 1 ]);
                        this.client.query(update_last_page_query, [ data.typeid, phpbbid, page - 1 ]).then(() => {
                            resolve();
                        }).catch((err) => {
                            debug('JsonCache storing error / update last page (typeid="%d", id="%d", page="%d")', data.typeid, phpbbid, page);
                            reject(err);
                        });
                        return;
                    }
                    resolve();
                }).catch((err) => {
                    debug('JsonCache storing error / store (typeid="%d", id="%d", page="%d")', data.typeid, phpbbid, page);
                    reject(err);
                });
            } else {
                resolve();
            }
        });
    }

    load(url) {
        return new Promise((resolve, reject) => {
            if (ForumScrapper.cacheableType(ForumScrapper.linkType(url))) {
                const meta = ForumScrapper.parseForumUrl(url);

                const select_query = `SELECT "content", "is_last_page", "scrapped_at", "queue" FROM "json_cache" WHERE "typeid" = $1 AND "phpbbid" = $2 AND "page" = $3`;

                debug('load "%s", "%o"', select_query, [meta.typeid, meta.phpbbid, meta.page]);

                this.client.query(select_query, [meta.typeid, meta.phpbbid, meta.page]).then((res) => {
                    if (res.rows.length > 0) {
                        const data = res.rows[0];
                        const momentOfScrap = moment(data.scrapped_at);
                        const ttl = data.is_last_page ? this.lastPageTtl : this.ttl;
                        const ttlDuration = moment.duration(ttl, 's');
                        const validUntil = moment(momentOfScrap + ttlDuration);
                        const now = moment();
                        debug("queue: %d", data.queue);
                        debug("is_last_page: %o", data.is_last_page);
                        debug("scrapped_at: %s", momentOfScrap);
                        debug("valid_until: %s", validUntil);
                        debug("this_moment: %s", now);
                        if (validUntil.isBefore(now) || data.queue > 0) {
                            debug('CACHE: INVALID');
                            data['invalid'] = true;
                        } else {
                            debug('CACHE: VALID');
                        }
                        resolve(data);
                    } else {
                        resolve(null);
                    }
                }).catch((err) => {
                    debug('JsonCache loading error (typeid="%d", id="%d", page="$d")', meta.typeid, meta.phpbbid, meta.page);
                    reject(err);
                });
            } else {
                resolve(null);
            }
        })
    }

    getPostUrl(postUrl) {
        debug('getPostUrl("%s")', postUrl);
        const phpbbid = ForumScrapper.postIdFromUrl(postUrl);
        return new Promise((resolve, reject) => {
            const select_query = `SELECT "url" FROM "post_urls" WHERE "phpbbid" = $1`;
            debug(select_query, [ phpbbid ]);
            this.client.query(select_query, [ phpbbid ]).then((result) => {
                if (result.rows.length > 0) {
                    debug('Post URL for post #%d found: %s', phpbbid, result.rows[0].url);
                    resolve(result.rows[0].url);
                } else {
                    resolve(null)
                }
            }).catch(reject)
        })
    }

    setPostUrl(postUrl, url) {
        debug('setPostUrl("%s", "%s")', postUrl, url);
        const phpbbid = ForumScrapper.postIdFromUrl(postUrl);
        const update_query = `INSERT INTO "post_urls" ("phpbbid", "url") VALUES ($1, $2) ON CONFLICT DO NOTHING`;
        debug(update_query, [ phpbbid, url ]);
        return this.client.query(update_query, [ phpbbid, url ]);
    }
}
module.exports = JsonCache;