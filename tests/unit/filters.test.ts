import { describe, expect, test } from "bun:test";
import {
	ContentTypeFilter,
	DomainFilter,
	FilterChain,
	URLPatternFilter,
} from "../../src/deep-crawl/filters";

describe("URLPatternFilter", () => {
	test("passes all URLs when no patterns set", async () => {
		const filter = new URLPatternFilter();
		expect(await filter.apply("https://example.com/anything")).toBe(true);
	});

	test("include patterns restrict to matching URLs", async () => {
		const filter = new URLPatternFilter({
			include: [/\/blog\//],
		});
		expect(await filter.apply("https://example.com/blog/post")).toBe(true);
		expect(await filter.apply("https://example.com/about")).toBe(false);
	});

	test("exclude patterns reject matching URLs", async () => {
		const filter = new URLPatternFilter({
			exclude: [/\/admin/, /\/private/],
		});
		expect(await filter.apply("https://example.com/page")).toBe(true);
		expect(await filter.apply("https://example.com/admin/panel")).toBe(false);
		expect(await filter.apply("https://example.com/private/data")).toBe(false);
	});

	test("exclude takes priority over include", async () => {
		const filter = new URLPatternFilter({
			include: [/\/docs\//],
			exclude: [/\/docs\/internal/],
		});
		expect(await filter.apply("https://example.com/docs/public")).toBe(true);
		expect(await filter.apply("https://example.com/docs/internal/secret")).toBe(false);
	});

	test("supports glob-like string patterns", async () => {
		const filter = new URLPatternFilter({
			include: ["*/products/*"],
		});
		expect(await filter.apply("https://example.com/products/widget")).toBe(true);
		expect(await filter.apply("https://example.com/about")).toBe(false);
	});

	test("tracks stats", async () => {
		const filter = new URLPatternFilter({ exclude: [/\/nope/] });
		await filter.apply("https://example.com/yes");
		await filter.apply("https://example.com/nope");
		await filter.apply("https://example.com/also-yes");

		const stats = filter.getStats();
		expect(stats.total).toBe(3);
		expect(stats.passed).toBe(2);
		expect(stats.rejected).toBe(1);
	});
});

describe("DomainFilter", () => {
	test("allows all domains when no config", async () => {
		const filter = new DomainFilter();
		expect(await filter.apply("https://any.com/page")).toBe(true);
	});

	test("restricts to allowed domains", async () => {
		const filter = new DomainFilter({ allowed: ["example.com", "docs.example.com"] });
		expect(await filter.apply("https://example.com/page")).toBe(true);
		expect(await filter.apply("https://docs.example.com/page")).toBe(true);
		expect(await filter.apply("https://other.com/page")).toBe(false);
	});

	test("blocks specific domains", async () => {
		const filter = new DomainFilter({ blocked: ["ads.com", "tracker.io"] });
		expect(await filter.apply("https://example.com/page")).toBe(true);
		expect(await filter.apply("https://ads.com/page")).toBe(false);
		expect(await filter.apply("https://tracker.io/page")).toBe(false);
	});

	test("blocked takes priority over allowed", async () => {
		const filter = new DomainFilter({
			allowed: ["example.com"],
			blocked: ["example.com"],
		});
		expect(await filter.apply("https://example.com/page")).toBe(false);
	});

	test("rejects invalid URLs", async () => {
		const filter = new DomainFilter();
		expect(await filter.apply("not-a-url")).toBe(false);
	});
});

describe("ContentTypeFilter", () => {
	test("allows HTML-like extensions by default", async () => {
		const filter = new ContentTypeFilter();
		expect(await filter.apply("https://example.com/page")).toBe(true);
		expect(await filter.apply("https://example.com/page.html")).toBe(true);
		expect(await filter.apply("https://example.com/page.htm")).toBe(true);
		expect(await filter.apply("https://example.com/page.php")).toBe(true);
	});

	test("blocks binary/media extensions by default", async () => {
		const filter = new ContentTypeFilter();
		expect(await filter.apply("https://example.com/image.jpg")).toBe(false);
		expect(await filter.apply("https://example.com/file.pdf")).toBe(false);
		expect(await filter.apply("https://example.com/archive.zip")).toBe(false);
		expect(await filter.apply("https://example.com/style.css")).toBe(false);
		expect(await filter.apply("https://example.com/script.js")).toBe(false);
	});

	test("custom allowed extensions", async () => {
		const filter = new ContentTypeFilter({
			allowedExtensions: ["html", "json", ""],
			blockedExtensions: [],
		});
		expect(await filter.apply("https://example.com/data.json")).toBe(true);
		expect(await filter.apply("https://example.com/page.html")).toBe(true);
		expect(await filter.apply("https://example.com/file.pdf")).toBe(false);
	});
});

describe("FilterChain", () => {
	test("empty chain allows everything", async () => {
		const chain = new FilterChain();
		expect(await chain.apply("https://anything.com/path")).toBe(true);
	});

	test("all filters must pass", async () => {
		const chain = new FilterChain([
			new DomainFilter({ allowed: ["example.com"] }),
			new URLPatternFilter({ exclude: [/\/admin/] }),
			new ContentTypeFilter(),
		]);

		expect(await chain.apply("https://example.com/page")).toBe(true);
		expect(await chain.apply("https://other.com/page")).toBe(false); // domain
		expect(await chain.apply("https://example.com/admin")).toBe(false); // pattern
		expect(await chain.apply("https://example.com/file.pdf")).toBe(false); // content-type
	});

	test("short-circuits on first rejection", async () => {
		const chain = new FilterChain([
			new DomainFilter({ allowed: ["example.com"] }),
			new URLPatternFilter({ exclude: [/\/admin/] }),
		]);

		await chain.apply("https://other.com/admin");

		const stats = chain.getStats();
		// Domain filter should have rejected, pattern filter should not have been called
		expect(stats.domain.rejected).toBe(1);
		expect(stats["url-pattern"].total).toBe(0);
	});

	test("fluent add API", async () => {
		const chain = new FilterChain()
			.add(new DomainFilter({ allowed: ["example.com"] }))
			.add(new ContentTypeFilter());

		expect(await chain.apply("https://example.com/page")).toBe(true);
		expect(await chain.apply("https://other.com/page")).toBe(false);
	});
});
