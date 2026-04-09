import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

export type ContentType = "prose" | "table" | "code" | "list" | "media" | "form" | "navigation";

export interface ContentRegion {
	type: ContentType;
	html: string;
	selector: string;
	confidence: number;
}

const CODE_CLASSES = /\b(highlight|syntax|prism|hljs|code-block|codehilite|sourceCode)\b/;
const NAV_CLASSES = /\b(nav|navbar|navigation|menu|breadcrumb|sidebar)\b/;
const NAV_ROLES = new Set(["navigation", "menu", "menubar"]);

const MIN_PROSE_TEXT_LENGTH = 50;

/**
 * Detect content regions in HTML and classify them by type.
 *
 * Scans top-level semantic elements and assigns each a ContentType
 * with a confidence score. Regions are returned in document order.
 */
export function detectContentRegions(html: string): ContentRegion[] {
	const $ = cheerio.load(html);
	const regions: ContentRegion[] = [];
	const seen = new Set<AnyNode>();

	function alreadySeen(el: AnyNode): boolean {
		let cursor: AnyNode | null = el;
		while (cursor) {
			if (seen.has(cursor)) return true;
			cursor = (cursor as Element).parent ?? null;
		}
		return false;
	}

	function mark(el: AnyNode): void {
		seen.add(el);
	}

	function selectorFor(el: Element, $ctx: CheerioAPI): string {
		const tag = el.tagName?.toLowerCase() ?? "div";
		const id = $ctx(el).attr("id");
		if (id) return `${tag}#${id}`;
		const cls = $ctx(el).attr("class")?.split(/\s+/).filter(Boolean).slice(0, 2).join(".");
		if (cls) return `${tag}.${cls}`;
		const idx = $ctx(el).index();
		return `${tag}:nth-child(${idx + 1})`;
	}

	// --- Navigation ---
	$("nav, [role='navigation'], [role='menu'], [role='menubar']").each((_, el) => {
		if (alreadySeen(el)) return;
		mark(el);
		regions.push({
			type: "navigation",
			html: $.html(el),
			selector: selectorFor(el as Element, $),
			confidence: 0.9,
		});
	});

	// Elements with nav-related classes
	$("[class]").each((_, el) => {
		if (alreadySeen(el)) return;
		const cls = $(el).attr("class") ?? "";
		const role = $(el).attr("role") ?? "";
		if (NAV_CLASSES.test(cls) || NAV_ROLES.has(role)) {
			mark(el);
			regions.push({
				type: "navigation",
				html: $.html(el),
				selector: selectorFor(el as Element, $),
				confidence: 0.7,
			});
		}
	});

	// <ul> inside <header>/<footer> → navigation
	$("header ul, footer ul").each((_, el) => {
		if (alreadySeen(el)) return;
		mark(el);
		regions.push({
			type: "navigation",
			html: $.html(el),
			selector: selectorFor(el as Element, $),
			confidence: 0.6,
		});
	});

	// --- Tables ---
	$("table").each((_, el) => {
		if (alreadySeen(el)) return;
		const $table = $(el);
		const rows = $table.find("tr");
		if (rows.length === 0) return;

		const hasHeader = $table.find("th").length > 0;
		const firstRowCells = rows.first().find("td, th").length;
		const isDataTable = hasHeader || firstRowCells > 1;

		mark(el);
		regions.push({
			type: "table",
			html: $.html(el),
			selector: selectorFor(el as Element, $),
			confidence: isDataTable ? 0.9 : 0.4,
		});
	});

	// --- Code ---
	$("pre, code").each((_, el) => {
		if (alreadySeen(el)) return;
		const tag = (el as Element).tagName?.toLowerCase();
		// Skip inline <code> that's inside a <p> or similar prose
		if (tag === "code" && $(el).parent("pre").length === 0) {
			// Only match standalone code blocks or code with code-related classes
			const cls = $(el).attr("class") ?? "";
			if (!CODE_CLASSES.test(cls)) return;
		}
		mark(el);
		regions.push({
			type: "code",
			html: $.html(el),
			selector: selectorFor(el as Element, $),
			confidence: 0.85,
		});
	});

	// Elements with code-related classes (div.highlight, etc.)
	$("[class]").each((_, el) => {
		if (alreadySeen(el)) return;
		const cls = $(el).attr("class") ?? "";
		if (CODE_CLASSES.test(cls)) {
			mark(el);
			regions.push({
				type: "code",
				html: $.html(el),
				selector: selectorFor(el as Element, $),
				confidence: 0.75,
			});
		}
	});

	// --- Lists ---
	$("ul, ol").each((_, el) => {
		if (alreadySeen(el)) return;
		const items = $(el).children("li");
		if (items.length <= 2) return;
		mark(el);
		regions.push({
			type: "list",
			html: $.html(el),
			selector: selectorFor(el as Element, $),
			confidence: 0.8,
		});
	});

	// --- Media ---
	$("figure, picture, video, audio").each((_, el) => {
		if (alreadySeen(el)) return;
		mark(el);
		regions.push({
			type: "media",
			html: $.html(el),
			selector: selectorFor(el as Element, $),
			confidence: 0.85,
		});
	});

	// Containers that are mostly images
	$("div, section").each((_, el) => {
		if (alreadySeen(el)) return;
		const children = $(el).children();
		if (children.length === 0) return;
		const imgCount = $(el).children("img, picture, figure").length;
		if (imgCount > 0 && imgCount / children.length >= 0.5) {
			mark(el);
			regions.push({
				type: "media",
				html: $.html(el),
				selector: selectorFor(el as Element, $),
				confidence: 0.6,
			});
		}
	});

	// --- Forms ---
	$("form").each((_, el) => {
		if (alreadySeen(el)) return;
		mark(el);
		regions.push({
			type: "form",
			html: $.html(el),
			selector: selectorFor(el as Element, $),
			confidence: 0.9,
		});
	});

	// --- Prose (everything else with substantial text) ---
	$("p, h1, h2, h3, h4, h5, h6, blockquote, article, section, div").each((_, el) => {
		if (alreadySeen(el)) return;
		const text = $(el).text().trim();
		if (text.length < MIN_PROSE_TEXT_LENGTH) return;

		// Skip if all children are already classified
		const childElements = $(el).children();
		let allChildrenSeen = false;
		if (childElements.length > 0) {
			allChildrenSeen = true;
			childElements.each((_, child) => {
				if (!seen.has(child)) allChildrenSeen = false;
			});
		}
		if (allChildrenSeen) return;

		mark(el);
		regions.push({
			type: "prose",
			html: $.html(el),
			selector: selectorFor(el as Element, $),
			confidence: 0.7,
		});
	});

	// Sort by document order (use position within the serialized HTML as proxy)
	return sortByDocumentOrder(regions, html);
}

function sortByDocumentOrder(regions: ContentRegion[], html: string): ContentRegion[] {
	return regions
		.map((r) => ({ region: r, pos: html.indexOf(r.html.slice(0, 60)) }))
		.sort((a, b) => a.pos - b.pos)
		.map((r) => r.region);
}
