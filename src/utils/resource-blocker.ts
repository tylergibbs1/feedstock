/**
 * Resource blocking profiles for faster page loads.
 *
 * Profiles:
 *   - "fast"       — block images, fonts, and media (keeps CSS/JS)
 *   - "minimal"    — block everything except HTML and JS
 *   - "media-only" — block only heavy media (images, video, audio)
 *
 * Also supports custom configs with glob patterns and resource types.
 */

import type { BrowserContext } from "playwright";
import type { BlockResourcesConfig } from "../config";

interface ResolvedBlockConfig {
	patterns: string[];
	resourceTypes: string[];
}

const PROFILES: Record<string, ResolvedBlockConfig> = {
	fast: {
		patterns: [
			"**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,woff,woff2,ttf,eot,mp4,mp3,avi,mov}",
		],
		resourceTypes: ["font", "media"],
	},
	minimal: {
		patterns: [
			"**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,woff,woff2,ttf,eot,mp4,mp3,avi,mov,css}",
		],
		resourceTypes: ["stylesheet", "font", "media", "image"],
	},
	"media-only": {
		patterns: [
			"**/*.{png,jpg,jpeg,gif,webp,avif,mp4,mp3,avi,mov,webm}",
		],
		resourceTypes: ["image", "media"],
	},
};

function resolveConfig(config: BlockResourcesConfig): ResolvedBlockConfig | null {
	if (config === false) return null;

	if (config === true) {
		// Backward compat: true = "fast" profile
		return PROFILES.fast;
	}

	if (typeof config === "string") {
		const profile = PROFILES[config];
		if (!profile) {
			throw new Error(
				`Unknown resource block profile "${config}". ` +
					`Available: ${Object.keys(PROFILES).join(", ")}`,
			);
		}
		return profile;
	}

	// Custom config
	return {
		patterns: config.patterns ?? [],
		resourceTypes: config.resourceTypes ?? [],
	};
}

/**
 * Apply resource blocking to a browser context based on config.
 */
export async function applyResourceBlocking(
	ctx: BrowserContext,
	config: BlockResourcesConfig,
): Promise<void> {
	const resolved = resolveConfig(config);
	if (!resolved) return;

	// Block by glob patterns
	for (const pattern of resolved.patterns) {
		await ctx.route(pattern, (route) => route.abort());
	}

	// Block by resource type
	if (resolved.resourceTypes.length > 0) {
		const blockedTypes = new Set(resolved.resourceTypes);
		await ctx.route("**/*", (route) => {
			const type = route.request().resourceType();
			if (blockedTypes.has(type)) {
				return route.abort();
			}
			return route.continue();
		});
	}
}
