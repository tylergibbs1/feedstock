/**
 * URL seeder — discovers URLs from sitemaps.
 */

export interface SeedResult {
	urls: string[];
	sitemaps: string[];
}

export class URLSeeder {
	private timeout: number;
	private userAgent: string;
	private maxUrls: number;
	private maxSitemaps: number;
	private signal: AbortSignal | null;

	constructor(
		opts: {
			timeout?: number;
			userAgent?: string;
			maxUrls?: number;
			maxSitemaps?: number;
			signal?: AbortSignal;
		} = {},
	) {
		this.timeout = opts.timeout ?? 15_000;
		this.userAgent = opts.userAgent ?? "feedstock";
		this.maxUrls = Math.max(1, opts.maxUrls ?? 50_000);
		this.maxSitemaps = Math.max(1, opts.maxSitemaps ?? 25);
		this.signal = opts.signal ?? null;
	}

	/**
	 * Discover URLs from a domain's sitemap.
	 * Follows robots.txt → sitemap.xml chain.
	 */
	async seed(domain: string): Promise<SeedResult> {
		const input = domain.startsWith("http") ? domain : `https://${domain}`;
		const origin = new URL(input).origin;
		const urls = new Set<string>();
		const sitemaps = new Set<string>();

		// Try to find sitemaps from robots.txt
		const robotsSitemaps = await this.getSitemapsFromRobots(origin);
		for (const sitemap of robotsSitemaps.slice(0, this.maxSitemaps)) {
			const resolved = this.resolveWebUrl(sitemap, origin);
			if (resolved) sitemaps.add(resolved);
		}

		// Fallback to common sitemap locations
		if (sitemaps.size === 0) {
			sitemaps.add(`${origin}/sitemap.xml`);
		}

		// Parse all sitemaps (including nested sitemap indexes)
		const visited = new Set<string>();
		const queue = [...sitemaps];

		while (queue.length > 0 && visited.size < this.maxSitemaps && urls.size < this.maxUrls) {
			this.signal?.throwIfAborted();
			const sitemapUrl = queue.shift()!;
			if (visited.has(sitemapUrl)) continue;
			visited.add(sitemapUrl);

			const parsed = await this.parseSitemap(sitemapUrl);

			for (const url of parsed.urls) {
				if (urls.size >= this.maxUrls) break;
				const resolved = this.resolveWebUrl(url, sitemapUrl);
				if (resolved) urls.add(resolved);
			}
			for (const sub of parsed.sitemaps) {
				const resolved = this.resolveWebUrl(sub, sitemapUrl);
				if (
					!resolved ||
					visited.has(resolved) ||
					sitemaps.has(resolved) ||
					sitemaps.size >= this.maxSitemaps
				)
					continue;
				sitemaps.add(resolved);
				queue.push(resolved);
			}
		}

		return {
			urls: [...urls],
			sitemaps: [...sitemaps],
		};
	}

	private async getSitemapsFromRobots(origin: string): Promise<string[]> {
		try {
			this.signal?.throwIfAborted();
			const response = await fetch(`${origin}/robots.txt`, {
				headers: { "User-Agent": this.userAgent },
				signal: this.requestSignal(),
			});
			if (!response.ok) return [];

			const text = await response.text();
			const sitemaps: string[] = [];

			for (const line of text.split("\n")) {
				const match = line.match(/^sitemap:\s*(.+)/i);
				if (match) {
					sitemaps.push(new URL(match[1].trim(), origin).href);
				}
			}

			return sitemaps;
		} catch {
			if (this.signal?.aborted) throw this.signal.reason;
			return [];
		}
	}

	private async parseSitemap(url: string): Promise<{ urls: string[]; sitemaps: string[] }> {
		try {
			this.signal?.throwIfAborted();
			const response = await fetch(url, {
				headers: { "User-Agent": this.userAgent },
				signal: this.requestSignal(),
			});
			if (!response.ok) return { urls: [], sitemaps: [] };

			const bytes = new Uint8Array(await response.arrayBuffer());
			const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
			const decoded = isGzip ? Bun.gunzipSync(bytes) : bytes;
			const text = new TextDecoder().decode(decoded);

			return this.parseXml(text);
		} catch {
			if (this.signal?.aborted) throw this.signal.reason;
			return { urls: [], sitemaps: [] };
		}
	}

	private parseXml(xml: string): { urls: string[]; sitemaps: string[] } {
		const urls: string[] = [];
		const sitemaps: string[] = [];

		// Extract <loc> from <url> entries
		const urlPattern = /<url\b[^>]*>[\s\S]*?<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi;
		let match: RegExpExecArray | null;
		while ((match = urlPattern.exec(xml)) !== null) {
			const loc = match[1].trim();
			if (loc) urls.push(this.decodeXmlEntities(loc));
		}

		// Extract <loc> from <sitemap> entries (sitemap index)
		const sitemapPattern = /<sitemap\b[^>]*>[\s\S]*?<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi;
		while ((match = sitemapPattern.exec(xml)) !== null) {
			const loc = match[1].trim();
			if (loc) sitemaps.push(this.decodeXmlEntities(loc));
		}

		return { urls, sitemaps };
	}

	private decodeXmlEntities(text: string): string {
		return text
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'");
	}

	private requestSignal(): AbortSignal {
		const timeout = AbortSignal.timeout(this.timeout);
		return this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
	}

	private resolveWebUrl(input: string, base: string): string | null {
		try {
			const url = new URL(input, base);
			return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
		} catch {
			return null;
		}
	}
}
