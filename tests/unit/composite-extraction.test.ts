import { describe, expect, test } from "bun:test";
import { NoExtractionStrategy } from "../../src/strategies/extraction/base";
import { CodeExtractionStrategy } from "../../src/strategies/extraction/code";
import {
	CompositeExtractionStrategy,
	createCompositeExtraction,
} from "../../src/strategies/extraction/composite";
import { detectContentRegions } from "../../src/strategies/extraction/content-detector";
import { ProseExtractionStrategy } from "../../src/strategies/extraction/prose";

// ─── Content Detection ───────────────────────────────────────────────

describe("detectContentRegions", () => {
	test("detects <table> as table region", () => {
		const html = `<html><body>
			<table><thead><tr><th>Name</th><th>Age</th></tr></thead>
			<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>
		</body></html>`;
		const regions = detectContentRegions(html);
		const table = regions.find((r) => r.type === "table");
		expect(table).toBeDefined();
		expect(table!.confidence).toBeGreaterThanOrEqual(0.8);
	});

	test("detects <pre><code> as code region", () => {
		const html = `<html><body>
			<pre><code class="language-js">const x = 1;</code></pre>
		</body></html>`;
		const regions = detectContentRegions(html);
		const code = regions.find((r) => r.type === "code");
		expect(code).toBeDefined();
		expect(code!.confidence).toBeGreaterThanOrEqual(0.8);
	});

	test("detects <ul> with >2 <li> as list region", () => {
		const html = `<html><body>
			<ul><li>One</li><li>Two</li><li>Three</li></ul>
		</body></html>`;
		const regions = detectContentRegions(html);
		const list = regions.find((r) => r.type === "list");
		expect(list).toBeDefined();
	});

	test("detects <nav> as navigation region", () => {
		const html = `<html><body>
			<nav><a href="/">Home</a><a href="/about">About</a></nav>
		</body></html>`;
		const regions = detectContentRegions(html);
		const nav = regions.find((r) => r.type === "navigation");
		expect(nav).toBeDefined();
		expect(nav!.confidence).toBeGreaterThanOrEqual(0.8);
	});

	test("detects plain paragraphs as prose region", () => {
		const html = `<html><body>
			<p>This is a paragraph with enough text content to be considered prose material for extraction.</p>
		</body></html>`;
		const regions = detectContentRegions(html);
		const prose = regions.find((r) => r.type === "prose");
		expect(prose).toBeDefined();
	});

	test("mixed HTML produces multiple regions in document order", () => {
		const html = `<html><body>
			<p>This is introductory prose text that is long enough to be detected as a content region.</p>
			<table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Val</td></tr></tbody></table>
			<pre><code>console.log("hello");</code></pre>
		</body></html>`;
		const regions = detectContentRegions(html);
		const types = regions.map((r) => r.type);
		expect(types).toContain("prose");
		expect(types).toContain("table");
		expect(types).toContain("code");

		// Verify ordering: prose should come before table, table before code
		const proseIdx = types.indexOf("prose");
		const tableIdx = types.indexOf("table");
		const codeIdx = types.indexOf("code");
		expect(proseIdx).toBeLessThan(tableIdx);
		expect(tableIdx).toBeLessThan(codeIdx);
	});

	test("layout tables (single column, no <th>) have low confidence", () => {
		const html = `<html><body>
			<table><tr><td>Just a single cell layout</td></tr>
			<tr><td>Another row</td></tr></table>
		</body></html>`;
		const regions = detectContentRegions(html);
		const table = regions.find((r) => r.type === "table");
		expect(table).toBeDefined();
		// Layout table: single column, no <th> → lower confidence
		expect(table!.confidence).toBeLessThan(0.8);
	});
});

// ─── Code Extraction ─────────────────────────────────────────────────

