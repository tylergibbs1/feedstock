# Performance Optimization Guide

This guide covers every lever feedstock exposes for faster, more efficient crawling. Each section explains the mechanism, when to use it, and provides working code against the real API.

---

## 1. The Engine System

Feedstock uses a multi-engine architecture. By default, a lightweight HTTP fetch runs first. If the page needs more capability, the system escalates to a full Playwright browser automatically.

### How fetch-first works

When you create a `WebCrawler` with the default `useEngines: true`, the `EngineManager` registers two engines sorted by quality score:

| Engine      | Quality | Capabilities                     |
|-------------|---------|----------------------------------|
| `fetch`     | 5       | None (no JS, no screenshots)     |
| `playwright`| 50      | JS, screenshots, PDFs, wait conditions, custom JS |

The manager tries engines in ascending quality order. `fetch` runs first because it is the cheapest -- a single HTTP request with no browser overhead.

```ts
import { WebCrawler } from "feedstock";

// Default: useEngines is true, fetch-first is enabled
const crawler = new WebCrawler();
const result = await crawler.crawl("https://example.com");
await crawler.close();
```

The `FetchEngine` retries transient network errors (ECONNRESET, ETIMEDOUT, EPIPE) up to 2 times with exponential backoff.

### When auto-escalation triggers

Two conditions cause the engine manager to skip the fetch result and try the next engine:

**SPA detection.** After fetch succeeds with a 2xx status, `likelyNeedsJavaScript()` inspects the HTML for:

- A `<body>` with fewer than 50 characters of text content (after stripping scripts and tags)
- Empty SPA root divs: `<div id="root"></div>`, `<div id="app"></div>`, `<div id="__next"></div>`, `<div id="__nuxt"></div>`
- Global state markers: `window.__INITIAL_STATE__`, `window.__NEXT_DATA__`, `window.__NUXT__`

If any of these match, the fetch response is discarded and Playwright renders the page.

**Anti-bot block detection.** If fetch returns a 401, 403, 429, or 503 status code and the response body matches known block patterns (via `isBlocked()`), the engine manager escalates to a browser engine, which is more likely to pass bot checks.

### Controlling the engine system

```ts
// Disable fetch-first: always use Playwright directly
const crawler = new WebCrawler({
  engineConfig: { fetchFirst: false },
});

// Disable auto-escalation: use whatever fetch returns
const crawler = new WebCrawler({
  engineConfig: { autoEscalate: false, autoEscalateOnBlock: false },
});

// Disable engines entirely: use Playwright for everything
const crawler = new WebCrawler({ useEngines: false });
```

When you know every URL is a static page (documentation sites, blogs, sitemaps), fetch-first gives you the biggest speed win -- no browser launch, no rendering overhead.

When you know every URL is a JavaScript SPA, disable engines entirely to avoid the wasted fetch round-trip.

---

## 2. Resource Blocking Profiles

When Playwright is used, feedstock can block unnecessary network requests at the browser context level. This reduces page load time and bandwidth.

### Built-in profiles

| Profile       | Blocks                                         | Keeps           |
|---------------|-------------------------------------------------|-----------------|
| `"fast"`      | Images, fonts, media (video/audio)              | CSS, JS, HTML   |
| `"minimal"`   | Images, fonts, media, CSS, stylesheets          | JS, HTML        |
| `"media-only"`| Images, video, audio                            | CSS, fonts, JS  |

```ts
import { createCrawlerRunConfig } from "feedstock";

// Block images and fonts for faster loads
const config = createCrawlerRunConfig({ blockResources: "fast" });

// Block everything except HTML and JS
const config = createCrawlerRunConfig({ blockResources: "minimal" });

// Only block heavy media files
const config = createCrawlerRunConfig({ blockResources: "media-only" });

// Boolean shorthand: true = "fast" profile
const config = createCrawlerRunConfig({ blockResources: true });
```

### Custom profiles

For fine-grained control, pass an object with glob patterns and/or resource types:

```ts
const config = createCrawlerRunConfig({
  blockResources: {
    patterns: ["**/*.{png,jpg,gif,webp,woff2}"],
    resourceTypes: ["font", "media", "image"],
  },
});
```

Resource types follow Playwright's `Request.resourceType()` values: `document`, `stylesheet`, `image`, `media`, `font`, `script`, `texttrack`, `xhr`, `fetch`, `eventsource`, `websocket`, `manifest`, `other`.

