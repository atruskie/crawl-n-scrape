# crawl-n-shot
Create a visual map of a website by crawling and then screenshoting all user accessible pages

# Why?

Create a visual snapshot of a website for archiving purposes.
This can be particularly useful for complex sites that are hard to restore from
previous version of a source code base.

# How?

Uses PhantomJS to first crawl through all accessible pages and then
again uses PhantomJS (via [Pageres](https://github.com/sindresorhus/pageres))
to render the pages.

## Node dependency

Needs NodeJS v6.9.1 or greater.

## Example usage

```
const crawlAndShot = require('./index.js');

crawlAndShot({
        url: 'https://www.example.org',
        cookie: '_example_org_Session...',
        verbose: false,
        outputDir: './results',
        // screen shot any additional URLs not gathered from crawling
        additionalUrls: [
            'http://subdomain.example.org/contact.html'
        ],
        routeDecisions: [
            {
                // specifically allow crawling user 113's profile
                match: /^\/user_accounts\/113.*/,
                allow: true
            },
            {
                // but do not crawl any other user's profile
                match: /^\/user_accounts\/(\d+).*/,
                allow: false
            },
            {
                // this will allow the standard search page to be crawled
                // but won't crawl to every page of the search results
                match: /^\/search\?.*page=.*/,
                allow: false
            },
            {
                // this allows only the first 10 links to single blog posts
                // to be crawled. With many items this allows for a snapshot
                // of different pages with different content, without capturing
                // the entire site
                match: /^\/posts\/(\d+).*/,
                limit: 10
            },
        ]
    },
    function (error) {
        if (error) {
            throw error;
        }
        console.log("Process complete");
    });
```

## Default options


```
const defaults = {
    // limit expoential crawling with regex patterns
    routeDecisions: [],
    // HTML anchors with text in their body matching the blacklist will be ignored
    blacklist: ["delete", "post", "sign out", "log out", "download"],
    cookie: null,
    // the target site
    url: null,
    // enable PhantomJS logging
    verbose: false,
    // The amount of time to wait for a page to render
    delay: 15,
    // Directory to save results
    outputDir: './scrape-n-crawl_' + +(new Date),
    // Skip crawling and use a previously generated sitemap
    inputSitemap: null,
    // Additional URLs to screenshot that the crawler did not detect
    additionalUrls: [],
    // Options for Pagres
    pageres: {
        sizes: ['1920x1080'],
        crop: false,
        timeout: 360,
        filename: '<%= url %>-<%= size %>',
        incrementalName: false,
        format: 'png',

    }
};
```

# What?

**WARNING**: Hyper dodgy code. Use at your own risk.

Advantages to the solution:

- Almost all webpages can be rendered faithfully (including pages
  that rely on client rendered content)
- Decent and customisable _route decisions_ stop exponential spidering
  (useful for ensuring that every page/screen is visited)
- User credentials can be supplied


There are several drawbacks to the current solution:

- Most pages are rendered twice
- The process is RAM heavy
- Naive, and hardcoded detection for client-side rendered content
  - currently only supports detecting AngularJS
- **There is the chance that server state can be affected**
  - IF you have any route that is not idempotent on GET requests
    it is strongly recommended you not use this library
  - Do not provide admin credentials to this script
- There are no unit tests
- The code is messy

# Future work (PRs welcome)

- CLI
- Unit tests
- Code cleanup
- More stable Phantom implementation (often runs out of RAM)
- Better Phantom solution
- Only render pages once in Phantom (not twice, one in spidering and one in capturing)
- NPM publish
- CI testing