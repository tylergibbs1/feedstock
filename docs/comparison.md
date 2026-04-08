# Feedstock vs Crawl4AI vs Firecrawl

A technical comparison of three popular web crawling libraries for building AI-powered data pipelines.

## At a Glance

| | **Feedstock** | **Crawl4AI** | **Firecrawl** |
|---|---|---|---|
| Language | TypeScript (Bun) | Python (asyncio) | TypeScript (Node.js) |
| License | Apache-2.0 | Apache-2.0 | AGPL-3.0 |
| Model | Library | Library + CLI | Hosted API + self-host |
| GitHub Stars | Early stage | ~63k | ~106k |
| Dependencies | 3 (playwright, cheerio, turndown) | Heavy (playwright, litellm, etc.) | Redis, PostgreSQL, Playwright |
| Install | `bun add feedstock` | `pip install crawl4ai` | Sign up for API key or Docker Compose |

## Runtime and Architecture

**Feedstock** runs on Bun with zero infrastructure requirements. Import it, call `crawl()`, get results. The fetch-first engine system tries a lightweight HTTP request before launching a browser, auto-escalating only when it detects an SPA shell or anti-bot block. This means static pages never spin up Chromium.

**Crawl4AI** is Python-native with async browser pooling via Playwright. Each browser instance consumes significant memory, which limits single-machine concurrency. It's a solid choice if your stack is Python, but you pay the asyncio overhead and Playwright binary management tax.

**Firecrawl** is a queue-based worker architecture requiring Redis, PostgreSQL, and a Playwright microservice. Even self-hosted, you're running 4+ services. The hosted API abstracts this away but introduces latency (P95 of 3.4s) and credit-based pricing.

**Why Feedstock wins here:** Zero infrastructure. One dependency install. Static pages don't launch a browser. You're writing TypeScript end-to-end with no service orchestration.

## Browser Support

| | **Feedstock** | **Crawl4AI** | **Firecrawl** |
|---|---|---|---|
| Playwright (Chromium/Firefox/WebKit) | Yes | Yes | Yes (microservice) |
| Generic CDP (Browserbase, Browserless, etc.) | Yes | No | No (hosted only) |
| Lightpanda | Yes (local + cloud) | No | No |
| Fetch-first (no browser) | Yes (auto) | No | No |

Feedstock's `{ kind: "cdp", wsUrl: "..." }` backend lets you connect to any cloud browser provider with one config line. Crawl4AI and Firecrawl lock you into their browser management.

## Content Extraction

| Capability | **Feedstock** | **Crawl4AI** | **Firecrawl** |
|---|---|---|---|
| Markdown output | Yes (Turndown) | Yes | Yes |
| CSS selector extraction | Yes | Yes | No |
| XPath extraction | Yes | No | No |
| Regex extraction | Yes | Yes | No |
| Table extraction | Yes | No | No |
| Accessibility tree extraction | Yes | No | No |
| LLM-based extraction | No | Yes | Yes |
| Schema-based structured output | Yes (CSS/XPath schemas) | Yes (via LLM) | Yes (via LLM) |

Feedstock has six deterministic extraction strategies that run locally with zero API costs. Crawl4AI and Firecrawl offer LLM-based extraction, which is powerful for unstructured content but adds latency, cost, and non-determinism.

**Trade-off:** If you need "extract the product name and price from any arbitrary page," LLM extraction is hard to beat. If you know the page structure, feedstock's CSS/XPath/table strategies are faster, cheaper, and deterministic. Feedstock doesn't have LLM extraction yet — bring your own by feeding markdown output to your LLM of choice.

## Performance

| Feature | **Feedstock** | **Crawl4AI** | **Firecrawl** |
|---|---|---|---|
| Fetch-first engine | Yes | No | No |
| Resource blocking profiles | `fast`, `minimal`, `media-only`, custom | `text_mode`, `light_mode` | No granular control |
| Navigation strategies | `commit`, `domcontentloaded`, `load`, `networkidle` | Limited | No control |
| In-page extraction | Yes (skips HTML serialization) | No | No |
| Content hashing (skip unchanged) | Yes | No | No |

Feedstock's engine system means a 10-page crawl of static documentation sites may never launch a browser. Crawl4AI and Firecrawl launch Playwright for every page.

Resource blocking profiles let you choose the exact trade-off: `"fast"` keeps CSS/JS but drops images and fonts; `"minimal"` drops everything except HTML and JS; `"media-only"` just blocks heavy assets.

## Deep Crawling

