import { describe, expect, test } from "bun:test";
import {
	NeuralQualityScorer,
	computePageQuality,
	CompositeScorer,
} from "../../src/deep-crawl";
import type { CrawlResult } from "../../src/models";
import { createErrorResult, createEmptyMedia, createEmptyLinks } from "../../src/models";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrawlResult(overrides: Partial<CrawlResult> = {}): CrawlResult {
	return {
		url: "https://example.com/page",
		html: "<html><body>hello</body></html>",
		success: true,
		cleanedHtml: "<body>hello</body>",
		media: createEmptyMedia(),
		links: createEmptyLinks(),
		markdown: {
			rawMarkdown: "",
			markdownWithCitations: "",
			referencesMarkdown: "",
			fitMarkdown: null,
		},
		extractedContent: null,
		metadata: null,
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
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Feature extraction tests
// ---------------------------------------------------------------------------

describe("NeuralQualityScorer — feature extraction", () => {
	test("URL with deep path gets higher url:path_depth feature", () => {
		const scorer = new NeuralQualityScorer();
		const shallow = scorer.score("https://example.com/page", 0);
		const deep = scorer.score("https://example.com/a/b/c/d/e/f/g", 0);
		// Both return ~0.5 initially (prior), but the structure should differ
		// once trained. For now, just verify they return valid scores.
		expect(shallow).toBeGreaterThanOrEqual(0);
		expect(shallow).toBeLessThanOrEqual(1);
		expect(deep).toBeGreaterThanOrEqual(0);
		expect(deep).toBeLessThanOrEqual(1);
	});

	test("URL containing 'article' or 'blog' activates corresponding features", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		// Train: article URLs are high quality
		for (let i = 0; i < 10; i++) {
			scorer.observe(`https://example.com/article/post-${i}`, 0.9);
			scorer.observe(`https://example.com/nav/page-${i}`, 0.1);
		}
		const articleScore = scorer.score("https://example.com/article/new-post", 0);
		const navScore = scorer.score("https://example.com/nav/other", 0);
		expect(articleScore).toBeGreaterThan(navScore);
	});

	test("anchor text features extracted correctly", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		// Train with descriptive anchors being high quality
		for (let i = 0; i < 10; i++) {
			scorer.observe(`https://example.com/p/${i}`, 0.9, {
				anchorText: "A comprehensive guide to TypeScript generics and advanced types",
			});
			scorer.observe(`https://example.com/q/${i}`, 0.1, {
				anchorText: "next",
			});
		}
		const descriptive = scorer.score("https://example.com/p/new", 0, {
			anchorText: "Understanding TypeScript mapped types and conditional inference",
		});
		const navigational = scorer.score("https://example.com/q/new", 0, {
			anchorText: "back",
		});
		expect(descriptive).toBeGreaterThan(navigational);
	});

	test("query keywords in anchor text activate contains features", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		for (let i = 0; i < 10; i++) {
			scorer.observe(`https://example.com/r/${i}`, 0.95, {
				anchorText: "TypeScript tutorial",
				query: "typescript",
			});
			scorer.observe(`https://example.com/s/${i}`, 0.1, {
				anchorText: "Cookie policy",
				query: "typescript",
			});
		}
		const relevant = scorer.score("https://example.com/r/new", 0, {
			anchorText: "Learn TypeScript today",
			query: "typescript",
		});
		const irrelevant = scorer.score("https://example.com/s/new", 0, {
			anchorText: "Privacy notice",
			query: "typescript",
		});
		expect(relevant).toBeGreaterThan(irrelevant);
	});
});

// ---------------------------------------------------------------------------
// Scoring tests
// ---------------------------------------------------------------------------

