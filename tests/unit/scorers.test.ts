import { describe, expect, test } from "bun:test";
import {
	CompositeScorer,
	DomainAuthorityScorer,
	FreshnessScorer,
	KeywordRelevanceScorer,
	PathDepthScorer,
} from "../../src/deep-crawl/scorers";

describe("KeywordRelevanceScorer", () => {
	test("scores based on keyword matches in URL", () => {
		const scorer = new KeywordRelevanceScorer(["product", "sale"]);
		expect(scorer.score("https://example.com/products/sale", 0)).toBe(1);
		expect(scorer.score("https://example.com/products/info", 0)).toBe(0.5);
		expect(scorer.score("https://example.com/about", 0)).toBe(0);
	});

	test("scores based on anchor text", () => {
		const scorer = new KeywordRelevanceScorer(["docs"]);
		expect(scorer.score("https://example.com/page", 0, { anchorText: "Read the docs" })).toBe(1);
	});

	test("returns 0 for empty keywords", () => {
		const scorer = new KeywordRelevanceScorer([]);
		expect(scorer.score("https://example.com", 0)).toBe(0);
	});
});

describe("PathDepthScorer", () => {
	test("shallower paths score higher", () => {
		const scorer = new PathDepthScorer(10);
		const root = scorer.score("https://example.com/", 0);
		const shallow = scorer.score("https://example.com/page", 0);
		const deep = scorer.score("https://example.com/a/b/c/d/e", 0);
		expect(root).toBeGreaterThan(shallow);
		expect(shallow).toBeGreaterThan(deep);
	});

	test("very deep paths approach 0", () => {
		const scorer = new PathDepthScorer(5);
		expect(scorer.score("https://example.com/a/b/c/d/e/f/g", 0)).toBe(0);
	});
});

describe("FreshnessScorer", () => {
	test("recent dates score higher", () => {
		const scorer = new FreshnessScorer();
		const currentYear = new Date().getFullYear();
		const recent = scorer.score(`https://example.com/${currentYear}/01/post`, 0);
		const old = scorer.score("https://example.com/2015/01/post", 0);
		expect(recent).toBeGreaterThan(old);
	});

	test("no date signal gets neutral score", () => {
		const scorer = new FreshnessScorer();
		expect(scorer.score("https://example.com/about", 0)).toBe(0.3);
	});
});

describe("DomainAuthorityScorer", () => {
	test("preferred domains score 1.0", () => {
		const scorer = new DomainAuthorityScorer(["example.com"]);
		expect(scorer.score("https://example.com/page", 0)).toBe(1.0);
	});

	test("subdomains of preferred domains score 0.8", () => {
		const scorer = new DomainAuthorityScorer(["example.com"]);
		expect(scorer.score("https://docs.example.com/page", 0)).toBe(0.8);
	});

	test("unknown domains score 0.3", () => {
		const scorer = new DomainAuthorityScorer(["example.com"]);
		expect(scorer.score("https://other.com/page", 0)).toBe(0.3);
	});
});

describe("CompositeScorer", () => {
	test("combines multiple scorers with weights", () => {
		const composite = new CompositeScorer([
			new KeywordRelevanceScorer(["docs"], 2.0),
			new PathDepthScorer(10, 1.0),
		]);

		const score = composite.score("https://example.com/docs", 0);
		// keyword: 1.0 * 2.0 = 2.0, pathDepth: 0.9 * 1.0 = 0.9, total = 2.9 / 3.0
		expect(score).toBeGreaterThan(0.5);
	});

	test("empty scorer returns 1", () => {
		const composite = new CompositeScorer();
		expect(composite.score("https://example.com", 0)).toBe(1);
	});

	test("fluent add API", () => {
		const composite = new CompositeScorer().add(new PathDepthScorer()).add(new FreshnessScorer());

		const score = composite.score("https://example.com/page", 0);
		expect(score).toBeGreaterThan(0);
	});
});
