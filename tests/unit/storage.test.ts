import { describe, expect, test } from "bun:test";
import { loadStorageState } from "../../src/utils/storage";

describe("loadStorageState", () => {
	test("returns null for non-existent file", () => {
		const state = loadStorageState("/tmp/nonexistent-feedstock-storage.json");
		expect(state).toBeNull();
	});

	test("returns null for invalid JSON", () => {
		const path = "/tmp/feedstock-bad-storage.json";
		Bun.write(path, "not json");
		const state = loadStorageState(path);
		// Should not crash
		expect(state).toBeNull();
	});
});
