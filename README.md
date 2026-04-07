<p align="center">
  <img src="logo.svg" alt="Feedstock" width="120" />
</p>

<h1 align="center">Feedstock</h1>

<p align="center">
  High-performance web crawler and scraper for TypeScript, powered by <a href="https://bun.sh">Bun</a> and <a href="https://playwright.dev">Playwright</a>.
</p>

## Features

- **Single & multi-page crawling** with concurrent execution
- **Deep crawling** — BFS, DFS, and BestFirst traversal strategies
- **Content extraction** — CSS selectors, regex, XPath, table extraction
- **Markdown generation** with citation support
- **Smart caching** with ETag/Last-Modified validation via `bun:sqlite`
- **URL filtering** — pattern, domain, and content-type filters
- **URL scoring** — keyword relevance, path depth, freshness, domain authority
- **Rate limiting** — per-domain with exponential backoff
- **Robots.txt** parsing and compliance
- **Anti-bot detection** with stealth mode, user simulation, and auto-retry
- **Multiple browser backends** — Playwright (Chromium/Firefox/WebKit) or [Lightpanda](https://lightpanda.io) (local/cloud)
- **Proxy rotation** — round-robin strategy with health tracking
- **URL seeding** — discover URLs from sitemaps
- **Content processing** — chunking (regex, sliding window, fixed-size) and filtering (pruning, BM25)
- **Crawler monitoring** — real-time stats tracking (pages/sec, success rates, data volume)

## Quick Start

```bash
bun add feedstock
bunx playwright install chromium
```

```typescript
import { WebCrawler, CacheMode } from "feedstock";

const crawler = new WebCrawler();

const result = await crawler.crawl("https://example.com", {
  cacheMode: CacheMode.Bypass,
});

console.log(result.markdown?.rawMarkdown);
console.log(result.links.internal);
console.log(result.media.images);

await crawler.close();
```

## Deep Crawling

Recursively crawl entire sites with filters, rate limiting, and robots.txt compliance:

```typescript
import {
  WebCrawler, CacheMode,
  FilterChain, DomainFilter, ContentTypeFilter, URLPatternFilter,
  RateLimiter, RobotsParser,
  CompositeScorer, KeywordRelevanceScorer, PathDepthScorer,
} from "feedstock";

const crawler = new WebCrawler();

const results = await crawler.deepCrawl(
  "https://example.com",
  { cacheMode: CacheMode.Bypass },
  {
    maxDepth: 3,
    maxPages: 100,
    concurrency: 5,
    filterChain: new FilterChain()
      .add(new DomainFilter({ allowed: ["example.com"] }))
      .add(new ContentTypeFilter())
      .add(new URLPatternFilter({ exclude: [/\/admin/, /\/login/] })),
    rateLimiter: new RateLimiter({ baseDelay: 500 }),
    robotsParser: new RobotsParser(),
    scorer: new CompositeScorer()
      .add(new KeywordRelevanceScorer(["docs", "api"], 2.0))
      .add(new PathDepthScorer()),
  },
);
```

Stream results as they arrive for large crawls:

```typescript
for await (const result of crawler.deepCrawlStream(startUrl, {}, config)) {
  console.log(`Crawled: ${result.url}`);
}
```

## Structured Extraction

### CSS Selectors

```typescript
const result = await crawler.crawl("https://example.com/products", {
  extractionStrategy: {
    type: "css",
    params: {
      name: "products",
      baseSelector: ".product",
      fields: [
        { name: "title", selector: "h2", type: "text" },
        { name: "price", selector: ".price", type: "text" },
        { name: "image", selector: "img", type: "attribute", attribute: "src" },
        { name: "tags", selector: ".tag", type: "list" },
      ],
    },
  },
});

const products = JSON.parse(result.extractedContent!)
  .map((item) => JSON.parse(item.content));
```

### Tables

```typescript
import { TableExtractionStrategy } from "feedstock";

const strategy = new TableExtractionStrategy({ minRows: 2 });
const tables = await strategy.extract(url, html);
// [{ headers: ["Name", "Age"], rows: [["Alice", "30"], ...], caption: "Users" }]
```

### Regex

```typescript
import { RegexExtractionStrategy } from "feedstock";

const strategy = new RegexExtractionStrategy([
  /\$(?<dollars>\d+)\.(?<cents>\d{2})/g,
]);
const prices = await strategy.extract(url, html);
// prices[0].metadata.groups = { dollars: "9", cents: "99" }
```

## Browser Backends

### Playwright (Default)

```typescript
const crawler = new WebCrawler({
  config: {
    browserType: "chromium", // or "firefox", "webkit"
    headless: true,
  },
});
```

### Lightpanda

```typescript
// Local (requires: bun add @lightpanda/browser)
const crawler = new WebCrawler({
  config: {
    backend: { kind: "lightpanda", mode: "local" },
  },
});

// Cloud
const crawler = new WebCrawler({
  config: {
    backend: {
      kind: "lightpanda",
      mode: "cloud",
      token: process.env.LIGHTPANDA_TOKEN!,
    },
  },
});
```

## Anti-Bot & Stealth

```typescript
import { applyStealthMode, simulateUser, withRetry, isBlocked } from "feedstock";

// Apply stealth mode
crawler.setHook("onPageCreated", async (page) => {
  await applyStealthMode(page);
});

// Simulate human behavior
crawler.setHook("afterGoto", async (page) => {
  await simulateUser(page);
});

// Auto-retry on blocks
const { result, retries } = await withRetry(
  () => crawler.crawl(url),
  (r) => isBlocked(r.html, r.statusCode ?? 200),
  { maxRetries: 3, retryDelay: 2000 },
);
```

## Proxy Rotation

```typescript
import { ProxyRotationStrategy } from "feedstock";

const rotation = new ProxyRotationStrategy([
  { server: "http://proxy1:8080" },
  { server: "http://proxy2:8080" },
  { server: "http://proxy3:8080" },
]);

const proxy = rotation.getProxy(); // round-robin, skips unhealthy
rotation.reportResult(proxy, true); // track health
```

## Content Processing

### Chunking

```typescript
import { SlidingWindowChunking, RegexChunking } from "feedstock";

// Split by paragraphs
new RegexChunking().chunk(text);

// Sliding window with overlap
new SlidingWindowChunking(500, 50).chunk(text);
```

### Content Filtering

```typescript
import { PruningContentFilter, BM25ContentFilter } from "feedstock";

// Remove boilerplate
new PruningContentFilter({ minWords: 5 }).filter(content);

// Keep only relevant blocks
new BM25ContentFilter({ threshold: 0.1 }).filter(content, "TypeScript crawler");
```

## URL Discovery

```typescript
import { URLSeeder } from "feedstock";

const seeder = new URLSeeder();
const { urls, sitemaps } = await seeder.seed("example.com");
// Discovers URLs from robots.txt -> sitemap.xml chain
```

## Monitoring

```typescript
import { CrawlerMonitor } from "feedstock";

const monitor = new CrawlerMonitor();
monitor.start();

// Track each page
monitor.recordPageComplete({
  success: true,
  fromCache: false,
  responseTimeMs: 150,
  bytesDownloaded: 45_000,
});

console.log(monitor.formatStats());
// Pages: 1 (1 ok, 0 failed, 0 cached)
// Time: 0.2s | 6.7 pages/s | avg 150ms/page
// Downloaded: 0.04 MB
```

## Process HTML Without Browser

```typescript
const html = "<html><body><h1>Hello</h1><p>World</p></body></html>";
const result = await crawler.processHtml(html);
console.log(result.markdown?.rawMarkdown);
```

## Documentation

Full documentation at [feedstock-docs](https://github.com/tylergibbs1/feedstock-docs).

## Development

```bash
bun install
bun test              # 160 tests
bun test tests/unit   # unit tests only
bun run typecheck     # tsc --noEmit
bun run lint          # biome check
bun run check         # lint + typecheck
```

## License

Apache-2.0