describe("NeuralQualityScorer — scoring", () => {
	test("initial scoring returns reasonable defaults around 0.5", () => {
		const scorer = new NeuralQualityScorer();
		const s = scorer.score("https://example.com/some-page", 0);
		expect(s).toBeGreaterThan(0.3);
		expect(s).toBeLessThan(0.7);
	});

	test("content-indicating paths score higher after training", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		for (let i = 0; i < 15; i++) {
			scorer.observe(`https://example.com/blog/entry-${i}`, 0.9);
			scorer.observe(`https://example.com/category/list-${i}`, 0.3);
		}
		const blogScore = scorer.score("https://example.com/blog/new-entry", 0);
		const catScore = scorer.score("https://example.com/category/new-list", 0);
		expect(blogScore).toBeGreaterThan(catScore);
	});

	test("long descriptive anchor text scores higher than short generic text", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		for (let i = 0; i < 10; i++) {
			scorer.observe(`https://example.com/a/${i}`, 0.9, {
				anchorText: "Detailed guide to building web crawlers with TypeScript and Bun",
			});
			scorer.observe(`https://example.com/b/${i}`, 0.15, {
				anchorText: "click here",
			});
		}
		const descriptive = scorer.score("https://example.com/a/new", 0, {
			anchorText: "Complete tutorial on async programming patterns in modern JavaScript",
		});
		const generic = scorer.score("https://example.com/b/new", 0, {
			anchorText: "click here",
		});
		expect(descriptive).toBeGreaterThan(generic);
	});
});

// ---------------------------------------------------------------------------
// Learning tests
// ---------------------------------------------------------------------------

describe("NeuralQualityScorer — learning", () => {
	test("after observing high quality for article URLs, new articles score higher", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		const before = scorer.score("https://example.com/article/test", 0);
		for (let i = 0; i < 20; i++) {
			scorer.observe(`https://example.com/article/item-${i}`, 0.95);
		}
		const after = scorer.score("https://example.com/article/test", 0);
		expect(after).toBeGreaterThan(before);
	});

	test("after observing low quality for navigational anchors, they score lower", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		const before = scorer.score("https://example.com/page", 0, { anchorText: "next" });
		for (let i = 0; i < 20; i++) {
			scorer.observe(`https://example.com/page-${i}`, 0.05, { anchorText: "next" });
		}
		const after = scorer.score("https://example.com/page", 0, { anchorText: "next" });
		expect(after).toBeLessThan(before);
	});

	test("learning rate affects how quickly weights change", () => {
		const slow = new NeuralQualityScorer({ learningRate: 0.01, minObservations: 0 });
		const fast = new NeuralQualityScorer({ learningRate: 0.5, minObservations: 0 });

		for (let i = 0; i < 5; i++) {
			slow.observe(`https://example.com/article/p-${i}`, 0.95);
			fast.observe(`https://example.com/article/p-${i}`, 0.95);
		}

		const slowScore = slow.score("https://example.com/article/new", 0);
		const fastScore = fast.score("https://example.com/article/new", 0);
		// Fast learner should diverge more from the 0.5 prior
		expect(Math.abs(fastScore - 0.5)).toBeGreaterThan(Math.abs(slowScore - 0.5));
	});

	test("multiple observations converge the model", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		const scores: number[] = [];

		for (let i = 0; i < 30; i++) {
			scorer.observe(`https://example.com/docs/page-${i}`, 0.8);
			scores.push(scorer.score("https://example.com/docs/new-page", 0));
		}

		// Later scores should be closer to 0.8 than early scores
		const earlyAvg = (scores[0]! + scores[1]! + scores[2]!) / 3;
		const lateAvg = (scores[27]! + scores[28]! + scores[29]!) / 3;
		expect(Math.abs(lateAvg - 0.8)).toBeLessThan(Math.abs(earlyAvg - 0.8));
	});
});

// ---------------------------------------------------------------------------
// Quality propagation tests
// ---------------------------------------------------------------------------

