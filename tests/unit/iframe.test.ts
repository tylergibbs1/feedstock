import { describe, expect, test } from "bun:test";
import { inlineIframeContent } from "../../src/utils/iframe";

describe("inlineIframeContent", () => {
	test("replaces iframe with inlined content", () => {
		const parent = '<div><iframe src="https://embed.example.com/widget"></iframe></div>';
		const iframes = [
			{
				src: "https://embed.example.com/widget",
				html: "<html><head><style>body{}</style></head><body><p>Widget Content</p></body></html>",
			},
		];

		const result = inlineIframeContent(parent, iframes);
		expect(result).toContain("Widget Content");
		expect(result).toContain("data-feedstock-iframe-src");
		expect(result).not.toContain("<iframe");
	});

	test("strips head and html/body tags from iframe content", () => {
		const parent = '<iframe src="https://x.com/embed"></iframe>';
		const iframes = [
			{
				src: "https://x.com/embed",
				html: "<html><head><script>alert(1)</script></head><body><p>Clean</p></body></html>",
			},
		];

		const result = inlineIframeContent(parent, iframes);
		expect(result).toContain("Clean");
		expect(result).not.toContain("<head>");
		expect(result).not.toContain("<html>");
	});

	test("leaves unmatched iframes unchanged", () => {
		const parent = '<iframe src="https://other.com/frame"></iframe>';
		const result = inlineIframeContent(parent, []);
		expect(result).toContain("<iframe");
	});
});
