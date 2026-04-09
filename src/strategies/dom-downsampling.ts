import * as cheerio from "cheerio";
import type { Element } from "domhandler";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DomDownsamplingConfig {
	enabled: boolean;
	preserveAttributes: string[];
	maxTextLength: number; // 0 = no truncation
	collapseContainers: boolean;
	removeEmptyNodes: boolean;
}

const DEFAULT_PRESERVE_ATTRIBUTES: readonly string[] = [
	"href",
	"src",
	"alt",
	"title",
	"role",
	"aria-label",
	"id",
	"class",
	"type",
	"name",
	"value",
	"action",
	"method",
] as const;

export const DEFAULT_DOM_DOWNSAMPLING_CONFIG: DomDownsamplingConfig = {
	enabled: true,
	preserveAttributes: [...DEFAULT_PRESERVE_ATTRIBUTES],
	maxTextLength: 0,
	collapseContainers: true,
	removeEmptyNodes: true,
};

export function createDomDownsamplingConfig(
	overrides: Partial<DomDownsamplingConfig> = {},
): DomDownsamplingConfig {
	return { ...DEFAULT_DOM_DOWNSAMPLING_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Boilerplate tags to remove entirely
// ---------------------------------------------------------------------------

const BOILERPLATE_TAGS = new Set(["script", "style", "noscript", "svg", "iframe"]);

// Void / self-closing elements that are meaningful even when empty
const VOID_ELEMENTS = new Set([
	"img",
	"input",
	"br",
	"hr",
	"meta",
	"link",
	"area",
	"base",
	"col",
	"embed",
	"source",
	"track",
	"wbr",
]);

// Container elements eligible for single-child collapsing
const COLLAPSIBLE_CONTAINERS = new Set([
	"div",
	"span",
	"section",
	"article",
	"main",
	"aside",
	"header",
	"footer",
	"nav",
	"figure",
	"figcaption",
]);

// ---------------------------------------------------------------------------
// DomDownsampler
// ---------------------------------------------------------------------------

export class DomDownsampler {
	private readonly config: DomDownsamplingConfig;
	private readonly preserveSet: Set<string>;

	constructor(config: Partial<DomDownsamplingConfig> = {}) {
		this.config = createDomDownsamplingConfig(config);
		this.preserveSet = new Set(this.config.preserveAttributes);
	}

	downsample(html: string): string {
		if (!this.config.enabled) {
			return normalizeWhitespace(html);
		}

		if (!html || !html.trim()) {
			return "";
		}

		const $ = cheerio.load(html, { xmlMode: false });

		this.removeComments($);
		this.removeBoilerplate($);
		this.filterAttributes($);

		if (this.config.removeEmptyNodes) {
			this.removeEmpty($);
		}

		if (this.config.collapseContainers) {
			this.collapseChains($);
		}

		if (this.config.maxTextLength > 0) {
			this.truncateText($);
		}

		// Cheerio wraps in <html><head></head><body>...</body></html>
		// Extract just the body content.
		const result = $("body").html() ?? "";
		return normalizeWhitespace(result);
	}

	// -----------------------------------------------------------------------
	// Passes
	// -----------------------------------------------------------------------

	private removeComments($: cheerio.CheerioAPI): void {
		$("*")
			.contents()
			.filter(function () {
				return this.type === "comment";
			})
			.remove();
	}

	private removeBoilerplate($: cheerio.CheerioAPI): void {
		for (const tag of BOILERPLATE_TAGS) {
			$(tag).remove();
		}
	}

	private filterAttributes($: cheerio.CheerioAPI): void {
		$("*").each((_, el) => {
			if (el.type !== "tag") return;
			const attribs = el.attribs;
			for (const attr of Object.keys(attribs)) {
				if (!this.preserveSet.has(attr)) {
					delete attribs[attr];
				}
			}
		});
	}

	private removeEmpty($: cheerio.CheerioAPI): void {
		// Iterate bottom-up by repeating until stable (handles nested empties).
		let changed = true;
		while (changed) {
			changed = false;
			$("*").each((_, el) => {
				if (el.type !== "tag") return;
				const tagName = el.tagName.toLowerCase();

				// Never remove void elements -- they are meaningful without children.
				if (VOID_ELEMENTS.has(tagName)) return;

				const $el = $(el);
				const text = $el.text().trim();
				if (text.length > 0) return;

				// Check for meaningful child elements (void elements like img, input).
				const hasMeaningfulChild = $el.find(Array.from(VOID_ELEMENTS).join(",")).length > 0;
				if (hasMeaningfulChild) return;

				$el.remove();
				changed = true;
			});
		}
	}

	private collapseChains($: cheerio.CheerioAPI): void {
		let changed = true;
		while (changed) {
			changed = false;
			$("*").each((_, el) => {
				if (el.type !== "tag") return;
				const tagName = el.tagName.toLowerCase();
				if (!COLLAPSIBLE_CONTAINERS.has(tagName)) return;

				const $el = $(el);

				// Must have exactly one element child and no text-node siblings with content.
				const children = $el.contents();
				const elementChildren = $el.children();
				if (elementChildren.length !== 1) return;

				// Ensure all non-element children are whitespace-only text nodes.
				let hasContentText = false;
				children.each(function () {
					if (this.type === "text" && this.data && this.data.trim().length > 0) {
						hasContentText = true;
					}
				});
				if (hasContentText) return;

				// Don't collapse if this node has meaningful attributes.
				if (hasMeaningfulAttributes(el)) return;

				// Replace parent with its single child.
				const child = elementChildren.first();
				$el.replaceWith(child);
				changed = true;
			});
		}
	}

	private truncateText($: cheerio.CheerioAPI): void {
		const max = this.config.maxTextLength;
		$("*")
			.contents()
			.filter(function () {
				return this.type === "text";
			})
			.each((_, node) => {
				if (node.type !== "text") return;
				if (node.data && node.data.length > max) {
					node.data = node.data.slice(0, max) + "...";
				}
			});
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasMeaningfulAttributes(el: Element): boolean {
	if (el.type !== "tag") return false;
	const attribs = el.attribs ?? {};
	if (attribs.id) return true;
	if (attribs.role) return true;
	if (attribs.class && attribs.class.trim().length > 0) return true;
	return false;
}

function normalizeWhitespace(html: string): string {
	// Collapse runs of whitespace (spaces, tabs, newlines) into a single space,
	// then trim leading/trailing whitespace on each line.
	return html
		.replace(/[\t ]+/g, " ")
		.replace(/\n\s*\n/g, "\n")
		.replace(/^ +| +$/gm, "")
		.trim();
}
