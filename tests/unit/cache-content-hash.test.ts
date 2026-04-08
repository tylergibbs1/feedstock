import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrawlCache, contentHash } from "../../src/cache/database";

const TEST_DB = join(tmpdir(), `feedstock-hash-test-${Date.now()}.db`);

describe("contentHash", () => {
	test("produces consistent SHA-256 hex digest", () => {
		const hash1 = contentHash("hello world");
		const hash2 = contentHash("hello world");
		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
	});

	test("different content produces different hashes", () => {
		const hash1 = contentHash("content A");
		const hash2 = contentHash("content B");
		expect(hash1).not.toBe(hash2);
	});

	test("empty string has a valid hash", () => {
		const hash = contentHash("");
		expect(hash).toHaveLength(64);
	});
});

describe("CrawlCache content hash", () => {
	let cache: CrawlCache;

	beforeEach(() => {
		cache = new CrawlCache(TEST_DB);
		cache.clear();
	});

	afterAll(() => {
		cache.close();
		for (const suffix of ["", "-wal", "-shm"]) {
			const path = TEST_DB + suffix;
			if (existsSync(path)) unlinkSync(path);
		}
	});

	test("stores and retrieves content hash", () => {
		const hash = contentHash("<p>Hello</p>");
		cache.set("https://example.com", '{"html":"<p>Hello</p>"}', { contentHash: hash });

		const cached = cache.get("https://example.com");
		expect(cached).not.toBeNull();
		expect(cached!.contentHash).toBe(hash);
	});

	test("contentHash is null when not provided", () => {
		cache.set("https://example.com", "result");
		const cached = cache.get("https://example.com");
		expect(cached!.contentHash).toBeNull();
	});

	test("hasChanged returns true for new URLs", () => {
		expect(cache.hasChanged("https://new.com", contentHash("content"))).toBe(true);
	});

	test("hasChanged returns false for same content", () => {
		const hash = contentHash("<p>Same</p>");
		cache.set("https://example.com", "result", { contentHash: hash });
		expect(cache.hasChanged("https://example.com", hash)).toBe(false);
	});

	test("hasChanged returns true when content differs", () => {
		cache.set("https://example.com", "result", {
			contentHash: contentHash("old content"),
		});
		expect(cache.hasChanged("https://example.com", contentHash("new content"))).toBe(true);
	});

	test("hasChanged returns true when cached hash is null", () => {
		cache.set("https://example.com", "result"); // no contentHash
		expect(cache.hasChanged("https://example.com", contentHash("anything"))).toBe(true);
	});

	test("setMany stores content hashes", () => {
		cache.setMany([
			{ url: "https://a.com", result: "r1", contentHash: contentHash("a") },
			{ url: "https://b.com", result: "r2", contentHash: contentHash("b") },
			{ url: "https://c.com", result: "r3" }, // no hash
		]);

		expect(cache.get("https://a.com")!.contentHash).toBe(contentHash("a"));
		expect(cache.get("https://b.com")!.contentHash).toBe(contentHash("b"));
		expect(cache.get("https://c.com")!.contentHash).toBeNull();
	});

	test("migrates old-schema DB without content_hash column", () => {
		// Create a DB with the old schema (no content_hash column)
		const oldDb = join(tmpdir(), `feedstock-old-schema-${Date.now()}.db`);
		const db = new Database(oldDb);
		db.run(`
			CREATE TABLE crawl_cache (
				url TEXT PRIMARY KEY,
				result TEXT NOT NULL,
				cached_at REAL NOT NULL,
				etag TEXT,
				last_modified TEXT
			)
		`);
		db.query("INSERT INTO crawl_cache (url, result, cached_at) VALUES (?, ?, ?)").run(
			"https://old.com",
			'{"html":"old"}',
			Date.now() / 1000,
		);
		db.close();

		// Opening with CrawlCache should migrate the schema
		const migratedCache = new CrawlCache(oldDb);
		const cached = migratedCache.get("https://old.com");
		expect(cached).not.toBeNull();
		expect(cached!.result).toBe('{"html":"old"}');
		expect(cached!.contentHash).toBeNull();

		// New operations with content_hash should work
		const hash = contentHash("new content");
		migratedCache.set("https://new.com", "result", { contentHash: hash });
		expect(migratedCache.hasChanged("https://new.com", hash)).toBe(false);
		expect(migratedCache.hasChanged("https://old.com", hash)).toBe(true);

		migratedCache.close();
		for (const suffix of ["", "-wal", "-shm"]) {
			const path = oldDb + suffix;
			if (existsSync(path)) unlinkSync(path);
		}
	});

	test("content hash updates on overwrite", () => {
		const hash1 = contentHash("version 1");
		const hash2 = contentHash("version 2");

		cache.set("https://example.com", "v1", { contentHash: hash1 });
		expect(cache.hasChanged("https://example.com", hash1)).toBe(false);

		cache.set("https://example.com", "v2", { contentHash: hash2 });
		expect(cache.hasChanged("https://example.com", hash1)).toBe(true);
		expect(cache.hasChanged("https://example.com", hash2)).toBe(false);
	});
});
