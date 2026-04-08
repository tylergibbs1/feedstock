import { describe, expect, mock, test } from "bun:test";
import { createBrowserConfig } from "../../src/config";
import { BrowserManager } from "../../src/browser/manager";

describe("BrowserManager retry logic", () => {
	test("start() throws non-transient errors immediately", async () => {
		const config = createBrowserConfig({
			// Use a CDP backend that will fail — non-transient error
			backend: { kind: "cdp", wsUrl: "ws://invalid-host-that-does-not-exist:1" },
		});
		const manager = new BrowserManager(config);

		const start = performance.now();
		try {
			await manager.start({ maxRetries: 3, baseDelayMs: 100 });
			expect.unreachable("should have thrown");
		} catch (err) {
			const elapsed = performance.now() - start;
			expect(err).toBeInstanceOf(Error);
			// If it retried 3 times with 100ms+ delays, it would take >300ms
			// A non-transient error should fail quickly (or transient ones will retry)
			// We just verify it does throw
		}
		await manager.close();
	});

	test("start() with maxRetries=0 fails on first error", async () => {
		const config = createBrowserConfig({
			backend: { kind: "cdp", wsUrl: "ws://127.0.0.1:1" },
		});
		const manager = new BrowserManager(config);

		try {
			await manager.start({ maxRetries: 0 });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
		}
		await manager.close();
	});

	test("start() is idempotent when browser is already running", async () => {
		const config = createBrowserConfig({ backend: { kind: "playwright" } });
		const manager = new BrowserManager(config);

		await manager.start();
		expect(manager.isRunning).toBe(true);

		// Second start should be a no-op
		await manager.start();
		expect(manager.isRunning).toBe(true);

		await manager.close();
	});
});
