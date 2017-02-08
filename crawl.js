/**
 * This file is adapted from the phantom crawler example in the node-simple crawler rep
 */
'use strict';
const phantomAPI = require('phantom');
const createPhantomPool = require('phantom-pool').default;
const Crawler = require('simplecrawler');
const chalk = require('chalk');
const phantomjs = require('phantomjs-prebuilt');
const logSymbols = require('log-symbols');
const promiseFinally = require('promise.prototype.finally');
const hardRejection = require('hard-rejection')();
const delay = require('delay');
const pLimit = require('p-limit');
const jsonfile = require('jsonfile');


// work one one domain at a time

// get urls from scraping

// if provided with cached urls use those

// otherwise scrape new
// - ignore routes that match a regex
// - also allow for route 'choosers': if route matches a url, insert a parameter, and follow down BUT do this only once

module.exports = crawl;

const phantomBin = phantomjs.path;

function crawl(options, complete) {
    var idleTime = 10 * 60; // 10 minutes

    // set up black listing
    var extensionLinks = new Set();
    var blacklistLinks = new Set();
    var routeLimiter = new Map();
    var rejectedRoutesCache = new Set();

    // create and configure crawler
    console.log(logSymbols.info + ' New crawler!');
    var crawler = new Crawler(options.url);

    crawler.interval = 200;
    crawler.maxConcurrency = 1;
    crawler.maxDepth = 0; // 0 == unlimited
    crawler.listenerTTL = idleTime * 1000; // 10 minutes
    // if set add a cookie to all requests
    if (options.cookie) {
        crawler.cookies.addFromHeaders(options.cookie);
    }

    // we're going to use phantom to discover resources rather than the inbuilt body parsing
    // normally would replace discover resources but it does support async evaluation
    crawler.discoverResources = () => {
    };
    crawler.on('fetchcomplete', discoverResources);

    // do not fetch any item with an extension
    crawler.addFetchCondition(hasExtensionFetchCondition);

    // allow us to make smart filtering decisions - we're really interested in seeing all 'screens'.
    // In cases where there are many records, this allows us to just select one to crawl into
    crawler.addFetchCondition(routeDecisionFetchCondition);

    crawler.on('fetchredirect', function (oldQueueItem, redirectQueueItem) {
        if (oldQueueItem.url == redirectQueueItem.url) {
            console.log(logSymbols.warning + chalk.yellow('Fetching %s resulted in a redirect to the same place.') +
                ' This can happen when rails detects an expired cookie', oldQueueItem.url);
        }
    });

    crawler.on('complete', completedCrawl);

    // Replace original emit so we can sample all events easily
    // and log them to console
    var originalEmit = crawler.emit;
    crawler.emit = newEmit;

    // start the run
    var phantomPool;
    let phantomArgs = ['--load-images=no', '--disk-cache=true'];
    if (options.verbose) {
        phantomArgs.push('--debug=true');
    }

    runCrawler();

    function runCrawler() {
        phantomPool = getPhantomPool(
            phantomArgs,
            {binary: phantomBin, logLevel: options.verbose ? 'debug' : 'error'},
            idleTime
        );
        console.log(logSymbols.info + ' Running crawler');
        crawler.start();
    }

    function completedCrawl() {
        console.log(
            chalk.green(`\n${logSymbols.success} Completed crawling! Discovered site map with %s links:\n`),
            chalk.magenta(crawler.queue.length));

        var items = [];
        crawler.queue.forEach((x) => {
            console.log(logSymbols.info + ' ' + x.url);
            delete x.stateData;
            items.push(x);
        });

        console.log(chalk.yellow("Killing phantom"));
        phantomPool.drain().then(() => phantomPool.clear());

        complete(null, items);

    }

    function newEmit(name, queueItem, ...args) {
        var url = '';
        if (name === 'queueduplicate') {
            originalEmit.apply(crawler, arguments);
            return;
        }

        if (queueItem) {
            if (typeof queueItem === 'string') {
                url = queueItem;
            } else if (queueItem.url) {
                url = queueItem.url;
            }
        }

        function pad(string) {
            while (string.length < 20) {
                string += ' ';
            }
            return string;
        }

        if (name.indexOf('error') >= 0) {
            console.log(chalk.red('%s') + '%s', pad(name), url, queueItem.stateData && queueItem.stateData.code || '');
        }
        else {
            console.log(chalk.cyan('%s') + '%s', pad(name), url);
        }

        originalEmit.apply(crawler, arguments);
    }

    function hasExtensionFetchCondition(queueItem, referrerQueueItem) {
        if (extensionLinks.has(queueItem.path)) {
            return false;
        }

        // If it has an extension, do not follow it
        var hasExtension = queueItem.path.match(/\.[^.\/\s]+$/i);

        if (hasExtension) {
            extensionLinks.add(queueItem.path);
            console.log(
                logSymbols.warning +
                chalk.yellow(' [discover] Url omitted because it has extension — ') + queueItem.path);
        }

        return !hasExtension;
    }

    function routeDecisionFetchCondition(queueItem, referrer) {
        var result = true;
        var path = queueItem.path;

        if (rejectedRoutesCache.has(queueItem.url)) {
            return false;
        }

        for (let route of options.routeDecisions) {
            let match = typeof(route.match) === 'string' ?
                route.match.includes(path) :
                route.match.test(path);
            if (match) {
                // allows the first n matches
                if (route.limit) {
                    if (!routeLimiter.has(route.match)) {
                        routeLimiter.set(route.match, new Set());
                    }

                    let allowed = routeLimiter.get(route.match);

                    // add the path to limited set that are allowed for this route decision
                    if (allowed.size < route.limit) {
                        allowed.add(path);
                    }

                    result = allowed.has(path);
                }
                else {
                    result = route.allow;
                }
                // break search on first match
                break;
            }
        }

        if (!result) {
            console.log(logSymbols.warning + chalk.yellow(' [routedecision] Rejected — ') + queueItem.url);
            rejectedRoutesCache.add(queueItem.url);
        }
        return result;
    }

    function discoverResources(queueItem, responseBody, responseObject) {
        console.log(logSymbols.info + ' [discover] Discovering resources — ', queueItem.url);

        let resume = this.wait();
        getLinks(queueItem)
            .then((foundLinks) => {
                //console.info(logSymbols.info + ' [discover] Found these links: - %s\n', queueItem.url, foundLinks);

                if (foundLinks) {
                    foundLinks.forEach(addUrlToQueue.bind(null, queueItem));
                }
                resume();
            });
    }

    function addUrlToQueue(referrer, {html, link}) {
        // check if any url matches the black list
        if (html) {
            if (options.blacklist.some(x => x.test(html))) {
                if (!blacklistLinks.has(link)) {
                    blacklistLinks.add(link);
                    console.log(
                        logSymbols.warning +
                        chalk.yellow(' [discover] Url omitted because body was blacklisted — ') + link);
                }
                return;
            }
        }

        // if (link.indexOf('library') < 0) {
        //     return;
        // }

        // this logic coped from simple-crawler
        if (crawler.maxDepth === 0 || referrer.depth + 1 <= crawler.maxDepth) {
            crawler.queueURL(link, referrer, false)
        }
    }


    function getLinks(queueItem) {
        console.log(chalk.green('Phantom') + ' attempting to load — ' + queueItem.url);

        var page;

        return phantomPool.use((phantom) => {
            return phantom
                .createPage()
                .then(function (_page) {
                    console.log(chalk.green('Phantom') + ' visiting page ', queueItem.url);
                    page = _page;

                    // phantom is super fussy about its cookies
                    var cookies = crawler.cookies.get(); //'_AWB_session'
                    //console.log(chalk.green('Phantom') + 'setting cookies:', cookies);
                    return Promise
                        .all(cookies.map(c => {
                            // needs to be a valid date int
                            c.expires = +(new Date((new Date().getFullYear()) + 10, 1, 1));
                            c.domain = queueItem.host;
                            return page.addCookie(c);
                        }))
                        // also https://github.com/ariya/phantomjs/issues/14047 means we can't even tell if it has worked!
                        // so query the cookie jar instead
                        .then(() => page.property('cookies'));
                })
                .then(function (cookies) {
                    //console.log(chalk.green('Phantom') + ' cookie set result', cookies);
                    if (!cookies || cookies.length === 0) {
                        throw new Error("Failed to set PhantomJS Cookies");
                    }
                    console.log(chalk.green('Phantom') + ' %s cookies set — ' + queueItem.url, chalk.magenta(cookies.length));

                    return page.open(queueItem.url);
                })
                .then(function (status) {
                    if (status !== "success") {
                        console.log(chalk.green('Phantom') + ' unable to open URL — ' + queueItem.url);
                        throw new Error('Phantom unable to open URL — ' + queueItem.url);
                    }
                    else {
                        console.log(chalk.green('Phantom') + ' opened URL with %s — ' + queueItem.url, status);
                    }

                    return delay(1000).then(()=> page.evaluate(isAngular));
                })
                .then(function (isAngular) {
                    console.log(chalk.green('Phantom') + ' page loaded is angular app? %s — ' + queueItem.url, isAngular);
                    return delay(isAngular ? options.delay * 1000 : 0);
                })
                .then(function () {
                    return page.evaluate(findPageLinks);
                })
                .then(function (result) {
                    let count = result.length === 0 ? chalk.red('0') : chalk.magenta(result.length);
                    console.log(chalk.green('Phantom') + ' discovered %s URLs from — ' + queueItem.url, count);
                    page.close();
                    return result;
                })
                .catch(function (error) {
                    console.log(chalk.green('Phantom') + chalk.red('ERROR'), error);
                    try {
                        page.close();
                    }
                    catch (error) {
                        console.log("Could not close phantom page", error);
                    }
                    throw error;
                });
        });
    }

    function getPhantomPool(phantomArgs, phantomOptions, idle) {
        const pool = createPhantomPool({
            max: 10, // default
            min: 2, // default
            // how long a resource can stay idle in pool before being removed
            idleTimeoutMillis: idle * 1000,
            // maximum number of times an individual resource can be reused before being destroyed; set to 0 to disable
            maxUses: 50, // default
            // function to validate an instance prior to use; see https://github.com/coopernurse/node-pool#createpool
            validator: () => Promise.resolve(true), // defaults to always resolving true
            // validate resource before borrowing; required for `maxUses and `validator`
            testOnBorrow: true, // default

            phantomArgs: [phantomArgs, phantomOptions]
        });

        return pool;
    }

    function findPageLinks() {
        // executed in the context of the page
        console.log('!!!!!!!Searching for links');
        var selector = document.querySelectorAll('a');
        selector = [].slice.call(selector);

        return selector
            .map(function (link) {
                var info = {
                    link: link.href || link.onclick || link.href || link.src,
                    html: link.innerHTML
                };

                if (info.link instanceof SVGAnimatedString) {
                    info.link = info.link.baseVal || undefined;
                }

                return info;
            })
            .filter(function (src) {
                return Boolean(src.link);
            });
    }

    function isAngular() {
        console.log('!!!!!!!Checking for Angular');
        return window.angular !== undefined;
    }


}