### When to use each profile

- **`"fast"`** -- General purpose. Good default for content extraction where you need CSS for layout-dependent scraping but not visual assets.
- **`"minimal"`** -- Maximum speed when using Playwright. Use when you only need the DOM text and JS has finished rendering. CSS is blocked, so layout-dependent extraction may break.
- **`"media-only"`** -- Use when you need CSS for accurate rendering (e.g., screenshots of text content) but want to skip heavy media downloads.
- **Custom** -- Use when a site loads large third-party scripts you can block by pattern (e.g., analytics, ads).

Resource blocking only applies when Playwright is the active engine. If the fetch engine handles the request, no resources are loaded beyond the initial HTML.

---

## 3. Navigation Strategies

The `navigationWaitUntil` option controls when Playwright considers a page "loaded." This directly affects how long each page takes.

### Options (fastest to slowest)

| Strategy             | What it waits for                                        |
|----------------------|----------------------------------------------------------|
| `"commit"`           | HTTP response headers received (no rendering)            |
| `"domcontentloaded"` | HTML parsed, deferred scripts executed (default)         |
| `"load"`             | All resources (images, stylesheets, subframes) loaded    |
| `"networkidle"`      | No network requests for 500ms                            |

### Benchmarking guidance

Typical relative timings for a content-heavy page:

- `"commit"`: ~100-300ms -- fastest, but DOM may be incomplete for JS-heavy pages
- `"domcontentloaded"`: ~300-800ms -- good balance, works for most content extraction
- `"load"`: ~800-3000ms -- waits for all images/resources, necessary for screenshots
- `"networkidle"`: ~2000-10000ms -- waits for all async requests to settle, use only for SPAs that lazy-load content

```ts
import { createCrawlerRunConfig } from "feedstock";

// Fastest: just get the initial HTML
const config = createCrawlerRunConfig({ navigationWaitUntil: "commit" });

// Default: wait for DOM to be ready
const config = createCrawlerRunConfig({ navigationWaitUntil: "domcontentloaded" });

// Full page load with all resources
const config = createCrawlerRunConfig({ navigationWaitUntil: "load" });

// Wait for all network activity to stop (slowest)
const config = createCrawlerRunConfig({ navigationWaitUntil: "networkidle" });
```

### Combining with wait conditions

For SPAs that load content after initial render, use `"domcontentloaded"` with a targeted `waitFor` instead of `"networkidle"`:

```ts
const config = createCrawlerRunConfig({
  navigationWaitUntil: "domcontentloaded",
  waitFor: { kind: "selector", value: "[data-loaded]", timeout: 5000 },
});
```

This is faster than `"networkidle"` because it stops waiting as soon as the specific content appears, rather than waiting for all network activity to cease.

---

## 4. Caching

Feedstock caches crawl results in a SQLite database at `~/.feedstock/cache.db` using Bun's native SQLite driver with WAL mode for concurrent read performance.

### Cache modes

| Mode          | Reads cache | Writes cache | Use case                                    |
|---------------|-------------|--------------|---------------------------------------------|
| `Enabled`     | Yes         | Yes          | Default. Full caching.                      |
| `Disabled`    | No          | No           | Always fetch fresh. Testing / debugging.    |
| `ReadOnly`    | Yes         | No           | Serve from cache, never update it.          |
| `WriteOnly`   | No          | Yes           | Always fetch fresh but populate cache.      |
| `Bypass`      | No          | No           | Same as Disabled.                           |

```ts
import { CacheMode, createCrawlerRunConfig } from "feedstock";

// Default: full caching
const config = createCrawlerRunConfig({ cacheMode: CacheMode.Enabled });

// Always fresh
const config = createCrawlerRunConfig({ cacheMode: CacheMode.Disabled });

// Warm the cache without reading stale entries
const config = createCrawlerRunConfig({ cacheMode: CacheMode.WriteOnly });
```

### Content hashing for incremental crawls

Every cached entry stores a fast content hash of the cleaned HTML. Use `hasChanged()` to detect whether a page has new content without comparing full HTML strings:

