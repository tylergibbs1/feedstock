import { type ExtractedItem, ExtractionStrategy } from "./base";

/**
 * Extracts content from HTML using regex patterns.
 * Extracts content from HTML using regex patterns.
 */
export class RegexExtractionStrategy extends ExtractionStrategy {
	private patterns: RegExp[];

	constructor(patterns: (string | RegExp)[]) {
		super();
		this.patterns = patterns.map((p) => (typeof p === "string" ? new RegExp(p, "g") : p));
	}

	async extract(_url: string, html: string): Promise<ExtractedItem[]> {
		const items: ExtractedItem[] = [];
		let index = 0;

		for (const pattern of this.patterns) {
			// Reset lastIndex for global patterns
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = pattern.exec(html)) !== null) {
				items.push({
					index: index++,
					content: match[0],
					metadata: {
						groups: match.groups ?? {},
						fullMatch: match[0],
						captures: match.slice(1),
					},
				});
			}
		}

		return items;
	}
}
