/**
 * Playwright engine — full browser automation.
 * Handles JS rendering, screenshots, PDFs, custom JS, wait conditions.
 */

import type { BrowserConfig, CrawlerRunConfig } from "../config";
import type { CrawlResponse } from "../models";
import { PlaywrightCrawlerStrategy } from "../strategies/crawler-strategy";
import { Engine, type EngineCapabilities } from "./base";

export class PlaywrightEngine extends Engine {
	readonly name = "playwright";
	readonly quality = 50;
	readonly capabilities: EngineCapabilities = {
		javascript: true,
		screenshot: true,
		pdf: true,
		networkRequests: true,
		consoleMessages: true,
		waitConditions: true,
		customJs: true,
	};

	private strategy: PlaywrightCrawlerStrategy;
	private started = false;

	constructor(config: BrowserConfig) {
		super();
		this.strategy = new PlaywrightCrawlerStrategy(config);
	}

	async start(): Promise<void> {
		if (this.started) return;
		await this.strategy.start();
		this.started = true;
	}

	async close(): Promise<void> {
		if (!this.started) return;
		await this.strategy.close();
		this.started = false;
	}

	async fetch(url: string, config: CrawlerRunConfig): Promise<CrawlResponse> {
		if (!this.started) await this.start();
		return this.strategy.crawl(url, config);
	}
}
