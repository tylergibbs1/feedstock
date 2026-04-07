import { describe, expect, test } from "bun:test";
import { NoExtractionStrategy } from "../../src/strategies/extraction/base";
import { CssExtractionStrategy } from "../../src/strategies/extraction/css";
import { RegexExtractionStrategy } from "../../src/strategies/extraction/regex";

const PRODUCTS_HTML = `
<div class="product-list">
  <div class="product">
    <h2 class="name">Widget A</h2>
    <span class="price">$9.99</span>
    <p class="desc">A fine widget.</p>
    <div class="tags">
      <span class="tag">electronics</span>
      <span class="tag">gadgets</span>
    </div>
  </div>
  <div class="product">
    <h2 class="name">Widget B</h2>
    <span class="price">$19.99</span>
    <p class="desc">A premium widget.</p>
    <div class="tags">
      <span class="tag">premium</span>
    </div>
  </div>
</div>`;

describe("CssExtractionStrategy", () => {
	test("extracts structured data from HTML", async () => {
		const strategy = new CssExtractionStrategy({
			name: "products",
			baseSelector: ".product",
			fields: [
				{ name: "title", selector: ".name", type: "text" },
				{ name: "price", selector: ".price", type: "text" },
				{ name: "description", selector: ".desc", type: "text" },
				{ name: "tags", selector: ".tag", type: "list" },
			],
		});

		const items = await strategy.extract("https://example.com", PRODUCTS_HTML);
		expect(items).toHaveLength(2);

		const first = JSON.parse(items[0].content);
		expect(first.title).toBe("Widget A");
		expect(first.price).toBe("$9.99");
		expect(first.description).toBe("A fine widget.");
		expect(first.tags).toEqual(["electronics", "gadgets"]);

		const second = JSON.parse(items[1].content);
		expect(second.title).toBe("Widget B");
		expect(second.price).toBe("$19.99");
		expect(second.tags).toEqual(["premium"]);
	});

	test("extracts attributes", async () => {
		const html = '<div class="item"><a href="/page" class="link">Click</a></div>';
		const strategy = new CssExtractionStrategy({
			name: "links",
			baseSelector: ".item",
			fields: [
				{ name: "url", selector: ".link", type: "attribute", attribute: "href" },
				{ name: "text", selector: ".link", type: "text" },
			],
		});

		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(1);
		const data = JSON.parse(items[0].content);
		expect(data.url).toBe("/page");
		expect(data.text).toBe("Click");
	});

	test("returns empty array when no matches", async () => {
		const strategy = new CssExtractionStrategy({
			name: "missing",
			baseSelector: ".nonexistent",
			fields: [{ name: "title", selector: "h1", type: "text" }],
		});

		const items = await strategy.extract("https://example.com", PRODUCTS_HTML);
		expect(items).toHaveLength(0);
	});
});

describe("RegexExtractionStrategy", () => {
	test("extracts matches from content", async () => {
		const strategy = new RegexExtractionStrategy([/\$\d+\.\d{2}/g]);
		const items = await strategy.extract("https://example.com", PRODUCTS_HTML);
		expect(items).toHaveLength(2);
		expect(items[0].content).toBe("$9.99");
		expect(items[1].content).toBe("$19.99");
	});

	test("handles named capture groups", async () => {
		const strategy = new RegexExtractionStrategy([/\$(?<dollars>\d+)\.(?<cents>\d{2})/g]);
		const items = await strategy.extract("https://example.com", PRODUCTS_HTML);
		expect(items[0].metadata?.groups).toEqual({ dollars: "9", cents: "99" });
	});

	test("supports multiple patterns", async () => {
		const strategy = new RegexExtractionStrategy([/Widget \w/g, /\$\d+\.\d{2}/g]);
		const items = await strategy.extract("https://example.com", PRODUCTS_HTML);
		expect(items.length).toBeGreaterThanOrEqual(4);
	});

	test("handles no matches gracefully", async () => {
		const strategy = new RegexExtractionStrategy([/zzzzz/g]);
		const items = await strategy.extract("https://example.com", PRODUCTS_HTML);
		expect(items).toHaveLength(0);
	});
});

describe("NoExtractionStrategy", () => {
	test("returns content as-is", async () => {
		const strategy = new NoExtractionStrategy();
		const items = await strategy.extract("https://example.com", "<p>Hello</p>");
		expect(items).toHaveLength(1);
		expect(items[0].content).toBe("<p>Hello</p>");
	});
});
