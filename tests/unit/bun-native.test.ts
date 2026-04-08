/**
 * Tests for Bun-native API migrations:
 * - Gzip compression in cache
 * - Bun.hash() content hashing
 * - Bun.file() / Bun.write() in storage
 * - Bun.sleep() (implicit — used in retry/rate-limiter, tested via those)
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrawlCache, contentHash } from "../../src/cache/database";
import { getStorageStatePath, loadStorageState } from "../../src/utils/storage";

// ---------------------------------------------------------------------------
// Gzip compression in cache
// ---------------------------------------------------------------------------

const GZIP_DB = join(tmpdir(), `feedstock-gzip-test-${Date.now()}.db`);

describe("Cache gzip compression", () => {
	let cache: CrawlCache;

	beforeEach(() => {
		cache = new CrawlCache(GZIP_DB);
		cache.clear();
	});

	afterAll(() => {
		cache.close();
		for (const suffix of ["", "-wal", "-shm"]) {
			const path = GZIP_DB + suffix;
			if (existsSync(path)) unlinkSync(path);
		}
	});

	test("set/get roundtrip preserves data through compression", () => {
		const original = JSON.stringify({ html: "<h1>Hello</h1>", success: true });
		cache.set("https://example.com", original);

		const cached = cache.get("https://example.com");
		expect(cached).not.toBeNull();
		expect(cached!.result).toBe(original);
	});

	test("large content compresses and decompresses correctly", () => {
		// Simulate a real page — lots of repeated HTML patterns compress well
		const bigHtml = "<div>".repeat(10000) + "<p>Content</p>" + "</div>".repeat(10000);
		const original = JSON.stringify({ html: bigHtml });
		cache.set("https://big.com", original);

		const cached = cache.get("https://big.com");
		expect(cached!.result).toBe(original);
	});

	test("setMany compresses all entries", () => {
		cache.setMany([
			{ url: "https://a.com", result: '{"a":1}' },
			{ url: "https://b.com", result: '{"b":2}' },
			{ url: "https://c.com", result: '{"c":3}' },
		]);

		expect(cache.get("https://a.com")!.result).toBe('{"a":1}');
		expect(cache.get("https://b.com")!.result).toBe('{"b":2}');
		expect(cache.get("https://c.com")!.result).toBe('{"c":3}');
	});

	test("special characters survive compression roundtrip", () => {
		const content = JSON.stringify({
			html: '<p>Ünïcödé & "quotes" & <entities> 日本語</p>',
		});
		cache.set("https://unicode.com", content);
		expect(cache.get("https://unicode.com")!.result).toBe(content);
	});

	test("empty string survives compression roundtrip", () => {
		cache.set("https://empty.com", "");
		expect(cache.get("https://empty.com")!.result).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Bun.hash() content hashing
// ---------------------------------------------------------------------------

describe("Bun.hash contentHash", () => {
	test("is deterministic", () => {
		expect(contentHash("test")).toBe(contentHash("test"));
	});

	test("different inputs produce different hashes", () => {
		expect(contentHash("a")).not.toBe(contentHash("b"));
	});

	test("returns a non-empty string", () => {
		expect(contentHash("anything").length).toBeGreaterThan(0);
	});

	test("handles empty string", () => {
		const hash = contentHash("");
		expect(hash.length).toBeGreaterThan(0);
		expect(contentHash("")).toBe(hash); // still deterministic
	});

	test("handles large content", () => {
		const large = "x".repeat(1_000_000);
		const hash = contentHash(large);
		expect(hash.length).toBeGreaterThan(0);
		expect(contentHash(large)).toBe(hash);
	});
});

// ---------------------------------------------------------------------------
// Bun.file() / Bun.write() in storage
// ---------------------------------------------------------------------------

describe("Bun.file storage", () => {
	test("loadStorageState returns null for nonexistent path", async () => {
		const result = await loadStorageState("/tmp/nonexistent-bun-native-test.json");
		expect(result).toBeNull();
	});

	test("loadStorageState reads Bun.write'd file", async () => {
		const path = join(tmpdir(), `feedstock-bun-storage-${Date.now()}.json`);
		const state = {
			cookies: [],
			origins: [],
			savedAt: Date.now(),
		};
		await Bun.write(path, JSON.stringify(state));

		const loaded = await loadStorageState(path);
		expect(loaded).not.toBeNull();
		expect(loaded!.savedAt).toBe(state.savedAt);
		expect(loaded!.cookies).toEqual([]);

		unlinkSync(path);
	});

	test("getStorageStatePath returns null for nonexistent", async () => {
		const result = await getStorageStatePath("/tmp/nonexistent-bun-path.json");
		expect(result).toBeNull();
	});

	test("getStorageStatePath returns path when file exists", async () => {
		const path = join(tmpdir(), `feedstock-bun-path-${Date.now()}.json`);
		await Bun.write(path, "{}");

		const result = await getStorageStatePath(path);
		expect(result).toBe(path);

		unlinkSync(path);
	});
});
