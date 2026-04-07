import { describe, expect, test } from "bun:test";
import {
	ContentTypeFilter,
	DomainFilter,
	FilterChain,
	URLPatternFilter,
} from "../../src/deep-crawl/filters";

describe("Filter denial reasons", () => {
	test("URLPatternFilter gives exclude reason", async () => {
		const filter = new URLPatternFilter({ exclude: [/\/admin/] });
		const result = await filter.applyWithReason("https://example.com/admin/panel");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("exclude pattern");
		expect(result.reason).toContain("admin");
		expect(result.filter).toBe("url-pattern");
	});

	test("URLPatternFilter gives include miss reason", async () => {
		const filter = new URLPatternFilter({ include: [/\/docs\//] });
		const result = await filter.applyWithReason("https://example.com/about");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("include pattern");
	});

	test("URLPatternFilter returns allowed", async () => {
		const filter = new URLPatternFilter({ include: [/\/docs\//] });
		const result = await filter.applyWithReason("https://example.com/docs/api");
		expect(result.allowed).toBe(true);
		expect(result.reason).toBeUndefined();
	});

	test("DomainFilter gives blocked reason", async () => {
		const filter = new DomainFilter({ blocked: ["ads.com"] });
		const result = await filter.applyWithReason("https://ads.com/page");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("ads.com");
		expect(result.reason).toContain("blocked");
	});

	test("DomainFilter gives not-in-allowed reason", async () => {
		const filter = new DomainFilter({ allowed: ["example.com"] });
		const result = await filter.applyWithReason("https://other.com/page");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("other.com");
		expect(result.reason).toContain("not in allowed");
	});

	test("ContentTypeFilter gives extension reason", async () => {
		const filter = new ContentTypeFilter();
		const result = await filter.applyWithReason("https://example.com/file.pdf");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain(".pdf");
		expect(result.reason).toContain("blocked");
	});
});

describe("FilterChain denial tracking", () => {
	test("tracks denial reasons across filters", async () => {
		const chain = new FilterChain()
			.add(new DomainFilter({ allowed: ["example.com"] }))
			.add(new URLPatternFilter({ exclude: [/\/admin/] }));

		await chain.apply("https://other.com/page");
		await chain.apply("https://example.com/admin");
		await chain.apply("https://example.com/ok");

		const denials = chain.getDenials();
		expect(denials).toHaveLength(2);

		expect(denials[0].url).toBe("https://other.com/page");
		expect(denials[0].filter).toBe("domain");
		expect(denials[0].reason).toContain("not in allowed");

		expect(denials[1].url).toBe("https://example.com/admin");
		expect(denials[1].filter).toBe("url-pattern");
		expect(denials[1].reason).toContain("exclude");
	});

	test("getDenialsByFilter groups correctly", async () => {
		const chain = new FilterChain()
			.add(new DomainFilter({ allowed: ["example.com"] }))
			.add(new ContentTypeFilter());

		await chain.apply("https://other.com/page");
		await chain.apply("https://example.com/file.jpg");

		const byFilter = chain.getDenialsByFilter();
		expect(Object.keys(byFilter)).toEqual(["domain", "content-type"]);
		expect(byFilter.domain).toHaveLength(1);
		expect(byFilter["content-type"]).toHaveLength(1);
	});

	test("applyWithReason returns detailed result", async () => {
		const chain = new FilterChain().add(new DomainFilter({ blocked: ["evil.com"] }));

		const allowed = await chain.applyWithReason("https://good.com/page");
		expect(allowed.allowed).toBe(true);

		const blocked = await chain.applyWithReason("https://evil.com/page");
		expect(blocked.allowed).toBe(false);
		expect(blocked.reason).toContain("evil.com");
		expect(blocked.filter).toBe("domain");
	});

	test("clearDenials resets tracking", async () => {
		const chain = new FilterChain().add(new DomainFilter({ blocked: ["x.com"] }));

		await chain.apply("https://x.com/page");
		expect(chain.getDenials()).toHaveLength(1);

		chain.clearDenials();
		expect(chain.getDenials()).toHaveLength(0);
	});
});
