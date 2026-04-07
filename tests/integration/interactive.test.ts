import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { BrowserManager } from "../../src/browser/manager";
import { createBrowserConfig } from "../../src/config";
import { takeSnapshot } from "../../src/snapshot/accessibility";
import { detectInteractiveElements } from "../../src/utils/interactive";
import { loadStorageState, saveStorageState } from "../../src/utils/storage";
import { startTestServer, type TestServer } from "../helpers/server";

let server: TestServer;
let browserManager: BrowserManager;

beforeAll(async () => {
	server = startTestServer();
	browserManager = new BrowserManager(createBrowserConfig({ headless: true }));
	await browserManager.start();
});

afterAll(async () => {
	await browserManager.close();
	server.stop();
});

describe("detectInteractiveElements", () => {
	test("finds links, buttons, and inputs on real page", async () => {
		const { page, sessionId } = await browserManager.getPage();
		await page.goto(`${server.url}/`);

		const elements = await detectInteractiveElements(page);

		expect(elements.length).toBeGreaterThan(0);

		const links = elements.filter((e) => e.tag === "a");
		expect(links.length).toBeGreaterThanOrEqual(2);
		expect(links.some((l) => l.text.includes("About"))).toBe(true);

		await browserManager.killSession(sessionId);
	});

	test("includes href for links", async () => {
		const { page, sessionId } = await browserManager.getPage();
		await page.goto(`${server.url}/`);

		const elements = await detectInteractiveElements(page);
		const linksWithHref = elements.filter((e) => e.href);
		expect(linksWithHref.length).toBeGreaterThan(0);

		await browserManager.killSession(sessionId);
	});
});

describe("takeSnapshot (CDP)", () => {
	test("builds accessibility tree from live page", async () => {
		const { page, sessionId } = await browserManager.getPage();
		await page.goto(`${server.url}/`);

		const snap = await takeSnapshot(page);

		expect(snap.nodeCount).toBeGreaterThan(0);
		expect(snap.text).toContain("[heading]");
		expect(snap.text).toContain("[link]");
		expect(snap.refs.size).toBeGreaterThan(0);

		await browserManager.killSession(sessionId);
	});

	test("snapshot with interactiveOnly option", async () => {
		const { page, sessionId } = await browserManager.getPage();
		await page.goto(`${server.url}/`);

		const snap = await takeSnapshot(page, { interactiveOnly: true });

		// Should still have some refs (links at minimum)
		expect(snap.text.length).toBeGreaterThan(0);

		await browserManager.killSession(sessionId);
	});
});

describe("saveStorageState / loadStorageState", () => {
	const testPath = "/tmp/feedstock-test-storage.json";

	test("saves and loads browser storage state", async () => {
		const { page, sessionId } = await browserManager.getPage();
		await page.goto(`${server.url}/`);

		const context = page.context();
		const savedPath = await saveStorageState(context, testPath);
		expect(savedPath).toBe(testPath);
		expect(existsSync(testPath)).toBe(true);

		const state = loadStorageState(testPath);
		expect(state).not.toBeNull();
		expect(state!.savedAt).toBeGreaterThan(0);
		expect(Array.isArray(state!.cookies)).toBe(true);
		expect(Array.isArray(state!.origins)).toBe(true);

		// Clean up
		unlinkSync(testPath);
		await browserManager.killSession(sessionId);
	});
});
