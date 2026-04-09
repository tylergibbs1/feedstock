import { describe, expect, test } from "bun:test";
import {
	CacheFreshnessEvaluator,
	type CachedEntry,
	type SignalInputs,
} from "../../src/cache/freshness";
import { buildSitemapIndex, parseSitemap } from "../../src/cache/sitemap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

function makeEntry(overrides: Partial<CachedEntry> = {}): CachedEntry {
	return {
		url: "https://example.com/page",
		cachedAt: NOW - HOUR, // 1 hour ago by default
		...overrides,
	};
}

function makeSignals(overrides: Partial<SignalInputs> = {}): SignalInputs {
	return {
		cachedAt: NOW - HOUR,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Time decay
// ---------------------------------------------------------------------------

describe("CacheFreshnessEvaluator — time decay", () => {
	const evaluator = new CacheFreshnessEvaluator();

	test("fresh cache (1 hour old, maxAge 24h) has low staleness score", () => {
		const result = evaluator.evaluate(makeEntry(), makeSignals());
		expect(result.score).toBeLessThan(0.3);
		expect(result.recommendation).toBe("use_cache");
	});

	test("stale cache (25 hours old) has high staleness and recommends refetch", () => {
		const cachedAt = NOW - 25 * HOUR;
		const result = evaluator.evaluate(
			makeEntry({ cachedAt }),
			makeSignals({ cachedAt }),
		);
		expect(result.score).toBeGreaterThan(0.7);
		expect(result.isStale).toBe(true);
		expect(result.recommendation).toBe("refetch");
	});

	test("mid-age cache yields score between fresh and fully stale", () => {
		// At 12h (50% of maxAge), time_decay is stale=true with confidence=0.75.
		// With only one signal the weighted average is 1.0. But when combined
		// with a fresh HTTP signal we can see the time contribution pull the
		// score above the "all fresh" baseline.
		const cachedAt = NOW - 12 * HOUR;
		const resultMid = evaluator.evaluate(
			makeEntry({ cachedAt, etag: '"abc"' }),
			makeSignals({ cachedAt, etag: '"abc"', cachedEtag: '"abc"' }),
		);
		// Fresh HTTP etag + mid-age time decay: should land between extremes
		const freshCachedAt = NOW - HOUR;
		const resultFresh = evaluator.evaluate(
			makeEntry({ cachedAt: freshCachedAt, etag: '"abc"' }),
			makeSignals({ cachedAt: freshCachedAt, etag: '"abc"', cachedEtag: '"abc"' }),
		);
		expect(resultMid.score).toBeGreaterThan(resultFresh.score);
		expect(resultMid.score).toBeLessThan(1.0);
	});
});

// ---------------------------------------------------------------------------
// HTTP header signals
// ---------------------------------------------------------------------------

describe("CacheFreshnessEvaluator — HTTP headers", () => {
	const evaluator = new CacheFreshnessEvaluator();

	test("ETag changed indicates staleness", () => {
		const result = evaluator.evaluate(
			makeEntry({ etag: '"abc"' }),
			makeSignals({ etag: '"xyz"', cachedEtag: '"abc"' }),
		);
		const etagSignal = result.signals.find((s) => s.name === "http_etag");
		expect(etagSignal).toBeDefined();
		expect(etagSignal!.stale).toBe(true);
		expect(result.score).toBeGreaterThan(0.3);
	});

	test("ETag unchanged indicates freshness", () => {
		const result = evaluator.evaluate(
			makeEntry({ etag: '"abc"' }),
			makeSignals({ etag: '"abc"', cachedEtag: '"abc"' }),
		);
		const etagSignal = result.signals.find((s) => s.name === "http_etag");
		expect(etagSignal).toBeDefined();
		expect(etagSignal!.stale).toBe(false);
		expect(result.score).toBeLessThan(0.3);
	});

	test("Last-Modified newer than cached indicates staleness", () => {
		const cached = new Date("2025-01-01T00:00:00Z").toUTCString();
		const newer = new Date("2025-06-01T00:00:00Z").toUTCString();
		const result = evaluator.evaluate(
			makeEntry(),
			makeSignals({ lastModified: newer, cachedLastModified: cached }),
		);
		const lmSignal = result.signals.find((s) => s.name === "http_last_modified");
		expect(lmSignal).toBeDefined();
		expect(lmSignal!.stale).toBe(true);
	});

	test("Cache-Control max-age not expired indicates freshness", () => {
		// Cached 1 hour ago, max-age 86400 (24h) — still fresh
		const result = evaluator.evaluate(
			makeEntry(),
			makeSignals({ cacheControl: "max-age=86400" }),
		);
		const ccSignal = result.signals.find((s) => s.name === "http_cache_control");
		expect(ccSignal).toBeDefined();
		expect(ccSignal!.stale).toBe(false);
	});

	test("Cache-Control no-cache produces stale signal", () => {
		const result = evaluator.evaluate(
			makeEntry(),
			makeSignals({ cacheControl: "no-cache" }),
		);
		const ccSignal = result.signals.find((s) => s.name === "http_cache_control");
		expect(ccSignal).toBeDefined();
		expect(ccSignal!.stale).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Sitemap signals
// ---------------------------------------------------------------------------

describe("CacheFreshnessEvaluator — sitemap", () => {
	const evaluator = new CacheFreshnessEvaluator();

	test("sitemapLastmod newer than cachedAt indicates staleness", () => {
		const cachedAt = NOW - HOUR;
		const result = evaluator.evaluate(
			makeEntry({ cachedAt }),
			makeSignals({
				cachedAt,
				sitemapLastmod: new Date(NOW).toISOString(), // now > cachedAt
			}),
		);
		const sig = result.signals.find((s) => s.name === "sitemap_lastmod");
		expect(sig).toBeDefined();
		expect(sig!.stale).toBe(true);
	});

	test("sitemapChangefreq 'never' produces fresh bias", () => {
		const result = evaluator.evaluate(
			makeEntry(),
			makeSignals({ sitemapChangefreq: "never" }),
		);
		const sig = result.signals.find((s) => s.name === "sitemap_changefreq");
		expect(sig).toBeDefined();
		expect(sig!.stale).toBe(false);
	});

	test("sitemapChangefreq 'always' produces stale bias", () => {
		const result = evaluator.evaluate(
			makeEntry(),
			makeSignals({ sitemapChangefreq: "always" }),
		);
		const sig = result.signals.find((s) => s.name === "sitemap_changefreq");
		expect(sig).toBeDefined();
		expect(sig!.stale).toBe(true);
	});

	test("no sitemap data does not add sitemap signals", () => {
		const result = evaluator.evaluate(makeEntry(), makeSignals());
		const sitemapSignals = result.signals.filter((s) => s.name.startsWith("sitemap_"));
		expect(sitemapSignals).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Combined evaluation
// ---------------------------------------------------------------------------

describe("CacheFreshnessEvaluator — combined", () => {
	test("all signals fresh produces low score and use_cache", () => {
		const evaluator = new CacheFreshnessEvaluator();
		const cachedAt = NOW - HOUR; // very fresh
		const result = evaluator.evaluate(
			makeEntry({ cachedAt, etag: '"abc"', contentHash: "hash1" }),
			makeSignals({
				cachedAt,
				etag: '"abc"',
				cachedEtag: '"abc"',
				cacheControl: "max-age=86400",
				sitemapChangefreq: "never",
				contentHash: "hash1",
			}),
		);
		expect(result.score).toBeLessThan(0.3);
		expect(result.recommendation).toBe("use_cache");
	});

	test("all signals stale produces high score and refetch", () => {
		const evaluator = new CacheFreshnessEvaluator();
		const cachedAt = NOW - 2 * DAY; // 48h, well past 24h max
		const result = evaluator.evaluate(
			makeEntry({ cachedAt, etag: '"old"', contentHash: "old_hash" }),
			makeSignals({
				cachedAt,
				etag: '"new"',
				cachedEtag: '"old"',
				cacheControl: "no-cache",
				sitemapLastmod: new Date(NOW).toISOString(),
				sitemapChangefreq: "always",
				contentHash: "new_hash",
			}),
		);
		expect(result.score).toBeGreaterThan(0.7);
		expect(result.isStale).toBe(true);
		expect(result.recommendation).toBe("refetch");
	});

	test("mixed signals produce mid-range score and revalidate", () => {
		const evaluator = new CacheFreshnessEvaluator();
		const cachedAt = NOW - 6 * HOUR; // 25% of max age
		const result = evaluator.evaluate(
			makeEntry({ cachedAt, etag: '"abc"' }),
			makeSignals({
				cachedAt,
				// ETag matches (fresh signal)
				etag: '"abc"',
				cachedEtag: '"abc"',
				// But sitemap says updated (stale signal)
				sitemapLastmod: new Date(NOW).toISOString(),
				sitemapChangefreq: "always",
			}),
		);
		expect(result.score).toBeGreaterThanOrEqual(0.3);
		expect(result.score).toBeLessThanOrEqual(0.7);
		expect(result.recommendation).toBe("revalidate");
	});

	test("custom weights change the outcome", () => {
		// Give sitemap full weight and HTTP zero weight
		const evaluator = new CacheFreshnessEvaluator({
			sitemapWeight: 1.0,
			httpHeaderWeight: 0.0,
			timeDecayWeight: 0.0,
			contentHashWeight: 0.0,
		});
		const cachedAt = NOW - HOUR;
		const result = evaluator.evaluate(
			makeEntry({ cachedAt }),
			makeSignals({
				cachedAt,
				// Sitemap says stale
				sitemapLastmod: new Date(NOW).toISOString(),
				sitemapChangefreq: "always",
				// HTTP says fresh (but weight is 0)
				etag: '"abc"',
				cachedEtag: '"abc"',
			}),
		);
		// Only sitemap signals contribute, both indicate stale
		expect(result.score).toBeGreaterThan(0.5);
		expect(result.isStale).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Sitemap parser
// ---------------------------------------------------------------------------

describe("parseSitemap", () => {
	test("parses simple sitemap XML with loc, lastmod, changefreq, priority", () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page1</loc>
    <lastmod>2025-01-15</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://example.com/page2</loc>
    <lastmod>2025-02-20</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`;
		const entries = parseSitemap(xml);
		expect(entries).toHaveLength(2);
		expect(entries[0].loc).toBe("https://example.com/page1");
		expect(entries[0].lastmod).toBe("2025-01-15");
		expect(entries[0].changefreq).toBe("weekly");
		expect(entries[0].priority).toBe(0.8);
		expect(entries[1].loc).toBe("https://example.com/page2");
	});

	test("parses sitemap index", () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap1.xml</loc>
    <lastmod>2025-03-01</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap2.xml</loc>
  </sitemap>
</sitemapindex>`;
		const entries = parseSitemap(xml);
		expect(entries).toHaveLength(2);
		expect(entries[0].loc).toBe("https://example.com/sitemap1.xml");
		expect(entries[0].lastmod).toBe("2025-03-01");
		expect(entries[1].loc).toBe("https://example.com/sitemap2.xml");
		expect(entries[1].lastmod).toBeUndefined();
	});

	test("handles malformed XML gracefully", () => {
		expect(parseSitemap("")).toEqual([]);
		expect(parseSitemap("not xml at all")).toEqual([]);
		expect(parseSitemap("<urlset><url><noloc>x</noloc></url></urlset>")).toEqual([]);
	});

	test("buildSitemapIndex creates correct URL-to-entry map", () => {
		const entries = [
			{ loc: "https://example.com/a", lastmod: "2025-01-01", changefreq: "daily" as const },
			{ loc: "https://example.com/b", priority: 0.5 },
		];
		const map = buildSitemapIndex(entries);
		expect(map.size).toBe(2);
		expect(map.get("https://example.com/a")?.lastmod).toBe("2025-01-01");
		expect(map.get("https://example.com/b")?.priority).toBe(0.5);
		expect(map.get("https://example.com/missing")).toBeUndefined();
	});
});
