const debug = require('debug')('database_init');

class DatabaseInit {

    constructor(client) {
        this.client = client;
    }

    init() {
        return new Promise((resolve, reject) => {
            const init_queries = [ `
                SET TIME ZONE 'Europe/Prague'
                ` ];
            const promises = [];
            this.client.connect().then(() => {
                init_queries.forEach((query) => {
                    promises.push(this.client.query(query));
                });
                return Promise.all(promises);
            }).then(resolve).catch((err) => {
                debug('Database connect error "%o"', err);
                reject(err);
            });
        })
    }

}
module.exports = DatabaseInit;