import { CrawlCache } from "./cache/database";
import { shouldReadCache, shouldWriteCache } from "./cache/mode";
import type { BrowserConfig, CrawlerRunConfig } from "./config";
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
import type { CrawlResult } from "./models";
import { createErrorResult } from "./models";
import { buildStaticSnapshot } from "./snapshot/accessibility";
import {
	type CrawlerStrategy,
	type HookFn,
	type HookType,
	PlaywrightCrawlerStrategy,
} from "./strategies/crawler-strategy";
import { type ExtractionStrategy, NoExtractionStrategy } from "./strategies/extraction/base";
import { type CssExtractionSchema, CssExtractionStrategy } from "./strategies/extraction/css";
import { RegexExtractionStrategy } from "./strategies/extraction/regex";
import { DefaultMarkdownGenerator, type MarkdownGenerationStrategy } from "./strategies/markdown";
import {
	CheerioScrapingStrategy,
	type ContentScrapingStrategy,
} from "./strategies/scraping-strategy";
import { toFriendlyError } from "./utils/errors";
import type { Logger } from "./utils/logger";
import { ConsoleLogger, SilentLogger } from "./utils/logger";

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
	verbose?: boolean;
	/**
	 * Enable the multi-engine system. When true, tries a lightweight
	 * HTTP fetch first and only launches a browser when needed
	 * (JS rendering, screenshots, etc). Default: true.
	 */
	useEngines?: boolean;
	engineConfig?: Partial<EngineManagerConfig>;
}

// ---------------------------------------------------------------------------
// WebCrawler
// ---------------------------------------------------------------------------

export class WebCrawler {
	private strategy: CrawlerStrategy | null;
	private engineManager: EngineManager | null;
	private scraper: ContentScrapingStrategy;
	private markdownGen: MarkdownGenerationStrategy;
	private cache: CrawlCache | null = null;
	private logger: Logger;
	private browserConfig: BrowserConfig;
	private ready = false;

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
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	async start(): Promise<void> {
		if (this.ready) return;
		if (this.engineManager) {
			await this.engineManager.start();
		} else if (this.strategy) {
			await this.strategy.start();
		}
		this.cache = new CrawlCache();
		this.ready = true;
		this.logger.info("Crawler started");
	}

	async close(): Promise<void> {
		if (!this.ready) return;
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

	// -------------------------------------------------------------------------
	// Hooks
	// -------------------------------------------------------------------------

	setHook(type: HookType, fn: HookFn): void {
		if (this.strategy) {
			this.strategy.setHook(type, fn);
		}
	}

	// -------------------------------------------------------------------------
	// Crawl
	// -------------------------------------------------------------------------

	async crawl(url: string, config?: Partial<CrawlerRunConfig>): Promise<CrawlResult> {
		if (!this.ready) {
			await this.start();
		}

		const runConfig = createCrawlerRunConfig(config);

		try {
			// Check cache
			if (shouldReadCache(runConfig.cacheMode) && this.cache) {
				const cached = this.cache.get(url);
				if (cached) {
					this.logger.debug(`Cache hit for ${url}`);
					const result: CrawlResult = JSON.parse(cached.result);
					result.cacheStatus = "hit";
					result.cachedAt = cached.cachedAt;
					return result;
				}
			}

			// Fetch page
			const response = this.engineManager
				? (await this.engineManager.fetch(url, runConfig)).response
				: await this.strategy!.crawl(url, runConfig);

			// Scrape content
			const scraped = this.scraper.scrape(url, response.html, runConfig);

			// Generate markdown
			let markdown = null;
			if (runConfig.generateMarkdown && scraped.success) {
				markdown = this.markdownGen.generate(url, scraped.cleanedHtml);
			}

			// Run extraction strategy
			let extractedContent: string | null = null;
			if (runConfig.extractionStrategy) {
				const strategy = this.resolveExtractionStrategy(runConfig.extractionStrategy);
				const items = await strategy.extract(url, scraped.cleanedHtml);
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
				metadata: scraped.metadata,
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
				interactiveElements: null,
				cacheStatus: "miss",
				cachedAt: null,
			};

			// Write to cache
			if (shouldWriteCache(runConfig.cacheMode) && this.cache) {
				this.cache.set(url, JSON.stringify(result));
			}

			return result;
		} catch (err) {
			const message = toFriendlyError(err);
			this.logger.error(`Crawl failed for ${url}: ${message}`);
			return createErrorResult(url, message);
		}
	}

	/**
	 * Crawl multiple URLs concurrently.
	 */
	async crawlMany(
		urls: string[],
		config?: Partial<CrawlerRunConfig>,
		opts: { concurrency?: number } = {},
	): Promise<CrawlResult[]> {
		if (!this.ready) {
			await this.start();
		}

		const concurrency = opts.concurrency ?? 5;
		const results: CrawlResult[] = [];
		const queue = [...urls];

		const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
			while (queue.length > 0) {
				const url = queue.shift()!;
				const result = await this.crawl(url, config);
				results.push(result);
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
		config?: Partial<CrawlerRunConfig>,
		url = "raw:",
	): Promise<CrawlResult> {
		const runConfig = createCrawlerRunConfig(config);

		const scraped = this.scraper.scrape(url, html, runConfig);

		let markdown = null;
		if (runConfig.generateMarkdown && scraped.success) {
			markdown = this.markdownGen.generate(url, scraped.cleanedHtml);
		}

		let extractedContent: string | null = null;
		if (runConfig.extractionStrategy) {
			const strategy = this.resolveExtractionStrategy(runConfig.extractionStrategy);
			const items = await strategy.extract(url, scraped.cleanedHtml);
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
			interactiveElements: null,
			cacheStatus: null,
			cachedAt: null,
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
		crawlConfig?: Partial<CrawlerRunConfig>,
		deepConfig?: Partial<DeepCrawlConfig>,
	): Promise<CrawlResult[]> {
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
		crawlConfig?: Partial<CrawlerRunConfig>,
		deepConfig?: Partial<DeepCrawlConfig>,
	): AsyncGenerator<CrawlResult, void, unknown> {
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

	private resolveExtractionStrategy(config: {
		type: string;
		params: Record<string, unknown>;
	}): ExtractionStrategy {
		switch (config.type) {
			case "css":
				return new CssExtractionStrategy(config.params as unknown as CssExtractionSchema);
			case "regex":
				return new RegexExtractionStrategy(config.params.patterns as (string | RegExp)[]);
			default:
				return new NoExtractionStrategy();
		}
	}
}
