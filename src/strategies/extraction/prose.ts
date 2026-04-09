import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { type ExtractedItem, ExtractionStrategy } from "./base";

const PROSE_ELEMENTS = "p, h1, h2, h3, h4, h5, h6, blockquote";
const HEADING_RE = /^h([1-6])$/i;

/**
 * Extracts prose content (headings, paragraphs, blockquotes) as clean text.
 *
 * Strips inline formatting but preserves structure — heading levels
 * and quote nesting are recorded in metadata.
 */
export class ProseExtractionStrategy extends ExtractionStrategy {
	async extract(_url: string, html: string): Promise<ExtractedItem[]> {
		const $ = cheerio.load(html);
		const items: ExtractedItem[] = [];
		let index = 0;

		$(PROSE_ELEMENTS).each((_, el) => {
			const tag = (el as Element).tagName?.toLowerCase() ?? "";
			const text = $(el).text().trim();
			if (!text) return;

			const wordCount = text.split(/\s+/).filter(Boolean).length;
			const metadata: Record<string, unknown> = { element: tag, wordCount };

			const headingMatch = HEADING_RE.exec(tag);
			if (headingMatch) {
				metadata.level = Number.parseInt(headingMatch[1], 10);
			}

			if (tag === "blockquote") {
				// Count nesting depth
				let depth = 0;
				let cursor = $(el);
				while (cursor.parents("blockquote").length > 0) {
					depth++;
					cursor = cursor.parents("blockquote").first();
				}
				metadata.quoteDepth = depth;
			}

			items.push({
				index: index++,
				content: text,
				metadata,
			});
		});

		return items;
	}
}
