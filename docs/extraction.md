# Content Extraction Guide

Feedstock provides five built-in extraction strategies that transform cleaned HTML into structured data. Each strategy implements the `ExtractionStrategy` interface and returns an array of `ExtractedItem` objects:

```typescript
interface ExtractedItem {
  index: number;
  content: string;
  metadata?: Record<string, unknown>;
}
```

All strategies operate on cleaned HTML (after the scraping step removes nav, ads, overlays, etc.), so extraction runs against a simplified document by default.

---

## 1. Scraping Product Listings with CSS Extraction

`CssExtractionStrategy` uses Cheerio to select repeating elements and extract fields from each one. Define a schema with a `baseSelector` that matches every item, then declare fields with their selector, type, and (for attributes) the attribute name.

**Field types:**

| Type        | Behavior                                                  |
|-------------|-----------------------------------------------------------|
| `text`      | Returns the trimmed inner text of the first matching element. |
| `attribute` | Returns an attribute value (`href` by default).              |
| `html`      | Returns the inner HTML of the first matching element.        |
| `list`      | Returns an array of trimmed text from all matching elements. |

### Example: e-commerce product cards

```typescript
import {
  CssExtractionStrategy,
  type CssExtractionSchema,
} from "feedstock";

const schema: CssExtractionSchema = {
  name: "products",
  baseSelector: ".product-card",
  fields: [
    { name: "title", selector: "h2.product-title", type: "text" },
    { name: "price", selector: ".price", type: "text" },
    { name: "url", selector: "a.product-link", type: "attribute", attribute: "href" },
    { name: "image", selector: "img", type: "attribute", attribute: "src" },
    { name: "tags", selector: ".tag", type: "list" },
    { name: "description", selector: ".description", type: "html" },
  ],
};

const strategy = new CssExtractionStrategy(schema);
const items = await strategy.extract("https://shop.example.com", html);

// Each item.metadata contains the extracted record:
// {
//   title: "Wireless Headphones",
//   price: "$79.99",
//   url: "/products/wireless-headphones",
//   image: "/images/headphones.jpg",
//   tags: ["electronics", "audio", "sale"],
//   description: "<p>Noise-cancelling over-ear headphones...</p>"
// }
```

When `attribute` is omitted on an `attribute`-type field, it defaults to `"href"`.

---

## 2. Extracting Prices and Emails with Regex Extraction

`RegexExtractionStrategy` runs one or more patterns against the HTML and returns every match. Patterns can be strings (auto-compiled with the `g` flag) or `RegExp` objects. Named capture groups are exposed in `metadata.groups`.

### Example: prices and email addresses

```typescript
import { RegexExtractionStrategy } from "feedstock";

const strategy = new RegexExtractionStrategy([
  /\$(?<dollars>\d{1,3}(?:,\d{3})*)(?:\.(?<cents>\d{2}))?/g,
  /(?<user>[a-zA-Z0-9._%+-]+)@(?<domain>[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
]);

const items = await strategy.extract("https://example.com", html);

for (const item of items) {
  // item.content — the full match string, e.g. "$1,299.00" or "sales@example.com"
  // item.metadata.groups — named captures, e.g. { dollars: "1,299", cents: "00" }
  // item.metadata.captures — positional captures as an array
  // item.metadata.fullMatch — same as item.content
  console.log(item.content, item.metadata?.groups);
}
```

The strategy resets `lastIndex` before each pattern, so reusing a strategy instance across calls is safe.

---

## 3. Parsing Data Tables

`TableExtractionStrategy` finds every `<table>` element, extracts headers and rows, and returns structured table data. It handles both `<thead>`-based headers and the common pattern of using the first `<tr>` as a header row.

### Constructor options

| Option           | Type      | Default | Description                              |
|------------------|-----------|---------|------------------------------------------|
| `minRows`        | `number`  | `1`     | Skip tables with fewer body rows.         |
| `includeCaption` | `boolean` | `true`  | Include the `<caption>` text if present. |

### Example: extracting pricing tables

```typescript
import { TableExtractionStrategy } from "feedstock";

const strategy = new TableExtractionStrategy({ minRows: 2 });
const items = await strategy.extract("https://example.com/pricing", html);

for (const item of items) {
  const table = item.metadata as {
    headers: string[];
    rows: string[][];
    caption: string | null;
    rowCount: number;
    columnCount: number;
  };

  console.log(`Table: ${table.caption ?? "(no caption)"}`);
  console.log(`Columns: ${table.headers.join(", ")}`);
  for (const row of table.rows) {
    console.log(row);
  }
}
```

Each `ExtractedItem.content` is the JSON-stringified table object, and `metadata` holds the same data as a plain object for direct access.

---

