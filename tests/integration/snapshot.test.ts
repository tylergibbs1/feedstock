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

describe("Snapshot integration", () => {
	test("generates static snapshot from crawled page", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
			snapshot: true,
		});

		expect(result.success).toBe(true);
		expect(result.snapshot).toBeDefined();
		expect(result.snapshot).not.toBeNull();
		expect(result.snapshot!).toContain("[heading]");
		expect(result.snapshot!).toContain("[link]");
		expect(result.snapshot!).toContain("@e");
	});

	test("snapshot disabled by default", async () => {
		const result = await crawler.crawl(`${server.url}/`, {
			cacheMode: CacheMode.Bypass,
		});

		expect(result.snapshot).toBeNull();
	});

	test("processHtml generates snapshot", async () => {
		const html =
			"<html><body><h1>Test</h1><a href='/page'>Link</a><button>Click</button></body></html>";
		const result = await crawler.processHtml(html, { snapshot: true });

		expect(result.snapshot).toBeDefined();
		expect(result.snapshot!).toContain("[heading]");
		expect(result.snapshot!).toContain("[link]");
		expect(result.snapshot!).toContain("[button]");
	});
});

describe("AI-friendly errors", () => {
	test("connection refused gives friendly message", async () => {
		const result = await crawler.crawl("http://localhost:99999/nope", {
			cacheMode: CacheMode.Bypass,
			pageTimeout: 3000,
		});

		expect(result.success).toBe(false);
		expect(result.errorMessage).toBeDefined();
		// Should be a friendly message, not raw stack trace
		expect(result.errorMessage!.length).toBeLessThan(200);
	});
});
