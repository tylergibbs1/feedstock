import { describe, expect, test } from "bun:test";
import { createCrawlerRunConfig } from "../../src/config";
import { likelyNeedsJavaScript } from "../../src/engines/base";
import { EngineManager } from "../../src/engines/engine-manager";
import { FetchEngine } from "../../src/engines/fetch";

describe("FetchEngine", () => {
	test("has correct capabilities", () => {
		const engine = new FetchEngine();
		expect(engine.name).toBe("fetch");
		expect(engine.capabilities.javascript).toBe(false);
		expect(engine.capabilities.screenshot).toBe(false);
		expect(engine.capabilities.customJs).toBe(false);
	});

	test("cannot handle screenshot requests", () => {
		const engine = new FetchEngine();
		const config = createCrawlerRunConfig({ screenshot: true });
		expect(engine.canHandle(config)).toBe(false);
	});

	test("can handle simple crawl requests", () => {
		const engine = new FetchEngine();
		const config = createCrawlerRunConfig();
		expect(engine.canHandle(config)).toBe(true);
	});

	test("cannot handle JS code execution", () => {
		const engine = new FetchEngine();
		const config = createCrawlerRunConfig({ jsCode: "console.log('hi')" });
		expect(engine.canHandle(config)).toBe(false);
	});

	test("cannot handle wait-for-selector", () => {
		const engine = new FetchEngine();
		const config = createCrawlerRunConfig({
			waitFor: { kind: "selector", value: "#loaded" },
		});
		expect(engine.canHandle(config)).toBe(false);
	});
});

describe("likelyNeedsJavaScript", () => {
	test("detects React SPA shell", () => {
		const html = '<html><body><div id="root"></div><script src="app.js"></script></body></html>';
		expect(likelyNeedsJavaScript(html)).toBe(true);
	});

	test("detects Next.js shell", () => {
		const html =
			'<html><body><div id="__next"></div><script>window.__NEXT_DATA__={}</script></body></html>';
		expect(likelyNeedsJavaScript(html)).toBe(true);
	});

	test("does not flag static HTML", () => {
		const html =
			"<html><body><h1>Hello World</h1><p>This is a full page with plenty of content rendered server-side. It has multiple paragraphs and sections that indicate this is a fully rendered HTML page.</p></body></html>";
		expect(likelyNeedsJavaScript(html)).toBe(false);
	});

	test("detects empty body", () => {
		const html = "<html><body>   </body></html>";
		expect(likelyNeedsJavaScript(html)).toBe(true);
	});
});

describe("EngineManager", () => {
	test("reports engine names", () => {
		const manager = new EngineManager([new FetchEngine()]);
		expect(manager.engineNames).toEqual(["fetch"]);
	});

	test("sorts engines by quality (cheapest first)", () => {
		const fetch = new FetchEngine(); // quality 5
		const manager = new EngineManager([fetch]);
		expect(manager.engineNames[0]).toBe("fetch");
	});
});
