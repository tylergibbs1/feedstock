/**
 * Integration tests for CLI commands via subprocess.
 * Runs the actual CLI binary and checks stdout/stderr/exit codes.
 */
import { describe, expect, test } from "bun:test";

const CLI = "src/cli/index.ts";

async function run(
	args: string[],
	opts?: { stdin?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", CLI, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: opts?.stdin ? new Response(opts.stdin).body! : undefined,
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

describe("CLI: global", () => {
	test("--help exits 0 with help text", async () => {
		const { stdout, exitCode } = await run(["--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("feedstock");
		expect(stdout).toContain("Commands:");
	});

	test("--version exits 0", async () => {
		const { stdout, exitCode } = await run(["--version"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("feedstock");
	});

	test("unknown command exits 2 with JSON error", async () => {
		const { stderr, exitCode } = await run(["nonexistent"]);
		expect(exitCode).toBe(2);
		const err = JSON.parse(stderr);
		expect(err.error).toBe(true);
		expect(err.code).toBe("USAGE_ERROR");
	});

	test("no command shows help", async () => {
		const { stdout, exitCode } = await run([]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Commands:");
	});
});

describe("CLI: schema", () => {
	test("lists all commands", async () => {
		const { stdout, exitCode } = await run(["schema"]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.commands).toBeArray();
		expect(data.commands.length).toBe(7);
	});

	test("shows schema for crawl", async () => {
		const { stdout, exitCode } = await run(["schema", "crawl"]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.name).toBe("crawl");
		expect(data.args).toBeArray();
		expect(data.flags).toHaveProperty("screenshot");
	});

	test("unknown command returns error", async () => {
		const { stdout, exitCode } = await run(["schema", "fake"]);
		expect(exitCode).toBe(2);
		const data = JSON.parse(stdout);
		expect(data.error).toBe(true);
		expect(data.code).toBe("UNKNOWN_COMMAND");
	});
});

describe("CLI: crawl", () => {
	test("missing URL exits 2", async () => {
		const { stderr, exitCode } = await run(["crawl"]);
		expect(exitCode).toBe(2);
		const err = JSON.parse(stderr);
		expect(err.code).toBe("USAGE_ERROR");
	});

	test("crawls example.com with --fields", async () => {
		const { stdout, exitCode } = await run([
			"crawl",
			"https://example.com",
			"--fields",
			"url,success,statusCode",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.url).toBe("https://example.com");
		expect(data.success).toBe(true);
		expect(data.statusCode).toBe(200);
		expect(Object.keys(data)).toEqual(["url", "success", "statusCode"]);
	}, 30_000);

	test("--help shows crawl help", async () => {
		const { stdout, exitCode } = await run(["crawl", "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("feedstock crawl");
		expect(stdout).toContain("--screenshot");
	});
});

describe("CLI: process", () => {
	test("processes HTML from stdin", async () => {
		const { stdout, exitCode } = await run(
			["process", "--fields", "url,success,markdown", "--output", "json"],
			{ stdin: "<html><body><h1>Test</h1><p>Hello world</p></body></html>" },
		);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.success).toBe(true);
		expect(data.markdown.rawMarkdown).toContain("Test");
	});
});

describe("CLI: cache", () => {
	test("stats returns JSON", async () => {
		const { stdout, exitCode } = await run(["cache", "stats"]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data).toHaveProperty("entries");
		expect(data).toHaveProperty("sizeBytes");
	});

	test("missing subcommand exits 2", async () => {
		const { stderr, exitCode } = await run(["cache"]);
		expect(exitCode).toBe(2);
		const err = JSON.parse(stderr);
		expect(err.code).toBe("USAGE_ERROR");
	});
});

describe("CLI: deep-crawl", () => {
	test("--dry-run validates without crawling", async () => {
		const { stdout, exitCode } = await run([
			"deep-crawl",
			"https://example.com",
			"--dry-run",
			"--max-depth",
			"2",
			"--max-pages",
			"10",
			"--domain-filter",
			"example.com",
		]);
		expect(exitCode).toBe(0);
		const data = JSON.parse(stdout);
		expect(data.dryRun).toBe(true);
		expect(data.config.maxDepth).toBe(2);
		expect(data.config.maxPages).toBe(10);
		expect(data.config.domains).toEqual(["example.com"]);
	});

	test("missing URL exits 2", async () => {
		const { stderr, exitCode } = await run(["deep-crawl"]);
		expect(exitCode).toBe(2);
	});
});
