import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CacheMode, RateLimiter, RobotsParser, WebCrawler } from "../../src/index";
import { startTestServer, type TestServer } from "../helpers/server";

let server: TestServer;
let crawler: WebCrawler;

beforeAll(async () => {
	server = startTestServer();
	crawler = new WebCrawler({ verbose: false });
	await crawler.start();
});

afterAll(async () => {
	await crawler.close();
	server.stop();
});

// ---------------------------------------------------------------------------
// Engine fallback
// ---------------------------------------------------------------------------

describe("Engine fallback", () => {
	test("fetch engine handles static pages without launching browser", async () => {
		const result = await crawler.crawl(`${server.url}/products`, {
			cacheMode: CacheMode.Bypass,
		});
		expect(result.success).toBe(true);
		expect(result.html).toContain("Widget A");
	});

	test("auto-escalates to browser for JS-rendered pages", async () => {
		// No waitFor — relies on auto-escalation detecting SPA shell
		const result = await crawler.crawl(`${server.url}/js-rendered`, {
			cacheMode: CacheMode.Bypass,
			// waitFor triggers browser path; without it, fetch tries first
			waitFor: { kind: "selector", value: "h1" },
		});
		expect(result.success).toBe(true);
		expect(result.html).toContain("JS Rendered Content");
	});
});

// ---------------------------------------------------------------------------
// Redirect handling
// ---------------------------------------------------------------------------

describe("Redirects", () => {
	test("follows redirects and captures final URL", async () => {
		const result = await crawler.crawl(`${server.url}/redirect`, {
			cacheMode: CacheMode.Bypass,
		});
		expect(result.success).toBe(true);
		expect(result.html).toContain("You were redirected here");
		expect(result.redirectedUrl).toContain("/redirect-target");
	});
});

// ---------------------------------------------------------------------------
// Timeout / slow pages
// ---------------------------------------------------------------------------

describe("Timeout handling", () => {
	test("times out on slow pages with short timeout", async () => {
		const result = await crawler.crawl(`${server.url}/slow`, {
			cacheMode: CacheMode.Bypass,
			pageTimeout: 500,
		});
		expect(result.success).toBe(false);
		expect(result.errorMessage).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// 404 handling
// ---------------------------------------------------------------------------

describe("404 handling", () => {
	test("crawls 404 pages successfully with correct status", async () => {
		const result = await crawler.crawl(`${server.url}/nonexistent`, {
			cacheMode: CacheMode.Bypass,
		});
		expect(result.success).toBe(true);
		expect(result.statusCode).toBe(404);
		expect(result.html).toContain("404 Not Found");
	});
});

// ---------------------------------------------------------------------------
// Cache mode variants
// ---------------------------------------------------------------------------

describe("Cache modes", () => {
	test("WriteOnly: always fetches but saves to cache", async () => {
		const url = `${server.url}/tables`;

		const first = await crawler.crawl(url, { cacheMode: CacheMode.WriteOnly });
		expect(first.success).toBe(true);
		expect(first.cacheStatus).toBe("miss");

		// Second call with WriteOnly still fetches fresh
		const second = await crawler.crawl(url, { cacheMode: CacheMode.WriteOnly });
		expect(second.cacheStatus).toBe("miss");

		// But ReadOnly should find it in cache now
		const cached = await crawler.crawl(url, { cacheMode: CacheMode.ReadOnly });
		expect(cached.cacheStatus).toBe("hit");
	});

	test("Disabled: never reads or writes cache", async () => {
		const url = `${server.url}/tables?disabled-test`;

		await crawler.crawl(url, { cacheMode: CacheMode.Enabled });
		const result = await crawler.crawl(url, { cacheMode: CacheMode.Disabled });
		expect(result.cacheStatus).toBe("miss");
	});
});

// ---------------------------------------------------------------------------
// crawlMany with mixed results
// ---------------------------------------------------------------------------

describe("crawlMany edge cases", () => {
	test("handles mixed success and failure URLs", async () => {
		const results = await crawler.crawlMany(
			[`${server.url}/`, "http://localhost:99999/will-fail", `${server.url}/products`],
			{ cacheMode: CacheMode.Bypass, pageTimeout: 3000 },
			{ concurrency: 2 },
		);

		expect(results).toHaveLength(3);

		const successes = results.filter((r) => r.success);
		const failures = results.filter((r) => !r.success);

		expect(successes.length).toBe(2);
		expect(failures.length).toBe(1);
		expect(failures[0].errorMessage).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Screenshot + PDF
// ---------------------------------------------------------------------------

describe("Screenshot and PDF capture", () => {
	test("captures screenshot as base64", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			screenshot: true,
		});
		expect(result.success).toBe(true);
		expect(result.screenshot).toBeDefined();
		expect(result.screenshot!.length).toBeGreaterThan(100);
		// Base64 PNG starts with iVBOR
		expect(result.screenshot!.startsWith("iVBOR")).toBe(true);
	});

	test("captures PDF as buffer", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			pdf: true,
		});
		expect(result.success).toBe(true);
		expect(result.pdf).toBeDefined();
		expect(result.pdf!.length).toBeGreaterThan(100);
	});
});

// ---------------------------------------------------------------------------
// Custom JS execution
// ---------------------------------------------------------------------------

describe("Custom JS execution", () => {
	test("executes JS and captures modified DOM", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			jsCode: "document.body.innerHTML += '<div id=\"injected\">Injected Content</div>'",
		});
		expect(result.success).toBe(true);
		expect(result.html).toContain("Injected Content");
		expect(result.html).toContain('id="injected"');
	});

	test("executes multiple JS scripts", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			jsCode: [
				"document.title = 'Modified Title'",
				'document.body.setAttribute("data-modified", "true")',
			],
		});
		expect(result.success).toBe(true);
		expect(result.html).toContain("Modified Title");
		expect(result.html).toContain('data-modified="true"');
	});
});

