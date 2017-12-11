"use strict";

const express = require('express'),
    forum = require('./routes/forum'),
    join = require('path').join,
    favicon = require('serve-favicon'),
    logger = require('morgan'),
    bodyParser = require('body-parser');
const { Client } = require('pg');

const ForumScrapper = require('./lib/forum_scrapper');
const Db = require('./lib/db');
const JsonCache = require('./lib/json_cache');
const ScrapingQueue = require('./lib/scraping_queue');

const config = require('./config.json');
config.mirror = config.mirror === false || config.mirror === true ? config.mirror : true;

const pgClient = new Client({
    connectionString: config.database,
});

const app = express();
app.set('config', config);
ForumScrapper.requestTimeout = config.requestTimeout || ForumScrapper.requestTimeout;
app.set('base', config.base);
app.set('originBase', config.originBase);
const db = new Db(pgClient);
app.set('db', db);
const jsonCache = new JsonCache(pgClient, config.cacheTtl);
app.set('jsonCache', jsonCache);
const scrapingQueue = new ScrapingQueue(pgClient, app);
app.set('scrapingQueue', scrapingQueue);
app.set('port', config.port || process.env.PORT || 3042);
app.set('views', __dirname + '/views');
app.set('view engine', 'pug');

app.enable('trust proxy');
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
app.use(favicon(join(__dirname, 'public/favicon.ico')));
app.use(logger('dev'));
app.set('json spaces', 2);
app.use(express.static(join(__dirname, 'public')));
app.use(bodyParser.json());

app.get('/', forum.forum);
app.get(/^\/active-topics(-(\d+))?\.html/, forum.forum);
app.get(/^\/unanswered(-(\d+))?\.html/, forum.forum);
app.get(/^\/viewforum.php/, forum.forum);

app.get(/^\/viewtopic.php/, forum.topic);
app.get(/^\/search.php/, forum.topic);
app.get(/^\/.*(topic|post)(\d+)(-\d+)?\.html/, forum.topic);
app.get(/^\/[\w\d-]+-u(\d+)\/posts\/?(page(\d+)\.html)?/, forum.topic);
app.get(/^\/([\w\d-]+-f(\d+)|announces)\/[\w\d-]+-t(\d+)(-(\d+))?\.html/, forum.topic);

app.get(/^\/[\w\d-]+-u(\d+)\/topics\/?(page(\d+)\.html)?/, forum.forum);
app.get(/^\/[\w\d-]+-f(\d+)\/?(page(\d+)\.html)?/, forum.forum);

app.get(/^\/[\w\d-]+-u(\d+)\/?/, forum.user);

app.get(/^\/memberlist(-(\d+))?\.php/, forum.group);
app.get(/^\/([\w\d-]+-g|group)(\d+)(-(\d+))?\.html/, forum.group);

app.get(/^\/download\/file\.php/, forum.file);
app.get(/^\/resources\//, forum.file);
app.get(/^\/images\//, forum.file);

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
        app.listen(app.get('port'), function () {
            console.log("Express server listening on port " + app.get('port'));
        });
    }
}

function login() {
    ForumScrapper
        .login(config.originBase+'/ucp.php?mode=login', config.username, config.password)
        .then(() => {
            listen();
        })
        .catch((err) => {
            console.log('Could not login as ' + config.username + '.');
            console.log(err);
            listen();
        });
}

function errHandler (err) {
    console.log('Could not init db ' + config.database + '.');
    console.log(err);
    login();
}

db.init().then(() => {
    console.log('DB initialized');
    jsonCache.init().then(() => {
        console.log('json cache initialized');
        scrapingQueue.init().then(() => {
            console.log('scraping queue initialized');
            login();
        }).catch(errHandler);
    }).catch(errHandler);
}).catch(errHandler);
