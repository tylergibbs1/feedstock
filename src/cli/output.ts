/**
 * Output formatting — JSON, NDJSON, and text modes.
 * Defaults to JSON when piped, text when TTY.
 */

import type { CrawlResult } from "../models";

export type OutputMode = "json" | "ndjson" | "text";

export function detectOutputMode(explicit?: string): OutputMode {
	if (explicit) return explicit as OutputMode;
	return process.stdout.isTTY ? "text" : "json";
}

/** Filter result to only include specified fields */
export function filterFields(result: CrawlResult, fields?: string[]): Record<string, unknown> {
	if (!fields) {
		// Default: omit large binary fields
		const { screenshot, pdf, ...rest } = result;
		return rest;
	}
	const out: Record<string, unknown> = {};
	for (const field of fields) {
		if (field in result) {
			out[field] = (result as unknown as Record<string, unknown>)[field];
		}
	}
	return out;
}

/** Write a single result to stdout */
export function emitResult(result: CrawlResult, mode: OutputMode, fields?: string[]): void {
	const data = filterFields(result, fields);

	switch (mode) {
		case "json":
			process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
			break;
		case "ndjson":
			process.stdout.write(`${JSON.stringify(data)}\n`);
			break;
		case "text":
			emitText(result, data);
			break;
	}
}

/** Write multiple results as JSON array */
export function emitResults(results: CrawlResult[], mode: OutputMode, fields?: string[]): void {
	if (mode === "json") {
		const data = results.map((r) => filterFields(r, fields));
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
	} else {
		for (const result of results) {
			emitResult(result, mode, fields);
		}
	}
}

function emitText(result: CrawlResult, _data: Record<string, unknown>): void {
	const lines: string[] = [];
	lines.push(`URL: ${result.url}`);
	lines.push(`Status: ${result.statusCode ?? "N/A"} | Success: ${result.success}`);

	if (result.errorMessage) {
		lines.push(`Error: ${result.errorMessage}`);
	}

	if (result.markdown?.rawMarkdown) {
		const preview = result.markdown.rawMarkdown.slice(0, 200);
		lines.push(`Markdown: ${preview}${result.markdown.rawMarkdown.length > 200 ? "..." : ""}`);
	}

	const linkCount = (result.links?.internal?.length ?? 0) + (result.links?.external?.length ?? 0);
	if (linkCount > 0) {
		lines.push(
			`Links: ${result.links?.internal?.length ?? 0} internal, ${result.links?.external?.length ?? 0} external`,
		);
	}

	if (result.cacheStatus) {
		lines.push(`Cache: ${result.cacheStatus}`);
	}

	lines.push("---");
	process.stdout.write(`${lines.join("\n")}\n`);
}

/** Write arbitrary JSON to stdout */
export function emitJSON(data: unknown): void {
	process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/** Write an arbitrary command result while preserving common CLI output semantics. */
export function emitData(data: object, mode: OutputMode, fields?: string[], text?: string): void {
	const record = data as Record<string, unknown>;
	const filtered = fields
		? Object.fromEntries(
				fields.filter((field) => field in record).map((field) => [field, record[field]]),
			)
		: record;
	if (mode === "text") {
		process.stdout.write(`${text ?? JSON.stringify(filtered, null, 2)}\n`);
		return;
	}
	process.stdout.write(`${JSON.stringify(filtered, null, mode === "json" ? 2 : undefined)}\n`);
}
