import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CacheMode, WebCrawler } from "../../src/index";
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

describe("WebCrawler - basic crawling", () => {
	test("crawls a page successfully", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
		});

		expect(result.success).toBe(true);
		expect(result.url).toBe(`${server.url}/`);
		expect(result.html).toContain("Welcome to Test Site");
		expect(result.statusCode).toBe(200);
	});

	test("returns cleaned HTML without scripts/styles", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
		});

		expect(result.cleanedHtml).toBeDefined();
		expect(result.cleanedHtml).not.toContain("<script");
		expect(result.cleanedHtml).not.toContain("<style");
		expect(result.cleanedHtml).toContain("Welcome to Test Site");
	});

	test("extracts links (internal and external)", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
		});

		expect(result.links.internal.length).toBeGreaterThanOrEqual(2);
		expect(result.links.external.length).toBeGreaterThanOrEqual(1);

		const externalLink = result.links.external.find((l) => l.href.includes("external.com"));
		expect(externalLink).toBeDefined();
	});

	test("extracts media items", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
		});

		expect(result.media.images.length).toBeGreaterThanOrEqual(1);
		const hero = result.media.images.find((i) => i.src.includes("hero.jpg"));
		expect(hero).toBeDefined();
		expect(hero!.alt).toBe("Hero image");
	});

	test("extracts metadata", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
		});

		expect(result.metadata).toBeDefined();
		expect(result.metadata!.title).toBe("Test Home Page");
		expect(result.metadata!.description).toBe("A test page for Feedstock crawler");
	});

	test("generates markdown", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
		});

		expect(result.markdown).toBeDefined();
		expect(result.markdown!.rawMarkdown).toContain("Welcome to Test Site");
		expect(result.markdown!.rawMarkdown.length).toBeGreaterThan(0);
	});
});

describe("WebCrawler - JS rendering", () => {
	test("renders JavaScript content", async () => {
		const result = await crawler.crawl(`${server.url}/js-rendered`, {
			cacheMode: CacheMode.Bypass,
			waitFor: { kind: "selector", value: "h1" },
		});

		expect(result.success).toBe(true);
		expect(result.html).toContain("JS Rendered Content");
	});
});

describe("WebCrawler - error handling", () => {
	test("handles 500 errors gracefully", async () => {
		const result = await crawler.crawl(`${server.url}/error`, {
			cacheMode: CacheMode.Bypass,
		});

		expect(result.success).toBe(true); // Still succeeds, just with 500 status
		expect(result.statusCode).toBe(500);
	});

	test("handles invalid URLs", async () => {
		const result = await crawler.crawl("http://localhost:99999/nonexistent", {
			cacheMode: CacheMode.Bypass,
			pageTimeout: 5000,
		});

		expect(result.success).toBe(false);
		expect(result.errorMessage).toBeDefined();
	});
});

describe("WebCrawler - configuration", () => {
	test("excludes specified tags", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			excludeTags: ["nav", "footer"],
		});

		expect(result.cleanedHtml).not.toContain("About");
		expect(result.cleanedHtml).toContain("Main Article");
	});

	test("applies CSS selector filter", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			cssSelector: "article",
		});

		expect(result.cleanedHtml).toContain("Main Article");
	});

	test("disables markdown generation", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			generateMarkdown: false,
		});

		expect(result.markdown).toBeNull();
	});
});

describe("WebCrawler - caching", () => {
	test("caches results and returns cache hit", async () => {
		const url = `${server.url}/products`;

		// First crawl - miss
		const first = await crawler.crawl(url, {
			cacheMode: CacheMode.Enabled,
		});
		expect(first.success).toBe(true);
		expect(first.cacheStatus).toBe("miss");

		// Second crawl - hit
		const second = await crawler.crawl(url, {
			cacheMode: CacheMode.Enabled,
		});
		expect(second.success).toBe(true);
		expect(second.cacheStatus).toBe("hit");
		expect(second.cachedAt).toBeGreaterThan(0);
	});

	test("bypasses cache when configured", async () => {
		const url = `${server.url}/products`;

		await crawler.crawl(url, { cacheMode: CacheMode.Enabled });
		const result = await crawler.crawl(url, { cacheMode: CacheMode.Bypass });
		expect(result.cacheStatus).toBe("miss");
	});
});

describe("WebCrawler - extraction", () => {
	test("applies CSS extraction strategy", async () => {
		const result = await crawler.crawl(`${server.url}/products`, {
			cacheMode: CacheMode.Bypass,
			extractionStrategy: {
				type: "css",
				params: {
					name: "products",
					baseSelector: ".product",
					fields: [
						{ name: "name", selector: ".product-name", type: "text" },
						{ name: "price", selector: ".price", type: "text" },
						{ name: "description", selector: ".description", type: "text" },
					],
				},
			},
		});

		expect(result.extractedContent).toBeDefined();
		const items = JSON.parse(result.extractedContent!);
		expect(items.length).toBe(3);
		expect(JSON.parse(items[0].content).name).toBe("Widget A");
		expect(JSON.parse(items[0].content).price).toBe("$9.99");
	});
});

describe("WebCrawler - crawlMany", () => {
	test("crawls multiple URLs concurrently", async () => {
		const urls = [`${server.url}/`, `${server.url}/products`, `${server.url}/tables`];

		const results = await crawler.crawlMany(urls, {
			cacheMode: CacheMode.Bypass,
		});

		expect(results).toHaveLength(3);
		expect(results.every((r) => r.success)).toBe(true);
	});
});

describe("WebCrawler - processHtml", () => {
	test("processes raw HTML without browser", async () => {
		const html = `
      <html>
        <head><title>Raw</title></head>
        <body>
          <h1>Raw HTML</h1>
          <p>Processed without a browser.</p>
          <a href="https://example.com">Link</a>
        </body>
      </html>
    `;

		const result = await crawler.processHtml(html);
		expect(result.success).toBe(true);
		expect(result.cleanedHtml).toContain("Raw HTML");
		expect(result.markdown?.rawMarkdown).toContain("Raw HTML");
		expect(result.links.external.length).toBeGreaterThanOrEqual(1);
	});
});
