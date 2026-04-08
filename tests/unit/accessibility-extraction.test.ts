import { describe, expect, test } from "bun:test";
import { AccessibilityExtractionStrategy } from "../../src/strategies/extraction/accessibility";

const TEST_HTML = `<html>
<head><title>Shop</title></head>
<body>
  <h1>Products</h1>
  <h2>Electronics</h2>
  <a href="/laptop">Laptop Pro 15</a>
  <a href="/phone">Phone X</a>
  <button>Add to Cart</button>
  <input type="text" placeholder="Search products" />
  <input type="checkbox" name="inStock" />
  <img src="/laptop.jpg" alt="Laptop product image" />
  <p>Browse our selection of premium electronics and accessories for all your needs.</p>
</body>
</html>`;

describe("AccessibilityExtractionStrategy", () => {
	test("extracts all referenced nodes by default", async () => {
		const strategy = new AccessibilityExtractionStrategy();
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);

		expect(items.length).toBeGreaterThan(0);

		const roles = items.map((i) => i.metadata?.role);
		expect(roles).toContain("heading");
		expect(roles).toContain("link");
		expect(roles).toContain("button");
		expect(roles).toContain("textbox");
		expect(roles).toContain("checkbox");
		expect(roles).toContain("img");
	});

	test("filters by roles", async () => {
		const strategy = new AccessibilityExtractionStrategy({ roles: ["heading"] });
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);

		expect(items.length).toBe(2);
		expect(items[0].content).toBe("Products");
		expect(items[0].metadata?.level).toBe(1);
		expect(items[1].content).toBe("Electronics");
		expect(items[1].metadata?.level).toBe(2);
	});

	test("filters by multiple roles", async () => {
		const strategy = new AccessibilityExtractionStrategy({
			roles: ["link", "button"],
		});
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);

		const roles = new Set(items.map((i) => i.metadata?.role));
		expect(roles.size).toBe(2);
		expect(roles.has("link")).toBe(true);
		expect(roles.has("button")).toBe(true);
	});

	test("includes URL metadata for links", async () => {
		const strategy = new AccessibilityExtractionStrategy({ roles: ["link"] });
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);

		expect(items.length).toBe(2);
		expect(items[0].metadata?.url).toBe("/laptop");
		expect(items[0].content).toBe("Laptop Pro 15");
		expect(items[1].metadata?.url).toBe("/phone");
	});

	test("includes ref metadata", async () => {
		const strategy = new AccessibilityExtractionStrategy();
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);

		for (const item of items) {
			expect(item.metadata?.ref).toMatch(/^e\d+$/);
		}
	});

	test("includes tree text when configured", async () => {
		const strategy = new AccessibilityExtractionStrategy({
			includeTreeText: true,
		});
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);

		expect(items[0].metadata?.type).toBe("tree");
		expect(items[0].metadata?.nodeCount).toBeGreaterThan(0);
		expect(items[0].content).toContain("[heading]");
		expect(items[0].content).toContain("[link]");
	});

	test("returns sequential indices", async () => {
		const strategy = new AccessibilityExtractionStrategy();
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);

		for (let i = 0; i < items.length; i++) {
			expect(items[i].index).toBe(i);
		}
	});

	test("handles empty HTML", async () => {
		const strategy = new AccessibilityExtractionStrategy();
		const items = await strategy.extract("https://example.com", "<html><body></body></html>");
		expect(items).toHaveLength(0);
	});

	test("handles HTML with no matching roles", async () => {
		const strategy = new AccessibilityExtractionStrategy({ roles: ["slider"] });
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);
		expect(items).toHaveLength(0);
	});

	test("checkbox metadata includes checked state", async () => {
		const strategy = new AccessibilityExtractionStrategy({ roles: ["checkbox"] });
		const items = await strategy.extract("https://shop.example.com", TEST_HTML);

		expect(items.length).toBe(1);
		expect(items[0].metadata?.checked).toBeDefined();
	});
});
