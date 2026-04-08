/**
 * Content filter strategies for post-processing scraped content.
 * Filters remove low-quality or irrelevant content blocks.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export abstract class ContentFilterStrategy {
	abstract filter(content: string, query?: string): string;
}

// ---------------------------------------------------------------------------
// Pruning filter (rule-based)
// ---------------------------------------------------------------------------

const LOW_QUALITY_PATTERNS = [
	/^(share|tweet|pin|follow|subscribe|sign up|log in|cookie|privacy|terms)/i,
	/^(advertisement|sponsored|promoted)/i,
	/^(copyright|all rights reserved|\u00a9)/i,
	/^(loading|please wait|redirecting)/i,
	/^\s*$/,
];

export class PruningContentFilter extends ContentFilterStrategy {
	private minWords: number;
	private patterns: RegExp[];

	constructor(opts: { minWords?: number; extraPatterns?: RegExp[] } = {}) {
		super();
		this.minWords = opts.minWords ?? 5;
		this.patterns = [...LOW_QUALITY_PATTERNS, ...(opts.extraPatterns ?? [])];
	}

	filter(content: string): string {
		const blocks = content.split(/\n\n+/);
		const filtered = blocks.filter((block) => {
			const trimmed = block.trim();
			if (!trimmed) return false;

			// Check word count
			const wordCount = trimmed.split(/\s+/).length;
			if (wordCount < this.minWords) return false;

			// Check against low-quality patterns
			for (const pattern of this.patterns) {
				if (pattern.test(trimmed)) return false;
			}

			return true;
		});

		return filtered.join("\n\n");
	}
}

// ---------------------------------------------------------------------------
// BM25 content filter (relevance scoring)
// ---------------------------------------------------------------------------

export class BM25ContentFilter extends ContentFilterStrategy {
	private k1: number;
	private b: number;
	private threshold: number;

	constructor(opts: { k1?: number; b?: number; threshold?: number } = {}) {
		super();
		this.k1 = opts.k1 ?? 1.5;
		this.b = opts.b ?? 0.75;
		this.threshold = opts.threshold ?? 0.1;
	}

	filter(content: string, query?: string): string {
		if (!query) return content;

		const blocks = content.split(/\n\n+/).filter((b) => b.trim());
		if (blocks.length === 0) return content;

		const queryTerms = this.tokenize(query);
		const blockTokens = blocks.map((b) => this.tokenize(b));
		const avgLen = blockTokens.reduce((sum, t) => sum + t.length, 0) / blockTokens.length;

		// Pre-compute term frequency maps and term sets for O(1) lookups
		const blockFreqs = blockTokens.map((tokens) => {
			const freq = new Map<string, number>();
			for (const t of tokens) {
				freq.set(t, (freq.get(t) ?? 0) + 1);
			}
			return freq;
		});
		const blockSets = blockTokens.map((tokens) => new Set(tokens));

		// Compute IDF for query terms
		const idf = new Map<string, number>();
		for (const term of queryTerms) {
			let df = 0;
			for (const s of blockSets) {
				if (s.has(term)) df++;
			}
			idf.set(term, Math.log((blocks.length - df + 0.5) / (df + 0.5) + 1));
		}

		// Score each block
		const scored = blocks.map((block, i) => {
			const freq = blockFreqs[i];
			const tokenCount = blockTokens[i].length;
			let score = 0;

			for (const term of queryTerms) {
				const tf = freq.get(term) ?? 0;
				const termIdf = idf.get(term) ?? 0;
				const numerator = tf * (this.k1 + 1);
				const denominator = tf + this.k1 * (1 - this.b + this.b * (tokenCount / avgLen));
				score += termIdf * (numerator / denominator);
			}

			return { block, score };
		});

		// Normalize scores
		const maxScore = Math.max(...scored.map((s) => s.score), 1);
		const filtered = scored.filter((s) => s.score / maxScore >= this.threshold).map((s) => s.block);

		return filtered.length > 0 ? filtered.join("\n\n") : content;
	}

	private tokenize(text: string): string[] {
		return text.toLowerCase().split(/\W+/).filter(Boolean);
	}
}
