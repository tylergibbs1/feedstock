/**
 * Neural Quality Estimation scorer inspired by arxiv 2506.16146
 * "Neural Prioritisation for Web Crawling".
 *
 * Uses TF-IDF-like feature extraction with online-learned weights
 * and quality propagation through link neighborhoods.
 */

import type { CrawlResult } from "../models";
import { type ScorerContext, URLScorer } from "./scorers";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface NeuralScorerConfig {
	/** Weight update rate for online learning. */
	learningRate: number;
	/** Decay factor for feature importance over time. */
	featureDecay: number;
	/** How much parent quality propagates to child scores. */
	propagationFactor: number;
	/** Min observations before model predictions are trusted over the prior. */
	minObservations: number;
}

const DEFAULT_CONFIG: NeuralScorerConfig = {
	learningRate: 0.1,
	featureDecay: 0.95,
	propagationFactor: 0.3,
	minObservations: 5,
};

// ---------------------------------------------------------------------------
// Feature extraction helpers
// ---------------------------------------------------------------------------

const CONTENT_PATH_KEYWORDS = [
	"article",
	"post",
	"blog",
	"docs",
	"wiki",
	"news",
	"product",
	"category",
] as const;

const NAVIGATIONAL_ANCHORS = new Set([
	"next",
	"previous",
	"prev",
	"home",
	"back",
	"more",
	"continue",
	"menu",
	"navigation",
	"nav",
	"skip",
	"top",
]);

const CONTENT_EXTENSIONS = new Set(["html", "htm", "php"]);

type FeatureVector = Map<string, number>;

function extractUrlFeatures(url: string): FeatureVector {
	const features: FeatureVector = new Map();
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return features;
	}

	const segments = parsed.pathname.split("/").filter(Boolean);
	features.set("url:path_depth", Math.min(segments.length / 10, 1));

	const lastSegment = segments[segments.length - 1] ?? "";
	const ext = lastSegment.includes(".") ? lastSegment.split(".").pop()! : "";
	features.set("url:has_extension", CONTENT_EXTENSIONS.has(ext.toLowerCase()) ? 1 : 0);

	features.set("url:query_params", Math.min(parsed.searchParams.size / 5, 1));

	const pathLower = parsed.pathname.toLowerCase();
	for (const keyword of CONTENT_PATH_KEYWORDS) {
		features.set(`url:path_contains_${keyword}`, pathLower.includes(keyword) ? 1 : 0);
	}

	return features;
}

function extractAnchorFeatures(
	anchorText: string | undefined,
	query: string | undefined,
): FeatureVector {
	const features: FeatureVector = new Map();

	if (!anchorText) {
		features.set("anchor:length", 0);
		features.set("anchor:word_count", 0);
		features.set("anchor:has_numbers", 0);
		features.set("anchor:is_navigational", 0);
		return features;
	}

	const trimmed = anchorText.trim();
	features.set("anchor:length", Math.min(trimmed.length / 100, 1));

	const words = trimmed.split(/\s+/).filter(Boolean);
	features.set("anchor:word_count", Math.min(words.length / 20, 1));
	features.set("anchor:has_numbers", /\d/.test(trimmed) ? 1 : 0);
	features.set(
		"anchor:is_navigational",
		words.length <= 3 && words.some((w) => NAVIGATIONAL_ANCHORS.has(w.toLowerCase())) ? 1 : 0,
	);

	if (query) {
		const queryWords = query
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 2);
		const anchorLower = trimmed.toLowerCase();
		for (const keyword of queryWords) {
			features.set(`anchor:contains_${keyword}`, anchorLower.includes(keyword) ? 1 : 0);
		}
	}

	return features;
}

function extractParentFeatures(
	parentUrl: string | undefined,
	url: string,
	observedQualities: ReadonlyMap<string, number>,
): FeatureVector {
	const features: FeatureVector = new Map();

	if (!parentUrl) {
		features.set("parent:quality", 0.5);
		features.set("parent:same_domain", 0);
		return features;
	}

	features.set("parent:quality", observedQualities.get(parentUrl) ?? 0.5);

	try {
		const parentDomain = new URL(parentUrl).hostname;
		const childDomain = new URL(url).hostname;
		features.set("parent:same_domain", parentDomain === childDomain ? 1 : 0);
	} catch {
		features.set("parent:same_domain", 0);
	}

	return features;
}

function mergeFeatures(...vectors: FeatureVector[]): FeatureVector {
	const merged: FeatureVector = new Map();
	for (const vec of vectors) {
		for (const [key, value] of vec) {
			merged.set(key, value);
		}
	}
	return merged;
}

/** Sigmoid squashing to [0, 1]. */
function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

// ---------------------------------------------------------------------------
// Neural Quality Scorer
// ---------------------------------------------------------------------------

export class NeuralQualityScorer extends URLScorer {
	private readonly config: NeuralScorerConfig;
	private readonly weights: Map<string, number> = new Map();
	private readonly observedQualities: Map<string, number> = new Map();
	private observationCount = 0;

