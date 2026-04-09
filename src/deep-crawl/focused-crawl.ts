/**
 * TRES-inspired Focused Crawling with Reinforcement Learning.
 *
 * Based on arxiv 2112.07620 "Tree-based Focused Web Crawling with
 * Reinforcement Learning". Models focused crawling as an MDP where
 * the agent learns which link groups yield on-topic content.
 *
 * Key ideas:
 * - State: crawl progress + relevance history + frontier features
 * - Actions: link groups (discretized action space by path pattern)
 * - Reward: page relevance to target topic
 * - Policy: epsilon-greedy Q-learning with online updates
 */

import type { CrawlerRunConfig } from "../config";
import type { WebCrawler } from "../crawler";
import type { CrawlResult } from "../models";
import { SilentLogger } from "../utils/logger";
import type { DeepCrawlConfig } from "./strategy";
import { DeepCrawlStrategy } from "./strategy";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface FocusedCrawlConfig {
	/** Target topic description */
	topic: string;
	/** Keywords that indicate on-topic content */
	topicKeywords: string[];

	/** Exploration rate (probability of random action) */
	epsilon: number;
	/** Multiplicative decay applied to epsilon after each page */
	epsilonDecay: number;
	/** Minimum value for epsilon */
	minEpsilon: number;
	/** Future reward discount (gamma) */
	discountFactor: number;
	/** Q-value update rate (alpha) */
	learningRate: number;

	/** Maximum number of link groups per page */
	maxActionGroups: number;
}

const DEFAULT_FOCUSED_CRAWL_CONFIG: FocusedCrawlConfig = {
	topic: "",
	topicKeywords: [],
	epsilon: 0.15,
	epsilonDecay: 0.995,
	minEpsilon: 0.05,
	discountFactor: 0.9,
	learningRate: 0.2,
	maxActionGroups: 10,
};

