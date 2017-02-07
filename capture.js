'use strict';
const Pageres = require('pageres');
const chalk = require('chalk');
const logSymbols = require('log-symbols');
const pLimit = require('p-limit');

module.exports = capture;


function capture(sitemap, options, callback) {
    let pageresOptions = Object.assign(
        {},
        options.pageres,
        {
            delay: options.delay,
            cookies: [options.cookie]
        });

    const limiter = pLimit(5);
    var promises = [];
    for (let key of Object.keys(sitemap)) {
        if (key === 'length') {
            continue;
        }

        let item = sitemap[key];

        var p = limiter(() => {
            console.log('Starting capture for item ' + item.url);
            return new Pageres(pageresOptions)
                .src(item.url, pageresOptions.sizes)
                .dest(options.outputDir)
                .on('warning', pageWarning)
                .run()
                .then((results) => {
                    let filenames = results.map(x => x.filename);
                    console.log('Finished capture for item ' + item.url, filenames);
                    item.filename =  filenames;
                    return item;
                });
        });
        promises.push(p);
    }

    Promise
        .all(promises)
        .then(() => {
            console.log('Finished all captures');
            callback(null, sitemap);
        })
        .catch((error) => {
            throw error;
        });

    function pageWarning(...args) {
        console.log(logSymbols.warning + chalk.yellow(' [pageres]'), ...args);
    }
}