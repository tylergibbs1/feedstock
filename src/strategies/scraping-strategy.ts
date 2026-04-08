import type { CrawlerRunConfig } from "../config";
import type { ScrapingResult } from "../models";
import { scrapeAll } from "../utils/html";

/**
 * Abstract base for content scraping strategies.
 */
export abstract class ContentScrapingStrategy {
	abstract scrape(url: string, html: string, config: CrawlerRunConfig): ScrapingResult;
}

/**
 * Default scraping strategy using Cheerio for HTML parsing.
 * Parses HTML once and extracts clean HTML, links, media, and metadata in a single pass.
 */
export class CheerioScrapingStrategy extends ContentScrapingStrategy {
	scrape(url: string, html: string, config: CrawlerRunConfig): ScrapingResult {
		const { cleanedHtml, links, media, metadata } = scrapeAll(html, url, {
			excludeTags: config.excludeTags,
			includeTags: config.includeTags,
			cssSelector: config.cssSelector,
			removeOverlayElements: config.removeOverlayElements,
		});

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
