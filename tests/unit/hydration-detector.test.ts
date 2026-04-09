import { describe, expect, it } from "bun:test";
import {
	createHydrationConfig,
	createHydrationDetectorScript,
	detectFramework,
	isContentReady,
	isStaticPage,
	waitForHydration,
	type HydrationConfig,
	type HydrationResult,
} from "../../src/utils/hydration-detector";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("createHydrationConfig", () => {
	it("applies defaults when called with no arguments", () => {
		const config = createHydrationConfig();
		expect(config.contentSelectors).toEqual([
			"main",
			"article",
			"[role=main]",
			"#content",
			".content",
		]);
		expect(config.minContentLength).toBe(100);
		expect(config.maxWaitMs).toBe(10_000);
		expect(config.pollIntervalMs).toBe(100);
		expect(config.stabilityChecks).toBe(3);
		expect(config.stabilityThresholdMs).toBe(300);
	});

	it("merges custom overrides with defaults", () => {
		const config = createHydrationConfig({
			minContentLength: 50,
			maxWaitMs: 5_000,
		});
		expect(config.minContentLength).toBe(50);
		expect(config.maxWaitMs).toBe(5_000);
		// Defaults preserved
		expect(config.pollIntervalMs).toBe(100);
		expect(config.contentSelectors).toContain("main");
	});
});

// ---------------------------------------------------------------------------
// Detector script generation
// ---------------------------------------------------------------------------

describe("createHydrationDetectorScript", () => {
	const config = createHydrationConfig();

	it("returns a valid JS function string", () => {
		const script = createHydrationDetectorScript(config);
		expect(script).toStartWith("() => new Promise");
		// Should be parseable as JS (wrap in parens to make it an expression)
		expect(() => new Function(`return (${script})`)).not.toThrow();
	});

	it("includes framework detection logic", () => {
		const script = createHydrationDetectorScript(config);
		expect(script).toContain("detectFramework");
		expect(script).toContain("__NEXT_DATA__");
		expect(script).toContain("__NUXT__");
		expect(script).toContain("__VUE__");
		expect(script).toContain("ng-version");
	});

	it("includes content stability polling", () => {
		const script = createHydrationDetectorScript(config);
		expect(script).toContain("stableCount");
		expect(script).toContain("setInterval");
		expect(script).toContain("STABILITY_CHECKS");
	});

	it("embeds custom contentSelectors in the script", () => {
		const custom = createHydrationConfig({
			contentSelectors: ["#my-app", ".custom-root"],
		});
		const script = createHydrationDetectorScript(custom);
		expect(script).toContain("#my-app");
		expect(script).toContain(".custom-root");
	});
});

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

