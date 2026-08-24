/**
 * Deep crawling strategies: BFS, DFS, and BestFirst.
 *
 * Each strategy takes a starting URL and recursively discovers + crawls
 * linked pages, respecting filters, depth limits, and rate limiting.
 */

import type { CrawlerRunConfigOverrides } from "../config";
import type { WebCrawler } from "../crawler";
import type { CrawlResult } from "../models";
import type { Logger } from "../utils/logger";
import { SilentLogger } from "../utils/logger";
import type { RateLimiter } from "../utils/rate-limiter";
import type { RobotsParser } from "../utils/robots";
import { normalizeUrl } from "../utils/url";
import type { FilterChain } from "./filters";
import type { CompositeScorer, ScorerContext } from "./scorers";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DeepCrawlConfig {
	maxDepth: number;
	maxPages: number;
	filterChain?: FilterChain;
	scorer?: CompositeScorer;
	rateLimiter?: RateLimiter;
	robotsParser?: RobotsParser;
	concurrency: number;
	logger?: Logger;
	/**
	 * If true, yields results as they come in (streaming mode).
	 * If false, returns all results at the end (batch mode).
	 */
	stream: boolean;
	/** Treat URLs that differ only by query parameters as duplicates. */
	ignoreQueryParameters?: boolean;
	/** Remove common analytics parameters before deduplication. */
	removeTrackingParameters?: boolean;
	/** Do not enqueue links marked rel=nofollow. */
	respectNoFollow?: boolean;
}

const DEFAULT_DEEP_CRAWL_CONFIG: DeepCrawlConfig = {
	maxDepth: 3,
	maxPages: 100,
	concurrency: 5,
	stream: false,
	ignoreQueryParameters: false,
	removeTrackingParameters: true,
	respectNoFollow: true,
};

