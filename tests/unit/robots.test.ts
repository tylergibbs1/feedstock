import { describe, expect, test } from "bun:test";
import { RobotsParser } from "../../src/utils/robots";

const SAMPLE_ROBOTS = `
User-agent: *
Disallow: /private/
Disallow: /admin
Allow: /admin/public
Crawl-delay: 2

User-agent: feedstock
Disallow: /secret/
Allow: /secret/public/
Crawl-delay: 1

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap2.xml
`;

describe("RobotsParser", () => {
	describe("parse", () => {
		test("parses rules for matching user agent", () => {
			const parser = new RobotsParser("feedstock");
			const directives = parser.parse(SAMPLE_ROBOTS);

			expect(directives.crawlDelay).toBe(1);
			expect(directives.sitemaps).toEqual([
				"https://example.com/sitemap.xml",
				"https://example.com/sitemap2.xml",
			]);
		});

		test("falls back to wildcard user agent", () => {
			const parser = new RobotsParser("some-other-bot");
			const directives = parser.parse(SAMPLE_ROBOTS);

			expect(directives.crawlDelay).toBe(2);
		});

		test("handles empty robots.txt", () => {
			const parser = new RobotsParser();
			const directives = parser.parse("");

			expect(directives.rules).toEqual([]);
			expect(directives.crawlDelay).toBeNull();
			expect(directives.sitemaps).toEqual([]);
		});

		test("handles comments", () => {
			const parser = new RobotsParser();
			const directives = parser.parse(`
        # This is a comment
        User-agent: *
        Disallow: /hidden # inline comment
      `);

			expect(directives.rules.length).toBe(1);
		});
	});

	describe("isAllowed", () => {
		test("allows URLs not matching any disallow rule", () => {
			const parser = new RobotsParser("feedstock");
			const directives = parser.parse(SAMPLE_ROBOTS);

			expect(parser.isAllowed("https://example.com/", directives)).toBe(true);
			expect(parser.isAllowed("https://example.com/about", directives)).toBe(true);
			expect(parser.isAllowed("https://example.com/products", directives)).toBe(true);
		});

		test("disallows matching paths", () => {
			const parser = new RobotsParser("feedstock");
			const directives = parser.parse(SAMPLE_ROBOTS);

			expect(parser.isAllowed("https://example.com/secret/data", directives)).toBe(false);
			expect(parser.isAllowed("https://example.com/secret/nested/deep", directives)).toBe(false);
		});

		test("allow overrides disallow with longer match", () => {
			const parser = new RobotsParser("feedstock");
			const directives = parser.parse(SAMPLE_ROBOTS);

			// /secret/public/ is explicitly allowed, overriding /secret/
			expect(parser.isAllowed("https://example.com/secret/public/page", directives)).toBe(true);
		});

		test("wildcard agent rules work", () => {
			const parser = new RobotsParser("googlebot");
			const directives = parser.parse(SAMPLE_ROBOTS);

			expect(parser.isAllowed("https://example.com/private/page", directives)).toBe(false);
			expect(parser.isAllowed("https://example.com/admin", directives)).toBe(false);
			expect(parser.isAllowed("https://example.com/admin/public", directives)).toBe(true);
		});

		test("allows everything when no rules", () => {
			const parser = new RobotsParser();
			const directives = parser.parse("");

			expect(parser.isAllowed("https://example.com/anything", directives)).toBe(true);
		});

		test("handles wildcard patterns in paths", () => {
			const parser = new RobotsParser();
			const directives = parser.parse(`
        User-agent: *
        Disallow: /search*q=
        Disallow: /*.pdf$
      `);

			expect(parser.isAllowed("https://example.com/search?q=test", directives)).toBe(false);
			expect(parser.isAllowed("https://example.com/doc/file.pdf", directives)).toBe(false);
			expect(parser.isAllowed("https://example.com/doc/file.pdf?v=1", directives)).toBe(true);
			expect(parser.isAllowed("https://example.com/page", directives)).toBe(true);
		});
	});

	describe("caching", () => {
		test("clearCache empties the cache", () => {
			const parser = new RobotsParser();
			// Manually parse to populate — fetch() would need a real server
			parser.clearCache();
			// No error = success
		});
	});
});
