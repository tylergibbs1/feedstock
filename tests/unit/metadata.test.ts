import { describe, expect, test } from "bun:test";
import { extractMetadata } from "../../src/utils/html";

const RICH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test Page Title</title>
  <meta name="description" content="A test page description">
  <meta name="keywords" content="test, metadata, crawl">
  <meta name="author" content="Jane Doe">
  <meta name="generator" content="WordPress 6.4">
  <meta name="theme-color" content="#4285f4">
  <meta name="robots" content="index, follow">
  <meta name="referrer" content="no-referrer-when-downgrade">

  <link rel="canonical" href="https://example.com/page">
  <link rel="alternate" hreflang="es" href="https://example.com/es/page">
  <link rel="alternate" hreflang="fr" href="https://example.com/fr/page">
  <link rel="alternate" type="application/rss+xml" title="RSS Feed" href="/feed.xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-icon.png" sizes="180x180">

  <meta property="og:title" content="OG Title">
  <meta property="og:description" content="OG Description">
  <meta property="og:image" content="https://example.com/og.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="https://example.com/page">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Example Site">
  <meta property="og:locale" content="en_US">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@example">
  <meta name="twitter:creator" content="@janedoe">
  <meta name="twitter:title" content="Twitter Title">
  <meta name="twitter:image" content="https://example.com/twitter.jpg">

  <meta property="article:published_time" content="2024-01-15T10:00:00Z">
  <meta property="article:modified_time" content="2024-02-20T14:30:00Z">
  <meta property="article:author" content="Jane Doe">
  <meta property="article:section" content="Technology">
  <meta property="article:tag" content="web">
  <meta property="article:tag" content="crawling">

  <meta name="DC.title" content="DC Title">
  <meta name="DC.creator" content="DC Creator">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Test Article"
  }
  </script>
</head>
<body><h1>Test</h1></body>
</html>`;

describe("extractMetadata (rich)", () => {
	const meta = extractMetadata(RICH_HTML);

	test("extracts standard meta", () => {
		expect(meta.title).toBe("Test Page Title");
		expect(meta.description).toBe("A test page description");
		expect(meta.keywords).toBe("test, metadata, crawl");
		expect(meta.author).toBe("Jane Doe");
		expect(meta.generator).toBe("WordPress 6.4");
		expect(meta.themeColor).toBe("#4285f4");
		expect(meta.robots).toBe("index, follow");
		expect(meta.language).toBe("en");
		expect(meta.charset).toBe("utf-8");
		expect(meta.viewport).toBe("width=device-width, initial-scale=1");
	});

	test("extracts canonical and alternates", () => {
		expect(meta.canonical).toBe("https://example.com/page");
		expect((meta.alternates as unknown[]).length).toBeGreaterThanOrEqual(2);
	});

	test("extracts feeds", () => {
		expect(meta.feeds).toHaveLength(1);
		const feed = (meta.feeds as Array<{ href: string; title: string }>)[0];
		expect(feed.href).toBe("/feed.xml");
		expect(feed.title).toBe("RSS Feed");
	});

	test("extracts favicons", () => {
		expect(meta.favicons).toHaveLength(2);
	});

	test("extracts full Open Graph", () => {
		expect(meta.ogTitle).toBe("OG Title");
		expect(meta.ogDescription).toBe("OG Description");
		expect(meta.ogImage).toBe("https://example.com/og.jpg");
		expect(meta.ogImageWidth).toBe("1200");
		expect(meta.ogImageHeight).toBe("630");
		expect(meta.ogUrl).toBe("https://example.com/page");
		expect(meta.ogType).toBe("article");
		expect(meta.ogSiteName).toBe("Example Site");
		expect(meta.ogLocale).toBe("en_US");
	});

	test("extracts Twitter Card", () => {
		expect(meta.twitterCard).toBe("summary_large_image");
		expect(meta.twitterSite).toBe("@example");
		expect(meta.twitterCreator).toBe("@janedoe");
		expect(meta.twitterTitle).toBe("Twitter Title");
		expect(meta.twitterImage).toBe("https://example.com/twitter.jpg");
	});

	test("extracts article metadata", () => {
		expect(meta.articlePublishedTime).toBe("2024-01-15T10:00:00Z");
		expect(meta.articleModifiedTime).toBe("2024-02-20T14:30:00Z");
		expect(meta.articleAuthor).toBe("Jane Doe");
		expect(meta.articleSection).toBe("Technology");
		expect(meta.articleTags).toEqual(["web", "crawling"]);
	});

	test("extracts Dublin Core", () => {
		expect(meta.dcTitle).toBe("DC Title");
		expect(meta.dcCreator).toBe("DC Creator");
	});

	test("extracts JSON-LD", () => {
		expect(meta.jsonLd).toHaveLength(1);
		const ld = (meta.jsonLd as Array<Record<string, unknown>>)[0];
		expect(ld["@type"]).toBe("Article");
		expect(ld.headline).toBe("Test Article");
	});

	test("strips null values", () => {
		for (const [_key, value] of Object.entries(meta)) {
			expect(value).not.toBeNull();
		}
	});
});
