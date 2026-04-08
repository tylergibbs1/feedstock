import { describe, expect, mock, test } from "bun:test";
import { createCrawlerRunConfig } from "../../src/config";

// ---------------------------------------------------------------------------
// Config type tests (no browser needed)
// ---------------------------------------------------------------------------

describe("BlockResourcesConfig type", () => {
	test("accepts false (default)", () => {
		const config = createCrawlerRunConfig();
		expect(config.blockResources).toBe(false);
	});

	test("accepts true (backward compat)", () => {
		const config = createCrawlerRunConfig({ blockResources: true });
		expect(config.blockResources).toBe(true);
	});

	test("accepts 'fast' profile", () => {
		const config = createCrawlerRunConfig({ blockResources: "fast" });
		expect(config.blockResources).toBe("fast");
	});

	test("accepts 'minimal' profile", () => {
		const config = createCrawlerRunConfig({ blockResources: "minimal" });
		expect(config.blockResources).toBe("minimal");
	});

	test("accepts 'media-only' profile", () => {
		const config = createCrawlerRunConfig({ blockResources: "media-only" });
		expect(config.blockResources).toBe("media-only");
	});

	test("accepts custom config object", () => {
		const config = createCrawlerRunConfig({
			blockResources: {
				patterns: ["**/*.woff2"],
				resourceTypes: ["font"],
			},
		});
		const br = config.blockResources;
		expect(typeof br).toBe("object");
		if (typeof br === "object" && br !== null && !Array.isArray(br)) {
			expect(br.patterns).toEqual(["**/*.woff2"]);
			expect(br.resourceTypes).toEqual(["font"]);
		}
	});

	test("accepts custom config with only patterns", () => {
		const config = createCrawlerRunConfig({
			blockResources: { patterns: ["**/*.svg"] },
		});
		expect(config.blockResources).toEqual({ patterns: ["**/*.svg"] });
	});

	test("accepts custom config with only resourceTypes", () => {
		const config = createCrawlerRunConfig({
			blockResources: { resourceTypes: ["image"] },
		});
		expect(config.blockResources).toEqual({ resourceTypes: ["image"] });
	});
});

// ---------------------------------------------------------------------------
// resolveConfig logic tests (via applyResourceBlocking)
// ---------------------------------------------------------------------------

describe("applyResourceBlocking", () => {
	// Mock BrowserContext that records route calls
	function createMockContext() {
		const routes: Array<{ pattern: string }> = [];
		return {
			routes,
			route: mock(async (pattern: string, _handler: Function) => {
				routes.push({ pattern });
			}),
		};
	}

	test("does nothing for false", async () => {
		const { applyResourceBlocking } = await import("../../src/utils/resource-blocker");
		const ctx = createMockContext();
		await applyResourceBlocking(ctx as any, false);
		expect(ctx.route).not.toHaveBeenCalled();
	});

	test("applies fast profile for true (backward compat)", async () => {
		const { applyResourceBlocking } = await import("../../src/utils/resource-blocker");
		const ctx = createMockContext();
		await applyResourceBlocking(ctx as any, true);
		// Should have pattern routes + resource type route
		expect(ctx.route).toHaveBeenCalled();
		expect(ctx.routes.length).toBeGreaterThanOrEqual(2);
	});

	test("applies fast profile by name", async () => {
		const { applyResourceBlocking } = await import("../../src/utils/resource-blocker");
		const ctx = createMockContext();
		await applyResourceBlocking(ctx as any, "fast");
		expect(ctx.route).toHaveBeenCalled();
		// fast has 1 glob pattern + 1 resource type route
		expect(ctx.routes.length).toBe(2);
	});

	test("applies minimal profile", async () => {
		const { applyResourceBlocking } = await import("../../src/utils/resource-blocker");
		const ctx = createMockContext();
		await applyResourceBlocking(ctx as any, "minimal");
		expect(ctx.route).toHaveBeenCalled();
		expect(ctx.routes.length).toBe(2);
	});

	test("applies media-only profile", async () => {
		const { applyResourceBlocking } = await import("../../src/utils/resource-blocker");
		const ctx = createMockContext();
		await applyResourceBlocking(ctx as any, "media-only");
		expect(ctx.route).toHaveBeenCalled();
		expect(ctx.routes.length).toBe(2);
	});

	test("applies custom config with patterns and types", async () => {
		const { applyResourceBlocking } = await import("../../src/utils/resource-blocker");
		const ctx = createMockContext();
		await applyResourceBlocking(ctx as any, {
			patterns: ["**/*.woff2", "**/*.svg"],
			resourceTypes: ["font"],
		});
		// 2 pattern routes + 1 resource type route = 3
		expect(ctx.routes.length).toBe(3);
	});

	test("applies custom config with only patterns", async () => {
		const { applyResourceBlocking } = await import("../../src/utils/resource-blocker");
		const ctx = createMockContext();
		await applyResourceBlocking(ctx as any, {
			patterns: ["**/*.gif"],
		});
		// 1 pattern route, no resource type route (empty array)
		expect(ctx.routes.length).toBe(1);
	});

	test("throws for unknown profile name", async () => {
		const { applyResourceBlocking } = await import("../../src/utils/resource-blocker");
		const ctx = createMockContext();
		expect(
			applyResourceBlocking(ctx as any, "nonexistent" as any),
		).rejects.toThrow(/Unknown resource block profile/);
	});
});
