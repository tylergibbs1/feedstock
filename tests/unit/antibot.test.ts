import { describe, expect, test } from "bun:test";
import { isBlocked, withRetry } from "../../src/utils/antibot";

describe("isBlocked", () => {
	test("detects 403 with block indicators", () => {
		expect(isBlocked("<html><body>Access Denied</body></html>", 403)).toBe(true);
		expect(isBlocked("<html><body>Captcha required</body></html>", 403)).toBe(true);
	});

	test("detects 429 with rate limit message", () => {
		expect(isBlocked("<html><body>Too many requests</body></html>", 429)).toBe(true);
	});

	test("detects Cloudflare challenge", () => {
		expect(isBlocked("<html><body>Checking your browser</body></html>", 503)).toBe(true);
	});

	test("detects blocked title", () => {
		expect(
			isBlocked("<html><head><title>Attention Required!</title></head><body>x</body></html>", 403),
		).toBe(true);
	});

	test("does not flag normal 200 pages", () => {
		expect(isBlocked("<html><body><h1>Hello World</h1><p>Content</p></body></html>", 200)).toBe(
			false,
		);
	});

	test("does not flag normal 404 pages", () => {
		expect(
			isBlocked("<html><body><h1>Not Found</h1><p>Page not found</p></body></html>", 404),
		).toBe(false);
	});

	test("detects short 403 body", () => {
		expect(isBlocked("Forbidden", 403)).toBe(true);
	});
});

describe("withRetry", () => {
	test("returns immediately if not blocked", async () => {
		let calls = 0;
		const { result, retries } = await withRetry(
			async () => {
				calls++;
				return "ok";
			},
			(r) => r !== "ok",
		);
		expect(result).toBe("ok");
		expect(retries).toBe(0);
		expect(calls).toBe(1);
	});

	test("retries on blocked result", async () => {
		let calls = 0;
		const { result, retries } = await withRetry(
			async () => {
				calls++;
				return calls >= 3 ? "ok" : "blocked";
			},
			(r) => r === "blocked",
			{ maxRetries: 3, retryDelay: 10 },
		);
		expect(result).toBe("ok");
		expect(retries).toBe(2);
		expect(calls).toBe(3);
	});

	test("returns last result after max retries", async () => {
		const { result, retries } = await withRetry(
			async () => "always-blocked",
			(r) => r === "always-blocked",
			{ maxRetries: 2, retryDelay: 10 },
		);
		expect(result).toBe("always-blocked");
		expect(retries).toBe(3);
	});
});
