/**
 * Lightweight sitemap parser using regex (no XML dependency).
 *
 * Handles standard sitemaps (<urlset>) and sitemap index files
 * (<sitemapindex>) with their simple, predictable XML structure.
 */

export interface SitemapEntry {
	loc: string;
	lastmod?: string;
	changefreq?: string;
	priority?: number;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a sitemap XML string into entries.
 * Handles both regular sitemaps (<urlset>) and sitemap index files
 * (<sitemapindex> where each <sitemap> has a <loc>).
 */
export function parseSitemap(xml: string): SitemapEntry[] {
	if (typeof xml !== "string" || xml.length === 0) return [];

	// Detect sitemap index vs regular sitemap
	if (/<sitemapindex[\s>]/i.test(xml)) {
		return parseSitemapIndex(xml);
	}
	return parseUrlset(xml);
}

function parseUrlset(xml: string): SitemapEntry[] {
	const entries: SitemapEntry[] = [];
	const urlBlocks = xml.match(/<url\b[^>]*>[\s\S]*?<\/url>/gi);
	if (!urlBlocks) return entries;

	for (const block of urlBlocks) {
		const loc = extractTag(block, "loc");
		if (!loc) continue;

		const entry: SitemapEntry = { loc };
		const lastmod = extractTag(block, "lastmod");
		if (lastmod) entry.lastmod = lastmod;
		const changefreq = extractTag(block, "changefreq");
		if (changefreq) entry.changefreq = changefreq;
		const priority = extractTag(block, "priority");
		if (priority) {
			const n = Number(priority);
			if (!Number.isNaN(n)) entry.priority = n;
		}
		entries.push(entry);
	}
	return entries;
}

function parseSitemapIndex(xml: string): SitemapEntry[] {
	const entries: SitemapEntry[] = [];
	const sitemapBlocks = xml.match(/<sitemap\b[^>]*>[\s\S]*?<\/sitemap>/gi);
	if (!sitemapBlocks) return entries;

	for (const block of sitemapBlocks) {
		const loc = extractTag(block, "loc");
		if (!loc) continue;

		const entry: SitemapEntry = { loc };
		const lastmod = extractTag(block, "lastmod");
		if (lastmod) entry.lastmod = lastmod;
		entries.push(entry);
	}
	return entries;
}

function extractTag(xml: string, tag: string): string | undefined {
	const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
	const m = xml.match(re);
	return m ? m[1].trim() : undefined;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch and parse a sitemap from a URL.
 * Tries /sitemap.xml first, then /sitemap_index.xml.
 */
export async function fetchSitemap(baseUrl: string): Promise<SitemapEntry[]> {
	const origin = new URL(baseUrl).origin;
	const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

	for (const url of candidates) {
		try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(15_000),
				redirect: "follow",
			});
			if (!res.ok) continue;
			const text = await res.text();
			const entries = parseSitemap(text);
			if (entries.length > 0) return entries;
		} catch {
			// Network error — try next candidate
		}
	}
	return [];
}

// ---------------------------------------------------------------------------
// Index builder
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from URL to sitemap entry for fast access.
 */
export function buildSitemapIndex(entries: SitemapEntry[]): Map<string, SitemapEntry> {
	const map = new Map<string, SitemapEntry>();
	for (const entry of entries) {
		map.set(entry.loc, entry);
	}
	return map;
}
