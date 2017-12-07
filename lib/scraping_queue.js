const debug = require('debug')('scraping_queue');

const ForumScrapper = require('./forum_scrapper');
const mapTypeTable = require('./json_cache').mapTypeTable;

class ScrapingQueue {

    constructor(client) {
        this.client = client;
    }

    init() {
        debug('init()');
        return Promise.resolve();
    }

    scrapTick() {

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
        Promise.all(promises).then((results) => {
            results.forEach((result) => {
//                debug(result.rows.length);
                debug('Stat %o', result.rows[0]);
            })
        }).catch(debug);
    }

    start() {
        debug('start()');
//        this.stats();
        // setTimeout... scrapTick
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