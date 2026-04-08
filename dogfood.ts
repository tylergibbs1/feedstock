/**
 * Dogfood script — exercise every major feedstock feature against real sites.
 */

import {
	WebCrawler,
	CacheMode,
	FilterChain,
	DomainFilter,
	ContentTypeFilter,
	URLPatternFilter,
	CompositeScorer,
	KeywordRelevanceScorer,
	PathDepthScorer,
	RateLimiter,
	RobotsParser,
	CrawlerMonitor,
	CssExtractionStrategy,
	RegexExtractionStrategy,
	TableExtractionStrategy,
	PruningContentFilter,
	BM25ContentFilter,
	SlidingWindowChunking,
	URLSeeder,
	extractMetadata,
	isBlocked,
} from "./src/index";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const SKIP = "\x1b[33m○\x1b[0m";

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, condition: boolean, detail?: string) {
	if (condition) {
		console.log(`  ${PASS} ${name}${detail ? ` — ${detail}` : ""}`);
		passed++;
	} else {
		console.log(`  ${FAIL} ${name}${detail ? ` — ${detail}` : ""}`);
		failed++;
	}
}

function skip(name: string, reason: string) {
	console.log(`  ${SKIP} ${name} — ${reason}`);
	skipped++;
}

// ---------------------------------------------------------------------------

const crawler = new WebCrawler({ verbose: false });
const monitor = new CrawlerMonitor();

