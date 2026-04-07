import { describe, expect, test } from "bun:test";
import { cleanHtml, extractLinks, extractMedia, extractMetadata } from "../../src/utils/html";

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
});
