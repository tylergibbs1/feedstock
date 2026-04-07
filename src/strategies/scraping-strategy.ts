import type { CrawlerRunConfig } from "../config";
import type { ScrapingResult } from "../models";
import { cleanHtml, extractLinks, extractMedia, extractMetadata } from "../utils/html";

/**
 * Abstract base for content scraping strategies.
 */
export abstract class ContentScrapingStrategy {
	abstract scrape(url: string, html: string, config: CrawlerRunConfig): ScrapingResult;
}

/**
 * Default scraping strategy using Cheerio for HTML parsing.
 * Extracts clean HTML, links, media, and metadata.
 */
export class CheerioScrapingStrategy extends ContentScrapingStrategy {
	scrape(url: string, html: string, config: CrawlerRunConfig): ScrapingResult {
		const cleanedHtml = cleanHtml(html, {
			excludeTags: config.excludeTags,
			includeTags: config.includeTags,
			cssSelector: config.cssSelector,
			removeOverlayElements: config.removeOverlayElements,
		});

		const links = extractLinks(html, url);
		const media = extractMedia(html, url);
		const metadata = extractMetadata(html);

		return {
			cleanedHtml,
			success: true,
			media: {
				images: media.images,
				videos: media.videos,
				audios: media.audios,
			},
			links: {
				internal: links.internal,
				external: links.external,
			},
			metadata,
		};
	}
}