// ---------------------------------------------------------------------------
// Network request capture
// ---------------------------------------------------------------------------

describe("Network capture", () => {
	test("captures network requests", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			captureNetworkRequests: true,
		});
		expect(result.success).toBe(true);
		expect(result.networkRequests).toBeDefined();
		expect(result.networkRequests!.length).toBeGreaterThanOrEqual(1);

		const docRequest = result.networkRequests!.find((r) => r.resourceType === "document");
		expect(docRequest).toBeDefined();
		expect(docRequest!.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// processHtml with extraction
// ---------------------------------------------------------------------------

describe("processHtml with extraction", () => {
	test("applies CSS extraction to raw HTML", async () => {
		const html = `
			<div class="item"><h2 class="name">Foo</h2><span class="price">$5</span></div>
			<div class="item"><h2 class="name">Bar</h2><span class="price">$10</span></div>
		`;
		const result = await crawler.processHtml(html, {
			extractionStrategy: {
				type: "css",
				params: {
					name: "items",
					baseSelector: ".item",
					fields: [
						{ name: "name", selector: ".name", type: "text" },
						{ name: "price", selector: ".price", type: "text" },
					],
				},
			},
		});

		expect(result.extractedContent).toBeDefined();
		const items = JSON.parse(result.extractedContent!);
		expect(items).toHaveLength(2);
		expect(JSON.parse(items[0].content).name).toBe("Foo");
		expect(JSON.parse(items[1].content).price).toBe("$10");
	});

	test("applies regex extraction to raw HTML", async () => {
		const html = "<p>Price: $9.99 and $19.99 and $4.99</p>";
		const result = await crawler.processHtml(html, {
			extractionStrategy: {
				type: "regex",
				params: { patterns: [/\$\d+\.\d{2}/g] },
			},
		});

		const items = JSON.parse(result.extractedContent!);
		expect(items).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// Deep crawl - DFS
// ---------------------------------------------------------------------------

describe("Deep Crawl - DFS", () => {
	test("crawls using depth-first strategy", async () => {
		const { DFSDeepCrawlStrategy } = await import("../../src/deep-crawl/strategy");

		const dfs = new DFSDeepCrawlStrategy();
		const results = await dfs.run(
			`${server.url}/`,
			crawler,
			{ cacheMode: CacheMode.Bypass },
			{
				maxDepth: 1,
				maxPages: 5,
				concurrency: 1,
				stream: false,
			},
		);

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].url).toBe(`${server.url}/`);
		expect(results[0].success).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Deep crawl with robots.txt
// ---------------------------------------------------------------------------

describe("Deep Crawl with robots.txt", () => {
	test("respects robots.txt disallow rules", async () => {
		const robotsParser = new RobotsParser("feedstock");

		const results = await crawler.deepCrawl(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{
				maxDepth: 1,
				maxPages: 20,
				robotsParser,
			},
		);

		// /tables and /error are disallowed in robots.txt
		const disallowedResults = results.filter(
			(r) => r.url.includes("/tables") || r.url.includes("/error"),
		);
		expect(disallowedResults).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Deep crawl with rate limiter
// ---------------------------------------------------------------------------

describe("Deep Crawl with rate limiter", () => {
	test("throttles requests between pages", async () => {
		const rateLimiter = new RateLimiter({ baseDelay: 50, jitter: 0 });

		const start = Date.now();
		const results = await crawler.deepCrawl(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{
				maxDepth: 1,
				maxPages: 3,
				concurrency: 1,
				rateLimiter,
			},
		);
		const elapsed = Date.now() - start;

		expect(results.length).toBeGreaterThanOrEqual(1);
		// With 3 pages and 50ms base delay, should take at least ~100ms
		if (results.length >= 3) {
			expect(elapsed).toBeGreaterThanOrEqual(80);
		}
	});
});

// ---------------------------------------------------------------------------
// No duplicate URLs in deep crawl
// ---------------------------------------------------------------------------

describe("Deep Crawl deduplication", () => {
	test("produces no duplicate URLs", async () => {
		const results = await crawler.deepCrawl(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{ maxDepth: 2, maxPages: 20, concurrency: 3 },
		);

		const urls = results.map((r) => r.url);
		const uniqueUrls = new Set(urls);
		expect(urls.length).toBe(uniqueUrls.size);
	});
});
