/**
 * Change tracking — detect new, changed, unchanged, and removed pages
 * between crawl runs. Uses bun:sqlite for persistence and content
 * hashing for fast comparison.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CrawlResult } from "../models";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChangeStatus = "new" | "changed" | "unchanged" | "removed";

export interface PageChange {
	url: string;
	status: ChangeStatus;
	currentHash: string | null;
	previousHash: string | null;
	diff: TextDiff | null;
	currentTitle: string | null;
	previousTitle: string | null;
	detectedAt: number;
}

export interface TextDiff {
	additions: number;
	deletions: number;
	chunks: DiffChunk[];
}

export interface DiffChunk {
	type: "add" | "remove" | "context";
	lines: string[];
}

export interface ChangeReport {
	snapshotId: string;
	previousSnapshotId: string | null;
	timestamp: number;
	summary: {
		total: number;
		new: number;
		changed: number;
		unchanged: number;
		removed: number;
	};
	changes: PageChange[];
}

export interface ChangeTrackerConfig {
	/** Generate text diffs for changed pages (default: true) */
	includeDiffs: boolean;
	/** Use markdown for diffing instead of cleaned HTML (default: true) */
	diffMarkdown: boolean;
	/** Max diff chunks to include per page (default: 50) */
	maxDiffChunks: number;
}

// ---------------------------------------------------------------------------
// Storage row
// ---------------------------------------------------------------------------

class SnapshotRow {
	url!: string;
	content_hash!: string;
	title!: string | null;
	content!: string | null;
	snapshot_id!: string;
	created_at!: number;
}

// ---------------------------------------------------------------------------
// Change Tracker
// ---------------------------------------------------------------------------

const DEFAULT_DB_PATH = join(homedir(), ".feedstock", "changes.db");

const DEFAULT_CONFIG: ChangeTrackerConfig = {
	includeDiffs: true,
	diffMarkdown: true,
	maxDiffChunks: 50,
};

export class ChangeTracker {
	private db: Database;
	private config: ChangeTrackerConfig;

	constructor(opts: { dbPath?: string; config?: Partial<ChangeTrackerConfig> } = {}) {
		const path = opts.dbPath ?? DEFAULT_DB_PATH;
		const dir = dirname(path);

		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(path, { strict: true });
		this.db.run("PRAGMA journal_mode = WAL");
		this.db.run("PRAGMA busy_timeout = 5000");

		this.db.run(`
			CREATE TABLE IF NOT EXISTS snapshots (
				url TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				title TEXT,
				content TEXT,
				snapshot_id TEXT NOT NULL,
				created_at REAL NOT NULL,
				PRIMARY KEY (url, snapshot_id)
			)
		`);

		this.db.run(`
			CREATE INDEX IF NOT EXISTS idx_snapshots_snapshot_id
			ON snapshots (snapshot_id)
		`);

		this.config = { ...DEFAULT_CONFIG, ...opts.config };
	}

