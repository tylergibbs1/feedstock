/**
 * Declarative schema registry for all CLI commands.
 * Used by `feedstock schema <command>` and --help rendering.
 */

export interface FlagDef {
	type: "string" | "number" | "boolean" | "enum" | "string[]";
	values?: string[];
	default?: unknown;
	description: string;
}

export interface ArgDef {
	name: string;
	required: boolean;
	type: string;
	description: string;
}

export interface CommandSchema {
	name: string;
	description: string;
	args: ArgDef[];
	flags: Record<string, FlagDef>;
}

const COMMON_FLAGS: Record<string, FlagDef> = {
	output: {
		type: "enum",
		values: ["json", "ndjson", "text"],
		description: "Output format (default: json if piped, text if TTY)",
	},
	fields: { type: "string", description: "Comma-separated list of result fields to include" },
	verbose: { type: "boolean", default: false, description: "Enable verbose logging" },
	quiet: { type: "boolean", default: false, description: "Suppress non-essential output" },
};

const CRAWL_FLAGS: Record<string, FlagDef> = {
	...COMMON_FLAGS,
	json: { type: "string", description: "Raw CrawlerRunConfig JSON (bypasses individual flags)" },
	screenshot: { type: "boolean", default: false, description: "Capture a full-page screenshot" },
	pdf: { type: "boolean", default: false, description: "Capture a PDF" },
	snapshot: { type: "boolean", default: false, description: "Generate accessibility snapshot" },
	"block-resources": {
		type: "enum",
		values: ["true", "false", "fast", "minimal", "media-only"],
		default: "false",
		description: "Resource blocking profile",
	},
	"cache-mode": {
		type: "enum",
		values: ["enabled", "disabled", "read_only", "write_only", "bypass"],
		default: "enabled",
		description: "Cache mode",
	},
	"css-selector": { type: "string", description: "CSS selector to scope content extraction" },
	"page-timeout": { type: "number", default: 60000, description: "Page navigation timeout in ms" },
	"wait-for": {
		type: "string",
		description: "Wait condition: selector:<css>, networkIdle, delay:<ms>",
	},
	"wait-after-load": {
		type: "number",
		default: 0,
		description: "Extra wait after page load in ms",
	},
	"exclude-tags": { type: "string[]", description: "HTML tags to exclude from content" },
	"include-tags": { type: "string[]", description: "HTML tags to include (overrides exclude)" },
	"no-markdown": { type: "boolean", default: false, description: "Skip markdown generation" },
	"simulate-user": {
		type: "boolean",
		default: false,
		description: "Simulate human mouse/scroll behavior",
	},
	"remove-consent-popups": {
		type: "boolean",
		default: false,
		description: "Remove cookie/consent popups",
	},
	"navigation-wait-until": {
		type: "enum",
		values: ["commit", "domcontentloaded", "load", "networkidle"],
		default: "domcontentloaded",
		description: "Navigation wait strategy",
	},
};

export const SCHEMAS: Record<string, CommandSchema> = {
	crawl: {
		name: "crawl",
		description: "Crawl a single page and extract content",
		args: [{ name: "url", required: true, type: "string", description: "URL to crawl" }],
		flags: CRAWL_FLAGS,
	},
	"crawl-many": {
		name: "crawl-many",
		description: "Crawl multiple URLs concurrently",
		args: [
			{
				name: "urls",
				required: false,
				type: "string[]",
				description: "URLs to crawl (or --stdin)",
			},
		],
		flags: {
			...CRAWL_FLAGS,
			concurrency: { type: "number", default: 5, description: "Number of concurrent crawls" },
			stdin: {
				type: "boolean",
				default: false,
				description: "Read URLs from stdin (one per line)",
			},
		},
	},
	"deep-crawl": {
		name: "deep-crawl",
		description: "Recursively crawl a site following links",
		args: [{ name: "url", required: true, type: "string", description: "Starting URL" }],
		flags: {
			...CRAWL_FLAGS,
			"max-depth": { type: "number", default: 3, description: "Maximum crawl depth" },
			"max-pages": { type: "number", default: 100, description: "Maximum pages to crawl" },
			concurrency: { type: "number", default: 5, description: "Number of concurrent crawls" },
			"domain-filter": { type: "string[]", description: "Allowed domains (comma-separated)" },
			"exclude-pattern": {
				type: "string[]",
				description: "URL patterns to exclude (regex, repeatable)",
			},
			"include-pattern": {
				type: "string[]",
				description: "URL patterns to include (regex, repeatable)",
			},
			scorer: { type: "string[]", description: "Keywords for relevance scoring (comma-separated)" },
			"dry-run": {
				type: "boolean",
				default: false,
				description: "Validate config without crawling",
			},
		},
	},
	process: {
		name: "process",
		description: "Process raw HTML without browser navigation",
		args: [],
		flags: {
			...CRAWL_FLAGS,
			file: { type: "string", description: "Path to HTML file (or read from stdin)" },
		},
	},
	schema: {
		name: "schema",
		description: "Show the JSON schema for a command (agent introspection)",
		args: [
			{
				name: "command",
				required: false,
				type: "string",
				description: "Command name (omit to list all)",
			},
		],
		flags: {},
	},
	cache: {
		name: "cache",
		description: "Manage the crawl cache",
		args: [
			{ name: "subcommand", required: true, type: "string", description: "stats | clear | prune" },
		],
		flags: {
			"older-than": {
				type: "number",
				description: "Prune entries older than this many milliseconds",
			},
			...COMMON_FLAGS,
		},
	},
	monitor: {
		name: "monitor",
		description: "Start the live monitoring dashboard server",
		args: [],
		flags: {
			port: { type: "number", default: 3200, description: "Port to listen on" },
			hostname: { type: "string", default: "127.0.0.1", description: "Hostname to bind to" },
		},
	},
};

/** Render help text for a command */
export function renderHelp(schema: CommandSchema): string {
	const lines: string[] = [];
	lines.push(`feedstock ${schema.name} — ${schema.description}`);
	lines.push("");

	if (schema.args.length > 0) {
		const argStr = schema.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" ");
		lines.push(`Usage: feedstock ${schema.name} ${argStr} [flags]`);
	} else {
		lines.push(`Usage: feedstock ${schema.name} [flags]`);
	}
	lines.push("");

	if (Object.keys(schema.flags).length > 0) {
		lines.push("Flags:");
		for (const [name, def] of Object.entries(schema.flags)) {
			const defaultStr = def.default !== undefined ? ` (default: ${def.default})` : "";
			const valuesStr = def.values ? ` [${def.values.join("|")}]` : "";
			lines.push(`  --${name}${valuesStr}  ${def.description}${defaultStr}`);
		}
	}

	return lines.join("\n");
}
