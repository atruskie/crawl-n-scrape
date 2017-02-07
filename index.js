'use strict';
const chalk = require('chalk');
const logSymbols = require('log-symbols');
const hardRejection = require('hard-rejection')();
const jsonfile = require('jsonfile');
const mkdirp = require('mkdirp');
const path = require('path');
const crawl = require('./crawl');
const capture = require('./capture');

module.exports = crawlAndShot;

const defaults = {
    routeDecisions: [],
    blacklist: ["delete", "post", "sign out", "log out", "download"],
    cookie: null,
    url: null,
    verbose: false,
    delay: 15,
    outputDir: './scrape-n-crawl_' + +(new Date),
    inputSitemap: null,
    additionalUrls: [],
    pageres: {
        sizes: ['1920x1080'],
        crop: false,
        timeout: 360,
        filename: '<%= url %>-<%= size %>',
        incrementalName: false,
        format: 'png',

    }
};


function crawlAndShot(options, complete) {
    options = Object.assign({}, defaults, options);

    if (!options.url) {
        complete(new Error("A url must be specified to crawl"));
    }
    options.blacklist = options.blacklist.map((x) => new RegExp(x, 'i'));

    var outputDir = path.resolve(options.outputDir);
    mkdirp(outputDir);
    options.outputDir = outputDir;
    var sitemapFile = path.join(outputDir, 'sitemap.json');


    var sitemap;
    if (options.inputSitemap) {
        loadState(path.resolve(options.inputSitemap), startCapture);

    }
    else {
        crawl(options, completedCrawl);
    }

    function loadState(path, callback) {
        console.log(logSymbols.info + (' Loading previously generated sitemap '), path);

        jsonfile.readFile(path, {}, (error, data) => {
            if (error) {
                throw error;
            }

            sitemap = data;
            callback(error);
        })
    }

    function completedCrawl(error, _sitemap) {
        if (error) {
            throw error;
        }

        sitemap = _sitemap;

        console.log(logSymbols.success + chalk.green(' Completed crawl'));

        console.log(logSymbols.success + chalk.green(' Writing links as JSON to: ') + sitemapFile);
        jsonfile.writeFile(sitemapFile, sitemap, {spaces: 2}, startCapture);

    }

    function startCapture(error) {
        if (error) {
            throw error;
        }
        console.log(logSymbols.info + (' Beginning capture'));

        if (options.additionalUrls) {
            for(let item of options.additionalUrls) {
                sitemap.push({
                    url: item
                });
            }
        }

        capture(sitemap, options, finished);

    }

    function finished(error, _sitemap) {
        if (error) {
            throw error;
        }
        console.log(logSymbols.success + chalk.green(' Completed capture '));

        console.log(logSymbols.success + chalk.green(' Writing updated links as JSON to: ') + sitemapFile);
        sitemap = _sitemap;
        jsonfile.writeFile(sitemapFile, sitemap, {spaces: 2}, function () {
            // end program
            console.log(logSymbols.success + chalk.green(' Completed all phases! Done!'));
        });
    }
}