	/**
	 * Take a snapshot of crawl results and compare against the previous snapshot.
	 * Returns a ChangeReport with categorized changes.
	 */
	compare(results: CrawlResult[], snapshotId?: string): ChangeReport {
		const id = snapshotId ?? `snap_${Date.now()}`;
		const previousId = this.getLatestSnapshotId();
		const now = Date.now();

		// Get previous snapshot URLs
		const previousPages = previousId
			? this.getSnapshotPages(previousId)
			: new Map<string, SnapshotRow>();

		// Process current results
		const changes: PageChange[] = [];
		const currentUrls = new Set<string>();

		const insertStmt = this.db.query(
			"INSERT OR REPLACE INTO snapshots (url, content_hash, title, content, snapshot_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		);

		for (const result of results) {
			if (!result.success) continue;

			const url = result.url;
			currentUrls.add(url);

			const content = this.getContent(result);
			const hash = this.hashContent(content);
			const title = (result.metadata?.title as string) ?? null;

			// Store snapshot
			insertStmt.run(url, hash, title, this.config.includeDiffs ? content : null, id, now / 1000);

			const previous = previousPages.get(url);

			if (!previous) {
				// New page
				changes.push({
					url,
					status: "new",
					currentHash: hash,
					previousHash: null,
					diff: null,
					currentTitle: title,
					previousTitle: null,
					detectedAt: now,
				});
			} else if (previous.content_hash !== hash) {
				// Changed page
				let diff: TextDiff | null = null;
				if (this.config.includeDiffs && previous.content && content) {
					diff = computeDiff(previous.content, content, this.config.maxDiffChunks);
				}

				changes.push({
					url,
					status: "changed",
					currentHash: hash,
					previousHash: previous.content_hash,
					diff,
					currentTitle: title,
					previousTitle: previous.title,
					detectedAt: now,
				});
			} else {
				// Unchanged
				changes.push({
					url,
					status: "unchanged",
					currentHash: hash,
					previousHash: previous.content_hash,
					diff: null,
					currentTitle: title,
					previousTitle: previous.title,
					detectedAt: now,
				});
			}
		}

		// Detect removed pages
		for (const [url, previous] of previousPages) {
			if (!currentUrls.has(url)) {
				changes.push({
					url,
					status: "removed",
					currentHash: null,
					previousHash: previous.content_hash,
					diff: null,
					currentTitle: null,
					previousTitle: previous.title,
					detectedAt: now,
				});
			}
		}

		const summary = {
			total: changes.length,
			new: changes.filter((c) => c.status === "new").length,
			changed: changes.filter((c) => c.status === "changed").length,
			unchanged: changes.filter((c) => c.status === "unchanged").length,
			removed: changes.filter((c) => c.status === "removed").length,
		};

		return {
			snapshotId: id,
			previousSnapshotId: previousId,
			timestamp: now,
			summary,
			changes,
		};
	}

	/**
	 * Get a list of all snapshot IDs, newest first.
	 */
	listSnapshots(): Array<{ id: string; pageCount: number; createdAt: number }> {
		const rows = this.db
			.query(
				"SELECT snapshot_id, COUNT(*) as page_count, MAX(created_at) as created_at FROM snapshots GROUP BY snapshot_id ORDER BY created_at DESC",
			)
			.all() as Array<{ snapshot_id: string; page_count: number; created_at: number }>;

		return rows.map((r) => ({
			id: r.snapshot_id,
			pageCount: r.page_count,
			createdAt: r.created_at * 1000,
		}));
	}

	/**
	 * Delete a snapshot and all its pages.
	 */
	deleteSnapshot(snapshotId: string): void {
		this.db.query("DELETE FROM snapshots WHERE snapshot_id = ?").run(snapshotId);
	}

	/**
	 * Delete all snapshots older than the given age in milliseconds.
	 */
	pruneOlderThan(maxAgeMs: number): number {
		const cutoff = (Date.now() - maxAgeMs) / 1000;
		const result = this.db.query("DELETE FROM snapshots WHERE created_at < ?").run(cutoff);
		return result.changes;
	}

	close(): void {
		this.db.close();
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	private getLatestSnapshotId(): string | null {
		const row = this.db
			.query("SELECT snapshot_id FROM snapshots ORDER BY created_at DESC LIMIT 1")
			.get() as { snapshot_id: string } | null;
		return row?.snapshot_id ?? null;
	}

	private getSnapshotPages(snapshotId: string): Map<string, SnapshotRow> {
		const rows = this.db
			.query(
				"SELECT url, content_hash, title, content, snapshot_id, created_at FROM snapshots WHERE snapshot_id = ?",
			)
			.as(SnapshotRow)
			.all(snapshotId);

		const map = new Map<string, SnapshotRow>();
		for (const row of rows) {
			map.set(row.url, row);
		}
		return map;
	}

	private getContent(result: CrawlResult): string {
		if (this.config.diffMarkdown && result.markdown?.rawMarkdown) {
			return result.markdown.rawMarkdown;
		}
		return result.cleanedHtml ?? result.html;
	}

	private hashContent(content: string): string {
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update(content);
		return hasher.digest("hex");
	}
}

// ---------------------------------------------------------------------------
// Text diffing
// ---------------------------------------------------------------------------

function computeDiff(oldText: string, newText: string, maxChunks: number): TextDiff {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");

	// Simple line-by-line diff using longest common subsequence
	const lcs = computeLCS(oldLines, newLines);

	const chunks: DiffChunk[] = [];
	let additions = 0;
	let deletions = 0;

	let oldIdx = 0;
	let newIdx = 0;

	for (const [oldMatch, newMatch] of lcs) {
		// Removed lines (in old but not matched)
		if (oldIdx < oldMatch) {
			const removed = oldLines.slice(oldIdx, oldMatch);
			chunks.push({ type: "remove", lines: removed });
			deletions += removed.length;
		}

		// Added lines (in new but not matched)
		if (newIdx < newMatch) {
			const added = newLines.slice(newIdx, newMatch);
			chunks.push({ type: "add", lines: added });
			additions += added.length;
		}

		// Context line (matched)
		chunks.push({ type: "context", lines: [newLines[newMatch]] });

		oldIdx = oldMatch + 1;
		newIdx = newMatch + 1;
	}

	// Trailing removals
	if (oldIdx < oldLines.length) {
		const removed = oldLines.slice(oldIdx);
		chunks.push({ type: "remove", lines: removed });
		deletions += removed.length;
	}

	// Trailing additions
	if (newIdx < newLines.length) {
		const added = newLines.slice(newIdx);
		chunks.push({ type: "add", lines: added });
		additions += added.length;
	}

	// Merge consecutive same-type chunks and limit
	const merged = mergeChunks(chunks);

	return {
		additions,
		deletions,
		chunks: merged.slice(0, maxChunks),
	};
}

/**
 * Compute LCS (Longest Common Subsequence) indices.
 * Returns array of [oldIndex, newIndex] pairs for matching lines.
 */
function computeLCS(oldLines: string[], newLines: string[]): Array<[number, number]> {
	const m = oldLines.length;
	const n = newLines.length;

	// Use fast hash-based approach for most real-world pages
	if (m * n > 10_000) {
		return simpleLCS(oldLines, newLines);
	}

	// Standard DP approach
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to find matches
	const matches: Array<[number, number]> = [];
	let i = m;
	let j = n;

	while (i > 0 && j > 0) {
		if (oldLines[i - 1] === newLines[j - 1]) {
			matches.unshift([i - 1, j - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}

	return matches;
}

/**
 * Simple LCS for large inputs — use line hashing for O(n) matching.
 */
function simpleLCS(oldLines: string[], newLines: string[]): Array<[number, number]> {
	const newMap = new Map<string, number[]>();
	for (let j = 0; j < newLines.length; j++) {
		const line = newLines[j];
		if (!newMap.has(line)) newMap.set(line, []);
		newMap.get(line)!.push(j);
	}

	const matches: Array<[number, number]> = [];
	let lastJ = -1;

	for (let i = 0; i < oldLines.length; i++) {
		const candidates = newMap.get(oldLines[i]);
		if (!candidates) continue;

		for (const j of candidates) {
			if (j > lastJ) {
				matches.push([i, j]);
				lastJ = j;
				break;
			}
		}
	}

	return matches;
}

function mergeChunks(chunks: DiffChunk[]): DiffChunk[] {
	if (chunks.length === 0) return [];

	const merged: DiffChunk[] = [chunks[0]];

	for (let i = 1; i < chunks.length; i++) {
		const prev = merged[merged.length - 1];
		const curr = chunks[i];

		if (prev.type === curr.type) {
			prev.lines.push(...curr.lines);
		} else {
			merged.push(curr);
		}
	}

	return merged;
}