| Feature | **Feedstock** | **Crawl4AI** | **Firecrawl** |
|---|---|---|---|
| BFS / DFS / BestFirst | All three | All three | BFS only |
| Streaming results | Yes (AsyncGenerator) | Yes | Polling-based |
| URL scoring | Composable (keyword, path depth, freshness, domain authority) | Keyword-based | No |
| Filter chains | Composable (domain, pattern, content-type, max depth) | Yes (FilterChain) | URL include/exclude patterns |
| Rate limiting | Per-domain with backoff | Yes | Server-side |
| Robots.txt compliance | Built-in | Built-in | Built-in |
| Sitemap discovery | Yes (URLSeeder) | Yes | Yes (Map endpoint) |

Feedstock and Crawl4AI are comparable here. Firecrawl's crawl is simpler — it's designed as an API, not a crawl framework.

## Anti-Bot and Stealth

| Feature | **Feedstock** | **Crawl4AI** | **Firecrawl** |
|---|---|---|---|
| Stealth mode (single flag) | Yes | Yes | Hosted handles it |
| User-agent rotation | 9-agent pool | Yes | Managed |
| navigator.webdriver override | Yes | Yes | Managed |
| Human simulation (mouse/scroll) | Yes | Yes (scroll for lazy content) | No |
| Proxy rotation with health tracking | Yes | Yes (3-tier escalation) | Managed (hosted) |
| Block detection + auto-retry | Yes | Yes | Managed |
| Consent popup removal | Yes | No | No |
| Storage state persistence | Yes (cookies/localStorage) | Yes | Via API |

## Configuration

**Feedstock** has a three-layer config system: `feedstock.json` project file < `FEEDSTOCK_*` env vars < programmatic overrides. This makes CI/CD trivial — set `FEEDSTOCK_CDP_URL` in your environment and your code doesn't change.

**Crawl4AI** uses `BrowserConfig` + `CrawlerRunConfig` objects, similar to feedstock, plus YAML config files and a CLI (`crwl`).

**Firecrawl** is configured via API parameters per request. Self-hosted uses `.env` files with 50+ environment variables for the server stack.

## Output

| Format | **Feedstock** | **Crawl4AI** | **Firecrawl** |
|---|---|---|---|
| Raw HTML | Yes | Yes | Yes |
| Cleaned HTML | Yes | Yes | Yes |
| Markdown | Yes (with citations) | Yes (raw + fit) | Yes |
| Screenshots | Yes (base64) | Yes | Yes |
| PDFs | Yes | Yes | No |
| Accessibility snapshots | Yes (@e refs, 3-10x smaller than HTML) | No | No |
| Network request logs | Yes | No | No |
| Console messages | Yes | No | No |
| Change tracking (diffs) | Yes | No | No |
| Interactive element map | Yes | No | No |

Feedstock's accessibility snapshots produce compact semantic representations with `@e1`, `@e2` refs that AI agents can reference directly — useful for building autonomous browsing agents.

## Cost

| | **Feedstock** | **Crawl4AI** | **Firecrawl** |
|---|---|---|---|
| Library cost | Free | Free | Free (self-hosted) |
| Hosting cost | Your compute | Your compute | Credits (hosted) or Redis+PG+Playwright (self-hosted) |
| LLM costs | None (no LLM features) | Per-extraction (OpenAI/etc.) | Per-extraction (OpenAI) |
| Infrastructure | None | Playwright binary | Redis + PostgreSQL + Playwright (self-hosted) |

## When to Use What

**Choose Feedstock if:**
- Your stack is TypeScript/Bun
- You want zero infrastructure — just a library
- You need deterministic, fast extraction without LLM costs
- You're building AI agents that need accessibility snapshots
- You need multiple browser backends (cloud CDP, Lightpanda)
- Performance matters — fetch-first engine, resource blocking profiles

**Choose Crawl4AI if:**
- Your stack is Python
- You need LLM-based extraction out of the box
- You want a mature, well-documented library with a large community
- You're comfortable with Playwright's memory footprint

**Choose Firecrawl if:**
- You want a managed service with zero ops
- You need to scrape at massive scale with queuing infrastructure
- You're building integrations (Zapier, n8n) and want a REST API
- You don't mind credit-based pricing and AGPL licensing

## Honest Gaps in Feedstock

- **No LLM extraction** — you'll need to pipe markdown to your own LLM
- **Bun-only** — no Node.js compatibility, which limits adoption
- **Early stage** (v0.2.0) — smaller community, API may evolve
- **No hosted service** — you run it yourself
- **No distributed crawling** — single-process, no queue system
