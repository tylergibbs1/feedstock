import { describe, expect, test } from "bun:test";
import {
	type FingerprintProfile,
	applyEnhancedStealth,
	applyFingerprintProfile,
	buildFingerprintScript,
	generateProfile,
	generateRandomProfile,
} from "../../src/browser/fingerprint";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allFieldsPopulated(profile: FingerprintProfile): boolean {
	for (const [key, value] of Object.entries(profile)) {
		if (value === undefined || value === null || value === "") {
			return false;
		}
		if (key === "languages" && (!Array.isArray(value) || value.length === 0)) {
			return false;
		}
	}
	return true;
}

/** Stub Playwright page that records addInitScript calls. */
function createMockPage() {
	const calls: { content: string }[] = [];
	return {
		calls,
		addInitScript(arg: { content: string }) {
			calls.push(arg);
			return Promise.resolve();
		},
	};
}

// ---------------------------------------------------------------------------
// Profile generation
// ---------------------------------------------------------------------------

describe("generateProfile", () => {
	test("chrome-windows: Win32 platform, Windows in UA, no Apple in WebGL", () => {
		const p = generateProfile("chrome-windows");
		expect(p.platform).toBe("Win32");
		expect(p.userAgent).toContain("Windows NT 10.0; Win64; x64");
		expect(p.webglVendor).not.toContain("Apple");
		expect(p.webglRenderer).not.toContain("Apple");
	});

	test("chrome-mac: MacIntel platform, Macintosh in UA, valid Mac WebGL", () => {
		const p = generateProfile("chrome-mac");
		expect(p.platform).toBe("MacIntel");
		expect(p.userAgent).toContain("Macintosh; Intel Mac OS X 10_15_7");
		// WebGL vendor must be Apple or Intel (not NVIDIA/AMD)
		expect(
			p.webglVendor.includes("Apple") || p.webglVendor.includes("Intel"),
		).toBe(true);
	});

	test("chrome-linux: Linux platform, X11 in UA", () => {
		const p = generateProfile("chrome-linux");
		expect(p.platform).toBe("Linux x86_64");
		expect(p.userAgent).toContain("X11; Linux x86_64");
	});

	test("all required fields are populated", () => {
		for (const preset of [
			"chrome-windows",
			"chrome-mac",
			"chrome-linux",
		] as const) {
			const p = generateProfile(preset);
			expect(allFieldsPopulated(p)).toBe(true);
		}
	});
});

