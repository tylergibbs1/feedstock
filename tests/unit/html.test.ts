import { describe, expect, test } from "bun:test";
import {
	cleanHtml,
	extractLinks,
	extractMedia,
	extractMetadata,
	scrapeAll,
} from "../../src/utils/html";

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Test Page</title>
  <meta name="description" content="A test page">
  <meta name="keywords" content="test, html">
  <meta property="og:title" content="OG Test">
  <meta property="og:image" content="https://example.com/og.png">
  <link rel="canonical" href="https://example.com/page">
  <script>console.log("noise");</script>
  <style>body { color: red; }</style>
</head>
<body>
  <nav><a href="/home">Home</a></nav>
  <main>
    <h1>Hello World</h1>
    <p>Some content here.</p>
    <img src="/img/photo.jpg" alt="A photo" width="400">
    <img src="data:image/gif;base64,..." alt="" width="1">
    <a href="/about">About</a>
    <a href="https://external.com/page">External</a>
  </main>
  <footer><p>Footer</p></footer>
</body>
</html>`;

describe("cleanHtml", () => {
	test("removes script and style tags", () => {
		const cleaned = cleanHtml(SAMPLE_HTML);
		expect(cleaned).not.toContain("<script");
		expect(cleaned).not.toContain("console.log");
		expect(cleaned).not.toContain("<style");
		expect(cleaned).not.toContain("color: red");
	});

	test("preserves content", () => {
		const cleaned = cleanHtml(SAMPLE_HTML);
		expect(cleaned).toContain("Hello World");
		expect(cleaned).toContain("Some content here");
	});

	test("excludes specified tags", () => {
		const cleaned = cleanHtml(SAMPLE_HTML, { excludeTags: ["nav", "footer"] });
		expect(cleaned).not.toContain("Home");
		expect(cleaned).not.toContain("Footer");
		expect(cleaned).toContain("Hello World");
	});

	test("includes only specified tags", () => {
		const cleaned = cleanHtml(SAMPLE_HTML, { includeTags: ["main"] });
		expect(cleaned).toContain("Hello World");
		expect(cleaned).not.toContain("Home");
	});

	test("applies CSS selector", () => {
		const cleaned = cleanHtml(SAMPLE_HTML, { cssSelector: "h1" });
		expect(cleaned).toContain("Hello World");
		expect(cleaned).not.toContain("Some content");
	});

	test("onlyMainContent removes surrounding navigation", () => {
		const cleaned = cleanHtml(SAMPLE_HTML, { onlyMainContent: true, wordCountThreshold: 0 });
		expect(cleaned).toContain("Hello World");
		expect(cleaned).not.toContain("Home");
		expect(cleaned).not.toContain("Footer");
	});

	test("onlyMainContent prioritizes semantic main content over an earlier generic class", () => {
		const cleaned = cleanHtml(
			'<div class="content">Sidebar content that should not win selection.</div><main>Primary article content is selected even when it appears later.</main>',
			{ onlyMainContent: true, wordCountThreshold: 0 },
		);
		expect(cleaned).toContain("Primary article content");
		expect(cleaned).not.toContain("Sidebar content");
	});
});

describe("extractMetadata", () => {
	test("extracts title and meta tags", () => {
		const meta = extractMetadata(SAMPLE_HTML);
		expect(meta.title).toBe("Test Page");
		expect(meta.description).toBe("A test page");
		expect(meta.keywords).toBe("test, html");
		expect(meta.ogTitle).toBe("OG Test");
		expect(meta.ogImage).toBe("https://example.com/og.png");
		expect(meta.canonical).toBe("https://example.com/page");
		expect(meta.language).toBe("en");
	});

	test("resolves relative metadata URLs against the final page URL", () => {
		const meta = extractMetadata(
			'<link rel="canonical" href="../canonical"><meta property="og:image" content="/cover.jpg">',
			"https://example.com/articles/post/",
		);
		expect(meta.canonical).toBe("https://example.com/articles/canonical");
		expect(meta.ogImage).toBe("https://example.com/cover.jpg");
	});
});

describe("extractLinks", () => {
	test("splits internal and external links", () => {
		const links = extractLinks(SAMPLE_HTML, "https://example.com/");
		expect(links.internal.length).toBeGreaterThanOrEqual(2);
		expect(links.external.length).toBeGreaterThanOrEqual(1);
	});

	test("resolves relative URLs", () => {
		const links = extractLinks(SAMPLE_HTML, "https://example.com/");
		const aboutLink = links.internal.find((l) => l.href.includes("/about"));
		expect(aboutLink).toBeDefined();
		expect(aboutLink!.href).toBe("https://example.com/about");
	});

	test("extracts link text", () => {
		const links = extractLinks(SAMPLE_HTML, "https://example.com/");
		const homeLink = links.internal.find((l) => l.text === "Home");
		expect(homeLink).toBeDefined();
	});

	test("classifies external links correctly", () => {
		const links = extractLinks(SAMPLE_HTML, "https://example.com/");
		const extLink = links.external.find((l) => l.href.includes("external.com"));
		expect(extLink).toBeDefined();
		expect(extLink!.baseDomain).toBe("external.com");
	});

	test("respects base href, captures nested text and deduplicates links", () => {
		const links = extractLinks(
			'<base href="https://example.com/docs/"><a href="guide" rel="nofollow">Read <strong>the guide</strong></a><a href="guide">duplicate</a>',
			"https://example.com/start",
		);
		expect(links.internal).toHaveLength(1);
		expect(links.internal[0].href).toBe("https://example.com/docs/guide");
		expect(links.internal[0].text).toBe("Read the guide");
		expect(links.internal[0].nofollow).toBe(true);
	});

	test("absolutizes cleaned document URLs using base href", () => {
		const scraped = scrapeAll(
			'<base href="https://cdn.example.com/assets/"><main><a href="guide">Guide</a><img src="cover.png"></main>',
			"https://example.com/start",
			{ onlyMainContent: true, wordCountThreshold: 0 },
		);
		expect(scraped.cleanedHtml).toContain('href="https://cdn.example.com/assets/guide"');
		expect(scraped.cleanedHtml).toContain('src="https://cdn.example.com/assets/cover.png"');
		expect(scraped.media.images[0].src).toBe("https://cdn.example.com/assets/cover.png");
	});
});

describe("extractMedia", () => {
	test("extracts images with metadata", () => {
		const media = extractMedia(SAMPLE_HTML, "https://example.com/");
		expect(media.images.length).toBeGreaterThanOrEqual(1);
		const photo = media.images.find((i) => i.src.includes("photo.jpg"));
		expect(photo).toBeDefined();
		expect(photo!.alt).toBe("A photo");
		expect(photo!.width).toBe(400);
		expect(photo!.format).toBe("jpg");
	});

	test("scores images with alt text higher", () => {
		const media = extractMedia(SAMPLE_HTML, "https://example.com/");
		const withAlt = media.images.find((i) => i.alt === "A photo");
		const withoutAlt = media.images.find((i) => i.alt === "");
		if (withAlt && withoutAlt) {
			expect(withAlt.score).toBeGreaterThan(withoutAlt.score);
		}
	});

	test("resolves relative image URLs", () => {
		const media = extractMedia(SAMPLE_HTML, "https://example.com/");
		const photo = media.images.find((i) => i.src.includes("photo.jpg"));
		expect(photo!.src).toBe("https://example.com/img/photo.jpg");
	});

	test("can remove base64 images from compact scrape output", () => {
		const scraped = scrapeAll(SAMPLE_HTML, "https://example.com", {
			removeBase64Images: true,
		});
		expect(scraped.media.images.some((image) => image.src.startsWith("data:"))).toBe(false);
	});
});
