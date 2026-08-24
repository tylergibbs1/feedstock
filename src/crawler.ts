import { join } from "node:path";
import { CrawlCache, contentHash } from "./cache/database";
import { shouldReadCache, shouldWriteCache } from "./cache/mode";
import type { BrowserConfig, CrawlerRunConfig, CrawlerRunConfigOverrides } from "./config";
import { createBrowserConfig, createCrawlerRunConfig } from "./config";
import type { DeepCrawlConfig, DeepCrawlStrategy } from "./deep-crawl/strategy";
import {
	BestFirstDeepCrawlStrategy,
	BFSDeepCrawlStrategy,
	createDeepCrawlConfig,
} from "./deep-crawl/strategy";
import type { EngineManagerConfig } from "./engines/engine-manager";
import { EngineManager } from "./engines/engine-manager";
import { FetchEngine } from "./engines/fetch";
import { PlaywrightEngine } from "./engines/playwright";
import type { CrawlResponse, CrawlResult, ScrapeDocument, ScrapeFormat } from "./models";
import { createErrorResult } from "./models";
import { buildStaticSnapshot } from "./snapshot/accessibility";
import {
	type CrawlerStrategy,
	type HookFn,
	type HookType,
	PlaywrightCrawlerStrategy,
} from "./strategies/crawler-strategy";
import {
	type AccessibilityExtractionConfig,
	AccessibilityExtractionStrategy,
} from "./strategies/extraction/accessibility";
import { type ExtractionStrategy, NoExtractionStrategy } from "./strategies/extraction/base";
import { type CssExtractionSchema, CssExtractionStrategy } from "./strategies/extraction/css";
import { RegexExtractionStrategy } from "./strategies/extraction/regex";
import { DefaultMarkdownGenerator, type MarkdownGenerationStrategy } from "./strategies/markdown";
import {
	CheerioScrapingStrategy,
	type ContentScrapingStrategy,
} from "./strategies/scraping-strategy";
import { toFriendlyError } from "./utils/errors";
import { detectInteractiveElementsStatic } from "./utils/interactive-static";
import type { Logger } from "./utils/logger";
import { ConsoleLogger, SilentLogger } from "./utils/logger";
import { isSameDomain, normalizeUrl, stableStringify } from "./utils/url";
import { URLSeeder } from "./utils/url-seeder";

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface WebCrawlerOptions {
	config?: Partial<BrowserConfig>;
	crawlerStrategy?: CrawlerStrategy;
	scrapingStrategy?: ContentScrapingStrategy;
	markdownGenerator?: MarkdownGenerationStrategy;
	logger?: Logger;
	cacheDir?: string;
	/** Explicit SQLite cache path. Takes precedence over cacheDir. */
	cachePath?: string;
	verbose?: boolean;
	/**
	 * Enable the multi-engine system. When true, tries a lightweight
	 * HTTP fetch first and only launches a browser when needed
	 * (JS rendering, screenshots, etc). Default: true.
	 */
	useEngines?: boolean;
	engineConfig?: Partial<EngineManagerConfig>;
}

export type ScrapeOptions = CrawlerRunConfigOverrides & { formats?: ScrapeFormat[] };

export interface MapOptions {
	limit?: number;
	sitemap?: "include" | "skip" | "only";
	includeSubdomains?: boolean;
	ignoreQueryParameters?: boolean;
	includePageLinks?: boolean;
	timeout?: number;
	signal?: AbortSignal;
}

export interface MapLink {
	url: string;
	title?: string;
	description?: string;
}

export interface MapResult {
	links: MapLink[];
	sitemaps: string[];
}

// ---------------------------------------------------------------------------
// WebCrawler
// ---------------------------------------------------------------------------

