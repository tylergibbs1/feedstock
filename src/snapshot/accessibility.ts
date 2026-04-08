/**
 * Accessibility tree snapshot via Chrome DevTools Protocol.
 *
 * Uses Accessibility.getFullAXTree to build a compact semantic
 * representation of the page — orders of magnitude smaller than raw HTML.
 */

import * as cheerio from "cheerio";
import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Role categories
// ---------------------------------------------------------------------------

const INTERACTIVE_ROLES = new Set([
	"button",
	"link",
	"textbox",
	"checkbox",
	"radio",
	"combobox",
	"menuitem",
	"slider",
	"switch",
	"tab",
	"searchbox",
	"spinbutton",
	"option",
	"menuitemcheckbox",
	"menuitemradio",
	"treeitem",
]);

const CONTENT_ROLES = new Set([
	"heading",
	"paragraph",
	"cell",
	"listitem",
	"article",
	"region",
	"main",
	"navigation",
	"banner",
	"contentinfo",
	"complementary",
	"img",
	"figure",
	"blockquote",
	"code",
	"definition",
	"term",
	"status",
	"alert",
]);

const SKIP_ROLES = new Set(["none", "presentation", "generic", "group", "LineBreak"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotNode {
	ref: string | null;
	role: string;
	name: string;
	level?: number;
	value?: string;
	checked?: boolean;
	selected?: boolean;
	expanded?: boolean;
	disabled?: boolean;
	url?: string;
	children: SnapshotNode[];
}

export interface SnapshotOptions {
	/** Include only interactive elements */
	interactiveOnly?: boolean;
	/** Maximum depth to traverse */
	maxDepth?: number;
	/** Include URLs for links */
	resolveUrls?: boolean;
}

export interface PageSnapshot {
	/** Compact text representation */
	text: string;
	/** Structured tree */
	tree: SnapshotNode[];
	/** Reference map: ref -> { role, name } */
	refs: Map<string, { role: string; name: string }>;
	/** Total node count */
	nodeCount: number;
}

// ---------------------------------------------------------------------------
// CDP AX tree types
// ---------------------------------------------------------------------------

interface AXNode {
	nodeId: string;
	role: { value: string };
	name?: { value: string };
	properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
	childIds?: string[];
	parentId?: string;
	backendDOMNodeId?: number;
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

export async function takeSnapshot(
	page: Page,
	options: SnapshotOptions = {},
): Promise<PageSnapshot> {
	const cdp = await page.context().newCDPSession(page);

	try {
		// biome-ignore lint: CDP command not in Playwright typings
		const result = await (cdp as any).send("Accessibility.getFullAXTree");
		const nodes: AXNode[] = (result as unknown as { nodes: AXNode[] }).nodes;

		if (!nodes || nodes.length === 0) {
			return { text: "", tree: [], refs: new Map(), nodeCount: 0 };
		}

		// Build lookup
		const nodeMap = new Map<string, AXNode>();
		for (const node of nodes) {
			nodeMap.set(node.nodeId, node);
		}

		// Find root
		const root = nodes[0];

		// Build tree
		let refCounter = 0;
		const refs = new Map<string, { role: string; name: string }>();

		function buildNode(axNode: AXNode, depth: number): SnapshotNode | null {
			if (options.maxDepth !== undefined && depth > options.maxDepth) return null;

			const role = axNode.role?.value ?? "unknown";
			const name = axNode.name?.value ?? "";

			// Skip empty structural nodes
			if (SKIP_ROLES.has(role) && !name) {
				// But still process children
				const children = buildChildren(axNode, depth);
				if (children.length === 1) return children[0];
				if (children.length === 0) return null;
				// Flatten: return a virtual container
				return { ref: null, role: "group", name: "", children };
			}

			// Filter interactive-only mode
			if (options.interactiveOnly && !INTERACTIVE_ROLES.has(role)) {
				const children = buildChildren(axNode, depth);
				if (children.length === 0) return null;
				return { ref: null, role, name, children };
			}

			// Skip unnamed non-interactive nodes
			if (!INTERACTIVE_ROLES.has(role) && !CONTENT_ROLES.has(role) && !name) {
				const children = buildChildren(axNode, depth);
				if (children.length === 1) return children[0];
				if (children.length === 0) return null;
				return { ref: null, role, name, children };
			}

			// Assign ref to interactive or named content nodes
			let ref: string | null = null;
			if (INTERACTIVE_ROLES.has(role) || (CONTENT_ROLES.has(role) && name)) {
				refCounter++;
				ref = `e${refCounter}`;
				refs.set(ref, { role, name });
			}

			// Extract properties
			const props = extractProperties(axNode);
			const children = buildChildren(axNode, depth);

			return {
				ref,
				role,
				name,
				...props,
				children,
			};
		}

		function buildChildren(axNode: AXNode, depth: number): SnapshotNode[] {
			const children: SnapshotNode[] = [];
			for (const childId of axNode.childIds ?? []) {
				const child = nodeMap.get(childId);
				if (!child) continue;
				const node = buildNode(child, depth + 1);
				if (node) children.push(node);
			}
			return children;
		}

		const tree: SnapshotNode[] = [];
		const rootNode = buildNode(root, 0);
		if (rootNode) {
			// Flatten root if it's just a wrapper
			if (!rootNode.ref && rootNode.children.length > 0) {
				tree.push(...rootNode.children);
			} else {
				tree.push(rootNode);
			}
		}

		// Render text
		const text = renderTree(tree);

		return { text, tree, refs, nodeCount: refCounter };
	} finally {
		await cdp.detach();
	}
}

// ---------------------------------------------------------------------------
// Property extraction
// ---------------------------------------------------------------------------

function extractProperties(
	node: AXNode,
): Partial<
	Pick<SnapshotNode, "level" | "value" | "checked" | "selected" | "expanded" | "disabled" | "url">
> {
	const result: Record<string, unknown> = {};

	for (const prop of node.properties ?? []) {
		switch (prop.name) {
			case "level":
				result.level = prop.value.value as number;
				break;
			case "checked":
				result.checked = prop.value.value === "true" || prop.value.value === true;
				break;
			case "selected":
				result.selected = prop.value.value === "true" || prop.value.value === true;
				break;
			case "expanded":
				result.expanded = prop.value.value === "true" || prop.value.value === true;
				break;
			case "disabled":
				result.disabled = prop.value.value === "true" || prop.value.value === true;
				break;
			case "url":
				result.url = prop.value.value as string;
				break;
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Text renderer
// ---------------------------------------------------------------------------

function renderTree(nodes: SnapshotNode[], indent = 0): string {
	const lines: string[] = [];

	for (const node of nodes) {
		const prefix = "  ".repeat(indent);
		const refTag = node.ref ? `@${node.ref} ` : "";
		const attrs: string[] = [];

		if (node.level) attrs.push(`level=${node.level}`);
		if (node.value) attrs.push(`value="${node.value}"`);
		if (node.checked !== undefined) attrs.push(`checked=${node.checked}`);
		if (node.selected) attrs.push("selected");
		if (node.expanded !== undefined) attrs.push(`expanded=${node.expanded}`);
		if (node.disabled) attrs.push("disabled");
		if (node.url) attrs.push(`-> ${node.url}`);

		const attrStr = attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
		const nameStr = node.name ? ` "${node.name}"` : "";

		const line = `${prefix}${refTag}[${node.role}]${nameStr}${attrStr}`;

		// Only add non-empty lines
		if (node.ref || node.name || node.children.length > 0) {
			lines.push(line);
		}

		if (node.children.length > 0) {
			lines.push(renderTree(node.children, indent + 1));
		}
	}

	return lines.join("\n");
}

/**
 * Build a snapshot from static HTML using Cheerio (no browser needed).
 * Less precise than CDP but works with FetchEngine results.
 */
export function buildStaticSnapshot(html: string): PageSnapshot {
	const $ = cheerio.load(html);

	let refCounter = 0;
	const refs = new Map<string, { role: string; name: string }>();
	const tree: SnapshotNode[] = [];

	// Extract headings
	$("h1, h2, h3, h4, h5, h6").each((_: number, el: any) => {
		const tag = el.tagName as string;
		const level = parseInt(tag[1], 10);
		const text = $(el).text().trim();
		if (!text) return;

		refCounter++;
		const ref = `e${refCounter}`;
		refs.set(ref, { role: "heading", name: text });
		tree.push({ ref, role: "heading", name: text, level, children: [] });
	});

	// Extract links
	$("a[href]").each((_: number, el: any) => {
		const text = $(el).text().trim();
		const href = $(el).attr("href") ?? "";
		if (!text || href.startsWith("#") || href.startsWith("javascript:")) return;

		refCounter++;
		const ref = `e${refCounter}`;
		refs.set(ref, { role: "link", name: text });
		tree.push({ ref, role: "link", name: text, url: href, children: [] });
	});

	// Extract buttons
	$("button, input[type='submit'], input[type='button']").each((_: number, el: any) => {
		const text = $(el).text().trim() || $(el).attr("value") || "";
		if (!text) return;

		refCounter++;
		const ref = `e${refCounter}`;
		refs.set(ref, { role: "button", name: text });
		tree.push({ ref, role: "button", name: text, children: [] });
	});

	// Extract inputs
	$("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea, select").each(
		(_: number, el: any) => {
			const type = $(el).attr("type") ?? "text";
			const name =
				$(el).attr("aria-label") ?? $(el).attr("placeholder") ?? $(el).attr("name") ?? "";

			const roleMap: Record<string, string> = {
				text: "textbox",
				email: "textbox",
				password: "textbox",
				search: "searchbox",
				tel: "textbox",
				url: "textbox",
				number: "spinbutton",
				checkbox: "checkbox",
				radio: "radio",
			};
			const role = roleMap[type] ?? "textbox";

			refCounter++;
			const ref = `e${refCounter}`;
			refs.set(ref, { role, name });

			const node: SnapshotNode = { ref, role, name, children: [] };
			if (type === "checkbox" || type === "radio") {
				node.checked = $(el).is(":checked");
			}
			tree.push(node);
		},
	);

	// Extract images with alt text
	$("img[alt]").each((_: number, el: any) => {
		const alt = $(el).attr("alt")?.trim();
		if (!alt) return;

		refCounter++;
		const ref = `e${refCounter}`;
		refs.set(ref, { role: "img", name: alt });
		tree.push({ ref, role: "img", name: alt, children: [] });
	});

	// Extract paragraphs (summarized)
	$("p").each((_: number, el: any) => {
		const text = $(el).text().trim();
		if (!text || text.length < 20) return;

		tree.push({ ref: null, role: "paragraph", name: text, children: [] });
	});

	const textOutput = renderTree(tree);
	return { text: textOutput, tree, refs, nodeCount: refCounter };
}
