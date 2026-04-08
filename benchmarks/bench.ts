/**
 * Feedstock benchmark suite.
 *
 * Usage:
 *   bun run benchmarks/bench.ts              # run all scenarios
 *   bun run benchmarks/bench.ts --json       # output JSON results
 *   bun run benchmarks/bench.ts cache        # run only "cache" scenarios
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Scenario {
	name: string;
	/** Number of warmup iterations (not measured) */
	warmup?: number;
	/** Number of measured iterations */
	iterations: number;
	setup?: () => Promise<void>;
	run: () => Promise<void>;
	teardown?: () => Promise<void>;
}

interface Stats {
	avg: number;
	min: number;
	max: number;
	stddev: number;
	p50: number;
	samples: number[];
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function computeStats(samples: number[]): Stats {
	const sorted = [...samples].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	const avg = sum / sorted.length;
	const variance =
		sorted.reduce((acc, val) => acc + (val - avg) ** 2, 0) / sorted.length;

	return {
		avg,
		min: sorted[0],
		max: sorted[sorted.length - 1],
		stddev: Math.sqrt(variance),
		p50: sorted[Math.floor(sorted.length / 2)],
		samples: sorted,
	};
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runScenario(scenario: Scenario): Promise<{ name: string; stats: Stats }> {
	// Setup
	if (scenario.setup) await scenario.setup();

	// Warmup
	const warmup = scenario.warmup ?? 2;
	for (let i = 0; i < warmup; i++) {
		await scenario.run();
	}

	// Measured runs
	const samples: number[] = [];
	for (let i = 0; i < scenario.iterations; i++) {
		const start = performance.now();
		await scenario.run();
		samples.push(performance.now() - start);
	}

	// Teardown
	if (scenario.teardown) await scenario.teardown();

	return { name: scenario.name, stats: computeStats(samples) };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

import { CrawlCache, contentHash } from "../src/cache/database";
import { existsSync, unlinkSync } from "node:fs";

const BENCH_DB = "/tmp/feedstock-bench.db";

function cleanupDb() {
	if (existsSync(BENCH_DB)) unlinkSync(BENCH_DB);
}

const scenarios: Scenario[] = [
	{
		name: "cache:write-100",
		iterations: 10,
		warmup: 2,
		setup: async () => cleanupDb(),
		run: async () => {
			const cache = new CrawlCache(BENCH_DB);
			const entries = Array.from({ length: 100 }, (_, i) => ({
				url: `https://example.com/page-${i}`,
				result: JSON.stringify({ html: `<p>Content ${i}</p>`.repeat(100) }),
			}));
			cache.setMany(entries);
			cache.close();
		},
		teardown: async () => cleanupDb(),
	},
	{
		name: "cache:write-1000",
		iterations: 5,
		warmup: 1,
		setup: async () => cleanupDb(),
		run: async () => {
			const cache = new CrawlCache(BENCH_DB);
			const entries = Array.from({ length: 1000 }, (_, i) => ({
				url: `https://example.com/page-${i}`,
				result: JSON.stringify({ html: `<p>Content ${i}</p>`.repeat(100) }),
			}));
			cache.setMany(entries);
			cache.close();
		},
		teardown: async () => cleanupDb(),
	},
	{
		name: "cache:read-100",
		iterations: 20,
		warmup: 3,
		setup: async () => {
			cleanupDb();
			const cache = new CrawlCache(BENCH_DB);
			const entries = Array.from({ length: 100 }, (_, i) => ({
				url: `https://example.com/page-${i}`,
				result: JSON.stringify({ html: `<p>Content ${i}</p>`.repeat(100) }),
			}));
			cache.setMany(entries);
			cache.close();
		},
		run: async () => {
			const cache = new CrawlCache(BENCH_DB);
			for (let i = 0; i < 100; i++) {
				cache.get(`https://example.com/page-${i}`);
			}
			cache.close();
		},
		teardown: async () => cleanupDb(),
	},
	{
		name: "cache:hasChanged-100",
		iterations: 20,
		warmup: 3,
		setup: async () => {
			cleanupDb();
			const cache = new CrawlCache(BENCH_DB);
			const entries = Array.from({ length: 100 }, (_, i) => ({
				url: `https://example.com/page-${i}`,
				result: JSON.stringify({ html: `<p>Content ${i}</p>` }),
				contentHash: contentHash(`<p>Content ${i}</p>`),
			}));
			cache.setMany(entries);
			cache.close();
		},
		run: async () => {
			const cache = new CrawlCache(BENCH_DB);
			for (let i = 0; i < 100; i++) {
				cache.hasChanged(
					`https://example.com/page-${i}`,
					contentHash(`<p>Content ${i}</p>`),
				);
			}
			cache.close();
		},
		teardown: async () => cleanupDb(),
	},
	{
		name: "contentHash:10kb",
		iterations: 1000,
		warmup: 100,
		run: async () => {
			const content = "x".repeat(10_000);
			contentHash(content);
		},
	},
	{
		name: "contentHash:100kb",
		iterations: 100,
		warmup: 10,
		run: async () => {
			const content = "x".repeat(100_000);
			contentHash(content);
		},
	},
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const filter = args.find((a) => !a.startsWith("--"));

const filtered = filter
	? scenarios.filter((s) => s.name.includes(filter))
	: scenarios;

if (filtered.length === 0) {
	console.error(`No scenarios matching "${filter}"`);
	process.exit(1);
}

const results: Array<{ name: string; stats: Stats }> = [];

for (const scenario of filtered) {
	if (!jsonOutput) {
		process.stdout.write(`Running ${scenario.name}...`);
	}
	const result = await runScenario(scenario);
	results.push(result);
	if (!jsonOutput) {
		console.log(
			` avg=${result.stats.avg.toFixed(2)}ms p50=${result.stats.p50.toFixed(2)}ms ±${result.stats.stddev.toFixed(2)}ms (${scenario.iterations} runs)`,
		);
	}
}

if (jsonOutput) {
	console.log(JSON.stringify(results, null, 2));
}