describe("generateRandomProfile", () => {
	test("produces an internally consistent profile", () => {
		// Run several times since it is random
		for (let i = 0; i < 20; i++) {
			const p = generateRandomProfile();
			expect(allFieldsPopulated(p)).toBe(true);

			// Platform matches UA
			if (p.platform === "Win32") {
				expect(p.userAgent).toContain("Windows");
			} else if (p.platform === "MacIntel") {
				expect(p.userAgent).toContain("Macintosh");
			} else {
				expect(p.userAgent).toContain("X11");
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Spatial consistency
// ---------------------------------------------------------------------------

describe("spatial consistency", () => {
	test("platform matches UA string", () => {
		expect(generateProfile("chrome-windows").userAgent).toContain("Windows");
		expect(generateProfile("chrome-mac").userAgent).toContain("Macintosh");
		expect(generateProfile("chrome-linux").userAgent).toContain("X11");
	});

	test("WebGL vendor/renderer matches platform (no Apple GPU on Windows)", () => {
		for (let i = 0; i < 20; i++) {
			const p = generateProfile("chrome-windows");
			expect(p.webglVendor).not.toContain("Apple");
			expect(p.webglRenderer).not.toContain("Apple");
		}
	});

	test("WebGL vendor/renderer matches platform (no NVIDIA/AMD on Mac when Apple GPU)", () => {
		for (let i = 0; i < 30; i++) {
			const p = generateProfile("chrome-mac");
			if (p.webglVendor.includes("Apple")) {
				expect(p.webglRenderer).toContain("Apple");
			}
		}
	});

	test("appVersion is consistent with UA", () => {
		const p = generateProfile("chrome-windows");
		// appVersion should be the UA minus "Mozilla/"
		expect(p.userAgent).toBe(`Mozilla/${p.appVersion}`);
	});

	test("screen dimensions are realistic for the platform", () => {
		for (let i = 0; i < 20; i++) {
			const p = generateProfile("chrome-windows");
			expect(p.screenWidth).toBeGreaterThanOrEqual(1024);
			expect(p.screenHeight).toBeGreaterThanOrEqual(600);
		}
	});

	test("maxTouchPoints is 0 for all desktop profiles", () => {
		for (const preset of [
			"chrome-windows",
			"chrome-mac",
			"chrome-linux",
		] as const) {
			expect(generateProfile(preset).maxTouchPoints).toBe(0);
		}
	});

	test("pixelRatio is 2 for Mac profiles (Retina)", () => {
		for (let i = 0; i < 20; i++) {
			expect(generateProfile("chrome-mac").pixelRatio).toBe(2);
		}
	});
});

// ---------------------------------------------------------------------------
// Temporal consistency
// ---------------------------------------------------------------------------

describe("temporal consistency", () => {
	test("canvasNoiseSeed is a positive integer", () => {
		for (let i = 0; i < 20; i++) {
			const p = generateRandomProfile();
			expect(Number.isInteger(p.canvasNoiseSeed)).toBe(true);
			expect(p.canvasNoiseSeed).toBeGreaterThan(0);
		}
	});

	test("different calls produce different but individually consistent profiles", () => {
		const profiles = Array.from({ length: 10 }, () =>
			generateProfile("chrome-windows"),
		);
		// Not all identical (randomness)
		const seeds = new Set(profiles.map((p) => p.canvasNoiseSeed));
		// Very unlikely all 10 seeds are the same
		expect(seeds.size).toBeGreaterThan(1);
		// But all individually consistent
		for (const p of profiles) {
			expect(p.platform).toBe("Win32");
			expect(p.userAgent).toContain("Windows");
		}
	});
});

// ---------------------------------------------------------------------------
// Plugin consistency
// ---------------------------------------------------------------------------

describe("plugin consistency", () => {
	test("stealth script includes realistic Chrome plugins", () => {
		const script = buildFingerprintScript(generateProfile("chrome-windows"));
		expect(script).toContain("Chrome PDF Plugin");
		expect(script).toContain("Chrome PDF Viewer");
		expect(script).toContain("Native Client");
	});

	test("navigator.webdriver is set to false", () => {
		const script = buildFingerprintScript(generateRandomProfile());
		expect(script).toContain("webdriver");
		expect(script).toContain("false");
	});

	test("plugins array has item/namedItem/refresh methods", () => {
		const script = buildFingerprintScript(generateRandomProfile());
		expect(script).toContain("arr.item");
		expect(script).toContain("arr.namedItem");
		expect(script).toContain("arr.refresh");
	});
});

// ---------------------------------------------------------------------------
// Applicator script validation
// ---------------------------------------------------------------------------

describe("applicator script", () => {
	test("buildFingerprintScript produces parseable JavaScript", () => {
		const script = buildFingerprintScript(generateRandomProfile());
		// Wrap in Function constructor to parse without executing
		expect(() => new Function(script)).not.toThrow();
	});

	test("script overrides all expected navigator properties", () => {
		const script = buildFingerprintScript(generateRandomProfile());
		for (const prop of [
			"userAgent",
			"platform",
			"vendor",
			"appVersion",
			"language",
			"languages",
			"hardwareConcurrency",
			"deviceMemory",
			"maxTouchPoints",
			"webdriver",
			"plugins",
		]) {
			expect(script).toContain(prop);
		}
	});

	test("script overrides screen properties", () => {
		const script = buildFingerprintScript(generateRandomProfile());
		for (const prop of [
			"screenWidth",
			"screenHeight",
			"colorDepth",
			"pixelRatio",
		]) {
			expect(script).toContain(prop);
		}
	});

	test("script overrides WebGL getParameter", () => {
		const script = buildFingerprintScript(generateRandomProfile());
		expect(script).toContain("WebGLRenderingContext.prototype.getParameter");
		expect(script).toContain("UNMASKED_VENDOR");
		expect(script).toContain("UNMASKED_RENDERER");
	});
});

// ---------------------------------------------------------------------------
// Integration: applyEnhancedStealth / applyFingerprintProfile
// ---------------------------------------------------------------------------

describe("applyFingerprintProfile", () => {
	test("calls page.addInitScript with the fingerprint script", async () => {
		const page = createMockPage();
		const profile = generateProfile("chrome-mac");
		await applyFingerprintProfile(page, profile);
		expect(page.calls).toHaveLength(1);
		expect(page.calls[0].content).toContain(profile.userAgent);
	});
});

describe("applyEnhancedStealth", () => {
	test("with no profile, generates and applies one", async () => {
		const page = createMockPage();
		await applyEnhancedStealth(page);
		expect(page.calls).toHaveLength(1);
		// Should contain valid navigator overrides
		expect(page.calls[0].content).toContain("navigator");
	});

	test("with explicit profile, uses it", async () => {
		const page = createMockPage();
		const profile = generateProfile("chrome-linux");
		await applyEnhancedStealth(page, profile);
		expect(page.calls).toHaveLength(1);
		expect(page.calls[0].content).toContain("Linux x86_64");
	});
});

// ---------------------------------------------------------------------------
// Config integration
// ---------------------------------------------------------------------------

describe("config fingerprintPreset", () => {
	test("BrowserConfig accepts fingerprintPreset", async () => {
		// Just verify the type works at import time
		const { createBrowserConfig } = await import("../../src/config");
		const config = createBrowserConfig({
			stealth: true,
			fingerprintPreset: "chrome-mac",
		});
		expect(config.fingerprintPreset).toBe("chrome-mac");
		expect(config.stealth).toBe(true);
	});
});