```ts
import { CrawlCache, contentHash } from "feedstock";

const cache = new CrawlCache();

// After crawling, check if content actually changed
const result = await crawler.crawl(url);
const hash = contentHash(result.cleanedHtml ?? result.html);

if (cache.hasChanged(url, hash)) {
  // Content is new or different -- process it
  console.log("Page changed:", url);
} else {
  // Content identical to last crawl -- skip processing
  console.log("No change:", url);
}

cache.close();
```

This is useful for recurring crawls of sites like documentation or news feeds. You crawl every page but only re-process the ones that actually changed.

### Batch writes

For bulk crawls, `setMany()` wraps all inserts in a single SQLite transaction, which is significantly faster than individual `set()` calls:

```ts
const cache = new CrawlCache();
const entries = results.map((r) => ({
  url: r.url,
  result: JSON.stringify(r),
  contentHash: contentHash(r.cleanedHtml ?? r.html),
}));
cache.setMany(entries);
cache.close();
```

### Cache maintenance

```ts
const cache = new CrawlCache();

// Remove entries older than 7 days
const removed = cache.pruneOlderThan(7 * 24 * 60 * 60 * 1000);
console.log(`Pruned ${removed} stale entries`);

// Check cache size
console.log(`Cache contains ${cache.size} entries`);

cache.close();
```

---

## 5. Concurrent Crawling

`crawlMany` runs multiple URLs in parallel with a configurable concurrency limit.

```ts
const crawler = new WebCrawler();

const urls = [
  "https://docs.example.com/intro",
  "https://docs.example.com/guide",
  "https://docs.example.com/api",
  // ... hundreds of URLs
];

// Default concurrency: 5
const results = await crawler.crawlMany(urls);

// Higher concurrency for static sites
const results = await crawler.crawlMany(urls, {}, { concurrency: 20 });

// Lower concurrency for rate-limited sites
const results = await crawler.crawlMany(urls, {}, { concurrency: 2 });

await crawler.close();
```

### Tuning concurrency

- **Static sites via fetch engine**: concurrency of 10-50 is safe. Each request is a lightweight HTTP call.
- **Playwright-rendered pages**: concurrency of 3-5 is typical. Each concurrent page consumes browser memory (roughly 50-150MB per tab).
- **Rate-limited APIs or sites with anti-bot**: concurrency of 1-3. Higher concurrency triggers blocks faster.

All concurrent crawls share the same engine manager and cache instance, so cache hits are served without engine overhead even at high concurrency.

---

## 6. Text Mode and Headless

### Text mode

Setting `textMode: true` in the browser config disables image rendering in the browser. This reduces memory consumption and speeds up page rendering when you only need text content.

```ts
import { WebCrawler, createBrowserConfig } from "feedstock";

const crawler = new WebCrawler({
  config: { textMode: true, headless: true },
});
```

Text mode is a browser-level optimization that complements resource blocking. Resource blocking prevents network requests; text mode tells the browser not to decode and render images even if they were loaded.

### Headless mode

Headless mode (`headless: true`) is the default. It runs the browser without a visible window, which is faster and uses less memory. Only set `headless: false` for debugging or when a site actively detects headless browsers.

### When to disable rendering entirely

If you do not need JavaScript rendering at all, the fetch engine is always faster than any Playwright configuration. The combination of `useEngines: true` with `fetchFirst: true` (both defaults) already handles this automatically for static pages.

For guaranteed no-browser crawling, disable engines and use the fetch engine directly:

```ts
import { FetchEngine } from "feedstock";

const engine = new FetchEngine({ userAgent: "my-bot/1.0" });
await engine.start();
const response = await engine.fetch("https://example.com", createCrawlerRunConfig());
await engine.close();
```

---

## 7. Realistic Example: Fast Documentation Scraper

This example combines every optimization for maximum throughput on a documentation site (static HTML, no JS required, many pages).

