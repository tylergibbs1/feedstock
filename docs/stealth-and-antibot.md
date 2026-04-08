# Stealth and Anti-Bot Guide

Feedstock provides a layered set of tools for avoiding bot detection, recovering
from blocks, and maintaining long-lived authenticated sessions. This guide
covers every relevant API and shows how to combine them for real-world
scraping scenarios.

---

## 1. Stealth Mode

Set `stealth: true` on your `BrowserConfig` to enable all built-in stealth
measures in a single flag:

```typescript
import { createBrowserConfig } from "feedstock";

const browser = createBrowserConfig({
  stealth: true,
});
```

When stealth mode is active, the `BrowserManager` does the following each time
it creates a new page:

1. **User-agent rotation** -- if no explicit `userAgent` is set, a realistic
   user-agent is selected at random from the built-in pool via
   `getRandomUserAgent()`.
2. **Navigator overrides** -- `applyStealthMode(page)` is called, which injects
   an init script that:
   - Sets `navigator.webdriver` to `false` (the most common bot fingerprint).
   - Defines a `window.chrome.runtime` object so the page sees a Chrome-like
     environment.
   - Overrides `navigator.permissions.query` to return `"denied"` for
     notification permission checks (a common fingerprinting vector).
   - Spoofs `navigator.plugins` to report five plugins instead of the empty
     array that headless browsers typically expose.
   - Sets `navigator.languages` to `["en-US", "en"]`.

You can also call `applyStealthMode` directly on any Playwright `Page` if you
manage pages yourself:

```typescript
import { applyStealthMode } from "feedstock";

await applyStealthMode(page);
```

### Environment variable

Stealth can also be toggled via the `FEEDSTOCK_STEALTH=true` environment
variable when using `loadEnvConfig()`.

---

## 2. Human Simulation

Some anti-bot systems track mouse movement, scroll behavior, and interaction
timing. The `simulateUser` flag on `CrawlerRunConfig` triggers realistic
interaction after the page loads:

```typescript
import { createCrawlerRunConfig } from "feedstock";

const run = createCrawlerRunConfig({
  simulateUser: true,
});
```

Under the hood, `simulateUser(page)` performs:

1. Three random mouse movements across the viewport, each interpolated over 5
   intermediate steps with randomized delays (100--300 ms).
2. A scroll down by 300 pixels, pause, then a partial scroll back up by 100
   pixels with random pauses between actions.

This is enough to satisfy many presence-detection scripts. You can also call it
directly:

```typescript
import { simulateUser } from "feedstock";

// After navigating to a page
await simulateUser(page);
```

---

## 3. Block Detection

`isBlocked(html, statusCode)` inspects a crawl response and returns `true` if
the page looks like a bot-blocking interstitial rather than real content.

```typescript
import { isBlocked } from "feedstock";

const blocked = isBlocked(html, statusCode);
```

The check has three layers:

1. **HTTP status + body keywords** -- if the status is 403, 429, or 503, the
   body is scanned (case-insensitive) for indicators like `"access denied"`,
   `"captcha"`, `"verify you are human"`, `"unusual traffic"`,
   `"rate limit"`, `"cloudflare"`, `"checking your browser"`,
   `"just a moment"`, `"bot detected"`, and others.
2. **Title patterns** -- regardless of status code, the `<title>` tag is
   tested against regex patterns for common block pages (`/access denied/i`,
   `/captcha/i`, `/attention required/i`, `/403 forbidden/i`,
   `/just a moment/i`, `/security check/i`).
3. **Suspiciously short bodies** -- a 403 or 503 response with fewer than 2000
   characters of HTML is treated as a block, since legitimate pages at those
   codes are almost always longer.

---

## 4. Auto-Retry on Blocks

`withRetry` wraps any async operation with automatic retry logic and
exponential back-off when a block is detected:

```typescript
import { withRetry, isBlocked, type RetryConfig } from "feedstock";

const { result, retries } = await withRetry(
  () => crawler.run("https://example.com"),
  (response) => isBlocked(response.html, response.statusCode),
  { maxRetries: 5, retryDelay: 3000 },
);

console.log(`Succeeded after ${retries} retries`);
```

### How it works

- The first argument is the operation to attempt.
- The second argument is a predicate that returns `true` if the result looks
  blocked.
- The optional third argument is a `Partial<RetryConfig>`:
  - `maxRetries` (default `3`) -- total retry attempts after the first try.
  - `retryDelay` (default `2000` ms) -- base delay; each retry multiplies by
    the attempt number (`retryDelay * (attempt + 1)`), giving linear back-off.
- Returns `{ result, retries }` -- the final result and how many retries were
  needed.

You can supply any check function, not just `isBlocked`. For example, checking
for a specific CSS selector that only appears on block pages:

