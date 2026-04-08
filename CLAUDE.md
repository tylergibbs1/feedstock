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
├── config-loader.ts      # Layered config: feedstock.json + FEEDSTOCK_* env vars
├── models.ts             # CrawlResult, CrawlResponse, etc.
├── browser/
│   └── manager.ts        # Browser lifecycle, session management, retry with backoff
├── strategies/
│   ├── crawler-strategy.ts    # Playwright-based page fetching
│   ├── scraping-strategy.ts   # HTML → clean content + links/media
│   ├── markdown.ts            # HTML → Markdown conversion
│   └── extraction/
│       ├── base.ts            # ExtractionStrategy interface
│       ├── accessibility.ts   # Accessibility tree extraction
│       ├── css.ts             # CSS selector extraction
│       └── regex.ts           # Regex extraction
├── cli/
│   ├── index.ts          # CLI entry point + command router
│   ├── parse-args.ts     # Hand-rolled argument parser (no deps)
│   ├── output.ts         # JSON/NDJSON/text output formatting
│   ├── errors.ts         # Structured JSON error handling
│   ├── schema.ts         # Declarative command schema registry
│   └── commands/         # crawl, crawl-many, deep-crawl, process, schema, cache, monitor
├── cache/
│   ├── mode.ts           # CacheMode enum
│   └── database.ts       # bun:sqlite cache layer with content hashing
└── utils/
    ├── logger.ts         # Logging
    ├── html.ts           # HTML utilities
    ├── cursor-interactive.ts  # Cursor-based interactive element detection
    └── resource-blocker.ts    # Resource blocking profiles (fast/minimal/media-only)
```

## Commands

- `bun test` — run all tests
- `bun test tests/unit` — unit tests only
- `bun test tests/integration` — integration tests only
- `bun run typecheck` — type-check without emitting

## Browser Backends

- **Playwright** (default) — launches Chromium/Firefox/WebKit locally
- **CDP** — connects to any browser via CDP WebSocket (Browserbase, Browserless, etc.)
- **Lightpanda local** — launches `@lightpanda/browser` and connects via CDP
- **Lightpanda cloud** — connects to Lightpanda Cloud via CDP WebSocket

Set via `backend` in `BrowserConfig`:
```typescript
// Playwright (default)
createBrowserConfig({ backend: { kind: "playwright" } })

// Generic CDP (any cloud provider)
createBrowserConfig({ backend: { kind: "cdp", wsUrl: "ws://..." } })

// Lightpanda local
createBrowserConfig({ backend: { kind: "lightpanda", mode: "local" } })

// Lightpanda cloud
createBrowserConfig({ backend: { kind: "lightpanda", mode: "cloud", token: "..." } })
```

## Configuration

Config can be set programmatically, via `feedstock.json` project file, or via `FEEDSTOCK_*` env vars. Precedence: programmatic > env vars > project file > defaults.

```typescript
import { loadConfig, createBrowserConfig, createCrawlerRunConfig } from "feedstock";

const layered = loadConfig(); // loads feedstock.json + env vars
const browserConfig = createBrowserConfig({ ...layered.browser, ...myOverrides });
```

Key env vars: `FEEDSTOCK_CDP_URL`, `FEEDSTOCK_HEADLESS`, `FEEDSTOCK_PROXY`, `FEEDSTOCK_BLOCK_RESOURCES`, `FEEDSTOCK_PAGE_TIMEOUT`

## Conventions

- Strategy pattern for swappable components (extraction, scraping, markdown)
- Config objects with typed defaults using `Partial<Config>` input pattern
- All browser work is async, using Playwright's native TS API
- `@lightpanda/browser` is an optional dependency — only needed for local Lightpanda mode
- Tests use Bun's built-in test runner (`bun:test`)
