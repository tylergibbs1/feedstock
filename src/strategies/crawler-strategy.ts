import type { Page } from "playwright";
import { BrowserManager } from "../browser/manager";
import type { BrowserConfig, CrawlerRunConfig, WaitForType } from "../config";
import type { ConsoleMessage, CrawlResponse, NetworkRequest } from "../models";
import { simulateUser } from "../utils/antibot";
import type { Logger } from "../utils/logger";
import { SilentLogger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export type HookType =
	| "onPageCreated"
	| "beforeGoto"
	| "afterGoto"
	| "beforeReturnHtml"
	| "onExecutionStarted";

export type HookFn = (page: Page, ...args: unknown[]) => Promise<void>;

// ---------------------------------------------------------------------------
// Abstract strategy
// ---------------------------------------------------------------------------

export abstract class CrawlerStrategy {
	abstract crawl(url: string, config: CrawlerRunConfig): Promise<CrawlResponse>;
	abstract start(): Promise<void>;
	abstract close(): Promise<void>;

	protected hooks = new Map<HookType, HookFn>();

	setHook(type: HookType, fn: HookFn): void {
		this.hooks.set(type, fn);
	}

	protected async executeHook(type: HookType, page: Page, ...args: unknown[]): Promise<void> {
		const hook = this.hooks.get(type);
		if (hook) await hook(page, ...args);
	}
}

// ---------------------------------------------------------------------------
// Playwright implementation
// ---------------------------------------------------------------------------

export class PlaywrightCrawlerStrategy extends CrawlerStrategy {
	private browserManager: BrowserManager;
	private logger: Logger;

	constructor(config: BrowserConfig) {
		super();
		this.browserManager = new BrowserManager(config);
		this.logger = config.logger ?? new SilentLogger();
	}

	async start(): Promise<void> {
		await this.browserManager.start();
	}

	async close(): Promise<void> {
		await this.browserManager.close();
	}

	async crawl(url: string, config: CrawlerRunConfig): Promise<CrawlResponse> {
		const { page, sessionId } = await this.browserManager.getPage(config.sessionId);

		// Set up network request capture
		const networkRequests: NetworkRequest[] = [];
		const consoleMessages: ConsoleMessage[] = [];

		if (config.captureNetworkRequests) {
			page.on("response", (response) => {
				const request = response.request();
				networkRequests.push({
					url: request.url(),
					method: request.method(),
					status: response.status(),
					resourceType: request.resourceType(),
					responseHeaders: response.headers(),
				});
			});
		}

		if (config.captureConsoleMessages) {
			page.on("console", (msg) => {
				consoleMessages.push({
					type: msg.type(),
					text: msg.text(),
					timestamp: Date.now(),
				});
			});
		}

		// Block unnecessary resources at context level for faster page loads
		if (config.blockResources) {
			const { applyResourceBlocking } = await import("../utils/resource-blocker");
			await applyResourceBlocking(page.context(), config.blockResources);
		}

		await this.executeHook("onPageCreated", page);

		// Navigate
		await this.executeHook("beforeGoto", page, url);

		this.logger.info(`Navigating to ${url}`);
		const response = await page.goto(url, {
			waitUntil: config.navigationWaitUntil,
			timeout: config.pageTimeout,
		});

		await this.executeHook("afterGoto", page);

		// Simulate human behavior if enabled
		if (config.simulateUser) {
			await simulateUser(page);
		}

		// Wait conditions
		if (config.waitAfterLoad > 0) {
			await page.waitForTimeout(config.waitAfterLoad);
		}

		if (config.waitFor) {
			await this.applyWaitFor(page, config.waitFor);
		}

		// Execute custom JS
		if (config.jsCode) {
			await this.executeHook("onExecutionStarted", page);
			const scripts = Array.isArray(config.jsCode) ? config.jsCode : [config.jsCode];
			for (const script of scripts) {
				await page.evaluate(script);
			}
			// Wait a bit after JS execution for DOM to settle
			await page.waitForTimeout(100);
		}

		// Remove overlay elements if requested
		if (config.removeOverlayElements || config.removeConsentPopups) {
			await this.removeOverlays(page);
		}

		await this.executeHook("beforeReturnHtml", page);

		// Capture content
		const html = await page.content();
		const statusCode = response?.status() ?? 0;
		const responseHeaders: Record<string, string> = {};
		if (response) {
			const headers = response.headers();
			for (const [key, value] of Object.entries(headers)) {
				responseHeaders[key] = value;
			}
		}

		// Optional captures
		let screenshot: string | null = null;
		if (config.screenshot) {
			const buffer = await page.screenshot({ fullPage: true });
			screenshot = buffer.toString("base64");
		}

		let pdfData: Buffer | null = null;
		if (config.pdf) {
			pdfData = Buffer.from(await page.pdf());
		}

		const redirectedUrl = page.url() !== url ? page.url() : null;

		// Clean up session if it was ad-hoc (no sessionId provided)
		if (!config.sessionId) {
			await this.browserManager.killSession(sessionId);
		}

		return {
			html,
			responseHeaders,
			statusCode,
			screenshot,
			pdfData,
			redirectedUrl,
			networkRequests: config.captureNetworkRequests ? networkRequests : null,
			consoleMessages: config.captureConsoleMessages ? consoleMessages : null,
		};
	}

	private async applyWaitFor(page: Page, waitFor: WaitForType): Promise<void> {
		switch (waitFor.kind) {
			case "selector":
				await page.waitForSelector(waitFor.value, {
					timeout: waitFor.timeout ?? 30_000,
				});
				break;
			case "networkIdle":
				await page.waitForLoadState("networkidle");
				break;
			case "delay":
				await page.waitForTimeout(waitFor.ms);
				break;
			case "function":
				await page.waitForFunction(waitFor.fn, null, {
					timeout: waitFor.timeout ?? 30_000,
				});
				break;
		}
	}

	private async removeOverlays(page: Page): Promise<void> {
		await page.evaluate(() => {
			const selectors = [
				'[class*="cookie"]',
				'[class*="consent"]',
				'[class*="overlay"]',
				'[class*="modal"]',
				'[class*="popup"]',
				'[id*="cookie"]',
				'[id*="consent"]',
				'[id*="overlay"]',
				'[aria-modal="true"]',
			];
			for (const selector of selectors) {
				document.querySelectorAll(selector).forEach((el) => {
					const style = window.getComputedStyle(el);
					if (style.position === "fixed" || style.position === "absolute" || style.zIndex > "999") {
						(el as HTMLElement).style.display = "none";
					}
				});
			}
			// Reset body overflow in case it was hidden by a modal
			document.body.style.overflow = "auto";
		});
	}
}
