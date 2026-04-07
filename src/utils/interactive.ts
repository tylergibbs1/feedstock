/**
 * Cursor-interactive element detection.
 *
 * Finds all clickable/interactive elements on a page,
 * including those without ARIA roles (onclick handlers,
 * cursor:pointer CSS, tabindex, contenteditable).
 */

import type { Page } from "playwright";
import type { InteractiveElement } from "../models";

/**
 * Detect all interactive elements on the page via a single JS evaluation.
 */
export async function detectInteractiveElements(page: Page): Promise<InteractiveElement[]> {
	return page.evaluate(() => {
		const results: Array<{
			tag: string;
			text: string;
			href: string | null;
			role: string | null;
			type: string | null;
			selector: string;
		}> = [];

		const seen = new Set<Element>();

		function getSelector(el: Element): string {
			if (el.id) return `#${el.id}`;

			const tag = el.tagName.toLowerCase();
			const classes = Array.from(el.classList)
				.slice(0, 2)
				.map((c) => `.${c}`)
				.join("");
			const parent = el.parentElement;

			if (classes) return `${tag}${classes}`;
			if (parent) {
				const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
				if (siblings.length > 1) {
					const idx = siblings.indexOf(el) + 1;
					return `${tag}:nth-of-type(${idx})`;
				}
			}
			return tag;
		}

		// 1. Standard interactive elements
		const interactiveSelectors = [
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
			"[contenteditable=true]",
		];

		for (const sel of interactiveSelectors) {
			document.querySelectorAll(sel).forEach((el) => {
				if (seen.has(el)) return;
				seen.add(el);

				const htmlEl = el as HTMLElement;
				if (htmlEl.offsetParent === null && htmlEl.style.position !== "fixed") return;

				results.push({
					tag: el.tagName.toLowerCase(),
					text: (htmlEl.textContent ?? "").trim().slice(0, 100),
					href: (el as HTMLAnchorElement).href || null,
					role: el.getAttribute("role"),
					type: (el as HTMLInputElement).type || null,
					selector: getSelector(el),
				});
			});
		}

		// 2. Cursor-pointer elements (catches JS onclick handlers, styled divs, etc.)
		const allElements = document.querySelectorAll("*");
		for (const el of allElements) {
			if (seen.has(el)) continue;

			const htmlEl = el as HTMLElement;
			if (htmlEl.offsetParent === null && htmlEl.style.position !== "fixed") continue;

			const style = window.getComputedStyle(el);
			const isCursorPointer = style.cursor === "pointer";
			const hasOnclick = htmlEl.hasAttribute("onclick");

			if (isCursorPointer || hasOnclick) {
				// Skip if a parent already has cursor:pointer (inherited)
				const parent = el.parentElement;
				if (parent && window.getComputedStyle(parent).cursor === "pointer" && !hasOnclick) {
					continue;
				}

				seen.add(el);
				results.push({
					tag: el.tagName.toLowerCase(),
					text: (htmlEl.textContent ?? "").trim().slice(0, 100),
					href: null,
					role: el.getAttribute("role"),
					type: null,
					selector: getSelector(el),
				});
			}
		}

		return results;
	});
}