```typescript
const { result } = await withRetry(
  () => crawler.run(url),
  (r) => r.html.includes("cf-challenge-running"),
  { maxRetries: 4, retryDelay: 5000 },
);
```

---

## 5. Proxy Rotation

`ProxyRotationStrategy` implements round-robin proxy selection with automatic
health tracking. Unhealthy proxies are skipped until they recover.

```typescript
import { ProxyRotationStrategy, type ProxyConfig } from "feedstock";

const proxies: ProxyConfig[] = [
  { server: "http://proxy-us.example.com:8080", username: "user", password: "pass" },
  { server: "http://proxy-eu.example.com:8080", username: "user", password: "pass" },
  { server: "http://proxy-ap.example.com:8080", username: "user", password: "pass" },
];

const rotation = new ProxyRotationStrategy(proxies, {
  maxFailures: 3,        // mark unhealthy after 3 consecutive failures
  recoveryInterval: 60_000, // retry unhealthy proxies after 60 seconds
});
```

### Selecting a proxy

```typescript
const proxy = rotation.getProxy();

const browser = createBrowserConfig({
  stealth: true,
  proxy,
});
```

`getProxy()` returns the next healthy proxy in round-robin order. If all
proxies are unhealthy, it falls back to the one with the lowest failure count.
Before each selection, proxies that have been unhealthy longer than
`recoveryInterval` are automatically restored.

### Reporting results

After each crawl, report whether the proxy succeeded or failed so the strategy
can track health:

```typescript
try {
  const result = await crawler.run(url);
  rotation.reportResult(proxy, !isBlocked(result.html, result.statusCode));
} catch {
  rotation.reportResult(proxy, false);
}
```

A successful report decrements the failure count (minimum 0) and marks the
proxy healthy. A failure increments the count; once it reaches `maxFailures`,
the proxy is marked unhealthy and skipped.

### Monitoring

```typescript
console.log(`${rotation.healthyCount}/${rotation.totalCount} proxies healthy`);
```

---

## 6. User-Agent Rotation

### Quick random selection

```typescript
import { getRandomUserAgent } from "feedstock";

const ua = getRandomUserAgent();
```

Returns a random user-agent from the built-in pool (Chrome/Firefox/Safari/Edge
across Windows, Mac, and Linux with recent version strings).

### Round-robin rotation

```typescript
import { UserAgentRotator } from "feedstock";

const rotator = new UserAgentRotator();

// Each call returns the next user-agent in order, wrapping around
const ua1 = rotator.next();
const ua2 = rotator.next();
```

You can supply a custom pool:

```typescript
const rotator = new UserAgentRotator([
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
]);

console.log(rotator.size); // 2
```

Note: when `stealth: true` is set and no explicit `userAgent` is provided, the
`BrowserManager` already calls `getRandomUserAgent()` for each new session. Use
`UserAgentRotator` when you want deterministic round-robin ordering or a custom
pool.

---

## 7. Session Persistence

Feedstock can save and restore cookies and localStorage across crawler
sessions, which is essential for authenticated crawling or preserving login
state between runs.

### Saving state

```typescript
import { saveStorageState } from "feedstock";

// `context` is a Playwright BrowserContext
const path = await saveStorageState(context, "./state/session.json");
console.log(`Saved to ${path}`);
```

If no path is provided, state is saved to `~/.feedstock/storage/state.json`.
The saved file contains cookies, per-origin localStorage entries, and a
`savedAt` timestamp.

### Loading state

```typescript
import { loadStorageState } from "feedstock";

const state = loadStorageState("./state/session.json");
if (state) {
  console.log(`Loaded state from ${new Date(state.savedAt).toISOString()}`);
}
```

Returns `null` if the file does not exist or cannot be parsed.

### Applying state to a context

```typescript
import { applyStorageState, loadStorageState } from "feedstock";

const state = loadStorageState("./state/session.json");
if (state) {
  await applyStorageState(context, state);
}
```

This adds all saved cookies to the context. localStorage is handled
automatically by Playwright's storage state mechanism.

### Using with Playwright context creation

`getStorageStatePath` returns the file path only if it exists, making it
convenient for conditional context creation:

```typescript
import { getStorageStatePath } from "feedstock";

const storagePath = getStorageStatePath("./state/session.json");
// storagePath is string | null -- pass to Playwright's storageState option
```

---

## 8. Consent Popup and Overlay Removal

Many sites display cookie consent banners, GDPR modals, or overlay dialogs
that obscure content. Two `CrawlerRunConfig` flags address this:

```typescript
import { createCrawlerRunConfig } from "feedstock";

const run = createCrawlerRunConfig({
  removeConsentPopups: true,   // target cookie/consent banners specifically
  removeOverlayElements: true, // broader: remove any fixed/absolute overlay
});
```

