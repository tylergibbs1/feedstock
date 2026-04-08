import { describe, expect, test } from "bun:test";
import { renderHelp, SCHEMAS } from "../../src/cli/schema";

describe("SCHEMAS", () => {
	test("has all 7 commands", () => {
		const names = Object.keys(SCHEMAS);
		expect(names).toContain("crawl");
		expect(names).toContain("crawl-many");
		expect(names).toContain("deep-crawl");
		expect(names).toContain("process");
		expect(names).toContain("schema");
		expect(names).toContain("cache");
		expect(names).toContain("monitor");
		expect(names).toHaveLength(7);
	});

	test("crawl has url arg", () => {
		const schema = SCHEMAS.crawl;
		expect(schema.args).toHaveLength(1);
		expect(schema.args[0].name).toBe("url");
		expect(schema.args[0].required).toBe(true);
	});

	test("crawl has common flags", () => {
		const flags = SCHEMAS.crawl.flags;
		expect(flags).toHaveProperty("output");
		expect(flags).toHaveProperty("fields");
		expect(flags).toHaveProperty("json");
		expect(flags).toHaveProperty("screenshot");
		expect(flags).toHaveProperty("block-resources");
		expect(flags).toHaveProperty("cache-mode");
	});

	test("deep-crawl has depth/pages/dry-run flags", () => {
		const flags = SCHEMAS["deep-crawl"].flags;
		expect(flags).toHaveProperty("max-depth");
		expect(flags).toHaveProperty("max-pages");
		expect(flags).toHaveProperty("dry-run");
		expect(flags).toHaveProperty("domain-filter");
		expect(flags).toHaveProperty("scorer");
	});

	test("crawl-many has concurrency and stdin flags", () => {
		const flags = SCHEMAS["crawl-many"].flags;
		expect(flags).toHaveProperty("concurrency");
		expect(flags).toHaveProperty("stdin");
	});

	test("cache has older-than flag", () => {
		const flags = SCHEMAS.cache.flags;
		expect(flags).toHaveProperty("older-than");
	});

	test("monitor has port and hostname flags", () => {
		const flags = SCHEMAS.monitor.flags;
		expect(flags).toHaveProperty("port");
		expect(flags).toHaveProperty("hostname");
	});

	test("every flag has a description", () => {
		for (const schema of Object.values(SCHEMAS)) {
			for (const [name, def] of Object.entries(schema.flags)) {
				expect(def.description, `${schema.name} --${name} missing description`).toBeTruthy();
			}
		}
	});

	test("every flag has a type", () => {
		for (const schema of Object.values(SCHEMAS)) {
			for (const [name, def] of Object.entries(schema.flags)) {
				expect(def.type, `${schema.name} --${name} missing type`).toBeTruthy();
			}
		}
	});
});

describe("renderHelp", () => {
	test("includes command name and description", () => {
		const help = renderHelp(SCHEMAS.crawl);
		expect(help).toContain("feedstock crawl");
		expect(help).toContain("Crawl a single page");
	});

	test("includes usage line with args", () => {
		const help = renderHelp(SCHEMAS.crawl);
		expect(help).toContain("Usage: feedstock crawl <url>");
	});

	test("includes flags section", () => {
		const help = renderHelp(SCHEMAS.crawl);
		expect(help).toContain("Flags:");
		expect(help).toContain("--screenshot");
		expect(help).toContain("--output");
	});

	test("shows defaults for flags", () => {
		const help = renderHelp(SCHEMAS.crawl);
		expect(help).toContain("(default:");
	});

	test("shows enum values", () => {
		const help = renderHelp(SCHEMAS.crawl);
		expect(help).toContain("[json|ndjson|text]");
	});
});
