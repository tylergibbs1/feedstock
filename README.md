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
- **Content extraction** — CSS selectors, regex, XPath, table, and accessibility tree extraction
- **Markdown generation** with citation support
- **Smart caching** with ETag/Last-Modified validation via `bun:sqlite`
- **URL filtering** — pattern, domain, and content-type filters
- **URL scoring** — keyword relevance, path depth, freshness, domain authority
- **Rate limiting** — per-domain with exponential backoff
- **Robots.txt** parsing and compliance
- **Built-in stealth mode** — one flag enables random user-agents, navigator.webdriver override, plugin/language spoofing, human-like mouse/scroll simulation
- **Anti-bot detection** with auto-retry on blocked pages
- **Multiple browser backends** — Playwright (Chromium/Firefox/WebKit), generic CDP (Browserbase, Browserless, etc.), or [Lightpanda](https://lightpanda.io) (local/cloud)
- **Proxy rotation** — round-robin strategy with health tracking
- **URL seeding** — discover URLs from sitemaps
- **Accessibility snapshots** — compact semantic page representation with `@e` refs for AI consumption
- **Fetch-first engine system** — tries lightweight HTTP before launching browser, auto-escalates for SPAs
- **Rich metadata** — 50+ fields: Open Graph, Twitter Cards, Dublin Core, JSON-LD, favicons, feeds
- **Content processing** — chunking (regex, sliding window, fixed-size) and filtering (pruning, BM25)
- **Interactive element detection** — finds all clickable elements including cursor:pointer and onclick handlers
- **Storage state persistence** — save/load cookies and localStorage between sessions
- **AI-friendly errors** — converts 20+ error patterns into actionable messages
- **Hooks** — inject custom behavior at 5 lifecycle points (page created, before/after navigation, etc.)
- **Resource blocking** — named profiles (`fast`, `minimal`, `media-only`) or custom patterns for faster crawls
- **Navigation strategies** — configurable `waitUntil`: `commit` (fastest), `domcontentloaded`, `load`, `networkidle`
- **In-page extraction** — extract links/media/metadata directly in the browser via `page.evaluate()`, skipping HTML serialization
- **Change tracking** — detect new/changed/unchanged/removed pages between crawl runs with text diffs
- **User-agent rotation** — pool of 9 realistic browser user-agents with round-robin rotation
- **Graceful shutdown** — SIGINT/SIGTERM handlers auto-close browser processes
- **Session management** — LRU eviction at 20 concurrent sessions, cache TTL pruning
- **Input validation** — friendly error messages for invalid URLs, automatic retry on transient network errors
- **Layered config** — `feedstock.json` project file + `FEEDSTOCK_*` environment variables with programmatic overrides
- **Incremental crawling** — content hashing in cache detects unchanged pages via `cache.hasChanged()`
- **Benchmarking** — scenario-based benchmark suite with warmup, p50/stddev stats, and JSON output
- **Crawler monitoring** — real-time stats tracking (pages/sec, success rates, data volume) with live Bun.serve dashboard
- **Configurable logging** — pluggable Logger interface with ConsoleLogger and SilentLogger
- **Agent-first CLI** — JSON output by default, runtime schema introspection (`feedstock schema`), `--fields` for context window discipline, `--dry-run`, structured errors

## CLI

Agent-first CLI with JSON output by default when piped, runtime schema introspection, and structured errors.

```bash
# Install globally
bun add -g feedstock
bunx playwright install chromium

# Single page
feedstock crawl https://example.com
feedstock crawl https://example.com --fields url,markdown --output json

# Batch crawl
echo "https://a.com\nhttps://b.com" | feedstock crawl-many --stdin --concurrency 10

# Deep crawl a docs site
feedstock deep-crawl https://docs.example.com --max-depth 3 --max-pages 50 --domain-filter docs.example.com

# Process raw HTML
echo '<h1>Hello</h1>' | feedstock process --fields markdown

# Agent introspection — discover all parameters
feedstock schema crawl

# Cache management
feedstock cache stats
feedstock cache prune --older-than 86400000
```

All commands support `--output json|ndjson|text`, `--fields` for context window discipline, and `--json` for raw config passthrough. See `feedstock --help` or `feedstock schema <command>` for full details.

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

### Generic CDP (any cloud provider)

```typescript
const crawler = new WebCrawler({
  config: {
    backend: { kind: "cdp", wsUrl: "wss://cloud.browserbase.com/v1/sessions/..." },
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

## Stealth Mode

One flag — random user-agents, navigator overrides, and human simulation:

```typescript
// Enable stealth at browser level
const crawler = new WebCrawler({
  config: { stealth: true },
});

// Human simulation per-crawl
const result = await crawler.crawl(url, {
  simulateUser: true, // random mouse movements + scrolling
});
```

```typescript
// Auto-retry on blocks
import { withRetry, isBlocked } from "feedstock";

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

## Resource Blocking & Fast Navigation

```typescript
// Named profile — block images, fonts, and media (keeps CSS/JS)
await crawler.crawl(url, { blockResources: "fast" });

// Block everything except HTML and JS
await crawler.crawl(url, { blockResources: "minimal" });

// Block only heavy media (images, video, audio)
await crawler.crawl(url, { blockResources: "media-only" });

// Custom — block specific patterns and resource types
await crawler.crawl(url, {
  blockResources: { patterns: ["**/*.woff2"], resourceTypes: ["font"] },
});

// Boolean still works (true = "fast" profile)
await crawler.crawl(url, {
  blockResources: true,
  navigationWaitUntil: "commit", // fastest — returns as soon as server responds
});
```

## In-Page Extraction

Extract data directly in the browser — skips HTML serialization round-trip:

```typescript
import { extractInPage } from "feedstock";

crawler.setHook("beforeReturnHtml", async (page) => {
  const data = await extractInPage(page);
  // data.links, data.media, data.metadata — extracted inside browser context
});
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

## Accessibility Snapshots

Compact semantic page representation — 3-10x smaller than HTML:

```typescript
const result = await crawler.crawl("https://example.com", {
  snapshot: true,
});

console.log(result.snapshot);
// @e1 [heading] "Example Domain" [level=1]
// @e2 [link] "More information..." [-> https://www.iana.org/domains/example]
```

## Hooks

Inject custom behavior at key lifecycle points:

```typescript
crawler.setHook("afterGoto", async (page) => {
  // Dismiss cookie banners, expand sections, etc.
  const banner = page.locator('[class*="cookie"]');
  if (await banner.isVisible()) await banner.locator("button").first().click();
});
```

Available hooks: `onPageCreated`, `beforeGoto`, `afterGoto`, `onExecutionStarted`, `beforeReturnHtml`.

## Interactive Element Detection

Find all clickable elements including those without ARIA roles:

```typescript
import { detectInteractiveElements } from "feedstock";

crawler.setHook("beforeReturnHtml", async (page) => {
  const elements = await detectInteractiveElements(page);
  console.log(`Found ${elements.length} interactive elements`);
  // Each has: tag, text, href, role, type, selector
});
```

## Storage State

Persist cookies/localStorage between sessions:

```typescript
import { saveStorageState, loadStorageState } from "feedstock";

// Save after login
await saveStorageState(page.context());

// Load in next session
const state = loadStorageState();
```

## Layered Configuration

Config is loaded from multiple sources with clear precedence: programmatic > env vars > project file > defaults.

```typescript
import { loadConfig, createBrowserConfig, createCrawlerRunConfig } from "feedstock";

// Automatically finds feedstock.json in cwd or parent directories
const layered = loadConfig();
const browserConfig = createBrowserConfig({ ...layered.browser, headless: false });
const crawlConfig = createCrawlerRunConfig({ ...layered.crawl });
```

**feedstock.json:**
```json
{
  "browser": { "headless": true, "stealth": true },
  "crawl": { "blockResources": "fast", "pageTimeout": 30000 }
}
```

**Environment variables:** `FEEDSTOCK_CDP_URL`, `FEEDSTOCK_HEADLESS`, `FEEDSTOCK_PROXY`, `FEEDSTOCK_BLOCK_RESOURCES`, `FEEDSTOCK_PAGE_TIMEOUT`, `FEEDSTOCK_SCREENSHOT`, `FEEDSTOCK_GENERATE_MARKDOWN`, etc.

## Accessibility Extraction

Extract semantic content using the accessibility tree — headings, links, buttons, inputs:

```typescript
const result = await crawler.crawl("https://example.com", {
  extractionStrategy: {
    type: "accessibility",
    params: { roles: ["heading", "link"] }, // optional filter
  },
});

const items = JSON.parse(result.extractedContent!);
// [{ content: "Page Title", metadata: { role: "heading", ref: "e1", level: 1 } }, ...]
```

## Process HTML Without Browser

```typescript
const html = "<html><body><h1>Hello</h1><p>World</p></body></html>";
const result = await crawler.processHtml(html, { snapshot: true });
console.log(result.markdown?.rawMarkdown);
console.log(result.snapshot);
```

## Documentation

Full documentation at [feedstockai.com](https://www.feedstockai.com/).

## Development

```bash
bun install
bun test              # 325 tests
bun test tests/unit   # unit tests only
bun run typecheck     # tsc --noEmit
bun run lint          # biome check
bun run check         # lint + typecheck
bun run dogfood.ts    # 148 checks against real sites
```

## License

Apache-2.0
