import * as cheerio from "cheerio";

const NOISE_TAGS = new Set(["script", "style", "noscript", "svg", "path", "iframe", "head"]);

const _BLOCK_ELEMENTS = new Set([
	"div",
	"p",
	"section",
	"article",
	"header",
	"footer",
	"nav",
	"main",
	"aside",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"blockquote",
	"pre",
	"ul",
	"ol",
	"li",
	"table",
	"tr",
	"td",
	"th",
	"form",
	"fieldset",
	"figure",
	"figcaption",
	"details",
	"summary",
]);

/**
 * Remove noise tags, comments, and clean whitespace from HTML.
 */
export function cleanHtml(
	html: string,
	opts: {
		excludeTags?: string[];
		includeTags?: string[];
		cssSelector?: string | null;
		removeOverlayElements?: boolean;
	} = {},
): string {
	const $ = cheerio.load(html);

	// Remove noise tags
	const tagsToRemove = new Set([...NOISE_TAGS, ...(opts.excludeTags ?? [])]);
	for (const tag of tagsToRemove) {
		$(tag).remove();
	}

	// Remove comments
	$("*")
		.contents()
		.filter(function () {
			return this.type === "comment";
		})
		.remove();

	// If includeTags specified, keep only those
	if (opts.includeTags && opts.includeTags.length > 0) {
		const kept = opts.includeTags.map((t) => $(t).html() ?? "").join("\n");
		return kept.trim();
	}

	// If cssSelector specified, extract only matching content
	if (opts.cssSelector) {
		const selected = $(opts.cssSelector);
		if (selected.length > 0) {
			return selected
				.map(function () {
					return $(this).html();
				})
				.get()
				.join("\n")
				.trim();
		}
	}

	// Clean up the body
	return ($("body").html() ?? $.html()).trim();
}

/**
 * Extract metadata from HTML head.
 */
export function extractMetadata(html: string): Record<string, unknown> {
	const $ = cheerio.load(html);
	const metadata: Record<string, unknown> = {};

	metadata.title = $("title").text().trim() || null;
	metadata.description =
		$('meta[name="description"]').attr("content") ??
		$('meta[property="og:description"]').attr("content") ??
		null;
	metadata.keywords = $('meta[name="keywords"]').attr("content") ?? null;
	metadata.ogTitle = $('meta[property="og:title"]').attr("content") ?? null;
	metadata.ogImage = $('meta[property="og:image"]').attr("content") ?? null;
	metadata.canonical = $('link[rel="canonical"]').attr("href") ?? null;
	metadata.language = $("html").attr("lang") ?? null;

	return metadata;
}

/**
 * Extract all links from HTML, split into internal/external.
 */
export function extractLinks(
	html: string,
	baseUrl: string,
): {
	internal: Array<{ href: string; text: string; title: string; baseDomain: string }>;
	external: Array<{ href: string; text: string; title: string; baseDomain: string }>;
} {
	const $ = cheerio.load(html);
	const internal: Array<{ href: string; text: string; title: string; baseDomain: string }> = [];
	const external: Array<{ href: string; text: string; title: string; baseDomain: string }> = [];

	let baseDomain: string;
	try {
		baseDomain = new URL(baseUrl).hostname;
	} catch {
		baseDomain = "";
	}

	$("a[href]").each(function () {
		const href = $(this).attr("href");
		if (
			!href ||
			href.startsWith("#") ||
			href.startsWith("javascript:") ||
			href.startsWith("mailto:")
		) {
			return;
		}

		let absoluteUrl: string;
		try {
			absoluteUrl = new URL(href, baseUrl).href;
		} catch {
			return;
		}

		const text = $(this).text().trim();
		const title = $(this).attr("title")?.trim() ?? "";

		let linkDomain: string;
		try {
			linkDomain = new URL(absoluteUrl).hostname;
		} catch {
			linkDomain = "";
		}

		const link = { href: absoluteUrl, text, title, baseDomain: linkDomain };

		if (linkDomain === baseDomain) {
			internal.push(link);
		} else {
			external.push(link);
		}
	});

	return { internal, external };
}

/**
 * Extract media items (images, videos, audio) from HTML.
 */
export function extractMedia(html: string, baseUrl: string) {
	const $ = cheerio.load(html);
	const images: Array<{
		src: string;
		alt: string;
		desc: string;
		score: number;
		type: "image";
		groupId: number;
		format: string | null;
		width: number | null;
	}> = [];
	const videos: Array<{
		src: string;
		alt: string;
		desc: string;
		score: number;
		type: "video";
		groupId: number;
		format: string | null;
		width: number | null;
	}> = [];
	const audios: Array<{
		src: string;
		alt: string;
		desc: string;
		score: number;
		type: "audio";
		groupId: number;
		format: string | null;
		width: number | null;
	}> = [];

	$("img[src]").each(function () {
		const src = $(this).attr("src");
		if (!src) return;

		let absoluteSrc: string;
		try {
			absoluteSrc = new URL(src, baseUrl).href;
		} catch {
			absoluteSrc = src;
		}

		const alt = $(this).attr("alt")?.trim() ?? "";
		const widthAttr = $(this).attr("width");
		const width = widthAttr ? parseInt(widthAttr, 10) || null : null;

		// Simple scoring: larger images with alt text score higher
		let score = 0;
		if (alt) score += 3;
		if (width && width > 100) score += 2;
		if (width && width > 300) score += 3;

		const format = absoluteSrc.match(/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?|$)/i)?.[1] ?? null;

		images.push({
			src: absoluteSrc,
			alt,
			desc: "",
			score,
			type: "image",
			groupId: 0,
			format,
			width,
		});
	});

	$("video source[src], video[src]").each(function () {
		const src = $(this).attr("src");
		if (!src) return;

		let absoluteSrc: string;
		try {
			absoluteSrc = new URL(src, baseUrl).href;
		} catch {
			absoluteSrc = src;
		}

		videos.push({
			src: absoluteSrc,
			alt: "",
			desc: "",
			score: 5,
			type: "video",
			groupId: 0,
			format: null,
			width: null,
		});
	});

	$("audio source[src], audio[src]").each(function () {
		const src = $(this).attr("src");
		if (!src) return;

		let absoluteSrc: string;
		try {
			absoluteSrc = new URL(src, baseUrl).href;
		} catch {
			absoluteSrc = src;
		}

		audios.push({
			src: absoluteSrc,
			alt: "",
			desc: "",
			score: 5,
			type: "audio",
			groupId: 0,
			format: null,
			width: null,
		});
	});

	return { images, videos, audios };
}
