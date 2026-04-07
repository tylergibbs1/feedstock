import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../../src/utils/rate-limiter";

describe("RateLimiter", () => {
	test("first request to a domain has no wait", async () => {
		const limiter = new RateLimiter({ jitter: 0 });
		const waited = await limiter.waitIfNeeded("https://example.com/page1");
		expect(waited).toBe(0);
	});

	test("second request within delay window waits", async () => {
		const limiter = new RateLimiter({ baseDelay: 50, jitter: 0 });
		await limiter.waitIfNeeded("https://example.com/page1");
		const start = Date.now();
		await limiter.waitIfNeeded("https://example.com/page2");
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(30); // some tolerance
	});

	test("different domains are tracked independently", async () => {
		const limiter = new RateLimiter({ baseDelay: 100, jitter: 0 });
		await limiter.waitIfNeeded("https://a.com/page");
		// Different domain should not wait
		const waited = await limiter.waitIfNeeded("https://b.com/page");
		expect(waited).toBe(0);
	});

	test("backoff increases delay on 429", () => {
		const limiter = new RateLimiter({ baseDelay: 100, backoffFactor: 2, jitter: 0 });
		limiter.reportResult("https://example.com/", 200); // init state
		const initialDelay = limiter.getDelay("https://example.com/");

		limiter.reportResult("https://example.com/", 429);
		const afterBackoff = limiter.getDelay("https://example.com/");
		expect(afterBackoff).toBe(initialDelay * 2);
	});

	test("backoff increases delay on 503", () => {
		const limiter = new RateLimiter({ baseDelay: 100, backoffFactor: 2, jitter: 0 });
		limiter.reportResult("https://example.com/", 200);

		limiter.reportResult("https://example.com/", 503);
		expect(limiter.getDelay("https://example.com/")).toBe(200);
	});

	test("successive failures compound backoff", () => {
		const limiter = new RateLimiter({ baseDelay: 100, backoffFactor: 2, jitter: 0 });
		limiter.reportResult("https://example.com/", 200);

		limiter.reportResult("https://example.com/", 429);
		limiter.reportResult("https://example.com/", 429);
		limiter.reportResult("https://example.com/", 429);
		expect(limiter.getDelay("https://example.com/")).toBe(800);
	});

	test("backoff respects maxDelay", () => {
		const limiter = new RateLimiter({
			baseDelay: 100,
			backoffFactor: 10,
			maxDelay: 500,
			jitter: 0,
		});
		limiter.reportResult("https://example.com/", 200);
		limiter.reportResult("https://example.com/", 429);
		limiter.reportResult("https://example.com/", 429);
		expect(limiter.getDelay("https://example.com/")).toBe(500);
	});

	test("success gradually recovers delay", () => {
		const limiter = new RateLimiter({
			baseDelay: 100,
			backoffFactor: 2,
			recoveryFactor: 0.5,
			jitter: 0,
		});
		limiter.reportResult("https://example.com/", 200);
		limiter.reportResult("https://example.com/", 429); // 200
		limiter.reportResult("https://example.com/", 429); // 400

		limiter.reportResult("https://example.com/", 200); // 200
		expect(limiter.getDelay("https://example.com/")).toBe(200);

		limiter.reportResult("https://example.com/", 200); // 100
		expect(limiter.getDelay("https://example.com/")).toBe(100);
	});

	test("setDelay overrides current delay", () => {
		const limiter = new RateLimiter({ baseDelay: 100, jitter: 0 });
		limiter.setDelay("https://example.com/", 5000);
		expect(limiter.getDelay("https://example.com/")).toBe(5000);
	});

	test("setDelay respects maxDelay", () => {
		const limiter = new RateLimiter({ baseDelay: 100, maxDelay: 1000, jitter: 0 });
		limiter.setDelay("https://example.com/", 50_000);
		expect(limiter.getDelay("https://example.com/")).toBe(1000);
	});

	test("clear resets all state", () => {
		const limiter = new RateLimiter({ jitter: 0 });
		limiter.reportResult("https://a.com/", 429);
		limiter.reportResult("https://b.com/", 429);
		limiter.clear();
		expect(limiter.getDelay("https://a.com/")).toBe(200);
		expect(limiter.getDelay("https://b.com/")).toBe(200);
	});

	test("reportResult returns true when backoff triggered", () => {
		const limiter = new RateLimiter({ jitter: 0 });
		expect(limiter.reportResult("https://example.com/", 200)).toBe(false);
		expect(limiter.reportResult("https://example.com/", 429)).toBe(true);
		expect(limiter.reportResult("https://example.com/", 503)).toBe(true);
		expect(limiter.reportResult("https://example.com/", 200)).toBe(false);
	});
});