export function createFocusedCrawlConfig(
	overrides: Partial<FocusedCrawlConfig> = {},
): FocusedCrawlConfig {
	return { ...DEFAULT_FOCUSED_CRAWL_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Relevance Scoring
// ---------------------------------------------------------------------------

/**
 * Compute how relevant a crawl result is to the target topic (0-1).
 *
 * Weights:
 *   0.40 - keyword frequency in markdown content
 *   0.20 - keyword frequency in title/headings
 *   0.15 - keyword match in URL path
 *   0.15 - content length (substantive content proxy)
 *   0.10 - success signal
 */
export function computeRelevance(result: CrawlResult, config: FocusedCrawlConfig): number {
	const keywords = config.topicKeywords.map((k) => k.toLowerCase());
	if (keywords.length === 0) return result.success ? 0.5 : 0;

	// --- Keyword frequency in markdown (0.40) ---
	const markdown = (result.markdown?.rawMarkdown ?? "").toLowerCase();
	const contentScore = keywordDensity(markdown, keywords);

	// --- Keyword frequency in title/headings (0.20) ---
	const headings = extractHeadings(markdown);
	const headingScore = keywordDensity(headings, keywords);

	// --- Keyword match in URL path (0.15) ---
	const urlLower = result.url.toLowerCase();
	let urlMatches = 0;
	for (const kw of keywords) {
		if (urlLower.includes(kw)) urlMatches++;
	}
	const urlScore = Math.min(1, urlMatches / keywords.length);

	// --- Content length proxy (0.15) ---
	// Normalize: 0 at 0 chars, 1.0 at 2000+ chars
	const contentLength = markdown.length;
	const lengthScore = Math.min(1, contentLength / 2000);

	// --- Success signal (0.10) ---
	const successScore = result.success ? 1.0 : 0.0;

	return (
		0.4 * contentScore +
		0.2 * headingScore +
		0.15 * urlScore +
		0.15 * lengthScore +
		0.1 * successScore
	);
}

/** Count keyword occurrences in text, return density score in [0,1]. */
function keywordDensity(text: string, keywords: string[]): number {
	if (text.length === 0 || keywords.length === 0) return 0;
	let totalHits = 0;
	for (const kw of keywords) {
		let idx = 0;
		while (true) {
			idx = text.indexOf(kw, idx);
			if (idx === -1) break;
			totalHits++;
			idx += kw.length;
		}
	}
	// Normalize: 1 hit per 200 chars = score 1.0
	const density = totalHits / (text.length / 200);
	return Math.min(1, density);
}

/** Extract heading lines from markdown (lines starting with #). */
function extractHeadings(markdown: string): string {
	return markdown
		.split("\n")
		.filter((line) => line.startsWith("#"))
		.join(" ");
}

// ---------------------------------------------------------------------------
// State Representation
// ---------------------------------------------------------------------------

export interface CrawlState {
	/** Current crawl depth, normalized to [0,1] */
	depth: number;
	/** Pages visited so far, normalized to [0,1] */
	pagesVisited: number;
	/** Running average relevance of visited pages */
	avgRelevance: number;
	/** Relevance of last visited page */
	lastRelevance: number;
	/** Frontier size, normalized to [0,1] */
	frontierSize: number;
	/** Unique domains in frontier, normalized to [0,1] */
	domainDiversity: number;
}

export function extractState(
	depth: number,
	pagesVisited: number,
	relevanceHistory: number[],
	frontier: Array<{ url: string }>,
	maxPages: number,
): CrawlState {
	const avgRelevance =
		relevanceHistory.length > 0
			? relevanceHistory.reduce((a, b) => a + b, 0) / relevanceHistory.length
			: 0;
	const lastRelevance =
		relevanceHistory.length > 0 ? relevanceHistory[relevanceHistory.length - 1] : 0;

	const domains = new Set<string>();
	for (const item of frontier) {
		try {
			domains.add(new URL(item.url).hostname);
		} catch {
			// skip invalid URLs
		}
	}

	// Normalize frontier size: cap at 500 URLs
	const maxFrontier = 500;
	// Normalize domain diversity: cap at 50 domains
	const maxDomains = 50;
	// Normalize depth: cap at 10
	const maxDepth = 10;

	return {
		depth: Math.min(1, depth / maxDepth),
		pagesVisited: Math.min(1, pagesVisited / Math.max(1, maxPages)),
		avgRelevance: Math.min(1, Math.max(0, avgRelevance)),
		lastRelevance: Math.min(1, Math.max(0, lastRelevance)),
		frontierSize: Math.min(1, frontier.length / maxFrontier),
		domainDiversity: Math.min(1, domains.size / maxDomains),
	};
}

// ---------------------------------------------------------------------------
// Link Group Discretization
// ---------------------------------------------------------------------------

export interface LinkGroupFeatures {
	/** Average keyword relevance of anchor text + URL */
	avgKeywordRelevance: number;
	/** Average URL path depth */
	avgPathDepth: number;
	/** Whether all links share the same domain as the current page */
	sameDomain: boolean;
	/** Number of links in the group */
	count: number;
}

export interface LinkGroup {
	/** Group identifier (e.g., "same:blog" or "cross:docs") */
	id: string;
	/** Links in this group */
	urls: Array<{ url: string; anchorText: string }>;
	/** Computed features */
	features: LinkGroupFeatures;
}

export function groupLinks(
	links: Array<{ url: string; anchorText: string }>,
	currentUrl: string,
	topicKeywords: string[],
	maxGroups: number,
): LinkGroup[] {
	if (links.length === 0) return [];

	let currentDomain: string;
	try {
		currentDomain = new URL(currentUrl).hostname;
	} catch {
		currentDomain = "";
	}

	const keywords = topicKeywords.map((k) => k.toLowerCase());

	// Bucket links by (same/cross domain, first path segment)
	const buckets = new Map<string, Array<{ url: string; anchorText: string }>>();

	for (const link of links) {
		let domain: string;
		let firstSegment: string;
		try {
			const parsed = new URL(link.url);
			domain = parsed.hostname;
			firstSegment = parsed.pathname.split("/").filter(Boolean)[0] ?? "_root";
		} catch {
			continue;
		}

		const prefix = domain === currentDomain ? "same" : "cross";
		const key = `${prefix}:${firstSegment}`;

		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = [];
			buckets.set(key, bucket);
		}
		bucket.push(link);
	}

	// Convert to LinkGroup array
	let groups: LinkGroup[] = [];
	for (const [id, urls] of buckets) {
		groups.push({
			id,
			urls,
			features: computeGroupFeatures(urls, currentDomain, keywords),
		});
	}

	// Merge smallest groups if exceeding maxGroups
	while (groups.length > maxGroups) {
		// Find the smallest group
		let minIdx = 0;
		for (let i = 1; i < groups.length; i++) {
			if (groups[i].urls.length < groups[minIdx].urls.length) {
				minIdx = i;
			}
		}

		const smallest = groups[minIdx];
		groups.splice(minIdx, 1);

		// Merge into the group with the closest id prefix (same/cross)
		const prefix = smallest.id.split(":")[0];
		let targetIdx = -1;
		let targetSize = Infinity;

		for (let i = 0; i < groups.length; i++) {
			if (groups[i].id.startsWith(prefix) && groups[i].urls.length < targetSize) {
				targetIdx = i;
				targetSize = groups[i].urls.length;
			}
		}

		if (targetIdx === -1) {
			// No matching prefix; merge into smallest remaining
			targetIdx = 0;
			for (let i = 1; i < groups.length; i++) {
				if (groups[i].urls.length < groups[targetIdx].urls.length) {
					targetIdx = i;
				}
			}
		}

		groups[targetIdx].urls.push(...smallest.urls);
		groups[targetIdx].features = computeGroupFeatures(
			groups[targetIdx].urls,
			currentDomain,
			keywords,
		);
	}

	return groups;
}

function computeGroupFeatures(
	urls: Array<{ url: string; anchorText: string }>,
	currentDomain: string,
	keywords: string[],
): LinkGroupFeatures {
	let totalKeywordScore = 0;
	let totalPathDepth = 0;
	let allSameDomain = true;

	for (const link of urls) {
		// Keyword relevance in anchor + URL
		const text = `${link.url.toLowerCase()} ${link.anchorText.toLowerCase()}`;
		let matches = 0;
		for (const kw of keywords) {
			if (text.includes(kw)) matches++;
		}
		totalKeywordScore += keywords.length > 0 ? matches / keywords.length : 0;

		// Path depth
		try {
			const segments = new URL(link.url).pathname.split("/").filter(Boolean).length;
			totalPathDepth += segments;
		} catch {
			totalPathDepth += 0;
		}

		// Domain check
		try {
			if (new URL(link.url).hostname !== currentDomain) {
				allSameDomain = false;
			}
		} catch {
			allSameDomain = false;
		}
	}

	return {
		avgKeywordRelevance: urls.length > 0 ? totalKeywordScore / urls.length : 0,
		avgPathDepth: urls.length > 0 ? totalPathDepth / urls.length : 0,
		sameDomain: allSameDomain,
		count: urls.length,
	};
}

// ---------------------------------------------------------------------------
// Q-Learning Agent
// ---------------------------------------------------------------------------

/**
 * Discretize a CrawlState into a string key by binning each dimension
 * into one of 3 bins: 0 = low (<0.33), 1 = mid (0.33-0.66), 2 = high (>0.66).
 */
function discretizeState(state: CrawlState): string {
	const bin = (v: number): number => (v < 0.33 ? 0 : v < 0.66 ? 1 : 2);
	return `d${bin(state.depth)}_p${bin(state.pagesVisited)}_r${bin(state.avgRelevance)}_l${bin(state.lastRelevance)}_f${bin(state.frontierSize)}_v${bin(state.domainDiversity)}`;
}

export class FocusedCrawlAgent {
	private qTable: Map<string, number> = new Map();
	private epsilon: number;
	private readonly config: FocusedCrawlConfig;
	private totalUpdates = 0;

	constructor(config: FocusedCrawlConfig) {
		this.config = config;
		this.epsilon = config.epsilon;
	}

	/** Select a link group using epsilon-greedy policy. */
	selectAction(state: CrawlState, groups: LinkGroup[]): LinkGroup {
		if (groups.length === 0) {
			throw new Error("Cannot select action from empty group list");
		}

		if (groups.length === 1) return groups[0];

		// Explore: random action
		if (Math.random() < this.epsilon) {
			return groups[Math.floor(Math.random() * groups.length)];
		}

		// Exploit: highest Q-value
		const stateKey = discretizeState(state);
		let bestGroup = groups[0];
		let bestQ = this.getQ(stateKey, groups[0].id);

		for (let i = 1; i < groups.length; i++) {
			const q = this.getQ(stateKey, groups[i].id);
			if (q > bestQ) {
				bestQ = q;
				bestGroup = groups[i];
			}
		}

		return bestGroup;
	}

	/** Update Q-values using standard Q-learning update rule. */
	update(state: CrawlState, action: LinkGroup, reward: number, nextState: CrawlState): void {
		const stateKey = discretizeState(state);
		const nextStateKey = discretizeState(nextState);
		const actionKey = action.id;

		const currentQ = this.getQ(stateKey, actionKey);

		// max_a' Q(s', a') — find max Q over all actions in next state
		// Since we don't know future actions, use max over all known actions for this state
		let maxNextQ = 0;
		for (const [key, value] of this.qTable) {
			if (key.startsWith(`${nextStateKey}|`)) {
				maxNextQ = Math.max(maxNextQ, value);
			}
		}

		// Q(s, a) = Q(s, a) + alpha * (reward + gamma * max Q(s', a') - Q(s, a))
		const newQ =
			currentQ +
			this.config.learningRate *
				(reward + this.config.discountFactor * maxNextQ - currentQ);

		this.qTable.set(`${stateKey}|${actionKey}`, newQ);
		this.totalUpdates++;
	}

	/** Decay epsilon by the configured decay factor. */
	decayEpsilon(): void {
		this.epsilon = Math.max(this.config.minEpsilon, this.epsilon * this.config.epsilonDecay);
	}

	/** Get diagnostic stats. */
	getStats(): { qTableSize: number; epsilon: number; totalUpdates: number } {
		return {
			qTableSize: this.qTable.size,
			epsilon: this.epsilon,
			totalUpdates: this.totalUpdates,
		};
	}

	private getQ(stateKey: string, actionKey: string): number {
		return this.qTable.get(`${stateKey}|${actionKey}`) ?? 0;
	}
}

// ---------------------------------------------------------------------------
// Focused Deep Crawl Strategy
// ---------------------------------------------------------------------------

interface FrontierItem {
	url: string;
	anchorText: string;
	depth: number;
	groupId: string;
	qScore: number;
}

export class FocusedDeepCrawlStrategy extends DeepCrawlStrategy {
	private readonly agent: FocusedCrawlAgent;
	private readonly focusedConfig: FocusedCrawlConfig;

	constructor(focusedConfig: FocusedCrawlConfig) {
		super("focused");
		this.focusedConfig = focusedConfig;
		this.agent = new FocusedCrawlAgent(focusedConfig);
	}

	async run(
		startUrl: string,
		crawler: WebCrawler,
		crawlConfig: Partial<CrawlerRunConfig>,
		deepConfig: DeepCrawlConfig,
	): Promise<CrawlResult[]> {
		const results: CrawlResult[] = [];
		for await (const result of this.stream(startUrl, crawler, crawlConfig, deepConfig)) {
			results.push(result);
		}
		return results;
	}

	async *stream(
		startUrl: string,
		crawler: WebCrawler,
		crawlConfig: Partial<CrawlerRunConfig>,
		deepConfig: DeepCrawlConfig,
	): AsyncGenerator<CrawlResult, void, unknown> {
		const logger = deepConfig.logger ?? new SilentLogger();
		const visited = new Set<string>();
		const depths = new Map<string, number>();
		const relevanceHistory: number[] = [];
		let pageCount = 0;

		// Priority frontier sorted by Q-score descending
		const frontier: FrontierItem[] = [];
		let lastActionGroup: LinkGroup | null = null;
		let lastState: CrawlState | null = null;

		// Seed with start URL
		frontier.push({
			url: startUrl,
			anchorText: "",
			depth: 0,
			groupId: "_seed",
			qScore: 1.0,
		});

		while (frontier.length > 0 && pageCount < deepConfig.maxPages) {
			// Sort frontier by qScore descending
			frontier.sort((a, b) => b.qScore - a.qScore);

			const item = frontier.shift()!;

			if (visited.has(item.url)) continue;
			if (item.depth > deepConfig.maxDepth) continue;

			visited.add(item.url);
			depths.set(item.url, item.depth);

			logger.debug(
				`Focused depth ${item.depth} qScore ${item.qScore.toFixed(2)}: ${item.url}`,
			);

			// Crawl the page
			const result = await this.crawlWithRateLimit(
				item.url,
				crawler,
				crawlConfig,
				deepConfig.rateLimiter,
			);
			pageCount++;

			// Compute relevance reward
			const relevance = computeRelevance(result, this.focusedConfig);
			relevanceHistory.push(relevance);

			const currentState = extractState(
				item.depth,
				pageCount,
				relevanceHistory,
				frontier,
				deepConfig.maxPages,
			);

			// Update Q-values for previous action
			if (lastActionGroup && lastState) {
				this.agent.update(lastState, lastActionGroup, relevance, currentState);
			}

			yield result;

			// Discover and group links
			if (result.success && item.depth < deepConfig.maxDepth) {
				const discovered = await this.discoverLinks(
					result,
					visited,
					item.depth,
					depths,
					deepConfig,
				);

				if (discovered.length > 0) {
					const groups = groupLinks(
						discovered,
						item.url,
						this.focusedConfig.topicKeywords,
						this.focusedConfig.maxActionGroups,
					);

					if (groups.length > 0) {
						// Agent selects which group to explore
						const selectedGroup = this.agent.selectAction(currentState, groups);

						// Add ALL URLs from selected group to frontier
						for (const link of selectedGroup.urls) {
							frontier.push({
								url: link.url,
								anchorText: link.anchorText,
								depth: item.depth + 1,
								groupId: selectedGroup.id,
								qScore: selectedGroup.features.avgKeywordRelevance + relevance,
							});
						}

						lastActionGroup = selectedGroup;
						lastState = currentState;
					}
				}
			}

			this.agent.decayEpsilon();
		}

		logger.info(
			`Focused complete: ${pageCount} pages crawled, ` +
				`avg relevance ${relevanceHistory.length > 0 ? (relevanceHistory.reduce((a, b) => a + b, 0) / relevanceHistory.length).toFixed(3) : "N/A"}, ` +
				`Q-table size ${this.agent.getStats().qTableSize}`,
		);
	}
}
