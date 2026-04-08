/**
 * Static interactive element detection from HTML string.
 * Works without a browser — uses Cheerio to find interactive elements.
 */

import * as cheerio from "cheerio";
import type { InteractiveElement } from "../models";

export function detectInteractiveElementsStatic(html: string): InteractiveElement[] {
	const $ = cheerio.load(html);
	const elements: InteractiveElement[] = [];

	const selectors = [
		"a[href]",
		"button",
		"input:not([type=hidden])",
		"textarea",
		"select",
		'[role="button"]',
		'[role="link"]',
		'[role="tab"]',
		'[role="menuitem"]',
		'[role="checkbox"]',
		'[role="radio"]',
		"[tabindex]",
		'[contenteditable="true"]',
	];

	const seen = new Set<string>();

	for (const sel of selectors) {
		$(sel).each((_, el) => {
			const tag = (el as any).tagName?.toLowerCase() ?? "";
			const text = $(el).text().trim().slice(0, 100);
			const href = $(el).attr("href") ?? null;
			const role = $(el).attr("role") ?? null;
			const type = $(el).attr("type") ?? null;

			// Build a selector for dedup
			const id = $(el).attr("id");
			const cls = $(el).attr("class")?.split(/\s+/).slice(0, 2).join(".") ?? "";
			const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : tag;

			const key = `${tag}:${href ?? ""}:${text.slice(0, 30)}`;
			if (seen.has(key)) return;
			seen.add(key);

			elements.push({ tag, text, href, role, type, selector });
		});
	}

	return elements;
}
