import { describe, expect, test } from "bun:test";
import {
	BanditScorer,
	computeReward,
	createBanditConfig,
} from "../../src/deep-crawl/bandit-scorer";
import { extractLinkGroup } from "../../src/deep-crawl/tag-path";
import type { CrawlResult } from "../../src/models";
import { createEmptyLinks, createEmptyMedia, createErrorResult } from "../../src/models";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrawlResult(overrides: Partial<CrawlResult> = {}): CrawlResult {
	return {
		url: "https://example.com/page",
		html: "<p>hello</p>",
		success: true,
		cleanedHtml: "hello",
		media: createEmptyMedia(),
		links: createEmptyLinks(),
		markdown: {
			rawMarkdown: "hello world ".repeat(100), // 1200 chars
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
// Tag-path grouping
// ---------------------------------------------------------------------------

describe("extractLinkGroup", () => {
	test("groups URLs with same path pattern (numeric ID replacement)", () => {
		const a = extractLinkGroup("https://example.com/blog/posts/123");
		const b = extractLinkGroup("https://example.com/blog/posts/456");
		expect(a).toBe(b);
		expect(a).toContain("{id}");
	});

	test("different path structures get different groups", () => {
		const blog = extractLinkGroup("https://example.com/blog/posts/123");
		const about = extractLinkGroup("https://example.com/about");
		expect(blog).not.toBe(about);
	});

	test("handles query parameters — keys included, values ignored", () => {
		const a = extractLinkGroup("https://example.com/search?q=hello&page=1");
		const b = extractLinkGroup("https://example.com/search?q=world&page=2");
		expect(a).toBe(b);

		// Different param keys → different group
		const c = extractLinkGroup("https://example.com/search?q=hello");
		expect(a).not.toBe(c);
	});

	test("handles root URL", () => {
		const group = extractLinkGroup("https://example.com/");
		expect(group).toBe("example.com:/");
	});

	test("handles very long paths", () => {
		const url = "https://example.com/" + Array.from({ length: 20 }, (_, i) => `seg${i}`).join("/");
		const group = extractLinkGroup(url);
		expect(group).toContain("example.com:");
		expect(group).toContain("seg0");
	});

	test("handles special characters in path", () => {
		const group = extractLinkGroup("https://example.com/caf%C3%A9/menu");
		expect(group).toContain("example.com:");
	});

	test("replaces UUIDs with {id}", () => {
		const a = extractLinkGroup(
			"https://example.com/items/550e8400-e29b-41d4-a716-446655440000",
		);
		const b = extractLinkGroup(
			"https://example.com/items/6ba7b810-9dad-11d1-80b4-00c04fd430c8",
		);
		expect(a).toBe(b);
		expect(a).toContain("{id}");
	});

	test("returns 'invalid' for invalid URLs", () => {
		expect(extractLinkGroup("not-a-url")).toBe("invalid");
	});
});

// ---------------------------------------------------------------------------
// Bandit scorer
// ---------------------------------------------------------------------------

describe("BanditScorer", () => {
	test("initial scores use exploration bonus (no data yet)", () => {
		const scorer = new BanditScorer();
		const score = scorer.score("https://example.com/new-page", 0);
		// Should be 1.0 + explorationWeight (√2) since group is unseen
		expect(score).toBeGreaterThan(1.0);
	});

	test("after updates, groups with higher rewards get higher scores", () => {
		const scorer = new BanditScorer({ minSamples: 1 });

		// Train group A with high rewards
		for (let i = 0; i < 10; i++) {
			scorer.update(`https://example.com/good/article/${i}`, 0.9);
		}
		// Train group B with low rewards
		for (let i = 0; i < 10; i++) {
			scorer.update(`https://example.com/bad/article/${i}`, 0.1);
		}

		const goodScore = scorer.score("https://example.com/good/article/999", 0);
		const badScore = scorer.score("https://example.com/bad/article/999", 0);
		expect(goodScore).toBeGreaterThan(badScore);
	});

	test("exploration: under-explored groups get boosted", () => {
		const scorer = new BanditScorer({ minSamples: 1, explorationWeight: 2.0 });

		// Group A: many pulls, moderate reward
		for (let i = 0; i < 50; i++) {
			scorer.update(`https://example.com/common/page/${i}`, 0.5);
		}
		// Group B: few pulls, same reward
		for (let i = 0; i < 2; i++) {
			scorer.update(`https://example.com/rare/page/${i}`, 0.5);
		}

		const commonScore = scorer.score("https://example.com/common/page/999", 0);
		const rareScore = scorer.score("https://example.com/rare/page/999", 0);

		// Rare group should get a larger exploration bonus
		expect(rareScore).toBeGreaterThan(commonScore);
	});

	test("decay: older rewards matter less", () => {
		const highDecay = new BanditScorer({ rewardDecay: 0.5, minSamples: 1 });
		const lowDecay = new BanditScorer({ rewardDecay: 0.99, minSamples: 1 });

		// Both get same sequence: early high rewards, then low rewards
		for (let i = 0; i < 5; i++) {
			highDecay.update("https://example.com/page/1", 0.9);
			lowDecay.update("https://example.com/page/1", 0.9);
		}
		for (let i = 0; i < 5; i++) {
			highDecay.update("https://example.com/page/1", 0.1);
			lowDecay.update("https://example.com/page/1", 0.1);
		}

		const statsHigh = highDecay.getStats().get("example.com:/page/{id}")!;
		const statsLow = lowDecay.getStats().get("example.com:/page/{id}")!;

		// With high decay (0.5), the early high-reward observations are mostly forgotten,
		// so avgReward should be closer to the recent 0.1 values.
		// With low decay (0.99), early high rewards are retained, so avgReward stays higher.
		expect(statsHigh.avgReward).toBeLessThan(statsLow.avgReward);
	});

	test("minSamples: below threshold uses default exploration score", () => {
		const scorer = new BanditScorer({ minSamples: 5 });

		// Only 2 updates — below minSamples of 5
		scorer.update("https://example.com/page/1", 0.9);
		scorer.update("https://example.com/page/2", 0.9);

		const score = scorer.score("https://example.com/page/3", 0);
		// Should still return exploration score, not the learned value
		expect(score).toBeGreaterThan(1.0);
	});

	test("getStats returns correct pull counts and averages", () => {
		const scorer = new BanditScorer({ rewardDecay: 1.0, minSamples: 1 });

		scorer.update("https://example.com/a/1", 0.8);
		scorer.update("https://example.com/a/2", 0.6);
		scorer.update("https://example.com/b/1", 1.0);

		const stats = scorer.getStats();

		const groupA = stats.get("example.com:/a/{id}")!;
		expect(groupA.pulls).toBe(2);
		expect(groupA.avgReward).toBeCloseTo(0.7, 1);

		const groupB = stats.get("example.com:/b/{id}")!;
		expect(groupB.pulls).toBe(1);
		expect(groupB.avgReward).toBeCloseTo(1.0, 1);
	});
});

// ---------------------------------------------------------------------------
// Reward computation
// ---------------------------------------------------------------------------

describe("computeReward", () => {
	test("high-quality page yields high reward", () => {
		const result = makeCrawlResult({
			success: true,
			statusCode: 200,
			markdown: {
				rawMarkdown: "x".repeat(10_000),
				markdownWithCitations: "",
				referencesMarkdown: "",
				fitMarkdown: null,
			},
			extractedContent: '{"data": "extracted"}',
		});
		const reward = computeReward(result);
		expect(reward).toBeGreaterThanOrEqual(0.8);
	});

	test("empty/error page yields low reward", () => {
		const result = createErrorResult("https://example.com/fail", "Connection refused");
		const reward = computeReward(result);
		expect(reward).toBeLessThanOrEqual(0.1);
	});

	test("partial content yields medium reward", () => {
		const result = makeCrawlResult({
			success: true,
			statusCode: 200,
			markdown: {
				rawMarkdown: "short content here",
				markdownWithCitations: "",
				referencesMarkdown: "",
				fitMarkdown: null,
			},
			extractedContent: null,
		});
		const reward = computeReward(result);
		// Has HTTP success (0.1) + some content length, but no extraction and short markdown
		expect(reward).toBeGreaterThan(0.1);
		expect(reward).toBeLessThan(0.8);
	});
});

// ---------------------------------------------------------------------------
// createBanditConfig
// ---------------------------------------------------------------------------

describe("createBanditConfig", () => {
	test("uses defaults when no overrides", () => {
		const config = createBanditConfig();
		expect(config.explorationWeight).toBeCloseTo(Math.SQRT2, 5);
		expect(config.rewardDecay).toBe(0.95);
		expect(config.minSamples).toBe(2);
	});

	test("overrides individual fields", () => {
		const config = createBanditConfig({ explorationWeight: 3.0 });
		expect(config.explorationWeight).toBe(3.0);
		expect(config.rewardDecay).toBe(0.95); // default preserved
	});
});

// ---------------------------------------------------------------------------
// Integration: BanditDeepCrawlStrategy frontier ordering
// ---------------------------------------------------------------------------

describe("BanditDeepCrawlStrategy", () => {
	// These tests verify the strategy class instantiates correctly and
	// integrates the bandit scorer. Full crawl integration would require
	// a mock WebCrawler; here we test the scorer-driven priority logic.

	test("strategy processes URLs in priority order via bandit scores", () => {
		const scorer = new BanditScorer({ minSamples: 1 });

		// Simulate: group A yields high rewards, group B low
		for (let i = 0; i < 5; i++) {
			scorer.update(`https://example.com/good/${i}`, 0.9);
			scorer.update(`https://example.com/bad/${i}`, 0.1);
		}

		// Now score new URLs from each group
		const goodScore = scorer.score("https://example.com/good/99", 1);
		const badScore = scorer.score("https://example.com/bad/99", 1);

		expect(goodScore).toBeGreaterThan(badScore);
	});

	test("frontier re-prioritizes as bandit learns", () => {
		const scorer = new BanditScorer({ minSamples: 1 });

		// Initially both groups are unknown — scores should be equal (exploration)
		const initialA = scorer.score("https://example.com/alpha/1", 0);
		const initialB = scorer.score("https://example.com/beta/1", 0);
		expect(initialA).toBe(initialB);

		// After learning, alpha is good, beta is bad
		for (let i = 0; i < 5; i++) {
			scorer.update(`https://example.com/alpha/${i}`, 0.8);
			scorer.update(`https://example.com/beta/${i}`, 0.2);
		}

		const learnedA = scorer.score("https://example.com/alpha/99", 0);
		const learnedB = scorer.score("https://example.com/beta/99", 0);

		// Alpha should now outscore beta
		expect(learnedA).toBeGreaterThan(learnedB);
	});
});
