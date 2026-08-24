import type {
	Page,
	ConsoleMessage as PlaywrightConsoleMessage,
	Response as PlaywrightResponse,
} from "playwright";
import { BrowserManager } from "../browser/manager";
import type { BrowserAction, BrowserConfig, CrawlerRunConfig, WaitForType } from "../config";
import type {
	BrowserActionResults,
	ConsoleMessage,
	CrawlResponse,
	NetworkRequest,
} from "../models";
import { simulateUser } from "../utils/antibot";
import { extractIframeContent, inlineIframeContent } from "../utils/iframe";
import { detectInteractiveElements } from "../utils/interactive";
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
		const isAdHocSession = !config.sessionId;
		const networkRequests: NetworkRequest[] = [];
		const consoleMessages: ConsoleMessage[] = [];
		const onResponse = (response: PlaywrightResponse) => {
			if (config.captureNetworkRequests) {
				const request = response.request();
				networkRequests.push({
					url: request.url(),
					method: request.method(),
					status: response.status(),
					resourceType: request.resourceType(),
					responseHeaders: response.headers(),
				});
			}
		};
		const onConsole = (msg: PlaywrightConsoleMessage) => {
			if (config.captureConsoleMessages) {
				consoleMessages.push({
					type: msg.type(),
					text: msg.text(),
					timestamp: Date.now(),
				});
			}
		};
		page.on("response", onResponse);
		page.on("console", onConsole);

		let removeResourceBlocking = async () => {};
		try {
			config.signal?.throwIfAborted();
			if (Object.keys(config.headers).length > 0) await page.setExtraHTTPHeaders(config.headers);
			if (config.blockResources) {
				const { applyResourceBlocking } = await import("../utils/resource-blocker");
				removeResourceBlocking = await applyResourceBlocking(page.context(), config.blockResources);
			}

			await this.executeHook("onPageCreated", page);
			await this.executeHook("beforeGoto", page, url);
			this.logger.info(`Navigating to ${url}`);
			const response = await abortable(
				page.goto(url, {
					waitUntil: config.navigationWaitUntil,
					timeout: config.pageTimeout,
				}),
				config.signal,
			);

			await this.executeHook("afterGoto", page);
			if (config.simulateUser) await abortable(simulateUser(page), config.signal);
			if (config.waitAfterLoad > 0) {
				await abortable(page.waitForTimeout(config.waitAfterLoad), config.signal);
			}
			if (config.waitFor) await abortable(this.applyWaitFor(page, config.waitFor), config.signal);

			if (config.jsCode) {
				await this.executeHook("onExecutionStarted", page);
				const scripts = Array.isArray(config.jsCode) ? config.jsCode : [config.jsCode];
				for (const script of scripts) {
					await abortable(page.evaluate(script), config.signal);
				}
				await abortable(page.waitForTimeout(100), config.signal);
			}

			if (config.removeOverlayElements || config.removeConsentPopups) {
				await abortable(this.removeOverlays(page), config.signal);
			}
			const actionResults = await this.runActions(page, config.actions, config.signal);
			await this.executeHook("beforeReturnHtml", page);

			let html = await abortable(page.content(), config.signal);
			if (config.inlineIframes) {
				html = inlineIframeContent(
					html,
					await abortable(extractIframeContent(page), config.signal),
				);
			}

			const responseHeaders = response?.headers() ?? {};
			const screenshot = config.screenshot
				? (await abortable(page.screenshot({ fullPage: true }), config.signal)).toString("base64")
				: null;
			const pdfData = config.pdf ? Buffer.from(await abortable(page.pdf(), config.signal)) : null;
			const interactiveElements = config.detectInteractiveElements
				? await abortable(detectInteractiveElements(page), config.signal)
				: null;

			return {
				html,
				responseHeaders,
				statusCode: response?.status() ?? 0,
				screenshot,
				pdfData,
				redirectedUrl: page.url() !== url ? page.url() : null,
				networkRequests: config.captureNetworkRequests ? networkRequests : null,
				consoleMessages: config.captureConsoleMessages ? consoleMessages : null,
				actions: actionResults,
				interactiveElements,
			};
		} finally {
			page.off("response", onResponse);
			page.off("console", onConsole);
			await removeResourceBlocking().catch(() => {});
			if (Object.keys(config.headers).length > 0 && !page.isClosed()) {
				await page.setExtraHTTPHeaders({}).catch(() => {});
			}
			if (isAdHocSession || config.signal?.aborted) {
				await this.browserManager.killSession(sessionId);
			}
		}
	}

	private async applyWaitFor(page: Page, waitFor: WaitForType): Promise<void> {
		switch (waitFor.kind) {
			case "selector":
				await page.waitForSelector(waitFor.value, {
					timeout: waitFor.timeout ?? 30_000,
				});
				break;
			case "networkIdle":
				await page.waitForLoadState("networkidle", { timeout: waitFor.timeout ?? 30_000 });
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

	private async runActions(
		page: Page,
		actions: BrowserAction[],
		signal: AbortSignal | null,
	): Promise<BrowserActionResults | null> {
		if (actions.length === 0) return null;
		const results: BrowserActionResults = {
			screenshots: [],
			scrapes: [],
			javascriptReturns: [],
		};

		for (const [actionIndex, action] of actions.entries()) {
			signal?.throwIfAborted();
			switch (action.type) {
				case "wait":
					if (action.selector) {
						await abortable(
							page.waitForSelector(action.selector, { timeout: action.timeout ?? 30_000 }),
							signal,
						);
					} else if (action.milliseconds !== undefined) {
						await abortable(page.waitForTimeout(action.milliseconds), signal);
					} else {
						throw new Error('The "wait" action requires selector or milliseconds');
					}
					break;
				case "click":
					await abortable(page.locator(action.selector).click({ timeout: action.timeout }), signal);
					break;
				case "fill":
					await abortable(
						page.locator(action.selector).fill(action.value, { timeout: action.timeout }),
						signal,
					);
					break;
				case "write":
					await abortable(page.keyboard.insertText(action.text), signal);
					break;
				case "press":
					if (action.selector) {
						await abortable(page.locator(action.selector).press(action.key), signal);
					} else {
						await abortable(page.keyboard.press(action.key), signal);
					}
					break;
				case "scroll": {
					const amount = (action.amount ?? 600) * (action.direction === "up" ? -1 : 1);
					if (action.selector) {
						await abortable(
							page
								.locator(action.selector)
								.evaluate((element, delta) => element.scrollBy(0, delta), amount),
							signal,
						);
					} else {
						await abortable(page.mouse.wheel(0, amount), signal);
					}
					break;
				}
				case "screenshot": {
					const buffer = await abortable(
						page.screenshot({
							fullPage: action.fullPage ?? true,
							...(action.quality !== undefined
								? { type: "jpeg" as const, quality: action.quality }
								: {}),
						}),
						signal,
					);
					results.screenshots.push({ actionIndex, base64: buffer.toString("base64") });
					break;
				}
				case "scrape":
					results.scrapes.push({
						actionIndex,
						url: page.url(),
						html: await abortable(page.content(), signal),
					});
					break;
				case "executeJavascript":
					results.javascriptReturns.push({
						actionIndex,
						value: await abortable(page.evaluate(action.script), signal),
					});
					break;
			}
		}
		return results;
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

async function abortable<T>(promise: Promise<T>, signal: AbortSignal | null): Promise<T> {
	if (!signal) return promise;
	signal.throwIfAborted();
	return new Promise<T>((resolve, reject) => {
		const aborted = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		signal.addEventListener("abort", aborted, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
	});
}
