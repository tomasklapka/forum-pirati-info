const debug = require('debug')('json_cache');
const { Client } = require('pg');
const moment = require('moment');

const ForumScrapper = require('../lib/forum_scrapper');

const mapTypeTable = {
    1: 'forums',
    2: 'forums',
    3: 'threads',
    4: 'groups',
    5: 'users'
};

class JsonCache {

    constructor(connectionString, ttl = 3600, lastPageTtl = 60) {
        this.ttl = ttl;
        this.lastPageTtl = lastPageTtl;
        this.client = new Client({
            connectionString: connectionString,
        });
    }

    init() {
        return new Promise((resolve, reject) => {
            const init_queries = [ `
                SET TIME ZONE 'Europe/Prague'
                `, `
                CREATE TABLE IF NOT EXISTS "post_urls" (
                    "phpbbid" integer NOT NULL,
                    "url" text NOT NULL,
                    CONSTRAINT "post_urls_pkey" PRIMARY KEY ("phpbbid")
                )
                `];
            const create_table_query = `
                CREATE TABLE IF NOT EXISTS "{TABLE}" (
                    "phpbbid" int NOT NULL,
                    "page" int NOT NULL DEFAULT 1,
                    "content" jsonb NOT NULL,
                    "queue" int NOT NULL DEFAULT 0,
                    "is_last_page" boolean NOT NULL DEFAULT false,
                    "scrapped_at" timestamp without time zone NOT NULL DEFAULT now(),
                    "created_at" timestamp without time zone NOT NULL DEFAULT now(),
                    "updated_at" timestamp without time zone NOT NULL DEFAULT now(),
                    CONSTRAINT "{TABLE}_pkey" PRIMARY KEY ("phpbbid", "page")
                )
            `;
            const promises = [];

            init_queries.forEach((query) => {
                promises.push(this.client.query(query));
            });

            this.client.connect().then(() => {
                const search = new RegExp('\{TABLE\}', 'g');
                ['forums', 'threads', 'groups', 'users'].forEach((table) => {
                    promises.push(this.client.query(create_table_query.replace(search, table)));
                });
                return Promise.all(promises);
            }).then(resolve).catch((err) => {
                debug('JsonCache connect error "%o"', err);
                reject(err);
            });
        })
    }

    save(data) {
        return new Promise((resolve, reject) => {
            debug('saving cache');
            if (ForumScrapper.cacheableType(data.typeId)) {
                const table = mapTypeTable[data.typeId];
                debug("%o", data.navi);
                const phpbbid = data.phpbbid || 0;
                const page = data.navi.page === 0 ? 1 : data.navi.page;
                const pages = data.navi.pages === 0 ? 1 : data.navi.pages;
                const is_last_page = pages === page;

                debug('saving info (table="%s", id="%d", page="%d", is_last_page="%o"', table, phpbbid, page, is_last_page);

                const store_query = `INSERT INTO "`+table+`" ("phpbbid", "page", "is_last_page", "content") VALUES ($1, $2, $3, $4) ` +
                    `ON CONFLICT ON CONSTRAINT "`+table+`_pkey" DO `+
                    `UPDATE SET "is_last_page" = $3, "content" = $4, "queue" = null, "scrapped_at" = now(), "updated_at" = now()`;

                debug('save "%s", "%o"', store_query, [phpbbid, page, is_last_page, 'data']);

                this.client.query(store_query, [phpbbid, page, is_last_page, data]).then(() => {
                    if (is_last_page && page > 0) {
                        const update_last_page_query = `UPDATE "`+table+`" SET "is_last_page" = false, "queue" = 100 WHERE "phpbbid" = $1 AND "page" = $2`;
                        debug('update_last_page "%s", "%o"', update_last_page_query, [phpbbid, page-1]);
                        this.client.query(update_last_page_query, [phpbbid, page-1]).then(() => {
                            resolve();
                        }).catch((err) => {
                            debug('JsonCache storing error / update last page (table="%s", id="%d", page="%d")', table, phpbbid, page);
                            reject(err);
                        });
                        return;
                    }
                    resolve();
                }).catch((err) => {
                    debug('JsonCache storing error / store (table="%s", id="%d", page="%d")', table, phpbbid, page);
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
                const table = mapTypeTable[meta.typeId];

                const select_query = `SELECT "content", "is_last_page", "scrapped_at", "queue" FROM "` + table + `" WHERE "phpbbid" = $1 AND "page" = $2`;

                debug('load "%s", "%o"', select_query, [meta.phpbbid, meta.page]);

                this.client.query(select_query, [meta.phpbbid, meta.page]).then((res) => {
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
                    debug('JsonCache loading error (table="%s", id="%d", page="$d")', table, meta.phpbbid, meta.page);
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