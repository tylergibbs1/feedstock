import { describe, expect, test } from "bun:test";
import { loadStorageState } from "../../src/utils/storage";

describe("loadStorageState", () => {
	test("returns null for non-existent file", async () => {
		const state = await loadStorageState("/tmp/nonexistent-feedstock-storage.json");
		expect(state).toBeNull();
	});

	test("returns null for invalid JSON", async () => {
		const path = "/tmp/feedstock-bad-storage.json";
		await Bun.write(path, "not json");
		const state = await loadStorageState(path);
		// Should not crash
		expect(state).toBeNull();
	});
});
