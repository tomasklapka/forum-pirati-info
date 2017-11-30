"use strict";

const express = require('express'),
    forum = require('./routes/forum'),
    join = require('path').join,
    favicon = require('serve-favicon'),
    logger = require('morgan'),
    bodyParser = require('body-parser');

const ForumScrapper = require('./lib/forum_scrapper');

const app = express();

const config = require('./config.json');

app.set('base', config.base);
app.set('sameAsBase', config.sameAsBase);
app.set('port', config.port || process.env.PORT || 3042);
app.set('views', __dirname + '/views');
app.set('view engine', 'pug');

app.enable('trust proxy');
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
app.use(favicon(join(__dirname, 'public/favicon.ico')));
app.use(logger('dev'));
app.set('json spaces', 2);
app.use(express.static(join(__dirname, 'public')));
app.use(bodyParser.json());

app.get('/', forum.index);
//app.get(/^\/unreadposts(-(\d+))?\.html$/, forum.unreadPosts);
//app.get(/^\/newposts(-(\d+))?\.html$/, forum.newPosts);
app.get(/^\/active-topics(-(\d+))?\.html/, forum.activeTopics);
app.get(/^\/unanswered(-(\d+))?\.html/, forum.unanswered);
app.get(/^\/memberlist(-(\d+))?\.php/, forum.memberList);
app.get(/^\/viewtopic.php/, forum.viewTopic);
app.get(/^\/search.php/, forum.searchPosts);
app.get(/^\/post(\d+)\.html/, forum.post);
app.get(/^\/[\w\d-]+-u(\d+)\/posts\/?(page(\d+)\.html)?/, forum.userPosts);
//app.get(/^\/[\w\d-]+-u(\d+)\/topics\/?$/, forum.userTopics);
app.get(/^\/[\w\d-]+-u(\d+)\/?/, forum.user);
app.get(/^\/[\w\d-]+-g(\d+)(-(\d+))?\.html/, forum.group);
app.get(/^\/[\w\d-]+-f(\d+)\/[\w\d-]+-t(\d+)(-(\d+))?\.html/, forum.topic);
app.get(/^\/[\w\d-]+-f(\d+)\/?(page(\d+)\.html)?/, forum.forum);
app.get(/^\/download\/file\.php/, forum.file);
app.get(/^\/images\//, forum.file);
app.get(/^\/resources\//, forum.file);

function listen() {
    app.listen(app.get('port'), function () {
        console.log("Express server listening on port " + app.get('port'));
    });
}

ForumScrapper
    .login(config.sameAsBase+'/ucp.php?mode=login', config.username, config.password)
    .then(() => {
        listen();
    })
    .catch((err) => {
        console.log('Could not login as ' + config.username + '.');
        console.log(err);
        debug(err);
        listen();
    });


