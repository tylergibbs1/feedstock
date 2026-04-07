/**
 * Iframe content inlining — extracts content from iframes
 * and merges it into the parent page's HTML.
 */

import type { Page } from "playwright";

export interface InlinedIframe {
	src: string;
	html: string;
}

/**
 * Extract HTML content from all accessible iframes on the page.
 */
export async function extractIframeContent(page: Page): Promise<InlinedIframe[]> {
	const iframes: InlinedIframe[] = [];

	const frames = page.frames();
	for (const frame of frames) {
		// Skip the main frame
		if (frame === page.mainFrame()) continue;

		try {
			const src = frame.url();
			if (!src || src === "about:blank") continue;

			const html = await frame.content();
			if (html && html.length > 50) {
				iframes.push({ src, html });
			}
		} catch {
			// Frame may have navigated away or be inaccessible (cross-origin)
		}
	}

	return iframes;
}

/**
 * Inline iframe content into the parent HTML by replacing
 * <iframe> tags with their content wrapped in a marker div.
 */
export function inlineIframeContent(parentHtml: string, iframes: InlinedIframe[]): string {
	let result = parentHtml;

	for (const iframe of iframes) {
		// Find the iframe tag with matching src and replace with inlined content
		const escapedSrc = iframe.src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(
			`<iframe[^>]*src=["']${escapedSrc}["'][^>]*>.*?</iframe>|<iframe[^>]*src=["']${escapedSrc}["'][^>]*/>`,
			"gi",
		);

		const inlinedBlock = [
			`<div data-feedstock-iframe-src="${iframe.src}">`,
			iframe.html
				.replace(/<html[^>]*>/gi, "")
				.replace(/<\/html>/gi, "")
				.replace(/<head>[\s\S]*?<\/head>/gi, "")
				.replace(/<\/?body[^>]*>/gi, ""),
			"</div>",
		].join("\n");

		result = result.replace(pattern, inlinedBlock);
	}

	return result;
}
