import {
	type Browser,
	type BrowserContext,
	chromium,
	firefox,
	type Page,
	type BrowserType as PlaywrightBrowserType,
	webkit,
} from "playwright";
import type { BrowserConfig, BrowserType } from "../config";
import { applyStealthMode } from "../utils/antibot";
import type { Logger } from "../utils/logger";
import { SilentLogger } from "../utils/logger";
import { getRandomUserAgent } from "../utils/user-agents";

/** Errors that indicate a transient connection failure worth retrying. */
const TRANSIENT_PATTERNS = [
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"EPIPE",
	"WebSocket error",
	"Target closed",
	"browser has been closed",
	"Navigation failed",
];

function isTransientError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

const BROWSER_LAUNCHERS: Record<BrowserType, PlaywrightBrowserType> = {
	chromium,
	firefox,
	webkit,
};

interface ManagedSession {
	context: BrowserContext;
	page: Page;
	createdAt: number;
}

const MAX_SESSIONS = 20;

export class BrowserManager {
	private browser: Browser | null = null;
	private sessions = new Map<string, ManagedSession>();
	private sessionOrder: string[] = []; // LRU tracking
	private config: BrowserConfig;
	private logger: Logger;
	private lightpandaProcess: LightpandaProcess | null = null;

	constructor(config: BrowserConfig) {
		this.config = config;
		this.logger = config.logger ?? new SilentLogger();
	}

	async start(opts: { maxRetries?: number; baseDelayMs?: number } = {}): Promise<void> {
		if (this.browser) return;

		const maxRetries = opts.maxRetries ?? 3;
		const baseDelay = opts.baseDelayMs ?? 500;

		for (let attempt = 0; ; attempt++) {
			try {
				const backend = this.config.backend;
				if (backend.kind === "cdp") {
					await this.startCDP(backend);
				} else if (backend.kind === "lightpanda") {
					await this.startLightpanda(backend);
				} else {
					await this.startPlaywright();
				}
				return;
			} catch (err) {
				// Clean up any partially-started resources before retrying
				await this.cleanupFailedStart();

				if (attempt < maxRetries && isTransientError(err)) {
					const delay = Math.min(baseDelay * 2 ** attempt, 30_000);
					this.logger.warn(
						`Browser start failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`,
						{ error: err instanceof Error ? err.message : String(err) },
					);
					await new Promise((r) => setTimeout(r, delay));
					continue;
				}
				throw err;
			}
		}
	}

	/**
	 * Clean up partially-started resources after a failed start attempt.
	 * Kills any spawned Lightpanda process and resets browser state
	 * so the next retry starts fresh.
	 */
	private async cleanupFailedStart(): Promise<void> {
		if (this.browser) {
			try {
				await this.browser.close();
			} catch {
				// May already be dead
			}
			this.browser = null;
		}

		if (this.lightpandaProcess) {
			this.lightpandaProcess.kill();
			this.lightpandaProcess = null;
			this.logger.debug("Cleaned up Lightpanda process from failed start attempt");
		}
	}

	private async startCDP(
		backend: Extract<BrowserConfig["backend"], { kind: "cdp" }>,
	): Promise<void> {
		this.logger.info("Connecting via CDP", { wsUrl: backend.wsUrl });
		this.browser = await chromium.connectOverCDP(backend.wsUrl);
		this.logger.info("Connected via CDP");
	}

	private async startPlaywright(): Promise<void> {
		const launcher = BROWSER_LAUNCHERS[this.config.browserType];
		this.logger.info(`Launching ${this.config.browserType} via Playwright`, {
			headless: this.config.headless,
		});

		this.browser = await launcher.launch({
			headless: this.config.headless,
			args: this.config.extraArgs,
			...(this.config.proxy && { proxy: this.config.proxy }),
		});
	}

	private async startLightpanda(
		backend: Extract<BrowserConfig["backend"], { kind: "lightpanda" }>,
	): Promise<void> {
		let endpointURL: string;

		if (backend.mode === "cloud") {
			const base = backend.endpoint ?? "wss://euwest.cloud.lightpanda.io/ws";
			endpointURL = `${base}?token=${backend.token}`;
			this.logger.info("Connecting to Lightpanda Cloud", { endpoint: base });
		} else {
			// Local mode — launch via @lightpanda/browser
			const host = backend.host ?? "127.0.0.1";
			const port = backend.port ?? 9222;

			this.lightpandaProcess = await launchLightpanda({ host, port });
			endpointURL = `ws://${host}:${port}`;
			this.logger.info("Launched local Lightpanda, waiting for CDP ready", { host, port });
			await waitForCDPReady(endpointURL);
			this.logger.info("Lightpanda CDP endpoint ready", { host, port });
		}

		this.browser = await chromium.connectOverCDP(endpointURL);
		this.logger.info("Connected to Lightpanda via CDP");
	}

