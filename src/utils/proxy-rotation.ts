/**
 * Round-robin proxy rotation strategy with health tracking.
 */

import type { ProxyConfig } from "../config";

interface ProxyState {
	proxy: ProxyConfig;
	failCount: number;
	lastUsed: number;
	healthy: boolean;
}

export interface ProxyRotationConfig {
	maxFailures: number;
	recoveryInterval: number; // ms before retrying an unhealthy proxy
}

const DEFAULT_CONFIG: ProxyRotationConfig = {
	maxFailures: 3,
	recoveryInterval: 60_000,
};

export class ProxyRotationStrategy {
	private proxies: ProxyState[];
	private index = 0;
	private config: ProxyRotationConfig;

	constructor(proxies: ProxyConfig[], config: Partial<ProxyRotationConfig> = {}) {
		if (proxies.length === 0) {
			throw new Error("ProxyRotationStrategy requires at least one proxy");
		}
		this.proxies = proxies.map((proxy) => ({
			proxy,
			failCount: 0,
			lastUsed: 0,
			healthy: true,
		}));
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Get the next available proxy in round-robin order.
	 * Skips unhealthy proxies unless all are unhealthy.
	 */
	getProxy(): ProxyConfig {
		const now = Date.now();

		// Try to recover unhealthy proxies
		for (const state of this.proxies) {
			if (!state.healthy && now - state.lastUsed > this.config.recoveryInterval) {
				state.healthy = true;
				state.failCount = 0;
			}
		}

		// Find next healthy proxy
		const startIndex = this.index;
		for (let i = 0; i < this.proxies.length; i++) {
			const idx = (startIndex + i) % this.proxies.length;
			const state = this.proxies[idx];
			if (state.healthy) {
				this.index = (idx + 1) % this.proxies.length;
				state.lastUsed = now;
				return state.proxy;
			}
		}

		// All unhealthy — use the one with the lowest fail count
		const best = this.proxies.reduce((a, b) => (a.failCount <= b.failCount ? a : b));
		best.lastUsed = now;
		return best.proxy;
	}

	/**
	 * Report the result of using a proxy. Marks unhealthy after repeated failures.
	 */
	reportResult(proxy: ProxyConfig, success: boolean): void {
		const state = this.proxies.find((p) => p.proxy.server === proxy.server);
		if (!state) return;

		if (success) {
			state.failCount = Math.max(0, state.failCount - 1);
			state.healthy = true;
		} else {
			state.failCount++;
			if (state.failCount >= this.config.maxFailures) {
				state.healthy = false;
			}
		}
	}

	get healthyCount(): number {
		return this.proxies.filter((p) => p.healthy).length;
	}

	get totalCount(): number {
		return this.proxies.length;
	}
}
