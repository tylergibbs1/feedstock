# Deep Crawling Guide

Feedstock supports recursive deep crawling out of the box. Starting from a single URL, the crawler discovers links, filters them, optionally scores and prioritizes them, and continues until it reaches a depth or page limit. This guide covers every piece of the deep crawl system with realistic code examples.

All imports below come from the `feedstock` package root:

```typescript
import {
  WebCrawler,
  FilterChain,
  DomainFilter,
  URLPatternFilter,
  ContentTypeFilter,
  MaxDepthFilter,
  CompositeScorer,
  KeywordRelevanceScorer,
  PathDepthScorer,
  RateLimiter,
  RobotsParser,
  URLSeeder,
} from "feedstock";
```

---

## 1. Basic deep crawl

`deepCrawl` returns all results at the end. Pass `maxDepth` and `maxPages` through the third argument (partial `DeepCrawlConfig`).

```typescript
const crawler = new WebCrawler({ verbose: true });

const results = await crawler.deepCrawl(
  "https://docs.example.com",
  {}, // CrawlerRunConfig overrides (empty = defaults)
  {
    maxDepth: 3,   // follow links up to 3 hops from the start URL
    maxPages: 50,  // stop after 50 pages total
  },
);

for (const result of results) {
  if (result.success) {
    console.log(result.url, result.markdown?.rawMarkdown?.length, "chars");
  }
}

await crawler.close();
```

**Defaults** (from `createDeepCrawlConfig`):

| Option | Default |
|---|---|
| `maxDepth` | 3 |
| `maxPages` | 100 |
| `concurrency` | 5 |
| `stream` | false |

The crawler uses a BFS (breadth-first) strategy by default. When a `scorer` is provided in the config, it automatically switches to BestFirst (priority-queue) strategy.

---

## 2. Streaming results

For large crawls, waiting for all results wastes memory. `deepCrawlStream` is an async generator that yields each `CrawlResult` as soon as the page is crawled.

```typescript
const crawler = new WebCrawler();

const stream = crawler.deepCrawlStream(
  "https://docs.example.com",
  { generateMarkdown: true },
  { maxDepth: 4, maxPages: 200 },
);

let count = 0;
for await (const result of stream) {
  count++;
  if (result.success) {
    // Write to disk, push to a queue, index in a database -- whatever you need
    console.log(`[${count}] ${result.url}`);
  }
}

await crawler.close();
```

Streaming works with every crawl strategy (BFS, DFS, BestFirst). Results arrive in traversal order.

---

## 3. Filtering

Filters control which discovered URLs get added to the crawl queue. Every filter extends the abstract `URLFilter` class and implements a `test(url)` method.

### DomainFilter

Restrict crawling to specific domains, or block specific domains.

```typescript
const domainFilter = new DomainFilter({
  allowed: ["docs.example.com", "api.example.com"],
});

// Or block certain domains while allowing everything else:
const blockFilter = new DomainFilter({
  blocked: ["ads.example.com", "tracking.example.com"],
});
```

### URLPatternFilter

Include or exclude URLs matching glob-like patterns or regular expressions. Patterns support `*` (single segment wildcard), `**` (multi-segment wildcard), and `?` (single character). You can also pass `RegExp` objects directly.

```typescript
const patternFilter = new URLPatternFilter({
  include: [/\/docs\//, /\/api\//],       // only crawl docs and API pages
  exclude: [/\/changelog/, /\?page=\d+/], // skip changelogs and pagination
});
```

If `include` patterns are provided, a URL must match at least one of them. If a URL matches any `exclude` pattern, it is rejected regardless of include patterns.

### ContentTypeFilter

Reject URLs that point to non-HTML resources based on file extension. The default configuration blocks common binary formats (images, videos, PDFs, archives, fonts, etc.) and allows HTML-like extensions.

```typescript
// Use defaults -- blocks .jpg, .png, .pdf, .zip, etc.
const contentFilter = new ContentTypeFilter();

// Or customize:
const customFilter = new ContentTypeFilter({
  allowedExtensions: ["html", "htm", ""],
  blockedExtensions: ["pdf", "zip", "exe"],
});
```

### MaxDepthFilter

