/**
 * feedstock crawl-many <url1> <url2> ... — batch concurrent crawl
 */

import { createBrowserConfig } from "../../config";
import type { LayeredConfig } from "../../config-loader";
import { WebCrawler } from "../../crawler";
import { exitCrawlError, exitUsageError } from "../errors";
import { detectOutputMode, emitResult, emitResults } from "../output";
import type { ParsedArgs } from "../parse-args";
import { getBool, getNumber, getString } from "../parse-args";
import { buildRunConfig } from "./crawl";

export async function runCrawlMany(args: ParsedArgs, config: LayeredConfig): Promise<void> {
	let urls = args.positionals;

	// Read URLs from stdin if --stdin
	if (getBool(args.flags, "stdin")) {
		if (process.stdin.isTTY) {
			exitUsageError(
				"--stdin requires piped input",
				"Echo URLs into stdin: echo 'url1\\nurl2' | feedstock crawl-many --stdin",
			);
		}
		const text = await Bun.stdin.text();
		urls = text
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
	}

	if (urls.length === 0) {
		exitUsageError("No URLs provided", "Usage: feedstock crawl-many <url1> <url2> ... or --stdin");
	}

	const mode = detectOutputMode(getString(args.flags, "output"));
	const fields = getString(args.flags, "fields")?.split(",");
	const concurrency = getNumber(args.flags, "concurrency") ?? 5;
	const runConfig = buildRunConfig(args, config);
	const browserConfig = createBrowserConfig(config.browser);

	const crawler = new WebCrawler({ config: browserConfig });
	try {
		// Stream results as NDJSON by default (don't wait for all to finish)
		if (mode === "ndjson" || mode === "text") {
			const queue = [...urls];
			const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
				while (queue.length > 0) {
					const url = queue.shift()!;
					const result = await crawler.crawl(url, runConfig);
					emitResult(result, mode, fields);
				}
			});
			await Promise.all(workers);
		} else {
			// JSON mode: collect all results, emit as array
			const results = await crawler.crawlMany(urls, runConfig, { concurrency });
			emitResults(results, mode, fields);
		}
	} catch (err) {
		exitCrawlError(err);
	} finally {
		await crawler.close();
	}
}
