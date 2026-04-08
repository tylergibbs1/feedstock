/**
 * Regression tests — verify existing behavior is preserved after
 * the agent-browser-patterns feature additions.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CrawlCache,
	createBrowserConfig,
	createCrawlerRunConfig,
	CacheMode,
	createEmptyLinks,
	createEmptyMedia,
	createErrorResult,
	NoExtractionStrategy,
	CssExtractionStrategy,
	RegexExtractionStrategy,
	buildStaticSnapshot,
} from "../../src/index";

// ---------------------------------------------------------------------------
// Config regressions
// ---------------------------------------------------------------------------

describe("Config regressions", () => {
	test("BrowserConfig defaults unchanged", () => {
		const config = createBrowserConfig();
		expect(config.browserType).toBe("chromium");
		expect(config.headless).toBe(true);
		expect(config.viewport).toEqual({ width: 1920, height: 1080 });
		expect(config.userAgent).toBeNull();
		expect(config.proxy).toBeNull();
		expect(config.ignoreHttpsErrors).toBe(true);
		expect(config.javaEnabled).toBe(true);
		expect(config.extraArgs).toEqual([]);
		expect(config.textMode).toBe(false);
		expect(config.verbose).toBe(false);
		expect(config.backend).toEqual({ kind: "playwright" });
		expect(config.stealth).toBe(false);
	});

	test("CrawlerRunConfig defaults unchanged", () => {
		const config = createCrawlerRunConfig();
		expect(config.cacheMode).toBe(CacheMode.Enabled);
		expect(config.wordCountThreshold).toBe(10);
		expect(config.pageTimeout).toBe(60_000);
		expect(config.navigationWaitUntil).toBe("domcontentloaded");
		expect(config.generateMarkdown).toBe(true);
		expect(config.screenshot).toBe(false);
		expect(config.pdf).toBe(false);
		expect(config.extractionStrategy).toBeNull();
		expect(config.sessionId).toBeNull();
		expect(config.snapshot).toBe(false);
		expect(config.blockResources).toBe(false);
		expect(config.simulateUser).toBe(false);
		expect(config.magicMode).toBe(false);
	});

	test("blockResources still accepts boolean true for backward compat", () => {
		const config = createCrawlerRunConfig({ blockResources: true });
		expect(config.blockResources).toBe(true);
	});

	test("blockResources accepts string profiles", () => {
		const config = createCrawlerRunConfig({ blockResources: "fast" });
		expect(config.blockResources).toBe("fast");
	});

	test("existing backend types still work", () => {
		const pw = createBrowserConfig({ backend: { kind: "playwright" } });
		expect(pw.backend.kind).toBe("playwright");

		const lpLocal = createBrowserConfig({
			backend: { kind: "lightpanda", mode: "local", port: 9222 },
		});
		expect(lpLocal.backend.kind).toBe("lightpanda");

		const lpCloud = createBrowserConfig({
			backend: { kind: "lightpanda", mode: "cloud", token: "tok" },
		});
		expect(lpCloud.backend.kind).toBe("lightpanda");
	});
});

// ---------------------------------------------------------------------------
// Cache regressions
// ---------------------------------------------------------------------------

const REGRESSION_DB = join(tmpdir(), `feedstock-regression-${Date.now()}.db`);

describe("Cache regressions", () => {
	let cache: CrawlCache;

	beforeEach(() => {
		cache = new CrawlCache(REGRESSION_DB);
		cache.clear();
	});

	afterAll(() => {
		cache.close();
		for (const suffix of ["", "-wal", "-shm"]) {
			const path = REGRESSION_DB + suffix;
			if (existsSync(path)) unlinkSync(path);
		}
	});

	test("get/set still works without contentHash", () => {
		cache.set("https://example.com", '{"success":true}');
		const cached = cache.get("https://example.com");
		expect(cached).not.toBeNull();
		expect(cached!.result).toBe('{"success":true}');
		expect(cached!.cachedAt).toBeGreaterThan(0);
	});

	test("set with etag/lastModified still works", () => {
		cache.set("https://example.com", "result", {
			etag: '"abc123"',
			lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
		});
		const cached = cache.get("https://example.com");
		expect(cached!.result).toBe("result");
	});

	test("setMany still works without contentHash", () => {
		cache.setMany([
			{ url: "https://a.com", result: "a" },
			{ url: "https://b.com", result: "b" },
		]);
		expect(cache.get("https://a.com")!.result).toBe("a");
		expect(cache.get("https://b.com")!.result).toBe("b");
	});

	test("delete still works", () => {
		cache.set("https://example.com", "data");
		cache.delete("https://example.com");
		expect(cache.get("https://example.com")).toBeNull();
	});

	test("clear still works", () => {
		cache.set("https://a.com", "a");
		cache.set("https://b.com", "b");
		cache.clear();
		expect(cache.size).toBe(0);
	});

	test("pruneOlderThan still works", () => {
		cache.set("https://example.com", "old");
		// Prune everything older than 0ms ago (i.e., nothing — just set it)
		const removed = cache.pruneOlderThan(0);
		// Entry was just created, shouldn't be pruned with 0ms threshold
		expect(removed).toBe(0);
	});

	test("size still works", () => {
		cache.set("https://a.com", "a");
		cache.set("https://b.com", "b");
		expect(cache.size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Model regressions
// ---------------------------------------------------------------------------

describe("Model regressions", () => {
	test("createErrorResult shape unchanged", () => {
		const result = createErrorResult("https://fail.com", "timeout");
		expect(result.url).toBe("https://fail.com");
		expect(result.success).toBe(false);
		expect(result.errorMessage).toBe("timeout");
		expect(result.html).toBe("");
		expect(result.cleanedHtml).toBeNull();
		expect(result.markdown).toBeNull();
		expect(result.screenshot).toBeNull();
		expect(result.snapshot).toBeNull();
		expect(result.interactiveElements).toBeNull();
		expect(result.cacheStatus).toBeNull();
	});

	test("createEmptyMedia shape unchanged", () => {
		const media = createEmptyMedia();
		expect(media).toEqual({ images: [], videos: [], audios: [] });
	});

	test("createEmptyLinks shape unchanged", () => {
		const links = createEmptyLinks();
		expect(links).toEqual({ internal: [], external: [] });
	});
});

// ---------------------------------------------------------------------------
// Extraction strategy regressions
// ---------------------------------------------------------------------------

describe("Extraction strategy regressions", () => {
	const html = `<div class="item"><h2>Title</h2><span class="price">$10</span></div>`;

	test("NoExtractionStrategy still returns HTML as-is", async () => {
		const strategy = new NoExtractionStrategy();
		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(1);
		expect(items[0].content).toBe(html);
		expect(items[0].index).toBe(0);
	});

	test("CssExtractionStrategy still works", async () => {
		const strategy = new CssExtractionStrategy({
			name: "items",
			baseSelector: ".item",
			fields: [
				{ name: "title", selector: "h2", type: "text" },
				{ name: "price", selector: ".price", type: "text" },
			],
		});
		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(1);
		const data = JSON.parse(items[0].content);
		expect(data.title).toBe("Title");
		expect(data.price).toBe("$10");
	});

	test("RegexExtractionStrategy still works", async () => {
		const strategy = new RegexExtractionStrategy([/\$\d+/g]);
		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(1);
		expect(items[0].content).toBe("$10");
	});
});

// ---------------------------------------------------------------------------
// Snapshot regressions
// ---------------------------------------------------------------------------

describe("Snapshot regressions", () => {
	const pageHtml = `<html><body>
		<h1>Title</h1>
		<a href="/page">Link</a>
		<button>Click</button>
		<p>A sufficiently long paragraph to be included in snapshot output.</p>
	</body></html>`;

	test("buildStaticSnapshot still produces correct structure", () => {
		const snap = buildStaticSnapshot(pageHtml);
		expect(snap.tree.length).toBeGreaterThan(0);
		expect(snap.refs.size).toBeGreaterThan(0);
		expect(snap.nodeCount).toBeGreaterThan(0);
		expect(snap.text).toContain("[heading]");
		expect(snap.text).toContain("[link]");
		expect(snap.text).toContain("[button]");
	});

	test("snapshot refs map is consistent", () => {
		const snap = buildStaticSnapshot(pageHtml);
		for (const [ref, info] of snap.refs) {
			expect(ref).toMatch(/^e\d+$/);
			expect(info.role).toBeTruthy();
		}
	});
});
