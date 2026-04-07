import * as cheerio from "cheerio";
import { type ExtractedItem, ExtractionStrategy } from "./base";

/**
 * XPath-like extraction using CSS selector approximation.
 *
 * Since Cheerio doesn't support native XPath, this converts common
 * XPath patterns to CSS selectors. For full XPath support, consider
 * using a DOM library with XPath capabilities.
 */

export interface XPathField {
	name: string;
	xpath: string;
	type: "text" | "attribute" | "html";
	attribute?: string;
}

export interface XPathExtractionSchema {
	name: string;
	baseXPath: string;
	fields: XPathField[];
}

export class XPathExtractionStrategy extends ExtractionStrategy {
	private schema: XPathExtractionSchema;

	constructor(schema: XPathExtractionSchema) {
		super();
		this.schema = schema;
	}

	async extract(_url: string, html: string): Promise<ExtractedItem[]> {
		const $ = cheerio.load(html);
		const items: ExtractedItem[] = [];

		const baseSelector = xpathToCSS(this.schema.baseXPath);
		$(baseSelector).each((index, element) => {
			const record: Record<string, unknown> = {};

			for (const field of this.schema.fields) {
				const selector = xpathToCSS(field.xpath);
				const el = $(element).find(selector);

				switch (field.type) {
					case "text":
						record[field.name] = el.first().text().trim();
						break;
					case "attribute":
						record[field.name] = el.first().attr(field.attribute ?? "href") ?? "";
						break;
					case "html":
						record[field.name] = el.first().html() ?? "";
						break;
				}
			}

			items.push({
				index,
				content: JSON.stringify(record),
				metadata: record,
			});
		});

		return items;
	}
}

/**
 * Convert common XPath expressions to CSS selectors.
 * Handles the most frequently used XPath patterns.
 */
function xpathToCSS(xpath: string): string {
	let css = xpath;

	// Handle .// (descendant of current) — convert to descendant selector (space)
	css = css.replace(/^\.\/\//, "");

	// Remove leading //
	css = css.replace(/^\/\//, "");

	// Convert remaining // to descendant (space)
	css = css.replace(/\/\//g, " ");

	// Convert / to >  (direct child)
	css = css.replace(/\//g, " > ");

	// Convert [n] to :nth-of-type(n)
	css = css.replace(/\[(\d+)\]/g, ":nth-of-type($1)");

	// Convert [@attr='val'] to [attr="val"]
	css = css.replace(/\[@([a-zA-Z-]+)='([^']+)'\]/g, '[$1="$2"]');
	css = css.replace(/\[@([a-zA-Z-]+)="([^"]+)"\]/g, '[$1="$2"]');

	// Convert [@attr] to [attr]
	css = css.replace(/\[@([a-zA-Z-]+)\]/g, "[$1]");

	// Convert contains(@attr, 'val') to [attr*="val"]
	css = css.replace(/\[contains\(@([a-zA-Z-]+),\s*'([^']+)'\)\]/g, '[$1*="$2"]');

	// Convert text() — just remove it (CSS selects elements, text is implicit)
	css = css.replace(/\/text\(\)/g, "");

	// Clean up extra spaces
	css = css.replace(/\s+/g, " ").trim();

	return css;
}
