/**
 * Extraction strategy that uses the accessibility tree to extract
 * semantic content — headings, links, buttons, inputs, and images.
 *
 * Uses the static Cheerio-based snapshot builder so it works with
 * any engine (no live browser required).
 */

import { buildStaticSnapshot, type SnapshotNode } from "../../snapshot/accessibility";
import type { ExtractedItem } from "./base";
import { ExtractionStrategy } from "./base";

export interface AccessibilityExtractionConfig {
	/** Include only these roles (e.g., ["heading", "link"]). Default: all roles. */
	roles?: string[];
	/** Include full tree text in addition to individual items. Default: false. */
	includeTreeText?: boolean;
}

export class AccessibilityExtractionStrategy extends ExtractionStrategy {
	private config: AccessibilityExtractionConfig;

	constructor(config: AccessibilityExtractionConfig = {}) {
		super();
		this.config = config;
	}

	async extract(_url: string, html: string): Promise<ExtractedItem[]> {
		const snapshot = buildStaticSnapshot(html);
		const items: ExtractedItem[] = [];
		let index = 0;

		// Optionally include the full rendered tree as the first item
		if (this.config.includeTreeText && snapshot.text) {
			items.push({
				index: index++,
				content: snapshot.text,
				metadata: { type: "tree", nodeCount: snapshot.nodeCount },
			});
		}

		// Flatten tree into individual items
		const flatNodes = flattenTree(snapshot.tree);
		const roleFilter = this.config.roles
			? new Set(this.config.roles)
			: null;

		for (const node of flatNodes) {
			if (!node.ref) continue; // Skip non-referenced nodes
			if (roleFilter && !roleFilter.has(node.role)) continue;

			const metadata: Record<string, unknown> = {
				role: node.role,
				ref: node.ref,
			};
			if (node.url) metadata.url = node.url;
			if (node.level) metadata.level = node.level;
			if (node.checked !== undefined) metadata.checked = node.checked;
			if (node.disabled) metadata.disabled = node.disabled;

			items.push({
				index: index++,
				content: node.name,
				metadata,
			});
		}

		return items;
	}
}

function flattenTree(nodes: SnapshotNode[]): SnapshotNode[] {
	const result: SnapshotNode[] = [];
	for (const node of nodes) {
		result.push(node);
		if (node.children.length > 0) {
			result.push(...flattenTree(node.children));
		}
	}
	return result;
}
