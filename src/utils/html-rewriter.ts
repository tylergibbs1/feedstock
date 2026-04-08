/**
 * Bun-native HTMLRewriter-based extraction.
 * Streaming parser — no DOM tree allocation.
 * Replaces Cheerio for link, media, and metadata extraction in the hot path.
 */

type LinkData = { href: string; text: string; title: string; baseDomain: string };
type MediaData = {
	src: string;
	alt: string;
	desc: string;
	score: number;
	type: "image" | "video" | "audio";
	groupId: number;
	format: string | null;
	width: number | null;
};

/**
 * Extract links, media, and metadata from HTML using Bun's HTMLRewriter.
 * Single streaming pass — no DOM tree built.
 */
export function extractAllStreaming(html: string, baseUrl: string) {
	const internal: LinkData[] = [];
	const external: LinkData[] = [];
	const images: MediaData[] = [];
	const videos: MediaData[] = [];
	const audios: MediaData[] = [];
	const metadata: Record<string, unknown> = {};

	let baseDomain = "";
	try {
		baseDomain = new URL(baseUrl).hostname;
	} catch {}

	let titleText = "";
	let inTitle = false;

	// Collect JSON-LD scripts
	const jsonLdScripts: unknown[] = [];
	let inJsonLd = false;
	let jsonLdBuffer = "";

	// Collect article tags
	const articleTags: string[] = [];

	// Collect alternates, feeds, favicons
	const alternates: Array<{ href: string; hreflang?: string; type?: string }> = [];
	const feeds: Array<{ href: string; type: string; title?: string }> = [];
	const favicons: Array<{ href: string; sizes?: string; type?: string }> = [];

	let currentLinkText = "";
	let currentLinkHref = "";
	let currentLinkTitle = "";
	let inLink = false;

	const rewriter = new HTMLRewriter()
		// Title
		.on("title", {
			text(t) {
				titleText += t.text;
			},
		})
		// Meta tags
		.on("meta", {
			element(el) {
				const name = (el.getAttribute("name") ?? "").toLowerCase();
				const property = (el.getAttribute("property") ?? "").toLowerCase();
				const httpEquiv = (el.getAttribute("http-equiv") ?? "").toLowerCase();
				const content = el.getAttribute("content") ?? "";

				if (!content && !el.getAttribute("charset")) return;

				// Charset
				const charset = el.getAttribute("charset");
				if (charset) metadata.charset = charset;

				// Standard meta
				if (name === "description") metadata.description = content;
				else if (name === "keywords") metadata.keywords = content;
				else if (name === "author") metadata.author = content;
				else if (name === "generator") metadata.generator = content;
				else if (name === "viewport") metadata.viewport = content;
				else if (name === "theme-color") metadata.themeColor = content;
				else if (name === "robots") metadata.robots = content;
				else if (name === "googlebot") metadata.googlebot = content;
				else if (name === "referrer") metadata.referrer = content;

				// OG
				else if (property === "og:title") metadata.ogTitle = content;
				else if (property === "og:description") {
					metadata.ogDescription = content;
					if (!metadata.description) metadata.description = content;
				} else if (property === "og:image") metadata.ogImage = content;
				else if (property === "og:image:width") metadata.ogImageWidth = content;
				else if (property === "og:image:height") metadata.ogImageHeight = content;
				else if (property === "og:url") metadata.ogUrl = content;
				else if (property === "og:type") metadata.ogType = content;
				else if (property === "og:site_name") metadata.ogSiteName = content;
				else if (property === "og:locale") metadata.ogLocale = content;

				// Twitter
				else if (name === "twitter:card") metadata.twitterCard = content;
				else if (name === "twitter:site") metadata.twitterSite = content;
				else if (name === "twitter:creator") metadata.twitterCreator = content;
				else if (name === "twitter:title") metadata.twitterTitle = content;
				else if (name === "twitter:image") metadata.twitterImage = content;

				// Article
				else if (property === "article:published_time") metadata.articlePublishedTime = content;
				else if (property === "article:modified_time") metadata.articleModifiedTime = content;
				else if (property === "article:author") metadata.articleAuthor = content;
				else if (property === "article:section") metadata.articleSection = content;
				else if (property === "article:tag") articleTags.push(content);

				// Dublin Core
				else if (name === "dc.title" || name === "dc:title") metadata.dcTitle = content;
				else if (name === "dc.creator" || name === "dc:creator") metadata.dcCreator = content;

				// HTTP-Equiv
				if (httpEquiv === "content-language" && !metadata.language) metadata.language = content;
			},
		})
		// HTML lang
		.on("html", {
			element(el) {
				const lang = el.getAttribute("lang");
				if (lang) metadata.language = lang;
			},
		})
		// Links (<a>)
		.on("a[href]", {
			element(el) {
				currentLinkHref = el.getAttribute("href") ?? "";
				currentLinkTitle = el.getAttribute("title") ?? "";
				currentLinkText = "";
				inLink = true;
			},
			text(t) {
				if (inLink) currentLinkText += t.text;
				if (t.lastInTextNode) {
					inLink = false;
					processLink();
				}
			},
		})
		// Canonical + alternates + feeds + favicons
		.on("link", {
			element(el) {
				const rel = (el.getAttribute("rel") ?? "").toLowerCase();
				const href = el.getAttribute("href") ?? "";
				if (!href) return;

				if (rel === "canonical") metadata.canonical = href;
				else if (rel === "amphtml") metadata.amphtml = href;
				else if (rel === "alternate") {
					const type = el.getAttribute("type") ?? "";
					if (type.includes("rss") || type.includes("atom")) {
						feeds.push({ href, type, title: el.getAttribute("title") ?? undefined });
					} else {
						alternates.push({
							href,
							hreflang: el.getAttribute("hreflang") ?? undefined,
							type: type || undefined,
						});
					}
				} else if (rel === "icon" || rel === "shortcut icon" || rel === "apple-touch-icon") {
					favicons.push({
						href,
						sizes: el.getAttribute("sizes") ?? undefined,
						type: el.getAttribute("type") ?? undefined,
					});
				}
			},
		})
		// Images
		.on("img[src]", {
			element(el) {
				const src = el.getAttribute("src") ?? "";
				if (!src) return;

				let absoluteSrc: string;
				try {
					absoluteSrc = new URL(src, baseUrl).href;
				} catch {
					absoluteSrc = src;
				}

				const alt = el.getAttribute("alt")?.trim() ?? "";
				const widthAttr = el.getAttribute("width");
				const width = widthAttr ? parseInt(widthAttr, 10) || null : null;

				let score = 0;
				if (alt) score += 3;
				if (width && width > 100) score += 2;
				if (width && width > 300) score += 3;

				const format =
					absoluteSrc.match(/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?|$)/i)?.[1] ?? null;

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
			},
		})
		// Video
		.on("video source[src], video[src]", {
			element(el) {
				const src = el.getAttribute("src") ?? "";
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
			},
		})
		// Audio
		.on("audio source[src], audio[src]", {
			element(el) {
				const src = el.getAttribute("src") ?? "";
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
			},
		})
		// JSON-LD
		.on('script[type="application/ld+json"]', {
			element() {
				inJsonLd = true;
				jsonLdBuffer = "";
			},
			text(t) {
				if (inJsonLd) {
					jsonLdBuffer += t.text;
					if (t.lastInTextNode) {
						inJsonLd = false;
						try {
							jsonLdScripts.push(JSON.parse(jsonLdBuffer.trim()));
						} catch {
							// malformed
						}
					}
				}
			},
		});

	function processLink() {
		const href = currentLinkHref;
		if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:"))
			return;

		let absoluteUrl: string;
		try {
			absoluteUrl = new URL(href, baseUrl).href;
		} catch {
			return;
		}

		const text = currentLinkText.trim();
		let linkDomain: string;
		try {
			linkDomain = new URL(absoluteUrl).hostname;
		} catch {
			linkDomain = "";
		}

		const link: LinkData = { href: absoluteUrl, text, title: currentLinkTitle.trim(), baseDomain: linkDomain };

		if (linkDomain === baseDomain) {
			internal.push(link);
		} else {
			external.push(link);
		}
	}

	// Run the streaming parse
	rewriter.transform(html);

	// Handle any remaining link (edge case: link at end of document)
	if (inLink) {
		inLink = false;
		processLink();
	}

	// Finalize metadata
	if (titleText) metadata.title = titleText.trim();
	if (articleTags.length > 0) metadata.articleTags = articleTags;
	if (alternates.length > 0) metadata.alternates = alternates;
	if (feeds.length > 0) metadata.feeds = feeds;
	if (favicons.length > 0) metadata.favicons = favicons;
	if (jsonLdScripts.length > 0) metadata.jsonLd = jsonLdScripts;

	metadata.publishedTime = metadata.articlePublishedTime ?? null;
	metadata.modifiedTime = metadata.articleModifiedTime ?? null;

	// Strip null values
	for (const key of Object.keys(metadata)) {
		if (metadata[key] === null || metadata[key] === undefined) delete metadata[key];
	}

	return {
		links: { internal, external },
		media: { images, videos, audios },
		metadata,
	};
}
