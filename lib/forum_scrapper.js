const debug = require('debug')('forum-scrapper');
const fnDebug = require('debug')('fn:forum-scrapper');

const removeDiacritics = require('diacritics').remove;
const cheerio = require('cheerio');
const origRequest = require('request');
const URL = require('url');

const requestExt = require('request-extensible');
const RequestHttpCache = require('request-http-cache');

const PageType = {
    None: 0,
    Root: 1,
    Forum: 2,
    Thread: 3,
    Post: 4,
    Group: 5,
    User: 6,
    Unanswered: 7,
    ActiveTopics: 8,
    NewPosts: 9,
    UnreadPosts: 10,
    UserTopics: 11,
    Memberlist: 12,
    UserPosts: 13,
    Search: 14,
};

const rootUrl = new RegExp(/^https?:\/\/[^\/]+\/?(\?.*)?$/);
const forumUrl = new RegExp(/^http.*-f(\d+)\/?(\?.*)?$/);
const forumPageUrl = new RegExp(/^http.*-f(\d+)\/page(\d+).html(\?.*)?$/);
const threadUrl = new RegExp(/^http.*-t(\d+)\.html(\?.*)?$/);
const threadPageUrl = new RegExp(/^http.*-t(\d+)(-\d+)?\.html(\?.*)?$/);
const postUrl = new RegExp(/^http.*\.html#p(\d+)\/?(\?.*)?$/);
const userUrl = new RegExp(/^http.*-u(\d+)\/?(\?.*)?$/);
const userPostsUrl = new RegExp(/^http.*-u(\d+)\/posts\/?(page(\d+)\.html)?(\?.*)?$/);
const groupUrl = new RegExp(/^http.*-g(\d+).html(\?.*)?$/);
const groupPageUrl = new RegExp(/^http.*-g(\d+)-(\d+).html(\?.*)?$/);
const unansweredUrl = new RegExp(/^https?:\/\/[^\/]+\/unanswered(-(\d+))?\.html(\?.*)?$/);
const activeTopicsUrl = new RegExp(/^https?:\/\/[^\/]+\/active-topics(-(\d+))?\.html(\?.*)?$/);
const unreadPostsUrl = new RegExp(/^https?:\/\/[^\/]+\/unreadposts(-(\d+))?\.html(\?.*)?$/);
const memberlistUrl = new RegExp(/^https?:\/\/[^\/]+\/memberlist(-(\d+))?\.php(\?.*)?$/);
const searchUrl = new RegExp(/^https?:\/\/[^\/]+\/search\.php(\?.*)?$/);

const defaultRequest = origRequest.defaults({ jar: true });

class ForumScrapper {

    constructor(url, base, originBase, requestCache) {
        this.phpbbid = null;
        this.title = null;
        this.url = url;
        this.type = null;
        this.typeId = null;
        this.base = base;
        this.originBase = originBase;
        this.sameAs = null;
        this.asJson = null;

        this.navi = {
            page: null,
            pages: null,
            pagerUrl: null,
            first: null,
            prev: null,
            next: null,
            forum: null,
            forumTitle: null,
            parent: null,
            parentTitle: null,
        };

        this.user = {
            username: null,
            signature: null,
            avatarSrc: null,
            rank: null,
            address: null,
            age: null,
            occupation: null,
            defaultGroup: null,
            groups: {},
            interests: null,
            profession: null,
            icq: null,
            www: null,
            jabber: null,
            registered: null,
            lastVisit: null,
            totalPosts: null,
            likesGot: null,
            likesGave: null,
            showOnMap: false
        };

        this.poll = null;
        this.users = {};
        this.sections = {};
        this.forums = {};
        this.announcements = {};
        this.threads = {};
        this.posts = [];

        this.map = {
            PageType: PageType,
        };
        this.rules = null;
        this.links = [];

        this.resolve = null;
        this.reject = null;
        this.$ = null;
        this.httpRequestCache = null;
        this.defaultRequest = null;
        this.request = null;
        this.requestCache = requestCache;
        this.orphanSuperForumIndex = 0;
    }

    static linkType(url) {
        if (!url) return PageType.None;
        if (forumUrl.exec(url)) {
            return PageType.Forum;
        }
        if (forumPageUrl.exec(url)) {
            return PageType.Forum;
        }
        if (threadUrl.exec(url)) {
            return PageType.Thread;
        }
        if (threadPageUrl.exec(url)) {
            return PageType.Thread;
        }
        if (postUrl.exec(url)) {
            return PageType.Post;
        }
        if (userUrl.exec(url)) {
            return PageType.User;
        }
        if (groupUrl.exec(url)) {
            return PageType.Group;
        }
        if (groupPageUrl.exec(url)) {
            return PageType.Group;
        }
        if (rootUrl.exec(url)) {
            return PageType.Root;
        }
        if (unansweredUrl.exec(url)) {
            return PageType.Unanswered;
        }
        if (activeTopicsUrl.exec(url)) {
            return PageType.ActiveTopics;
        }
        if (unreadPostsUrl.exec(url)) {
            return PageType.UnreadPosts;
        }
        if (memberlistUrl.exec(url)) {
            return PageType.Memberlist;
        }
        if (userPostsUrl.exec(url)) {
            return PageType.UserPosts;
        }
        if (searchUrl.exec(url)) {
            return PageType.Search;
        }
        return PageType.None;
    }

    scrap() {
        fnDebug('this.scrap()');
        debug('this.url: %s', this.url);
        this.type = ForumScrapper.linkType(this.url);
        return new Promise((resolve, reject) => {
            if (this.resolve || this.reject) {
                reject('scrap not finished yet');
            }
            this.resolve = resolve;
            this.reject = reject;
            let scrappingRequest = defaultRequest;
            if (this.requestCache) {
                if (!this.request) this.initCache();
                scrappingRequest = this.request;
            }
            debug('scrappingRequest ', this.url);
            scrappingRequest({url: this.url}, (err, response, body) => {
//                debug('scrappingRequest ', body);
                if (err) {
                    this.reject(err);
                    return;
                }
                if (!body) {
                    this.reject('no content');
                    return;
                }
                try {
                    this.$ = cheerio.load(body);
                } catch (err) {
                    console.log(response);
                    console.log('Cheerio parsing body: %s\n#####\n%s\n#####', this.url, body);
                    console.log('Cheerio parsing error: %s', err);
                    this.reject(err);
                }
                this.scrapLinks();
                this.scrapParent();
                this.scrapPagination();
                debug('type: %d', this.type);
                switch (this.type) {
                    case PageType.Root:
                        this.title = this.$('title').text();
                    case PageType.Forum:
                    case PageType.Unanswered:
                    case PageType.ActiveTopics:
                    case PageType.UnreadPosts:
                        this.scrapForum();
                        break;
                    case PageType.UserPosts:
                    case PageType.Thread:
                    case PageType.Search:
                        this.scrapThread();
                        break;
                    case PageType.User:
                        this.scrapUser();
                        break;
                    case PageType.Memberlist:
                    case PageType.Group:
                        this.scrapGroup();
                        break;
                }
                this.$ = null;
                setTimeout(() => {
                    this.resolve(this);
                }, 100);
            });
        });
    }

    scrapRules() {
        fnDebug('this.scrapRules()');
        this.rules = this.$('div.rules').children('div.inner').html();
        if (this.rules && this.rules.length > 0) {
            this.rules = this.rules.replace(this.originBase, this.base);
        }
        return this.rules;
    }

    scrapLinks() {
        fnDebug('this.scrapLinks()');
        this.$('a').each((i, a) => {
            const linkUrl = this.rebase(this.$(a).attr('href'));
            const type = ForumScrapper.linkType(this.$(a).attr('href'));
            if ((linkUrl || typeof linkUrl === typeof 'string') && type !== PageType.None) {
                this.links.push({
                    title: this.$(a).text(),
                    url: linkUrl.replace(/#wrap$/, ''),
                    type: type
                });
            }
        });
    }

    scrapParent() {
        fnDebug('this.scrapParent()');
        const linkPath = this.$('div#page-header').children('div.navbar').children('div.inner').children('ul.navlinks')
            .children('li.icon-home').children('a');
        this.navi.forum = this.rebase(linkPath.last().attr('href'));
        this.navi.forumTitle = linkPath.last().text();
        if (linkPath.length > 1) {
            this.navi.parent= this.rebase(linkPath.last().prev().prev().attr('href'));
            this.navi.parentTitle = linkPath.last().prev().prev().text();
        }
    }

    scrapLastPost(p) {
        let lastPost = {
            username: null,
            user: null,
            post: null,
            created: null
        };
        p.children('span').children('a').each((i, p) => {
            const lastPostUrl = this.rebase(this.$(p).attr('href'));
            const urlType = ForumScrapper.linkType(lastPostUrl);
            if (urlType === PageType.User) {
                lastPost.user = lastPostUrl;
                lastPost.username = this.$(p).text();
            } else {
                if (urlType === PageType.Post) {
                    lastPost.post = lastPostUrl;
                }
            }
        });
        if (!lastPost.user) {
            lastPost.username = p.children('span').children('span').text();
            lastPost.user = 'unregistered:'+lastPost.username;
        }
        if (lastPost.post) {
            const lastPostTime = p.children('span').text().split(/\n/);
            lastPost.created = ForumScrapper.parseDate(lastPostTime[lastPostTime.length-1].trim());
        } else {
            lastPost = null;
        }
        return lastPost;
    }

    static scrapRowPages(body) {
        const pages = +body.children('strong.pagination').children('span').children('a').last().text();
        return pages === 0 ? 1 : pages;
    }

    scrapForum() {
        fnDebug('this.scrapForum()');
        this.scrapRules();
        this.phpbbid = ForumScrapper.forumIdFromUrl(this.url);
        const title = this.$('div#page-body').children("h2").text();
        if (title) {
            this.title = title;
        }
        let section = null; // { phpbbid: this.orphanSuperForumIndex };
        let sectionIndex = -1;
        this.$('.topiclist').each((i, p) => {
            if (this.$(p).hasClass('topics')) {
                debug('topic section', i);
                this.$(p).children('li').each((i, p) => {
                    const dl = this.$(p).children('dl');
                    const topicBody = dl.children('dt');

                    const links = topicBody.children('a');
                    let topicLink;
                    let topicUrl;
                    let topicTitle;
                    let opUrl;
                    let opUsername;
                    let fUrl;
                    let fTitle;
                    links.each((i, p) => {
                        if (this.$(p).hasClass('topictitle')) {
                            topicLink = this.$(p);
                            topicUrl = this.rebase(topicLink.attr('href'));
                            topicTitle = topicLink.text();
                        } else {
                            const url = this.rebase(this.$(p).attr('href'));
                            if (userUrl.exec(url)) {
                                opUrl = url;
                                opUsername = this.$(p).text();
                            } else {
                                if (forumUrl.exec(url)) {
                                    fUrl = url;
                                    fTitle = this.$(p).text();
                                }
                            }
                        }
                    });
                    const op = topicBody.text();
                    const created = ForumScrapper.parseDate(op.replace(/^[\s\S]*» /, '').replace(/\n[\s\S]*$/, ''));
                    const nPosts = dl.children('dd.posts').text().split(' ').shift()*1;
                    const nViews = dl.children('dd.views').text().split(' ').shift()*1;
                    const lastPost = this.scrapLastPost(dl.children('dd.lastpost'));

                    const topic = {
                        phpbbid: ForumScrapper.threadIdFromUrl(topicUrl),
                        url: topicUrl,
                        title: topicTitle,
                        locked: (dl.attr('style').match(/locked.gif/) !== null),
                        pages: ForumScrapper.scrapRowPages(topicBody),
                        created: created,
                        user: opUrl,
                        username: opUsername,
                        forum: fUrl,
                        forumTitle: fTitle,
                        n_posts: nPosts,
                        n_views: nViews,
                        last_post: lastPost,
                        section: sectionIndex,
                    };
                    if (this.$(p).hasClass('global-announce')) {
                        this.announcements[topic.phpbbid] = topic;
                        this.sections[sectionIndex].announcements.push(topic.phpbbid);
                    } else {
                        this.threads[topic.phpbbid] = topic;
                        this.sections[sectionIndex].threads.push(topic.phpbbid);
                    }
                })
            } else {
                if (this.$(p).hasClass('forums')) {
                    debug('forum section', i);
                    this.$(p).children('li').each((i, p) => {
                        const dl = this.$(p).children('dl');
                        const forumBody = dl.children('dt');
                        const forumLinks = forumBody.children('a');
                        let forumUrl;
                        let forumTitle;
                        const subforums = [];
                        const moderators = [];
                        forumLinks.each((i, p) => {
                            const link = this.$(p);
                            if (link.hasClass('forumtitle')) {
                                forumUrl = this.rebase(link.attr('href'));
                                forumTitle = link.text();
                            } else {
                                const linkObj = {
                                    url: this.rebase(link.attr('href')),
                                    title: link.text()
                                };
                                if (link.hasClass('subforum')) {
                                    subforums.push(linkObj);
                                } else {
                                    moderators.push(linkObj);
                                }
                            }
                        });

                        const nTopics = dl.children('dd.topics').text().split(' ').shift()*1;
                        const nPosts = dl.children('dd.posts').text().split(' ').shift()*1;
                        const lastPost = this.scrapLastPost(dl.children('dd.lastpost'));

                        const forum = {
                            phpbbid: ForumScrapper.forumIdFromUrl(forumUrl),
                            url: forumUrl,
                            title: forumTitle,
                            locked: (dl.attr('style').match(/locked.gif/) !== null),
                            pages: ForumScrapper.scrapRowPages(forumBody),
                            n_topics: nTopics,
                            n_posts: nPosts,
                            last_post: lastPost,
                            section: section.id,
                            subforums: subforums,
                            moderators: moderators
                        };
                        this.forums[forum.phpbbid] = forum;
                        this.sections[sectionIndex].forums.push(forum.phpbbid);
                    })
                } else {
                    debug('section', ++sectionIndex);
                    section = {
                        id: sectionIndex,
                        url: null,
                        title: null,
                        forums: [],
                        announcements: [],
                        threads: [],
                    };
                    const sectionBody = this.$(p).children('li').children('dl').children('dt');
                    const sectionLink = sectionBody.children('a');
                    if (sectionLink.length > 0) {
                        section.url = this.rebase(sectionLink.attr('href'));
                        section.title = sectionLink.text();
                    } else {
                        section.title = sectionBody.text();
                    }
                    this.sections[sectionIndex] = section;
                }
            }
        });
    }

    scrapUser() {
        fnDebug('this.scrapUser()');
        const user = this.user;
        this.phpbbid = ForumScrapper.userIdFromUrl(this.url);
        this.title = this.$('dl.details').first().children('dd').children('span').text();
        user.signature = this.$('.signature').html();

        const userBody = this.$('form#viewprofile').children('div.panel');
        const userBodyPanel1 = userBody.first().children('div.inner').children('dl');
        user.avatarSrc = userBodyPanel1.first().children('dt').children('img').first().attr('src');
        if (user.avatarSrc && user.avatarSrc.length > 0) {
            user.avatarSrc = user.avatarSrc.replace(/^\.\//, '/');
        }
        user.rank = userBodyPanel1.first().children('dd').text();
        if (user.rank.length === 0) {
            user.rank = null;
        }
        let detailsBody = userBodyPanel1.first();
        if (user.avatarSrc) {
            detailsBody = detailsBody.next();
        }
        detailsBody.children('dt').each((i, e) => {
            const dd = this.$(e).next();
            switch (this.$(e).text()) {
                case 'Uživatelské jméno:':
                    user.username = dd.children('span').text();
                    break;
                case 'Bydliště:':
                    user.address = dd.text();
                    break;
                case 'Věk:':
                    user.age = dd.text();
                    break;
                case 'Skupiny:':
                    dd.children('select').children('option').each((j, o) => {
                        const option = this.$(o);
                        const id = option.attr('value');
                        const group = {
                            phpbbid: id,
                            url: this.rebase(this.makeGroupUrl(id, option.text())),
                            title: option.text()
                        };
//                        const groupUrl = this.rebase(this.makeGroupUrl(id, option.text()));
                        if (option.attr('selected') === 'selected') {
                            user.defaultGroup = group;
                        }
                        user.groups[id] = group;
                    });
                    break;
                case 'Profese:':
                    user.profession = dd.text();
                    break;
                case 'Zájmy:':
                    user.interests = dd.text();
                    break;
                case 'Povolání:':
                    user.occupation = dd.text();
                    break;
                case 'Zobrazit bydliště na mapě:':
                    user.showOnMap = (dd.text() === 'Ano');
                    break;
                case 'Hodnost:':
                    user.rank = dd.text();
                    break;
            }
        });
        const userBodyPanel2 = userBody.first().next().children('div.inner');
        userBodyPanel2.children('div.column1').children('dl.details').children('dt').each((i, e) => {
            const dd = this.$(e).next();
            switch (this.$(e).text()) {
                case 'ICQ:':
                    user.icq = dd.children('a').attr('href')
                        .replace(/http:\/\/www\.icq\.com\/people\//, '')
                        .replace(/\//, '');
                    break;
                case 'WWW:':
                    user.www = dd.children('a').attr('href');
                    break;
                case 'Jabber:':
                    user.jabber = dd.text();
                    break;
            }
        });
        userBodyPanel2.children('div.column2').children('dl.details').children('dt').each((i, e) => {
            const dd = this.$(e).next();
            switch (this.$(e).text()) {
                case 'Registrován:':
                    user.registered = ForumScrapper.parseDate(dd.text());
                    break;
                case 'Poslední návštěva:':
                    user.lastVisit = (dd.text() === ' - ') ? null : ForumScrapper.parseDate(dd.text());
                    break;
                case 'Celkem příspěvků:':
                    user.totalPosts = +dd.text().split(/\n/).shift().replace(/ .*$/m, '');
                    break;
            }
        });
        user.likesGave = +userBody.first().next().next().next().next()
            .children('div.inner').children('dl').children('dt').text()
            .replace(/Dal poděkování: /, '')
            .replace(/ krát/, '');
        user.likesGot = +userBody.first().next().next().next().next().next()
            .children('div.inner').children('dl').children('dt').text()
            .replace(/Dostal poděkování: /, '')
            .replace(/ krát/, '');
        this.user = user;
    }

    scrapGroup() {
        fnDebug('this.scrapGroup()');
        this.phpbbid = ForumScrapper.groupIdFromUrl(this.url);
        this.title = this.$('h2').text();
        this.$('tbody').children('tr').each((i, e) => {
            const user = {
                phpbbid: null,
                url: null,
                username: null,
                n_posts: null,
                registered: null
            };
            let td = this.$(e).children('td').first();
            const userLink = td.children('a');
            user.url = this.rebase(userLink.attr('href'));
            user.username = userLink.text();
            user.phpbbid = ForumScrapper.userIdFromUrl(user.url);
            td = td.next();
            user.n_posts = td.children('a').text();
            td = td.next().next();
            user.registered = ForumScrapper.parseDate(td.text());
            this.users[user.phpbbid] = user;
        });
    }

    scrapPagination() {
        fnDebug('this.scrapPagination()');
        const pagination = this.$('.pagination').children('a').children('strong');
        this.navi.page = +pagination.first().text();
        this.navi.pages = +pagination.last().text();
        debug(this.navi.page);
        if (this.navi.page > 0) {
            debug('urlare');
            const tempUrl = URL.parse(this.url, true);
            tempUrl.query.start = undefined;
            tempUrl.search = undefined;
            this.navi.first = this.rebase(URL.format(tempUrl));
            this.navi.pageElements = 100;
            switch (this.type) {
                case PageType.UserPosts:
                    this.navi.first = this.rebase(this.url.replace(/\/?(page\d+\.html)?$/, '/'));
                    this.navi.pagerUrl = this.navi.first + 'page{PAGE}0.html';
                    this.navi.pageElements = 10;
                    break;
                case PageType.Forum:
                    this.navi.first = this.rebase(this.url.replace(/\/page\d+\.html$/, '/'));
                    this.navi.pagerUrl = this.navi.first + 'page{PAGE}00.html';
                    break;
                case PageType.Group:
                    this.navi.first = this.rebase(this.url.replace(/-\d+\.html$/, '.html'));
                    this.navi.pagerUrl = this.navi.first.replace(/\.html$/, '-{PAGE}00.html');
                    break;
                case PageType.Thread:
                    this.navi.first = this.rebase(this.url.replace(/-\d+\.html$/, '.html'));
                    this.navi.pagerUrl = this.navi.first.replace(/\.html$/, '-{PAGE}0.html');
                    this.navi.pageElements = 10;
                    break;
                default:
                    const tempUrl = URL.parse(this.navi.first, true);
                    tempUrl.query.start = 'STARTPAGER';
                    tempUrl.search = undefined;
                    this.navi.pagerUrl = URL.format(tempUrl).replace('STARTPAGER', '{PAGE}0' + (
                        this.type === PageType.ActiveTopics ||
                        this.type === PageType.Unanswered
                        ? '0' : ''
                    ));
            }
            if (this.type === PageType.Thread) {
                this.navi.pageElements = 10;
            }
            if (this.navi.page === 2) {
                this.navi.prev = this.navi.first;
            } else {
                if (this.navi.page > 2) {
                    this.navi.prev = this.navi.pagerUrl.replace('{PAGE}', this.navi.page - 2);
                }
            }
            if (this.navi.page < this.navi.pages) {
                this.navi.next = this.navi.pagerUrl.replace('{PAGE}', this.navi.page);
            }
            this.navi.last = this.navi.pagerUrl.replace('{PAGE}', this.navi.pages-1);
        }
    }

    scrapPoll() {
        fnDebug('this.scrapPoll()');
        const poll = {
            title: this.$('div.panel').children('div.inner').children('div.content').children('h2').text(),
            options: [],
            n_voters: 0,
            n_votes: 0,
        };
        if (poll.title && poll.title.length > 0) {
            const pollBody = this.$('fieldset.polls').children('dl');
            pollBody.each((i, p) => {
                const optionBody = this.$(p);
                const option = {
                    text: optionBody.children('dt').text(),
                    votes: optionBody.children('dd.resultbar').text(),
                    percents: optionBody.children('dd').last().text().replace('%','')
                };
                const numbersRegExp = /Celkem hlasujících : (\d+) - Celkem hlasů : (\d+)/;
                const matches = numbersRegExp.exec(option.votes);
                if (matches && matches.length > 0) {
                    poll.n_voters = matches[1];
                    poll.n_votes = matches[2];
                } else {
                    poll.options.push(option);
                }
            });
        }
        this.poll = poll;
    }

    scrapThread() {
        fnDebug('this.scrapThread()');
        this.scrapRules();
        this.scrapPoll();
        this.phpbbid = ForumScrapper.threadIdFromUrl(this.url);
        this.title = this.$('div#page-body').children("h2").text();
        this.$('.post').each((i, p) => {
            const postBody = this.$(p).children('div.inner').children('div.postbody');
            const postProfileBody = this.$(p).children('div.inner').children('dl.postprofile');
            const titleLink = postBody.children('h3').children('a');
            let authorBody = postBody.children('p.author');
            let authorLink;
            let authorUrl;
            let authorName;
            let created;
            let likes;

            if (authorBody.length > 0) {
                const authorLink = authorBody.children('strong').children('a');
                const likesBody = postBody.children('div.content').last().children('dl.postbody').children('dd').children('a');
                likes = [];
                likesBody.each((j, a) => {
                    likes.push({
                        user: this.rebase(this.$(a).attr('href')),
                        username: this.$(a).text()
                    });
                });
                created = this.convertCreatedDate(authorBody);
                authorUrl = this.rebase(authorLink.attr('href'));
                authorName = authorLink.text();
                if (!authorUrl) {
                    authorName = authorBody.children('strong').children('span').text();
                    authorUrl = 'unregistered:' + ForumScrapper.normalizeString(authorName);
                }
            }

            authorBody = postProfileBody.children('dt');
            authorLink = authorBody.children('a');
            if (!authorName || !(authorName.length > 0)) {
                authorUrl = this.rebase(authorLink.attr('href'));
                authorName = authorLink.text();
            }
            if (authorBody.hasClass('author')) {
                created = this.convertCreatedDate(authorBody.next());
            }

            const postUrl = titleLink.attr('href') || ''
            const post = {
                phpbbid: ForumScrapper.postIdFromUrl(titleLink.attr('href')),
                url: this.rebase(postUrl.replace(/\?[^#]*/, '')),
                title: titleLink.text(),
                user: this.rebase(authorUrl),
                username: authorName,
                created: created,
                content: postBody.children('div.content').first().html(),
                likes: likes
            };
            if (post['content'] && post['content'].length > 0) {
                post['content'] = post['content']
                    .replace(new RegExp(this.originBase, 'g'), this.base)
                    .replace(new RegExp('https://ipx.pirati.cz/http', 'g'), 'http')
                    .replace(new RegExp('src="images', 'g'), 'src="/images');
            }

            if (post.phpbbid) {
                this.posts.push(post);
            }
        });
    }

    rebase(url) {
        if (!url) return null;
        return url.replace(new RegExp('^'+this.originBase), this.base);
    }

    static normalizeString(s) {
        return removeDiacritics(s.toLowerCase().replace(/@/g, ''))
            .replace(/\s/g, '-').replace(/-+/g, '-');
    }

    makeGroupUrl(id, name) {
        if (id === 2) {
            name = 'registered';
        }
        const url = URL.parse(this.url);
        return url.protocol + '//' +
            url.host + '/' + ForumScrapper.normalizeString(name) +
            '-g' + id + '.html';
    }

    static forumIdFromUrl(url) {
        const re = /-f(\d+)\/?(page\d+\.html)?$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static threadIdFromUrl(url) {
        const re = /-t(\d+)(-\d+)?\.html$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static userIdFromUrl(url) {
        const re = /-u(\d+)\/?$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static groupIdFromUrl(url) {
        const re = /-g(\d+)(-\d+)?\.html$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static postIdFromUrl(url) {
        const re = /#p(\d+)$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static postId(hash) {
        let id = hash;
        if (id) {
            id = '' + id;
            if (id.length > 0) {
                return +id.replace(/^p/, '');
            }
        }
        return null;
    }

    static month(m) {
        return {
            'led': '01',
            'úno': '02',
            'bře': '03',
            'dub': '04',
            'kvě': '05',
            'čer': '06',
            'črc': '07',
            'srp': '08',
            'zář': '09',
            'říj': '10',
            'lis': '11',
            'pro': '12'
        }[m];
    }

    static parseDate(date) {
        const c = date.split(/ /);
        if (c.length > 1) {
            return c[2].replace(',', '') + '-' + ForumScrapper.month(c[1]) + '-' + c[0] + ' ' + c[3];
        }
        return null;
    }

    convertCreatedDate(authorBody) {
        const createdBody = authorBody.clone();
        createdBody.children().each((i, e) => {
            this.$(e).remove();
        });
        return ForumScrapper.parseDate(createdBody.text().replace(/od  » /, ''));
    }

    initCache(httpRequestCache) {
        fnDebug('this.initCache(' + (httpRequestCache) ? 'injected httpRequestCache' : '' + ')');

        if (!httpRequestCache) {
            httpRequestCache = new RequestHttpCache({
                backend: 'redis',
                redis: {
                    host: '127.0.0.1',
                    port: '6379'
                },
                ttl: 86400
            });
        }
        ForumScrapper.httpRequestCache = httpRequestCache;

        const requestWithFakeResponseHeaders = (options, callback) => {
            defaultRequest(options, (error, response, body) => {
                /*
                              if (!error && response && response.headers) {
                                  response.headers.etag = (new Date(new Date().toJSON().slice(0, 10) + ' 00:00:00')).getTime();
                                  response.headers['pragma'] = '';
                                  response.headers['cache-control'] = "max-age=86400";
                                  response.headers['expires'] = Date.now() + 86400;
                              }
                               */
                callback(error, response, body);
            });
        };

        this.request = requestExt({
            request: requestWithFakeResponseHeaders,
//            extensions: [ForumScrapper.httpRequestCache.extension]
        });
    }

    static login(loginUrl, username, password) {
        fnDebug('ForumScrapper.login("%s", "%s", "%s")', loginUrl, username, '***invisible***');
        return new Promise((resolve, reject) => {
            if (!username || !password || !loginUrl) resolve(null);
            defaultRequest({
                url: loginUrl,
                method: 'POST',
                form: {
                    username: username,
                    password: password,
                    viewonline: 'on',
                    login: 'Přihlásit se'
                }
            }, (error, response, body) => {
                if (error) {
                    debug(error);
                    reject(error);
                }
                resolve(response);
            });
        });
    }

    static quit() {
        fnDebug('ForumScrapper.quit()');
        if (ForumScrapper.httpRequestCache) {
            ForumScrapper.httpRequestCache.backend.redisClient.quit()
        }
    }
}

ForumScrapper.request = defaultRequest;

module.exports = ForumScrapper;