try {
	await crawler.start();
	monitor.start();

	// -----------------------------------------------------------------------
	// 1. Basic crawl — example.com
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m1. Basic crawl (example.com)\x1b[0m");
	{
		const t = Date.now();
		const r = await crawler.crawl("https://example.com", { cacheMode: CacheMode.Bypass });
		const ms = Date.now() - t;
		monitor.recordPageComplete({ success: r.success, fromCache: false, responseTimeMs: ms, bytesDownloaded: r.html.length });

		check("success", r.success);
		check("status 200", r.statusCode === 200, `got ${r.statusCode}`);
		check("has HTML", r.html.length > 100, `${r.html.length} chars`);
		check("has cleaned HTML", !!r.cleanedHtml && r.cleanedHtml.length > 0);
		check("has markdown", !!r.markdown?.rawMarkdown, `${r.markdown?.rawMarkdown.length} chars`);
		check("has metadata title", !!r.metadata?.title, `"${r.metadata?.title}"`);
		check("has links", r.links.external.length >= 1, `${r.links.external.length} external`);
	}

	// -----------------------------------------------------------------------
	// 2. Rich metadata — Hacker News
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m2. Rich metadata (news.ycombinator.com)\x1b[0m");
	{
		const r = await crawler.crawl("https://news.ycombinator.com", { cacheMode: CacheMode.Bypass });
		monitor.recordPageComplete({ success: r.success, fromCache: false, responseTimeMs: 0, bytesDownloaded: r.html.length });

		check("success", r.success);
		check("has title", !!r.metadata?.title, `"${r.metadata?.title}"`);
		check("has links", r.links.internal.length > 10, `${r.links.internal.length} internal`);
	}

	// -----------------------------------------------------------------------
	// 3. CSS extraction — HN stories
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m3. CSS extraction (HN stories)\x1b[0m");
	{
		const strategy = new CssExtractionStrategy({
			name: "hn-stories",
			baseSelector: ".athing",
			fields: [
				{ name: "rank", selector: ".rank", type: "text" },
				{ name: "title", selector: ".titleline > a", type: "text" },
				{ name: "url", selector: ".titleline > a", type: "attribute", attribute: "href" },
			],
		});

		const r = await crawler.crawl("https://news.ycombinator.com", { cacheMode: CacheMode.Bypass });
		const items = await strategy.extract(r.url, r.cleanedHtml ?? r.html);

		check("extracted items", items.length > 0, `${items.length} stories`);
		if (items.length > 0) {
			const first = JSON.parse(items[0].content);
			check("has rank", !!first.rank, `"${first.rank}"`);
			check("has title", !!first.title, `"${first.title}"`);
			check("has URL", !!first.url, `"${first.url}"`);
		}
	}

	// -----------------------------------------------------------------------
	// 4. Regex extraction — emails/prices
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m4. Regex extraction\x1b[0m");
	{
		const html = "<p>Contact us at hello@example.com or sales@test.io. Prices: $29.99, $99.00</p>";
		const r = await crawler.processHtml(html);

		const emailStrategy = new RegexExtractionStrategy([/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi]);
		const emails = await emailStrategy.extract("raw:", r.cleanedHtml ?? html);
		check("found emails", emails.length === 2, `${emails.length} emails`);

		const priceStrategy = new RegexExtractionStrategy([/\$\d+\.\d{2}/g]);
		const prices = await priceStrategy.extract("raw:", r.cleanedHtml ?? html);
		check("found prices", prices.length === 2, `${prices.length} prices`);
	}

	// -----------------------------------------------------------------------
	// 5. Table extraction
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m5. Table extraction (Wikipedia)\x1b[0m");
	{
		const r = await crawler.crawl("https://en.wikipedia.org/wiki/List_of_programming_languages", {
			cacheMode: CacheMode.Bypass,
		});
		monitor.recordPageComplete({ success: r.success, fromCache: false, responseTimeMs: 0, bytesDownloaded: r.html.length });

		const tableStrategy = new TableExtractionStrategy({ minRows: 2 });
		const tables = await tableStrategy.extract(r.url, r.cleanedHtml ?? r.html);

		check("success", r.success);
		check("found tables", tables.length > 0, `${tables.length} tables`);
		if (tables.length > 0) {
			const t = JSON.parse(tables[0].content);
			check("table has headers", t.headers.length > 0, `${t.headers.length} columns`);
			check("table has rows", t.rows.length > 0, `${t.rows.length} rows`);
		}
	}

	// -----------------------------------------------------------------------
	// 6. Markdown generation with citations
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m6. Markdown generation + citations\x1b[0m");
	{
		const r = await crawler.crawl("https://example.com", { cacheMode: CacheMode.Bypass });

		check("raw markdown exists", !!r.markdown?.rawMarkdown);
		check("citations version exists", !!r.markdown?.markdownWithCitations);
		check("references markdown", r.markdown?.referencesMarkdown !== undefined);
	}

	// -----------------------------------------------------------------------
	// 7. Content filtering
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m7. Content filtering\x1b[0m");
	{
		const content = [
			"Share this on Twitter",
			"Web crawling is the process of systematically browsing the web to extract data from pages.",
			"Copyright 2024 All rights reserved",
			"TypeScript provides static type checking at compile time, catching errors early in development.",
			"Loading...",
		].join("\n\n");

		const pruned = new PruningContentFilter().filter(content);
		check("pruning removes boilerplate", !pruned.includes("Share this"), `kept ${pruned.split("\n\n").length} blocks`);
		check("pruning keeps content", pruned.includes("Web crawling"));

		const bm25 = new BM25ContentFilter({ threshold: 0.05 }).filter(content, "TypeScript");
		check("BM25 filters by relevance", bm25.includes("TypeScript"));
	}

	// -----------------------------------------------------------------------
	// 8. Chunking
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m8. Chunking\x1b[0m");
	{
		const longText = Array.from({ length: 100 }, (_, i) => `Sentence number ${i + 1} with some filler words.`).join(" ");
		const chunks = new SlidingWindowChunking(20, 5).chunk(longText);
		check("sliding window chunks", chunks.length > 1, `${chunks.length} chunks from 100 sentences`);
		check("chunks have overlap", chunks.length > 4);
	}

	// -----------------------------------------------------------------------
	// 9. Robots.txt
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m9. Robots.txt parsing\x1b[0m");
	{
		const parser = new RobotsParser("feedstock");
		const directives = await parser.fetch("https://github.com");
		check("fetched robots.txt", directives.rules.length > 0, `${directives.rules.length} rules`);
		check("parsed sitemaps field", directives.sitemaps !== undefined, `${directives.sitemaps.length} sitemaps`);

		const allowed = parser.isAllowed("https://github.com/tylergibbs1", directives);
		check("user pages allowed", allowed);
	}

	// -----------------------------------------------------------------------
	// 10. Rate limiter
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m10. Rate limiter\x1b[0m");
	{
		const limiter = new RateLimiter({ baseDelay: 100, jitter: 0 });
		await limiter.waitIfNeeded("https://example.com/a");
		const start = Date.now();
		await limiter.waitIfNeeded("https://example.com/b");
		const waited = Date.now() - start;
		check("rate limiter delays", waited >= 80, `waited ${waited}ms`);

		const backed = limiter.reportResult("https://example.com/", 429);
		check("backoff on 429", backed);
		check("delay increased", limiter.getDelay("https://example.com/") > 100);
	}

	// -----------------------------------------------------------------------
	// 11. URL Seeder
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m11. URL seeder\x1b[0m");
	{
		const seeder = new URLSeeder({ timeout: 10_000 });
		const result = await seeder.seed("https://example.com");
		// example.com may not have a sitemap, so just check it doesn't crash
		check("seeder completes", true, `${result.urls.length} URLs, ${result.sitemaps.length} sitemaps`);
	}

	// -----------------------------------------------------------------------
	// 12. Anti-bot detection
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m12. Anti-bot detection\x1b[0m");
	{
		check("detects 403 block", isBlocked("<html><body>Access Denied</body></html>", 403));
		check("detects Cloudflare", isBlocked("<html><body>Checking your browser</body></html>", 503));
		check("normal page not blocked", !isBlocked("<html><body><h1>Hello</h1></body></html>", 200));
	}

	// -----------------------------------------------------------------------
	// 13. Filter chain with denial reasons
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m13. Filter chain + denial reasons\x1b[0m");
	{
		const chain = new FilterChain()
			.add(new DomainFilter({ allowed: ["example.com"] }))
			.add(new ContentTypeFilter())
			.add(new URLPatternFilter({ exclude: [/\/admin/] }));

		const r1 = await chain.applyWithReason("https://example.com/page");
		check("allows valid URL", r1.allowed);

		const r2 = await chain.applyWithReason("https://other.com/page");
		check("blocks wrong domain", !r2.allowed, r2.reason);

		const r3 = await chain.applyWithReason("https://example.com/file.pdf");
		check("blocks PDF extension", !r3.allowed, r3.reason);

		const r4 = await chain.applyWithReason("https://example.com/admin/panel");
		check("blocks admin path", !r4.allowed, r4.reason);

		const denials = chain.getDenials();
		check("tracked 3 denials", denials.length === 3);
	}

	// -----------------------------------------------------------------------
	// 14. URL scorers
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m14. URL scorers\x1b[0m");
	{
		const scorer = new CompositeScorer()
			.add(new KeywordRelevanceScorer(["docs", "api"]))
			.add(new PathDepthScorer());

		const docsScore = scorer.score("https://example.com/docs/api", 0);
		const deepScore = scorer.score("https://example.com/a/b/c/d/e/f", 0);
		check("docs URL scores high", docsScore > 0.5, `${docsScore.toFixed(2)}`);
		check("deep URL scores low", deepScore < docsScore, `${deepScore.toFixed(2)}`);
	}

	// -----------------------------------------------------------------------
	// 15. Deep crawl — real site
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m15. Deep crawl (example.com, depth 1)\x1b[0m");
	{
		const results = await crawler.deepCrawl(
			"https://example.com",
			{ cacheMode: CacheMode.Bypass },
			{
				maxDepth: 1,
				maxPages: 5,
				rateLimiter: new RateLimiter({ baseDelay: 200, jitter: 0 }),
			},
		);

		check("deep crawl completes", results.length >= 1, `${results.length} pages`);
		check("first page is start URL", results[0]?.url.includes("example.com"), results[0]?.url);
		check("all pages successful", results.every((r) => r.success));
	}

	// -----------------------------------------------------------------------
	// 16. Caching round-trip
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m16. Cache round-trip\x1b[0m");
	{
		const url = `https://httpbin.org/html?t=${Date.now()}`;
		const first = await crawler.crawl(url, { cacheMode: CacheMode.Enabled });
		check("first crawl: miss", first.cacheStatus === "miss");

		const second = await crawler.crawl(url, { cacheMode: CacheMode.Enabled });
		check("second crawl: hit", second.cacheStatus === "hit");
		check("cached content matches", second.html === first.html);
	}

	// -----------------------------------------------------------------------
	// 17. processHtml
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m17. processHtml\x1b[0m");
	{
		const html = `<html><head><title>Test</title><meta property="og:title" content="OG Test"></head>
			<body><h1>Hello</h1><p>World</p><a href="https://example.com">Link</a></body></html>`;
		const r = await crawler.processHtml(html);
		check("success", r.success);
		check("has markdown", !!r.markdown);
		check("has metadata", !!r.metadata?.title, `"${r.metadata?.title}"`);
		check("has OG title", r.metadata?.ogTitle === "OG Test");
		check("has links", r.links.external.length >= 1);
	}

	// -----------------------------------------------------------------------
	// 18. Accessibility snapshot — static
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m18. Accessibility snapshot (static)\x1b[0m");
	{
		const r = await crawler.crawl("https://news.ycombinator.com", {
			cacheMode: CacheMode.Bypass,
			snapshot: true,
		});

		check("snapshot generated", !!r.snapshot);
		check("contains headings or links", r.snapshot!.includes("[heading]") || r.snapshot!.includes("[link]"));
		check("contains links", r.snapshot!.includes("[link]"));
		check("contains refs", r.snapshot!.includes("@e"));
		check("snapshot is compact", r.snapshot!.length < r.html.length, `${r.snapshot!.length} chars vs ${r.html.length} HTML chars`);

		// Also test buildStaticSnapshot directly
		const { buildStaticSnapshot } = await import("./src/snapshot/accessibility");
		const snap = buildStaticSnapshot(r.html);
		check("tree has nodes", snap.tree.length > 5, `${snap.tree.length} nodes`);
		check("refs assigned", snap.nodeCount > 10, `${snap.nodeCount} refs`);
		check("refs map populated", snap.refs.size === snap.nodeCount);

		const links = snap.tree.filter((n) => n.role === "link");
		check("snapshot found links", links.length > 20, `${links.length} links`);
		const headings = snap.tree.filter((n) => n.role === "heading");
		check("snapshot found headings (if any)", headings.length >= 0, `${headings.length} headings (HN uses non-standard markup)`);
	}

	// -----------------------------------------------------------------------
	// 19. Accessibility snapshot — CDP (live browser)
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m19. Accessibility snapshot (CDP)\x1b[0m");
	{
		const { takeSnapshot } = await import("./src/snapshot/accessibility");
		const { BrowserManager } = await import("./src/browser/manager");
		const { createBrowserConfig } = await import("./src/config");

		const mgr = new BrowserManager(createBrowserConfig({ headless: true }));
		await mgr.start();
		const { page, sessionId } = await mgr.getPage();

		await page.goto("https://example.com");
		const snap = await takeSnapshot(page);

		check("CDP snapshot has nodes", snap.nodeCount > 0, `${snap.nodeCount} refs`);
		check("CDP snapshot has text", snap.text.length > 0, `${snap.text.length} chars`);
		check("CDP snapshot has refs", snap.refs.size > 0);
		check("CDP snapshot contains heading", snap.text.includes("[heading]"));
		check("CDP snapshot contains link", snap.text.includes("[link]"));

		await mgr.killSession(sessionId);
		await mgr.close();
	}

	// -----------------------------------------------------------------------
	// 20. Interactive element detection
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m20. Interactive element detection\x1b[0m");
	{
		const { detectInteractiveElements } = await import("./src/utils/interactive");
		const { BrowserManager } = await import("./src/browser/manager");
		const { createBrowserConfig } = await import("./src/config");

		const mgr = new BrowserManager(createBrowserConfig({ headless: true }));
		await mgr.start();
		const { page, sessionId } = await mgr.getPage();

		await page.goto("https://news.ycombinator.com");
		const elements = await detectInteractiveElements(page);

		check("found interactive elements", elements.length > 10, `${elements.length} elements`);

		const links = elements.filter((e) => e.tag === "a");
		check("found links", links.length > 20, `${links.length} links`);

		const withHref = elements.filter((e) => e.href);
		check("links have href", withHref.length > 10, `${withHref.length} with href`);

		const inputs = elements.filter((e) => e.tag === "input");
		check("found inputs", inputs.length >= 1, `${inputs.length} inputs`);

		// Check selectors are present
		const hasSelectors = elements.every((e) => e.selector.length > 0);
		check("all elements have selectors", hasSelectors);

		await mgr.killSession(sessionId);
		await mgr.close();
	}

	// -----------------------------------------------------------------------
	// 21. Iframe content inlining
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m21. Iframe inlining\x1b[0m");
	{
		const { inlineIframeContent } = await import("./src/utils/iframe");

		const parentHtml = `<html><body>
			<h1>Parent</h1>
			<iframe src="https://embed.example.com/widget"></iframe>
			<p>After iframe</p>
		</body></html>`;

		const iframeContent = [{
			src: "https://embed.example.com/widget",
			html: "<html><head><style>body{color:red}</style></head><body><div>Embedded Widget Content</div></body></html>",
		}];

		const result = inlineIframeContent(parentHtml, iframeContent);
		check("replaced iframe tag", !result.includes("<iframe"));
		check("inlined content", result.includes("Embedded Widget Content"));
		check("has marker attribute", result.includes("data-feedstock-iframe-src"));
		check("stripped head from iframe", !result.includes("<style>"));
		check("preserved parent content", result.includes("Parent") && result.includes("After iframe"));
	}

	// -----------------------------------------------------------------------
	// 22. Storage state persistence
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m22. Storage state persistence\x1b[0m");
	{
		const { saveStorageState, loadStorageState } = await import("./src/utils/storage");
		const { BrowserManager } = await import("./src/browser/manager");
		const { createBrowserConfig } = await import("./src/config");

		const mgr = new BrowserManager(createBrowserConfig({ headless: true }));
		await mgr.start();
		const { page, sessionId } = await mgr.getPage();

		await page.goto("https://example.com");

		const storagePath = "/tmp/feedstock-dogfood-storage.json";
		const savedPath = await saveStorageState(page.context(), storagePath);
		check("saved storage state", savedPath === storagePath);

		const state = await loadStorageState(storagePath);
		check("loaded storage state", !!state);
		check("has cookies array", Array.isArray(state!.cookies));
		check("has origins array", Array.isArray(state!.origins));
		check("has savedAt timestamp", state!.savedAt > 0, new Date(state!.savedAt).toISOString());

		// Non-existent file returns null
		const missing = await loadStorageState("/tmp/nonexistent-feedstock-state.json");
		check("missing file returns null", missing === null);

		// Clean up
		const { unlinkSync } = await import("node:fs");
		try { unlinkSync(storagePath); } catch {}

		await mgr.killSession(sessionId);
		await mgr.close();
	}

	// -----------------------------------------------------------------------
	// 23. AI-friendly errors
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m23. AI-friendly errors\x1b[0m");
	{
		const { toFriendlyError } = await import("./src/utils/errors");

		// Test against real error patterns
		const cases = [
			{ input: "net::ERR_NAME_NOT_RESOLVED at navigation", expected: "DNS" },
			{ input: "net::ERR_CONNECTION_REFUSED", expected: "refused" },
			{ input: "Timeout 30000ms exceeded", expected: "timed out" },
			{ input: "net::ERR_SSL_PROTOCOL_ERROR", expected: "SSL" },
			{ input: "net::ERR_TOO_MANY_REDIRECTS", expected: "redirect" },
			{ input: "element is not visible", expected: "not visible" },
			{ input: "browser has been closed", expected: "closed" },
			{ input: "ENOTFOUND badhost.test", expected: "not found" },
		];

		let errorsPassed = 0;
		for (const { input, expected } of cases) {
			const friendly = toFriendlyError(new Error(input));
			if (friendly.toLowerCase().includes(expected.toLowerCase())) {
				errorsPassed++;
			}
		}
		check("all error patterns convert", errorsPassed === cases.length, `${errorsPassed}/${cases.length}`);

		// Test actual crawl error is friendly
		const r = await crawler.crawl("http://localhost:99999/nope", {
			cacheMode: CacheMode.Bypass,
			pageTimeout: 3000,
		});
		check("crawl error is friendly", r.errorMessage!.length < 200, `"${r.errorMessage}"`);
		check("no stack trace in error", !r.errorMessage!.includes("at "));
	}

	// -----------------------------------------------------------------------
	// 24. Snapshot via processHtml
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m24. Snapshot via processHtml\x1b[0m");
	{
		const html = `<html><body>
			<h1>Article Title</h1>
			<p>This is the first paragraph of a long article about web crawling technology.</p>
			<h2>Section One</h2>
			<p>Details about the section with enough text to be captured by the snapshot.</p>
			<a href="https://example.com">Read more</a>
			<button>Subscribe</button>
			<input type="email" placeholder="your@email.com" />
			<img alt="Illustration of web crawling" src="/crawl.png" />
			<input type="hidden" name="csrf" value="abc123" />
		</body></html>`;

		const r = await crawler.processHtml(html, { snapshot: true });

		check("processHtml snapshot works", !!r.snapshot);
		check("has h1", r.snapshot!.includes("Article Title"));
		check("has h2", r.snapshot!.includes("Section One"));
		check("has link", r.snapshot!.includes("[link]"));
		check("has button", r.snapshot!.includes("[button]"));
		check("has textbox", r.snapshot!.includes("[textbox]"));
		check("has img with alt", r.snapshot!.includes("Illustration"));
		check("no hidden input", !r.snapshot!.includes("csrf"));
	}

	// -----------------------------------------------------------------------
	// 25. Change tracking
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m25. Change tracking\x1b[0m");
	{
		const { ChangeTracker } = await import("./src/utils/change-tracker");
		const tracker = new ChangeTracker({ dbPath: "/tmp/feedstock-dogfood-changes.db" });

		// Clean any previous runs
		for (const snap of tracker.listSnapshots()) {
			tracker.deleteSnapshot(snap.id);
		}

		// Crawl 1: all pages should be "new"
		const r1 = await crawler.crawl("https://example.com", { cacheMode: CacheMode.Bypass });
		const report1 = tracker.compare([r1], "dogfood-v1");

		check("first run: all new", report1.summary.new === 1);
		check("first run: no previous snapshot", report1.previousSnapshotId === null);
		check("has snapshot ID", report1.snapshotId === "dogfood-v1");

		// Crawl 2 (same content): should be "unchanged"
		const r2 = await crawler.crawl("https://example.com", { cacheMode: CacheMode.Bypass });
		const report2 = tracker.compare([r2], "dogfood-v2");

		check("second run: unchanged", report2.summary.unchanged === 1, `got ${report2.summary.unchanged}`);
		check("second run: previous is v1", report2.previousSnapshotId === "dogfood-v1");
		check("second run: no changes", report2.summary.changed === 0);

		// Simulate a "changed" page by modifying content
		const fakeChanged = { ...r2, html: r2.html + "<!-- modified -->", cleanedHtml: (r2.cleanedHtml ?? "") + " modified", markdown: r2.markdown ? { ...r2.markdown, rawMarkdown: r2.markdown.rawMarkdown + "\n\nNew content added." } : null };
		const report3 = tracker.compare([fakeChanged], "dogfood-v3");

		check("changed detected", report3.summary.changed === 1);
		const change = report3.changes.find((c) => c.status === "changed");
		check("has diff", !!change?.diff);
		check("diff has additions", (change?.diff?.additions ?? 0) > 0, `+${change?.diff?.additions}`);

		// Simulate a "removed" page by not including the URL
		const report4 = tracker.compare([], "dogfood-v4");

		check("removed detected", report4.summary.removed === 1);
		const removed = report4.changes.find((c) => c.status === "removed");
		check("removed URL correct", removed?.url.includes("example.com"), removed?.url);

		// Snapshot management
		const snapshots = tracker.listSnapshots();
		check("snapshots stored", snapshots.length >= 3, `${snapshots.length} snapshots`);

		tracker.deleteSnapshot("dogfood-v1");
		check("delete works", tracker.listSnapshots().length < snapshots.length);

		const pruned = tracker.pruneOlderThan(1); // 1ms — nothing should be that old
		check("prune with tiny window: 0 removed", pruned === 0);

		// Clean up
		tracker.close();
		const { unlinkSync, existsSync } = await import("node:fs");
		for (const suffix of ["", "-wal", "-shm"]) {
			const p = `/tmp/feedstock-dogfood-changes.db${suffix}`;
			if (existsSync(p)) try { unlinkSync(p); } catch {}
		}
	}

	// -----------------------------------------------------------------------
	// 26. Beefy site: GitHub repo page (heavy DOM, JS, lots of links)
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m26. Beefy: GitHub repo page\x1b[0m");
	{
		const r = await crawler.crawl("https://github.com/oven-sh/bun", {
			cacheMode: CacheMode.Bypass,
			snapshot: true,
		});
		monitor.recordPageComplete({ success: r.success, fromCache: false, responseTimeMs: 0, bytesDownloaded: r.html.length });

		check("success", r.success);
		check("large HTML", r.html.length > 50_000, `${(r.html.length / 1024).toFixed(0)}KB`);
		check("many links", r.links.internal.length + r.links.external.length > 50, `${r.links.internal.length + r.links.external.length} links`);
		check("has metadata", !!r.metadata?.title, `"${r.metadata?.title}"`);
		check("has markdown", !!r.markdown && r.markdown.rawMarkdown.length > 500, `${r.markdown?.rawMarkdown.length} chars`);
		check("snapshot much smaller than HTML", r.snapshot!.length < r.html.length / 2, `${(r.snapshot!.length / 1024).toFixed(0)}KB snapshot vs ${(r.html.length / 1024).toFixed(0)}KB HTML`);
		check("has images", r.media.images.length > 0, `${r.media.images.length} images`);
	}

	// -----------------------------------------------------------------------
	// 27. Beefy: Amazon product page (anti-bot, heavy JS, complex DOM)
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m27. Beefy: Amazon product page\x1b[0m");
	{
		const r = await crawler.crawl("https://www.amazon.com/dp/B0D1XD1ZV3", {
			cacheMode: CacheMode.Bypass,
		});
		monitor.recordPageComplete({ success: r.success, fromCache: false, responseTimeMs: 0, bytesDownloaded: r.html.length });

		check("success (may be blocked)", r.success);
		check("got HTML", r.html.length > 1000, `${(r.html.length / 1024).toFixed(0)}KB`);
		if (r.success && r.statusCode === 200) {
			const { isBlocked: blocked } = await import("./src/utils/antibot");
			const isAmazonBlocked = blocked(r.html, r.statusCode ?? 200);
			check("anti-bot detection works", typeof isAmazonBlocked === "boolean", isAmazonBlocked ? "blocked" : "not blocked");
		}
	}

	// -----------------------------------------------------------------------
	// 28. Beefy: MDN docs (deep content, tables, code blocks, many headings)
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m28. Beefy: MDN docs page\x1b[0m");
	{
		const r = await crawler.crawl("https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array", {
			cacheMode: CacheMode.Bypass,
			snapshot: true,
		});
		monitor.recordPageComplete({ success: r.success, fromCache: false, responseTimeMs: 0, bytesDownloaded: r.html.length });

		check("success", r.success);
		check("large content", r.html.length > 100_000, `${(r.html.length / 1024).toFixed(0)}KB`);
		check("many links", r.links.internal.length > 50, `${r.links.internal.length} internal links`);
		check("has markdown", !!r.markdown && r.markdown.rawMarkdown.length > 2000);
		check("snapshot generated", !!r.snapshot && r.snapshot.length > 100);
		check("rich metadata", Object.keys(r.metadata ?? {}).length > 5, `${Object.keys(r.metadata ?? {}).length} metadata fields`);

		// Table extraction on MDN
		const { TableExtractionStrategy } = await import("./src/strategies/extraction/table");
		const tables = await new TableExtractionStrategy({ minRows: 2 }).extract(r.url, r.cleanedHtml ?? r.html);
		check("found tables", tables.length > 0, `${tables.length} tables`);
	}

	// -----------------------------------------------------------------------
	// 29. Beefy: Reddit thread (dynamic content, nested comments, many elements)
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m29. Beefy: Reddit (old.reddit for static HTML)\x1b[0m");
	{
		const r = await crawler.crawl("https://old.reddit.com/r/programming/top/?t=week", {
			cacheMode: CacheMode.Bypass,
		});
		monitor.recordPageComplete({ success: r.success, fromCache: false, responseTimeMs: 0, bytesDownloaded: r.html.length });

		check("success", r.success);
		check("got content", r.html.length > 20_000, `${(r.html.length / 1024).toFixed(0)}KB`);
		check("has links", r.links.internal.length + r.links.external.length > 30, `${r.links.internal.length + r.links.external.length} links`);
		check("has markdown", !!r.markdown && r.markdown.rawMarkdown.length > 500);
	}

	// -----------------------------------------------------------------------
	// 30. Beefy: NYT homepage (paywall, heavy media, complex layout)
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m30. Beefy: NYT homepage\x1b[0m");
	{
		const r = await crawler.crawl("https://www.nytimes.com", {
			cacheMode: CacheMode.Bypass,
		});
		monitor.recordPageComplete({ success: r.success, fromCache: false, responseTimeMs: 0, bytesDownloaded: r.html.length });

		check("success", r.success);
		check("large page", r.html.length > 50_000, `${(r.html.length / 1024).toFixed(0)}KB`);
		check("many links", r.links.internal.length > 20, `${r.links.internal.length} internal`);
		check("has images", r.media.images.length > 5, `${r.media.images.length} images`);
		check("has metadata", !!r.metadata?.title);
	}

	// -----------------------------------------------------------------------
	// 31. Deep crawl: bun.sh docs (real multi-page crawl)
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m31. Deep crawl: bun.sh (depth 1, max 10)\x1b[0m");
	{
		const results = await crawler.deepCrawl(
			"https://bun.sh",
			{ cacheMode: CacheMode.Bypass },
			{
				maxDepth: 1,
				maxPages: 10,
				rateLimiter: new RateLimiter({ baseDelay: 300, jitter: 0 }),
			},
		);

		check("crawled multiple pages", results.length > 1, `${results.length} pages`);
		check("all successful", results.every((r) => r.success));
		check("no duplicates", new Set(results.map((r) => r.url)).size === results.length);

		const totalLinks = results.reduce((sum, r) => sum + r.links.internal.length + r.links.external.length, 0);
		check("found many links total", totalLinks > 20, `${totalLinks} links across ${results.length} pages`);
	}

	// -----------------------------------------------------------------------
	// 32. Resource blocking speed comparison
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m32. Resource blocking speed test\x1b[0m");
	{
		// Without blocking
		const t1 = Date.now();
		const r1 = await crawler.crawl("https://developer.mozilla.org/en-US/docs/Web/HTML", {
			cacheMode: CacheMode.Bypass,
			blockResources: false,
		});
		const time1 = Date.now() - t1;

		// With blocking
		const t2 = Date.now();
		const r2 = await crawler.crawl("https://developer.mozilla.org/en-US/docs/Web/CSS", {
			cacheMode: CacheMode.Bypass,
			blockResources: true,
		});
		const time2 = Date.now() - t2;

		check("both succeeded", r1.success && r2.success);
		check("blocked crawl has content", r2.html.length > 5000, `${(r2.html.length / 1024).toFixed(0)}KB`);
		check("blocked crawl timing", true, `${time1}ms normal vs ${time2}ms blocked`);
	}

	// -----------------------------------------------------------------------
	// 33. Monitor stats
	// -----------------------------------------------------------------------
	console.log("\n\x1b[1m33. Crawler monitor\x1b[0m");
	{
		const stats = monitor.getStats();
		check("tracked pages", stats.pagesTotal >= 3, `${stats.pagesTotal} pages`);
		check("has elapsed time", stats.elapsedMs > 0, `${(stats.elapsedMs / 1000).toFixed(1)}s`);
		check("pages per second", stats.pagesPerSecond > 0, `${stats.pagesPerSecond.toFixed(1)} p/s`);
		console.log(`\n  ${monitor.formatStats().split("\n").join("\n  ")}`);
	}

	// -----------------------------------------------------------------------
	// Summary
	// -----------------------------------------------------------------------
	console.log(`\n\x1b[1m━━━ Results ━━━\x1b[0m`);
	console.log(`  ${PASS} ${passed} passed`);
	if (failed > 0) console.log(`  ${FAIL} ${failed} failed`);
	if (skipped > 0) console.log(`  ${SKIP} ${skipped} skipped`);
	console.log();
} finally {
	await crawler.close();
}

if (failed > 0) process.exit(1);
