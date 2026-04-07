/**
 * Storage state persistence — save/load cookies and localStorage
 * between crawler sessions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BrowserContext } from "playwright";

const DEFAULT_STORAGE_DIR = join(homedir(), ".feedstock", "storage");

export interface StorageState {
	cookies: CookieData[];
	origins: OriginStorage[];
	savedAt: number;
}

export interface CookieData {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
}

export interface OriginStorage {
	origin: string;
	localStorage: Array<{ name: string; value: string }>;
}

/**
 * Save storage state (cookies + localStorage) from a browser context.
 */
export async function saveStorageState(
	context: BrowserContext,
	filePath?: string,
): Promise<string> {
	const path = filePath ?? join(DEFAULT_STORAGE_DIR, "state.json");
	const dir = dirname(path);

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const state = await context.storageState();

	const storageState: StorageState = {
		cookies: state.cookies.map((c) => ({
			name: c.name,
			value: c.value,
			domain: c.domain,
			path: c.path,
			expires: c.expires,
			httpOnly: c.httpOnly,
			secure: c.secure,
			sameSite: c.sameSite,
		})),
		origins: state.origins.map((o) => ({
			origin: o.origin,
			localStorage: o.localStorage,
		})),
		savedAt: Date.now(),
	};

	writeFileSync(path, JSON.stringify(storageState, null, 2));
	return path;
}

/**
 * Load storage state from file. Returns null if file doesn't exist.
 */
export function loadStorageState(filePath?: string): StorageState | null {
	const path = filePath ?? join(DEFAULT_STORAGE_DIR, "state.json");

	if (!existsSync(path)) return null;

	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as StorageState;
	} catch {
		return null;
	}
}

/**
 * Apply a saved storage state to a browser context.
 */
export async function applyStorageState(
	context: BrowserContext,
	state: StorageState,
): Promise<void> {
	// Add cookies
	if (state.cookies.length > 0) {
		await context.addCookies(state.cookies);
	}

	// localStorage requires navigating to each origin
	// This is handled automatically by Playwright's storageState option
}

/**
 * Get the Playwright-compatible storage state path for use
 * in browser context creation.
 */
export function getStorageStatePath(filePath?: string): string | null {
	const path = filePath ?? join(DEFAULT_STORAGE_DIR, "state.json");
	return existsSync(path) ? path : null;
}
