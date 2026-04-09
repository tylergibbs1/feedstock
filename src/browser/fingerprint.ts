/**
 * Consistent fingerprint profile generation and application.
 *
 * Inspired by "FP-Inconsistent" (arxiv 2406.07647): bots fail anti-bot detection
 * not because of individual fingerprint values, but because of *inconsistencies*
 * between attributes. This module generates profiles where every attribute agrees
 * with every other (spatial consistency) and uses deterministic noise seeds so
 * repeated checks on the same page see identical values (temporal consistency).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FingerprintProfile {
	// Identity
	userAgent: string;
	platform: string;
	// Browser
	vendor: string;
	appVersion: string;
	language: string;
	languages: string[];
	// Hardware
	hardwareConcurrency: number;
	deviceMemory: number;
	maxTouchPoints: number;
	// Screen
	screenWidth: number;
	screenHeight: number;
	colorDepth: number;
	pixelRatio: number;
	// WebGL
	webglVendor: string;
	webglRenderer: string;
	// Canvas noise seed (deterministic per-profile)
	canvasNoiseSeed: number;
}

export type ProfilePreset = "chrome-windows" | "chrome-mac" | "chrome-linux";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
	return min + Math.floor(Math.random() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Per-preset data tables
// ---------------------------------------------------------------------------

const CHROME_VERSIONS = [120, 121, 122, 123, 124, 125] as const;

interface PresetData {
	platform: string;
	uaTemplate: (chromeVersion: number) => string;
	webglOptions: readonly { vendor: string; renderer: string }[];
	screens: readonly { width: number; height: number }[];
	pixelRatios: readonly number[];
	deviceMemory: readonly number[];
	hardwareConcurrency: readonly number[];
}

const PRESETS: Record<ProfilePreset, PresetData> = {
	"chrome-windows": {
		platform: "Win32",
		uaTemplate: (v) =>
			`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
		webglOptions: [
			{
				vendor: "Google Inc. (NVIDIA)",
				renderer:
					"ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
			},
			{
				vendor: "Google Inc. (AMD)",
				renderer:
					"ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)",
			},
			{
				vendor: "Google Inc. (Intel)",
				renderer:
					"ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
			},
		],
		screens: [
			{ width: 1920, height: 1080 },
			{ width: 2560, height: 1440 },
			{ width: 1366, height: 768 },
		],
		pixelRatios: [1, 1.5],
		deviceMemory: [8, 16],
		hardwareConcurrency: [4, 8, 16],
	},
	"chrome-mac": {
		platform: "MacIntel",
		uaTemplate: (v) =>
			`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
		webglOptions: [
			{
				vendor: "Google Inc. (Apple)",
				renderer:
					"ANGLE (Apple, Apple M1, OpenGL 4.1)",
			},
			{
				vendor: "Google Inc. (Apple)",
				renderer:
					"ANGLE (Apple, Apple M2, OpenGL 4.1)",
			},
			{
				vendor: "Google Inc. (Intel)",
				renderer:
					"ANGLE (Intel, Intel Iris Plus Graphics 645, OpenGL 4.1)",
			},
		],
		screens: [
			{ width: 1440, height: 900 },
			{ width: 1680, height: 1050 },
			{ width: 2560, height: 1600 },
			{ width: 1920, height: 1080 },
		],
		pixelRatios: [2],
		deviceMemory: [8, 16],
		hardwareConcurrency: [8, 10],
	},
	"chrome-linux": {
		platform: "Linux x86_64",
		uaTemplate: (v) =>
			`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
		webglOptions: [
			{
				vendor: "Google Inc. (NVIDIA)",
				renderer:
					"ANGLE (NVIDIA, NVIDIA GeForce RTX 3070, OpenGL 4.5)",
			},
			{
				vendor: "Google Inc. (AMD)",
				renderer:
					"ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.5)",
			},
			{
				vendor: "Google Inc. (Intel)",
				renderer:
					"ANGLE (Intel, Intel UHD Graphics 770, OpenGL 4.5)",
			},
		],
		screens: [
			{ width: 1920, height: 1080 },
			{ width: 2560, height: 1440 },
			{ width: 3840, height: 2160 },
		],
		pixelRatios: [1, 1.5, 2],
		deviceMemory: [8, 16],
		hardwareConcurrency: [4, 8, 16],
	},
};

const ALL_PRESETS: readonly ProfilePreset[] = [
	"chrome-windows",
	"chrome-mac",
	"chrome-linux",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a consistent fingerprint profile for the given preset.
 * Every attribute is derived from the preset's platform data, ensuring
 * no spatial inconsistencies.
 */
