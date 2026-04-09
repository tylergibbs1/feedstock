/**
 * Cache freshness evaluation using noisy change-indicating signals.
 *
 * Inspired by arxiv 2502.02430: instead of blindly trusting a single
 * cache-invalidation signal, combine multiple noisy signals (HTTP headers,
 * sitemap metadata, content hashes, time decay) into a single staleness
 * score that drives a refresh decision.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FreshnessSignal {
	name: string;
	weight: number;
	stale: boolean;
	confidence: number;
	reason: string;
}

export interface FreshnessConfig {
	/** Max cache age before forced refresh (ms). Default 24 h. */
	maxAgeMs: number;
	/** Trust weight for sitemap signals (0-1). */
	sitemapWeight: number;
	/** Trust weight for HTTP header signals (0-1). */
	httpHeaderWeight: number;
	/** Trust weight for content hash comparison (0-1). */
	contentHashWeight: number;
	/** Trust weight for time-based decay (0-1). */
	timeDecayWeight: number;
	/** Combined staleness score above which entry is considered stale. */
	staleThreshold: number;
}

export interface SignalInputs {
	// HTTP response headers from a HEAD request or previous crawl
	etag?: string;
	lastModified?: string;
	cacheControl?: string;

	// Sitemap data
	sitemapLastmod?: string;
	sitemapChangefreq?: string;

	// Previous cache entry metadata
	cachedAt: number;
	cachedEtag?: string;
	cachedLastModified?: string;
	contentHash?: string;
}

export interface CachedEntry {
	url: string;
	cachedAt: number;
	etag?: string;
	lastModified?: string;
	contentHash?: string;
}

