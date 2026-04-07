/**
 * Per-domain rate limiter with exponential backoff.
 *
 * Tracks request timing per domain. On 429/503, increases delay exponentially.
 * On success, gradually reduces delay back toward the base.
 */

interface DomainState {
	lastRequestTime: number;
	currentDelay: number;
	failCount: number;
}

export interface RateLimiterConfig {
	baseDelay: number; // ms between requests to same domain (default 200)
	maxDelay: number; // max backoff delay in ms (default 30_000)
	backoffFactor: number; // multiplier on failure (default 2)
	recoveryFactor: number; // multiplier on success (default 0.75)
	jitter: number; // random jitter range 0-1 (default 0.1)
}

const DEFAULT_CONFIG: RateLimiterConfig = {
	baseDelay: 200,
	maxDelay: 30_000,
	backoffFactor: 2,
	recoveryFactor: 0.75,
	jitter: 0.1,
};

export class RateLimiter {
	private domains = new Map<string, DomainState>();
	private config: RateLimiterConfig;

	constructor(config: Partial<RateLimiterConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Wait if needed before making a request to this URL's domain.
	 * Returns the actual wait time in ms (0 if no wait was needed).
	 */
	async waitIfNeeded(url: string): Promise<number> {
		const domain = this.getDomain(url);
		if (!domain) return 0;

		const state = this.domains.get(domain);
		if (!state) {
			this.domains.set(domain, {
				lastRequestTime: Date.now(),
				currentDelay: this.config.baseDelay,
				failCount: 0,
			});
			return 0;
		}

		const elapsed = Date.now() - state.lastRequestTime;
		const delay = state.currentDelay + this.getJitter(state.currentDelay);
		const waitTime = Math.max(0, delay - elapsed);

		if (waitTime > 0) {
			await new Promise((resolve) => setTimeout(resolve, waitTime));
		}

		state.lastRequestTime = Date.now();
		return waitTime;
	}

	/**
	 * Report the result of a request. Adjusts backoff accordingly.
	 * Returns true if the delay was increased (caller may want to retry).
	 */
	reportResult(url: string, statusCode: number): boolean {
		const domain = this.getDomain(url);
		if (!domain) return false;

		let state = this.domains.get(domain);
		if (!state) {
			state = {
				lastRequestTime: Date.now(),
				currentDelay: this.config.baseDelay,
				failCount: 0,
			};
			this.domains.set(domain, state);
		}

		if (statusCode === 429 || statusCode === 503) {
			// Backoff
			state.failCount++;
			state.currentDelay = Math.min(
				state.currentDelay * this.config.backoffFactor,
				this.config.maxDelay,
			);
			return true;
		}

		// Success — gradually recover
		if (state.failCount > 0) {
			state.failCount = Math.max(0, state.failCount - 1);
		}
		if (state.currentDelay > this.config.baseDelay) {
			state.currentDelay = Math.max(
				this.config.baseDelay,
				state.currentDelay * this.config.recoveryFactor,
			);
		}

		return false;
	}

	/**
	 * Get the current delay for a domain (useful for monitoring).
	 */
	getDelay(url: string): number {
		const domain = this.getDomain(url);
		if (!domain) return 0;
		return this.domains.get(domain)?.currentDelay ?? this.config.baseDelay;
	}

	/**
	 * Set an explicit delay for a domain (e.g., from Retry-After header or robots.txt crawl-delay).
	 */
	setDelay(url: string, delayMs: number): void {
		const domain = this.getDomain(url);
		if (!domain) return;

		const state = this.domains.get(domain);
		if (state) {
			state.currentDelay = Math.min(delayMs, this.config.maxDelay);
		} else {
			this.domains.set(domain, {
				lastRequestTime: 0,
				currentDelay: Math.min(delayMs, this.config.maxDelay),
				failCount: 0,
			});
		}
	}

	clear(): void {
		this.domains.clear();
	}

	private getDomain(url: string): string | null {
		try {
			return new URL(url).hostname;
		} catch {
			return null;
		}
	}

	private getJitter(baseValue: number): number {
		if (this.config.jitter === 0) return 0;
		return (Math.random() - 0.5) * 2 * this.config.jitter * baseValue;
	}
}
