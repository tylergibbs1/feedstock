/**
 * feedstock deep-crawl <url> — recursive site crawl
 */

import { createBrowserConfig } from "../../config";
import type { LayeredConfig } from "../../config-loader";
import { WebCrawler } from "../../crawler";
import {
	CompositeScorer,
	ContentTypeFilter,
	createDeepCrawlConfig,
	DomainFilter,
	FilterChain,
	KeywordRelevanceScorer,
	PathDepthScorer,
	URLPatternFilter,
} from "../../deep-crawl";
import { exitCrawlError, exitUsageError } from "../errors";
import { detectOutputMode, emitJSON, emitResult } from "../output";
import type { ParsedArgs } from "../parse-args";
import { getBool, getNumber, getString, getStringArray } from "../parse-args";
import { buildRunConfig } from "./crawl";

export async function runDeepCrawl(args: ParsedArgs, config: LayeredConfig): Promise<void> {
	const url = args.positionals[0];
	if (!url) exitUsageError("Missing URL argument", "Usage: feedstock deep-crawl <url>");

	const mode = detectOutputMode(getString(args.flags, "output"));
	const fields = getString(args.flags, "fields")?.split(",");
	const dryRun = getBool(args.flags, "dry-run") ?? false;

	// Build deep crawl config from flags
	const maxDepth = getNumber(args.flags, "max-depth");
	const maxPages = getNumber(args.flags, "max-pages");
	const concurrency = getNumber(args.flags, "concurrency");

	// Build filter chain
	const filterChain = new FilterChain();
	filterChain.add(new ContentTypeFilter());

	const domains = getStringArray(args.flags, "domain-filter");
	if (domains) {
		filterChain.add(new DomainFilter({ allowed: domains }));
	}

	const excludePatterns = getStringArray(args.flags, "exclude-pattern");
	const includePatterns = getStringArray(args.flags, "include-pattern");
	if (excludePatterns || includePatterns) {
		filterChain.add(
			new URLPatternFilter({
				exclude: excludePatterns?.map((p) => new RegExp(p)),
				include: includePatterns?.map((p) => new RegExp(p)),
			}),
		);
	}

	// Build scorer
	const keywords = getStringArray(args.flags, "scorer");
	let scorer: CompositeScorer | undefined;
	if (keywords) {
		scorer = new CompositeScorer()
			.add(new KeywordRelevanceScorer(keywords, 2.0))
			.add(new PathDepthScorer());
	}

	const deepConfig = createDeepCrawlConfig({
		...(maxDepth !== undefined && { maxDepth }),
		...(maxPages !== undefined && { maxPages }),
		...(concurrency !== undefined && { concurrency }),
		filterChain,
		...(scorer && { scorer }),
	});

	// Dry run — just output the resolved config
	if (dryRun) {
		emitJSON({
			command: "deep-crawl",
			dryRun: true,
			startUrl: url,
			config: {
				maxDepth: deepConfig.maxDepth,
				maxPages: deepConfig.maxPages,
				concurrency: deepConfig.concurrency,
				hasFilterChain: true,
				hasScorer: !!scorer,
				keywords: keywords ?? null,
				domains: domains ?? null,
				excludePatterns: excludePatterns ?? null,
				includePatterns: includePatterns ?? null,
			},
		});
		return;
	}

	const runConfig = buildRunConfig(args, config);
	const browserConfig = createBrowserConfig(config.browser);
	const crawler = new WebCrawler({ config: browserConfig });

	try {
		for await (const result of crawler.deepCrawlStream(url, runConfig, deepConfig)) {
			emitResult(result, mode === "json" ? "ndjson" : mode, fields);
		}
	} catch (err) {
		exitCrawlError(err);
	} finally {
		await crawler.close();
	}
}
