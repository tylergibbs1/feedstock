import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findProjectConfig,
	loadConfig,
	loadEnvConfig,
	loadProjectConfig,
} from "../../src/config-loader";

// ---------------------------------------------------------------------------
// findProjectConfig
// ---------------------------------------------------------------------------

describe("findProjectConfig", () => {
	const tmpBase = join(tmpdir(), `feedstock-config-test-${Date.now()}`);
	const nested = join(tmpBase, "a", "b", "c");

	afterEach(() => {
		rmSync(tmpBase, { recursive: true, force: true });
	});

	test("finds feedstock.json in the given directory", () => {
		mkdirSync(tmpBase, { recursive: true });
		writeFileSync(join(tmpBase, "feedstock.json"), "{}");
		expect(findProjectConfig(tmpBase)).toBe(join(tmpBase, "feedstock.json"));
	});

	test("walks up directories to find feedstock.json", () => {
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(tmpBase, "feedstock.json"), "{}");
		const found = findProjectConfig(nested);
		expect(found).toBe(join(tmpBase, "feedstock.json"));
	});

	test("returns null when no config file exists", () => {
		mkdirSync(nested, { recursive: true });
		expect(findProjectConfig(nested)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// loadProjectConfig
// ---------------------------------------------------------------------------

describe("loadProjectConfig", () => {
	const tmpFile = join(tmpdir(), `feedstock-proj-${Date.now()}.json`);

	afterEach(() => {
		rmSync(tmpFile, { force: true });
	});

	test("returns empty object for null path", () => {
		expect(loadProjectConfig(null)).toEqual({});
	});

	test("parses valid feedstock.json", () => {
		writeFileSync(
			tmpFile,
			JSON.stringify({
				browser: { headless: false, browserType: "firefox" },
				crawl: { pageTimeout: 30000 },
			}),
		);
		const config = loadProjectConfig(tmpFile);
		expect(config.browser?.headless).toBe(false);
		expect(config.browser?.browserType).toBe("firefox");
		expect(config.crawl?.pageTimeout).toBe(30000);
	});

	test("returns empty object for invalid JSON", () => {
		writeFileSync(tmpFile, "not valid json {{{");
		expect(loadProjectConfig(tmpFile)).toEqual({});
	});

	test("returns empty object for nonexistent file", () => {
		expect(loadProjectConfig("/nonexistent/feedstock.json")).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// loadEnvConfig
// ---------------------------------------------------------------------------

describe("loadEnvConfig", () => {
	const savedEnv: Record<string, string | undefined> = {};
	const envKeys = [
		"FEEDSTOCK_BROWSER_TYPE",
		"FEEDSTOCK_HEADLESS",
		"FEEDSTOCK_USER_AGENT",
		"FEEDSTOCK_STEALTH",
		"FEEDSTOCK_VERBOSE",
		"FEEDSTOCK_TEXT_MODE",
		"FEEDSTOCK_CDP_URL",
		"FEEDSTOCK_PROXY",
		"FEEDSTOCK_PROXY_USERNAME",
		"FEEDSTOCK_PROXY_PASSWORD",
		"FEEDSTOCK_PAGE_TIMEOUT",
		"FEEDSTOCK_SCREENSHOT",
		"FEEDSTOCK_BLOCK_RESOURCES",
		"FEEDSTOCK_GENERATE_MARKDOWN",
	];

	function setEnv(overrides: Record<string, string>) {
		for (const key of envKeys) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
		for (const [key, val] of Object.entries(overrides)) {
			process.env[key] = val;
		}
	}

	afterEach(() => {
		for (const key of envKeys) {
			if (savedEnv[key] !== undefined) {
				process.env[key] = savedEnv[key];
			} else {
				delete process.env[key];
			}
		}
	});

	test("returns empty config when no env vars set", () => {
		setEnv({});
		const config = loadEnvConfig();
		expect(Object.keys(config.browser)).toHaveLength(0);
		expect(Object.keys(config.crawl)).toHaveLength(0);
	});

	test("maps FEEDSTOCK_BROWSER_TYPE", () => {
		setEnv({ FEEDSTOCK_BROWSER_TYPE: "firefox" });
		const config = loadEnvConfig();
		expect(config.browser.browserType).toBe("firefox");
	});

	test("maps FEEDSTOCK_HEADLESS=false", () => {
		setEnv({ FEEDSTOCK_HEADLESS: "false" });
		const config = loadEnvConfig();
		expect(config.browser.headless).toBe(false);
	});

	test("maps FEEDSTOCK_HEADLESS=true", () => {
		setEnv({ FEEDSTOCK_HEADLESS: "true" });
		const config = loadEnvConfig();
		expect(config.browser.headless).toBe(true);
	});

	test("maps FEEDSTOCK_CDP_URL to cdp backend", () => {
		setEnv({ FEEDSTOCK_CDP_URL: "ws://remote:9222" });
		const config = loadEnvConfig();
		expect(config.browser.backend).toEqual({ kind: "cdp", wsUrl: "ws://remote:9222" });
	});

	test("maps FEEDSTOCK_PROXY with auth", () => {
		setEnv({
			FEEDSTOCK_PROXY: "http://proxy:8080",
			FEEDSTOCK_PROXY_USERNAME: "user",
			FEEDSTOCK_PROXY_PASSWORD: "pass",
		});
		const config = loadEnvConfig();
		expect(config.browser.proxy).toEqual({
			server: "http://proxy:8080",
			username: "user",
			password: "pass",
		});
	});

	test("maps FEEDSTOCK_PAGE_TIMEOUT to number", () => {
		setEnv({ FEEDSTOCK_PAGE_TIMEOUT: "15000" });
		const config = loadEnvConfig();
		expect(config.crawl.pageTimeout).toBe(15000);
	});

	test("maps FEEDSTOCK_SCREENSHOT=true", () => {
		setEnv({ FEEDSTOCK_SCREENSHOT: "true" });
		const config = loadEnvConfig();
		expect(config.crawl.screenshot).toBe(true);
	});

	test("maps FEEDSTOCK_BLOCK_RESOURCES=true", () => {
		setEnv({ FEEDSTOCK_BLOCK_RESOURCES: "true" });
		const config = loadEnvConfig();
		expect(config.crawl.blockResources).toBe(true);
	});

	test("maps FEEDSTOCK_BLOCK_RESOURCES=false", () => {
		setEnv({ FEEDSTOCK_BLOCK_RESOURCES: "false" });
		const config = loadEnvConfig();
		expect(config.crawl.blockResources).toBe(false);
	});

	test("maps FEEDSTOCK_BLOCK_RESOURCES=fast to profile string", () => {
		setEnv({ FEEDSTOCK_BLOCK_RESOURCES: "fast" });
		const config = loadEnvConfig();
		expect(config.crawl.blockResources).toBe("fast");
	});

	test("maps FEEDSTOCK_BLOCK_RESOURCES=minimal to profile string", () => {
		setEnv({ FEEDSTOCK_BLOCK_RESOURCES: "minimal" });
		const config = loadEnvConfig();
		expect(config.crawl.blockResources).toBe("minimal");
	});

	test("maps FEEDSTOCK_BLOCK_RESOURCES=media-only to profile string", () => {
		setEnv({ FEEDSTOCK_BLOCK_RESOURCES: "media-only" });
		const config = loadEnvConfig();
		expect(config.crawl.blockResources).toBe("media-only");
	});

	test("maps FEEDSTOCK_GENERATE_MARKDOWN=false", () => {
		setEnv({ FEEDSTOCK_GENERATE_MARKDOWN: "false" });
		const config = loadEnvConfig();
		expect(config.crawl.generateMarkdown).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// loadConfig (integrated)
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
	const tmpDir = join(tmpdir(), `feedstock-layered-${Date.now()}`);

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		delete process.env.FEEDSTOCK_HEADLESS;
	});

	test("returns empty when no config file and no env vars", () => {
		mkdirSync(tmpDir, { recursive: true });
		const config = loadConfig({ startDir: tmpDir });
		expect(config.configPath).toBeNull();
		expect(Object.keys(config.browser)).toHaveLength(0);
		expect(Object.keys(config.crawl)).toHaveLength(0);
	});

	test("loads from feedstock.json", () => {
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(join(tmpDir, "feedstock.json"), JSON.stringify({ browser: { headless: false } }));
		const config = loadConfig({ startDir: tmpDir });
		expect(config.configPath).toBe(join(tmpDir, "feedstock.json"));
		expect(config.browser.headless).toBe(false);
	});

	test("env vars override project file", () => {
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(join(tmpDir, "feedstock.json"), JSON.stringify({ browser: { headless: false } }));
		process.env.FEEDSTOCK_HEADLESS = "true";
		const config = loadConfig({ startDir: tmpDir });
		expect(config.browser.headless).toBe(true);
	});
});