## 4. XPath for Complex Documents

`XPathExtractionStrategy` accepts XPath expressions and converts them to CSS selectors internally. This is useful when you are working from XPath-based specifications or need patterns that are more natural in XPath syntax.

### Supported XPath patterns

| XPath pattern                       | CSS equivalent          |
|-------------------------------------|-------------------------|
| `//div`                             | `div`                   |
| `//div/span`                        | `div > span`            |
| `//div//span`                       | `div span`              |
| `.//span`                           | `span` (descendant)     |
| `//div[2]`                          | `div:nth-of-type(2)`    |
| `//a[@href]`                        | `a[href]`               |
| `//div[@class='active']`            | `div[class="active"]`   |
| `//div[contains(@class, 'card')]`   | `div[class*="card"]`    |
| `//p/text()`                        | `p` (text is implicit)  |

### Example: extracting articles from a news page

```typescript
import {
  XPathExtractionStrategy,
  type XPathExtractionSchema,
} from "feedstock";

const schema: XPathExtractionSchema = {
  name: "articles",
  baseXPath: "//article[contains(@class, 'post')]",
  fields: [
    { name: "headline", xpath: ".//h2", type: "text" },
    { name: "author", xpath: ".//span[@class='author']", type: "text" },
    { name: "link", xpath: ".//a[@href]", type: "attribute", attribute: "href" },
    { name: "summary", xpath: ".//div[@class='excerpt']", type: "html" },
  ],
};

const strategy = new XPathExtractionStrategy(schema);
const items = await strategy.extract("https://news.example.com", html);

// items[0].metadata:
// {
//   headline: "New Framework Released",
//   author: "Jane Smith",
//   link: "/posts/new-framework",
//   summary: "<p>A new framework for building...</p>"
// }
```

The XPath field types work identically to CSS fields: `text`, `attribute` (with optional `attribute` name, defaulting to `"href"`), and `html`.

Note: This strategy converts XPath to CSS selectors using pattern matching, so it supports the most common XPath constructs listed above. Full XPath features like axes (`following-sibling::`, `ancestor::`) or functions (`position()`, `last()`) are not supported.

---

## 5. Semantic Extraction with the Accessibility Tree

`AccessibilityExtractionStrategy` builds a static accessibility tree from the HTML using Cheerio. This produces a semantic view of the page -- headings, links, buttons, form inputs, images -- making it well-suited for AI pipelines, summarization, and semantic search indexing.

### Configuration

| Option           | Type       | Default    | Description                                         |
|------------------|------------|------------|-----------------------------------------------------|
| `roles`          | `string[]` | all roles  | Filter to only these ARIA roles.                    |
| `includeTreeText`| `boolean`  | `false`    | Prepend a full-text rendering of the tree as item 0.|

### Example: extracting navigation and headings for an AI pipeline

```typescript
import {
  AccessibilityExtractionStrategy,
  type AccessibilityExtractionConfig,
} from "feedstock";

const config: AccessibilityExtractionConfig = {
  roles: ["heading", "link", "button"],
  includeTreeText: true,
};

const strategy = new AccessibilityExtractionStrategy(config);
const items = await strategy.extract("https://docs.example.com", html);

// First item (when includeTreeText is true): full tree as plain text
// items[0].content — rendered text of the entire accessibility tree
// items[0].metadata — { type: "tree", nodeCount: 142 }

// Subsequent items: individual semantic elements
for (const item of items.slice(1)) {
  const { role, ref, url, level } = item.metadata as {
    role: string;
    ref: string;
    url?: string;
    level?: number;
  };

  if (role === "heading") {
    console.log(`H${level}: ${item.content}`);
  } else if (role === "link") {
    console.log(`Link: ${item.content} -> ${url}`);
  } else if (role === "button") {
    console.log(`Button: ${item.content}`);
  }
}
```

Additional metadata fields include `checked` (for checkboxes/radios), `disabled`, and `url` (for links). Since this strategy uses `buildStaticSnapshot` internally, it works without a live browser session -- HTML from any engine (Playwright, Fetch, or raw strings) works.

---

## 6. Using Extraction via Crawl Config

The simplest way to use extraction is through the `extractionStrategy` field on `CrawlerRunConfig`. The crawler resolves the strategy by `type` and passes `params` to the constructor.

### Supported type values

| `type`          | Strategy class                      | `params` shape                                          |
|-----------------|-------------------------------------|---------------------------------------------------------|
| `"css"`         | `CssExtractionStrategy`             | A `CssExtractionSchema` object                          |
| `"regex"`       | `RegexExtractionStrategy`           | `{ patterns: (string \| RegExp)[] }`                    |
| `"accessibility"` | `AccessibilityExtractionStrategy` | An `AccessibilityExtractionConfig` object               |

