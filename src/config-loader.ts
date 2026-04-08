/**
 * Layered configuration loader.
 *
 * Precedence (highest wins):
 *   1. Programmatic overrides (passed to createBrowserConfig / createCrawlerRunConfig)
 *   2. Environment variables (FEEDSTOCK_*)
 *   3. Project config file (feedstock.json in cwd or ancestors)
 *   4. Built-in defaults
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BrowserConfig, CrawlerRunConfig } from "./config";

// ---------------------------------------------------------------------------
// Project config file
// ---------------------------------------------------------------------------

export interface FeedstockProjectConfig {
	browser?: Partial<BrowserConfig>;
	crawl?: Partial<CrawlerRunConfig>;
}

/**
 * Search for feedstock.json starting from `startDir` and walking up.
 * Returns null if not found.
 */
export function findProjectConfig(startDir?: string): string | null {
	let dir = resolve(startDir ?? process.cwd());

	for (let i = 0; i < 50; i++) {
		const candidate = join(dir, "feedstock.json");
		if (existsSync(candidate)) return candidate;

		const parent = dirname(dir);
		if (parent === dir) break; // filesystem root
		dir = parent;
	}

	return null;
}

/**
 * Load and parse a feedstock.json file.
 * Returns empty config if path is null or file is invalid.
 */
export function loadProjectConfig(path: string | null): FeedstockProjectConfig {
	if (!path) return {};
	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as FeedstockProjectConfig;
	} catch {
		return {};
	}
}

// ---------------------------------------------------------------------------
// Environment variable mapping
// ---------------------------------------------------------------------------

/** Map FEEDSTOCK_* env vars to config overrides. */
export function loadEnvConfig(): {
	browser: Partial<BrowserConfig>;
	crawl: Partial<CrawlerRunConfig>;
} {
	const browser: Record<string, unknown> = {};
	const crawl: Record<string, unknown> = {};

	const env = Bun.env;

	// Browser config
	if (env.FEEDSTOCK_BROWSER_TYPE) browser.browserType = env.FEEDSTOCK_BROWSER_TYPE;
	if (env.FEEDSTOCK_HEADLESS !== undefined) browser.headless = env.FEEDSTOCK_HEADLESS !== "false";
	if (env.FEEDSTOCK_USER_AGENT) browser.userAgent = env.FEEDSTOCK_USER_AGENT;
	if (env.FEEDSTOCK_STEALTH !== undefined) browser.stealth = env.FEEDSTOCK_STEALTH === "true";
	if (env.FEEDSTOCK_VERBOSE !== undefined) browser.verbose = env.FEEDSTOCK_VERBOSE === "true";
	if (env.FEEDSTOCK_TEXT_MODE !== undefined) browser.textMode = env.FEEDSTOCK_TEXT_MODE === "true";

	// CDP backend from env
	if (env.FEEDSTOCK_CDP_URL) {
		browser.backend = { kind: "cdp" as const, wsUrl: env.FEEDSTOCK_CDP_URL };
	}

	// Proxy from env
	if (env.FEEDSTOCK_PROXY) {
		browser.proxy = {
			server: env.FEEDSTOCK_PROXY,
			...(env.FEEDSTOCK_PROXY_USERNAME && { username: env.FEEDSTOCK_PROXY_USERNAME }),
			...(env.FEEDSTOCK_PROXY_PASSWORD && { password: env.FEEDSTOCK_PROXY_PASSWORD }),
		};
	}

	// Crawl config
	if (env.FEEDSTOCK_PAGE_TIMEOUT) crawl.pageTimeout = parseInt(env.FEEDSTOCK_PAGE_TIMEOUT, 10);
	if (env.FEEDSTOCK_SCREENSHOT !== undefined)
		crawl.screenshot = env.FEEDSTOCK_SCREENSHOT === "true";
	if (env.FEEDSTOCK_BLOCK_RESOURCES !== undefined) {
		const val = env.FEEDSTOCK_BLOCK_RESOURCES;
		if (val === "true") crawl.blockResources = true;
		else if (val === "false") crawl.blockResources = false;
		else crawl.blockResources = val; // profile name: "fast", "minimal", "media-only"
	}
	if (env.FEEDSTOCK_GENERATE_MARKDOWN !== undefined)
		crawl.generateMarkdown = env.FEEDSTOCK_GENERATE_MARKDOWN !== "false";

	return {
		browser: browser as Partial<BrowserConfig>,
		crawl: crawl as Partial<CrawlerRunConfig>,
	};
}

// ---------------------------------------------------------------------------
// Merged loader
// ---------------------------------------------------------------------------

export interface LayeredConfig {
	browser: Partial<BrowserConfig>;
	crawl: Partial<CrawlerRunConfig>;
	/** Path to the project config file that was loaded, if any */
	configPath: string | null;
}

/**
 * Load configuration from all layers (project file + env vars).
 * Does NOT include built-in defaults or programmatic overrides —
 * those are applied by createBrowserConfig / createCrawlerRunConfig.
 *
 * @example
 * ```ts
 * const layered = loadConfig();
 * const browserConfig = createBrowserConfig({ ...layered.browser, ...myOverrides });
 * const crawlConfig = createCrawlerRunConfig({ ...layered.crawl, ...myOverrides });
 * ```
 */
export function loadConfig(opts: { startDir?: string } = {}): LayeredConfig {
	const configPath = findProjectConfig(opts.startDir);
	const project = loadProjectConfig(configPath);
	const env = loadEnvConfig();

	return {
		browser: { ...project.browser, ...env.browser },
		crawl: { ...project.crawl, ...env.crawl },
		configPath,
	};
}