/**
 * Main entry point for feedstock. Manages browser lifecycle, caching,
 * scraping, and extraction.
 *
 * @example
 * ```ts
 * const crawler = new WebCrawler();
 * const result = await crawler.crawl("https://example.com");
 * console.log(result.markdown?.rawMarkdown);
 * await crawler.close();
 * ```
 *
 * @example
 * ```ts
 * // With configuration
 * const crawler = new WebCrawler({
 *   config: { headless: true, browserType: "chromium" },
 *   verbose: true,
 * });
 * ```
 */
export class WebCrawler {
	private strategy: CrawlerStrategy | null;
	private engineManager: EngineManager | null;
	private scraper: ContentScrapingStrategy;
	private markdownGen: MarkdownGenerationStrategy;
	private cache: CrawlCache | null = null;
	private logger: Logger;
	private browserConfig: BrowserConfig;
	private ready = false;
	private startPromise: Promise<void> | null = null;
	private shutdownHandler: (() => void) | null = null;
	private cachePath: string | undefined;

	constructor(opts: WebCrawlerOptions = {}) {
		const verbose = opts.verbose ?? false;
		this.logger =
			opts.logger ?? (verbose ? new ConsoleLogger({ level: "debug" }) : new SilentLogger());

		this.browserConfig = createBrowserConfig({
			...opts.config,
			logger: this.logger,
			verbose,
		});

		const useEngines = opts.useEngines ?? true;

		if (useEngines && !opts.crawlerStrategy) {
			this.strategy = null;
			this.engineManager = new EngineManager(
				[new FetchEngine(), new PlaywrightEngine(this.browserConfig)],
				{ config: opts.engineConfig, logger: this.logger },
			);
		} else {
			this.strategy = opts.crawlerStrategy ?? new PlaywrightCrawlerStrategy(this.browserConfig);
			this.engineManager = null;
		}

		this.scraper = opts.scrapingStrategy ?? new CheerioScrapingStrategy();
		this.markdownGen = opts.markdownGenerator ?? new DefaultMarkdownGenerator();
		this.cachePath =
			opts.cachePath ?? (opts.cacheDir ? join(opts.cacheDir, "cache.db") : undefined);
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	async start(): Promise<void> {
		if (this.ready) return;
		if (this.startPromise) return this.startPromise;
		this.startPromise = this.initialize();
		try {
			await this.startPromise;
		} finally {
			this.startPromise = null;
		}
	}

	private async initialize(): Promise<void> {
		if (this.engineManager) await this.engineManager.start();
		else if (this.strategy) await this.strategy.start();

		this.shutdownHandler = () => {
			this.close().catch(() => {});
		};
		process.on("SIGINT", this.shutdownHandler);
		process.on("SIGTERM", this.shutdownHandler);
		this.ready = true;
		this.logger.info("Crawler started");
	}

	async close(): Promise<void> {
		if (this.startPromise) await this.startPromise.catch(() => {});
		if (!this.ready) return;

		// Remove shutdown handlers
		if (this.shutdownHandler) {
			process.removeListener("SIGINT", this.shutdownHandler);
			process.removeListener("SIGTERM", this.shutdownHandler);
			this.shutdownHandler = null;
		}

		if (this.engineManager) {
			await this.engineManager.close();
		} else if (this.strategy) {
			await this.strategy.close();
		}
		this.cache?.close();
		this.cache = null;
		this.ready = false;
		this.logger.info("Crawler closed");
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}

	// -------------------------------------------------------------------------
	// Hooks
	// -------------------------------------------------------------------------

	setHook(type: HookType, fn: HookFn): void {
		if (this.engineManager) {
			this.engineManager.setHook(type, fn);
		} else if (this.strategy) {
			this.strategy.setHook(type, fn);
		}
	}

	// -------------------------------------------------------------------------
	// Crawl
	// -------------------------------------------------------------------------

	async crawl(url: string, config?: CrawlerRunConfigOverrides): Promise<CrawlResult> {
		const totalStart = Date.now();
		try {
			validateUrl(url);
		} catch (err) {
			return createErrorResult(url ?? "", toFriendlyError(err));
		}

		const runConfig = createCrawlerRunConfig(config);
		try {
			runConfig.signal?.throwIfAborted();
			if (!this.ready) await this.start();
		} catch (err) {
			return createErrorResult(url, toFriendlyError(err));
		}

		try {
			const cacheKey = this.buildCacheKey(url, runConfig);
			const usesCache =
				shouldReadCache(runConfig.cacheMode) || shouldWriteCache(runConfig.cacheMode);
			const cache = usesCache ? this.getCache() : null;

			// Check cache
			if (shouldReadCache(runConfig.cacheMode) && cache) {
				const cached = cache.get(cacheKey);
				if (cached) {
					const ageMs = Date.now() - cached.cachedAt * 1000;
					if (
						runConfig.cacheMaxAgeMs !== 0 &&
						(runConfig.cacheMaxAgeMs === null || ageMs <= runConfig.cacheMaxAgeMs)
					) {
						this.logger.debug(`Cache hit for ${url}`);
						const result = deserializeResult(cached.result);
						result.cacheStatus = "hit";
						result.cachedAt = cached.cachedAt;
						result.timings = { fetchMs: 0, totalMs: Date.now() - totalStart };
						return result;
					}
					cache.delete(cacheKey);
				}
			}

			const fetchStart = Date.now();
			let engine = "custom";
			let fetchMs = 0;
			let response: CrawlResponse;
			if (this.engineManager) {
				const fetched = await this.engineManager.fetch(url, runConfig);
				response = fetched.response;
				engine = fetched.engine;
				fetchMs = fetched.durationMs;
			} else {
				response = await this.strategy!.crawl(url, runConfig);
				fetchMs = Date.now() - fetchStart;
			}

			const finalUrl = response.redirectedUrl ?? url;
			const scraped = this.scraper.scrape(finalUrl, response.html, runConfig);
			const metadata = {
				...scraped.metadata,
				sourceURL: url,
				url: finalUrl,
				statusCode: response.statusCode,
				contentType: response.responseHeaders["content-type"] ?? scraped.metadata.contentType,
				engine,
			};

			let markdown = null;
			if (runConfig.generateMarkdown && scraped.success) {
				markdown = this.markdownGen.generate(finalUrl, scraped.cleanedHtml, {
					contentFilter: runConfig.contentFilter,
				});
			}

			// Run extraction strategy
			let extractedContent: string | null = null;
			if (runConfig.extractionStrategy) {
				const strategy = this.resolveExtractionStrategy(runConfig.extractionStrategy);
				const extractionHtml =
					runConfig.wordCountThreshold > 0
						? this.scraper.scrape(finalUrl, response.html, {
								...runConfig,
								wordCountThreshold: 0,
							}).cleanedHtml
						: scraped.cleanedHtml;
				const items = await strategy.extract(finalUrl, extractionHtml);
				extractedContent = JSON.stringify(items);
			}

			// Generate snapshot (static — works with any engine)
			let snapshot: string | null = null;
			if (runConfig.snapshot) {
				const snap = buildStaticSnapshot(response.html);
				snapshot = snap.text;
			}

			const result: CrawlResult = {
				url,
				html: response.html,
				success: true,
				cleanedHtml: scraped.cleanedHtml,
				media: scraped.media,
				links: scraped.links,
				markdown,
				extractedContent,
				metadata,
				errorMessage: null,
				statusCode: response.statusCode,
				responseHeaders: response.responseHeaders,
				screenshot: response.screenshot,
				pdf: response.pdfData,
				redirectedUrl: response.redirectedUrl,
				networkRequests: response.networkRequests,
				consoleMessages: response.consoleMessages,
				sessionId: runConfig.sessionId,
				snapshot,
				interactiveElements:
					response.interactiveElements ??
					(runConfig.detectInteractiveElements
						? detectInteractiveElementsStatic(response.html)
						: null),
				cacheStatus: "miss",
				cachedAt: null,
				engine,
				timings: { fetchMs, totalMs: Date.now() - totalStart },
				actions: response.actions ?? null,
			};

			// Write to cache
			if (shouldWriteCache(runConfig.cacheMode) && cache) {
				cache.set(cacheKey, JSON.stringify(result), {
					contentHash: contentHash(result.cleanedHtml ?? result.html),
					etag: response.responseHeaders.etag,
					lastModified: response.responseHeaders["last-modified"],
				});
			}

			return result;
		} catch (err) {
			const message = toFriendlyError(err);
			this.logger.error(`Crawl failed for ${url}: ${message}`);
			const result = createErrorResult(url, message);
			result.timings = { fetchMs: 0, totalMs: Date.now() - totalStart };
			return result;
		}
	}

	/**
	 * Firecrawl-style format-driven scraping. Markdown is the default and main
	 * content/base64 cleanup are enabled unless explicitly overridden.
	 */
	async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeDocument> {
		const { formats = ["markdown"], ...overrides } = options;
		const uniqueFormats = [...new Set(formats)];
		const result = await this.crawl(url, {
			...overrides,
			onlyMainContent: overrides.onlyMainContent ?? true,
			removeBase64Images: overrides.removeBase64Images ?? true,
			generateMarkdown: uniqueFormats.includes("markdown"),
			screenshot: uniqueFormats.includes("screenshot"),
			pdf: uniqueFormats.includes("pdf"),
			snapshot: uniqueFormats.includes("snapshot"),
		});

		const document: ScrapeDocument = {
			url: result.redirectedUrl ?? result.url,
			success: result.success,
			statusCode: result.statusCode,
			error: result.errorMessage,
			metadata: result.metadata,
			actions: result.actions ?? null,
			cacheStatus: result.cacheStatus,
		};
		if (uniqueFormats.includes("markdown")) {
			document.markdown = result.markdown?.fitMarkdown ?? result.markdown?.rawMarkdown ?? "";
		}
		if (uniqueFormats.includes("html")) document.html = result.cleanedHtml ?? "";
		if (uniqueFormats.includes("rawHtml")) document.rawHtml = result.html;
		if (uniqueFormats.includes("links")) {
			document.links = [...result.links.internal, ...result.links.external].map(
				(link) => link.href,
			);
		}
		if (uniqueFormats.includes("images")) {
			document.images = result.media.images.map((image) => image.src);
		}
		if (uniqueFormats.includes("screenshot")) document.screenshot = result.screenshot;
		if (uniqueFormats.includes("pdf")) document.pdf = result.pdf;
		if (uniqueFormats.includes("snapshot")) document.snapshot = result.snapshot;
		if (uniqueFormats.includes("json")) {
			if (result.extractedContent) document.json = parseExtractedContent(result.extractedContent);
			else {
				document.json = null;
				document.warnings = [
					'The "json" format requires an extractionStrategy; no structured data was produced.',
				];
			}
		}
		return document;
	}

	/** Discover a site's URL surface from robots/sitemaps and the start page. */
	async map(startUrl: string, options: MapOptions = {}): Promise<MapResult> {
		validateUrl(startUrl);
		options.signal?.throwIfAborted();
		const limit = Math.max(1, Math.floor(options.limit ?? 5_000));
		const sitemapMode = options.sitemap ?? "include";
		const links = new Map<string, MapLink>();
		const sitemaps: string[] = [];
		const add = (candidate: string, details: Omit<MapLink, "url"> = {}) => {
			if (links.size >= limit) return;
			const normalized = normalizeUrl(candidate, startUrl, {
				ignoreQueryParameters: options.ignoreQueryParameters,
			});
			if (!normalized || !isSameDomain(normalized, startUrl, options.includeSubdomains)) return;
			if (!links.has(normalized)) links.set(normalized, { url: normalized, ...details });
		};

		if (sitemapMode !== "skip") {
			const seeded = await new URLSeeder({
				timeout: options.timeout,
				maxUrls: limit,
				signal: options.signal,
			}).seed(startUrl);
			sitemaps.push(...seeded.sitemaps);
			for (const url of seeded.urls) add(url);
		}

		if (sitemapMode !== "only" && (options.includePageLinks ?? true) && links.size < limit) {
			const result = await this.crawl(startUrl, {
				generateMarkdown: false,
				wordCountThreshold: 0,
				signal: options.signal ?? null,
			});
			add(result.redirectedUrl ?? result.url, {
				title: typeof result.metadata?.title === "string" ? result.metadata.title : undefined,
				description:
					typeof result.metadata?.description === "string"
						? result.metadata.description
						: undefined,
			});
			for (const link of result.links.internal) add(link.href, { title: link.text || undefined });
		}

		return { links: [...links.values()], sitemaps: [...new Set(sitemaps)] };
	}

	/**
	 * Crawl multiple URLs concurrently.
	 */
	async crawlMany(
		urls: string[],
		config?: CrawlerRunConfigOverrides,
		opts: {
			concurrency?: number;
			signal?: AbortSignal;
			onProgress?: (result: CrawlResult, index: number, completed: number, total: number) => void;
		} = {},
	): Promise<CrawlResult[]> {
		if (!this.ready) {
			await this.start();
		}

		const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 5));
		const results = new Array<CrawlResult>(urls.length);
		let nextIndex = 0;
		let completed = 0;
		const crawlConfig = { ...config, signal: opts.signal ?? config?.signal ?? null };

