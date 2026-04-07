export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

export interface Logger {
	debug(msg: string, data?: Record<string, unknown>): void;
	info(msg: string, data?: Record<string, unknown>): void;
	warn(msg: string, data?: Record<string, unknown>): void;
	error(msg: string, data?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
	private level: number;
	private tag: string;

	constructor(opts: { level?: LogLevel; tag?: string } = {}) {
		this.level = LEVEL_ORDER[opts.level ?? "info"];
		this.tag = opts.tag ?? "feedstock";
	}

	debug(msg: string, data?: Record<string, unknown>) {
		if (this.level <= LEVEL_ORDER.debug) {
			console.debug(`[${this.tag}] ${msg}`, data ?? "");
		}
	}

	info(msg: string, data?: Record<string, unknown>) {
		if (this.level <= LEVEL_ORDER.info) {
			console.info(`[${this.tag}] ${msg}`, data ?? "");
		}
	}

	warn(msg: string, data?: Record<string, unknown>) {
		if (this.level <= LEVEL_ORDER.warn) {
			console.warn(`[${this.tag}] ${msg}`, data ?? "");
		}
	}

	error(msg: string, data?: Record<string, unknown>) {
		if (this.level <= LEVEL_ORDER.error) {
			console.error(`[${this.tag}] ${msg}`, data ?? "");
		}
	}
}

export class SilentLogger implements Logger {
	debug() {}
	info() {}
	warn() {}
	error() {}
}
