import { describe, expect, test } from "bun:test";
import { createBrowserConfig } from "../../src/config";

describe("CDP backend config", () => {
	test("accepts cdp backend with wsUrl", () => {
		const config = createBrowserConfig({
			backend: { kind: "cdp", wsUrl: "ws://localhost:9222" },
		});
		expect(config.backend.kind).toBe("cdp");
		if (config.backend.kind === "cdp") {
			expect(config.backend.wsUrl).toBe("ws://localhost:9222");
		}
	});

	test("accepts cdp backend with wss URL", () => {
		const config = createBrowserConfig({
			backend: { kind: "cdp", wsUrl: "wss://cloud.browserbase.com/v1/sessions/abc123" },
		});
		if (config.backend.kind === "cdp") {
			expect(config.backend.wsUrl).toContain("browserbase");
		}
	});

	test("preserves other config defaults with cdp backend", () => {
		const config = createBrowserConfig({
			backend: { kind: "cdp", wsUrl: "ws://localhost:9222" },
		});
		expect(config.headless).toBe(true);
		expect(config.browserType).toBe("chromium");
		expect(config.viewport).toEqual({ width: 1920, height: 1080 });
		expect(config.ignoreHttpsErrors).toBe(true);
	});

	test("default backend is still playwright", () => {
		const config = createBrowserConfig();
		expect(config.backend).toEqual({ kind: "playwright" });
	});
});
