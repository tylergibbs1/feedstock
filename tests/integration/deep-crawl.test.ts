import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	CacheMode,
	CompositeScorer,
	FilterChain,
	KeywordRelevanceScorer,
	PathDepthScorer,
	URLPatternFilter,
	WebCrawler,
} from "../../src/index";
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

describe("Deep Crawl - BFS", () => {
	test("crawls start page and follows internal links", async () => {
		const results = await crawler.deepCrawl(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{ maxDepth: 1, maxPages: 10 },
		);

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].success).toBe(true);
		expect(results[0].url).toBe(`${server.url}/`);
	});

	test("respects maxPages limit", async () => {
		const results = await crawler.deepCrawl(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{ maxDepth: 3, maxPages: 2 },
		);

		expect(results.length).toBeLessThanOrEqual(2);
	});

	test("respects maxDepth limit", async () => {
		const results = await crawler.deepCrawl(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{ maxDepth: 0, maxPages: 100 },
		);

		// maxDepth 0 = only the start page
		expect(results.length).toBe(1);
	});

	test("applies filter chain", async () => {
		const filterChain = new FilterChain().add(new URLPatternFilter({ exclude: [/\/products/] }));

		const results = await crawler.deepCrawl(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{ maxDepth: 1, maxPages: 10, filterChain },
		);

		// No results should have /products in the URL
		const productResults = results.filter((r) => r.url.includes("/products"));
		expect(productResults.length).toBe(0);
	});
});

describe("Deep Crawl - Streaming", () => {
	test("streams results as they arrive", async () => {
		const results: string[] = [];

		for await (const result of crawler.deepCrawlStream(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{ maxDepth: 1, maxPages: 5 },
		)) {
			results.push(result.url);
		}

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0]).toBe(`${server.url}/`);
	});
});

describe("Deep Crawl - BestFirst", () => {
	test("uses scorer to prioritize URLs", async () => {
		const scorer = new CompositeScorer()
			.add(new KeywordRelevanceScorer(["products"]))
			.add(new PathDepthScorer());

		const results = await crawler.deepCrawl(
			`${server.url}/`,
			{ cacheMode: CacheMode.Bypass },
			{ maxDepth: 1, maxPages: 5, scorer },
		);

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].success).toBe(true);
	});
});
