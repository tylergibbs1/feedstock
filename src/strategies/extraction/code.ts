import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { type ExtractedItem, ExtractionStrategy } from "./base";

const LANGUAGE_CLASS_RE = /\b(?:language|lang|hljs)-(\w+)\b/;

/**
 * Extracts code blocks from HTML, preserving whitespace and detecting language.
 */
export class CodeExtractionStrategy extends ExtractionStrategy {
	async extract(_url: string, html: string): Promise<ExtractedItem[]> {
		const $ = cheerio.load(html);
		const items: ExtractedItem[] = [];
		let index = 0;

		// Match <pre> containing <code>, standalone <pre>, or standalone <code> blocks
		$("pre").each((_, el) => {
			const codeEl = $(el).find("code");
			const target = codeEl.length > 0 ? codeEl.first() : $(el);
			const text = target.text();
			if (!text.trim()) return;

			const language = detectLanguage($, el, codeEl.length > 0 ? codeEl.get(0)! : null);
			const lineCount = text.split("\n").length;

			items.push({
				index: index++,
				content: text,
				metadata: { language, lineCount },
			});
		});

		// Standalone <code> not inside <pre>
		$("code").each((_, el) => {
			if ($(el).parents("pre").length > 0) return;
			const text = $(el).text();
			if (!text.trim()) return;

			// Only include if it has a language class (block-like), not inline snippets
			const cls = $(el).attr("class") ?? "";
			if (!LANGUAGE_CLASS_RE.test(cls)) return;

			const language = detectLanguageFromClass(cls);
			const lineCount = text.split("\n").length;

			items.push({
				index: index++,
				content: text,
				metadata: { language, lineCount },
			});
		});

		return items;
	}
}

function detectLanguage($: CheerioAPI, preEl: AnyNode, codeEl: AnyNode | null): string | null {
	// Check <code> class first, then <pre> class
	if (codeEl) {
		const lang = detectLanguageFromClass($(codeEl).attr("class") ?? "");
		if (lang) return lang;
	}
	return detectLanguageFromClass($(preEl).attr("class") ?? "");
}

function detectLanguageFromClass(cls: string): string | null {
	const match = LANGUAGE_CLASS_RE.exec(cls);
	return match ? match[1] : null;
}
