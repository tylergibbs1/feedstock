// ---------------------------------------------------------------------------
// Hydration-Aware Page Readiness Detection
//
// Detects when SPA content is ready by monitoring hydration markers and
// content stability, instead of waiting for all network activity to stop.
// Based on insights from MRAH (Modular Rendering and Adaptive Hydration).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HydrationConfig {
	/** Selectors for main content areas */
	contentSelectors: string[];
	/** Minimum text length to consider content "ready" */
	minContentLength: number;
	/** Absolute max wait time in ms */
	maxWaitMs: number;
	/** How often to check in ms */
	pollIntervalMs: number;
	/** How many consecutive stable polls before ready */
	stabilityChecks: number;
	/** Time content must be stable in ms */
	stabilityThresholdMs: number;
}

export interface HydrationResult {
	ready: boolean;
	waitedMs: number;
	contentLength: number;
	detectedFramework: string | null;
	hydrationComplete: boolean;
	readyReason: string;
}

type Framework = "react" | "vue" | "svelte" | "angular" | "next" | "nuxt";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_HYDRATION_CONFIG: HydrationConfig = {
	contentSelectors: ["main", "article", "[role=main]", "#content", ".content"],
	minContentLength: 100,
	maxWaitMs: 10_000,
	pollIntervalMs: 100,
	stabilityChecks: 3,
	stabilityThresholdMs: 300,
};