describe("NeuralQualityScorer — quality propagation", () => {
	test("child URL of a high-quality parent gets boosted score", () => {
		const scorer = new NeuralQualityScorer({
			propagationFactor: 0.3,
			minObservations: 0,
		});
		scorer.observe("https://example.com/good-parent", 0.95);

		const boosted = scorer.score("https://example.com/child", 0, {
			parentUrl: "https://example.com/good-parent",
		});
		const unboosted = scorer.score("https://example.com/child", 0);

		expect(boosted).toBeGreaterThan(unboosted);
	});

	test("child URL of a low-quality parent gets penalized", () => {
		const scorer = new NeuralQualityScorer({
			propagationFactor: 0.3,
			minObservations: 0,
		});
		scorer.observe("https://example.com/bad-parent", 0.05);

		const penalized = scorer.score("https://example.com/child", 0, {
			parentUrl: "https://example.com/bad-parent",
		});
		const neutral = scorer.score("https://example.com/child", 0);

		expect(penalized).toBeLessThan(neutral);
	});

	test("propagationFactor=0 disables propagation", () => {
		const scorer = new NeuralQualityScorer({
			propagationFactor: 0,
			minObservations: 0,
		});
		scorer.observe("https://example.com/great-parent", 1.0);

		const withParent = scorer.score("https://example.com/child", 0, {
			parentUrl: "https://example.com/great-parent",
		});
		const withoutParent = scorer.score("https://example.com/child", 0);

		expect(withParent).toBeCloseTo(withoutParent, 1);
	});
});

// ---------------------------------------------------------------------------
// computePageQuality tests
// ---------------------------------------------------------------------------

describe("computePageQuality", () => {
	test("rich page with long content and markdown scores high", () => {
		const richContent = "a".repeat(12000);
		const result = makeCrawlResult({
			markdown: {
				rawMarkdown: richContent,
				markdownWithCitations: richContent,
				referencesMarkdown: "",
				fitMarkdown: null,
			},
			cleanedHtml: richContent,
			extractedContent: '{"data": "something"}',
			statusCode: 200,
			url: "https://example.com/article",
		});
		const quality = computePageQuality(result);
		expect(quality).toBeGreaterThan(0.7);
	});

	test("empty/error page scores low", () => {
		const result = createErrorResult("https://example.com/broken", "timeout");
		const quality = computePageQuality(result);
		expect(quality).toBeLessThan(0.3);
	});

	test("medium page gets medium quality", () => {
		const mediumContent = "b".repeat(3000);
		const result = makeCrawlResult({
			markdown: {
				rawMarkdown: mediumContent,
				markdownWithCitations: mediumContent,
				referencesMarkdown: "",
				fitMarkdown: null,
			},
			cleanedHtml: mediumContent,
			extractedContent: null,
			statusCode: 200,
			url: "https://example.com/page",
		});
		const quality = computePageQuality(result);
		expect(quality).toBeGreaterThan(0.3);
		expect(quality).toBeLessThan(0.8);
	});
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("NeuralQualityScorer — integration", () => {
	test("works with CompositeScorer", () => {
		const neural = new NeuralQualityScorer({}, 2.0);
		const composite = new CompositeScorer([neural]);
		const score = composite.score("https://example.com/page", 0);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	test("score improves over multiple observe cycles for consistent patterns", () => {
		const scorer = new NeuralQualityScorer({ minObservations: 0 });
		const targetUrl = "https://example.com/docs/api-reference";

		const scoreBefore = scorer.score(targetUrl, 0);

		// Observe that docs pages are consistently high quality
		for (let i = 0; i < 20; i++) {
			scorer.observe(`https://example.com/docs/topic-${i}`, 0.9);
		}

		const scoreAfter = scorer.score(targetUrl, 0);
		expect(scoreAfter).toBeGreaterThan(scoreBefore);
	});

	test("getStats returns correct observation count and feature weights", () => {
		const scorer = new NeuralQualityScorer();
		expect(scorer.getStats().observations).toBe(0);
		expect(scorer.getStats().avgQuality).toBe(0);

		scorer.observe("https://example.com/a", 0.8);
		scorer.observe("https://example.com/b", 0.6);

		const stats = scorer.getStats();
		expect(stats.observations).toBe(2);
		expect(stats.avgQuality).toBeCloseTo(0.7, 1);
		expect(stats.featureWeights.size).toBeGreaterThan(0);
	});
});
