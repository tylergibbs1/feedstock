# Feedstock modernization research (August 2026)

This pass compared Feedstock with current Firecrawl source/docs and mature open-source crawling
patterns. The goal was not API mimicry. It was to adopt the parts that make local scraping more
predictable, compact, and safe while preserving Feedstock's Bun-first, in-process design.

## Research baseline

- [Firecrawl source](https://github.com/firecrawl/firecrawl) at
  `7f1ecf3bd2eb92ad3fe560cc441421bf8a12b12e` (2026-08-23) and its current
  [scrape](https://docs.firecrawl.dev/features/scrape),
  [crawl](https://docs.firecrawl.dev/features/crawl), and
  [map](https://docs.firecrawl.dev/features/map) contracts.
- [Crawlee URL enqueueing and request identity](https://crawlee.dev/js/docs/introduction/adding-urls).
- [Crawl4AI fit-markdown filtering](https://docs.crawl4ai.com/core/fit-markdown/).
- [Playwright Page lifecycle and routing](https://playwright.dev/docs/api/class-page).
- Bun `HTMLRewriter`, abort signals, streaming responses, SQLite, and gzip behavior from the
  installed Bun 1.3 runtime and official type definitions.

## Patterns adopted

| Upstream pattern | Feedstock implementation |
| --- | --- |
| Format-driven, compact scrape response | `WebCrawler.scrape()` and `feedstock scrape`, with output keys matching requested formats |
| Main-content defaults for LLM-ready output | `onlyMainContent`, boilerplate removal, word thresholds, and base64-image removal |
| Page interaction before capture | Typed declarative actions for wait/click/fill/write/press/scroll/screenshot/scrape/JavaScript |
| Explicit cache freshness | `cacheMaxAgeMs` with a two-day default and separate read/write cache modes |
| Stable request identity | Canonical URL helper removes fragments/tracking parameters, sorts queries, and supports query-insensitive deduplication |
| Map before crawl | robots/sitemap discovery, nested and gzip sitemap support, bounded traversal, canonical deduplication, and start-page links |
| Fit markdown | Optional pruning and BM25 filters while retaining raw markdown |
| Backpressure and retry discipline | Reserved per-domain time slots, Retry-After/crawl-delay, configurable exponential retries, cancellation, and progress callbacks |
| Safe browser lifecycle | Action-aware engine selection, per-run listener/route cleanup, persistent-session header reset, and guaranteed ad-hoc session cleanup |
| Observable output | Final redirect URL as extraction base plus engine name and fetch/total timings |

## Important correctness fixes

- Cache keys now include output-affecting configuration. A CSS-scoped or action-driven result can
  no longer poison a later plain crawl of the same URL.
- Redirect destinations and document `<base>` elements are used when resolving links, media, and
  metadata.
- Link extraction deduplicates targets, retains `rel`/`nofollow`, and deep crawls respect nofollow
  by default.
- `crawlMany()` preserves input order even though work completes concurrently and exposes an
  `onProgress` callback for streaming progress.
- The fetch engine rejects unexpected binary bodies and oversized streams before they consume
  unbounded memory.
- Resource routing falls through to more specific Playwright handlers and is unregistered after
  each run; response/console listeners are detached as well.
- Streaming anchor extraction waits for the closing tag, so nested anchor text is not truncated.
- HTML is parsed once for cleaning, links, media, and metadata instead of duplicated hot-path
  parsing.

## Dependency policy

This pass updates Playwright to 1.62.1, Lightpanda to 1.5.0, Biome to 2.5.10, and Bun types to
1.4.0. TypeScript remains on the current 5.9-compatible range: 7.0 is a major compiler migration
and should be evaluated separately with its own compatibility work.

## Deliberate boundaries

Feedstock remains a local library, not a hosted Firecrawl replacement. This pass does not add
managed proxies, distributed queues, billing/webhooks, hosted screenshot URLs, LLM-backed
schema-less extraction, PDF/document parsing, or anti-bot infrastructure. Those need explicit
product and operational designs rather than thin compatibility shims.