export function generateProfile(preset: ProfilePreset): FingerprintProfile {
	const data = PRESETS[preset];
	const chromeVersion = pick(CHROME_VERSIONS);
	const userAgent = data.uaTemplate(chromeVersion);
	const webgl = pick(data.webglOptions);
	const screen = pick(data.screens);

	return {
		userAgent,
		platform: data.platform,
		vendor: "Google Inc.",
		appVersion: userAgent.replace("Mozilla/", ""),
		language: "en-US",
		languages: ["en-US", "en"],
		hardwareConcurrency: pick(data.hardwareConcurrency),
		deviceMemory: pick(data.deviceMemory),
		maxTouchPoints: 0,
		screenWidth: screen.width,
		screenHeight: screen.height,
		colorDepth: 24,
		pixelRatio: pick(data.pixelRatios),
		webglVendor: webgl.vendor,
		webglRenderer: webgl.renderer,
		canvasNoiseSeed: randomInt(1, 2_147_483_647),
	};
}

/**
 * Generate a random consistent profile by picking a random preset.
 */
export function generateRandomProfile(): FingerprintProfile {
	return generateProfile(pick(ALL_PRESETS));
}

// ---------------------------------------------------------------------------
// Applicator
// ---------------------------------------------------------------------------

/**
 * Build the page-evaluate script as a string.
 * Exported for testability (callers can parse it to verify correctness).
 */
export function buildFingerprintScript(profile: FingerprintProfile): string {
	// We JSON-serialize the profile and embed it as a constant inside the IIFE
	// so that every override reads from the same snapshot (temporal consistency).
	return `(function(){
const P = ${JSON.stringify(profile)};

// --- navigator overrides ---
const navProps = {
  userAgent:           { get: () => P.userAgent },
  platform:            { get: () => P.platform },
  vendor:              { get: () => P.vendor },
  appVersion:          { get: () => P.appVersion },
  language:            { get: () => P.language },
  languages:           { get: () => Object.freeze([...P.languages]) },
  hardwareConcurrency: { get: () => P.hardwareConcurrency },
  deviceMemory:        { get: () => P.deviceMemory },
  maxTouchPoints:      { get: () => P.maxTouchPoints },
  webdriver:           { get: () => false },
  plugins: { get: () => {
    const arr = [
      { name: "Chrome PDF Plugin",  filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Chrome PDF Viewer",  filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
      { name: "Native Client",      filename: "internal-nacl-plugin", description: "" },
    ];
    arr.item = (i) => arr[i] ?? null;
    arr.namedItem = (n) => arr.find(p => p.name === n) ?? null;
    arr.refresh = () => {};
    Object.setPrototypeOf(arr, PluginArray.prototype);
    return arr;
  }},
};
for (const [k, desc] of Object.entries(navProps)) {
  try { Object.defineProperty(navigator, k, desc); } catch {}
}

// --- screen overrides ---
const screenProps = {
  width:      { get: () => P.screenWidth },
  height:     { get: () => P.screenHeight },
  availWidth: { get: () => P.screenWidth },
  availHeight:{ get: () => P.screenHeight - 40 },
  colorDepth: { get: () => P.colorDepth },
  pixelDepth: { get: () => P.colorDepth },
};
for (const [k, desc] of Object.entries(screenProps)) {
  try { Object.defineProperty(screen, k, desc); } catch {}
}
try { Object.defineProperty(window, "devicePixelRatio", { get: () => P.pixelRatio }); } catch {}

// --- WebGL overrides ---
const UNMASKED_VENDOR  = 0x9245;
const UNMASKED_RENDERER = 0x9246;
const origGetParam = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(param) {
  if (param === UNMASKED_VENDOR)  return P.webglVendor;
  if (param === UNMASKED_RENDERER) return P.webglRenderer;
  return origGetParam.call(this, param);
};
if (typeof WebGL2RenderingContext !== "undefined") {
  const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(param) {
    if (param === UNMASKED_VENDOR)  return P.webglVendor;
    if (param === UNMASKED_RENDERER) return P.webglRenderer;
    return origGetParam2.call(this, param);
  };
}

// --- Canvas noise (deterministic via seed) ---
const seed = P.canvasNoiseSeed;
function mulberry32(s) {
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);
const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function() {
  const ctx = this.getContext("2d");
  if (ctx) {
    const imageData = ctx.getImageData(0, 0, this.width, this.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = d[i]     ^ (rng() < 0.1 ? 1 : 0);
      d[i + 1] = d[i + 1] ^ (rng() < 0.1 ? 1 : 0);
      d[i + 2] = d[i + 2] ^ (rng() < 0.1 ? 1 : 0);
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return origToDataURL.apply(this, arguments);
};
})();`;
}

/**
 * Apply a consistent fingerprint profile to a Playwright page.
 * All overrides happen in a single evaluate call to guarantee spatial consistency.
 */
export async function applyFingerprintProfile(
	page: any,
	profile: FingerprintProfile,
): Promise<void> {
	await page.addInitScript({ content: buildFingerprintScript(profile) });
}

/**
 * Enhanced stealth mode using consistent fingerprint profiles.
 * Drop-in replacement for the legacy applyStealthMode().
 *
 * If no profile is provided, generates a random consistent one.
 */
export async function applyEnhancedStealth(
	page: any,
	profile?: FingerprintProfile,
): Promise<void> {
	const p = profile ?? generateRandomProfile();
	await applyFingerprintProfile(page, p);
}
