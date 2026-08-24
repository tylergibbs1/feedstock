/** feedstock map <url> — discover a site's canonical URL surface. */

import type { LayeredConfig } from "../../config-loader";
import { WebCrawler } from "../../crawler";
import { exitCrawlError, exitUsageError } from "../errors";
import { detectOutputMode, emitData } from "../output";
import type { ParsedArgs } from "../parse-args";
import { getBool, getNumber, getString } from "../parse-args";

export async function runMap(args: ParsedArgs, config: LayeredConfig): Promise<void> {
	const url = args.positionals[0];
	if (!url) exitUsageError("Missing URL argument", "Usage: feedstock map <url>");

	const sitemap = getString(args.flags, "sitemap") as "include" | "skip" | "only" | undefined;
	const crawler = new WebCrawler({ config: config.browser });
	try {
		const result = await crawler.map(url, {
			limit: getNumber(args.flags, "limit"),
			sitemap,
			includeSubdomains: getBool(args.flags, "include-subdomains"),
			ignoreQueryParameters: getBool(args.flags, "ignore-query-parameters"),
			includePageLinks: getBool(args.flags, "page-links"),
			timeout: getNumber(args.flags, "timeout"),
		});
		emitData(
			result,
			detectOutputMode(getString(args.flags, "output")),
			getString(args.flags, "fields")?.split(","),
			result.links.map((link) => link.url).join("\n"),
		);
	} catch (err) {
		exitCrawlError(err);
	} finally {
		await crawler.close();
	}
}