Either flag triggers the same in-page removal pass, which runs after
navigation and any custom JavaScript execution. The removal logic:

1. Queries the DOM for elements matching these selectors:
   - `[class*="cookie"]`, `[class*="consent"]`, `[class*="overlay"]`,
     `[class*="modal"]`, `[class*="popup"]`
   - `[id*="cookie"]`, `[id*="consent"]`, `[id*="overlay"]`
   - `[aria-modal="true"]`
2. For each matched element, checks the computed style. If the element has
   `position: fixed`, `position: absolute`, or `z-index > 999`, it is hidden
   via `display: none`.
3. Resets `document.body.style.overflow` to `"auto"` so that scroll-locked
   pages become scrollable again.

This runs client-side in the page context before HTML is captured, so the
scraped content is free of overlay markup.

---

## 9. Realistic Example: Scraping a Protected E-Commerce Site

This example combines stealth mode, proxy rotation, retry logic, session
persistence, user simulation, and overlay removal to crawl product pages on a
site with aggressive bot protection.

```typescript
import {
  WebCrawler,
  createBrowserConfig,
  createCrawlerRunConfig,
  ProxyRotationStrategy,
  isBlocked,
  withRetry,
  saveStorageState,
  loadStorageState,
  applyStorageState,
  type ProxyConfig,
} from "feedstock";

// --- Proxy pool ---
const proxies: ProxyConfig[] = [
  { server: "http://us-1.proxy.example.com:9000", username: "crawl", password: "secret" },
  { server: "http://us-2.proxy.example.com:9000", username: "crawl", password: "secret" },
  { server: "http://eu-1.proxy.example.com:9000", username: "crawl", password: "secret" },
];

const rotation = new ProxyRotationStrategy(proxies, {
  maxFailures: 3,
  recoveryInterval: 120_000,
});

const SESSION_FILE = "./state/ecommerce-session.json";

async function crawlProductPage(url: string) {
  // Pick the next healthy proxy
  const proxy = rotation.getProxy();

  // Browser config: stealth + proxy
  const browserConfig = createBrowserConfig({
    stealth: true,
    headless: true,
    proxy,
  });

  // Run config: simulate human, remove overlays, wait for content
  const runConfig = createCrawlerRunConfig({
    simulateUser: true,
    removeConsentPopups: true,
    removeOverlayElements: true,
    waitFor: { kind: "selector", value: ".product-title", timeout: 10_000 },
    generateMarkdown: true,
  });

  const crawler = new WebCrawler(browserConfig);

  try {
    await crawler.start();

    // Restore session cookies if available
    const savedState = loadStorageState(SESSION_FILE);
    if (savedState) {
      const context = await crawler.getContext();
      await applyStorageState(context, savedState);
    }

    // Crawl with auto-retry on blocks
    const { result, retries } = await withRetry(
      () => crawler.run(url, runConfig),
      (response) => isBlocked(response.html, response.statusCode),
      { maxRetries: 4, retryDelay: 3000 },
    );

    // Report proxy health
    const wasBlocked = isBlocked(result.html, result.statusCode);
    rotation.reportResult(proxy, !wasBlocked);

    if (wasBlocked) {
      console.error(`Blocked after ${retries} retries: ${url}`);
      return null;
    }

    console.log(`Crawled ${url} (${retries} retries, proxy: ${proxy.server})`);

    // Persist session for next run
    const context = await crawler.getContext();
    await saveStorageState(context, SESSION_FILE);

    return result;
  } finally {
    await crawler.close();
  }
}

// --- Crawl a list of product URLs ---
const urls = [
  "https://shop.example.com/product/12345",
  "https://shop.example.com/product/67890",
  "https://shop.example.com/product/11223",
];

for (const url of urls) {
  const result = await crawlProductPage(url);
  if (result?.markdown) {
    console.log(result.markdown.rawMarkdown.slice(0, 200));
  }
}

console.log(`Proxy health: ${rotation.healthyCount}/${rotation.totalCount}`);
```

### What this achieves

- **Stealth** prevents the browser from being fingerprinted as headless
  (webdriver flag, plugin count, chrome runtime object).
- **User-agent rotation** happens automatically because `stealth: true` is set
  and no explicit `userAgent` is provided.
- **Proxy rotation** distributes requests across multiple exit IPs and
  automatically sidelines proxies that trigger blocks.
- **Human simulation** adds mouse movements and scrolling before content is
  captured, satisfying interaction-based bot checks.
- **Overlay removal** strips cookie banners and modals so scraped content is
  clean.
- **Retry logic** re-attempts blocked requests with linear back-off (3s, 6s,
  9s, 12s).
- **Session persistence** saves cookies after each successful crawl and
  restores them on the next run, preserving login state and any tokens the
  site sets after passing bot checks.
