/** feedstock scrape <url> — concise, format-driven scraping output. */

import type { LayeredConfig } from "../../config-loader";
import { WebCrawler } from "../../crawler";
import type { ScrapeFormat } from "../../models";
import { exitCrawlError, exitUsageError } from "../errors";
import { detectOutputMode, emitData } from "../output";
import type { ParsedArgs } from "../parse-args";
import { getBool, getString, getStringArray } from "../parse-args";
import { buildRunConfig } from "./crawl";

const SCRAPE_FORMATS = new Set<ScrapeFormat>([
	"markdown",
	"html",
	"rawHtml",
	"links",
	"images",
	"screenshot",
	"pdf",
	"snapshot",
	"json",
]);

export async function runScrape(args: ParsedArgs, config: LayeredConfig): Promise<void> {
	const url = args.positionals[0];
	if (!url) exitUsageError("Missing URL argument", "Usage: feedstock scrape <url>");

	const requested = getStringArray(args.flags, "formats") ?? ["markdown"];
	const invalid = requested.filter((format) => !SCRAPE_FORMATS.has(format as ScrapeFormat));
	if (invalid.length > 0) {
		exitUsageError(
			`Unknown scrape format: ${invalid.join(", ")}`,
			`Available: ${[...SCRAPE_FORMATS].join(", ")}`,
		);
	}

	const runConfig = buildRunConfig(args, config);
	runConfig.onlyMainContent = getBool(args.flags, "only-main-content") ?? true;
	runConfig.removeBase64Images = getBool(args.flags, "remove-base64-images") ?? true;
	const crawler = new WebCrawler({ config: config.browser });
	try {
		const document = await crawler.scrape(url, {
			...runConfig,
			formats: requested as ScrapeFormat[],
		});
		emitData(
			document,
			detectOutputMode(getString(args.flags, "output")),
			getString(args.flags, "fields")?.split(","),
			document.markdown,
		);
		if (!document.success) process.exitCode = 1;
	} catch (err) {
		exitCrawlError(err);
	} finally {
		await crawler.close();
	}
}
