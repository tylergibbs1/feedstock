/**
 * Engine manager — orchestrates multiple scraping engines with
 * intelligent fallback. Tries cheap engines first, escalates to
 * browser-based engines when needed.
 */

import type { CrawlerRunConfig } from "../config";
import type { Logger } from "../utils/logger";
import { SilentLogger } from "../utils/logger";
import { type Engine, type EngineResult, likelyNeedsJavaScript } from "./base";

export interface EngineManagerConfig {
	/** If true, always try fetch first even if config requires JS features */
	fetchFirst: boolean;
	/** If true, auto-escalate to browser when fetch returns SPA shell */
	autoEscalate: boolean;
}

const DEFAULT_CONFIG: EngineManagerConfig = {
	fetchFirst: true,
	autoEscalate: true,
};

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
		// Only start engines lazily — don't launch browsers until needed
		// FetchEngine.start() is a no-op anyway
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
	 */
	async fetch(url: string, config: CrawlerRunConfig): Promise<EngineResult> {
		const candidateEngines = this.selectEngines(config);

		if (candidateEngines.length === 0) {
			throw new Error("No engine available that can handle the requested features");
		}

		let lastError: Error | null = null;

		for (const engine of candidateEngines) {
			const start = Date.now();

			try {
				this.logger.debug(`Trying engine "${engine.name}" for ${url}`);
				await engine.start(); // lazy start

				const response = await engine.fetch(url, config);
				const durationMs = Date.now() - start;

				// Auto-escalate: if fetch returned an SPA shell, try a browser engine
				if (
					this.config.autoEscalate &&
					engine.name === "fetch" &&
					!engine.capabilities.javascript &&
					likelyNeedsJavaScript(response.html)
				) {
					this.logger.info(`Fetch returned SPA shell for ${url}, escalating to browser engine`);
					continue; // skip to next engine (browser)
				}

				this.logger.debug(`Engine "${engine.name}" succeeded for ${url} in ${durationMs}ms`);

				return {
					response,
					engine: engine.name,
					durationMs,
				};
			} catch (err) {
				const durationMs = Date.now() - start;
				lastError = err instanceof Error ? err : new Error(String(err));
				this.logger.warn(
					`Engine "${engine.name}" failed for ${url} in ${durationMs}ms: ${lastError.message}`,
				);
			}
		}

		throw lastError ?? new Error("All engines failed");
	}

	/**
	 * Select and order engines based on config requirements.
	 */
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

		// fetchFirst: include fetch even if it can't handle everything (auto-escalate catches it)
		if (this.config.fetchFirst && !needsBrowser) {
			return this.engines;
		}

		return this.engines.filter((e) => e.canHandle(config));
	}

	get engineNames(): string[] {
		return this.engines.map((e) => e.name);
	}
}