```ts
import {
  WebCrawler,
  CacheMode,
  CrawlCache,
  contentHash,
  createCrawlerRunConfig,
} from "feedstock";

async function scrapeDocsSite(urls: string[]) {
  // 1. Use fetch-first engine system (default) -- no browser for static pages
  const crawler = new WebCrawler({
    config: { textMode: true, headless: true },
    verbose: false,
  });

  // 2. Configure for maximum speed
  const config = createCrawlerRunConfig({
    // Use commit navigation -- fastest, just get the HTML
    navigationWaitUntil: "commit",

    // Block all non-essential resources if Playwright is triggered
    blockResources: "minimal",

    // Enable caching so repeated runs are instant
    cacheMode: CacheMode.Enabled,

    // Only generate markdown, skip screenshots/PDFs/network capture
    generateMarkdown: true,
    screenshot: false,
    pdf: false,
    captureNetworkRequests: false,
    captureConsoleMessages: false,

    // Lower timeout for fast-responding doc sites
    pageTimeout: 15_000,
  });

  // 3. Crawl with high concurrency (safe for static sites via fetch engine)
  const results = await crawler.crawlMany(urls, config, { concurrency: 20 });

  // 4. Incremental processing -- only handle changed pages
  const cache = new CrawlCache();
  const changed = results.filter((r) => {
    if (!r.success) return false;
    const hash = contentHash(r.cleanedHtml ?? r.html);
    return cache.hasChanged(r.url, hash);
  });

  console.log(`Crawled ${results.length} pages, ${changed.length} changed`);

  // 5. Process only changed pages
  for (const result of changed) {
    console.log(`Processing: ${result.url}`);
    console.log(result.markdown?.rawMarkdown?.slice(0, 200));
  }

  cache.close();
  await crawler.close();
}

// Usage
const docUrls = Array.from(
  { length: 50 },
  (_, i) => `https://docs.example.com/page-${i}`,
);
await scrapeDocsSite(docUrls);
```

### Why this is fast

1. **Fetch engine handles static pages** -- no browser launched at all for most documentation sites.
2. **`"commit"` navigation** -- if Playwright is triggered (SPA escalation), it returns as soon as headers arrive.
3. **`"minimal"` resource blocking** -- if Playwright runs, it skips images, CSS, fonts, and media.
4. **Concurrency of 20** -- the fetch engine can safely handle many parallel HTTP requests.
5. **Caching** -- second run serves everything from SQLite, no network at all.
6. **Content hashing** -- only re-process pages whose content actually changed.
7. **No unnecessary captures** -- screenshots, PDFs, and network logging are all disabled.

---

## 8. Benchmarking

Feedstock includes a benchmark suite at `benchmarks/bench.ts` for measuring cache and hashing performance.

### Running benchmarks

```bash
# Run all benchmark scenarios
bun run benchmarks/bench.ts

# Output results as JSON (for CI or tracking over time)
bun run benchmarks/bench.ts --json

# Run only cache-related scenarios
bun run benchmarks/bench.ts cache

# Run only contentHash scenarios
bun run benchmarks/bench.ts contentHash
```

### Available scenarios

| Scenario               | What it measures                          |
|------------------------|-------------------------------------------|
| `cache:write-100`      | Writing 100 entries via `setMany()`       |
| `cache:write-1000`     | Writing 1000 entries via `setMany()`      |
| `cache:read-100`       | Reading 100 entries via `get()`           |
| `cache:hasChanged-100` | Checking 100 hashes via `hasChanged()`    |
| `contentHash:10kb`     | Hashing 10KB content (Bun.hash/wyhash)    |
| `contentHash:100kb`    | Hashing 100KB content (Bun.hash/wyhash)   |

### Output format

Each scenario reports:

- **avg** -- mean duration in milliseconds
- **p50** -- median duration
- **stddev** -- standard deviation (lower is more consistent)
- **iterations** -- number of measured runs (warmup runs excluded)

```
Running cache:write-100... avg=1.23ms p50=1.15ms +/-0.18ms (10 runs)
Running cache:read-100...  avg=0.45ms p50=0.42ms +/-0.05ms (20 runs)
```

### Writing custom scenarios

Add scenarios to the `scenarios` array in `benchmarks/bench.ts`:

```ts
const scenarios: Scenario[] = [
  // ... existing scenarios ...
  {
    name: "crawl:fetch-static",
    iterations: 10,
    warmup: 2,
    setup: async () => {
      // Start a local test server or use a known static URL
    },
    run: async () => {
      const crawler = new WebCrawler();
      await crawler.crawl("http://localhost:8080/static-page");
      await crawler.close();
    },
  },
];
```

### Tips for reliable benchmarks

- Run benchmarks on an idle machine. Background processes add noise.
- Use `--json` output to track performance across commits.
- The warmup phase (default 2 iterations) ensures JIT compilation and cache warming do not skew results.
- For crawl benchmarks, use a local server to eliminate network variance.
