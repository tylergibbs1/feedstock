import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CacheMode } from "../../src/cache/mode";
import type { CrawlerRunConfig } from "../../src/config";
import { WebCrawler } from "../../src/crawler";
import type { CrawlResponse } from "../../src/models";
import { CrawlerStrategy } from "../../src/strategies/crawler-strategy";

const tempPaths: string[] = [];

class FixtureStrategy extends CrawlerStrategy {
	requests: Array<{ url: string; config: CrawlerRunConfig }> = [];

	async start(): Promise<void> {}
	async close(): Promise<void> {}

	async crawl(url: string, config: CrawlerRunConfig): Promise<CrawlResponse> {
		this.requests.push({ url, config });
		const delay = url.includes("slow") ? 25 : 0;
		if (delay) await Bun.sleep(delay);
		return {
			html: `<html><head><title>Fixture</title></head><body><nav>Noise</nav><main><h1>${url}</h1><p>This is useful main content with enough words for the default threshold.</p><a href="child">Child</a><img src="data:image/png;base64,abc"></main></body></html>`,
			responseHeaders: { "content-type": "text/html; charset=utf-8" },
			statusCode: 200,
			screenshot: null,
			pdfData: null,
			redirectedUrl: url.includes("redirect") ? "https://final.example/docs/page" : null,
			networkRequests: null,
			consoleMessages: null,
		};
	}
}

afterEach(() => {
	for (const path of tempPaths.splice(0)) {
		if (existsSync(path)) rmSync(path, { recursive: true, force: true });
	}
});

describe("modern crawler contracts", () => {
	test("scrape returns only requested formats with main-content defaults", async () => {
		const strategy = new FixtureStrategy();
		const crawler = new WebCrawler({ crawlerStrategy: strategy });
		try {
			const document = await crawler.scrape("https://example.com/start", {
				formats: ["markdown", "links", "images"],
				cacheMode: CacheMode.Bypass,
			});
			expect(document.markdown).toContain("useful main content");
			expect(document.markdown).not.toContain("Noise");
			expect(document.links).toContain("https://example.com/child");
			expect(document.images).toEqual([]);
			expect(document.markdown).not.toContain("data:image");
			expect(document.rawHtml).toBeUndefined();
		} finally {
			await crawler.close();
		}
	});

	test("uses the redirected URL as the base for relative links", async () => {
		const crawler = new WebCrawler({ crawlerStrategy: new FixtureStrategy() });
		try {
			const result = await crawler.crawl("https://origin.example/redirect", {
				cacheMode: CacheMode.Bypass,
				wordCountThreshold: 0,
			});
			expect(result.links.internal[0].href).toBe("https://final.example/docs/child");
			expect(result.metadata?.url).toBe("https://final.example/docs/page");
		} finally {
			await crawler.close();
		}
	});

	test("cache identity includes output-affecting configuration", async () => {
		const cacheDir = join(tmpdir(), `feedstock-modern-cache-${Date.now()}`);
		tempPaths.push(cacheDir);
		const strategy = new FixtureStrategy();
		const crawler = new WebCrawler({ crawlerStrategy: strategy, cacheDir });
		try {
			const first = await crawler.crawl("https://example.com/cache", { wordCountThreshold: 0 });
			const hit = await crawler.crawl("https://example.com/cache", { wordCountThreshold: 0 });
			const different = await crawler.crawl("https://example.com/cache", {
				wordCountThreshold: 0,
				onlyMainContent: true,
			});
			expect(first.cacheStatus).toBe("miss");
			expect(hit.cacheStatus).toBe("hit");
			expect(different.cacheStatus).toBe("miss");
			expect(strategy.requests).toHaveLength(2);
			expect(existsSync(join(cacheDir, "cache.db"))).toBe(true);
		} finally {
			await crawler.close();
		}
	});

	test("cacheMaxAgeMs zero always fetches fresh", async () => {
		const cacheDir = join(tmpdir(), `feedstock-modern-fresh-${Date.now()}`);
		tempPaths.push(cacheDir);
		const strategy = new FixtureStrategy();
		const crawler = new WebCrawler({ crawlerStrategy: strategy, cacheDir });
		try {
			await crawler.crawl("https://example.com/fresh", { cacheMaxAgeMs: 0 });
			await crawler.crawl("https://example.com/fresh", { cacheMaxAgeMs: 0 });
			expect(strategy.requests).toHaveLength(2);
		} finally {
			await crawler.close();
		}
	});

	test("cache does not conflate paths whose trailing slash can be significant", async () => {
		const cacheDir = join(tmpdir(), `feedstock-modern-paths-${Date.now()}`);
		tempPaths.push(cacheDir);
		const strategy = new FixtureStrategy();
		const crawler = new WebCrawler({ crawlerStrategy: strategy, cacheDir });
		try {
			await crawler.crawl("https://example.com/path", { wordCountThreshold: 0 });
			await crawler.crawl("https://example.com/path/", { wordCountThreshold: 0 });
			expect(strategy.requests).toHaveLength(2);
		} finally {
			await crawler.close();
		}
	});

	test("rejects non-HTTP URLs before invoking an engine", async () => {
		const strategy = new FixtureStrategy();
		const crawler = new WebCrawler({ crawlerStrategy: strategy });
		const result = await crawler.crawl("ftp://example.com/file");
		expect(result.success).toBe(false);
		expect(result.errorMessage).toContain("valid absolute URL");
		expect(strategy.requests).toHaveLength(0);
	});

	test("crawlMany preserves input order while reporting completion", async () => {
		const crawler = new WebCrawler({ crawlerStrategy: new FixtureStrategy() });
		const completionOrder: number[] = [];
		try {
			const urls = ["https://example.com/slow", "https://example.com/fast"];
			const results = await crawler.crawlMany(
				urls,
				{ cacheMode: CacheMode.Bypass, wordCountThreshold: 0 },
				{ concurrency: 2, onProgress: (_result, index) => completionOrder.push(index) },
			);
			expect(results.map((result) => result.url)).toEqual(urls);
			expect(completionOrder).toEqual([1, 0]);
		} finally {
			await crawler.close();
		}
	});
});
