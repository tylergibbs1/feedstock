#!/usr/bin/env bun

/**
 * feedstock CLI — agent-first, human-friendly web crawler.
 *
 * JSON output by default when piped. Runtime schema introspection via `feedstock schema`.
 */

import type { LayeredConfig } from "../config-loader";
import { loadConfig } from "../config-loader";
import { runCache } from "./commands/cache";
import { runCrawl } from "./commands/crawl";
import { runCrawlMany } from "./commands/crawl-many";
import { runDeepCrawl } from "./commands/deep-crawl";
import { runMonitor } from "./commands/monitor";
import { runProcess } from "./commands/process";
import { runSchema } from "./commands/schema";
import { exitUsageError } from "./errors";
import type { ParsedArgs } from "./parse-args";
import { parseArgs } from "./parse-args";
import { renderHelp, SCHEMAS } from "./schema";

const VERSION = "0.3.0";

const COMMANDS: Record<string, (args: ParsedArgs, config: LayeredConfig) => Promise<void>> = {
	crawl: runCrawl,
	"crawl-many": runCrawlMany,
	"deep-crawl": runDeepCrawl,
	process: runProcess,
	schema: runSchema,
	cache: (args) => runCache(args),
	monitor: (args) => runMonitor(args),
};

async function main() {
	const args = parseArgs(process.argv.slice(2));

	// Global flags
	if (args.command === "--version" || args.command === "version") {
		process.stdout.write(`feedstock ${VERSION}\n`);
		process.exit(0);
	}

	if (args.command === "--help" || args.command === "help" || !args.command) {
		printGlobalHelp();
		process.exit(0);
	}

	// --help on a specific command
	if (args.flags.help) {
		const schema = SCHEMAS[args.command];
		if (schema) {
			process.stdout.write(renderHelp(schema) + "\n");
		} else {
			exitUsageError(
				`Unknown command: ${args.command}`,
				`Available: ${Object.keys(COMMANDS).join(", ")}`,
			);
		}
		process.exit(0);
	}

	const handler = COMMANDS[args.command];
	if (!handler) {
		exitUsageError(
			`Unknown command: ${args.command}`,
			`Available: ${Object.keys(COMMANDS).join(", ")}`,
		);
	}

	const config = loadConfig();
	await handler(args, config);
}

function printGlobalHelp(): void {
	const lines = [
		"feedstock — agent-first web crawler CLI",
		"",
		"Usage: feedstock <command> [flags]",
		"",
		"Commands:",
	];

	for (const schema of Object.values(SCHEMAS)) {
		lines.push(`  ${schema.name.padEnd(14)} ${schema.description}`);
	}

	lines.push("");
	lines.push("Global flags:");
	lines.push("  --help       Show help for a command");
	lines.push("  --version    Show version");
	lines.push("  --output     Output format: json, ndjson, text");
	lines.push("  --fields     Comma-separated fields to include in output");
	lines.push("");
	lines.push("Examples:");
	lines.push("  feedstock crawl https://example.com");
	lines.push("  feedstock crawl https://example.com --output json --fields url,markdown");
	lines.push("  feedstock deep-crawl https://docs.example.com --max-depth 2 --max-pages 50");
	lines.push("  feedstock schema crawl");
	lines.push("");
	lines.push("Config: feedstock.json, FEEDSTOCK_* env vars, or --json flag");

	process.stdout.write(lines.join("\n") + "\n");
}

main().catch((err) => {
	process.stderr.write(
		JSON.stringify({ error: true, code: "UNHANDLED", message: String(err) }) + "\n",
	);
	process.exit(1);
});
