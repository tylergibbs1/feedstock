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

	constructor(opts: { timeout?: number; userAgent?: string } = {}) {
		this.timeout = opts.timeout ?? 15_000;
		this.userAgent = opts.userAgent ?? "feedstock";
	}

	/**
	 * Discover URLs from a domain's sitemap.
	 * Follows robots.txt → sitemap.xml chain.
	 */
	async seed(domain: string): Promise<SeedResult> {
		const origin = domain.startsWith("http") ? domain : `https://${domain}`;
		const urls = new Set<string>();
		const sitemaps = new Set<string>();

		// Try to find sitemaps from robots.txt
		const robotsSitemaps = await this.getSitemapsFromRobots(origin);
		for (const s of robotsSitemaps) sitemaps.add(s);

		// Fallback to common sitemap locations
		if (sitemaps.size === 0) {
			sitemaps.add(`${origin}/sitemap.xml`);
		}

		// Parse all sitemaps (including nested sitemap indexes)
		const visited = new Set<string>();
		const queue = [...sitemaps];

		while (queue.length > 0) {
			const sitemapUrl = queue.shift()!;
			if (visited.has(sitemapUrl)) continue;
			visited.add(sitemapUrl);

			const parsed = await this.parseSitemap(sitemapUrl);

			for (const url of parsed.urls) urls.add(url);
			for (const sub of parsed.sitemaps) {
				if (!visited.has(sub)) {
					sitemaps.add(sub);
					queue.push(sub);
				}
			}
		}

		return {
			urls: [...urls],
			sitemaps: [...sitemaps],
		};
	}

	private async getSitemapsFromRobots(origin: string): Promise<string[]> {
		try {
			const response = await fetch(`${origin}/robots.txt`, {
				headers: { "User-Agent": this.userAgent },
				signal: AbortSignal.timeout(this.timeout),
			});
			if (!response.ok) return [];

			const text = await response.text();
			const sitemaps: string[] = [];

			for (const line of text.split("\n")) {
				const match = line.match(/^sitemap:\s*(.+)/i);
				if (match) {
					sitemaps.push(match[1].trim());
				}
			}

			return sitemaps;
		} catch {
			return [];
		}
	}

	private async parseSitemap(url: string): Promise<{ urls: string[]; sitemaps: string[] }> {
		try {
			const response = await fetch(url, {
				headers: { "User-Agent": this.userAgent },
				signal: AbortSignal.timeout(this.timeout),
			});
			if (!response.ok) return { urls: [], sitemaps: [] };

			let text = await response.text();

			// Handle gzipped sitemaps
			if (url.endsWith(".gz")) {
				const buffer = await response.arrayBuffer();
				const decompressed = Bun.gunzipSync(new Uint8Array(buffer));
				text = new TextDecoder().decode(decompressed);
			}

			return this.parseXml(text);
		} catch {
			return { urls: [], sitemaps: [] };
		}
	}

	private parseXml(xml: string): { urls: string[]; sitemaps: string[] } {
		const urls: string[] = [];
		const sitemaps: string[] = [];

		// Extract <loc> from <url> entries
		const urlPattern = /<url>\s*<loc>\s*(.*?)\s*<\/loc>/gs;
		let match: RegExpExecArray | null;
		while ((match = urlPattern.exec(xml)) !== null) {
			const loc = match[1].trim();
			if (loc) urls.push(this.decodeXmlEntities(loc));
		}

		// Extract <loc> from <sitemap> entries (sitemap index)
		const sitemapPattern = /<sitemap>\s*<loc>\s*(.*?)\s*<\/loc>/gs;
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
}