describe("detectFramework", () => {
	it('returns "next" for HTML with __NEXT_DATA__', () => {
		const html =
			'<html><head><script id="__NEXT_DATA__">{}</script></head><body></body></html>';
		expect(detectFramework(html)).toBe("next");
	});

	it('returns "react" for HTML with data-reactroot', () => {
		const html =
			'<html><body><div id="root" data-reactroot="">Hello</div></body></html>';
		expect(detectFramework(html)).toBe("react");
	});

	it('returns "nuxt" for HTML with __NUXT__', () => {
		const html =
			"<html><body><script>window.__NUXT__={}</script></body></html>";
		expect(detectFramework(html)).toBe("nuxt");
	});

	it('returns "angular" for HTML with ng-version', () => {
		const html =
			'<html><body><app-root ng-version="16.0.0">App</app-root></body></html>';
		expect(detectFramework(html)).toBe("angular");
	});

	it('returns "vue" for HTML with __VUE__', () => {
		const html =
			"<html><body><div id='app'></div><script>window.__VUE__={}</script></body></html>";
		expect(detectFramework(html)).toBe("vue");
	});

	it('returns "svelte" for HTML with __svelte', () => {
		const html =
			'<html><body><div class="__svelte-abc">Content</div></body></html>';
		expect(detectFramework(html)).toBe("svelte");
	});

	it("returns null for plain HTML", () => {
		const html =
			"<html><head><title>Hello</title></head><body><p>Just text</p></body></html>";
		expect(detectFramework(html)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Static page detection
// ---------------------------------------------------------------------------

describe("isStaticPage", () => {
	it("returns true for plain HTML with no SPA markers", () => {
		const html =
			"<html><body><h1>Welcome</h1><p>Static content</p></body></html>";
		expect(isStaticPage(html)).toBe(true);
	});

	it("returns false for HTML with React markers", () => {
		const html =
			'<html><body><div data-reactroot="">App</div></body></html>';
		expect(isStaticPage(html)).toBe(false);
	});

	it("returns false for HTML with Vue markers", () => {
		const html =
			"<html><body><script>window.__VUE__={}</script></body></html>";
		expect(isStaticPage(html)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Content readiness heuristics
// ---------------------------------------------------------------------------

describe("isContentReady", () => {
	const config = createHydrationConfig();

	it("returns ready when <main> has substantial content", () => {
		const html = `<html><body><main>${"This is real content. ".repeat(10)}</main></body></html>`;
		const result = isContentReady(html, config);
		expect(result.ready).toBe(true);
		expect(result.contentLength).toBeGreaterThanOrEqual(100);
		expect(result.reason).toContain("main");
	});

	it('returns not ready when content is just "Loading..."', () => {
		const html =
			"<html><body><main>Loading...</main></body></html>";
		const result = isContentReady(html, config);
		expect(result.ready).toBe(false);
	});

	it("falls back to body text when no content selectors match", () => {
		const html = `<html><body><div>${"Lots of body text here for testing. ".repeat(10)}</div></body></html>`;
		const result = isContentReady(html, config);
		expect(result.ready).toBe(true);
		expect(result.reason).toContain("body fallback");
	});

	it("returns not ready when content is below minContentLength", () => {
		const html = "<html><body><main>Short</main></body></html>";
		const result = isContentReady(html, config);
		expect(result.ready).toBe(false);
		expect(result.reason).toContain("minContentLength");
	});

	it("returns not ready for empty HTML", () => {
		const html = "<html><body></body></html>";
		const result = isContentReady(html, config);
		expect(result.ready).toBe(false);
		expect(result.contentLength).toBe(0);
	});

	it("respects custom minContentLength", () => {
		const short = createHydrationConfig({ minContentLength: 5 });
		const html = "<html><body><main>Hello World</main></body></html>";
		expect(isContentReady(html, short).ready).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Integration: waitForHydration
// ---------------------------------------------------------------------------

describe("waitForHydration", () => {
	it("calls page.evaluate with the detector script", async () => {
		const mockResult: HydrationResult = {
			ready: true,
			waitedMs: 150,
			contentLength: 500,
			detectedFramework: "react",
			hydrationComplete: true,
			readyReason: "content stable",
		};
		const mockPage = {
			evaluate: async (_script: string) => mockResult,
		};

		const result = await waitForHydration(mockPage);
		expect(result).toEqual(mockResult);
	});

	it("uses default config when called with true-like overrides", async () => {
		let capturedScript = "";
		const mockPage = {
			evaluate: async (script: string) => {
				capturedScript = script;
				return {
					ready: true,
					waitedMs: 0,
					contentLength: 200,
					detectedFramework: null,
					hydrationComplete: true,
					readyReason: "static page",
				};
			},
		};

		await waitForHydration(mockPage);
		// Default selectors should be in the script
		expect(capturedScript).toContain('"main"');
		expect(capturedScript).toContain('"article"');
	});

	it("passes custom selectors through to the script", async () => {
		let capturedScript = "";
		const mockPage = {
			evaluate: async (script: string) => {
				capturedScript = script;
				return {
					ready: true,
					waitedMs: 0,
					contentLength: 200,
					detectedFramework: null,
					hydrationComplete: true,
					readyReason: "static page",
				};
			},
		};

		await waitForHydration(mockPage, {
			contentSelectors: ["#my-app", ".special"],
		});
		expect(capturedScript).toContain("#my-app");
		expect(capturedScript).toContain(".special");
	});
});
