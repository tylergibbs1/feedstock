import { CacheMode } from "./cache/mode";
import type { Logger } from "./utils/logger";

// ---------------------------------------------------------------------------
// Browser Configuration
// ---------------------------------------------------------------------------

export type BrowserType = "chromium" | "firefox" | "webkit";

export type BrowserBackend =
	| { kind: "playwright" }
	| { kind: "cdp"; wsUrl: string }
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

export type ResourceBlockProfile = "fast" | "minimal" | "media-only";

export type BlockResourcesConfig =
	| boolean
	| ResourceBlockProfile
	| { patterns?: string[]; resourceTypes?: string[] };

export type BrowserAction =
	| { type: "wait"; milliseconds?: number; selector?: string; timeout?: number }
	| { type: "click"; selector: string; timeout?: number }
	| { type: "fill"; selector: string; value: string; timeout?: number }
	| { type: "write"; text: string }
	| { type: "press"; key: string; selector?: string }
	| { type: "scroll"; direction: "up" | "down"; amount?: number; selector?: string }
	| { type: "screenshot"; fullPage?: boolean; quality?: number }
	| { type: "scrape" }
	| { type: "executeJavascript"; script: string };

export interface RequestRetryConfig {
	/** Total attempts, including the first request. */
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
	jitter: number;
	statuses: number[];
	respectRetryAfter: boolean;
}

export type ContentFilterConfig =
	| { type: "pruning"; minWords?: number }
	| { type: "bm25"; query: string; threshold?: number };

export interface CrawlerRunConfig {
	// Content
	wordCountThreshold: number;
	excludeTags: string[];
	includeTags: string[];
	removeOverlayElements: boolean;
	onlyMainContent: boolean;
	contentFilter: ContentFilterConfig | null;
	removeBase64Images: boolean;

	// Caching
	cacheMode: CacheMode;
	/** Maximum acceptable cache age. null keeps entries indefinitely. */
	cacheMaxAgeMs: number | null;

	// Browser behavior
	jsCode: string | string[] | null;
	waitFor: WaitForType | null;
	waitAfterLoad: number;
	pageTimeout: number;
	/** Maximum response body accepted by the fetch engine. */
	maxResponseBytes: number;
	headers: Record<string, string>;
	actions: BrowserAction[];
	/** Optional caller cancellation signal. */
	signal: AbortSignal | null;
	retry: RequestRetryConfig;
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
	/** Block resources during crawl. Boolean for backward compat, or a profile name, or custom config. */
	blockResources: BlockResourcesConfig;

	// Anti-bot
	simulateUser: boolean;
	magicMode: boolean;
	removeConsentPopups: boolean;
}

export interface ExtractionStrategyConfig {
	type: string;
	params: Record<string, unknown>;
}

/** Public per-crawl overrides; nested retry settings may be supplied partially. */
export type CrawlerRunConfigOverrides = Omit<Partial<CrawlerRunConfig>, "retry"> & {
	retry?: Partial<RequestRetryConfig>;
};

const DEFAULT_CRAWLER_RUN_CONFIG: CrawlerRunConfig = {
	wordCountThreshold: 10,
	excludeTags: [],
	includeTags: [],
	removeOverlayElements: false,
	onlyMainContent: false,
	contentFilter: null,
	removeBase64Images: false,

	cacheMode: CacheMode.Enabled,
	cacheMaxAgeMs: 48 * 60 * 60 * 1000,

	jsCode: null,
	waitFor: null,
	waitAfterLoad: 0,
	pageTimeout: 60_000,
	maxResponseBytes: 10 * 1024 * 1024,
	headers: {},
	actions: [],
	signal: null,
	retry: {
		maxAttempts: 3,
		baseDelayMs: 500,
		maxDelayMs: 10_000,
		jitter: 0.2,
		statuses: [408, 425, 429, 500, 502, 503, 504],
		respectRetryAfter: true,
	},
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
	overrides: CrawlerRunConfigOverrides = {},
): CrawlerRunConfig {
	const config: CrawlerRunConfig = {
		...DEFAULT_CRAWLER_RUN_CONFIG,
		...overrides,
		headers: { ...DEFAULT_CRAWLER_RUN_CONFIG.headers, ...overrides.headers },
		retry: { ...DEFAULT_CRAWLER_RUN_CONFIG.retry, ...overrides.retry },
	};

	if (config.magicMode) {
		config.removeConsentPopups = overrides.removeConsentPopups ?? true;
		config.simulateUser = overrides.simulateUser ?? true;
		config.blockResources = overrides.blockResources ?? "media-only";
	}

	return config;
}
