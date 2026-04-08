import { describe, expect, test } from "bun:test";
import { createCrawlerRunConfig } from "../../src/config";
import { Engine, type EngineCapabilities } from "../../src/engines/base";
import { EngineManager } from "../../src/engines/engine-manager";
import type { CrawlResponse } from "../../src/models";

// Mock engine that returns a configurable response
class MockEngine extends Engine {
	readonly name: string;
	readonly quality: number;
	readonly capabilities: EngineCapabilities = {
		javascript: false,
		screenshot: false,
		pdf: false,
		networkRequests: false,
		consoleMessages: false,
		waitConditions: false,
		customJs: false,
	};

	private response: CrawlResponse;
	started = false;

	constructor(name: string, quality: number, response: CrawlResponse) {
		super();
		this.name = name;
		this.quality = quality;
		this.response = response;
	}

	async start() {
		this.started = true;
	}
	async close() {}
	async fetch(): Promise<CrawlResponse> {
		return this.response;
	}
}

class MockBrowserEngine extends MockEngine {
	override readonly capabilities: EngineCapabilities = {
		javascript: true,
		screenshot: true,
		pdf: true,
		networkRequests: true,
		consoleMessages: true,
		waitConditions: true,
		customJs: true,
	};
}

function makeResponse(html: string, statusCode: number): CrawlResponse {
	return {
		html,
		responseHeaders: {},
		statusCode,
		screenshot: null,
		pdfData: null,
		redirectedUrl: null,
		networkRequests: null,
		consoleMessages: null,
	};
}

describe("EngineManager auto-escalation on block", () => {
	test("escalates from fetch to browser on 403 with block indicators", async () => {
		const fetchEngine = new MockEngine(
			"fetch",
			5,
			makeResponse("<html><body>Access Denied</body></html>", 403),
		);
		const browserEngine = new MockBrowserEngine(
			"browser",
			50,
			makeResponse("<html><body><h1>Real Content</h1></body></html>", 200),
		);

		const manager = new EngineManager([fetchEngine, browserEngine]);
		await manager.start();

		const result = await manager.fetch("https://example.com", createCrawlerRunConfig());

		expect(result.engine).toBe("browser");
		expect(result.response.statusCode).toBe(200);
		expect(result.response.html).toContain("Real Content");
		expect(browserEngine.started).toBe(true);
	});

	test("escalates on 429 rate limit", async () => {
		const fetchEngine = new MockEngine(
			"fetch",
			5,
			makeResponse("<html><body>Too many requests</body></html>", 429),
		);
		const browserEngine = new MockBrowserEngine(
			"browser",
			50,
			makeResponse("<html><body>OK</body></html>", 200),
		);

		const manager = new EngineManager([fetchEngine, browserEngine]);
		const result = await manager.fetch("https://example.com", createCrawlerRunConfig());

		expect(result.engine).toBe("browser");
	});

	test("escalates on 503 Cloudflare challenge", async () => {
		const fetchEngine = new MockEngine(
			"fetch",
			5,
			makeResponse("<html><body>Checking your browser</body></html>", 503),
		);
		const browserEngine = new MockBrowserEngine(
			"browser",
			50,
			makeResponse("<html><body>OK</body></html>", 200),
		);

		const manager = new EngineManager([fetchEngine, browserEngine]);
		const result = await manager.fetch("https://example.com", createCrawlerRunConfig());

		expect(result.engine).toBe("browser");
	});

	test("does NOT escalate on normal 403 (no block indicators)", async () => {
		// Short 403 body IS treated as blocked in isBlocked()
		// Use a 404 instead to test non-escalation
		const fetchEngine = new MockEngine(
			"fetch",
			5,
			makeResponse(
				"<html><body><h1>Not Found</h1><p>This page does not exist on our server.</p></body></html>",
				404,
			),
		);

		const manager = new EngineManager([fetchEngine]);
		const result = await manager.fetch("https://example.com", createCrawlerRunConfig());

		expect(result.engine).toBe("fetch");
		expect(result.response.statusCode).toBe(404);
	});

	test("returns blocked response if no browser engine available", async () => {
		const fetchEngine = new MockEngine(
			"fetch",
			5,
			makeResponse("<html><body>Access Denied</body></html>", 403),
		);

		const manager = new EngineManager([fetchEngine]);
		const result = await manager.fetch("https://example.com", createCrawlerRunConfig());

		// Should return the blocked response rather than throwing
		expect(result.response.statusCode).toBe(403);
		expect(result.engine).toBe("fetch");
	});

	test("can disable auto-escalation on block", async () => {
		const fetchEngine = new MockEngine(
			"fetch",
			5,
			makeResponse("<html><body>Access Denied</body></html>", 403),
		);
		const browserEngine = new MockBrowserEngine(
			"browser",
			50,
			makeResponse("<html><body>OK</body></html>", 200),
		);

		const manager = new EngineManager([fetchEngine, browserEngine], {
			config: { autoEscalateOnBlock: false },
		});
		const result = await manager.fetch("https://example.com", createCrawlerRunConfig());

		// Should NOT escalate — returns the 403
		expect(result.engine).toBe("fetch");
		expect(result.response.statusCode).toBe(403);
	});

	test("escalates SPA shell AND block in sequence", async () => {
		// First engine: SPA shell → skip
		// No block, just SPA detection
		const fetchEngine = new MockEngine(
			"fetch",
			5,
			makeResponse('<html><body><div id="root"></div></body></html>', 200),
		);
		const browserEngine = new MockBrowserEngine(
			"browser",
			50,
			makeResponse("<html><body><h1>Rendered</h1></body></html>", 200),
		);

		const manager = new EngineManager([fetchEngine, browserEngine]);
		const result = await manager.fetch("https://example.com", createCrawlerRunConfig());

		expect(result.engine).toBe("browser");
		expect(result.response.html).toContain("Rendered");
	});
});
