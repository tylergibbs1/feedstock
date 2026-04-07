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
