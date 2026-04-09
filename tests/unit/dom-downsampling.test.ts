import { describe, expect, test } from "bun:test";
import {
	createDomDownsamplingConfig,
	DEFAULT_DOM_DOWNSAMPLING_CONFIG,
	DomDownsampler,
} from "../../src/strategies/dom-downsampling";

describe("DomDownsampler", () => {
	test("removes script, style, noscript, and svg tags", () => {
		const html = `
			<div>
				<script>alert('xss')</script>
				<style>.foo { color: red; }</style>
				<noscript>Enable JS</noscript>
				<svg><circle r="10"/></svg>
				<p>Keep me</p>
			</div>
		`;
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).not.toContain("<script");
		expect(result).not.toContain("<style");
		expect(result).not.toContain("<noscript");
		expect(result).not.toContain("<svg");
		expect(result).toContain("Keep me");
	});

	test("strips non-semantic attributes but keeps href, src, alt, id, class", () => {
		const html = `
			<a href="/page" data-tracking="abc" onclick="track()">Link</a>
			<img src="img.png" alt="photo" data-lazy="true">
			<div id="main" class="container" data-testid="root">Content</div>
		`;
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).toContain('href="/page"');
		expect(result).toContain('src="img.png"');
		expect(result).toContain('alt="photo"');
		expect(result).toContain('id="main"');
		expect(result).toContain('class="container"');
		expect(result).not.toContain("data-tracking");
		expect(result).not.toContain("onclick");
		expect(result).not.toContain("data-lazy");
		expect(result).not.toContain("data-testid");
	});

	test("collapses single-child container chains", () => {
		const html = "<div><div><div><p>text</p></div></div></div>";
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).toBe("<p>text</p>");
	});

	test("does NOT collapse chains where intermediate has meaningful id", () => {
		const html = '<div><div id="important"><div><p>text</p></div></div></div>';
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).toContain('id="important"');
	});

	test("does NOT collapse chains where intermediate has meaningful class", () => {
		const html = '<div><div class="sidebar"><div><p>text</p></div></div></div>';
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).toContain('class="sidebar"');
	});

	test("removes empty divs and spans with no content", () => {
		const html = `
			<div>
				<div></div>
				<span>   </span>
				<p>Keep this</p>
				<div><span></span></div>
			</div>
		`;
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).toContain("Keep this");
		// The only remaining structure should wrap "Keep this"
		expect(result).not.toContain("<span");
	});

	test("does NOT remove empty img, input, br, or hr elements", () => {
		const html = `
			<div>
				<img src="photo.jpg" alt="A photo">
				<input type="text" name="q">
				<br>
				<hr>
				<p>text</p>
			</div>
		`;
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).toContain("<img");
		expect(result).toContain("<input");
		expect(result).toContain("<br");
		expect(result).toContain("<hr");
	});

	test("truncates text when maxTextLength is set", () => {
		const longText = "a".repeat(600);
		const html = `<p>${longText}</p>`;
		const ds = new DomDownsampler({ maxTextLength: 100 });
		const result = ds.downsample(html);

		expect(result).toContain("...");
		// 100 chars + "..." = 103 inside <p>
		expect(result.length).toBeLessThan(html.length);
	});

	test("does not truncate when maxTextLength is 0 (default)", () => {
		const longText = "a".repeat(600);
		const html = `<p>${longText}</p>`;
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).not.toContain("...");
		expect(result).toContain(longText);
	});

	test("normalizes whitespace", () => {
		const html = `
			<div>
				<p>  lots   of    spaces  </p>
				<p>

				double newlines

				</p>
			</div>
		`;
		const ds = new DomDownsampler();
		const result = ds.downsample(html);

		expect(result).not.toContain("  "); // no double spaces
		expect(result).not.toMatch(/\n\s*\n/); // no double newlines
	});

	test("full pipeline: complex HTML produces significant size reduction", () => {
		const complexHtml = `
			<!DOCTYPE html>
			<html>
			<head><title>Test</title></head>
			<body>
				<script>var x = 1; var y = 2; console.log(x + y);</script>
				<style>body { margin: 0; } .container { max-width: 1200px; }</style>
				<noscript><p>Please enable JavaScript</p></noscript>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>
				<!-- Navigation comment -->
				<div data-analytics="nav" class="wrapper">
					<div>
						<div>
							<nav role="navigation">
								<a href="/home" data-track="home-link" onclick="track('home')">Home</a>
								<a href="/about" data-track="about-link">About</a>
							</nav>
						</div>
					</div>
				</div>
				<div data-testid="main" class="main">
					<div>
						<div>
							<article>
								<h1 data-heading="true">Welcome</h1>
								<p style="color: red;" class="intro">This is the intro paragraph.</p>
								<div><div><div><p>Deeply nested content.</p></div></div></div>
								<img src="hero.jpg" alt="Hero image" loading="lazy" data-src="hero-full.jpg">
								<div></div>
								<span></span>
								<div><span></span></div>
							</article>
						</div>
					</div>
				</div>
				<iframe src="https://ads.example.com/tracker"></iframe>
			</body>
			</html>
		`;

		const ds = new DomDownsampler();
		const result = ds.downsample(complexHtml);

		// Content preserved
		expect(result).toContain("Home");
		expect(result).toContain("About");
		expect(result).toContain("Welcome");
		expect(result).toContain("intro paragraph");
		expect(result).toContain("Deeply nested content");
		expect(result).toContain('src="hero.jpg"');

		// Boilerplate removed
		expect(result).not.toContain("<script");
		expect(result).not.toContain("<style");
		expect(result).not.toContain("<svg");
		expect(result).not.toContain("<iframe");
		expect(result).not.toContain("<!--");

		// Non-semantic attributes stripped
		expect(result).not.toContain("data-analytics");
		expect(result).not.toContain("data-track");
		expect(result).not.toContain("onclick");
		expect(result).not.toContain("loading=");
		expect(result).not.toContain("style=");

		// Significant size reduction
		expect(result.length).toBeLessThan(complexHtml.length * 0.5);
	});

	test("config disabled returns HTML with only whitespace normalization", () => {
		const html = '<div  data-x="1"><script>alert(1)</script><p>hello</p></div>';
		const ds = new DomDownsampler({ enabled: false });
		const result = ds.downsample(html);

		// Script tag should still be present
		expect(result).toContain("<script>");
		// data-x should still be present
		expect(result).toContain("data-x");
		// Content preserved
		expect(result).toContain("hello");
	});

	test("handles empty HTML gracefully", () => {
		const ds = new DomDownsampler();

		expect(ds.downsample("")).toBe("");
		expect(ds.downsample("   ")).toBe("");
		expect(ds.downsample("  \n\t  ")).toBe("");
	});

	test("handles malformed HTML gracefully", () => {
		const ds = new DomDownsampler();

		// Unclosed tags
		const result1 = ds.downsample("<div><p>unclosed");
		expect(result1).toContain("unclosed");

		// Random text without tags
		const result2 = ds.downsample("just plain text");
		expect(result2).toContain("just plain text");

		// Nested improperly
		const result3 = ds.downsample("<p><div>wrong nesting</div></p>");
		expect(result3).toContain("wrong nesting");
	});
});

describe("createDomDownsamplingConfig", () => {
	test("returns defaults with no overrides", () => {
		const config = createDomDownsamplingConfig();
		expect(config).toEqual(DEFAULT_DOM_DOWNSAMPLING_CONFIG);
	});

	test("applies overrides", () => {
		const config = createDomDownsamplingConfig({
			maxTextLength: 200,
			collapseContainers: false,
		});
		expect(config.maxTextLength).toBe(200);
		expect(config.collapseContainers).toBe(false);
		expect(config.enabled).toBe(true); // default preserved
	});
});
