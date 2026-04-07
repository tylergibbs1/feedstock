/**
 * Abstract base for content extraction strategies.
 *
 * Extraction strategies take cleaned HTML and produce structured data.
 */
export abstract class ExtractionStrategy {
	abstract extract(url: string, html: string): Promise<ExtractedItem[]>;
}

export interface ExtractedItem {
	index: number;
	content: string;
	metadata?: Record<string, unknown>;
}

/**
 * No-op extraction strategy — returns the HTML as-is.
 */
export class NoExtractionStrategy extends ExtractionStrategy {
	async extract(_url: string, html: string): Promise<ExtractedItem[]> {
		return [{ index: 0, content: html }];
	}
}