Enforce a maximum crawl depth. This filter requires a reference to the `depths` map that the crawl strategy maintains internally. In most cases, you set `maxDepth` on the `DeepCrawlConfig` directly and the strategy enforces it. Use `MaxDepthFilter` in a `FilterChain` when you need depth limits as part of a composed filter pipeline.

```typescript
const depths = new Map<string, number>();
const depthFilter = new MaxDepthFilter(2, depths);
```

### FilterChain composition

A `FilterChain` runs multiple filters in sequence with short-circuit rejection. If any filter rejects a URL, the chain stops and returns `false`.

```typescript
const filterChain = new FilterChain([
  new DomainFilter({ allowed: ["docs.example.com"] }),
  new ContentTypeFilter(),
  new URLPatternFilter({
    exclude: [/\/archive\//, /\?print=true/],
  }),
]);

// Pass it to deepCrawl:
const results = await crawler.deepCrawl(
  "https://docs.example.com",
  {},
  {
    maxDepth: 3,
    maxPages: 100,
    filterChain,
  },
);
```

After the crawl, you can inspect filter statistics and denial records:

```typescript
// Per-filter pass/reject counts
console.log(filterChain.getStats());
// { "domain": { total: 150, passed: 120, rejected: 30 }, ... }

// Every rejected URL with reason
const denials = filterChain.getDenials();
for (const d of denials) {
  console.log(`${d.filter}: ${d.url} -- ${d.reason}`);
}

// Grouped by filter
console.log(filterChain.getDenialsByFilter());
```

---

## 4. Scoring and prioritization

When you provide a `scorer` in the deep crawl config, the crawler switches from BFS to a **BestFirst** strategy. Discovered URLs are scored and the highest-scoring URL is crawled next.

### KeywordRelevanceScorer

Scores URLs based on keyword matches in the URL path and the anchor text of the link that pointed to it.

```typescript
const keywordScorer = new KeywordRelevanceScorer(
  ["api", "reference", "guide", "tutorial"],
  1.5, // weight (default 1.0)
);
```

The score is `matchCount / totalKeywords`, so a URL containing 3 out of 4 keywords scores 0.75.

### PathDepthScorer

Prefers shallower URLs. A URL with fewer path segments scores higher.

```typescript
const pathScorer = new PathDepthScorer(
  10,  // maxPathDepth -- paths with 10+ segments score 0
  1.0, // weight
);
```

The score is `1 - (segmentCount / maxPathDepth)`, clamped to [0, 1].

### CompositeScorer

Combines multiple scorers using weighted averaging.

```typescript
const scorer = new CompositeScorer([
  new KeywordRelevanceScorer(["api", "reference", "guide"], 2.0),
  new PathDepthScorer(8, 1.0),
]);

// Or build incrementally:
const scorer2 = new CompositeScorer();
scorer2.add(new KeywordRelevanceScorer(["setup", "install"]));
scorer2.add(new PathDepthScorer());
```

The final score is `sum(score_i * weight_i) / sum(weight_i)`.

### Other scorers

- **FreshnessScorer** -- looks for date patterns in URLs (e.g. `/2025/03/`). More recent dates score higher. URLs with no date signal score 0.3.
- **DomainAuthorityScorer** -- boosts URLs from preferred domains. Exact match scores 1.0, subdomains score 0.8, everything else 0.3.

### Using a scorer with deep crawl

```typescript
const results = await crawler.deepCrawl(
  "https://docs.example.com",
  {},
  {
    maxDepth: 4,
    maxPages: 100,
    scorer: new CompositeScorer([
      new KeywordRelevanceScorer(["api", "reference"], 2.0),
      new PathDepthScorer(8, 1.0),
    ]),
  },
);
```

When `scorer` is set, the crawler automatically uses `BestFirstDeepCrawlStrategy` instead of `BFSDeepCrawlStrategy`.

---

## 5. Rate limiting

`RateLimiter` enforces per-domain delays with exponential backoff on 429/503 responses.

