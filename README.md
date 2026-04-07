# Feedstock

High-performance web crawler and scraper for TypeScript, powered by [Bun](https://bun.sh) and [Playwright](https://playwright.dev).

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
- **Anti-bot detection** with automatic retry
- **Multiple browser backends** — Playwright (Chromium/Firefox/WebKit) or Lightpanda (local/cloud)
- **Proxy rotation** — round-robin strategy with health tracking
- **URL seeding** — discover URLs from sitemaps
- **Crawler monitoring** — real-time stats tracking

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

```typescript
import { WebCrawler, FilterChain, DomainFilter, RateLimiter } from "feedstock";

const crawler = new WebCrawler();

const results = await crawler.deepCrawl(
  "https://example.com",
  { cacheMode: CacheMode.Bypass },
  {
    maxDepth: 3,
    maxPages: 100,
    filterChain: new FilterChain()
      .add(new DomainFilter({ allowed: ["example.com"] })),
    rateLimiter: new RateLimiter({ baseDelay: 500 }),
  },
);
```

## CSS Extraction

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
        { name: "tags", selector: ".tag", type: "list" },
      ],
    },
  },
});
```

## Lightpanda Backend

```typescript
const crawler = new WebCrawler({
  config: {
    backend: { kind: "lightpanda", mode: "local" },
  },
});
```

## Documentation

Full documentation at the [feedstock-docs](https://github.com/tylergibbs1/feedstock-docs) repo.

## Development

```bash
bun install
bun test              # run all tests
bun test tests/unit   # unit tests only
bun run typecheck     # tsc --noEmit
bun run lint          # biome check
```

## License

Apache-2.0
