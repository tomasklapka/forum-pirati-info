"use strict";

const debug = require('debug')('json_cache');
const moment = require('moment');

const Scrapper = require('./scrapper');

class ScrapingCache {

    constructor(options) {
        options = options || {};
        this.db = options.db;
        this.ttl = options.ttl;
    }

    init() {
        return new Promise((resolve, reject) => {
            const create_table_json_cache = `
                CREATE TABLE IF NOT EXISTS "json_cache" (
                    "typeid" smallint NOT NULL,
                    "phpbbid" int NOT NULL,
                    "page" int NOT NULL DEFAULT 1,
                    "url" text NOT NULL,
                    "version" integer NOT NULL DEFAULT 0,
                    "content" jsonb NOT NULL,
                    "scrapped_at" timestamp without time zone,
                    "created_at" timestamp without time zone NOT NULL DEFAULT now(),
                    "updated_at" timestamp without time zone NOT NULL DEFAULT now(),
                    CONSTRAINT "json_cache_pkey" PRIMARY KEY ("typeid", "phpbbid", "page")
                )
            `;
            const promises = [];
            promises.push(this.db.client.query(create_table_json_cache));
            Promise.all(promises).then(resolve).catch(reject);
        })
    }

    save(data) {
        return new Promise((resolve, reject) => {
            if (Scrapper.isCacheable(data.typeId)) {
                const phpbbid = data.phpbbid || 0;
                const page = data.navi.page === 0 ? 1 : data.navi.page;

                const store_query = `INSERT INTO "json_cache"
                    ("typeid", "phpbbid", "page", "url", "content", "version", "scrapped_at")
                    VALUES
                    ($1, $2, $3, $4, $5, $6, now()) ` +
                    `ON CONFLICT ON CONSTRAINT "json_cache_pkey" DO `+
                    `UPDATE SET "content" = $5, "version" = $6, "scrapped_at" = now(), "updated_at" = now()`;
                const values = [+data.typeId, phpbbid, page, data.url.href, JSON.stringify(data, 0).length, Scrapper.jsonVersion];
                debug('"%s"\nvalues: "%o"', store_query, values);
                values[4] = data;
                this.db.client.query(store_query, values).then(() => {
                    resolve();
                }).catch((err) => {
                    debug('JsonCache storing error / store (typeId="%d", id="%d", page="%d")', data.typeId, phpbbid, page);
                    reject(err);
                });
            } else {
                resolve();
            }
        });
    }

    load(url) {
        return new Promise((resolve, reject) => {
            if (Scrapper.isCacheable(Scrapper.linkType(url))) {
                const meta = Scrapper.parseForumUrl(url);
                const select_query = `SELECT "content", "scrapped_at" FROM "json_cache" WHERE "typeid" = $1 AND "phpbbid" = $2 AND "page" = $3`;
                debug('"%s"\nvalues: "%o"\nurl: "%o"', select_query, [meta.typeId, meta.phpbbid || 0, meta.page], url);

                this.db.client.query(select_query, [meta.typeId, meta.phpbbid || 0, meta.page]).then((res) => {
                    if (res.rows.length > 0) {
                        const data = res.rows[0];
                        const momentOfScrap = moment(data.scrapped_at);
                        const ttlDuration = moment.duration(this.ttl, 's');
                        const validUntil = moment(momentOfScrap + ttlDuration);
                        const now = moment();
                        // debug("scrapped_at: %s", momentOfScrap);
                        // debug("valid_until: %s", validUntil);
                        // debug("this_moment: %s", now);
                        if (validUntil.isBefore(now) || !data.version || data.version < Scrapper.jsonVersion) {
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
                    debug('JsonCache loading error (typeId="%d", id="%d", page="$d")', meta.typeid, meta.phpbbid, meta.page);
                    reject(err);
                });
            } else {
                resolve(null);
            }
        })
    }
}
module.exports = ScrapingCache;