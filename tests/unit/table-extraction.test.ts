import { describe, expect, test } from "bun:test";
import { TableExtractionStrategy } from "../../src/strategies/extraction/table";

const TABLE_HTML = `
<html><body>
<table>
  <caption>User Data</caption>
  <thead>
    <tr><th>Name</th><th>Age</th><th>City</th></tr>
  </thead>
  <tbody>
    <tr><td>Alice</td><td>30</td><td>New York</td></tr>
    <tr><td>Bob</td><td>25</td><td>San Francisco</td></tr>
    <tr><td>Charlie</td><td>35</td><td>Chicago</td></tr>
  </tbody>
</table>
<table>
  <tr><td>Tiny</td></tr>
</table>
</body></html>`;

describe("TableExtractionStrategy", () => {
	test("extracts table with headers and rows", async () => {
		const strategy = new TableExtractionStrategy();
		const items = await strategy.extract("https://example.com", TABLE_HTML);
		expect(items.length).toBeGreaterThanOrEqual(1);

		const table = JSON.parse(items[0].content);
		expect(table.headers).toEqual(["Name", "Age", "City"]);
		expect(table.rows).toHaveLength(3);
		expect(table.rows[0]).toEqual(["Alice", "30", "New York"]);
		expect(table.caption).toBe("User Data");
		expect(table.rowCount).toBe(3);
		expect(table.columnCount).toBe(3);
	});

	test("respects minRows filter", async () => {
		const strategy = new TableExtractionStrategy({ minRows: 2 });
		const items = await strategy.extract("https://example.com", TABLE_HTML);
		// Only the table with 3 rows should be extracted (tiny table has 1 row)
		expect(items).toHaveLength(1);
	});

	test("handles tables without thead", async () => {
		const html = `<table>
			<tr><th>A</th><th>B</th></tr>
			<tr><td>1</td><td>2</td></tr>
		</table>`;
		const strategy = new TableExtractionStrategy();
		const items = await strategy.extract("https://example.com", html);
		expect(items).toHaveLength(1);
		const table = JSON.parse(items[0].content);
		expect(table.headers).toEqual(["A", "B"]);
	});

	test("returns empty for no tables", async () => {
		const strategy = new TableExtractionStrategy();
		const items = await strategy.extract(
			"https://example.com",
			"<html><body><p>No tables</p></body></html>",
		);
		expect(items).toHaveLength(0);
	});
});
