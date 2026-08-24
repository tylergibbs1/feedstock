/**
 * feedstock crawl <url> — single page crawl
 */

import { CacheMode } from "../../cache/mode";
import type { CrawlerRunConfig, CrawlerRunConfigOverrides } from "../../config";
import { createBrowserConfig, createCrawlerRunConfig } from "../../config";
import type { LayeredConfig } from "../../config-loader";
import { WebCrawler } from "../../crawler";
import { exitCrawlError, exitUsageError } from "../errors";
import { detectOutputMode, emitResult } from "../output";
import type { ParsedArgs } from "../parse-args";
import { getBool, getNumber, getString, getStringArray } from "../parse-args";

export async function runCrawl(args: ParsedArgs, config: LayeredConfig): Promise<void> {
	const url = args.positionals[0];
	if (!url) exitUsageError("Missing URL argument", "Usage: feedstock crawl <url>");

	const mode = detectOutputMode(getString(args.flags, "output"));
	const fields = getString(args.flags, "fields")?.split(",");

	const runConfig = buildRunConfig(args, config);
	const browserConfig = createBrowserConfig(config.browser);

	const crawler = new WebCrawler({ config: browserConfig });
	try {
		const result = await crawler.crawl(url, runConfig);
		emitResult(result, mode, fields);
		if (!result.success) process.exit(1);
	} catch (err) {
		exitCrawlError(err);
	} finally {
		await crawler.close();
	}
}

export function buildRunConfig(args: ParsedArgs, config: LayeredConfig): CrawlerRunConfig {
	// Raw JSON passthrough takes precedence
	const jsonStr = getString(args.flags, "json");
	const jsonOverrides = (jsonStr ? JSON.parse(jsonStr) : {}) as CrawlerRunConfigOverrides;

	// Parse individual flags
	const flagOverrides: CrawlerRunConfigOverrides = {};

	const screenshot = getBool(args.flags, "screenshot");
	if (screenshot !== undefined) flagOverrides.screenshot = screenshot;

	const pdf = getBool(args.flags, "pdf");
	if (pdf !== undefined) flagOverrides.pdf = pdf;

	const snapshot = getBool(args.flags, "snapshot");
	if (snapshot !== undefined) flagOverrides.snapshot = snapshot;

	const blockResources = getString(args.flags, "block-resources");
	if (blockResources !== undefined) {
		if (blockResources === "true") flagOverrides.blockResources = true;
		else if (blockResources === "false") flagOverrides.blockResources = false;
		else flagOverrides.blockResources = blockResources as "fast" | "minimal" | "media-only";
	}

	const cacheMode = getString(args.flags, "cache-mode");
	if (cacheMode) {
		const modeMap: Record<string, CacheMode> = {
			enabled: CacheMode.Enabled,
			disabled: CacheMode.Disabled,
			read_only: CacheMode.ReadOnly,
			write_only: CacheMode.WriteOnly,
			bypass: CacheMode.Bypass,
		};
		const resolved = modeMap[cacheMode];
		if (resolved !== undefined) flagOverrides.cacheMode = resolved;
	}

	const cssSelector = getString(args.flags, "css-selector");
	if (cssSelector) flagOverrides.cssSelector = cssSelector;

	const pageTimeout = getNumber(args.flags, "page-timeout");
	if (pageTimeout !== undefined) flagOverrides.pageTimeout = pageTimeout;

	const waitAfterLoad = getNumber(args.flags, "wait-after-load");
	if (waitAfterLoad !== undefined) flagOverrides.waitAfterLoad = waitAfterLoad;

	const waitFor = getString(args.flags, "wait-for");
	if (waitFor) {
		if (waitFor === "networkIdle") {
			flagOverrides.waitFor = { kind: "networkIdle" };
		} else if (waitFor.startsWith("delay:")) {
			flagOverrides.waitFor = { kind: "delay", ms: parseInt(waitFor.slice(6), 10) };
		} else {
			flagOverrides.waitFor = { kind: "selector", value: waitFor };
		}
	}

	const excludeTags = getStringArray(args.flags, "exclude-tags");
	if (excludeTags) flagOverrides.excludeTags = excludeTags;

	const includeTags = getStringArray(args.flags, "include-tags");
	if (includeTags) flagOverrides.includeTags = includeTags;

	const noMarkdown = getBool(args.flags, "no-markdown");
	if (noMarkdown) flagOverrides.generateMarkdown = false;

	const simulateUser = getBool(args.flags, "simulate-user");
	if (simulateUser !== undefined) flagOverrides.simulateUser = simulateUser;

	const removeConsentPopups = getBool(args.flags, "remove-consent-popups");
	if (removeConsentPopups !== undefined) flagOverrides.removeConsentPopups = removeConsentPopups;

	const navWait = getString(args.flags, "navigation-wait-until");
	if (navWait)
		flagOverrides.navigationWaitUntil = navWait as CrawlerRunConfig["navigationWaitUntil"];

	const onlyMainContent = getBool(args.flags, "only-main-content");
	if (onlyMainContent !== undefined) flagOverrides.onlyMainContent = onlyMainContent;

	const removeBase64Images = getBool(args.flags, "remove-base64-images");
	if (removeBase64Images !== undefined) flagOverrides.removeBase64Images = removeBase64Images;

	const cacheMaxAgeMs = getNumber(args.flags, "cache-max-age");
	if (cacheMaxAgeMs !== undefined) flagOverrides.cacheMaxAgeMs = cacheMaxAgeMs;

	const maxResponseBytes = getNumber(args.flags, "max-response-bytes");
	if (maxResponseBytes !== undefined) flagOverrides.maxResponseBytes = maxResponseBytes;

	const rawHeaders = args.flags.header;
	const headers = Array.isArray(rawHeaders)
		? rawHeaders
		: typeof rawHeaders === "string"
			? [rawHeaders]
			: undefined;
	if (headers) {
		flagOverrides.headers = Object.fromEntries(
			headers.map((header) => {
				const separator = header.indexOf(":");
				if (separator < 1) throw new Error(`Invalid header: ${header}. Expected Name:Value`);
				return [header.slice(0, separator).trim(), header.slice(separator + 1).trim()];
			}),
		);
	}

	const maxAttempts = getNumber(args.flags, "max-attempts");
	if (maxAttempts !== undefined) {
		flagOverrides.retry = { maxAttempts };
	}

	const magic = getBool(args.flags, "magic");
	if (magic !== undefined) flagOverrides.magicMode = magic;

	const actions = getString(args.flags, "actions");
	if (actions) flagOverrides.actions = JSON.parse(actions);

	return createCrawlerRunConfig({
		...config.crawl,
		...jsonOverrides,
		...flagOverrides,
		headers: {
			...config.crawl.headers,
			...jsonOverrides.headers,
			...flagOverrides.headers,
		},
		retry: {
			...config.crawl.retry,
			...jsonOverrides.retry,
			...flagOverrides.retry,
		},
	});
}
