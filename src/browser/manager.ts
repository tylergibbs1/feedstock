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

	async start(): Promise<void> {
		if (this.browser) return;

		const backend = this.config.backend;

		if (backend.kind === "lightpanda") {
			await this.startLightpanda(backend);
		} else {
			await this.startPlaywright();
		}
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
			this.logger.info("Launched local Lightpanda", { host, port });
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
