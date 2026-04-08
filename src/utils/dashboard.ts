/**
 * Live monitoring dashboard using Bun.serve().
 *
 * Exposes crawler stats via HTTP JSON API and WebSocket for real-time updates.
 */

import type { Server, ServerWebSocket } from "bun";
import type { CrawlerMonitor } from "./monitor";

export interface DashboardConfig {
	/** Port to listen on (default: 3200) */
	port: number;
	/** Hostname to bind to (default: "127.0.0.1") */
	hostname: string;
	/** WebSocket broadcast interval in ms (default: 1000) */
	broadcastInterval: number;
}

const DEFAULT_CONFIG: DashboardConfig = {
	port: 3200,
	hostname: "127.0.0.1",
	broadcastInterval: 1000,
};

export class MonitorDashboard {
	private server: Server<undefined> | null = null;
	private monitor: CrawlerMonitor;
	private config: DashboardConfig;
	private broadcastTimer: Timer | null = null;
	private clients = new Set<ServerWebSocket<undefined>>();

	constructor(monitor: CrawlerMonitor, config: Partial<DashboardConfig> = {}) {
		this.monitor = monitor;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	start(): void {
		if (this.server) return;

		const self = this;

		this.server = Bun.serve({
			port: this.config.port,
			hostname: this.config.hostname,

			fetch(req, server) {
				const url = new URL(req.url);

				// WebSocket upgrade
				if (url.pathname === "/ws") {
					if (server.upgrade(req)) return;
					return new Response("WebSocket upgrade failed", { status: 400 });
				}

				// JSON stats endpoint
				if (url.pathname === "/stats" || url.pathname === "/") {
					return Response.json(self.monitor.getStats());
				}

				// Health check
				if (url.pathname === "/health") {
					return Response.json({ ok: true });
				}

				return new Response("Not found", { status: 404 });
			},

			websocket: {
				open(ws) {
					self.clients.add(ws);
					ws.send(JSON.stringify(self.monitor.getStats()));
				},
				close(ws) {
					self.clients.delete(ws);
				},
				message() {
					// No client messages expected
				},
			},
		});

		// Broadcast stats periodically to all WebSocket clients
		this.broadcastTimer = setInterval(() => {
			if (self.clients.size === 0) return;
			const stats = JSON.stringify(self.monitor.getStats());
			for (const client of self.clients) {
				try {
					client.send(stats);
				} catch {
					self.clients.delete(client);
				}
			}
		}, this.config.broadcastInterval);
	}

	stop(): void {
		if (this.broadcastTimer) {
			clearInterval(this.broadcastTimer);
			this.broadcastTimer = null;
		}

		for (const client of this.clients) {
			try {
				client.close();
			} catch {
				// Already closed
			}
		}
		this.clients.clear();

		if (this.server) {
			this.server.stop();
			this.server = null;
		}
	}

	get url(): string | null {
		if (!this.server) return null;
		return `http://${this.config.hostname}:${this.config.port}`;
	}

	get isRunning(): boolean {
		return this.server !== null;
	}
}
