/**
 * Lightweight fetch engine — simple HTTP request without a browser.
 * Fastest option, works for static pages that don't need JS rendering.
 * Retries transient network errors (ECONNRESET, ETIMEDOUT, etc.).
 */

import type { CrawlerRunConfig } from "../config";
import type { CrawlResponse } from "../models";
import { Engine, type EngineCapabilities } from "./base";

const TRANSIENT_ERRORS = ["ECONNRESET", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET", "fetch failed"];
const MAX_RETRIES = 2;
const RETRY_DELAY = 500;

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

	async start(): Promise<void> {}
	async close(): Promise<void> {}

	async fetch(url: string, config: CrawlerRunConfig): Promise<CrawlResponse> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				return await this.doFetch(url, config);
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				const msg = lastError.message;

				// Only retry transient network errors
				if (attempt < MAX_RETRIES && TRANSIENT_ERRORS.some((e) => msg.includes(e))) {
					await Bun.sleep(RETRY_DELAY * (attempt + 1));
					continue;
				}
				throw lastError;
			}
		}

		throw lastError!;
	}

	private async doFetch(url: string, config: CrawlerRunConfig): Promise<CrawlResponse> {
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