	constructor(config?: Partial<NeuralScorerConfig>, weight = 1.0) {
		super("neural-quality", weight);
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	score(url: string, _depth: number, context?: ScorerContext): number {
		const features = this.extractFeatures(url, context);
		const featurePrediction = this.predict(features);

		// Blend with parent quality propagation
		const parentQuality = this.getParentQuality(context?.parentUrl);
		const blended =
			(1 - this.config.propagationFactor) * featurePrediction +
			this.config.propagationFactor * parentQuality;

		// If we don't have enough observations, blend toward the prior (0.5)
		if (this.observationCount < this.config.minObservations) {
			const trust = this.observationCount / this.config.minObservations;
			return trust * blended + (1 - trust) * 0.5;
		}

		return blended;
	}

	/** After crawling a page, update the model with observed quality. */
	observe(url: string, quality: number, context?: ScorerContext): void {
		const clamped = Math.max(0, Math.min(1, quality));
		this.observedQualities.set(url, clamped);

		const features = this.extractFeatures(url, context);
		const predicted = this.predict(features);
		const error = clamped - predicted;

		// Gradient descent weight update
		for (const [key, value] of features) {
			const current = this.weights.get(key) ?? 0;
			this.weights.set(key, current + this.config.learningRate * error * value);
		}

		// Apply decay to all weights
		for (const [key, value] of this.weights) {
			this.weights.set(key, value * this.config.featureDecay);
		}

		this.observationCount++;
	}

	/** Get observed quality for a URL, or null if not observed. */
	getObservedQuality(url: string): number | null {
		return this.observedQualities.get(url) ?? null;
	}

	/** Get model stats for debugging. */
	getStats(): {
		observations: number;
		featureWeights: Map<string, number>;
		avgQuality: number;
	} {
		let totalQuality = 0;
		for (const q of this.observedQualities.values()) {
			totalQuality += q;
		}
		const avgQuality =
			this.observedQualities.size > 0 ? totalQuality / this.observedQualities.size : 0;

		return {
			observations: this.observationCount,
			featureWeights: new Map(this.weights),
			avgQuality,
		};
	}

	// -- Private ---------------------------------------------------------------

	private extractFeatures(url: string, context?: ScorerContext): FeatureVector {
		return mergeFeatures(
			extractUrlFeatures(url),
			extractAnchorFeatures(context?.anchorText, context?.query),
			extractParentFeatures(context?.parentUrl, url, this.observedQualities),
		);
	}

	private predict(features: FeatureVector): number {
		let dot = 0;
		for (const [key, value] of features) {
			dot += (this.weights.get(key) ?? 0) * value;
		}
		return sigmoid(dot);
	}

	private getParentQuality(parentUrl: string | undefined): number {
		if (!parentUrl) return 0.5;
		return this.observedQualities.get(parentUrl) ?? 0.5;
	}
}

// ---------------------------------------------------------------------------
// Page quality computation
// ---------------------------------------------------------------------------

/** Compute a 0-1 quality signal from a CrawlResult. */
export function computePageQuality(result: CrawlResult): number {
	// Text content length (weight 0.3) — cap at 10000 chars
	const textLength = result.markdown?.rawMarkdown?.length ?? 0;
	const textScore = Math.min(textLength / 10000, 1);

	// Has meaningful markdown (weight 0.2) — markdown length > 100
	const markdownLength = result.markdown?.rawMarkdown?.length ?? 0;
	const markdownScore = markdownLength > 100 ? 1 : markdownLength / 100;

	// Link density (weight 0.15) — ratio of links to content, lower is better
	const totalLinks =
		(result.links?.internal?.length ?? 0) + (result.links?.external?.length ?? 0);
	const contentLength = result.cleanedHtml?.length ?? 1;
	const linkDensity = Math.min(totalLinks / Math.max(contentLength / 100, 1), 1);
	const linkDensityScore = 1 - linkDensity;

	// Has extracted content (weight 0.15)
	const extractedScore = result.extractedContent && result.extractedContent.length > 0 ? 1 : 0;

	// HTTP success (weight 0.1)
	let httpScore: number;
	if (result.statusCode === 200) httpScore = 1.0;
	else if (result.statusCode !== null && result.statusCode >= 300 && result.statusCode < 400)
		httpScore = 0.5;
	else httpScore = 0;

	// Depth penalty (weight 0.1) — derive depth from URL path segments
	let depthPenalty: number;
	try {
		const segments = new URL(result.url).pathname.split("/").filter(Boolean).length;
		depthPenalty = Math.max(0, 1 - segments * 0.15);
	} catch {
		depthPenalty = 0.5;
	}

	return (
		textScore * 0.3 +
		markdownScore * 0.2 +
		linkDensityScore * 0.15 +
		extractedScore * 0.15 +
		httpScore * 0.1 +
		depthPenalty * 0.1
	);
}
