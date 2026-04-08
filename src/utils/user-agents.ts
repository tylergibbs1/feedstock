/**
 * User-agent rotation pool.
 * Provides realistic browser user-agents to avoid fingerprinting.
 */

const USER_AGENTS = [
	// Chrome on Windows
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	// Chrome on Mac
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	// Firefox on Windows
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
	// Firefox on Mac
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
	// Safari on Mac
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
	// Chrome on Linux
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	// Edge on Windows
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
];

/**
 * Get a random user-agent string from the pool.
 */
export function getRandomUserAgent(): string {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Round-robin user-agent rotation.
 */
export class UserAgentRotator {
	private index = 0;
	private pool: string[];

	constructor(customPool?: string[]) {
		this.pool = customPool ?? USER_AGENTS;
	}

	next(): string {
		const ua = this.pool[this.index % this.pool.length];
		this.index++;
		return ua;
	}

	get size(): number {
		return this.pool.length;
	}
}
