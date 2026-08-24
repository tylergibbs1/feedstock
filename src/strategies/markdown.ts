import * as cheerio from "cheerio";
import TurndownService from "turndown";
import type { ContentFilterConfig } from "../config";
import type { MarkdownGenerationResult } from "../models";
import { BM25ContentFilter, PruningContentFilter } from "./content-filter";

export interface MarkdownGenerationOptions {
	contentFilter?: ContentFilterConfig | null;
}

/** Abstract base for markdown generation strategies. */
export abstract class MarkdownGenerationStrategy {
	abstract generate(
		url: string,
		html: string,
		options?: MarkdownGenerationOptions,
	): MarkdownGenerationResult;
}

/** Default LLM-oriented Markdown generator with citations and content filtering. */
export class DefaultMarkdownGenerator extends MarkdownGenerationStrategy {
	private turndown: TurndownService;

	constructor(
		opts: { headingStyle?: "atx" | "setext"; codeBlockStyle?: "fenced" | "indented" } = {},
	) {
		super();
		this.turndown = new TurndownService({
			headingStyle: opts.headingStyle ?? "atx",
			codeBlockStyle: opts.codeBlockStyle ?? "fenced",
			bulletListMarker: "-",
		});

		this.turndown.addRule("table", {
			filter: "table",
			replacement: (_content, node) => `\n\n${this.convertTable(node as Element)}\n\n`,
		});
	}

	generate(
		url: string,
		html: string,
		options: MarkdownGenerationOptions = {},
	): MarkdownGenerationResult {
		const rawMarkdown = this.turndown.turndown(this.absolutizeUrls(html, url));

		// Reference-style citations save tokens by deduplicating repeated URLs.
		const links: Array<{ text: string; href: string }> = [];
		const indexes = new Map<string, number>();
		const citationMarkdown = rawMarkdown.replace(
			/(?<!!)\[([^\]]+)]\((\S+?)(?:\s+["'][^"']*["'])?\)/g,
			(_full, text: string, href: string) => {
				let index = indexes.get(href);
				if (!index) {
					index = links.length + 1;
					indexes.set(href, index);
					links.push({ text, href });
				}
				return `${text} [${index}]`;
			},
		);

		const referencesMarkdown = links.map((link, index) => `[${index + 1}] ${link.href}`).join("\n");
		const markdownWithCitations = links.length
			? `${citationMarkdown}\n\n## References\n\n${referencesMarkdown}`
			: rawMarkdown;

		let fitMarkdown: string | null = null;
		if (options.contentFilter?.type === "pruning") {
			fitMarkdown = new PruningContentFilter({
				minWords: options.contentFilter.minWords,
			}).filter(rawMarkdown);
		} else if (options.contentFilter?.type === "bm25") {
			fitMarkdown = new BM25ContentFilter({
				threshold: options.contentFilter.threshold,
			}).filter(rawMarkdown, options.contentFilter.query);
		}

		return {
			rawMarkdown,
			markdownWithCitations,
			referencesMarkdown,
			fitMarkdown,
		};
	}

	private convertTable(node: Element): string {
		const rows = Array.from(node.querySelectorAll("tr"))
			.map((row) =>
				Array.from(row.querySelectorAll("th, td")).map((cell) =>
					(cell.textContent ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"),
				),
			)
			.filter((row) => row.length > 0);
		if (rows.length === 0) return "";

		const width = Math.max(...rows.map((row) => row.length));
		const normalized = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
		const header = normalized[0];
		return [
			`| ${header.join(" | ")} |`,
			`| ${header.map(() => "---").join(" | ")} |`,
			...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
		].join("\n");
	}

	private absolutizeUrls(html: string, baseUrl: string): string {
		const $ = cheerio.load(html, null, false);
		$("a[href], img[src], source[src]").each((_, element) => {
			const node = $(element);
			const attribute = node.attr("href") !== undefined ? "href" : "src";
			const value = node.attr(attribute);
			if (!value || value.startsWith("data:") || value.startsWith("#")) return;
			try {
				node.attr(attribute, new URL(value, baseUrl).href);
			} catch {}
		});
		return $.html();
	}
}
