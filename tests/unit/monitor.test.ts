import { describe, expect, test } from "bun:test";
import { CrawlerMonitor } from "../../src/utils/monitor";

describe("CrawlerMonitor", () => {
	test("tracks page counts", () => {
		const monitor = new CrawlerMonitor();
		monitor.start();

		monitor.recordPageComplete({
			success: true,
			fromCache: false,
			responseTimeMs: 100,
			bytesDownloaded: 5000,
		});
		monitor.recordPageComplete({
			success: true,
			fromCache: false,
			responseTimeMs: 200,
			bytesDownloaded: 3000,
		});
		monitor.recordPageComplete({
			success: false,
			fromCache: false,
			responseTimeMs: 50,
			bytesDownloaded: 0,
		});
		monitor.recordPageComplete({
			success: true,
			fromCache: true,
			responseTimeMs: 5,
			bytesDownloaded: 4000,
		});

		const stats = monitor.getStats();
		expect(stats.pagesTotal).toBe(4);
		expect(stats.pagesSuccess).toBe(2);
		expect(stats.pagesFailed).toBe(1);
		expect(stats.pagesFromCache).toBe(1);
		expect(stats.bytesDownloaded).toBe(12000);
	});

	test("calculates average response time", () => {
		const monitor = new CrawlerMonitor();
		monitor.start();

		monitor.recordPageComplete({
			success: true,
			fromCache: false,
			responseTimeMs: 100,
			bytesDownloaded: 0,
		});
		monitor.recordPageComplete({
			success: true,
			fromCache: false,
			responseTimeMs: 300,
			bytesDownloaded: 0,
		});

		const stats = monitor.getStats();
		expect(stats.avgResponseTime).toBe(200);
	});

	test("tracks current URL", () => {
		const monitor = new CrawlerMonitor();
		monitor.start();

		expect(monitor.getStats().currentUrl).toBeNull();
		monitor.recordPageStart("https://example.com");
		expect(monitor.getStats().currentUrl).toBe("https://example.com");
		monitor.recordPageComplete({
			success: true,
			fromCache: false,
			responseTimeMs: 50,
			bytesDownloaded: 0,
		});
		expect(monitor.getStats().currentUrl).toBeNull();
	});

	test("formats stats as string", () => {
		const monitor = new CrawlerMonitor();
		monitor.start();
		monitor.recordPageComplete({
			success: true,
			fromCache: false,
			responseTimeMs: 100,
			bytesDownloaded: 1024,
		});

		const formatted = monitor.formatStats();
		expect(formatted).toContain("Pages: 1");
		expect(formatted).toContain("1 ok");
		expect(formatted).toContain("0 failed");
	});
});
