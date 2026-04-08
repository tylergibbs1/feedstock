/**
 * Anti-bot detection and page simulation utilities.
 *
 * Detects common bot-blocking patterns and provides retry logic.
 */

import type { Page } from "playwright";

const BLOCKED_INDICATORS = [
	// Common block page text
	"access denied",
	"blocked",
	"captcha",
	"verify you are human",
	"please enable javascript",
	"enable cookies",
	"unusual traffic",
	"rate limit",
	"too many requests",
	"forbidden",
	"cloudflare",
	"checking your browser",
	"just a moment",
	"bot detected",
	"automated access",
];

const BLOCKED_TITLE_PATTERNS = [
	/access denied/i,
	/blocked/i,
	/captcha/i,
	/attention required/i,
	/403 forbidden/i,
	/just a moment/i,
	/security check/i,
];

/**
 * Check if a page appears to be blocked by anti-bot measures.
 */
export function isBlocked(html: string, statusCode: number): boolean {
	// Obvious HTTP-level blocks
	if (statusCode === 403 || statusCode === 429 || statusCode === 503) {
		const lowerHtml = html.toLowerCase();
		for (const indicator of BLOCKED_INDICATORS) {
			if (lowerHtml.includes(indicator)) return true;
		}
	}

	// Check title
	const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
	if (titleMatch) {
		const title = titleMatch[1];
		for (const pattern of BLOCKED_TITLE_PATTERNS) {
			if (pattern.test(title)) return true;
		}
	}

	// Very short body with block-like status codes
	if ((statusCode === 403 || statusCode === 503) && html.length < 2000) {
		return true;
	}

	return false;
}

/**
 * Simulate human-like behavior on a page.
 * Moves mouse randomly, scrolls, adds delays.
 */
export async function simulateUser(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	if (!viewport) return;

	// Random mouse movements
	for (let i = 0; i < 3; i++) {
		const x = Math.floor(Math.random() * viewport.width);
		const y = Math.floor(Math.random() * viewport.height);
		await page.mouse.move(x, y, { steps: 5 });
		await page.waitForTimeout(100 + Math.random() * 200);
	}

	// Scroll down and back up
	await page.mouse.wheel(0, 300);
	await page.waitForTimeout(200 + Math.random() * 300);
	await page.mouse.wheel(0, -100);
	await page.waitForTimeout(100 + Math.random() * 200);
}

/**
 * Configure stealth mode on a page to avoid bot detection.
 */
export async function applyStealthMode(page: Page): Promise<void> {
	await page.addInitScript(() => {
		// Override navigator.webdriver
		Object.defineProperty(navigator, "webdriver", {
			get: () => false,
		});

		// Override chrome runtime
		(window as unknown as Record<string, unknown>).chrome = {
			runtime: {},
		};

		// Override permissions
		const originalQuery = window.navigator.permissions.query;
		window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
			if (parameters.name === "notifications") {
				return Promise.resolve({
					state: "denied" as PermissionState,
					name: parameters.name,
					onchange: null,
					addEventListener: () => {},
					removeEventListener: () => {},
					dispatchEvent: () => true,
				} as PermissionStatus);
			}
			return originalQuery.call(window.navigator.permissions, parameters);
		};

		// Override plugins length
		Object.defineProperty(navigator, "plugins", {
			get: () => [1, 2, 3, 4, 5],
		});

		// Override languages
		Object.defineProperty(navigator, "languages", {
			get: () => ["en-US", "en"],
		});
	});
}

export interface RetryConfig {
	maxRetries: number;
	retryDelay: number;
}

const DEFAULT_RETRY: RetryConfig = {
	maxRetries: 3,
	retryDelay: 2000,
};

/**
 * Retry a crawl operation with anti-bot handling.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	checkBlocked: (result: T) => boolean,
	config: Partial<RetryConfig> = {},
): Promise<{ result: T; retries: number }> {
	const opts = { ...DEFAULT_RETRY, ...config };
	let lastResult: T | null = null;
	let retries = 0;

	for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
		lastResult = await fn();
		if (!checkBlocked(lastResult)) {
			return { result: lastResult, retries };
		}
		retries++;
		if (attempt < opts.maxRetries) {
			const delay = opts.retryDelay * (attempt + 1);
			await Bun.sleep(delay);
		}
	}

	return { result: lastResult!, retries };
}
