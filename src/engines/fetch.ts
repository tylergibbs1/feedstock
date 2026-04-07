/**
 * Lightweight fetch engine — simple HTTP request without a browser.
 * Fastest option, works for static pages that don't need JS rendering.
 */

import type { CrawlerRunConfig } from "../config";
import type { CrawlResponse } from "../models";
import { Engine, type EngineCapabilities } from "./base";

export class FetchEngine extends Engine {
	readonly name = "fetch";
	readonly quality = 5;
	readonly capabilities: EngineCapabilities = {
		javascript: false,
		screenshot: false,
		pdf: false,
		networkRequests: false,
		consoleMessages: false,
		waitConditions: false,
		customJs: false,
	};

	private userAgent: string;

	constructor(opts: { userAgent?: string } = {}) {
		super();
		this.userAgent = opts.userAgent ?? "feedstock/1.0";
	}

	async start(): Promise<void> {
		// No-op — fetch doesn't need initialization
	}

	async close(): Promise<void> {
		// No-op
	}

	async fetch(url: string, config: CrawlerRunConfig): Promise<CrawlResponse> {
		const response = await globalThis.fetch(url, {
			headers: {
				"User-Agent": this.userAgent,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.5",
			},
			redirect: "follow",
			signal: AbortSignal.timeout(config.pageTimeout),
		});

		const html = await response.text();

		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		const redirectedUrl = response.url !== url ? response.url : null;

		return {
			html,
			responseHeaders,
			statusCode: response.status,
			screenshot: null,
			pdfData: null,
			redirectedUrl,
			networkRequests: null,
			consoleMessages: null,
		};
	}
}