		const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
			while (nextIndex < urls.length) {
				const index = nextIndex++;
				const result = await this.crawl(urls[index], crawlConfig);
				results[index] = result;
				completed++;
				opts.onProgress?.(result, index, completed, urls.length);
			}
		});

		await Promise.all(workers);
		return results;
	}

	/**
	 * Process raw HTML without browser navigation.
	 */
	async processHtml(
		html: string,
		config?: CrawlerRunConfigOverrides,
		url = "raw:",
	): Promise<CrawlResult> {
		const runConfig = createCrawlerRunConfig(config);

		const scraped = this.scraper.scrape(url, html, runConfig);

		let markdown = null;
		if (runConfig.generateMarkdown && scraped.success) {
			markdown = this.markdownGen.generate(url, scraped.cleanedHtml, {
				contentFilter: runConfig.contentFilter,
			});
		}

		let extractedContent: string | null = null;
		if (runConfig.extractionStrategy) {
			const strategy = this.resolveExtractionStrategy(runConfig.extractionStrategy);
			const extractionHtml =
				runConfig.wordCountThreshold > 0
					? this.scraper.scrape(url, html, {
							...runConfig,
							wordCountThreshold: 0,
						}).cleanedHtml
					: scraped.cleanedHtml;
			const items = await strategy.extract(url, extractionHtml);
			extractedContent = JSON.stringify(items);
		}

		return {
			url,
			html,
			success: true,
			cleanedHtml: scraped.cleanedHtml,
			media: scraped.media,
			links: scraped.links,
			markdown,
			extractedContent,
			metadata: scraped.metadata,
			errorMessage: null,
			statusCode: null,
			responseHeaders: null,
			screenshot: null,
			pdf: null,
			redirectedUrl: null,
			networkRequests: null,
			consoleMessages: null,
			sessionId: null,
			snapshot: runConfig.snapshot ? buildStaticSnapshot(html).text : null,
			interactiveElements: runConfig.detectInteractiveElements
				? detectInteractiveElementsStatic(html)
				: null,
			cacheStatus: null,
			cachedAt: null,
			engine: "process",
			timings: { fetchMs: 0, totalMs: 0 },
			actions: null,
		};
	}

	// -------------------------------------------------------------------------
	// Deep Crawl
	// -------------------------------------------------------------------------

	/**
	 * Deep crawl starting from a URL, following links recursively.
	 */
	async deepCrawl(
		startUrl: string,
		crawlConfig?: CrawlerRunConfigOverrides,
		deepConfig?: Partial<DeepCrawlConfig>,
	): Promise<CrawlResult[]> {
		validateUrl(startUrl);
		if (!this.ready) await this.start();

		const config = createDeepCrawlConfig({
			logger: this.logger,
			...deepConfig,
		});
		const strategy = this.resolveDeepCrawlStrategy(config);
		return strategy.run(startUrl, this, crawlConfig ?? {}, config);
	}

	/**
	 * Deep crawl with streaming — yields results as pages are crawled.
	 */
	async *deepCrawlStream(
		startUrl: string,
		crawlConfig?: CrawlerRunConfigOverrides,
		deepConfig?: Partial<DeepCrawlConfig>,
	): AsyncGenerator<CrawlResult, void, unknown> {
		validateUrl(startUrl);
		if (!this.ready) await this.start();

		const config = createDeepCrawlConfig({
			logger: this.logger,
			...deepConfig,
		});
		const strategy = this.resolveDeepCrawlStrategy(config);
		yield* strategy.stream(startUrl, this, crawlConfig ?? {}, config);
	}

	private resolveDeepCrawlStrategy(config: DeepCrawlConfig): DeepCrawlStrategy {
		if (config.scorer) return new BestFirstDeepCrawlStrategy();
		return new BFSDeepCrawlStrategy();
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private getCache(): CrawlCache {
		if (!this.cache) this.cache = new CrawlCache(this.cachePath);
		return this.cache;
	}

	private buildCacheKey(url: string, config: CrawlerRunConfig): string {
		const {
			cacheMode: _cacheMode,
			cacheMaxAgeMs: _cacheMaxAgeMs,
			signal: _signal,
			...identity
		} = config;
		const normalizedUrl =
			normalizeUrl(url, undefined, {
				removeTrackingParameters: false,
				sortQueryParameters: false,
				stripTrailingSlash: false,
			}) ?? url;
		return `${normalizedUrl}::v2:${contentHash(stableStringify(identity))}`;
	}

	private resolveExtractionStrategy(config: {
		type: string;
		params: Record<string, unknown>;
	}): ExtractionStrategy {
		switch (config.type) {
			case "css":
				return new CssExtractionStrategy(config.params as unknown as CssExtractionSchema);
			case "regex":
				return new RegexExtractionStrategy(config.params.patterns as (string | RegExp)[]);
			case "accessibility":
				return new AccessibilityExtractionStrategy(
					config.params as unknown as AccessibilityExtractionConfig,
				);
			default:
				return new NoExtractionStrategy();
		}
	}
}

function deserializeResult(serialized: string): CrawlResult {
	return JSON.parse(serialized, (_key, value: unknown) => {
		if (
			value &&
			typeof value === "object" &&
			(value as { type?: string }).type === "Buffer" &&
			Array.isArray((value as { data?: unknown }).data)
		) {
			return Buffer.from((value as { data: number[] }).data);
		}
		return value;
	}) as CrawlResult;
}

function parseExtractedContent(content: string): unknown {
	try {
		const parsed = JSON.parse(content) as unknown;
		if (!Array.isArray(parsed)) return parsed;
		return parsed.map((item) => {
			if (!item || typeof item !== "object" || typeof item.content !== "string") return item;
			try {
				return JSON.parse(item.content);
			} catch {
				return item.content;
			}
		});
	} catch {
		return content;
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateUrl(url: string): void {
	if (!url || typeof url !== "string") {
		throw new Error("URL must be a non-empty string");
	}
	if (url === "raw:") return; // processHtml sentinel
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("unsupported protocol");
		}
	} catch {
		throw new Error(
			`Invalid URL: "${url}". Must be a valid absolute URL (e.g., https://example.com)`,
		);
	}
}
