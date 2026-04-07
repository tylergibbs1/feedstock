import { describe, expect, test } from "bun:test";
import { createEmptyLinks, createEmptyMedia, createErrorResult } from "../../src/index";

describe("createErrorResult", () => {
	test("creates a failed result with error message", () => {
		const result = createErrorResult("https://example.com", "Connection refused");
		expect(result.url).toBe("https://example.com");
		expect(result.success).toBe(false);
		expect(result.errorMessage).toBe("Connection refused");
		expect(result.html).toBe("");
		expect(result.markdown).toBeNull();
		expect(result.cleanedHtml).toBeNull();
		expect(result.statusCode).toBeNull();
	});
});

describe("createEmptyMedia", () => {
	test("creates empty media object", () => {
		const media = createEmptyMedia();
		expect(media.images).toEqual([]);
		expect(media.videos).toEqual([]);
		expect(media.audios).toEqual([]);
	});
});

describe("createEmptyLinks", () => {
	test("creates empty links object", () => {
		const links = createEmptyLinks();
		expect(links.internal).toEqual([]);
		expect(links.external).toEqual([]);
	});
});
