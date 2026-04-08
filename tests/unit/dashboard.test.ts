import { afterAll, describe, expect, test } from "bun:test";
import { MonitorDashboard } from "../../src/utils/dashboard";
import { CrawlerMonitor } from "../../src/utils/monitor";

// Use a random high port to avoid conflicts
const TEST_PORT = 23400 + Math.floor(Math.random() * 1000);

describe("MonitorDashboard", () => {
	const monitor = new CrawlerMonitor();
	const dashboard = new MonitorDashboard(monitor, {
		port: TEST_PORT,
		hostname: "127.0.0.1",
		broadcastInterval: 100,
	});

	afterAll(() => {
		dashboard.stop();
	});

	test("starts and reports running", () => {
		monitor.start();
		dashboard.start();
		expect(dashboard.isRunning).toBe(true);
		expect(dashboard.url).toBe(`http://127.0.0.1:${TEST_PORT}`);
	});

	test("start is idempotent", () => {
		dashboard.start();
		expect(dashboard.isRunning).toBe(true);
	});

	test("GET / returns stats JSON", async () => {
		const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveProperty("pagesTotal");
		expect(data).toHaveProperty("pagesPerSecond");
		expect(data).toHaveProperty("elapsedMs");
	});

	test("GET /stats returns stats JSON", async () => {
		const res = await fetch(`http://127.0.0.1:${TEST_PORT}/stats`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.pagesTotal).toBe(0);
	});

	test("GET /health returns ok", async () => {
		const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ ok: true });
	});

	test("GET /unknown returns 404", async () => {
		const res = await fetch(`http://127.0.0.1:${TEST_PORT}/unknown`);
		expect(res.status).toBe(404);
	});

	test("stats reflect recorded pages", async () => {
		monitor.recordPageComplete({
			success: true,
			fromCache: false,
			responseTimeMs: 100,
			bytesDownloaded: 5000,
		});

		const res = await fetch(`http://127.0.0.1:${TEST_PORT}/stats`);
		const data = await res.json();
		expect(data.pagesTotal).toBe(1);
		expect(data.pagesSuccess).toBe(1);
		expect(data.bytesDownloaded).toBe(5000);
	});

	test("WebSocket connects and receives stats", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);

		const message = await new Promise<string>((resolve, reject) => {
			ws.onmessage = (e) => resolve(e.data as string);
			ws.onerror = () => reject(new Error("WebSocket error"));
			setTimeout(() => reject(new Error("WebSocket timeout")), 3000);
		});

		const data = JSON.parse(message);
		expect(data).toHaveProperty("pagesTotal");
		expect(data).toHaveProperty("pagesPerSecond");

		ws.close();
	});

	test("stop cleans up", () => {
		dashboard.stop();
		expect(dashboard.isRunning).toBe(false);
		expect(dashboard.url).toBeNull();
	});

	test("stop is idempotent", () => {
		dashboard.stop();
		expect(dashboard.isRunning).toBe(false);
	});
});
