import { describe, expect, test } from "bun:test";
import { CacheMode, shouldReadCache, shouldWriteCache } from "../../src/cache/mode";

describe("shouldReadCache", () => {
	test("Enabled → true", () => expect(shouldReadCache(CacheMode.Enabled)).toBe(true));
	test("ReadOnly → true", () => expect(shouldReadCache(CacheMode.ReadOnly)).toBe(true));
	test("WriteOnly → false", () => expect(shouldReadCache(CacheMode.WriteOnly)).toBe(false));
	test("Disabled → false", () => expect(shouldReadCache(CacheMode.Disabled)).toBe(false));
	test("Bypass → false", () => expect(shouldReadCache(CacheMode.Bypass)).toBe(false));
});

describe("shouldWriteCache", () => {
	test("Enabled → true", () => expect(shouldWriteCache(CacheMode.Enabled)).toBe(true));
	test("WriteOnly → true", () => expect(shouldWriteCache(CacheMode.WriteOnly)).toBe(true));
	test("ReadOnly → false", () => expect(shouldWriteCache(CacheMode.ReadOnly)).toBe(false));
	test("Disabled → false", () => expect(shouldWriteCache(CacheMode.Disabled)).toBe(false));
	test("Bypass → false", () => expect(shouldWriteCache(CacheMode.Bypass)).toBe(false));
});
