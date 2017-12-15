"use strict";

const morgan = require('morgan');

const Db = require('./lib/db');
const ScrapingCache = require('./lib/scraping_cache');
const Scrapper = require('./lib/scrapper');
const Mirror = require('./lib/mirror');
const ScrapingQueue = require('./lib/scraping_queue');

const config = require('./config.json');
config.mirror = (config.mirror === false || config.mirror === true) ? config.mirror : true;

const db = new Db(config.database);

const scrapingCache = new ScrapingCache({
    db: db,
    ttl: config.cacheTtl,
});
const scrapper = new Scrapper({
    db: db,
    cache: scrapingCache,
    base: config.base,
    baseOrigin: config.baseOrigin,
    requestTimeout: config.requestTimeout,
    dataDir: config.dataDir,
    username: config.username,
    password: config.password
});
const mirror = new Mirror({
    scrapper: scrapper,
    logger: morgan(config.morgan),
    baseOrigin: config.baseOrigin,
    port: config.mirrorPort,
});
/*
const scrapingQueue = new ScrapingQueue({
    db: db,
    scrapper: scrapper,
    baseOrigin: config.baseOrigin,
    scrapInterval: config.scrapInterval,
    maxScrapInterval: config.maxScrapInterval,
    saveStateInterval: config.saveStateInterval,
});
*/

Promise.all([
    db.init(),
    scrapingCache.init(),
//    scrapingQueue.init(),
]).then(() => {
    if (config.mirror) {
        mirror.listen();
    }
}).catch((err) => {
    console.log('init error: "%o"', err);
});


/*
function scrap_tick() {
    scrapingQueue.scrapTick(() => {
        setTimeout(scrap_tick, scrapingQueue.scrapInterval);
    });
}

function stats() {
    scrapingQueue.stats();
}

function save_state() {
    scrapingQueue.save_state()
}
*/

/*
function listen() {
    stats();
    if (config.statsInterval !== 0) {
        setInterval(stats, config.statsInterval || 60000);
    }
    if (config.scrapInterval !== 0) {
        scrap_tick();
        if (config.saveStateInterval !== 0) {
            setInterval(save_state, config.saveStateInterval || 60000);
        }
    }
    if (config.mirror) {
        mirror.listen();
    }
}


*/