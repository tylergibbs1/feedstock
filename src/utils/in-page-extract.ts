/**
 * In-page extraction via page.evaluate().
 *
 * Extracts links, media, and metadata directly inside the browser
 * context, eliminating the HTML serialization + re-parsing round-trip.
 * Only works with Playwright engine (not FetchEngine).
 */

import type { Page } from "playwright";

export interface InPageExtractionResult {
	links: {
		internal: Array<{ href: string; text: string; title: string; baseDomain: string }>;
		external: Array<{ href: string; text: string; title: string; baseDomain: string }>;
	};
	media: {
		images: Array<{
			src: string;
			alt: string;
			desc: string;
			score: number;
			type: "image";
			groupId: number;
			format: string | null;
			width: number | null;
		}>;
		videos: Array<{
			src: string;
			alt: string;
			desc: string;
			score: number;
			type: "video";
			groupId: number;
			format: string | null;
			width: number | null;
		}>;
		audios: Array<{
			src: string;
			alt: string;
			desc: string;
			score: number;
			type: "audio";
			groupId: number;
			format: string | null;
			width: number | null;
		}>;
	};
	metadata: Record<string, unknown>;
}

/**
 * Run extraction inside the browser page context.
 * Single page.evaluate call — no HTML serialization needed.
 */
export async function extractInPage(page: Page): Promise<InPageExtractionResult> {
	return page.evaluate(() => {
		const baseDomain = window.location.hostname;

		// --- Links ---
		const internal: Array<{ href: string; text: string; title: string; baseDomain: string }> = [];
		const external: Array<{ href: string; text: string; title: string; baseDomain: string }> = [];

		document.querySelectorAll("a[href]").forEach((el) => {
			const a = el as HTMLAnchorElement;
			const href = a.href;
			if (
				!href ||
				href.startsWith("#") ||
				href.startsWith("javascript:") ||
				href.startsWith("mailto:")
			)
				return;

			const linkDomain = (() => {
				try {
					return new URL(href).hostname;
				} catch {
					return "";
				}
			})();

			const link = {
				href,
				text: a.textContent?.trim() ?? "",
				title: a.title?.trim() ?? "",
				baseDomain: linkDomain,
			};

			if (linkDomain === baseDomain) {
				internal.push(link);
			} else {
				external.push(link);
			}
		});

		// --- Images ---
		const images: InPageExtractionResult["media"]["images"] = [];
		document.querySelectorAll("img[src]").forEach((el) => {
			const img = el as HTMLImageElement;
			const src = img.src;
			if (!src) return;

			const alt = img.alt?.trim() ?? "";
			const width = img.width || null;

			let score = 0;
			if (alt) score += 3;
			if (width && width > 100) score += 2;
			if (width && width > 300) score += 3;

			const format = src.match(/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?|$)/i)?.[1] ?? null;

			images.push({ src, alt, desc: "", score, type: "image", groupId: 0, format, width });
		});

		// --- Videos ---
		const videos: InPageExtractionResult["media"]["videos"] = [];
		document.querySelectorAll("video source[src], video[src]").forEach((el) => {
			const src = (el as HTMLSourceElement).src || (el as HTMLVideoElement).src;
			if (src) {
				videos.push({
					src,
					alt: "",
					desc: "",
					score: 5,
					type: "video",
					groupId: 0,
					format: null,
					width: null,
				});
			}
		});

		// --- Audio ---
		const audios: InPageExtractionResult["media"]["audios"] = [];
		document.querySelectorAll("audio source[src], audio[src]").forEach((el) => {
			const src = (el as HTMLSourceElement).src || (el as HTMLAudioElement).src;
			if (src) {
				audios.push({
					src,
					alt: "",
					desc: "",
					score: 5,
					type: "audio",
					groupId: 0,
					format: null,
					width: null,
				});
			}
		});

		// --- Metadata ---
		const meta = (name: string) =>
			document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;
		const prop = (property: string) =>
			document.querySelector(`meta[property="${property}"]`)?.getAttribute("content") ?? null;

		const metadata: Record<string, unknown> = {};

		const title = document.title?.trim();
		if (title) metadata.title = title;

		const desc = meta("description") ?? prop("og:description");
		if (desc) metadata.description = desc;

		const keywords = meta("keywords");
		if (keywords) metadata.keywords = keywords;
		const author = meta("author");
		if (author) metadata.author = author;
		const lang = document.documentElement.lang;
		if (lang) metadata.language = lang;

		// OG
		const ogTitle = prop("og:title");
		if (ogTitle) metadata.ogTitle = ogTitle;
		const ogImage = prop("og:image");
		if (ogImage) metadata.ogImage = ogImage;
		const ogUrl = prop("og:url");
		if (ogUrl) metadata.ogUrl = ogUrl;
		const ogType = prop("og:type");
		if (ogType) metadata.ogType = ogType;
		const ogSiteName = prop("og:site_name");
		if (ogSiteName) metadata.ogSiteName = ogSiteName;

		// Canonical
		const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
		if (canonical) metadata.canonical = canonical;

		// JSON-LD
		const jsonLd: unknown[] = [];
		document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
			try {
				const text = el.textContent?.trim();
				if (text) jsonLd.push(JSON.parse(text));
			} catch {
				/* malformed */
			}
		});
		if (jsonLd.length > 0) metadata.jsonLd = jsonLd;

		return {
			links: { internal, external },
			media: { images, videos, audios },
			metadata,
		};
	});
}
