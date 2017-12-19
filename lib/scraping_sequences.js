"use strict";

const debug = require('debug')('scraping_sequences');

const Scrapper = require('./scrapper');

class Sequence {
    constructor(queue, state = null) {
        this.queue = queue;
        this.state = state || {};
        this.state.id = this.state.id || 0;
        this.state.max_id = this.state.max_id || null;
    }
    discoveredId(id) {
        if (this.state.max_id === null || id > this.state.max_id) {
            this.state.max_id = id;
        }
    }
    next() {
        return new Promise((resolve) => {
            resolve(this.state.url_template.replace('{ID}', this.state.id));
        });
    }
    inc() {
        // debug('sequence inc %d++', this.state.id);
        if (this.state.max_id !== null && this.state.id >= this.state.max_id) {
            this.state.id = 0;
            return false;
        }
        this.state.id++;
        return true;
    }
    toJson() {
        return this.state;
    }
}

class RedirectSequence extends Sequence {
    next() {
        return new Promise((resolve, reject) => {
            super.next().then((url) => {
                debug('HEAD %s', url);
                if (url !== null) {
                    Scrapper
                        .getRedirectLocation(url)
                        .then((url) => {
                            // debug('redirect location: "%s"', url);
                            this.queue.updateScrapInterval(null);
                            resolve(url);
                        })
                        .catch((err) => {
                            // debug('redirect error: "%o"', err);
                            this.queue.updateScrapInterval(err);
                            resolve('control:retry');
                        });
                }
            }).catch(reject);
        })
    }
}

class PostsSequence extends Sequence {
    next() {
        return new Promise((resolve, reject) => {
            super.next().then((url) => {
                // debug('redirect check url: "%s"', url);
                if (url !== null && url !== 'control:retry') {
                    // get post's bbcode content
                    Scrapper.scrapPost(
                        this.queue.originBase +
                        '/ucp.php?i=pm&mode=compose&action=quotepost&p=' +
                        this.state.id
                    ).then((content) => {
                        if (content.length > 0) {
                            this.queue.db.save_post_content(this.state.id, content);
                        }
                    }).catch((err) => {
                        this.queue.isBackendError(err);
                        debug('scrap post error: "%o"', err);
                    });
                }
                resolve(url);
            }).catch(reject);
        })
    }
}

module.exports.Sequence = Sequence;
module.exports.RedirectSequence = RedirectSequence;
module.exports.PostsSequence = PostsSequence;
