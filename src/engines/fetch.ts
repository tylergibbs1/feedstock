/**
 * Lightweight fetch engine — simple HTTP request without a browser.
 * Fastest option, works for static pages that don't need JS rendering.
 * Retries transient network errors (ECONNRESET, ETIMEDOUT, etc.).
 */

import type { CrawlerRunConfig } from "../config";
import type { CrawlResponse } from "../models";
import { Engine, type EngineCapabilities } from "./base";

const TRANSIENT_ERRORS = ["ECONNRESET", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET", "fetch failed"];
const TEXT_CONTENT_TYPES = [
	"text/",
	"application/xhtml+xml",
	"application/xml",
	"application/json",
	"application/ld+json",
];

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
		const maxAttempts = Math.max(1, Math.floor(config.retry.maxAttempts));

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			try {
				config.signal?.throwIfAborted();
				const response = await this.doFetch(url, config);
				if (attempt < maxAttempts - 1 && config.retry.statuses.includes(response.statusCode)) {
					const retryAfter = config.retry.respectRetryAfter
						? parseRetryAfter(response.responseHeaders["retry-after"])
						: null;
					await sleepWithSignal(this.retryDelay(attempt, config, retryAfter), config.signal);
					continue;
				}
				return response;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (config.signal?.aborted) throw lastError;
				const msg = lastError.message;

				// Only retry transient network errors
				if (attempt < maxAttempts - 1 && TRANSIENT_ERRORS.some((e) => msg.includes(e))) {
					await sleepWithSignal(this.retryDelay(attempt, config), config.signal);
					continue;
				}
				throw lastError;
			}
		}

		throw lastError!;
	}

	private async doFetch(url: string, config: CrawlerRunConfig): Promise<CrawlResponse> {
		const timeoutSignal = AbortSignal.timeout(config.pageTimeout);
		const signal = config.signal ? AbortSignal.any([config.signal, timeoutSignal]) : timeoutSignal;
		const response = await globalThis.fetch(url, {
			headers: {
				"User-Agent": this.userAgent,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.5",
				...config.headers,
			},
			redirect: "follow",
			signal,
		});

		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});
		const contentType = responseHeaders["content-type"]?.toLowerCase() ?? "";
		if (contentType && !TEXT_CONTENT_TYPES.some((allowed) => contentType.startsWith(allowed))) {
			await response.body?.cancel();
			throw new Error(`Unsupported content type: ${contentType.split(";", 1)[0]}`);
		}

		const declaredLength = Number(responseHeaders["content-length"] ?? 0);
		if (declaredLength > config.maxResponseBytes) {
			await response.body?.cancel();
			throw new Error(
				`Response body exceeds ${config.maxResponseBytes} byte limit (${declaredLength} bytes)`,
			);
		}

		const html = await readTextWithLimit(response, config.maxResponseBytes);

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

	private retryDelay(
		attempt: number,
		config: CrawlerRunConfig,
		retryAfter: number | null = null,
	): number {
		const exponential = Math.min(config.retry.maxDelayMs, config.retry.baseDelayMs * 2 ** attempt);
		const jitter = exponential * config.retry.jitter * Math.random();
		return Math.min(config.retry.maxDelayMs, Math.max(retryAfter ?? 0, exponential + jitter));
	}
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let output = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new Error(`Response body exceeds ${maxBytes} byte limit`);
			}
			output += decoder.decode(value, { stream: true });
		}
		return output + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

function parseRetryAfter(value: string | undefined): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(value);
	return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function sleepWithSignal(ms: number, signal: AbortSignal | null): Promise<void> {
	if (!signal) return Bun.sleep(ms);
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(done, ms);
		function done() {
			signal?.removeEventListener("abort", aborted);
			resolve();
		}
		function aborted() {
			clearTimeout(timeout);
			reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
		}
		signal.addEventListener("abort", aborted, { once: true });
	});
}