export interface FreshnessResult {
	isStale: boolean;
	score: number;
	signals: FreshnessSignal[];
	recommendation: "use_cache" | "revalidate" | "refetch";
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FRESHNESS_CONFIG: FreshnessConfig = {
	maxAgeMs: 86_400_000, // 24 hours
	sitemapWeight: 0.6,
	httpHeaderWeight: 0.8,
	contentHashWeight: 1.0,
	timeDecayWeight: 0.4,
	staleThreshold: 0.5,
};

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export class CacheFreshnessEvaluator {
	private config: FreshnessConfig;

	constructor(config?: Partial<FreshnessConfig>) {
		this.config = { ...DEFAULT_FRESHNESS_CONFIG, ...config };
	}

	evaluate(entry: CachedEntry, signals: SignalInputs): FreshnessResult {
		const collected: FreshnessSignal[] = [];

		this.evaluateTimeDecay(entry, signals, collected);
		this.evaluateHttpHeaders(entry, signals, collected);
		this.evaluateSitemap(entry, signals, collected);
		this.evaluateContentHash(entry, signals, collected);

		const score = this.combine(collected);
		const recommendation = this.recommend(score);

		return {
			isStale: score >= this.config.staleThreshold,
			score,
			signals: collected,
			recommendation,
		};
	}

	// -----------------------------------------------------------------------
	// Signal evaluators
	// -----------------------------------------------------------------------

	private evaluateTimeDecay(
		entry: CachedEntry,
		signals: SignalInputs,
		out: FreshnessSignal[],
	): void {
		const age = Date.now() - signals.cachedAt;
		const { maxAgeMs, timeDecayWeight } = this.config;

		if (age >= maxAgeMs) {
			out.push({
				name: "time_decay",
				weight: timeDecayWeight,
				stale: true,
				confidence: 1.0,
				reason: `Cache age (${ms(age)}) exceeds max age (${ms(maxAgeMs)})`,
			});
		} else {
			const ratio = age / maxAgeMs;
			out.push({
				name: "time_decay",
				weight: timeDecayWeight,
				stale: ratio >= 0.5,
				confidence: 0.5 + 0.5 * ratio,
				reason: `Cache age ${ms(age)} is ${(ratio * 100).toFixed(0)}% of max age`,
			});
		}
	}

	private evaluateHttpHeaders(
		_entry: CachedEntry,
		signals: SignalInputs,
		out: FreshnessSignal[],
	): void {
		const w = this.config.httpHeaderWeight;

		// ETag comparison
		if (signals.etag !== undefined && signals.cachedEtag !== undefined) {
			const match = signals.etag === signals.cachedEtag;
			out.push({
				name: "http_etag",
				weight: w,
				stale: !match,
				confidence: 0.95,
				reason: match ? "ETag unchanged" : "ETag changed",
			});
		}

		// Last-Modified comparison
		if (signals.lastModified !== undefined && signals.cachedLastModified !== undefined) {
			const remote = new Date(signals.lastModified).getTime();
			const cached = new Date(signals.cachedLastModified).getTime();
			if (!Number.isNaN(remote) && !Number.isNaN(cached)) {
				const newer = remote > cached;
				out.push({
					name: "http_last_modified",
					weight: w,
					stale: newer,
					confidence: 0.8,
					reason: newer
						? "Last-Modified is newer than cached"
						: "Last-Modified unchanged or older",
				});
			}
		}

		// Cache-Control
		if (signals.cacheControl !== undefined) {
			this.evaluateCacheControl(signals.cacheControl, signals.cachedAt, w, out);
		}
	}

	private evaluateCacheControl(
		header: string,
		cachedAt: number,
		weight: number,
		out: FreshnessSignal[],
	): void {
		const directives = header.toLowerCase();

		if (directives.includes("no-cache") || directives.includes("no-store")) {
			out.push({
				name: "http_cache_control",
				weight,
				stale: true,
				confidence: 0.7,
				reason: "Cache-Control: no-cache / no-store",
			});
			return;
		}

		const maxAgeMatch = directives.match(/max-age=(\d+)/);
		if (maxAgeMatch) {
			const maxAgeSec = Number(maxAgeMatch[1]);
			const age = (Date.now() - cachedAt) / 1000;
			const expired = age > maxAgeSec;
			out.push({
				name: "http_cache_control",
				weight,
				stale: expired,
				confidence: 0.9,
				reason: expired
					? `Cache-Control max-age=${maxAgeSec}s expired (age ${Math.round(age)}s)`
					: `Cache-Control max-age=${maxAgeSec}s not expired (age ${Math.round(age)}s)`,
			});
		}
	}

	private evaluateSitemap(
		_entry: CachedEntry,
		signals: SignalInputs,
		out: FreshnessSignal[],
	): void {
		const w = this.config.sitemapWeight;

		if (signals.sitemapLastmod !== undefined) {
			const lastmod = new Date(signals.sitemapLastmod).getTime();
			if (!Number.isNaN(lastmod)) {
				const newer = lastmod > signals.cachedAt;
				out.push({
					name: "sitemap_lastmod",
					weight: w,
					stale: newer,
					confidence: 0.7,
					reason: newer
						? "Sitemap lastmod is newer than cache timestamp"
						: "Sitemap lastmod is older than cache timestamp",
				});
			}
		}

		if (signals.sitemapChangefreq !== undefined) {
			const freq = signals.sitemapChangefreq.toLowerCase();
			if (freq === "always" || freq === "hourly") {
				out.push({
					name: "sitemap_changefreq",
					weight: w,
					stale: true,
					confidence: 0.4,
					reason: `Sitemap changefreq "${freq}" implies frequent changes`,
				});
			} else if (freq === "never" || freq === "yearly") {
				out.push({
					name: "sitemap_changefreq",
					weight: w,
					stale: false,
					confidence: 0.6,
					reason: `Sitemap changefreq "${freq}" implies rare changes`,
				});
			}
			// daily/weekly/monthly: too ambiguous to produce a useful signal
		}
	}

	private evaluateContentHash(
		entry: CachedEntry,
		signals: SignalInputs,
		out: FreshnessSignal[],
	): void {
		if (entry.contentHash !== undefined && signals.contentHash !== undefined) {
			const match = entry.contentHash === signals.contentHash;
			out.push({
				name: "content_hash",
				weight: this.config.contentHashWeight,
				stale: !match,
				confidence: 1.0,
				reason: match ? "Content hash unchanged" : "Content hash changed",
			});
		}
	}

	// -----------------------------------------------------------------------
	// Combination
	// -----------------------------------------------------------------------

	private combine(signals: FreshnessSignal[]): number {
		if (signals.length === 0) return 0;

		let weightedSum = 0;
		let totalWeight = 0;

		for (const s of signals) {
			const effectiveWeight = s.weight * s.confidence;
			const value = s.stale ? 1 : 0;
			weightedSum += value * effectiveWeight;
			totalWeight += effectiveWeight;
		}

		return totalWeight === 0 ? 0 : weightedSum / totalWeight;
	}

	private recommend(score: number): FreshnessResult["recommendation"] {
		if (score < 0.3) return "use_cache";
		if (score > 0.7) return "refetch";
		return "revalidate";
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ms(milliseconds: number): string {
	const seconds = Math.round(milliseconds / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return `${hours}h`;
}
