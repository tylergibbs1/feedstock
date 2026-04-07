import { describe, expect, test } from "bun:test";
import {
	FixedSizeChunking,
	IdentityChunking,
	RegexChunking,
	SlidingWindowChunking,
} from "../../src/strategies/chunking";

describe("IdentityChunking", () => {
	test("returns text as single chunk", () => {
		const chunker = new IdentityChunking();
		const chunks = chunker.chunk("Hello world");
		expect(chunks).toEqual(["Hello world"]);
	});
});

describe("RegexChunking", () => {
	test("splits by double newline by default", () => {
		const chunker = new RegexChunking();
		const chunks = chunker.chunk("Para 1\n\nPara 2\n\nPara 3");
		expect(chunks).toEqual(["Para 1", "Para 2", "Para 3"]);
	});

	test("splits by custom pattern", () => {
		const chunker = new RegexChunking([/---/]);
		const chunks = chunker.chunk("Part A---Part B---Part C");
		expect(chunks).toEqual(["Part A", "Part B", "Part C"]);
	});

	test("filters empty chunks", () => {
		const chunker = new RegexChunking();
		const chunks = chunker.chunk("A\n\n\n\n\n\nB");
		expect(chunks).toEqual(["A", "B"]);
	});
});

describe("SlidingWindowChunking", () => {
	test("returns single chunk for short text", () => {
		const chunker = new SlidingWindowChunking(100);
		const chunks = chunker.chunk("Short text");
		expect(chunks).toEqual(["Short text"]);
	});

	test("splits into overlapping windows", () => {
		const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
		const chunker = new SlidingWindowChunking(10, 3);
		const chunks = chunker.chunk(words);
		expect(chunks.length).toBeGreaterThan(1);
		// Each chunk should have at most 10 words
		for (const chunk of chunks) {
			expect(chunk.split(" ").length).toBeLessThanOrEqual(10);
		}
	});
});

describe("FixedSizeChunking", () => {
	test("returns single chunk for short text", () => {
		const chunker = new FixedSizeChunking(1000);
		const chunks = chunker.chunk("Short text");
		expect(chunks).toEqual(["Short text"]);
	});

	test("splits into overlapping character chunks", () => {
		const text = "A".repeat(500);
		const chunker = new FixedSizeChunking(200, 50);
		const chunks = chunker.chunk(text);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(200);
		}
	});
});