```typescript
const rateLimiter = new RateLimiter({
  baseDelay: 500,        // 500ms between requests to the same domain
  maxDelay: 30_000,      // cap backoff at 30 seconds
  backoffFactor: 2,      // double the delay on 429/503
  recoveryFactor: 0.75,  // reduce delay by 25% on each success after backoff
  jitter: 0.1,           // +/- 10% random jitter
});

const results = await crawler.deepCrawl(
  "https://docs.example.com",
  {},
  {
    maxDepth: 3,
    maxPages: 200,
    rateLimiter,
  },
);
```

The deep crawl strategies call `rateLimiter.waitIfNeeded(url)` before each request and `rateLimiter.reportResult(url, statusCode)` afterward. On a 429 or 503, the delay for that domain doubles (up to `maxDelay`). On success, it gradually recovers toward `baseDelay`.

You can also set explicit delays for a domain, for example from a robots.txt `Crawl-delay` directive:

```typescript
rateLimiter.setDelay("https://docs.example.com/anything", 2000);
```

All `RateLimiterConfig` fields are optional. Defaults:

| Field | Default |
|---|---|
| `baseDelay` | 200ms |
| `maxDelay` | 30,000ms |
| `backoffFactor` | 2 |
| `recoveryFactor` | 0.75 |
| `jitter` | 0.1 |

---

## 6. Robots.txt compliance

`RobotsParser` fetches and caches robots.txt per origin, then checks whether URLs are allowed.

```typescript
const robotsParser = new RobotsParser("feedstock");

const results = await crawler.deepCrawl(
  "https://docs.example.com",
  {},
  {
    maxDepth: 3,
    maxPages: 100,
    robotsParser,
  },
);
```

When `robotsParser` is set in the deep crawl config, every discovered URL is checked against the origin's robots.txt before it enters the crawl queue. Disallowed URLs are silently skipped.

The parser supports standard directives: `User-agent`, `Allow`, `Disallow`, `Crawl-delay`, and `Sitemap`. It handles wildcard (`*`) and end-of-URL (`$`) patterns.

### Standalone usage

You can also use the parser outside of a deep crawl:

```typescript
const parser = new RobotsParser("feedstock");
const directives = await parser.fetch("https://example.com/some/page");

if (parser.isAllowed("https://example.com/some/page", directives)) {
  console.log("OK to crawl");
}

// Check crawl delay
if (directives.crawlDelay !== null) {
  console.log(`Crawl delay: ${directives.crawlDelay} seconds`);
}

// Discover sitemaps
console.log("Sitemaps:", directives.sitemaps);
```

### Combining with rate limiting

Use the `Crawl-delay` directive to configure the rate limiter:

```typescript
const parser = new RobotsParser("feedstock");
const rateLimiter = new RateLimiter({ baseDelay: 200 });

const directives = await parser.fetch("https://docs.example.com");
if (directives.crawlDelay !== null) {
  rateLimiter.setDelay(
    "https://docs.example.com",
    directives.crawlDelay * 1000, // convert seconds to ms
  );
}

const results = await crawler.deepCrawl(
  "https://docs.example.com",
  {},
  { maxDepth: 3, rateLimiter, robotsParser: parser },
);
```

---

## 7. URL seeding

`URLSeeder` discovers starting URLs from a domain's sitemap. It follows the robots.txt -> sitemap.xml chain, handles sitemap indexes (nested sitemaps), and supports gzipped sitemaps.

```typescript
const seeder = new URLSeeder({
  timeout: 15_000,        // request timeout (default 15s)
  userAgent: "feedstock", // User-Agent header (default "feedstock")
});

const { urls, sitemaps } = await seeder.seed("docs.example.com");
console.log(`Found ${urls.length} URLs from ${sitemaps.length} sitemaps`);
```

The `seed` method:
1. Fetches `robots.txt` and extracts `Sitemap:` entries.
2. Falls back to `/sitemap.xml` if none are found.
3. Parses each sitemap (and any nested sitemap indexes) to collect all `<loc>` URLs.

You can use the discovered URLs as starting points for a multi-seed deep crawl, or filter them down and crawl directly with `crawlMany`:

```typescript
const { urls } = await seeder.seed("docs.example.com");

// Filter to just the /guides/ section
const guideUrls = urls.filter((u) => u.includes("/guides/"));

// Crawl them all (no deep crawl needed if the sitemap is comprehensive)
const results = await crawler.crawlMany(guideUrls, { generateMarkdown: true }, { concurrency: 3 });
```

