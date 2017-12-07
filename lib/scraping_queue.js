const debug = require('debug')('scraping_queue');

const ForumScrapper = require('./forum_scrapper');
const mapTypeTable = require('./json_cache').mapTypeTable;

class ScrapingQueue {

    constructor(client, app) {
        this.client = client;
        this.base = app.get('base');
        this.originBase = app.get('originBase');
        this.cache = app.get('jsonCache');
        this.chargeUrls = app.get('chargeUrls');
        this._queue = [];
        this._charging = false;
    }

    init() {
        debug('init()');
        return Promise.resolve();
    }

    queueLinks(links) {
        if (links && links.length > 0) {
            debug('links.length: "%d"',  links.length);
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                if (link.url.indexOf(this.base) === 0 &&
                    !(/\/post\d+\.html/.exec(link.originUrl))) {
                    // stay in base and dont queue post\d+\.html pages
                    this.queue(link.originUrl, null, link.type)
                }
            }
        }

    }

    scrapTick() {
        debug('tick');
        if (this._queue.length === 0 && !this._charging) {
            this.charge();
        }
        if (this._queue.length > 0) {
            const url = this._queue.shift();
            debug('queue scrap');
            ForumScrapper
                .scrap(url, this.base, this.originBase)
                .then((data) => {
                    // queue links for crawling
                    debug('data.links.length: "%d"', data.links.length);
                    this.queueLinks(data.links);
                    delete data.links;

                    this.cache.save(data).catch(debug);
                })
                .catch(debug);
        }
    }

    charge() {
        this._charging = true;
        const charge_query = `
            SELECT '{TABLE}', * FROM (SELECT "content" FROM "{TABLE}" WHERE queue > 0 ORDER BY queue ASC LIMIT `+this.chargeUrls+`) tab_{TABLE}
        `;
        const charges = [];
        const search = new RegExp('\{TABLE\}', 'g');
        ['forums', 'threads', 'groups', 'users'].forEach((table) => {
            charges.push(charge_query.replace(search, table));
        });
        const query = charges.join(`
            UNION
        `);
        this.client.query(query).then((result) => {
            for (let i = 0; i < result.rows.length; i++) {
                this._queue.push(result.rows[i].content.url);
            }
            this._charging = false;
        }).catch(debug);
    }

    stats() {
        debug('stats()');
        const select_counts_query = `
                SELECT COUNT(*), '{TABLE}'::varchar(7) FROM "{TABLE}" WHERE "queue" IS DISTINCT FROM NULL
            `;
        const promises = [];
        const search = new RegExp('\{TABLE\}', 'g');
        ['forums', 'threads', 'groups', 'users'].forEach((table) => {
            promises.push(this.client.query(select_counts_query.replace(search, table)));
        });
        debug('--- STATS ---');
        debug('charged: %d', this.queue.length);
        debug('queue: %o', this.queue);
        Promise.all(promises).then((results) => {
            results.forEach((result) => {
//                debug(result.rows.length);
                debug('stat %o', result.rows[0]);
            })
        }).catch(debug);
    }

    // priority = null means it won't be queued if cached already
    queue(url, priority = null, typeId = null) {
        // debug('queue("%s", "%o", "%d")', url, priority, typeId);
        typeId = typeId || ForumScrapper.link(url);
        if (ForumScrapper.cacheableType(typeId)) {
            const table = mapTypeTable[typeId];
            const data = ForumScrapper.parseForumUrl(url);
            data.phpbbid = data.phpbbid || 0;
            data.navi = { page: data.page };
            delete data.page;
            data.url = url;
            data.invalid = true;

            const store_query = `INSERT INTO "`+table+`" ("phpbbid", "page", "is_last_page", "content", "queue") VALUES ($1, $2, $3, $4, $5) ` +
                `ON CONFLICT ON CONSTRAINT "`+table+`_pkey" DO ` +
                (priority === null ? `NOTHING` : `UPDATE SET "queue" = $5, "updated_at" = now()`);
            priority = priority || 1000;
            const query_data = [ data.phpbbid, data.navi.page, true, data, priority ];
            // debug('save "%s", "%o"', store_query, query_data);
            this.client.query(store_query, query_data).catch((err) => {
                debug('Queue store error / %o', err);
            });
        }
    }
}
module.exports = ScrapingQueue;