/**
 * Structured CLI error handling.
 * All errors are JSON on stderr for agent consumption.
 */

import { toFriendlyError } from "../utils/errors";

export interface CLIError {
	error: true;
	code: string;
	message: string;
	suggestion?: string;
}

export function exitError(code: string, message: string, suggestion?: string, exitCode = 1): never {
	const err: CLIError = { error: true, code, message };
	if (suggestion) err.suggestion = suggestion;
	process.stderr.write(JSON.stringify(err) + "\n");
	process.exit(exitCode);
}

export function exitUsageError(message: string, suggestion?: string): never {
	exitError("USAGE_ERROR", message, suggestion, 2);
}

export function exitCrawlError(err: unknown): never {
	const message = toFriendlyError(err);
	exitError("CRAWL_ERROR", message, undefined, 1);
}
