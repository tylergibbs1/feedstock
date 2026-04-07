/**
 * URL scoring system for prioritized crawling (BestFirst strategy).
 *
 * Scorers assign a relevance score to discovered URLs.
 * A CompositeScorer combines multiple scorers with weighted averaging.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export abstract class URLScorer {
	readonly name: string;
	readonly weight: number;

	constructor(name: string, weight = 1.0) {
		this.name = name;
		this.weight = weight;
	}

	abstract score(url: string, depth: number, context?: ScorerContext): number;
}

export interface ScorerContext {
	anchorText?: string;
	parentUrl?: string;
	query?: string;
}

// ---------------------------------------------------------------------------
// Composite Scorer
// ---------------------------------------------------------------------------

export class CompositeScorer {
	private scorers: URLScorer[];

	constructor(scorers: URLScorer[] = []) {
		this.scorers = scorers;
	}

	add(scorer: URLScorer): this {
		this.scorers.push(scorer);
		return this;
	}

	score(url: string, depth: number, context?: ScorerContext): number {
		if (this.scorers.length === 0) return 1;

		let totalWeight = 0;
		let totalScore = 0;

		for (const scorer of this.scorers) {
			const s = scorer.score(url, depth, context);
			totalScore += s * scorer.weight;
			totalWeight += scorer.weight;
		}

		return totalWeight > 0 ? totalScore / totalWeight : 0;
	}
}

// ---------------------------------------------------------------------------
// Keyword Relevance Scorer
// ---------------------------------------------------------------------------

export class KeywordRelevanceScorer extends URLScorer {
	private keywords: string[];

	constructor(keywords: string[], weight = 1.0) {
		super("keyword-relevance", weight);
		this.keywords = keywords.map((k) => k.toLowerCase());
	}

	score(url: string, _depth: number, context?: ScorerContext): number {
		const text = [url.toLowerCase(), context?.anchorText?.toLowerCase() ?? ""].join(" ");

		let matches = 0;
		for (const keyword of this.keywords) {
			if (text.includes(keyword)) matches++;
		}

		return this.keywords.length > 0 ? matches / this.keywords.length : 0;
	}
}

// ---------------------------------------------------------------------------
// Path Depth Scorer (shallower = higher score)
// ---------------------------------------------------------------------------

export class PathDepthScorer extends URLScorer {
	private maxPathDepth: number;

	constructor(maxPathDepth = 10, weight = 1.0) {
		super("path-depth", weight);
		this.maxPathDepth = maxPathDepth;
	}

	score(url: string, _depth: number): number {
		try {
			const path = new URL(url).pathname;
			const segments = path.split("/").filter(Boolean).length;
			return Math.max(0, 1 - segments / this.maxPathDepth);
		} catch {
			return 0;
		}
	}
}

// ---------------------------------------------------------------------------
// Freshness Scorer (URLs with dates score higher)
// ---------------------------------------------------------------------------

export class FreshnessScorer extends URLScorer {
	constructor(weight = 1.0) {
		super("freshness", weight);
	}

	score(url: string, _depth: number): number {
		// Look for date patterns in URL: /2024/01/, /2024-01-15/, etc.
		const datePattern = /\/20[0-9]{2}[/-]?[01][0-9][/-]?[0-3]?[0-9]?\//;
		const yearPattern = /\/20[0-9]{2}\//;

		if (datePattern.test(url)) {
			// Extract year and compute recency
			const match = url.match(/20([0-9]{2})/);
			if (match) {
				const year = 2000 + parseInt(match[1], 10);
				const currentYear = new Date().getFullYear();
				const age = currentYear - year;
				return Math.max(0, 1 - age * 0.2); // 5+ years old → 0
			}
			return 0.7;
		}

		if (yearPattern.test(url)) return 0.5;

		return 0.3; // No date signal — neutral
	}
}

// ---------------------------------------------------------------------------
// Domain Authority Scorer
// ---------------------------------------------------------------------------

export class DomainAuthorityScorer extends URLScorer {
	private preferredDomains: Set<string>;

	constructor(preferredDomains: string[], weight = 1.0) {
		super("domain-authority", weight);
		this.preferredDomains = new Set(preferredDomains.map((d) => d.toLowerCase()));
	}

	score(url: string, _depth: number): number {
		try {
			const domain = new URL(url).hostname.toLowerCase();
			if (this.preferredDomains.has(domain)) return 1.0;
			// Check if it's a subdomain of a preferred domain
			for (const preferred of this.preferredDomains) {
				if (domain.endsWith(`.${preferred}`)) return 0.8;
			}
			return 0.3;
		} catch {
			return 0;
		}
	}
}
