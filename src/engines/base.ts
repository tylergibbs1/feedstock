/**
 * Engine system for multi-strategy page fetching.
 *
 * Engines are ordered by quality score. The system tries each engine
 * in order until one succeeds, starting with the cheapest (fetch)
 * and escalating to browser-based engines only when needed.
 */

import type { CrawlerRunConfig } from "../config";
import type { CrawlResponse } from "../models";

export interface EngineCapabilities {
	/** Can execute JavaScript */
	javascript: boolean;
	/** Can capture screenshots */
	screenshot: boolean;
	/** Can capture PDFs */
	pdf: boolean;
	/** Can capture network requests */
	networkRequests: boolean;
	/** Can capture console messages */
	consoleMessages: boolean;
	/** Can wait for selectors/conditions */
	waitConditions: boolean;
	/** Can execute custom JS code */
	customJs: boolean;
}

export interface EngineResult {
	response: CrawlResponse;
	engine: string;
	durationMs: number;
}

export abstract class Engine {
	abstract readonly name: string;
	abstract readonly quality: number;
	abstract readonly capabilities: EngineCapabilities;

	abstract fetch(url: string, config: CrawlerRunConfig): Promise<CrawlResponse>;
	abstract start(): Promise<void>;
	abstract close(): Promise<void>;

	/**
	 * Check if this engine can handle the given config requirements.
	 */
	canHandle(config: CrawlerRunConfig): boolean {
		if (config.jsCode && !this.capabilities.customJs) return false;
		if (config.screenshot && !this.capabilities.screenshot) return false;
		if (config.pdf && !this.capabilities.pdf) return false;
		if (config.waitFor && !this.capabilities.waitConditions) return false;
		if (config.captureNetworkRequests && !this.capabilities.networkRequests) return false;
		if (config.captureConsoleMessages && !this.capabilities.consoleMessages) return false;
		return true;
	}
}

/**
 * Determines whether a page likely requires JavaScript rendering
 * by checking the HTML content.
 */
export function likelyNeedsJavaScript(html: string): boolean {
	// Very short body usually means JS-rendered SPA
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	if (bodyMatch) {
		const bodyContent = bodyMatch[1]
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<[^>]+>/g, "")
			.trim();
		if (bodyContent.length < 50) return true;
	}

	// Common SPA patterns
	const spaPatterns = [
		/<div\s+id=["'](?:root|app|__next|__nuxt)["']\s*>\s*<\/div>/i,
		/window\.__INITIAL_STATE__/,
		/window\.__NEXT_DATA__/,
		/window\.__NUXT__/,
	];

	for (const pattern of spaPatterns) {
		if (pattern.test(html)) return true;
	}

	return false;
}
