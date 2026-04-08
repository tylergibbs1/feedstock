/**
 * feedstock process — process raw HTML without browser
 */

import { createBrowserConfig } from "../../config";
import type { LayeredConfig } from "../../config-loader";
import { WebCrawler } from "../../crawler";
import { exitCrawlError, exitUsageError } from "../errors";
import { detectOutputMode, emitResult } from "../output";
import type { ParsedArgs } from "../parse-args";
import { getString } from "../parse-args";
import { buildRunConfig } from "./crawl";

export async function runProcess(args: ParsedArgs, config: LayeredConfig): Promise<void> {
	const filePath = getString(args.flags, "file");
	let html: string;

	if (filePath) {
		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			exitUsageError(`File not found: ${filePath}`);
		}
		html = await file.text();
	} else {
		if (process.stdin.isTTY) {
			exitUsageError(
				"No input provided",
				"Usage: feedstock process --file <path> or pipe HTML to stdin",
			);
		}
		html = await Bun.stdin.text();
	}

	const mode = detectOutputMode(getString(args.flags, "output"));
	const fields = getString(args.flags, "fields")?.split(",");
	const runConfig = buildRunConfig(args, config);
	const browserConfig = createBrowserConfig(config.browser);

	const crawler = new WebCrawler({ config: browserConfig });
	try {
		const result = await crawler.processHtml(html, runConfig);
		emitResult(result, mode, fields);
	} catch (err) {
		exitCrawlError(err);
	} finally {
		await crawler.close();
	}
}
