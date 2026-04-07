import { describe, expect, test } from "bun:test";
import { CacheMode, createBrowserConfig, createCrawlerRunConfig } from "../../src/index";

describe("BrowserConfig", () => {
	test("creates with sensible defaults", () => {
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
	});

	test("accepts partial overrides", () => {
		const config = createBrowserConfig({
			browserType: "firefox",
			headless: false,
			viewport: { width: 1024, height: 768 },
		});
		expect(config.browserType).toBe("firefox");
		expect(config.headless).toBe(false);
		expect(config.viewport).toEqual({ width: 1024, height: 768 });
		// Defaults preserved
		expect(config.ignoreHttpsErrors).toBe(true);
	});

	test("accepts proxy config", () => {
		const config = createBrowserConfig({
			proxy: { server: "http://proxy:8080", username: "user", password: "pass" },
		});
		expect(config.proxy).toEqual({
			server: "http://proxy:8080",
			username: "user",
			password: "pass",
		});
	});

	test("defaults to playwright backend", () => {
		const config = createBrowserConfig();
		expect(config.backend).toEqual({ kind: "playwright" });
	});

	test("accepts lightpanda local backend", () => {
		const config = createBrowserConfig({
			backend: { kind: "lightpanda", mode: "local", host: "127.0.0.1", port: 9333 },
		});
		expect(config.backend.kind).toBe("lightpanda");
		if (config.backend.kind === "lightpanda") {
			expect(config.backend.mode).toBe("local");
			if (config.backend.mode === "local") {
				expect(config.backend.port).toBe(9333);
			}
		}
	});

	test("accepts lightpanda cloud backend", () => {
		const config = createBrowserConfig({
			backend: {
				kind: "lightpanda",
				mode: "cloud",
				token: "my-token",
				endpoint: "wss://custom.lightpanda.io/ws",
			},
		});
		expect(config.backend.kind).toBe("lightpanda");
		if (config.backend.kind === "lightpanda") {
			expect(config.backend.mode).toBe("cloud");
			if (config.backend.mode === "cloud") {
				expect(config.backend.token).toBe("my-token");
				expect(config.backend.endpoint).toBe("wss://custom.lightpanda.io/ws");
			}
		}
	});
});

describe("CrawlerRunConfig", () => {
	test("creates with sensible defaults", () => {
		const config = createCrawlerRunConfig();
		expect(config.cacheMode).toBe(CacheMode.Enabled);
		expect(config.wordCountThreshold).toBe(10);
		expect(config.excludeTags).toEqual([]);
		expect(config.includeTags).toEqual([]);
		expect(config.jsCode).toBeNull();
		expect(config.waitFor).toBeNull();
		expect(config.waitAfterLoad).toBe(0);
		expect(config.pageTimeout).toBe(60_000);
		expect(config.screenshot).toBe(false);
		expect(config.pdf).toBe(false);
		expect(config.generateMarkdown).toBe(true);
		expect(config.extractionStrategy).toBeNull();
		expect(config.sessionId).toBeNull();
	});

	test("accepts partial overrides", () => {
		const config = createCrawlerRunConfig({
			cacheMode: CacheMode.Disabled,
			screenshot: true,
			pageTimeout: 30_000,
			excludeTags: ["nav", "footer"],
		});
		expect(config.cacheMode).toBe(CacheMode.Disabled);
		expect(config.screenshot).toBe(true);
		expect(config.pageTimeout).toBe(30_000);
		expect(config.excludeTags).toEqual(["nav", "footer"]);
		// Defaults preserved
		expect(config.generateMarkdown).toBe(true);
	});

	test("accepts wait conditions", () => {
		const config = createCrawlerRunConfig({
			waitFor: { kind: "selector", value: "#content", timeout: 5000 },
		});
		expect(config.waitFor).toEqual({
			kind: "selector",
			value: "#content",
			timeout: 5000,
		});
	});

	test("accepts extraction strategy config", () => {
		const config = createCrawlerRunConfig({
			extractionStrategy: {
				type: "css",
				params: {
					name: "products",
					baseSelector: ".product",
					fields: [{ name: "title", selector: "h2", type: "text" }],
				},
			},
		});
		expect(config.extractionStrategy?.type).toBe("css");
	});
});
