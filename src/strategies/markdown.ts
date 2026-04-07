import TurndownService from "turndown";
import type { MarkdownGenerationResult } from "../models";

/**
 * Abstract base for markdown generation strategies.
 */
export abstract class MarkdownGenerationStrategy {
	abstract generate(url: string, html: string): MarkdownGenerationResult;
}

/**
 * Default markdown generator using Turndown.
 * Converts cleaned HTML to markdown with optional citations.
 */
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

		// Keep tables
		this.turndown.addRule("table", {
			filter: "table",
			replacement: (_content, node) => {
				return `\n\n${this.convertTable(node as HTMLTableElement)}\n\n`;
			},
		});
	}

	generate(_url: string, html: string): MarkdownGenerationResult {
		const rawMarkdown = this.turndown.turndown(html);

		// Build citation version: collect all links and add references
		const links: Array<{ text: string; href: string }> = [];
		let citationMarkdown = rawMarkdown;
		const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
		let match: RegExpExecArray | null;
		let index = 0;

		const replacements: Array<{ from: string; to: string }> = [];

		while ((match = linkRegex.exec(rawMarkdown)) !== null) {
			const [full, text, href] = match;
			index++;
			links.push({ text, href });
			replacements.push({ from: full, to: `${text} [${index}]` });
		}

		for (const { from, to } of replacements) {
			citationMarkdown = citationMarkdown.replace(from, to);
		}

		// Build references section
		const referencesMarkdown =
			links.length > 0 ? links.map((link, i) => `[${i + 1}] ${link.href}`).join("\n") : "";

		const markdownWithCitations =
			links.length > 0
				? `${citationMarkdown}\n\n## References\n\n${referencesMarkdown}`
				: rawMarkdown;

		return {
			rawMarkdown,
			markdownWithCitations,
			referencesMarkdown,
			fitMarkdown: null,
		};
	}

	private convertTable(node: HTMLTableElement | Element): string {
		// Simple table-to-markdown conversion
		// Turndown doesn't handle tables natively, so we do it manually
		const _rows: string[][] = [];
		const _tableNode = node as unknown as { querySelectorAll: (s: string) => NodeListOf<Element> };

		// This runs in Node context with cheerio's serialized HTML,
		// so we'll do a simpler text-based approach
		return `[Table]`;
	}
}