export function createHydrationConfig(
	overrides?: Partial<HydrationConfig>,
): HydrationConfig {
	return { ...DEFAULT_HYDRATION_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Pure detection functions (testable outside the browser)
// ---------------------------------------------------------------------------

const FRAMEWORK_MARKERS: ReadonlyArray<{
	framework: Framework;
	patterns: ReadonlyArray<string>;
}> = [
	// Order matters: more specific frameworks first (Next before React, Nuxt before Vue)
	{
		framework: "next",
		patterns: ["__NEXT_DATA__"],
	},
	{
		framework: "nuxt",
		patterns: ["__NUXT__", "__nuxt"],
	},
	{
		framework: "react",
		patterns: [
			"_reactRootContainer",
			"__react-root",
			"data-reactroot",
		],
	},
	{
		framework: "vue",
		patterns: ["__VUE__"],
	},
	{
		framework: "svelte",
		patterns: ["__svelte"],
	},
	{
		framework: "angular",
		patterns: ["ng-version", "ng-app"],
	},
];

/**
 * Detect which SPA framework (if any) is present in the HTML.
 * Returns null for static pages with no framework markers.
 */
export function detectFramework(html: string): Framework | null {
	for (const { framework, patterns } of FRAMEWORK_MARKERS) {
		for (const pattern of patterns) {
			if (html.includes(pattern)) return framework;
		}
	}
	return null;
}

/**
 * Returns true when the HTML has no SPA framework markers,
 * meaning it is likely a static page that needs no hydration wait.
 */
export function isStaticPage(html: string): boolean {
	return detectFramework(html) === null;
}

const LOADING_PLACEHOLDERS = [
	"loading",
	"spinner",
	"skeleton",
	"please wait",
];

/**
 * Check whether the HTML already has enough content to be considered ready.
 * Works on a raw HTML string — intended for unit-testing the heuristic
 * without a browser.
 */
export function isContentReady(
	html: string,
	config: HydrationConfig,
): { ready: boolean; contentLength: number; reason: string } {
	// Build a minimal DOM from the HTML (works in both Bun and browser via
	// a simple regex-based text extraction — no dependency on a full parser).
	const textOf = (fragment: string): string =>
		fragment.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

	// Try each content selector by extracting matching elements via regex.
	for (const selector of config.contentSelectors) {
		const pattern = selectorToRegex(selector);
		if (!pattern) continue;
		const match = html.match(pattern);
		if (match) {
			const text = textOf(match[0]);
			if (text.length >= config.minContentLength) {
				// Check it's not just a loading placeholder
				const lower = text.toLowerCase();
				const isPlaceholder = LOADING_PLACEHOLDERS.some(
					(p) => lower === p || lower === `${p}...`,
				);
				if (isPlaceholder) {
					return {
						ready: false,
						contentLength: text.length,
						reason: "content is a loading placeholder",
					};
				}
				return {
					ready: true,
					contentLength: text.length,
					reason: `content selector "${selector}" has ${text.length} chars`,
				};
			}
		}
	}

	// Fallback: check <body>
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	if (bodyMatch) {
		const text = textOf(bodyMatch[1]);
		if (text.length >= config.minContentLength) {
			const lower = text.toLowerCase();
			const isPlaceholder = LOADING_PLACEHOLDERS.some(
				(p) => lower === p || lower === `${p}...`,
			);
			if (isPlaceholder) {
				return {
					ready: false,
					contentLength: text.length,
					reason: "body content is a loading placeholder",
				};
			}
			return {
				ready: true,
				contentLength: text.length,
				reason: `body fallback has ${text.length} chars`,
			};
		}
		return {
			ready: false,
			contentLength: text.length,
			reason: `content below minContentLength (${text.length} < ${config.minContentLength})`,
		};
	}

	return { ready: false, contentLength: 0, reason: "no content found" };
}

/**
 * Convert a simple CSS selector to a regex that extracts the outermost
 * matching element. Supports tag, #id, .class, and [attr] selectors.
 */
function selectorToRegex(selector: string): RegExp | null {
	// tag name
	if (/^[a-z][a-z0-9]*$/i.test(selector)) {
		return new RegExp(
			`<${selector}[^>]*>[\\s\\S]*?<\\/${selector}>`,
			"i",
		);
	}
	// #id
	if (selector.startsWith("#")) {
		const id = selector.slice(1);
		return new RegExp(
			`<[a-z][a-z0-9]*[^>]*\\bid=["']?${escapeRegex(id)}["']?[^>]*>[\\s\\S]*?<\\/[a-z][a-z0-9]*>`,
			"i",
		);
	}
	// .class
	if (selector.startsWith(".")) {
		const cls = selector.slice(1);
		return new RegExp(
			`<[a-z][a-z0-9]*[^>]*\\bclass=["'][^"']*\\b${escapeRegex(cls)}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/[a-z][a-z0-9]*>`,
			"i",
		);
	}
	// [attr] or [attr=value]
	const attrMatch = selector.match(/^\[([a-z-]+)(?:=([^\]]+))?\]$/i);
	if (attrMatch) {
		const attr = attrMatch[1];
		const val = attrMatch[2];
		if (val) {
			return new RegExp(
				`<[a-z][a-z0-9]*[^>]*\\b${escapeRegex(attr)}=["']?${escapeRegex(val)}["']?[^>]*>[\\s\\S]*?<\\/[a-z][a-z0-9]*>`,
				"i",
			);
		}
		return new RegExp(
			`<[a-z][a-z0-9]*[^>]*\\b${escapeRegex(attr)}[^>]*>[\\s\\S]*?<\\/[a-z][a-z0-9]*>`,
			"i",
		);
	}
	return null;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Browser-side detector script
// ---------------------------------------------------------------------------

/**
 * Returns a self-contained JavaScript function body (as a string) that can
 * be passed to `page.evaluate()`. The function polls the DOM for content
 * readiness and resolves with a `HydrationResult`.
 */
export function createHydrationDetectorScript(
	config: HydrationConfig,
): string {
	// Inline all config values so the script is fully self-contained.
	return `() => new Promise((resolve) => {
	const CONTENT_SELECTORS = ${JSON.stringify(config.contentSelectors)};
	const MIN_CONTENT_LENGTH = ${config.minContentLength};
	const MAX_WAIT_MS = ${config.maxWaitMs};
	const POLL_INTERVAL_MS = ${config.pollIntervalMs};
	const STABILITY_CHECKS = ${config.stabilityChecks};
	const STABILITY_THRESHOLD_MS = ${config.stabilityThresholdMs};

	const FRAMEWORK_MARKERS = [
		{ framework: "next", patterns: ["__NEXT_DATA__"] },
		{ framework: "nuxt", patterns: ["__NUXT__", "__nuxt"] },
		{ framework: "react", patterns: ["_reactRootContainer", "__react-root", "data-reactroot"] },
		{ framework: "vue", patterns: ["__VUE__"] },
		{ framework: "svelte", patterns: ["__svelte"] },
		{ framework: "angular", patterns: ["ng-version", "ng-app"] },
	];

	function detectFramework() {
		const html = document.documentElement.outerHTML;
		for (const { framework, patterns } of FRAMEWORK_MARKERS) {
			for (const p of patterns) {
				if (html.includes(p)) return framework;
			}
		}
		return null;
	}

	function getContentLength() {
		for (const sel of CONTENT_SELECTORS) {
			const el = document.querySelector(sel);
			if (el) {
				const text = (el.textContent || "").trim();
				if (text.length > 0) return text.length;
			}
		}
		// Fallback to body
		return (document.body.textContent || "").trim().length;
	}

	function checkHydrationMarkers(framework) {
		if (!framework) return false;
		switch (framework) {
			case "react":
			case "next": {
				const root = document.querySelector("[data-reactroot]");
				if (root && (root.textContent || "").trim().length > 0) return true;
				// Check for React 18+ root
				if (typeof window.__NEXT_DATA__ !== "undefined") return true;
				return false;
			}
			case "vue":
			case "nuxt": {
				if (typeof window.__VUE_SSR_CONTEXT__ !== "undefined") return true;
				const nuxt = document.getElementById("__nuxt");
				if (nuxt && (nuxt.textContent || "").trim().length > 0) return true;
				return false;
			}
			default:
				return false;
		}
	}

	const framework = detectFramework();

	// Static page: resolve immediately
	if (!framework) {
		const len = getContentLength();
		resolve({
			ready: true,
			waitedMs: 0,
			contentLength: len,
			detectedFramework: null,
			hydrationComplete: true,
			readyReason: "static page — no SPA framework detected",
		});
		return;
	}

	const startTime = Date.now();
	let stableCount = 0;
	let lastLength = -1;

	const timer = setInterval(() => {
		const elapsed = Date.now() - startTime;
		const contentLength = getContentLength();
		const hydrationDone = checkHydrationMarkers(framework);

		// Check content stability
		if (contentLength === lastLength) {
			stableCount++;
		} else {
			stableCount = 0;
			lastLength = contentLength;
		}

		const contentReady =
			contentLength >= MIN_CONTENT_LENGTH &&
			stableCount >= STABILITY_CHECKS;

		// Ready: content stable and long enough
		if (contentReady) {
			clearInterval(timer);
			resolve({
				ready: true,
				waitedMs: elapsed,
				contentLength,
				detectedFramework: framework,
				hydrationComplete: hydrationDone,
				readyReason: "content stable for " + (stableCount * POLL_INTERVAL_MS) + "ms with " + contentLength + " chars",
			});
			return;
		}

		// Ready: framework-specific markers say hydration is done
		if (hydrationDone && contentLength >= MIN_CONTENT_LENGTH) {
			clearInterval(timer);
			resolve({
				ready: true,
				waitedMs: elapsed,
				contentLength,
				detectedFramework: framework,
				hydrationComplete: true,
				readyReason: "framework hydration markers indicate completion",
			});
			return;
		}

		// Timeout
		if (elapsed >= MAX_WAIT_MS) {
			clearInterval(timer);
			resolve({
				ready: contentLength >= MIN_CONTENT_LENGTH,
				waitedMs: elapsed,
				contentLength,
				detectedFramework: framework,
				hydrationComplete: hydrationDone,
				readyReason: "timeout after " + MAX_WAIT_MS + "ms",
			});
			return;
		}
	}, POLL_INTERVAL_MS);
})`;
}

// ---------------------------------------------------------------------------
// Playwright integration
// ---------------------------------------------------------------------------

/**
 * Wait for page content to be ready using hydration-aware detection.
 * Use this instead of arbitrary waitAfterLoad delays.
 *
 * @param page - Playwright Page object (typed as `any` to avoid hard dependency)
 * @param overrides - Optional partial config overrides
 */
export async function waitForHydration(
	page: any,
	overrides?: Partial<HydrationConfig>,
): Promise<HydrationResult> {
	const config = createHydrationConfig(overrides);
	const script = createHydrationDetectorScript(config);
	return page.evaluate(script) as Promise<HydrationResult>;
}
