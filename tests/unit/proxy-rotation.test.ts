import { describe, expect, test } from "bun:test";
import { ProxyRotationStrategy } from "../../src/utils/proxy-rotation";

describe("ProxyRotationStrategy", () => {
	const proxies = [
		{ server: "http://proxy1:8080" },
		{ server: "http://proxy2:8080" },
		{ server: "http://proxy3:8080" },
	];

	test("rotates through proxies in round-robin order", () => {
		const strategy = new ProxyRotationStrategy(proxies);
		expect(strategy.getProxy().server).toBe("http://proxy1:8080");
		expect(strategy.getProxy().server).toBe("http://proxy2:8080");
		expect(strategy.getProxy().server).toBe("http://proxy3:8080");
		expect(strategy.getProxy().server).toBe("http://proxy1:8080");
	});

	test("marks proxy unhealthy after repeated failures", () => {
		const strategy = new ProxyRotationStrategy(proxies, { maxFailures: 2 });
		const proxy = strategy.getProxy();
		strategy.reportResult(proxy, false);
		strategy.reportResult(proxy, false);
		expect(strategy.healthyCount).toBe(2);
	});

	test("skips unhealthy proxies", () => {
		const strategy = new ProxyRotationStrategy(proxies, { maxFailures: 1 });
		const first = strategy.getProxy();
		strategy.reportResult(first, false);

		const next = strategy.getProxy();
		expect(next.server).not.toBe(first.server);
	});

	test("recovers unhealthy proxies on success", () => {
		const strategy = new ProxyRotationStrategy(proxies, { maxFailures: 1 });
		const proxy = strategy.getProxy();
		strategy.reportResult(proxy, false);
		expect(strategy.healthyCount).toBe(2);

		strategy.reportResult(proxy, true);
		expect(strategy.healthyCount).toBe(3);
	});

	test("throws on empty proxy list", () => {
		expect(() => new ProxyRotationStrategy([])).toThrow();
	});

	test("tracks total count", () => {
		const strategy = new ProxyRotationStrategy(proxies);
		expect(strategy.totalCount).toBe(3);
	});
});
