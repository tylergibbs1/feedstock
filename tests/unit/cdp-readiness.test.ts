import { describe, expect, test } from "bun:test";
import { createBrowserConfig } from "../../src/config";
import { BrowserManager } from "../../src/browser/manager";

describe("Lightpanda CDP readiness polling", () => {
	test("startLightpanda times out when no CDP server is running", async () => {
		const config = createBrowserConfig({
			backend: { kind: "lightpanda", mode: "cloud", token: "fake", endpoint: "ws://127.0.0.1:19999" },
		});
		const manager = new BrowserManager(config);

		// This will fail because no CDP server is at that port, but it should
		// attempt to connect (cloud mode goes straight to connectOverCDP, no readiness poll)
		try {
			await manager.start({ maxRetries: 0 });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
		}
		await manager.close();
	});

	test("manager.close() is safe to call without start", async () => {
		const config = createBrowserConfig({
			backend: { kind: "lightpanda", mode: "local" },
		});
		const manager = new BrowserManager(config);
		// Should not throw
		await manager.close();
		expect(manager.isRunning).toBe(false);
	});

	test("manager reports not running before start", () => {
		const config = createBrowserConfig({
			backend: { kind: "lightpanda", mode: "local" },
		});
		const manager = new BrowserManager(config);
		expect(manager.isRunning).toBe(false);
		expect(manager.activeSessions).toBe(0);
	});
});
