/**
 * UCB1-based Sleeping Bandit scorer for URL frontier prioritization.
 *
 * Each URL is mapped to a "link group" (see tag-path.ts). The bandit
 * maintains per-group reward statistics and uses the UCB1 formula to
 * balance exploitation (high-reward groups) with exploration (under-sampled
 * groups).
 *
 * Inspired by: "Sleeping Bandits for Content Discovery in Web Crawlers"
 * (arXiv:2602.11874)
 */

import type { CrawlResult } from "../models";
import type { ScorerContext } from "./scorers";
import { URLScorer } from "./scorers";
import { extractLinkGroup } from "./tag-path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface BanditConfig {
	/** UCB exploration parameter (default √2 ≈ 1.41). */
	explorationWeight: number;
	/** Exponential decay applied to older rewards (default 0.95). */
	rewardDecay: number;
	/** Minimum pulls before UCB kicks in — below this, use exploration score (default 2). */
	minSamples: number;
}

const DEFAULT_BANDIT_CONFIG: BanditConfig = {
	explorationWeight: Math.SQRT2,
	rewardDecay: 0.95,
	minSamples: 2,
};

export function createBanditConfig(overrides: Partial<BanditConfig> = {}): BanditConfig {
	return { ...DEFAULT_BANDIT_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Per-group statistics
// ---------------------------------------------------------------------------

interface GroupStats {
	/** Number of times this group has been pulled. */
	pulls: number;
	/** Exponentially-decayed cumulative reward. */
	totalReward: number;
	/** Decayed pull count (weights recent pulls more). */
	decayedPulls: number;
}

export interface BanditGroupSnapshot {
	pulls: number;
	avgReward: number;
	ucb: number;
}

// ---------------------------------------------------------------------------
// BanditScorer
// ---------------------------------------------------------------------------

export class BanditScorer extends URLScorer {
	private readonly config: BanditConfig;
	private readonly groups = new Map<string, GroupStats>();
	private totalPulls = 0;

	constructor(config?: Partial<BanditConfig>, weight = 1.0) {
		super("bandit", weight);
		this.config = createBanditConfig(config);
	}

	// -- URLScorer interface ---------------------------------------------------

	score(url: string, _depth: number, context?: ScorerContext): number {
		const group = extractLinkGroup(url, context);
		return this.ucb(group);
	}

	// -- Bandit-specific API ---------------------------------------------------

	/**
	 * Report observed reward after crawling `url`.
	 * Call this after every page crawl so the bandit can learn.
	 */
	update(url: string, reward: number, context?: ScorerContext): void {
		const group = extractLinkGroup(url, context);
		let stats = this.groups.get(group);

		if (!stats) {
			stats = { pulls: 0, totalReward: 0, decayedPulls: 0 };
			this.groups.set(group, stats);
		}

		// Apply decay to existing stats before adding the new observation.
		stats.totalReward = stats.totalReward * this.config.rewardDecay + reward;
		stats.decayedPulls = stats.decayedPulls * this.config.rewardDecay + 1;
		stats.pulls++;
		this.totalPulls++;
	}

	/**
	 * Snapshot of per-group statistics for debugging / monitoring.
	 */
	getStats(): Map<string, BanditGroupSnapshot> {
		const out = new Map<string, BanditGroupSnapshot>();
		for (const [group, stats] of this.groups) {
			out.set(group, {
				pulls: stats.pulls,
				avgReward: stats.decayedPulls > 0 ? stats.totalReward / stats.decayedPulls : 0,
				ucb: this.ucb(group),
			});
		}
		return out;
	}

	// -- Internal -------------------------------------------------------------

	private ucb(group: string): number {
		const stats = this.groups.get(group);

		// Never-seen group: return a high exploration score so it gets tried.
		if (!stats || stats.pulls < this.config.minSamples) {
			// Use a value above 1.0 to prioritize unexplored groups.
			return 1.0 + this.config.explorationWeight;
		}

		const avgReward = stats.decayedPulls > 0 ? stats.totalReward / stats.decayedPulls : 0;
		const exploration =
			this.config.explorationWeight *
			Math.sqrt(Math.log(this.totalPulls) / stats.pulls);

		return avgReward + exploration;
	}
}

// ---------------------------------------------------------------------------
// Reward computation
// ---------------------------------------------------------------------------

/**
 * Computes a [0, 1] reward signal from a CrawlResult.
 *
 * Components (max 1.0 total):
 *  - Content length   — 0 to 0.4  (normalized, caps at 10 000 chars)
 *  - Meaningful text   — 0 to 0.3  (markdown present and non-trivial)
 *  - Extracted content — 0 to 0.2  (extraction strategy produced output)
 *  - HTTP success      — 0 or 0.1
 */
export function computeReward(result: CrawlResult): number {
	let reward = 0;

	// HTTP success
	if (result.success && result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 300) {
		reward += 0.1;
	}

	// Content length (normalized to 10 000 chars)
	const contentLength = result.markdown?.rawMarkdown?.length ?? result.cleanedHtml?.length ?? 0;
	reward += 0.4 * Math.min(1, contentLength / 10_000);

	// Meaningful text — markdown present and at least 200 chars
	const mdLength = result.markdown?.rawMarkdown?.length ?? 0;
	if (mdLength >= 200) {
		reward += 0.3 * Math.min(1, mdLength / 5_000);
	}

	// Extracted content present
	if (result.extractedContent && result.extractedContent.length > 0) {
		reward += 0.2;
	}

	return Math.min(1, reward);
}
