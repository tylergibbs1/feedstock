import { describe, expect, test } from "bun:test";
import { BM25ContentFilter, PruningContentFilter } from "../../src/strategies/content-filter";

describe("PruningContentFilter", () => {
	test("removes short blocks", () => {
		const filter = new PruningContentFilter({ minWords: 5 });
		const result = filter.filter("Short.\n\nThis is a longer block that should be kept.");
		expect(result).not.toContain("Short.");
		expect(result).toContain("longer block");
	});

	test("removes low-quality patterns", () => {
		const filter = new PruningContentFilter();
		const result = filter.filter(
			"Share this on Twitter\n\nThis is valuable content about web crawling techniques.\n\nCopyright 2024 All rights reserved",
		);
		expect(result).not.toContain("Share this");
		expect(result).not.toContain("Copyright");
		expect(result).toContain("valuable content");
	});

	test("preserves quality content", () => {
		const filter = new PruningContentFilter();
		const content =
			"Web crawling is the process of systematically browsing the web.\n\nCrawlers follow hyperlinks to discover and index new pages.";
		const result = filter.filter(content);
		expect(result).toBe(content);
	});

	test("handles empty input", () => {
		const filter = new PruningContentFilter();
		expect(filter.filter("")).toBe("");
	});
});

describe("BM25ContentFilter", () => {
	test("filters blocks by query relevance", () => {
		const filter = new BM25ContentFilter({ threshold: 0.1 });
		const content = [
			"TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
			"The weather in Paris is lovely this time of year with sunny skies.",
			"Bun is a fast JavaScript runtime with built-in TypeScript support.",
		].join("\n\n");

		const result = filter.filter(content, "TypeScript runtime");
		expect(result).toContain("TypeScript");
		expect(result).toContain("Bun");
	});

	test("returns all content without query", () => {
		const filter = new BM25ContentFilter();
		const content = "Block one\n\nBlock two";
		expect(filter.filter(content)).toBe(content);
	});

	test("returns all content if nothing matches", () => {
		const filter = new BM25ContentFilter({ threshold: 0.9 });
		const content = "Paragraph about cats.\n\nParagraph about dogs.";
		const result = filter.filter(content, "quantum physics entanglement");
		// Should return all content as fallback
		expect(result.length).toBeGreaterThan(0);
	});
});