---

## 8. Realistic example: crawl a documentation site

This example combines filtering, scoring, rate limiting, robots.txt compliance, and streaming to crawl a documentation site end to end.

```typescript
import {
  WebCrawler,
  FilterChain,
  DomainFilter,
  URLPatternFilter,
  ContentTypeFilter,
  CompositeScorer,
  KeywordRelevanceScorer,
  PathDepthScorer,
  RateLimiter,
  RobotsParser,
  URLSeeder,
  ConsoleLogger,
} from "feedstock";

async function crawlDocs() {
  const domain = "docs.example.com";
  const startUrl = `https://${domain}`;

  // -- Set up robots.txt compliance --
  const robotsParser = new RobotsParser("feedstock");

  // -- Set up rate limiting --
  const rateLimiter = new RateLimiter({
    baseDelay: 300,
    maxDelay: 10_000,
    backoffFactor: 2,
    recoveryFactor: 0.75,
    jitter: 0.1,
  });

  // Respect crawl-delay from robots.txt
  const directives = await robotsParser.fetch(startUrl);
  if (directives.crawlDelay !== null) {
    rateLimiter.setDelay(startUrl, directives.crawlDelay * 1000);
  }

  // -- Build a filter chain --
  const filterChain = new FilterChain([
    // Stay on the docs domain
    new DomainFilter({ allowed: [domain] }),
    // Only crawl HTML pages
    new ContentTypeFilter(),
    // Focus on specific sections, skip noise
    new URLPatternFilter({
      include: [/\/docs\//, /\/guides\//, /\/api\//],
      exclude: [/\/changelog/, /\/archive\//, /\?print=/, /\/tag\//],
    }),
  ]);

  // -- Build a scorer to prioritize relevant pages --
  const scorer = new CompositeScorer([
    new KeywordRelevanceScorer(
      ["getting-started", "tutorial", "api", "reference", "guide", "quickstart"],
      2.0,
    ),
    new PathDepthScorer(8, 1.0),
  ]);

  // -- Create the crawler --
  const crawler = new WebCrawler({
    verbose: true,
    config: { headless: true },
  });

  // -- Stream results --
  const results: Array<{ url: string; length: number }> = [];
  const stream = crawler.deepCrawlStream(
    startUrl,
    { generateMarkdown: true },
    {
      maxDepth: 4,
      maxPages: 500,
      concurrency: 3,
      filterChain,
      scorer,
      rateLimiter,
      robotsParser,
    },
  );

  for await (const result of stream) {
    if (result.success && result.markdown) {
      const markdown = result.markdown.rawMarkdown ?? "";
      results.push({ url: result.url, length: markdown.length });
      console.log(`Crawled: ${result.url} (${markdown.length} chars)`);
    } else if (!result.success) {
      console.log(`Failed:  ${result.url} -- ${result.errorMessage}`);
    }
  }

  // -- Print summary --
  console.log(`\nDone. ${results.length} pages crawled.`);
  console.log("Filter stats:", filterChain.getStats());

  const denials = filterChain.getDenials();
  if (denials.length > 0) {
    console.log(`${denials.length} URLs were filtered out.`);
  }

  await crawler.close();
}

crawlDocs();
```

### What this does

1. **Robots.txt** is fetched first. Disallowed paths are skipped, and the `Crawl-delay` directive (if present) is forwarded to the rate limiter.
2. **Rate limiting** adds a 300ms base delay between requests to the same domain, with exponential backoff on 429/503 errors.
3. **Filtering** restricts the crawl to the target domain, HTML pages only, and specific URL patterns (docs, guides, API reference). Changelogs, archives, and print views are excluded.
4. **Scoring** prioritizes pages whose URLs or anchor text contain documentation-related keywords, and favors shallower paths. Because a `scorer` is provided, the crawler uses the BestFirst strategy instead of BFS.
5. **Streaming** yields results one at a time so you can process, store, or index pages without waiting for the entire crawl to finish.
6. **Filter stats** at the end show how many URLs each filter passed and rejected, useful for tuning your filter configuration.
