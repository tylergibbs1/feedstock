import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrawlCache } from "../../src/cache/database";

const TEST_DB = join(tmpdir(), `feedstock-test-${Date.now()}.db`);

describe("CrawlCache", () => {
	let cache: CrawlCache;

	beforeEach(() => {
		cache = new CrawlCache(TEST_DB);
		cache.clear();
	});

	afterAll(() => {
		cache.close();
		// Clean up test DB files
		for (const suffix of ["", "-wal", "-shm"]) {
			const path = TEST_DB + suffix;
			if (existsSync(path)) unlinkSync(path);
		}
	});

	test("stores and retrieves cached results", () => {
		const result = JSON.stringify({ url: "https://example.com", success: true });
		cache.set("https://example.com", result);

		const cached = cache.get("https://example.com");
		expect(cached).not.toBeNull();
		expect(cached!.result).toBe(result);
		expect(cached!.cachedAt).toBeGreaterThan(0);
	});

	test("returns null for uncached URLs", () => {
		const cached = cache.get("https://nonexistent.com");
		expect(cached).toBeNull();
	});

	test("overwrites existing entries", () => {
		cache.set("https://example.com", "first");
		cache.set("https://example.com", "second");

		const cached = cache.get("https://example.com");
		expect(cached!.result).toBe("second");
	});

	test("deletes specific entries", () => {
		cache.set("https://example.com", "data");
		cache.delete("https://example.com");

		const cached = cache.get("https://example.com");
		expect(cached).toBeNull();
	});

	test("clears all entries", () => {
		cache.set("https://a.com", "a");
		cache.set("https://b.com", "b");
		cache.clear();

		expect(cache.get("https://a.com")).toBeNull();
		expect(cache.get("https://b.com")).toBeNull();
	});

	test("batch inserts with setMany (transaction)", () => {
		cache.setMany([
			{ url: "https://one.com", result: "r1" },
			{ url: "https://two.com", result: "r2" },
			{ url: "https://three.com", result: "r3" },
		]);

		expect(cache.get("https://one.com")!.result).toBe("r1");
		expect(cache.get("https://two.com")!.result).toBe("r2");
		expect(cache.get("https://three.com")!.result).toBe("r3");
	});

	test("setMany is atomic — all or nothing", () => {
		cache.set("https://existing.com", "before");

		// Insert a batch where one entry overwrites — all should succeed atomically
		cache.setMany([
			{ url: "https://existing.com", result: "after" },
			{ url: "https://new.com", result: "new" },
		]);

		expect(cache.get("https://existing.com")!.result).toBe("after");
		expect(cache.get("https://new.com")!.result).toBe("new");
	});
});
