"use strict";

const debug = require('debug')('json_cache');
const moment = require('moment');

const ForumScrapper = require('../lib/forum_scrapper');

class JsonCache {

    constructor(client, ttl = 3600) {
        this.ttl = ttl;
        this.client = client;
    }

    init() {
        return new Promise((resolve, reject) => {
            const create_table_json_cache = `
                CREATE TABLE IF NOT EXISTS "json_cache" (
                    "typeid" smallint NOT NULL,
                    "phpbbid" int NOT NULL,
                    "page" int NOT NULL DEFAULT 1,
                    "url" text NOT NULL,
                    "content" jsonb NOT NULL,
                    "scrapped_at" timestamp without time zone,
                    "created_at" timestamp without time zone NOT NULL DEFAULT now(),
                    "updated_at" timestamp without time zone NOT NULL DEFAULT now(),
                    CONSTRAINT "json_cache_pkey" PRIMARY KEY ("typeid", "phpbbid", "page")
                )
            `;
            const promises = [];
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

                debug('saving info (typeid="%d", id="%d", page="%d"', data.typeid, phpbbid, page);

                const store_query = `INSERT INTO "json_cache" ("typeid", "phpbbid", "page", "url", "content", "scrapped_at")
                    VALUES ($1, $2, $3, $4, $5, now()) ` +
                    `ON CONFLICT ON CONSTRAINT "json_cache_pkey" DO `+
                    `UPDATE SET "content" = $5, "scrapped_at" = now(), "updated_at" = now()`;

                debug('save "%s", "%o"', store_query, [data.typeid, phpbbid, page, data.url, 'data']);

                this.client.query(store_query, [data.typeid, phpbbid, page, data.url, data]).then(() => {
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

                const select_query = `SELECT "content", "scrapped_at" FROM "json_cache" WHERE "typeid" = $1 AND "phpbbid" = $2 AND "page" = $3`;

                debug('load "%s", "%o"', select_query, [meta.typeid, meta.phpbbid, meta.page]);

                this.client.query(select_query, [meta.typeid, meta.phpbbid, meta.page]).then((res) => {
                    if (res.rows.length > 0) {
                        const data = res.rows[0];
                        const momentOfScrap = moment(data.scrapped_at);
                        const ttlDuration = moment.duration(this.ttl, 's');
                        const validUntil = moment(momentOfScrap + ttlDuration);
                        const now = moment();
                        debug("scrapped_at: %s", momentOfScrap);
                        debug("valid_until: %s", validUntil);
                        debug("this_moment: %s", now);
                        if (validUntil.isBefore(now)) {
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
}
module.exports = JsonCache;