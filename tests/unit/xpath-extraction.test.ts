import { describe, expect, test } from "bun:test";
import { XPathExtractionStrategy } from "../../src/strategies/extraction/xpath";

const PRODUCTS_HTML = `
<div class="products">
  <div class="product">
    <h2 class="name">Widget A</h2>
    <span class="price">$9.99</span>
  </div>
  <div class="product">
    <h2 class="name">Widget B</h2>
    <span class="price">$19.99</span>
  </div>
</div>`;

describe("XPathExtractionStrategy", () => {
	test("extracts data using XPath-like selectors", async () => {
		const strategy = new XPathExtractionStrategy({
			name: "products",
			baseXPath: "//div[@class='product']",
			fields: [
				{ name: "title", xpath: ".//h2", type: "text" },
				{ name: "price", xpath: ".//span[@class='price']", type: "text" },
			],
		});

		const items = await strategy.extract("https://example.com", PRODUCTS_HTML);
		expect(items).toHaveLength(2);

		const first = JSON.parse(items[0].content);
		expect(first.title).toBe("Widget A");
		expect(first.price).toBe("$9.99");
	});

	test("handles attribute extraction", async () => {
		const html = '<div class="item"><a href="/page" class="link">Click</a></div>';
		const strategy = new XPathExtractionStrategy({
			name: "links",
			baseXPath: "//div[@class='item']",
			fields: [
				{ name: "url", xpath: ".//a", type: "attribute", attribute: "href" },
				{ name: "text", xpath: ".//a", type: "text" },
			],
		});

		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(1);
		const data = JSON.parse(items[0].content);
		expect(data.url).toBe("/page");
		expect(data.text).toBe("Click");
	});

	test("returns empty when no matches", async () => {
		const strategy = new XPathExtractionStrategy({
			name: "missing",
			baseXPath: "//div[@class='nonexistent']",
			fields: [{ name: "text", xpath: ".//p", type: "text" }],
		});

		const items = await strategy.extract("https://example.com", PRODUCTS_HTML);
		expect(items).toHaveLength(0);
	});
});