export function createDeepCrawlConfig(overrides: Partial<DeepCrawlConfig> = {}): DeepCrawlConfig {
	return { ...DEFAULT_DEEP_CRAWL_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Base Strategy
// ---------------------------------------------------------------------------

export abstract class DeepCrawlStrategy {
	readonly name: string;

	constructor(name: string) {
		this.name = name;
	}

	/**
	 * Crawl starting from a URL, returning all results.
	 */
	abstract run(
		startUrl: string,
		crawler: WebCrawler,
		crawlConfig: CrawlerRunConfigOverrides,
		deepConfig: DeepCrawlConfig,
	): Promise<CrawlResult[]>;

	/**
	 * Crawl starting from a URL, yielding results as they arrive.
	 */
	abstract stream(
		startUrl: string,
		crawler: WebCrawler,
		crawlConfig: CrawlerRunConfigOverrides,
		deepConfig: DeepCrawlConfig,
	): AsyncGenerator<CrawlResult, void, unknown>;

	/**
	 * Extract links from a crawl result and filter them.
	 */
	protected async discoverLinks(
		result: CrawlResult,
		visited: Set<string>,
		depth: number,
		depths: Map<string, number>,
		config: DeepCrawlConfig,
	): Promise<Array<{ url: string; anchorText: string }>> {
		const candidates: Array<{ url: string; anchorText: string }> = [];

		const allLinks = [...result.links.internal];

		for (const link of allLinks) {
			if ((config.respectNoFollow ?? true) && link.nofollow) continue;
			const normalized = this.normalizeUrl(link.href, config);
			if (!normalized) continue;
			if (visited.has(normalized)) continue;

			const nextDepth = depth + 1;
			if (nextDepth > config.maxDepth) continue;

			// Check robots.txt
			if (config.robotsParser) {
				const directives = await config.robotsParser.fetch(normalized);
				if (!config.robotsParser.isAllowed(normalized, directives)) continue;
				if (directives.crawlDelay !== null && config.rateLimiter) {
					config.rateLimiter.setDelay(normalized, directives.crawlDelay * 1000);
				}
			}

			// Check filter chain
			if (config.filterChain) {
				depths.set(normalized, nextDepth);
				if (!(await config.filterChain.apply(normalized))) continue;
			}

			candidates.push({ url: normalized, anchorText: link.text });
		}

		return candidates;
	}

	protected normalizeUrl(url: string, config: DeepCrawlConfig): string | null {
		return normalizeUrl(url, undefined, {
			ignoreQueryParameters: config.ignoreQueryParameters,
			removeTrackingParameters: config.removeTrackingParameters,
		});
	}

	protected async crawlWithRateLimit(
		url: string,
		crawler: WebCrawler,
		crawlConfig: CrawlerRunConfigOverrides,
		rateLimiter?: RateLimiter,
	): Promise<CrawlResult> {
		if (rateLimiter) {
			await rateLimiter.waitIfNeeded(url, crawlConfig.signal ?? undefined);
		}

		const result = await crawler.crawl(url, crawlConfig);

		if (rateLimiter && result.statusCode) {
			rateLimiter.reportResult(url, result.statusCode, result.responseHeaders?.["retry-after"]);
		}

		return result;
	}
}

// ---------------------------------------------------------------------------
// BFS (Breadth-First Search)
// ---------------------------------------------------------------------------

export class BFSDeepCrawlStrategy extends DeepCrawlStrategy {
	constructor() {
		super("bfs");
	}

	async run(
		startUrl: string,
		crawler: WebCrawler,
		crawlConfig: CrawlerRunConfigOverrides,
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
		crawlConfig: CrawlerRunConfigOverrides,
		deepConfig: DeepCrawlConfig,
	): AsyncGenerator<CrawlResult, void, unknown> {
		const logger = deepConfig.logger ?? new SilentLogger();
		const visited = new Set<string>();
		const depths = new Map<string, number>();

		let currentLevel = [this.normalizeUrl(startUrl, deepConfig) ?? startUrl];
		let currentDepth = 0;
		let pageCount = 0;

		while (currentLevel.length > 0 && pageCount < deepConfig.maxPages) {
			crawlConfig.signal?.throwIfAborted();
			logger.info(`BFS depth ${currentDepth}: ${currentLevel.length} URLs`);
			const nextLevel: Array<{ url: string; anchorText: string }> = [];

			// Process current level in batches
			const batches = chunk(currentLevel, deepConfig.concurrency);

			for (const batch of batches) {
				if (pageCount >= deepConfig.maxPages) break;

				const promises = batch
					.filter((url) => !visited.has(url))
					.slice(0, deepConfig.maxPages - pageCount)
					.map(async (url) => {
						visited.add(url);
						depths.set(url, currentDepth);
						return this.crawlWithRateLimit(url, crawler, crawlConfig, deepConfig.rateLimiter);
					});

				const results = await Promise.all(promises);

				for (const result of results) {
					pageCount++;
					yield result;

					if (result.success && currentDepth < deepConfig.maxDepth) {
						const discovered = await this.discoverLinks(
							result,
							visited,
							currentDepth,
							depths,
							deepConfig,
						);
						nextLevel.push(...discovered);
					}
				}
			}

			currentLevel = [...new Set(nextLevel.map((l) => l.url))];
			currentDepth++;
		}

		logger.info(`BFS complete: ${pageCount} pages crawled`);
	}
}

// ---------------------------------------------------------------------------
// DFS (Depth-First Search)
// ---------------------------------------------------------------------------

export class DFSDeepCrawlStrategy extends DeepCrawlStrategy {
	constructor() {
		super("dfs");
	}

	async run(
		startUrl: string,
		crawler: WebCrawler,
		crawlConfig: CrawlerRunConfigOverrides,
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
		crawlConfig: CrawlerRunConfigOverrides,
		deepConfig: DeepCrawlConfig,
	): AsyncGenerator<CrawlResult, void, unknown> {
		const logger = deepConfig.logger ?? new SilentLogger();
		const visited = new Set<string>();
		const depths = new Map<string, number>();
		let pageCount = 0;

		// Stack: [url, depth]
		const stack: Array<[string, number]> = [
			[this.normalizeUrl(startUrl, deepConfig) ?? startUrl, 0],
		];

		while (stack.length > 0 && pageCount < deepConfig.maxPages) {
			crawlConfig.signal?.throwIfAborted();
			const [url, depth] = stack.pop()!;

			if (visited.has(url)) continue;
			if (depth > deepConfig.maxDepth) continue;

			visited.add(url);
			depths.set(url, depth);

			logger.debug(`DFS depth ${depth}: ${url}`);

			const result = await this.crawlWithRateLimit(
				url,
				crawler,
				crawlConfig,
				deepConfig.rateLimiter,
			);
			pageCount++;
			yield result;

			if (result.success && depth < deepConfig.maxDepth) {
				const discovered = await this.discoverLinks(result, visited, depth, depths, deepConfig);
				// Push in reverse order so first link is processed next
				for (let i = discovered.length - 1; i >= 0; i--) {
					stack.push([discovered[i].url, depth + 1]);
				}
			}
		}

		logger.info(`DFS complete: ${pageCount} pages crawled`);
	}
}

// ---------------------------------------------------------------------------
// BestFirst (Score-based priority)
// ---------------------------------------------------------------------------

interface ScoredURL {
	url: string;
	depth: number;
	score: number;
	anchorText: string;
	parentUrl: string;
}

export class BestFirstDeepCrawlStrategy extends DeepCrawlStrategy {
	constructor() {
		super("best-first");
	}

	async run(
		startUrl: string,
		crawler: WebCrawler,
		crawlConfig: CrawlerRunConfigOverrides,
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
		crawlConfig: CrawlerRunConfigOverrides,
		deepConfig: DeepCrawlConfig,
	): AsyncGenerator<CrawlResult, void, unknown> {
		const logger = deepConfig.logger ?? new SilentLogger();
		const scorer = deepConfig.scorer;
		const visited = new Set<string>();
		const depths = new Map<string, number>();
		let pageCount = 0;

		// Priority queue (sorted by score descending)
		const queue: ScoredURL[] = [
			{
				url: this.normalizeUrl(startUrl, deepConfig) ?? startUrl,
				depth: 0,
				score: 1.0,
				anchorText: "",
				parentUrl: "",
			},
		];

		while (queue.length > 0 && pageCount < deepConfig.maxPages) {
			crawlConfig.signal?.throwIfAborted();
			// Sort by score (highest first) — simple approach, fine for typical crawl sizes
			queue.sort((a, b) => b.score - a.score);

			const { url, depth, score } = queue.shift()!;

			if (visited.has(url)) continue;
			if (depth > deepConfig.maxDepth) continue;

			visited.add(url);
			depths.set(url, depth);

			logger.debug(`BestFirst depth ${depth} score ${score.toFixed(2)}: ${url}`);

			const result = await this.crawlWithRateLimit(
				url,
				crawler,
				crawlConfig,
				deepConfig.rateLimiter,
			);
			pageCount++;
			yield result;

			if (result.success && depth < deepConfig.maxDepth) {
				const discovered = await this.discoverLinks(result, visited, depth, depths, deepConfig);

				for (const link of discovered) {
					const context: ScorerContext = {
						anchorText: link.anchorText,
						parentUrl: url,
					};
					const linkScore = scorer ? scorer.score(link.url, depth + 1, context) : 1.0;

					queue.push({
						url: link.url,
						depth: depth + 1,
						score: linkScore,
						anchorText: link.anchorText,
						parentUrl: url,
					});
				}
			}
		}

		logger.info(`BestFirst complete: ${pageCount} pages crawled`);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}
