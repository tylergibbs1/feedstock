import { describe, expect, test } from "bun:test";
import { isSameDomain, normalizeUrl, stableStringify } from "../../src/utils/url";

describe("normalizeUrl", () => {
	test("removes fragments and tracking parameters and sorts the query", () => {
		expect(normalizeUrl("https://Example.com/docs/?utm_source=newsletter&b=2&a=1#intro")).toBe(
			"https://example.com/docs?a=1&b=2",
		);
	});

	test("can ignore the complete query string", () => {
		expect(
			normalizeUrl("/products?id=42&utm_campaign=spring", "https://example.com/shop/", {
				ignoreQueryParameters: true,
			}),
		).toBe("https://example.com/products");
	});

	test("rejects non-web protocols and invalid input", () => {
		expect(normalizeUrl("mailto:test@example.com")).toBeNull();
		expect(normalizeUrl("not a url")).toBeNull();
	});
});

describe("isSameDomain", () => {
	test("can include subdomains without accepting lookalike domains", () => {
		expect(isSameDomain("https://docs.example.com", "https://example.com", true)).toBe(true);
		expect(isSameDomain("https://notexample.com", "https://example.com", true)).toBe(false);
	});
});

describe("stableStringify", () => {
	test("is independent of object insertion order", () => {
		expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
			stableStringify({ a: { c: 3, d: 4 }, b: 2 }),
		);
	});
});
