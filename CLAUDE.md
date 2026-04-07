# Feedstock

High-performance web crawler and scraper for TypeScript, powered by Bun and Playwright.

## Architecture

- **Runtime**: Bun (uses native SQLite, test runner, TypeScript execution)
- **Browser**: Playwright (Chromium by default) or Lightpanda (local/cloud via CDP)
- **HTML parsing**: Cheerio
- **Markdown**: Turndown

## Project Structure

```
src/
├── index.ts              # Public API exports
├── crawler.ts            # Main WebCrawler class
├── config.ts             # BrowserConfig, CrawlerRunConfig
├── models.ts             # CrawlResult, CrawlResponse, etc.
├── browser/
│   └── manager.ts        # Browser lifecycle & session management
├── strategies/
│   ├── crawler-strategy.ts    # Playwright-based page fetching
│   ├── scraping-strategy.ts   # HTML → clean content + links/media
│   ├── markdown.ts            # HTML → Markdown conversion
│   └── extraction/
│       ├── base.ts            # ExtractionStrategy interface
│       ├── css.ts             # CSS selector extraction
│       └── regex.ts           # Regex extraction
├── cache/
│   ├── mode.ts           # CacheMode enum
│   └── database.ts       # bun:sqlite cache layer
└── utils/
    ├── logger.ts         # Logging
    └── html.ts           # HTML utilities
```

## Commands

- `bun test` — run all tests
- `bun test tests/unit` — unit tests only
- `bun test tests/integration` — integration tests only
- `bun run typecheck` — type-check without emitting

## Browser Backends

- **Playwright** (default) — launches Chromium/Firefox/WebKit locally
- **Lightpanda local** — launches `@lightpanda/browser` and connects via CDP
- **Lightpanda cloud** — connects to Lightpanda Cloud via CDP WebSocket

Set via `backend` in `BrowserConfig`:
```typescript
// Playwright (default)
createBrowserConfig({ backend: { kind: "playwright" } })

// Lightpanda local
createBrowserConfig({ backend: { kind: "lightpanda", mode: "local" } })

// Lightpanda cloud
createBrowserConfig({ backend: { kind: "lightpanda", mode: "cloud", token: "..." } })
```

## Conventions

- Strategy pattern for swappable components (extraction, scraping, markdown)
- Config objects with typed defaults using `Partial<Config>` input pattern
- All browser work is async, using Playwright's native TS API
- `@lightpanda/browser` is an optional dependency — only needed for local Lightpanda mode
- Tests use Bun's built-in test runner (`bun:test`)
