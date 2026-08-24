/**
 * URL canonicalization helpers used for crawl deduplication and cache keys.
 * Navigation URLs and identity keys are intentionally separate concerns: callers
 * can opt out of query sorting/removal for signed or order-sensitive URLs.
 */

const TRACKING_PARAMETERS = new Set([
	"dclid",
	"fbclid",
	"gclid",
	"gbraid",
	"igshid",
	"mc_cid",
	"mc_eid",
	"mkt_tok",
	"msclkid",
	"ttclid",
	"twclid",
	"wbraid",
	"yclid",
]);

const TRACKING_PREFIXES = ["utm_", "_hsenc", "_hsmi"];

export interface NormalizeUrlOptions {
	/** Remove the fragment because it is not sent to the server. Default: true. */
	removeFragment?: boolean;
	/** Remove well-known analytics parameters such as utm_source and gclid. Default: true. */
	removeTrackingParameters?: boolean;
	/** Remove the complete query string. Default: false. */
	ignoreQueryParameters?: boolean;
	/** Sort query parameters to produce a stable identity key. Default: true. */
	sortQueryParameters?: boolean;
	/** Treat /path and /path/ as the same resource. Default: true. */
	stripTrailingSlash?: boolean;
}

/**
 * Convert an HTTP(S) URL into a stable representation suitable for crawl
 * deduplication and cache identity. Returns null for invalid/non-web URLs.
 */
export function normalizeUrl(
	input: string,
	baseUrl?: string,
	options: NormalizeUrlOptions = {},
): string | null {
	let url: URL;
	try {
		url = baseUrl ? new URL(input, baseUrl) : new URL(input);
	} catch {
		return null;
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") return null;

	if (options.removeFragment ?? true) url.hash = "";

	if (options.ignoreQueryParameters ?? false) {
		url.search = "";
	} else {
		if (options.removeTrackingParameters ?? true) {
			for (const key of [...url.searchParams.keys()]) {
				const normalizedKey = key.toLowerCase();
				if (
					TRACKING_PARAMETERS.has(normalizedKey) ||
					TRACKING_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
				) {
					url.searchParams.delete(key);
				}
			}
		}
		if (options.sortQueryParameters ?? true) url.searchParams.sort();
	}

	if ((options.stripTrailingSlash ?? true) && url.pathname.length > 1) {
		url.pathname = url.pathname.replace(/\/+$/, "");
	}

	return url.href;
}

/** Return true when candidate belongs to the same host (or an allowed subdomain). */
export function isSameDomain(
	candidate: string,
	reference: string,
	includeSubdomains = false,
): boolean {
	try {
		const candidateHost = new URL(candidate).hostname.toLowerCase();
		const referenceHost = new URL(reference).hostname.toLowerCase();
		return (
			candidateHost === referenceHost ||
			(includeSubdomains && candidateHost.endsWith(`.${referenceHost}`))
		);
	} catch {
		return false;
	}
}

/** Stable JSON for cache fingerprints, including RegExp values. */
export function stableStringify(value: unknown): string {
	const seen = new WeakSet<object>();

	return JSON.stringify(value, (_key, item: unknown) => {
		if (item instanceof RegExp) return { source: item.source, flags: item.flags };
		if (!item || typeof item !== "object") return item;
		if (seen.has(item)) return "[Circular]";
		seen.add(item);
		if (Array.isArray(item)) return item;
		return Object.fromEntries(
			Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
		);
	});
}
