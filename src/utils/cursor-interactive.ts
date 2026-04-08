/**
 * Detect cursor-interactive elements — styled divs acting as buttons,
 * elements with onclick/tabindex/contenteditable that standard DOM
 * parsing misses. Requires a live Playwright page.
 *
 * Inspired by agent-browser's find_cursor_interactive_elements pattern.
 */

import type { Page } from "playwright";
import type { InteractiveElement } from "../models";

/**
 * Find elements that are interactable via cursor but aren't standard
 * interactive HTML elements (a, button, input, select, textarea).
 */
export async function detectCursorInteractiveElements(page: Page): Promise<InteractiveElement[]> {
	return page.evaluate(() => {
		const STANDARD_INTERACTIVE = new Set([
			"A",
			"BUTTON",
			"INPUT",
			"SELECT",
			"TEXTAREA",
			"DETAILS",
			"SUMMARY",
		]);

		const results: Array<{
			tag: string;
			text: string;
			href: string | null;
			role: string | null;
			type: string | null;
			selector: string;
		}> = [];

		const allElements = document.querySelectorAll("*");

		for (const el of allElements) {
			const htmlEl = el as HTMLElement;

			// Skip standard interactive elements — they're already found by DOM parsing
			if (STANDARD_INTERACTIVE.has(el.tagName)) continue;

			// Skip invisible elements
			const style = window.getComputedStyle(htmlEl);
			if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
				continue;
			}

			// Check if element is cursor-interactive
			const isCursorPointer = style.cursor === "pointer";
			const hasOnClick = htmlEl.hasAttribute("onclick") || htmlEl.onclick !== null;
			const hasTabIndex = htmlEl.hasAttribute("tabindex") && htmlEl.tabIndex >= 0;
			const isContentEditable = htmlEl.isContentEditable;
			const hasRole = htmlEl.getAttribute("role");
			const interactiveRoles = new Set([
				"button",
				"link",
				"checkbox",
				"radio",
				"tab",
				"menuitem",
				"switch",
				"option",
			]);
			const hasInteractiveRole = hasRole ? interactiveRoles.has(hasRole) : false;

			if (
				!isCursorPointer &&
				!hasOnClick &&
				!hasTabIndex &&
				!isContentEditable &&
				!hasInteractiveRole
			) {
				continue;
			}

			// Build a CSS selector for this element
			let selector = el.tagName.toLowerCase();
			if (el.id) {
				selector = `#${el.id}`;
			} else if (el.className && typeof el.className === "string") {
				const classes = el.className.trim().split(/\s+/).slice(0, 2).join(".");
				if (classes) selector += `.${classes}`;
			}

			const text = htmlEl.innerText?.trim().slice(0, 100) || "";
			if (!text && !hasInteractiveRole) continue; // Skip empty non-role elements

			results.push({
				tag: el.tagName.toLowerCase(),
				text,
				href: htmlEl.getAttribute("href"),
				role: hasRole,
				type: null,
				selector,
			});
		}

		return results;
	});
}
