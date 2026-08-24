import { describe, expect, test } from "bun:test";
import { DefaultMarkdownGenerator } from "../../src/strategies/markdown";

describe("DefaultMarkdownGenerator", () => {
	const generator = new DefaultMarkdownGenerator();

	test("converts basic HTML to markdown", () => {
		const result = generator.generate("https://example.com", "<h1>Hello</h1><p>World</p>");
		expect(result.rawMarkdown).toContain("Hello");
		expect(result.rawMarkdown).toContain("World");
	});

	test("generates citations for links", () => {
		const html =
			'<p>Visit <a href="https://example.com">Example</a> and <a href="https://other.com">Other</a></p>';
		const result = generator.generate("https://example.com", html);

		expect(result.markdownWithCitations).toContain("[1]");
		expect(result.markdownWithCitations).toContain("[2]");
		expect(result.markdownWithCitations).toContain("## References");
		expect(result.referencesMarkdown).toContain("https://example.com");
		expect(result.referencesMarkdown).toContain("https://other.com");
	});

	test("returns raw markdown when no links", () => {
		const result = generator.generate("https://example.com", "<p>No links here</p>");
		expect(result.rawMarkdown).toBe(result.markdownWithCitations);
		expect(result.referencesMarkdown).toBe("");
	});

	test("handles empty HTML", () => {
		const result = generator.generate("https://example.com", "");
		expect(result.rawMarkdown).toBeDefined();
	});

	test("fitMarkdown defaults to null", () => {
		const result = generator.generate("https://example.com", "<p>Test</p>");
		expect(result.fitMarkdown).toBeNull();
	});

	test("turns relative URLs into absolute URLs and deduplicates citations", () => {
		const result = generator.generate(
			"https://example.com/docs/page",
			'<a href="../guide">Guide one</a><a href="../guide">Guide two</a><img src="/logo.png">',
		);
		expect(result.referencesMarkdown).toBe("[1] https://example.com/guide");
		expect(result.rawMarkdown).toContain("https://example.com/logo.png");
	});

	test("converts tables into useful markdown", () => {
		const result = generator.generate(
			"https://example.com",
			"<table><tr><th>Name</th><th>Price</th></tr><tr><td>Widget</td><td>$5</td></tr></table>",
		);
		expect(result.rawMarkdown).toContain("| Name | Price |");
		expect(result.rawMarkdown).toContain("| Widget | $5 |");
		expect(result.rawMarkdown).not.toContain("[Table]");
	});

	test("generates fit markdown with a pruning filter", () => {
		const result = generator.generate(
			"https://example.com",
			"<p>This paragraph contains enough useful words to survive content pruning intact.</p><p>Tiny</p>",
			{ contentFilter: { type: "pruning", minWords: 5 } },
		);
		expect(result.fitMarkdown).toContain("enough useful words");
		expect(result.fitMarkdown).not.toContain("Tiny");
	});

	test("preserves code blocks", () => {
		const html = "<pre><code>const x = 1;</code></pre>";
		const result = generator.generate("https://example.com", html);
		expect(result.rawMarkdown).toContain("const x = 1");
	});

	test("converts headings to atx style by default", () => {
		const html = "<h1>One</h1><h2>Two</h2><h3>Three</h3>";
		const result = generator.generate("https://example.com", html);
		expect(result.rawMarkdown).toContain("# One");
		expect(result.rawMarkdown).toContain("## Two");
		expect(result.rawMarkdown).toContain("### Three");
	});

	test("uses dash bullet markers", () => {
		const html = "<ul><li>A</li><li>B</li></ul>";
		const result = generator.generate("https://example.com", html);
		expect(result.rawMarkdown).toContain("-");
		expect(result.rawMarkdown).toContain("A");
		expect(result.rawMarkdown).toContain("B");
		// Turndown uses "- " prefix (may add extra whitespace)
		expect(result.rawMarkdown).toMatch(/-\s+A/);
		expect(result.rawMarkdown).toMatch(/-\s+B/);
	});
});
