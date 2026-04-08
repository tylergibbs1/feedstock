# Getting Started with Feedstock

A practical guide to crawling and scraping with Feedstock. All examples are copy-paste ready and use the real API.

---

## Installation

Feedstock runs on [Bun](https://bun.sh) and uses Playwright for browser automation.

```bash
bun add feedstock
bunx playwright install chromium
```

If you plan to use Firefox or WebKit instead of Chromium, install them the same way:

```bash
bunx playwright install firefox
bunx playwright install webkit
```

---

## Your First Crawl

Create a `WebCrawler`, call `crawl()` with a URL, and close when done:

```typescript
import { WebCrawler, CacheMode } from "feedstock";

const crawler = new WebCrawler();

const result = await crawler.crawl("https://example.com", {
  cacheMode: CacheMode.Bypass,
});

if (result.success) {
  // Markdown content
  console.log(result.markdown?.rawMarkdown);

  // Markdown with citation links
  console.log(result.markdown?.markdownWithCitations);

  // Internal and external links
  console.log(result.links.internal); // LinkItem[] — { href, text, title, baseDomain }
  console.log(result.links.external);

  // Images, videos, audio
  console.log(result.media.images); // MediaItem[] — { src, alt, type, score, ... }
  console.log(result.media.videos);

  // Page metadata (Open Graph, Twitter Cards, JSON-LD, etc.)
  console.log(result.metadata);

  // HTTP details
  console.log(result.statusCode);
  console.log(result.responseHeaders);
} else {
  console.error(result.errorMessage);
}

await crawler.close();
```

The `CrawlResult` object contains everything extracted from the page: raw HTML, cleaned HTML, markdown, links, media, metadata, and optional fields like screenshots, PDFs, and accessibility snapshots.

---

## Crawling Multiple Pages

Use `crawlMany` to crawl a list of URLs concurrently:

```typescript
import { WebCrawler, CacheMode } from "feedstock";

const crawler = new WebCrawler();

const urls = [
  "https://example.com/page-1",
  "https://example.com/page-2",
  "https://example.com/page-3",
  "https://example.com/page-4",
  "https://example.com/page-5",
];

const results = await crawler.crawlMany(
  urls,
  { cacheMode: CacheMode.Bypass },
  { concurrency: 3 },
);

for (const result of results) {
  console.log(`${result.url} — ${result.success ? "ok" : result.errorMessage}`);
}

await crawler.close();
```

The `concurrency` option (default: 5) controls how many pages are fetched in parallel. Each URL is processed independently -- if one fails, the others still complete.

---

## Processing Raw HTML

Use `processHtml` to extract content from HTML you already have, without launching a browser:

```typescript
import { WebCrawler } from "feedstock";

const crawler = new WebCrawler();

const html = `
<html>
  <body>
    <h1>Hello World</h1>
    <p>Some content here.</p>
    <a href="https://example.com">A link</a>
    <img src="photo.jpg" alt="A photo" />
  </body>
</html>
`;

const result = await crawler.processHtml(html, {
  snapshot: true,
  generateMarkdown: true,
});

console.log(result.markdown?.rawMarkdown);
// # Hello World
//
// Some content here.
//
// [A link](https://example.com)

console.log(result.links.external);
// [{ href: "https://example.com", text: "A link", ... }]

console.log(result.media.images);
// [{ src: "photo.jpg", alt: "A photo", type: "image", ... }]

console.log(result.snapshot);
// @e1 [heading] "Hello World" [level=1]
// @e2 [paragraph] "Some content here."
// ...
```

You can pass an optional third argument to set the base URL used for resolving relative links:

```typescript
const result = await crawler.processHtml(html, {}, "https://example.com/page");
```

---

## Configuration

Feedstock has two config objects: **BrowserConfig** for the browser instance and **CrawlerRunConfig** for per-crawl behavior.

### Browser Config

Passed when constructing `WebCrawler`. Controls which browser to use, viewport, proxy, stealth mode, and more.

```typescript
import { WebCrawler } from "feedstock";

const crawler = new WebCrawler({
  config: {
    browserType: "chromium",  // "chromium" | "firefox" | "webkit"
    headless: true,
    viewport: { width: 1920, height: 1080 },
    stealth: true,            // randomize user-agent, override navigator.webdriver
    proxy: {
      server: "http://proxy.example.com:8080",
      username: "user",
      password: "pass",
    },
    extraArgs: ["--disable-gpu"],
  },
  verbose: true,
});
```

All fields are optional. Unspecified fields use sensible defaults (Chromium, headless, 1920x1080, no proxy, no stealth).

### Crawl Run Config

Passed per-crawl to `crawl()`, `crawlMany()`, or `processHtml()`. Controls caching, timeouts, content extraction, resource blocking, and more.

```typescript
import { CacheMode } from "feedstock";

const result = await crawler.crawl("https://example.com", {
  // Caching
  cacheMode: CacheMode.Bypass,       // Skip cache entirely

  // Timeouts
  pageTimeout: 30_000,               // 30 seconds
  navigationWaitUntil: "load",       // "commit" | "domcontentloaded" | "load" | "networkidle"

  // Content
  generateMarkdown: true,
  snapshot: true,                     // Accessibility snapshot
  screenshot: true,                   // Base64 screenshot

  // Performance
  blockResources: "fast",            // "fast" | "minimal" | "media-only" | boolean | custom

  // Anti-bot
  simulateUser: true,                // Random mouse movements + scrolling

  // Tags
  excludeTags: ["nav", "footer"],    // Strip these tags before extraction
  includeTags: ["article", "main"],  // Keep only these tags
});
```

You can also build config objects explicitly with the factory functions:

```typescript
import { createBrowserConfig, createCrawlerRunConfig, CacheMode } from "feedstock";

const browserConfig = createBrowserConfig({
  headless: false,
  stealth: true,
});

const crawlConfig = createCrawlerRunConfig({
  cacheMode: CacheMode.Bypass,
  blockResources: "fast",
  pageTimeout: 30_000,
});
```

---

## Browser Backends

Feedstock supports three browser backend types, set via the `backend` field in browser config.

### Playwright (Default)

Launches a local Chromium, Firefox, or WebKit instance via Playwright:

```typescript
const crawler = new WebCrawler({
  config: {
    backend: { kind: "playwright" },
    browserType: "chromium", // or "firefox", "webkit"
  },
});
```

This is the default -- you do not need to specify `backend` at all if using Playwright.

### Generic CDP (Cloud Browsers)

Connect to any browser that exposes a Chrome DevTools Protocol WebSocket -- Browserbase, Browserless, or any other CDP-compatible provider:

```typescript
const crawler = new WebCrawler({
  config: {
    backend: {
      kind: "cdp",
      wsUrl: "wss://cloud.browserbase.com/v1/sessions/abc123",
    },
  },
});
```

You can also set this via the `FEEDSTOCK_CDP_URL` environment variable:

```bash
export FEEDSTOCK_CDP_URL="wss://cloud.browserbase.com/v1/sessions/abc123"
```

### Lightpanda

A lightweight browser engine. Available in local mode (requires the `@lightpanda/browser` package) or cloud mode.

**Local:**

```bash
bun add @lightpanda/browser
```

```typescript
const crawler = new WebCrawler({
  config: {
    backend: { kind: "lightpanda", mode: "local" },
  },
});
```

**Cloud:**

```typescript
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

---

## Layered Configuration

Feedstock loads config from multiple sources. Precedence (highest wins):

1. **Programmatic overrides** -- values passed directly to `createBrowserConfig()` / `createCrawlerRunConfig()`
2. **Environment variables** -- `FEEDSTOCK_*` prefixed
3. **Project config file** -- `feedstock.json` in the current directory or any parent
4. **Built-in defaults**

### Project Config File

Create a `feedstock.json` in your project root:

```json
{
  "browser": {
    "headless": true,
    "stealth": true,
    "browserType": "chromium"
  },
  "crawl": {
    "blockResources": "fast",
    "pageTimeout": 30000,
    "generateMarkdown": true
  }
}
```

### Environment Variables

| Variable | Maps to |
|---|---|
| `FEEDSTOCK_BROWSER_TYPE` | `browser.browserType` |
| `FEEDSTOCK_HEADLESS` | `browser.headless` |
| `FEEDSTOCK_USER_AGENT` | `browser.userAgent` |
| `FEEDSTOCK_STEALTH` | `browser.stealth` |
| `FEEDSTOCK_VERBOSE` | `browser.verbose` |
| `FEEDSTOCK_TEXT_MODE` | `browser.textMode` |
| `FEEDSTOCK_CDP_URL` | `browser.backend` (sets `{ kind: "cdp", wsUrl: ... }`) |
| `FEEDSTOCK_PROXY` | `browser.proxy.server` |
| `FEEDSTOCK_PROXY_USERNAME` | `browser.proxy.username` |
| `FEEDSTOCK_PROXY_PASSWORD` | `browser.proxy.password` |
| `FEEDSTOCK_PAGE_TIMEOUT` | `crawl.pageTimeout` |
| `FEEDSTOCK_SCREENSHOT` | `crawl.screenshot` |
| `FEEDSTOCK_BLOCK_RESOURCES` | `crawl.blockResources` (`"true"`, `"false"`, or a profile name) |
| `FEEDSTOCK_GENERATE_MARKDOWN` | `crawl.generateMarkdown` |

### Using the Config Loader

```typescript
import {
  loadConfig,
  createBrowserConfig,
  createCrawlerRunConfig,
  WebCrawler,
} from "feedstock";

// Loads feedstock.json + env vars, merged together
const layered = loadConfig();

// Apply your programmatic overrides on top
const browserConfig = createBrowserConfig({
  ...layered.browser,
  headless: false, // override for local dev
});

const crawlConfig = createCrawlerRunConfig({
  ...layered.crawl,
  cacheMode: CacheMode.Bypass,
});

const crawler = new WebCrawler({ config: browserConfig });
const result = await crawler.crawl("https://example.com", crawlConfig);
```

The `loadConfig()` function searches for `feedstock.json` starting from the current working directory and walking up to the filesystem root. You can specify a different starting directory:

```typescript
const layered = loadConfig({ startDir: "/path/to/project" });
console.log(layered.configPath); // path to the feedstock.json that was found, or null
```

---

## Lifecycle

### Auto-start

You do not need to call `start()` manually. The first call to `crawl()`, `crawlMany()`, or `deepCrawl()` will auto-start the crawler if it has not been started yet:

```typescript
const crawler = new WebCrawler();
// No start() needed -- this triggers auto-start
const result = await crawler.crawl("https://example.com");
await crawler.close();
```

### Explicit Start

If you want to control when the browser launches (for example, to front-load the startup cost), call `start()` yourself:

```typescript
const crawler = new WebCrawler();
await crawler.start(); // launches browser now
// ... later ...
const result = await crawler.crawl("https://example.com");
await crawler.close();
```

Calling `start()` multiple times is safe -- it returns immediately if already started.

### Closing

Always call `close()` when you are done to shut down the browser and release resources:

```typescript
await crawler.close();
```

Calling `close()` on an already-closed crawler is safe.

### Graceful Shutdown

Feedstock automatically registers `SIGINT` and `SIGTERM` handlers when the crawler starts. If the process receives a termination signal, the browser is shut down cleanly. The handlers are removed when you call `close()`.

For scripts where you want to guarantee cleanup regardless of errors, use a try/finally block:

```typescript
const crawler = new WebCrawler();

try {
  const result = await crawler.crawl("https://example.com");
  // ... process result ...
} finally {
  await crawler.close();
}
```
