/**
 * Cache validation via HTTP HEAD requests.
 * Checks ETag and Last-Modified headers to determine freshness.
 */

export interface CacheValidationResult {
	fresh: boolean;
	etag: string | null;
	lastModified: string | null;
}

export class CacheValidator {
	private timeout: number;

	constructor(opts: { timeout?: number } = {}) {
		this.timeout = opts.timeout ?? 10_000;
	}

	/**
	 * Check if cached content is still fresh by sending a HEAD request.
	 */
	async validate(
		url: string,
		cachedEtag?: string | null,
		cachedLastModified?: string | null,
	): Promise<CacheValidationResult> {
		try {
			const headers: Record<string, string> = {};
			if (cachedEtag) {
				headers["If-None-Match"] = cachedEtag;
			}
			if (cachedLastModified) {
				headers["If-Modified-Since"] = cachedLastModified;
			}

			const response = await fetch(url, {
				method: "HEAD",
				headers,
				signal: AbortSignal.timeout(this.timeout),
				redirect: "follow",
			});

			if (response.status === 304) {
				// Not modified — cache is fresh
				return {
					fresh: true,
					etag: response.headers.get("etag") ?? cachedEtag ?? null,
					lastModified: response.headers.get("last-modified") ?? cachedLastModified ?? null,
				};
			}

			// Response has new content
			return {
				fresh: false,
				etag: response.headers.get("etag") ?? null,
				lastModified: response.headers.get("last-modified") ?? null,
			};
		} catch {
			// Network error — assume stale to be safe
			return { fresh: false, etag: null, lastModified: null };
		}
	}
}
