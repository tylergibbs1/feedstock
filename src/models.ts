/**
 * Core data models for Feedstock crawler results.
 */

// ---------------------------------------------------------------------------
// Media & Links
// ---------------------------------------------------------------------------

export interface MediaItem {
	src: string;
	alt: string;
	desc: string;
	score: number;
	type: "image" | "video" | "audio";
	groupId: number;
	format: string | null;
	width: number | null;
}

export interface LinkItem {
	href: string;
	text: string;
	title: string;
	baseDomain: string;
}

export interface Media {
	images: MediaItem[];
	videos: MediaItem[];
	audios: MediaItem[];
}

export interface Links {
	internal: LinkItem[];
	external: LinkItem[];
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export interface MarkdownGenerationResult {
	rawMarkdown: string;
	markdownWithCitations: string;
	referencesMarkdown: string;
	fitMarkdown: string | null;
}

// ---------------------------------------------------------------------------
// Scraping intermediate result
// ---------------------------------------------------------------------------

export interface ScrapingResult {
	cleanedHtml: string;
	success: boolean;
	media: Media;
	links: Links;
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Crawl response (from browser strategy)
// ---------------------------------------------------------------------------

export interface CrawlResponse {
	html: string;
	responseHeaders: Record<string, string>;
	statusCode: number;
	screenshot: string | null;
	pdfData: Buffer | null;
	redirectedUrl: string | null;
	networkRequests: NetworkRequest[] | null;
	consoleMessages: ConsoleMessage[] | null;
}

export interface NetworkRequest {
	url: string;
	method: string;
	status: number | null;
	resourceType: string;
	responseHeaders: Record<string, string> | null;
}

export interface ConsoleMessage {
	type: string;
	text: string;
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Final crawl result
// ---------------------------------------------------------------------------

export interface CrawlResult {
	url: string;
	html: string;
	success: boolean;
	cleanedHtml: string | null;
	media: Media;
	links: Links;
	markdown: MarkdownGenerationResult | null;
	extractedContent: string | null;
	metadata: Record<string, unknown> | null;
	errorMessage: string | null;
	statusCode: number | null;
	responseHeaders: Record<string, string> | null;
	screenshot: string | null;
	pdf: Buffer | null;
	redirectedUrl: string | null;
	networkRequests: NetworkRequest[] | null;
	consoleMessages: ConsoleMessage[] | null;
	sessionId: string | null;
	// Cache metadata
	cacheStatus: "hit" | "miss" | "bypass" | null;
	cachedAt: number | null;
}

export function createEmptyMedia(): Media {
	return { images: [], videos: [], audios: [] };
}

export function createEmptyLinks(): Links {
	return { internal: [], external: [] };
}

export function createErrorResult(url: string, error: string): CrawlResult {
	return {
		url,
		html: "",
		success: false,
		cleanedHtml: null,
		media: createEmptyMedia(),
		links: createEmptyLinks(),
		markdown: null,
		extractedContent: null,
		metadata: null,
		errorMessage: error,
		statusCode: null,
		responseHeaders: null,
		screenshot: null,
		pdf: null,
		redirectedUrl: null,
		networkRequests: null,
		consoleMessages: null,
		sessionId: null,
		cacheStatus: null,
		cachedAt: null,
	};
}
