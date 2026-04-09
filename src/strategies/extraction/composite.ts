import { type ExtractedItem, ExtractionStrategy, NoExtractionStrategy } from "./base";
import { CodeExtractionStrategy } from "./code";
import { type ContentRegion, type ContentType, detectContentRegions } from "./content-detector";
import { ProseExtractionStrategy } from "./prose";
import { TableExtractionStrategy } from "./table";

export interface ContentTypeMapping {
	contentType: ContentType;
	strategy: ExtractionStrategy;
}

export interface CompositeExtractionConfig {
	mappings: ContentTypeMapping[];
	fallback: ExtractionStrategy;
	mergeStrategy: "concatenate" | "interleave";
	includeNavigation: boolean;
	minConfidence: number;
}

type RegionResult = {
	region: ContentRegion;
	items: ExtractedItem[];
	originalIndex: number;
};

/**
 * Runs multiple extraction strategies, one per detected content region,
 * then merges the results.
 *
 * Content regions are detected automatically from the HTML structure.
 * Each region type maps to a specialized extraction strategy. Regions
 * without a mapping use the fallback strategy.
 */
export class CompositeExtractionStrategy extends ExtractionStrategy {
	private config: CompositeExtractionConfig;
	private strategyMap: Map<ContentType, ExtractionStrategy>;

	constructor(config: CompositeExtractionConfig) {
		super();
		this.config = config;
		this.strategyMap = new Map(config.mappings.map((m) => [m.contentType, m.strategy]));
	}

	async extract(url: string, html: string): Promise<ExtractedItem[]> {
		const regions = detectContentRegions(html);

		const filtered = regions.filter((r) => {
			if (!this.config.includeNavigation && r.type === "navigation") return false;
			if (r.confidence < this.config.minConfidence) return false;
			return true;
		});

		// Run each region's strategy concurrently
		const regionResults: RegionResult[] = await Promise.all(
			filtered.map(async (region, idx) => {
				const strategy = this.strategyMap.get(region.type) ?? this.config.fallback;
				const items = await strategy.extract(url, region.html);
				return { region, items, originalIndex: idx };
			}),
		);

		return this.config.mergeStrategy === "concatenate"
			? this.mergeConcatenate(regionResults)
			: this.mergeInterleave(regionResults);
	}

	private mergeInterleave(results: RegionResult[]): ExtractedItem[] {
		// Already in document order from detectContentRegions
		const merged: ExtractedItem[] = [];
		let index = 0;

		for (const { region, items } of results) {
			for (const item of items) {
				merged.push({
					index: index++,
					content: item.content,
					metadata: {
						...item.metadata,
						contentType: region.type,
						region: region.selector,
						confidence: region.confidence,
					},
				});
			}
		}

		return merged;
	}

	private mergeConcatenate(results: RegionResult[]): ExtractedItem[] {
		// Group by content type, preserving within-type document order
		const byType = new Map<ContentType, RegionResult[]>();
		for (const result of results) {
			const existing = byType.get(result.region.type) ?? [];
			existing.push(result);
			byType.set(result.region.type, existing);
		}

		const merged: ExtractedItem[] = [];
		let index = 0;

		for (const [, typeResults] of byType) {
			for (const { region, items } of typeResults) {
				for (const item of items) {
					merged.push({
						index: index++,
						content: item.content,
						metadata: {
							...item.metadata,
							contentType: region.type,
							region: region.selector,
							confidence: region.confidence,
						},
					});
				}
			}
		}

		return merged;
	}
}

/**
 * Create a CompositeExtractionStrategy with sensible defaults.
 * Maps: table → TableExtraction, code → CodeExtraction, prose → ProseExtraction.
 */
export function createCompositeExtraction(
	overrides?: Partial<CompositeExtractionConfig>,
): CompositeExtractionStrategy {
	const defaults: CompositeExtractionConfig = {
		mappings: [
			{ contentType: "table", strategy: new TableExtractionStrategy() },
			{ contentType: "code", strategy: new CodeExtractionStrategy() },
			{ contentType: "prose", strategy: new ProseExtractionStrategy() },
		],
		fallback: new NoExtractionStrategy(),
		mergeStrategy: "interleave",
		includeNavigation: false,
		minConfidence: 0.3,
	};

	return new CompositeExtractionStrategy({ ...defaults, ...overrides });
}
