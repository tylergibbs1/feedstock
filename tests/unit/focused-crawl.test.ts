import { describe, expect, test } from "bun:test";
import {
	computeRelevance,
	createFocusedCrawlConfig,
	extractState,
	FocusedCrawlAgent,
	type FocusedCrawlConfig,
	FocusedDeepCrawlStrategy,
	groupLinks,
	type CrawlState,
	type LinkGroup,
} from "../../src/deep-crawl/focused-crawl";
import type { CrawlResult } from "../../src/models";
import { createEmptyLinks, createEmptyMedia, createErrorResult } from "../../src/models";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<CrawlResult> = {}): CrawlResult {
	return {
		url: "https://example.com/page",
		html: "<html></html>",
		success: true,
		cleanedHtml: null,
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

function makeConfig(overrides: Partial<FocusedCrawlConfig> = {}): FocusedCrawlConfig {
	return createFocusedCrawlConfig({
		topic: "machine learning",
		topicKeywords: ["machine learning", "neural network", "deep learning", "training"],
		...overrides,
	});
}

// ---------------------------------------------------------------------------
// Relevance Scoring
// ---------------------------------------------------------------------------

describe("computeRelevance", () => {
	test("page with many topic keywords returns high relevance (>0.7)", () => {
		const config = makeConfig();
		const result = makeResult({
			url: "https://example.com/machine-learning/deep-learning-guide",
			markdown: {
				rawMarkdown:
					"# Deep Learning Guide\n\n" +
					"Machine learning is transforming how we build systems. " +
					"Neural network architectures have evolved rapidly. " +
					"Deep learning enables training on large datasets. " +
					"Machine learning and neural network research is booming. " +
					"Training deep learning models requires GPUs. " +
					"Neural network training with machine learning frameworks. ".repeat(10),
				markdownWithCitations: "",
				referencesMarkdown: "",
				fitMarkdown: null,
			},
		});

		const score = computeRelevance(result, config);
		expect(score).toBeGreaterThan(0.7);
	});

	test("off-topic page returns low relevance (<0.3)", () => {
		const config = makeConfig();
		const result = makeResult({
			url: "https://example.com/recipes/chocolate-cake",
			markdown: {
				rawMarkdown:
					"# Chocolate Cake Recipe\n\n" +
					"Mix flour, sugar, and cocoa powder. Add eggs and butter. " +
					"Bake at 350 degrees for 30 minutes.",
				markdownWithCitations: "",
				referencesMarkdown: "",
				fitMarkdown: null,
			},
		});

		const score = computeRelevance(result, config);
		expect(score).toBeLessThan(0.3);
	});

	test("partially relevant page returns medium relevance", () => {
		const config = makeConfig();
		const result = makeResult({
			url: "https://example.com/tech/overview",
			markdown: {
				rawMarkdown:
					"# Technology Overview\n\n" +
					"Machine learning is one of many topics in computer science. " +
					"Other areas include databases, networking, and security. " +
					"Compilers and operating systems are also important. " +
					"Some companies use neural network technology.",
				markdownWithCitations: "",
				referencesMarkdown: "",
				fitMarkdown: null,
			},
		});

		const score = computeRelevance(result, config);
		expect(score).toBeGreaterThan(0.1);
		expect(score).toBeLessThan(0.7);
	});

	test("failed result returns low relevance", () => {
		const config = makeConfig();
		const result = createErrorResult("https://example.com/error", "Connection refused");

		const score = computeRelevance(result, config);
		expect(score).toBeLessThan(0.15);
	});
});

// ---------------------------------------------------------------------------
// State Extraction
// ---------------------------------------------------------------------------

describe("extractState", () => {
	test("state values are normalized to [0, 1]", () => {
		const state = extractState(
			5,
			50,
			[0.8, 0.6, 0.9, 0.7],
			[
				{ url: "https://a.com/1" },
				{ url: "https://b.com/2" },
				{ url: "https://c.com/3" },
			],
			100,
		);

		for (const [key, value] of Object.entries(state)) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});

	test("state reflects frontier size and visit count correctly", () => {
		const frontier = Array.from({ length: 20 }, (_, i) => ({
			url: `https://example.com/${i}`,
		}));

		const state = extractState(2, 30, [0.5, 0.6], frontier, 100);

		// pagesVisited = 30/100 = 0.3
		expect(state.pagesVisited).toBeCloseTo(0.3, 2);
		// frontierSize = 20/500 = 0.04
		expect(state.frontierSize).toBeCloseTo(0.04, 2);
		// depth = 2/10 = 0.2
		expect(state.depth).toBeCloseTo(0.2, 2);
		// avgRelevance = (0.5+0.6)/2 = 0.55
		expect(state.avgRelevance).toBeCloseTo(0.55, 2);
		// lastRelevance = 0.6
		expect(state.lastRelevance).toBeCloseTo(0.6, 2);
		// domainDiversity = 1 domain / 50 = 0.02
		expect(state.domainDiversity).toBeCloseTo(0.02, 2);
	});

	test("empty history yields zero relevance values", () => {
		const state = extractState(0, 0, [], [], 100);
		expect(state.avgRelevance).toBe(0);
		expect(state.lastRelevance).toBe(0);
		expect(state.frontierSize).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Link Grouping
// ---------------------------------------------------------------------------

describe("groupLinks", () => {
	const currentUrl = "https://example.com/start";
	const keywords = ["machine", "learning"];

	test("links grouped by first path segment", () => {
		const links = [
			{ url: "https://example.com/blog/post1", anchorText: "Post 1" },
			{ url: "https://example.com/blog/post2", anchorText: "Post 2" },
			{ url: "https://example.com/docs/guide", anchorText: "Guide" },
			{ url: "https://example.com/docs/api", anchorText: "API" },
		];

		const groups = groupLinks(links, currentUrl, keywords, 10);

		const blogGroup = groups.find((g) => g.id === "same:blog");
		const docsGroup = groups.find((g) => g.id === "same:docs");

		expect(blogGroup).toBeDefined();
		expect(blogGroup!.urls).toHaveLength(2);
		expect(docsGroup).toBeDefined();
		expect(docsGroup!.urls).toHaveLength(2);
	});

	test("same-domain vs cross-domain separation", () => {
		const links = [
			{ url: "https://example.com/blog/post", anchorText: "Internal" },
			{ url: "https://other.com/blog/article", anchorText: "External" },
		];

		const groups = groupLinks(links, currentUrl, keywords, 10);

		const sameGroup = groups.find((g) => g.id.startsWith("same:"));
		const crossGroup = groups.find((g) => g.id.startsWith("cross:"));

		expect(sameGroup).toBeDefined();
		expect(crossGroup).toBeDefined();
	});

	test("respects maxGroups limit by merging smallest", () => {
		const links = [
			{ url: "https://example.com/a/1", anchorText: "A" },
			{ url: "https://example.com/b/1", anchorText: "B" },
			{ url: "https://example.com/c/1", anchorText: "C" },
			{ url: "https://example.com/d/1", anchorText: "D" },
			{ url: "https://example.com/e/1", anchorText: "E" },
		];

		const groups = groupLinks(links, currentUrl, keywords, 3);

		expect(groups).toHaveLength(3);
		// Total URLs should be preserved
		const totalUrls = groups.reduce((sum, g) => sum + g.urls.length, 0);
		expect(totalUrls).toBe(5);
	});

	test("group features computed correctly", () => {
		const links = [
			{
				url: "https://example.com/blog/machine-learning-intro",
				anchorText: "Machine Learning Intro",
			},
			{
				url: "https://example.com/blog/learning-guide",
				anchorText: "Deep learning guide",
			},
		];

		const groups = groupLinks(links, currentUrl, keywords, 10);
		const blogGroup = groups.find((g) => g.id === "same:blog")!;

		expect(blogGroup.features.count).toBe(2);
		expect(blogGroup.features.sameDomain).toBe(true);
		expect(blogGroup.features.avgKeywordRelevance).toBeGreaterThan(0);
		// Path depth: /blog/machine-learning-intro = 2 segments each
		expect(blogGroup.features.avgPathDepth).toBe(2);
	});

	test("empty input returns empty array", () => {
		const groups = groupLinks([], currentUrl, keywords, 10);
		expect(groups).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Q-Learning Agent
// ---------------------------------------------------------------------------

describe("FocusedCrawlAgent", () => {
	function makeGroups(): LinkGroup[] {
		return [
			{
				id: "same:blog",
				urls: [{ url: "https://example.com/blog/1", anchorText: "Blog" }],
				features: { avgKeywordRelevance: 0.8, avgPathDepth: 2, sameDomain: true, count: 1 },
			},
			{
				id: "same:docs",
				urls: [{ url: "https://example.com/docs/1", anchorText: "Docs" }],
				features: { avgKeywordRelevance: 0.3, avgPathDepth: 2, sameDomain: true, count: 1 },
			},
		];
	}

	function makeState(overrides: Partial<CrawlState> = {}): CrawlState {
		return {
			depth: 0.2,
			pagesVisited: 0.1,
			avgRelevance: 0.5,
			lastRelevance: 0.6,
			frontierSize: 0.1,
			domainDiversity: 0.1,
			...overrides,
		};
	}

	test("initial Q-values are 0", () => {
		const agent = new FocusedCrawlAgent(makeConfig());
		const stats = agent.getStats();
		expect(stats.qTableSize).toBe(0);
		expect(stats.totalUpdates).toBe(0);
	});

	test("with epsilon=1.0, always explores (random selection)", () => {
		const config = makeConfig({ epsilon: 1.0 });
		const agent = new FocusedCrawlAgent(config);
		const state = makeState();
		const groups = makeGroups();

		// With epsilon=1.0, every call is random. Over many calls,
		// both groups should be selected at least once.
		const selected = new Set<string>();
		for (let i = 0; i < 100; i++) {
			const action = agent.selectAction(state, groups);
			selected.add(action.id);
		}

		expect(selected.size).toBe(2);
	});

	test("with epsilon=0.0, always exploits (highest Q-value)", () => {
		const config = makeConfig({ epsilon: 0.0, learningRate: 1.0, discountFactor: 0.0 });
		const agent = new FocusedCrawlAgent(config);
		const state = makeState();
		const nextState = makeState({ pagesVisited: 0.2 });
		const groups = makeGroups();

		// Train: group A (blog) gets high reward, group B (docs) gets low
		agent.update(state, groups[0], 0.9, nextState);
		agent.update(state, groups[1], 0.1, nextState);

		// With epsilon=0, should always pick the higher-Q group
		for (let i = 0; i < 20; i++) {
			const action = agent.selectAction(state, groups);
			expect(action.id).toBe("same:blog");
		}
	});

	test("Q-values update correctly after observe", () => {
		const config = makeConfig({
			epsilon: 0.0,
			learningRate: 0.5,
			discountFactor: 0.0,
		});
		const agent = new FocusedCrawlAgent(config);
		const state = makeState();
		const nextState = makeState({ pagesVisited: 0.2 });
		const groups = makeGroups();

		// Initial Q = 0. After update with reward 0.8 and alpha=0.5, gamma=0:
		// Q = 0 + 0.5 * (0.8 + 0 - 0) = 0.4
		agent.update(state, groups[0], 0.8, nextState);

		expect(agent.getStats().qTableSize).toBe(1);
		expect(agent.getStats().totalUpdates).toBe(1);

		// Second update: Q = 0.4 + 0.5 * (0.8 + 0 - 0.4) = 0.4 + 0.2 = 0.6
		agent.update(state, groups[0], 0.8, nextState);
		expect(agent.getStats().totalUpdates).toBe(2);
	});

	test("epsilon decays after each step", () => {
		const config = makeConfig({ epsilon: 0.5, epsilonDecay: 0.9, minEpsilon: 0.1 });
		const agent = new FocusedCrawlAgent(config);

		expect(agent.getStats().epsilon).toBe(0.5);

		agent.decayEpsilon();
		expect(agent.getStats().epsilon).toBeCloseTo(0.45, 5);

		agent.decayEpsilon();
		expect(agent.getStats().epsilon).toBeCloseTo(0.405, 5);
	});

	test("epsilon does not go below minEpsilon", () => {
		const config = makeConfig({ epsilon: 0.06, epsilonDecay: 0.5, minEpsilon: 0.05 });
		const agent = new FocusedCrawlAgent(config);

		agent.decayEpsilon(); // 0.06 * 0.5 = 0.03, clamped to 0.05
		expect(agent.getStats().epsilon).toBe(0.05);
	});

	test("after learning that group A yields high reward, agent prefers group A", () => {
		const config = makeConfig({
			epsilon: 0.0,
			learningRate: 0.5,
			discountFactor: 0.0,
		});
		const agent = new FocusedCrawlAgent(config);
		const state = makeState();
		const nextState = makeState({ pagesVisited: 0.2 });
		const groups = makeGroups();

		// Repeated high reward for group A
		for (let i = 0; i < 10; i++) {
			agent.update(state, groups[0], 0.9, nextState);
		}
		// Repeated low reward for group B
		for (let i = 0; i < 10; i++) {
			agent.update(state, groups[1], 0.1, nextState);
		}

		// Agent should always pick A (epsilon=0)
		const action = agent.selectAction(state, groups);
		expect(action.id).toBe("same:blog");
	});
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe("focused crawl integration", () => {
	test("agent correctly selects groups and updates Q-values over multiple rounds", () => {
		const config = makeConfig({ epsilon: 0.0, learningRate: 0.3, discountFactor: 0.5 });
		const agent = new FocusedCrawlAgent(config);

		const groupA: LinkGroup = {
			id: "same:ml",
			urls: [{ url: "https://example.com/ml/1", anchorText: "ML" }],
			features: { avgKeywordRelevance: 0.9, avgPathDepth: 2, sameDomain: true, count: 1 },
		};
		const groupB: LinkGroup = {
			id: "same:recipes",
			urls: [{ url: "https://example.com/recipes/1", anchorText: "Recipes" }],
			features: { avgKeywordRelevance: 0.1, avgPathDepth: 2, sameDomain: true, count: 1 },
		};

		const state: CrawlState = {
			depth: 0.1,
			pagesVisited: 0.1,
			avgRelevance: 0.5,
			lastRelevance: 0.5,
			frontierSize: 0.1,
			domainDiversity: 0.1,
		};
		const nextState: CrawlState = { ...state, pagesVisited: 0.2 };

		// Round 1: reward A highly, B lowly
		agent.update(state, groupA, 0.9, nextState);
		agent.update(state, groupB, 0.1, nextState);

		// Agent should prefer A
		expect(agent.selectAction(state, [groupA, groupB]).id).toBe("same:ml");

		// Q-table should have 2 entries
		expect(agent.getStats().qTableSize).toBe(2);
		expect(agent.getStats().totalUpdates).toBe(2);
	});

	test("harvest rate improves as agent learns", () => {
		const config = makeConfig({
			epsilon: 0.1, // small exploration
			epsilonDecay: 0.9,
			minEpsilon: 0.0, // let it fully exploit
			learningRate: 0.5,
			discountFactor: 0.0,
		});
		const agent = new FocusedCrawlAgent(config);

		const groupA: LinkGroup = {
			id: "same:ml",
			urls: [{ url: "https://example.com/ml/1", anchorText: "ML" }],
			features: { avgKeywordRelevance: 0.9, avgPathDepth: 2, sameDomain: true, count: 1 },
		};
		const groupB: LinkGroup = {
			id: "same:recipes",
			urls: [{ url: "https://example.com/recipes/1", anchorText: "Recipes" }],
			features: { avgKeywordRelevance: 0.1, avgPathDepth: 2, sameDomain: true, count: 1 },
		};

		const state: CrawlState = {
			depth: 0.1,
			pagesVisited: 0.1,
			avgRelevance: 0.5,
			lastRelevance: 0.5,
			frontierSize: 0.1,
			domainDiversity: 0.1,
		};
		const nextState: CrawlState = { ...state, pagesVisited: 0.2 };

		// Simulate 20 rounds of training
		for (let i = 0; i < 20; i++) {
			agent.update(state, groupA, 0.9, nextState); // A always relevant
			agent.update(state, groupB, 0.05, nextState); // B never relevant
			agent.decayEpsilon();
		}

		// After training, epsilon should be very low
		expect(agent.getStats().epsilon).toBeLessThan(0.02);

		// Count how many times agent picks A over 50 trials
		let aCount = 0;
		for (let i = 0; i < 50; i++) {
			const action = agent.selectAction(state, [groupA, groupB]);
			if (action.id === "same:ml") aCount++;
		}

		// Should pick A the vast majority (>90%) of the time
		expect(aCount).toBeGreaterThan(45);
	});

	test("getStats shows correct Q-table size and update count", () => {
		const config = makeConfig({ epsilon: 0.0, learningRate: 0.5, discountFactor: 0.0 });
		const agent = new FocusedCrawlAgent(config);

		expect(agent.getStats()).toEqual({
			qTableSize: 0,
			epsilon: 0.0, // matches config override
			totalUpdates: 0,
		});

		const state: CrawlState = {
			depth: 0.1,
			pagesVisited: 0.1,
			avgRelevance: 0.5,
			lastRelevance: 0.5,
			frontierSize: 0.1,
			domainDiversity: 0.1,
		};

		const group: LinkGroup = {
			id: "same:test",
			urls: [{ url: "https://example.com/test", anchorText: "Test" }],
			features: { avgKeywordRelevance: 0.5, avgPathDepth: 1, sameDomain: true, count: 1 },
		};

		agent.update(state, group, 0.5, state);
		agent.update(state, group, 0.6, state);

		const stats = agent.getStats();
		expect(stats.qTableSize).toBe(1); // same state+action = same key
		expect(stats.totalUpdates).toBe(2);
	});

	test("FocusedDeepCrawlStrategy can be instantiated and has correct name", () => {
		const config = makeConfig();
		const strategy = new FocusedDeepCrawlStrategy(config);
		expect(strategy.name).toBe("focused");
		expect(strategy).toBeInstanceOf(FocusedDeepCrawlStrategy);
	});
});
