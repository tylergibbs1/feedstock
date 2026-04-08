/**
 * Engine manager — orchestrates multiple scraping engines with
 * intelligent fallback. Tries cheap engines first, escalates to
 * browser-based engines when needed.
 *
 * Auto-escalation triggers:
 * 1. SPA shell detected (empty body, React/Next/Nuxt markers)
 * 2. Anti-bot block detected (403/429/503 with block indicators)
 */

import type { CrawlerRunConfig } from "../config";
import type { CrawlResponse } from "../models";
import { isBlocked } from "../utils/antibot";
import type { Logger } from "../utils/logger";
import { SilentLogger } from "../utils/logger";
import { type Engine, type EngineResult, likelyNeedsJavaScript } from "./base";

export interface EngineManagerConfig {
	/** If true, always try fetch first even if config requires JS features */
	fetchFirst: boolean;
	/** If true, auto-escalate to browser when fetch returns SPA shell */
	autoEscalate: boolean;
	/** If true, auto-escalate to next engine on 403/429/503 bot blocks */
	autoEscalateOnBlock: boolean;
}

const DEFAULT_CONFIG: EngineManagerConfig = {
	fetchFirst: true,
	autoEscalate: true,
	autoEscalateOnBlock: true,
};

/** Status codes that suggest anti-bot blocking */
const BLOCK_STATUS_CODES = new Set([401, 403, 429, 503]);

export class EngineManager {
	private engines: Engine[];
	private config: EngineManagerConfig;
	private logger: Logger;

	constructor(
		engines: Engine[],
		opts: { config?: Partial<EngineManagerConfig>; logger?: Logger } = {},
	) {
		// Sort by quality (lowest first — cheapest engines tried first)
		this.engines = [...engines].sort((a, b) => a.quality - b.quality);
		this.config = { ...DEFAULT_CONFIG, ...opts.config };
		this.logger = opts.logger ?? new SilentLogger();
	}

	async start(): Promise<void> {
		for (const engine of this.engines) {
			if (engine.name === "fetch") {
				await engine.start();
			}
		}
	}

	async close(): Promise<void> {
		for (const engine of this.engines) {
			await engine.close();
		}
	}

	/**
	 * Fetch a URL using the best available engine.
	 * Tries engines in quality order (cheapest first), falling back on failure.
	 * Auto-escalates on SPA shells and anti-bot blocks.
	 */
	async fetch(url: string, config: CrawlerRunConfig): Promise<EngineResult> {
		const candidateEngines = this.selectEngines(config);

		if (candidateEngines.length === 0) {
			throw new Error("No engine available that can handle the requested features");
		}

		let lastError: Error | null = null;
		let lastResponse: CrawlResponse | null = null;
		let lastEngine = "";

		for (const engine of candidateEngines) {
			const start = Date.now();

			try {
				this.logger.debug(`Trying engine "${engine.name}" for ${url}`);
				await engine.start();

				const response = await engine.fetch(url, config);
				const durationMs = Date.now() - start;

				// Auto-escalate: SPA shell detection
				if (
					this.config.autoEscalate &&
					engine.name === "fetch" &&
					!engine.capabilities.javascript &&
					response.statusCode >= 200 &&
					response.statusCode < 300 &&
					likelyNeedsJavaScript(response.html)
				) {
					this.logger.info(`Fetch returned SPA shell for ${url}, escalating to browser engine`);
					lastResponse = response;
					lastEngine = engine.name;
					continue;
				}

				// Auto-escalate: anti-bot block detection
				if (
					this.config.autoEscalateOnBlock &&
					engine.name === "fetch" &&
					this.isLikelyBlocked(response)
				) {
					this.logger.info(
						`Fetch got ${response.statusCode} (likely blocked) for ${url}, escalating to browser engine`,
					);
					lastResponse = response;
					lastEngine = engine.name;
					continue;
				}

				this.logger.debug(`Engine "${engine.name}" succeeded for ${url} in ${durationMs}ms`);

				return { response, engine: engine.name, durationMs };
			} catch (err) {
				const durationMs = Date.now() - start;
				lastError = err instanceof Error ? err : new Error(String(err));
				this.logger.warn(
					`Engine "${engine.name}" failed for ${url} in ${durationMs}ms: ${lastError.message}`,
				);
			}
		}

		// If we have a response from a blocked fetch but no browser succeeded,
		// return the blocked response rather than throwing
		if (lastResponse) {
			return {
				response: lastResponse,
				engine: lastEngine,
				durationMs: 0,
			};
		}

		throw lastError ?? new Error("All engines failed");
	}

	/**
	 * Check if a response indicates anti-bot blocking.
	 */
	private isLikelyBlocked(response: CrawlResponse): boolean {
		if (!BLOCK_STATUS_CODES.has(response.statusCode)) return false;
		return isBlocked(response.html, response.statusCode);
	}

	private selectEngines(config: CrawlerRunConfig): Engine[] {
		const needsBrowser =
			!!config.jsCode ||
			!!config.screenshot ||
			!!config.pdf ||
			!!config.captureNetworkRequests ||
			!!config.captureConsoleMessages ||
			(config.waitFor && config.waitFor.kind !== "delay");

		if (needsBrowser && !this.config.fetchFirst) {
			return this.engines.filter((e) => e.canHandle(config));
		}

		if (this.config.fetchFirst && !needsBrowser) {
			return this.engines;
		}

		return this.engines.filter((e) => e.canHandle(config));
	}

	get engineNames(): string[] {
		return this.engines.map((e) => e.name);
	}
}
