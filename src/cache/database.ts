import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FEEDSTOCK_DIR = join(homedir(), ".feedstock");
const DB_PATH = join(FEEDSTOCK_DIR, "cache.db");

class CacheRow {
	url!: string;
	result!: string;
	cached_at!: number;
	etag!: string | null;
	last_modified!: string | null;
	content_hash!: string | null;
}

/**
 * Compute a fast non-cryptographic hash of content for change detection.
 * Uses Bun.hash (wyhash) for speed — fine for cache invalidation.
 */
export function contentHash(content: string): string {
	return Bun.hash(content).toString(36);
}

/**
 * Compress a result string with gzip and return base64-encoded data.
 */
function compress(data: string): string {
	const compressed = Bun.gzipSync(Buffer.from(data));
	return Buffer.from(compressed).toString("base64");
}

/**
 * Decompress a stored result string. Handles both gzip-compressed (base64)
 * and legacy uncompressed (raw JSON) formats for backward compatibility.
 */
function decompress(stored: string): string {
	// Legacy uncompressed data starts with a JSON character
	if (stored.startsWith("{") || stored.startsWith("[")) {
		return stored;
	}
	try {
		const decompressed = Bun.gunzipSync(Buffer.from(stored, "base64"));
		return Buffer.from(decompressed).toString("utf-8");
	} catch {
		// If decompression fails, assume it's raw legacy data
		return stored;
	}
}

/**
 * Cache layer using Bun's native SQLite.
 * Uses db.query() (Bun's preferred API) with .as() for typed results.
 */
export class CrawlCache {
	private db: Database;

	constructor(dbPath?: string) {
		const path = dbPath ?? DB_PATH;
		const dir = join(path, "..");

		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(path, { strict: true });
		this.db.run("PRAGMA journal_mode = WAL");
		this.db.run("PRAGMA busy_timeout = 5000");
		this.db.run("PRAGMA synchronous = NORMAL");

		this.db.run(`
      CREATE TABLE IF NOT EXISTS crawl_cache (
        url TEXT PRIMARY KEY,
        result TEXT NOT NULL,
        cached_at REAL NOT NULL,
        etag TEXT,
        last_modified TEXT,
        content_hash TEXT
      )
    `);

		// Migrate older schemas that lack the content_hash column
		this.migrateSchema();
	}

	private migrateSchema(): void {
		const columns = this.db.query("PRAGMA table_info(crawl_cache)").all() as Array<{
			name: string;
		}>;
		const colNames = new Set(columns.map((c) => c.name));

		if (!colNames.has("content_hash")) {
			this.db.run("ALTER TABLE crawl_cache ADD COLUMN content_hash TEXT");
		}
	}

	get(url: string): { result: string; cachedAt: number; contentHash: string | null } | null {
		const row = this.db
			.query("SELECT result, cached_at, content_hash FROM crawl_cache WHERE url = ?")
			.as(CacheRow)
			.get(url);
		if (!row) return null;
		return {
			result: decompress(row.result),
			cachedAt: row.cached_at,
			contentHash: row.content_hash,
		};
	}

	set(
		url: string,
		result: string,
		opts: { etag?: string; lastModified?: string; contentHash?: string } = {},
	): void {
		this.db
			.query(
				`INSERT OR REPLACE INTO crawl_cache (url, result, cached_at, etag, last_modified, content_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				url,
				compress(result),
				Date.now() / 1000,
				opts.etag ?? null,
				opts.lastModified ?? null,
				opts.contentHash ?? null,
			);
	}

	setMany(
		entries: Array<{
			url: string;
			result: string;
			etag?: string;
			lastModified?: string;
			contentHash?: string;
		}>,
	): void {
		const insert = this.db.transaction((items: typeof entries) => {
			const stmt = this.db.query(
				`INSERT OR REPLACE INTO crawl_cache (url, result, cached_at, etag, last_modified, content_hash)
           VALUES (?, ?, ?, ?, ?, ?)`,
			);
			const now = Date.now() / 1000;
			for (const item of items) {
				stmt.run(
					item.url,
					compress(item.result),
					now,
					item.etag ?? null,
					item.lastModified ?? null,
					item.contentHash ?? null,
				);
			}
			return items.length;
		});
		insert(entries);
	}

	/**
	 * Check if content has changed by comparing hash.
	 * Returns true if the content is new or different from cached.
	 */
	hasChanged(url: string, contentHash: string): boolean {
		const row = this.db
			.query("SELECT content_hash FROM crawl_cache WHERE url = ?")
			.as(CacheRow)
			.get(url);
		if (!row) return true; // New URL = changed
		return row.content_hash !== contentHash;
	}

	delete(url: string): void {
		this.db.query("DELETE FROM crawl_cache WHERE url = ?").run(url);
	}

	clear(): void {
		this.db.query("DELETE FROM crawl_cache").run();
	}

	/**
	 * Remove entries older than maxAgeMs milliseconds.
	 * Returns number of entries removed.
	 */
	pruneOlderThan(maxAgeMs: number): number {
		const cutoff = (Date.now() - maxAgeMs) / 1000;
		const result = this.db.query("DELETE FROM crawl_cache WHERE cached_at < ?").run(cutoff);
		return result.changes;
	}

	/**
	 * Get the number of cached entries.
	 */
	get size(): number {
		const row = this.db.query("SELECT COUNT(*) as count FROM crawl_cache").get() as {
			count: number;
		};
		return row.count;
	}

	close(): void {
		this.db.close();
	}
}