	async getPage(sessionId?: string | null): Promise<{ page: Page; sessionId: string }> {
		if (!this.browser) {
			throw new Error("Browser not started. Call start() first.");
		}

		const sid = sessionId ?? crypto.randomUUID();

		// Return existing session if available
		const existing = this.sessions.get(sid);
		if (existing) {
			// Move to end of LRU order
			this.sessionOrder = this.sessionOrder.filter((s) => s !== sid);
			this.sessionOrder.push(sid);
			return { page: existing.page, sessionId: sid };
		}

		// Evict oldest session if at capacity
		if (this.sessions.size >= MAX_SESSIONS) {
			const oldest = this.sessionOrder.shift();
			if (oldest) {
				this.logger.debug(`Evicting oldest session ${oldest} (max ${MAX_SESSIONS})`);
				await this.killSession(oldest);
			}
		}

		// Resolve user-agent: explicit > stealth random > default
		const userAgent =
			this.config.userAgent ?? (this.config.stealth ? getRandomUserAgent() : undefined);

		// Create new context and page
		const context = await this.browser.newContext({
			viewport: this.config.viewport,
			ignoreHTTPSErrors: this.config.ignoreHttpsErrors,
			javaScriptEnabled: this.config.javaEnabled,
			serviceWorkers: "block",
			...(userAgent && { userAgent }),
		});

		const page = await context.newPage();

		// Apply stealth: override navigator.webdriver, plugins, languages
		if (this.config.stealth) {
			await applyStealthMode(page);
		}
		this.sessions.set(sid, { context, page, createdAt: Date.now() });
		this.sessionOrder.push(sid);
		this.logger.debug(`Created session ${sid}`);

		return { page, sessionId: sid };
	}

	async killSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		this.sessionOrder = this.sessionOrder.filter((s) => s !== sessionId);

		try {
			await session.page.close();
			await session.context.close();
		} catch {
			// Page/context may already be closed
		}
		this.sessions.delete(sessionId);
		this.logger.debug(`Killed session ${sessionId}`);
	}

	async close(): Promise<void> {
		// Close all sessions
		for (const [sid] of this.sessions) {
			await this.killSession(sid);
		}

		if (this.browser) {
			await this.browser.close();
			this.browser = null;
			this.logger.info("Browser closed");
		}

		if (this.lightpandaProcess) {
			this.lightpandaProcess.kill();
			this.lightpandaProcess = null;
			this.logger.info("Lightpanda process stopped");
		}
	}

	get isRunning(): boolean {
		return this.browser !== null;
	}

	get activeSessions(): number {
		return this.sessions.size;
	}
}

// ---------------------------------------------------------------------------
// Lightpanda process management
// ---------------------------------------------------------------------------

interface LightpandaProcess {
	kill(): void;
}

/**
 * Poll a CDP endpoint until it responds or timeout is reached.
 * Prevents race conditions when connecting to a freshly-launched browser.
 */
async function waitForCDPReady(
	endpoint: string,
	opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
	const timeout = opts.timeoutMs ?? 10_000;
	const interval = opts.intervalMs ?? 200;
	const deadline = Date.now() + timeout;

	// Convert ws:// to http:// for the version endpoint
	const httpUrl = endpoint.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://");
	const versionUrl = `${httpUrl}/json/version`;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(versionUrl, { signal: AbortSignal.timeout(1000) });
			if (response.ok) return;
		} catch {
			// Not ready yet
		}
		await new Promise((r) => setTimeout(r, interval));
	}

	throw new Error(
		`CDP endpoint ${endpoint} not ready after ${timeout}ms. ` +
			`The browser process may have failed to start.`,
	);
}

async function launchLightpanda(opts: { host: string; port: number }): Promise<LightpandaProcess> {
	try {
		const { lightpanda } = await import("@lightpanda/browser");
		const proc = await lightpanda.serve(opts);
		return {
			kill() {
				try {
					proc.stdout?.destroy();
					proc.stderr?.destroy();
					proc.kill();
				} catch {
					// Process may already be dead
				}
			},
		};
	} catch (err) {
		throw new Error(
			`Failed to launch Lightpanda. Make sure @lightpanda/browser is installed:\n` +
				`  bun add @lightpanda/browser\n\n` +
				`Original error: ${err instanceof Error ? err.message : err}`,
		);
	}
}
