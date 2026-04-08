import { CacheMode } from "./cache/mode";
import type { Logger } from "./utils/logger";

// ---------------------------------------------------------------------------
// Browser Configuration
// ---------------------------------------------------------------------------

export type BrowserType = "chromium" | "firefox" | "webkit";

export type BrowserBackend =
	| { kind: "playwright" }
	| { kind: "lightpanda"; mode: "local"; host?: string; port?: number }
	| { kind: "lightpanda"; mode: "cloud"; token: string; endpoint?: string };

export interface BrowserConfig {
	browserType: BrowserType;
	headless: boolean;
	viewport: { width: number; height: number };
	userAgent: string | null;
	proxy: ProxyConfig | null;
	ignoreHttpsErrors: boolean;
	javaEnabled: boolean;
	extraArgs: string[];
	textMode: boolean;
	logger: Logger | null;
	verbose: boolean;
	backend: BrowserBackend;
	/** Enable stealth mode: randomize user-agent, override navigator.webdriver, simulate human behavior */
	stealth: boolean;
}

export interface ProxyConfig {
	server: string;
	username?: string;
	password?: string;
}

const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
	browserType: "chromium",
	headless: true,
	viewport: { width: 1920, height: 1080 },
	userAgent: null,
	proxy: null,
	ignoreHttpsErrors: true,
	javaEnabled: true,
	extraArgs: [],
	textMode: false,
	logger: null,
	verbose: false,
	backend: { kind: "playwright" },
	stealth: false,
};

export function createBrowserConfig(overrides: Partial<BrowserConfig> = {}): BrowserConfig {
	return { ...DEFAULT_BROWSER_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Crawler Run Configuration
// ---------------------------------------------------------------------------

export type WaitForType =
	| { kind: "selector"; value: string; timeout?: number }
	| { kind: "networkIdle"; timeout?: number }
	| { kind: "delay"; ms: number }
	| { kind: "function"; fn: string; timeout?: number };

export interface CrawlerRunConfig {
	// Content
	wordCountThreshold: number;
	excludeTags: string[];
	includeTags: string[];
	removeOverlayElements: boolean;

	// Caching
	cacheMode: CacheMode;

	// Browser behavior
	jsCode: string | string[] | null;
	waitFor: WaitForType | null;
	waitAfterLoad: number;
	pageTimeout: number;
	/** Navigation wait strategy: "domcontentloaded" (default), "load", "networkidle", or "commit" (fastest) */
	navigationWaitUntil: "domcontentloaded" | "load" | "networkidle" | "commit";

	// Capture
	screenshot: boolean;
	pdf: boolean;
	captureNetworkRequests: boolean;
	captureConsoleMessages: boolean;

	// Extraction
	extractionStrategy: ExtractionStrategyConfig | null;
	cssSelector: string | null;

	// Session
	sessionId: string | null;

	// Markdown
	generateMarkdown: boolean;

	// Snapshot
	snapshot: boolean;
	detectInteractiveElements: boolean;
	inlineIframes: boolean;

	// Performance
	/** Block images, CSS, fonts, and media during crawl for faster page loads */
	blockResources: boolean;

	// Anti-bot
	simulateUser: boolean;
	magicMode: boolean;
	removeConsentPopups: boolean;
}

export interface ExtractionStrategyConfig {
	type: string;
	params: Record<string, unknown>;
}

const DEFAULT_CRAWLER_RUN_CONFIG: CrawlerRunConfig = {
	wordCountThreshold: 10,
	excludeTags: [],
	includeTags: [],
	removeOverlayElements: false,

	cacheMode: CacheMode.Enabled,

	jsCode: null,
	waitFor: null,
	waitAfterLoad: 0,
	pageTimeout: 60_000,
	navigationWaitUntil: "domcontentloaded",

	screenshot: false,
	pdf: false,
	captureNetworkRequests: false,
	captureConsoleMessages: false,

	extractionStrategy: null,
	cssSelector: null,

	sessionId: null,

	generateMarkdown: true,

	snapshot: false,
	detectInteractiveElements: false,
	inlineIframes: false,

	blockResources: false,

	simulateUser: false,
	magicMode: false,
	removeConsentPopups: false,
};

export function createCrawlerRunConfig(
	overrides: Partial<CrawlerRunConfig> = {},
): CrawlerRunConfig {
	return { ...DEFAULT_CRAWLER_RUN_CONFIG, ...overrides };
}