describe("CodeExtractionStrategy", () => {
	const strategy = new CodeExtractionStrategy();

	test("extracts code from <pre><code> blocks", async () => {
		const html = `<pre><code>const x = 1;</code></pre>`;
		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(1);
		expect(items[0].content).toBe("const x = 1;");
	});

	test("detects language from class name", async () => {
		const html = `<pre><code class="language-python">print("hi")</code></pre>`;
		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(1);
		expect(items[0].metadata?.language).toBe("python");
	});

	test("preserves whitespace/indentation", async () => {
		const code = "function hello() {\n  return 'world';\n}";
		const html = `<pre><code>${code}</code></pre>`;
		const items = await strategy.extract("https://example.com", html);
		expect(items[0].content).toBe(code);
	});

	test("multiple code blocks produce multiple items", async () => {
		const html = `
			<pre><code class="language-js">const a = 1;</code></pre>
			<pre><code class="language-py">x = 2</code></pre>
		`;
		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(2);
		expect(items[0].metadata?.language).toBe("js");
		expect(items[1].metadata?.language).toBe("py");
	});
});

// ─── Prose Extraction ────────────────────────────────────────────────

describe("ProseExtractionStrategy", () => {
	const strategy = new ProseExtractionStrategy();

	test("extracts headings and paragraphs as structured text", async () => {
		const html = `<h1>Title</h1><p>Body text here.</p>`;
		const items = await strategy.extract("https://example.com", html);
		expect(items.length).toBeGreaterThanOrEqual(2);
		expect(items[0].content).toBe("Title");
		expect(items[1].content).toBe("Body text here.");
	});

	test("preserves heading levels in metadata", async () => {
		const html = `<h1>H1</h1><h2>H2</h2><h3>H3</h3>`;
		const items = await strategy.extract("https://example.com", html);
		expect(items[0].metadata?.level).toBe(1);
		expect(items[1].metadata?.level).toBe(2);
		expect(items[2].metadata?.level).toBe(3);
	});

	test("strips inline HTML but keeps text", async () => {
		const html = `<p>Hello <strong>bold</strong> and <em>italic</em> world.</p>`;
		const items = await strategy.extract("https://example.com", html);
		expect(items[0].content).toBe("Hello bold and italic world.");
	});

	test("word count in metadata is accurate", async () => {
		const html = `<p>One two three four five.</p>`;
		const items = await strategy.extract("https://example.com", html);
		expect(items[0].metadata?.wordCount).toBe(5);
	});
});

// ─── Composite Strategy ──────────────────────────────────────────────

