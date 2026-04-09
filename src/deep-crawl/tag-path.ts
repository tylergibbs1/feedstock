/**
 * Tag-path URL grouping for Sleeping Bandits frontier strategy.
 *
 * Groups hyperlinks by their URL path structure as a proxy for DOM position.
 * Links with the same path pattern (e.g., /blog/posts/{id}) are assumed to
 * share similar value, enabling the bandit to learn per-group rewards.
 *
 * Inspired by: "Sleeping Bandits for Content Discovery in Web Crawlers"
 * (arXiv:2602.11874)
 */

// Matches purely numeric segments, hex hashes, UUIDs, and base64-ish slugs.
const ID_PATTERNS: RegExp[] = [
	/^[0-9]+$/, // numeric ID
	/^[0-9a-f]{8,}$/i, // hex hash
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
	/^[A-Za-z0-9_-]{16,}$/, // base64-ish token (16+ chars, only safe chars)
];

function isIdSegment(segment: string): boolean {
	return ID_PATTERNS.some((p) => p.test(segment));
}

/**
 * Extracts a link-group key from a URL by normalizing its path structure.
 *
 * Numeric IDs, hex hashes, UUIDs, and long opaque tokens are replaced with
 * `{id}` so that structurally identical URLs map to the same group.
 *
 * @example
 * extractLinkGroup("https://example.com/blog/posts/123") // "example.com:/blog/posts/{id}"
 * extractLinkGroup("https://example.com/blog/posts/456") // "example.com:/blog/posts/{id}"
 * extractLinkGroup("https://example.com/about")          // "example.com:/about"
 */
export function extractLinkGroup(
	url: string,
	_context?: { anchorText?: string; parentUrl?: string },
): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "invalid";
	}

	const segments = parsed.pathname
		.split("/")
		.filter(Boolean)
		.map((seg) => (isIdSegment(seg) ? "{id}" : seg));

	const path = segments.length > 0 ? `/${segments.join("/")}` : "/";

	// Include sorted query param keys (but not values) to distinguish
	// e.g. ?page=1 patterns from non-paginated URLs.
	const paramKeys = [...parsed.searchParams.keys()].sort();
	const querySuffix = paramKeys.length > 0 ? `?${paramKeys.join("&")}` : "";

	return `${parsed.hostname}:${path}${querySuffix}`;
}
