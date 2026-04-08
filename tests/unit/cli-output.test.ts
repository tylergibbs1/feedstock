import { describe, expect, test } from "bun:test";
import { filterFields } from "../../src/cli/output";
import type { CrawlResult } from "../../src/models";
import { createErrorResult } from "../../src/models";

const MOCK_RESULT: CrawlResult = {
	url: "https://example.com",
	html: "<h1>Hello</h1>",
	success: true,
	cleanedHtml: "<h1>Hello</h1>",
	media: { images: [], videos: [], audios: [] },
	links: { internal: [], external: [] },
	markdown: {
		rawMarkdown: "# Hello",
		markdownWithCitations: "# Hello",
		referencesMarkdown: "",
		fitMarkdown: null,
	},
	extractedContent: null,
	metadata: { title: "Hello" },
	errorMessage: null,
	statusCode: 200,
	responseHeaders: {},
	screenshot: "base64screenshotdata",
	pdf: Buffer.from("pdfdata"),
	redirectedUrl: null,
	networkRequests: null,
	consoleMessages: null,
	sessionId: null,
	snapshot: null,
	interactiveElements: null,
	cacheStatus: "miss",
	cachedAt: null,
};

describe("filterFields", () => {
	test("omits screenshot and pdf by default", () => {
		const filtered = filterFields(MOCK_RESULT);
		expect(filtered).not.toHaveProperty("screenshot");
		expect(filtered).not.toHaveProperty("pdf");
		expect(filtered).toHaveProperty("url");
		expect(filtered).toHaveProperty("success");
		expect(filtered).toHaveProperty("markdown");
	});

	test("includes only specified fields", () => {
		const filtered = filterFields(MOCK_RESULT, ["url", "success", "statusCode"]);
		expect(Object.keys(filtered)).toEqual(["url", "success", "statusCode"]);
		expect(filtered.url).toBe("https://example.com");
		expect(filtered.success).toBe(true);
		expect(filtered.statusCode).toBe(200);
	});

	test("can explicitly include screenshot", () => {
		const filtered = filterFields(MOCK_RESULT, ["url", "screenshot"]);
		expect(filtered.screenshot).toBe("base64screenshotdata");
	});

	test("ignores nonexistent fields", () => {
		const filtered = filterFields(MOCK_RESULT, ["url", "nonexistent"]);
		expect(Object.keys(filtered)).toEqual(["url"]);
	});

	test("handles error results", () => {
		const errorResult = createErrorResult("https://fail.com", "timeout");
		const filtered = filterFields(errorResult, ["url", "success", "errorMessage"]);
		expect(filtered.url).toBe("https://fail.com");
		expect(filtered.success).toBe(false);
		expect(filtered.errorMessage).toBe("timeout");
	});
});
