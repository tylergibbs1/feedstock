import * as cheerio from "cheerio";
import { type ExtractedItem, ExtractionStrategy } from "./base";

/**
 * Schema definition for CSS-based extraction.
 * Maps field names to CSS selectors.
 */
export interface CssExtractionSchema {
	name: string;
	baseSelector: string;
	fields: CssField[];
}

export interface CssField {
	name: string;
	selector: string;
	type: "text" | "attribute" | "html" | "list";
	attribute?: string;
}

/**
 * Extracts structured data from HTML using CSS selectors.
 * Extracts structured data from HTML using CSS selectors.
 */
export class CssExtractionStrategy extends ExtractionStrategy {
	private schema: CssExtractionSchema;

	constructor(schema: CssExtractionSchema) {
		super();
		this.schema = schema;
	}

	async extract(_url: string, html: string): Promise<ExtractedItem[]> {
		const $ = cheerio.load(html);
		const items: ExtractedItem[] = [];

		$(this.schema.baseSelector).each((index, element) => {
			const record: Record<string, unknown> = {};

			for (const field of this.schema.fields) {
				const el = $(element).find(field.selector);

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
					case "list":
						record[field.name] = el
							.map(function () {
								return $(this).text().trim();
							})
							.get();
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
