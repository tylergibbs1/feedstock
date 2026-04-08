import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

const NOISE_TAGS = new Set(["script", "style", "noscript", "svg", "path", "iframe", "head"]);

/**
 * Parse HTML once and run all extraction in a single pass.
 * Avoids calling cheerio.load() 4 times per page.
 */
export function scrapeAll(
	html: string,
	baseUrl: string,
	opts: {
		excludeTags?: string[];
		includeTags?: string[];
		cssSelector?: string | null;
		removeOverlayElements?: boolean;
	} = {},
) {
	const $ = cheerio.load(html);
	// Extract links, media, metadata BEFORE cleaning (cleaning mutates the DOM)
	const links = extractLinksWith($, baseUrl);
	const media = extractMediaWith($, baseUrl);
	const metadata = extractMetadataWith($);
	// Now clean (removes script/style/noise tags from $)
	const cleanedHtml = cleanHtmlWith(cheerio.load(html), opts);
	return { cleanedHtml, links, media, metadata };
}

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
	return cleanHtmlWith(cheerio.load(html), opts);
}

function cleanHtmlWith(
	$: CheerioAPI,
	opts: {
		excludeTags?: string[];
		includeTags?: string[];
		cssSelector?: string | null;
		removeOverlayElements?: boolean;
	} = {},
): string {

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
 * Extract comprehensive metadata from HTML (50+ fields).
 * Covers: standard meta, Open Graph, Twitter Cards, Dublin Core,
 * article tags, JSON-LD, favicons, feeds, and more.
 */
export function extractMetadata(html: string): Record<string, unknown> {
	return extractMetadataWith(cheerio.load(html));
}

function extractMetadataWith($: CheerioAPI): Record<string, unknown> {
	const meta = (name: string) => $(`meta[name="${name}"]`).attr("content") ?? null;
	const prop = (property: string) => $(`meta[property="${property}"]`).attr("content") ?? null;
	const httpEquiv = (name: string) => $(`meta[http-equiv="${name}"]`).attr("content") ?? null;

	const metadata: Record<string, unknown> = {};

	// --- Standard ---
	metadata.title = $("title").text().trim() || null;
	metadata.description = meta("description") ?? prop("og:description") ?? null;
	metadata.keywords = meta("keywords");
	metadata.author = meta("author");
	metadata.generator = meta("generator");
	metadata.viewport = meta("viewport");
	metadata.themeColor = meta("theme-color");
	metadata.robots = meta("robots");
	metadata.googlebot = meta("googlebot");
	metadata.rating = meta("rating");
	metadata.referrer = meta("referrer");
	metadata.formatDetection = meta("format-detection");
	metadata.language = $("html").attr("lang") ?? httpEquiv("content-language") ?? null;
	metadata.charset =
		$("meta[charset]").attr("charset") ??
		httpEquiv("Content-Type")?.match(/charset=([^\s;]+)/)?.[1] ??
		null;

	// --- Canonical & Alternate ---
	metadata.canonical = $('link[rel="canonical"]').attr("href") ?? null;
	metadata.amphtml = $('link[rel="amphtml"]').attr("href") ?? null;
	const alternates: Array<{ href: string; hreflang?: string; type?: string }> = [];
	$('link[rel="alternate"]').each((_, el) => {
		const href = $(el).attr("href");
		if (href) {
			alternates.push({
				href,
				hreflang: $(el).attr("hreflang") ?? undefined,
				type: $(el).attr("type") ?? undefined,
			});
		}
	});
	if (alternates.length > 0) metadata.alternates = alternates;

	// --- Feeds ---
	const feeds: Array<{ href: string; type: string; title?: string }> = [];
	$('link[type="application/rss+xml"], link[type="application/atom+xml"]').each((_, el) => {
		const href = $(el).attr("href");
		if (href) {
			feeds.push({
				href,
				type: $(el).attr("type")!,
				title: $(el).attr("title") ?? undefined,
			});
		}
	});
	if (feeds.length > 0) metadata.feeds = feeds;

	// --- Favicons ---
	const favicons: Array<{ href: string; sizes?: string; type?: string }> = [];
	$('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').each((_, el) => {
		const href = $(el).attr("href");
		if (href) {
			favicons.push({
				href,
				sizes: $(el).attr("sizes") ?? undefined,
				type: $(el).attr("type") ?? undefined,
			});
		}
	});
	if (favicons.length > 0) metadata.favicons = favicons;

	// --- Open Graph (full) ---
	metadata.ogTitle = prop("og:title");
	metadata.ogDescription = prop("og:description");
	metadata.ogImage = prop("og:image");
	metadata.ogImageWidth = prop("og:image:width");
	metadata.ogImageHeight = prop("og:image:height");
	metadata.ogImageAlt = prop("og:image:alt");
	metadata.ogUrl = prop("og:url");
	metadata.ogType = prop("og:type");
	metadata.ogSiteName = prop("og:site_name");
	metadata.ogLocale = prop("og:locale");
	metadata.ogVideo = prop("og:video");
	metadata.ogAudio = prop("og:audio");

	// --- Twitter Card ---
	metadata.twitterCard = meta("twitter:card");
	metadata.twitterSite = meta("twitter:site");
	metadata.twitterCreator = meta("twitter:creator");
	metadata.twitterTitle = meta("twitter:title");
	metadata.twitterDescription = meta("twitter:description");
	metadata.twitterImage = meta("twitter:image");
	metadata.twitterImageAlt = meta("twitter:image:alt");

	// --- Article ---
	metadata.articlePublishedTime = prop("article:published_time");
	metadata.articleModifiedTime = prop("article:modified_time");
	metadata.articleAuthor = prop("article:author");
	metadata.articleSection = prop("article:section");
	const articleTags: string[] = [];
	$('meta[property="article:tag"]').each((_, el) => {
		const content = $(el).attr("content");
		if (content) articleTags.push(content);
	});
	if (articleTags.length > 0) metadata.articleTags = articleTags;

	// --- Dublin Core ---
	metadata.dcTitle = meta("DC.title") ?? meta("dc.title");
	metadata.dcCreator = meta("DC.creator") ?? meta("dc.creator");
	metadata.dcSubject = meta("DC.subject") ?? meta("dc.subject");
	metadata.dcDescription = meta("DC.description") ?? meta("dc.description");
	metadata.dcDate = meta("DC.date") ?? meta("dc.date");
	metadata.dcType = meta("DC.type") ?? meta("dc.type");
	metadata.dcLanguage = meta("DC.language") ?? meta("dc.language");

	// --- JSON-LD ---
	const jsonLdScripts: unknown[] = [];
	$('script[type="application/ld+json"]').each((_, el) => {
		try {
			const text = $(el).text().trim();
			if (text) jsonLdScripts.push(JSON.parse(text));
		} catch {
			// malformed JSON-LD
		}
	});
	if (jsonLdScripts.length > 0) metadata.jsonLd = jsonLdScripts;

	// --- Misc ---
	metadata.contentType = httpEquiv("Content-Type");
	metadata.xUaCompatible = httpEquiv("X-UA-Compatible");
	metadata.publishedTime = metadata.articlePublishedTime ?? meta("date") ?? meta("pubdate") ?? null;
	metadata.modifiedTime = metadata.articleModifiedTime ?? meta("last-modified") ?? null;

	// Strip null values for cleaner output
	for (const key of Object.keys(metadata)) {
		if (metadata[key] === null) delete metadata[key];
	}

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
	return extractLinksWith(cheerio.load(html), baseUrl);
}

function extractLinksWith(
	$: CheerioAPI,
	baseUrl: string,
): {
	internal: Array<{ href: string; text: string; title: string; baseDomain: string }>;
	external: Array<{ href: string; text: string; title: string; baseDomain: string }>;
} {
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
	return extractMediaWith(cheerio.load(html), baseUrl);
}

function extractMediaWith($: CheerioAPI, baseUrl: string) {
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
