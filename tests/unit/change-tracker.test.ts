import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrawlResult } from "../../src/models";
import { createEmptyLinks, createEmptyMedia } from "../../src/models";
import { ChangeTracker } from "../../src/utils/change-tracker";

const TEST_DB = join(tmpdir(), `feedstock-change-test-${Date.now()}.db`);

function makeCrawlResult(url: string, html: string, title = "Test"): CrawlResult {
	return {
		url,
		html,
		success: true,
		cleanedHtml: html,
		media: createEmptyMedia(),
		links: createEmptyLinks(),
		markdown: {
			rawMarkdown: html,
			markdownWithCitations: html,
			referencesMarkdown: "",
			fitMarkdown: null,
		},
		extractedContent: null,
		metadata: { title },
		errorMessage: null,
		statusCode: 200,
		responseHeaders: null,
		screenshot: null,
		pdf: null,
		redirectedUrl: null,
		networkRequests: null,
		consoleMessages: null,
		sessionId: null,
		snapshot: null,
		interactiveElements: null,
		cacheStatus: null,
		cachedAt: null,
	};
}

describe("ChangeTracker", () => {
	let tracker: ChangeTracker;

	beforeEach(() => {
		tracker = new ChangeTracker({ dbPath: TEST_DB });
		// Clean slate
		for (const snap of tracker.listSnapshots()) {
			tracker.deleteSnapshot(snap.id);
		}
	});

	afterAll(() => {
		tracker.close();
		for (const suffix of ["", "-wal", "-shm"]) {
			const path = TEST_DB + suffix;
			if (existsSync(path)) unlinkSync(path);
		}
	});

	test("first compare: all pages are 'new'", () => {
		const results = [
			makeCrawlResult("https://example.com/a", "<h1>Page A</h1>"),
			makeCrawlResult("https://example.com/b", "<h1>Page B</h1>"),
		];

		const report = tracker.compare(results, "snap1");

		expect(report.snapshotId).toBe("snap1");
		expect(report.previousSnapshotId).toBeNull();
		expect(report.summary.total).toBe(2);
		expect(report.summary.new).toBe(2);
		expect(report.summary.changed).toBe(0);
		expect(report.summary.unchanged).toBe(0);
		expect(report.summary.removed).toBe(0);
	});

	test("identical content: pages are 'unchanged'", () => {
		const results = [makeCrawlResult("https://example.com/a", "<h1>Page A</h1>")];

		tracker.compare(results, "snap1");
		const report = tracker.compare(results, "snap2");

		expect(report.previousSnapshotId).toBe("snap1");
		expect(report.summary.unchanged).toBe(1);
		expect(report.summary.new).toBe(0);
		expect(report.summary.changed).toBe(0);
	});

	test("modified content: pages are 'changed'", () => {
		const v1 = [makeCrawlResult("https://example.com/a", "Version 1 content")];
		const v2 = [makeCrawlResult("https://example.com/a", "Version 2 different content")];

		tracker.compare(v1, "snap1");
		const report = tracker.compare(v2, "snap2");

		expect(report.summary.changed).toBe(1);
		expect(report.summary.unchanged).toBe(0);

		const change = report.changes[0];
		expect(change.status).toBe("changed");
		expect(change.previousHash).not.toBe(change.currentHash);
	});

	test("missing pages: detected as 'removed'", () => {
		const v1 = [
			makeCrawlResult("https://example.com/a", "A"),
			makeCrawlResult("https://example.com/b", "B"),
		];
		const v2 = [makeCrawlResult("https://example.com/a", "A")];

		tracker.compare(v1, "snap1");
		const report = tracker.compare(v2, "snap2");

		expect(report.summary.removed).toBe(1);
		const removed = report.changes.find((c) => c.status === "removed");
		expect(removed).toBeDefined();
		expect(removed!.url).toBe("https://example.com/b");
	});

	test("new pages: detected as 'new'", () => {
		const v1 = [makeCrawlResult("https://example.com/a", "A")];
		const v2 = [
			makeCrawlResult("https://example.com/a", "A"),
			makeCrawlResult("https://example.com/c", "C"),
		];

		tracker.compare(v1, "snap1");
		const report = tracker.compare(v2, "snap2");

		expect(report.summary.new).toBe(1);
		expect(report.summary.unchanged).toBe(1);
	});

	test("generates text diffs for changed pages", () => {
		const v1 = [makeCrawlResult("https://example.com/a", "Line 1\nLine 2\nLine 3")];
		const v2 = [
			makeCrawlResult("https://example.com/a", "Line 1\nLine 2 modified\nLine 3\nLine 4"),
		];

		tracker.compare(v1, "snap1");
		const report = tracker.compare(v2, "snap2");

		const change = report.changes[0];
		expect(change.diff).not.toBeNull();
		expect(change.diff!.additions).toBeGreaterThan(0);
		expect(change.diff!.deletions).toBeGreaterThan(0);
		expect(change.diff!.chunks.length).toBeGreaterThan(0);
	});

	test("mixed scenario: new + changed + unchanged + removed", () => {
		const v1 = [
			makeCrawlResult("https://example.com/a", "Same content"),
			makeCrawlResult("https://example.com/b", "Will change"),
			makeCrawlResult("https://example.com/c", "Will be removed"),
		];
		const v2 = [
			makeCrawlResult("https://example.com/a", "Same content"),
			makeCrawlResult("https://example.com/b", "Changed content"),
			makeCrawlResult("https://example.com/d", "Brand new page"),
		];

		tracker.compare(v1, "snap1");
		const report = tracker.compare(v2, "snap2");

		expect(report.summary.unchanged).toBe(1);
		expect(report.summary.changed).toBe(1);
		expect(report.summary.removed).toBe(1);
		expect(report.summary.new).toBe(1);
		expect(report.summary.total).toBe(4);
	});

	test("listSnapshots returns all snapshots", () => {
		tracker.compare([makeCrawlResult("https://a.com", "A")], "s1");
		tracker.compare([makeCrawlResult("https://b.com", "B")], "s2");

		const snapshots = tracker.listSnapshots();
		expect(snapshots.length).toBe(2);
		const ids = snapshots.map((s) => s.id).sort();
		expect(ids).toEqual(["s1", "s2"]);
	});

	test("deleteSnapshot removes a snapshot", () => {
		tracker.compare([makeCrawlResult("https://a.com", "A")], "s1");
		tracker.compare([makeCrawlResult("https://a.com", "A")], "s2");

		tracker.deleteSnapshot("s1");
		const snapshots = tracker.listSnapshots();
		expect(snapshots.length).toBe(1);
		expect(snapshots[0].id).toBe("s2");
	});

	test("pruneOlderThan removes old snapshots", () => {
		tracker.compare([makeCrawlResult("https://a.com", "A")], "old");
		// This snapshot was just created, so pruning with a small window shouldn't remove it
		const removed = tracker.pruneOlderThan(1);
		expect(removed).toBe(0);
	});

	test("skips failed results", () => {
		const results: CrawlResult[] = [{ ...makeCrawlResult("https://a.com", ""), success: false }];

		const report = tracker.compare(results, "s1");
		expect(report.summary.total).toBe(0);
	});

	test("tracks title changes", () => {
		const v1 = [makeCrawlResult("https://a.com", "Same", "Old Title")];
		const v2 = [makeCrawlResult("https://a.com", "Different", "New Title")];

		tracker.compare(v1, "s1");
		const report = tracker.compare(v2, "s2");

		const change = report.changes[0];
		expect(change.previousTitle).toBe("Old Title");
		expect(change.currentTitle).toBe("New Title");
	});
});
