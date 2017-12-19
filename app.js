"use strict";

const morgan = require('morgan');

const Db = require('./lib/db');
const ScrapingCache = require('./lib/scraping_cache');
const Scrapper = require('./lib/scrapper');
const Mirror = require('./lib/mirror');
const ScrapingQueue = require('./lib/scraping_queue');

const config = require('./config.json') || {};
config.mirror = (config.mirror === false || config.mirror === true) ? config.mirror : true;
config.scrapInterval = config.scrapInterval || 500;
config.statsInterval = config.statsInterval || 60000;
config.saveStateInterval = config.saveStateInterval || 60000;

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

const scrapingQueue = new ScrapingQueue({
    db: db,
    scrapper: scrapper,
    baseOrigin: config.baseOrigin,
    scrapInterval: config.scrapInterval,
    maxScrapInterval: config.maxScrapInterval,
    saveStateInterval: config.saveStateInterval,
});

Promise.all([
    db.init(),
    scrapingCache.init(),
]).then(() => {
    if (config.mirror) {
        mirror.listen();
    }
    if (config.scrapInterval > 0) {
        start_scraping_queue();
    }
    if (config.statsInterval > 0) {
        setInterval(show_stats, config.statsInterval);
    }
}).catch((err) => {
    console.log('init error: "%o"', err);
});

function start_scraping_queue() {
    scrapingQueue
        .init()
        .then(() => {
            console.log('Scraping queue started with interval: %d ms', config.scrapInterval);
            scraping_queue_tick();
            setInterval(save_scraping_queue_state, config.saveStateInterval);
        })
        .catch((err) => {
            console.log('scraping_queue init error', err);
        });
}

function scraping_queue_tick() {
    scrapingQueue.tick(() => {
        setTimeout(scraping_queue_tick, scrapingQueue.scrapInterval);
    });
}

function save_scraping_queue_state() {
    scrapingQueue.saveState();
}

function show_stats() {
    scrapingQueue.stats();
}
