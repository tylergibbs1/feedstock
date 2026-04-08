import { describe, expect, test } from "bun:test";
import { getBool, getNumber, getString, getStringArray, parseArgs } from "../../src/cli/parse-args";

describe("parseArgs", () => {
	test("extracts command from first positional", () => {
		const result = parseArgs(["crawl", "https://example.com"]);
		expect(result.command).toBe("crawl");
		expect(result.positionals).toEqual(["https://example.com"]);
	});

	test("empty args", () => {
		const result = parseArgs([]);
		expect(result.command).toBe("");
		expect(result.positionals).toEqual([]);
		expect(result.flags).toEqual({});
	});

	test("parses boolean flag", () => {
		const result = parseArgs(["crawl", "--screenshot"]);
		expect(result.flags.screenshot).toBe(true);
	});

	test("parses --no-flag as false", () => {
		const result = parseArgs(["crawl", "--no-markdown"]);
		expect(result.flags.markdown).toBe(false);
	});

	test("parses --flag=value", () => {
		const result = parseArgs(["crawl", "--output=json"]);
		expect(result.flags.output).toBe("json");
	});

	test("parses --flag value", () => {
		const result = parseArgs(["crawl", "--output", "json"]);
		expect(result.flags.output).toBe("json");
	});

	test("flag value that looks like a flag is treated as boolean", () => {
		const result = parseArgs(["crawl", "--screenshot", "--pdf"]);
		expect(result.flags.screenshot).toBe(true);
		expect(result.flags.pdf).toBe(true);
	});

	test("repeated flags accumulate into arrays", () => {
		const result = parseArgs([
			"deep-crawl",
			"--exclude-pattern",
			"/admin",
			"--exclude-pattern",
			"/login",
		]);
		expect(result.flags["exclude-pattern"]).toEqual(["/admin", "/login"]);
	});

	test("-- stops flag parsing", () => {
		const result = parseArgs(["crawl", "--", "--not-a-flag", "positional"]);
		expect(result.flags).toEqual({});
		expect(result.positionals).toEqual(["--not-a-flag", "positional"]);
	});

	test("multiple positionals", () => {
		const result = parseArgs(["crawl-many", "https://a.com", "https://b.com"]);
		expect(result.command).toBe("crawl-many");
		expect(result.positionals).toEqual(["https://a.com", "https://b.com"]);
	});

	test("mixed flags and positionals", () => {
		const result = parseArgs([
			"crawl",
			"https://example.com",
			"--screenshot",
			"--output",
			"json",
			"--page-timeout",
			"5000",
		]);
		expect(result.command).toBe("crawl");
		expect(result.positionals).toEqual(["https://example.com"]);
		expect(result.flags.screenshot).toBe(true);
		expect(result.flags.output).toBe("json");
		expect(result.flags["page-timeout"]).toBe("5000");
	});
});

describe("flag accessors", () => {
	test("getString returns string value", () => {
		expect(getString({ output: "json" }, "output")).toBe("json");
	});

	test("getString returns undefined for missing", () => {
		expect(getString({}, "output")).toBeUndefined();
	});

	test("getString returns undefined for boolean", () => {
		expect(getString({ flag: true }, "flag")).toBeUndefined();
	});

	test("getNumber parses numeric string", () => {
		expect(getNumber({ timeout: "5000" }, "timeout")).toBe(5000);
	});

	test("getNumber returns undefined for non-numeric", () => {
		expect(getNumber({ timeout: "abc" }, "timeout")).toBeUndefined();
	});

	test("getNumber returns undefined for missing", () => {
		expect(getNumber({}, "timeout")).toBeUndefined();
	});

	test("getBool returns true for boolean true", () => {
		expect(getBool({ flag: true }, "flag")).toBe(true);
	});

	test("getBool returns false for boolean false", () => {
		expect(getBool({ flag: false }, "flag")).toBe(false);
	});

	test("getBool returns true for string 'true'", () => {
		expect(getBool({ flag: "true" }, "flag")).toBe(true);
	});

	test("getBool returns false for string 'false'", () => {
		expect(getBool({ flag: "false" }, "flag")).toBe(false);
	});

	test("getBool returns undefined for missing", () => {
		expect(getBool({}, "flag")).toBeUndefined();
	});

	test("getStringArray splits comma-separated", () => {
		expect(getStringArray({ tags: "a,b,c" }, "tags")).toEqual(["a", "b", "c"]);
	});

	test("getStringArray handles array values", () => {
		expect(getStringArray({ tags: ["a,b", "c"] }, "tags")).toEqual(["a", "b", "c"]);
	});

	test("getStringArray returns undefined for missing", () => {
		expect(getStringArray({}, "tags")).toBeUndefined();
	});
});
