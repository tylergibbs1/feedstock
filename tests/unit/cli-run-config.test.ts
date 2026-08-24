import { describe, expect, test } from "bun:test";
import { buildRunConfig } from "../../src/cli/commands/crawl";
import { parseArgs } from "../../src/cli/parse-args";
import type { LayeredConfig } from "../../src/config-loader";

describe("CLI run config", () => {
	test("deep-merges layered retry and header settings", () => {
		const layered: LayeredConfig = {
			browser: {},
			crawl: {
				headers: { "X-Project": "project" },
				retry: { baseDelayMs: 1250, jitter: 0 },
			},
			configPath: null,
		};
		const args = parseArgs([
			"crawl",
			"https://example.com",
			"--header",
			"Accept:text/html,application/xhtml+xml",
			"--max-attempts",
			"5",
		]);
		const config = buildRunConfig(args, layered);
		expect(config.headers).toEqual({
			"X-Project": "project",
			Accept: "text/html,application/xhtml+xml",
		});
		expect(config.retry.baseDelayMs).toBe(1250);
		expect(config.retry.jitter).toBe(0);
		expect(config.retry.maxAttempts).toBe(5);
	});
});