### Example: CSS extraction during a crawl

```typescript
import { WebCrawler, createCrawlerRunConfig } from "feedstock";

const crawler = new WebCrawler();

const result = await crawler.run("https://shop.example.com/deals", {
  extractionStrategy: {
    type: "css",
    params: {
      name: "deals",
      baseSelector: ".deal-item",
      fields: [
        { name: "title", selector: ".deal-title", type: "text" },
        { name: "price", selector: ".deal-price", type: "text" },
        { name: "link", selector: "a", type: "attribute", attribute: "href" },
      ],
    },
  },
});

// result.extractedContent is a JSON string of ExtractedItem[]
if (result.extractedContent) {
  const items = JSON.parse(result.extractedContent);
  for (const item of items) {
    console.log(item.metadata);
  }
}

await crawler.close();
```

### Example: regex extraction during a crawl

```typescript
const result = await crawler.run("https://example.com/contact", {
  extractionStrategy: {
    type: "regex",
    params: {
      patterns: [
        "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b",
      ],
    },
  },
});
```

### Example: accessibility extraction during a crawl

```typescript
const result = await crawler.run("https://docs.example.com", {
  extractionStrategy: {
    type: "accessibility",
    params: {
      roles: ["heading", "link"],
      includeTreeText: false,
    },
  },
});
```

When `extractionStrategy` is `null` (the default), no extraction runs and `result.extractedContent` is `null`.

Note: `TableExtractionStrategy` and `XPathExtractionStrategy` are not wired into `resolveExtractionStrategy` and must be used standalone (see below).

---

## 7. Using Strategies Standalone

Every extraction strategy can be used independently, without a crawler instance. This is useful for processing HTML you already have, building custom pipelines, or combining multiple strategies.

### With processHtml

The crawler's `processHtml` method runs the full scraping and extraction pipeline on raw HTML:

```typescript
import { WebCrawler } from "feedstock";

const crawler = new WebCrawler();

const result = await crawler.processHtml(rawHtml, {
  extractionStrategy: {
    type: "css",
    params: {
      name: "items",
      baseSelector: ".item",
      fields: [
        { name: "name", selector: ".name", type: "text" },
      ],
    },
  },
});

const items = JSON.parse(result.extractedContent!);
```

The optional third argument is a URL string (defaults to `"raw:"`).

### Importing strategies directly

For maximum control, instantiate a strategy and call `extract` yourself:

```typescript
import {
  CssExtractionStrategy,
  TableExtractionStrategy,
  RegexExtractionStrategy,
} from "feedstock";

const html = "<table><tr><th>Name</th><th>Price</th></tr>...</table>";

// Run table extraction
const tables = new TableExtractionStrategy({ minRows: 1 });
const tableItems = await tables.extract("https://example.com", html);

// Run CSS extraction on the same HTML
const css = new CssExtractionStrategy({
  name: "rows",
  baseSelector: "tr",
  fields: [{ name: "cells", selector: "td", type: "list" }],
});
const cssItems = await css.extract("https://example.com", html);

// Combine results from multiple strategies
const allItems = [...tableItems, ...cssItems];
```

This approach is the only way to use `TableExtractionStrategy` and `XPathExtractionStrategy`, which are not available through the config-based `type` field.

---

## 8. Building a Custom Strategy

To build your own extraction strategy, extend the `ExtractionStrategy` abstract class and implement the `extract` method.

```typescript
import { ExtractionStrategy, type ExtractedItem } from "feedstock";

/**
 * Extracts JSON-LD structured data from script tags.
 */
class JsonLdExtractionStrategy extends ExtractionStrategy {
  async extract(_url: string, html: string): Promise<ExtractedItem[]> {
    const items: ExtractedItem[] = [];
    const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = pattern.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        items.push({
          index: index++,
          content: JSON.stringify(data),
          metadata: {
            type: data["@type"],
            data,
          },
        });
      } catch {
        // Skip malformed JSON-LD blocks
      }
    }

    return items;
  }
}
```

### Using a custom strategy standalone

```typescript
const strategy = new JsonLdExtractionStrategy();
const items = await strategy.extract("https://example.com", html);

for (const item of items) {
  console.log(item.metadata?.type, item.content);
}
```

### Key conventions

- The `extract` method receives cleaned HTML (post-scraping) when called through the crawler, or raw HTML when called directly.
- Return an `ExtractedItem[]` where each item has a sequential `index`, a `content` string (typically JSON), and an optional `metadata` object for structured access.
- The `url` parameter is the page URL. Most strategies do not need it, but it can be useful for resolving relative URLs.
- Strategies are stateless. A single instance can be reused across multiple `extract` calls safely.
