import * as cheerio from "cheerio";
import { type ExtractedItem, ExtractionStrategy } from "./base";

/**
 * Extracts HTML tables into structured data.
 */
export class TableExtractionStrategy extends ExtractionStrategy {
	private minRows: number;
	private includeCaption: boolean;

	constructor(opts: { minRows?: number; includeCaption?: boolean } = {}) {
		super();
		this.minRows = opts.minRows ?? 1;
		this.includeCaption = opts.includeCaption ?? true;
	}

	async extract(_url: string, html: string): Promise<ExtractedItem[]> {
		const $ = cheerio.load(html);
		const items: ExtractedItem[] = [];
		let index = 0;

		$("table").each((_, table) => {
			const headers: string[] = [];
			const rows: string[][] = [];
			let caption: string | null = null;

			// Extract caption
			if (this.includeCaption) {
				const captionEl = $(table).find("caption");
				if (captionEl.length) {
					caption = captionEl.text().trim();
				}
			}

			// Extract headers from thead or first row
			$(table)
				.find("thead th, thead td")
				.each((_, th) => {
					headers.push($(th).text().trim());
				});

			// Fallback: first row as headers if no thead
			if (headers.length === 0) {
				const firstRow = $(table).find("tr").first();
				firstRow.find("th, td").each((_, cell) => {
					headers.push($(cell).text().trim());
				});
			}

			// Extract body rows
			const bodyRows = $(table).find("tbody tr");
			const rowSource =
				bodyRows.length > 0
					? bodyRows
					: $(table)
							.find("tr")
							.slice(headers.length > 0 ? 1 : 0);

			rowSource.each((_, tr) => {
				const row: string[] = [];
				$(tr)
					.find("td, th")
					.each((_, cell) => {
						row.push($(cell).text().trim());
					});
				if (row.length > 0) rows.push(row);
			});

			if (rows.length < this.minRows) return;

			const tableData = {
				headers,
				rows,
				caption,
				rowCount: rows.length,
				columnCount: headers.length || (rows[0]?.length ?? 0),
			};

			items.push({
				index: index++,
				content: JSON.stringify(tableData),
				metadata: tableData,
			});
		});

		return items;
	}
}