describe("CompositeExtractionStrategy", () => {
	test("mixed HTML extracts items from all three strategies", async () => {
		const html = `<html><body>
			<p>This is a paragraph with enough text to be detected as prose content by the detector.</p>
			<table><thead><tr><th>Name</th><th>Value</th></tr></thead>
			<tbody><tr><td>A</td><td>1</td></tr></tbody></table>
			<pre><code class="language-js">const x = 1;</code></pre>
		</body></html>`;

		const strategy = createCompositeExtraction();
		const items = await strategy.extract("https://example.com", html);

		const types = items.map((i) => i.metadata?.contentType);
		expect(types).toContain("prose");
		expect(types).toContain("table");
		expect(types).toContain("code");
	});

	test("interleave mode preserves document order", async () => {
		const html = `<html><body>
			<p>First prose block that is definitely long enough to be detected as content by the detector.</p>
			<pre><code>code block</code></pre>
			<p>Second prose block that is also long enough to be detected as a content region by detector.</p>
		</body></html>`;

		const strategy = createCompositeExtraction({ mergeStrategy: "interleave" });
		const items = await strategy.extract("https://example.com", html);

		// Find the content types in order
		const contentTypes = items.map((i) => i.metadata?.contentType);
		const firstProse = contentTypes.indexOf("prose");
		const codeIdx = contentTypes.indexOf("code");
		const lastProse = contentTypes.lastIndexOf("prose");

		expect(firstProse).toBeLessThan(codeIdx);
		expect(codeIdx).toBeLessThan(lastProse);
	});

	test("concatenate mode groups by content type", async () => {
		const html = `<html><body>
			<p>First prose block that is absolutely long enough to be detected properly by the content detector.</p>
			<pre><code>middle code</code></pre>
			<p>Second prose block that is also long enough to be grouped with the first prose block above.</p>
		</body></html>`;

		const strategy = createCompositeExtraction({ mergeStrategy: "concatenate" });
		const items = await strategy.extract("https://example.com", html);

		// In concatenate mode, all items of one type come before another type
		const contentTypes = items.map((i) => i.metadata?.contentType);
		// Once we switch away from a type, we shouldn't see it again
		const typeOrder: string[] = [];
		for (const t of contentTypes) {
			if (typeOrder[typeOrder.length - 1] !== t) typeOrder.push(t as string);
		}
		// Each type should appear exactly once in the order sequence
		const unique = new Set(typeOrder);
		expect(unique.size).toBe(typeOrder.length);
	});

	test("navigation excluded by default", async () => {
		const html = `<html><body>
			<nav><a href="/">Home</a><a href="/about">About</a></nav>
			<p>Main content paragraph that is definitely long enough to be detected as prose content.</p>
		</body></html>`;

		const strategy = createCompositeExtraction();
		const items = await strategy.extract("https://example.com", html);

		const types = items.map((i) => i.metadata?.contentType);
		expect(types).not.toContain("navigation");
	});

	test("navigation included when includeNavigation=true", async () => {
		const html = `<html><body>
			<nav><a href="/">Home</a><a href="/about">About</a></nav>
			<p>Main content paragraph that is definitely long enough to be detected as prose content.</p>
		</body></html>`;

		const strategy = createCompositeExtraction({ includeNavigation: true });
		const items = await strategy.extract("https://example.com", html);

		const types = items.map((i) => i.metadata?.contentType);
		expect(types).toContain("navigation");
	});

	test("low confidence regions filtered by minConfidence", async () => {
		const html = `<html><body>
			<table><tr><td>Single cell layout table</td></tr></table>
			<p>Prose paragraph that is long enough to pass the minimum text length requirement for detection.</p>
		</body></html>`;

		// Layout table has confidence ~0.4, set minConfidence to 0.5 to exclude it
		const strategy = createCompositeExtraction({ minConfidence: 0.5 });
		const items = await strategy.extract("https://example.com", html);

		const types = items.map((i) => i.metadata?.contentType);
		expect(types).not.toContain("table");
		expect(types).toContain("prose");
	});

	test("fallback strategy used for unmapped content types", async () => {
		const html = `<html><body>
			<form><input type="text" /><button>Submit</button></form>
			<p>Some prose text that is long enough to be detected as a content region by the detector.</p>
		</body></html>`;

		// Only map prose, not form — form should use fallback (NoExtractionStrategy)
		const strategy = new CompositeExtractionStrategy({
			mappings: [{ contentType: "prose", strategy: new ProseExtractionStrategy() }],
			fallback: new NoExtractionStrategy(),
			mergeStrategy: "interleave",
			includeNavigation: false,
			minConfidence: 0.3,
		});

		const items = await strategy.extract("https://example.com", html);

		// Should have items from both prose (mapped) and form (fallback)
		const types = items.map((i) => i.metadata?.contentType);
		expect(types).toContain("prose");
		expect(types).toContain("form");
	});

	test("createCompositeExtraction() factory works with defaults", async () => {
		const strategy = createCompositeExtraction();
		expect(strategy).toBeInstanceOf(CompositeExtractionStrategy);

		const html = `<p>Simple paragraph text that is long enough to be classified as prose content.</p>`;
		const items = await strategy.extract("https://example.com", html);
		expect(items.length).toBeGreaterThan(0);
	});
});
