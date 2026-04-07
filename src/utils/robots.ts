/**
 * Robots.txt parser and URL allowability checker.
 *
 * Parses standard robots.txt directives: User-agent, Allow, Disallow, Crawl-delay, Sitemap.
 * Supports wildcard (*) and end-of-URL ($) patterns in paths.
 */

export interface RobotsRule {
	pattern: RegExp;
	allow: boolean;
	priority: number; // longer path = higher priority
}

export interface RobotsDirectives {
	rules: RobotsRule[];
	crawlDelay: number | null;
	sitemaps: string[];
}

export class RobotsParser {
	private cache = new Map<string, RobotsDirectives>();
	private userAgent: string;

	constructor(userAgent = "feedstock") {
		this.userAgent = userAgent.toLowerCase();
	}

	/**
	 * Fetch and parse robots.txt for a given URL's origin.
	 * Results are cached per-origin.
	 */
	async fetch(url: string): Promise<RobotsDirectives> {
		let origin: string;
		try {
			origin = new URL(url).origin;
		} catch {
			return emptyDirectives();
		}

		const cached = this.cache.get(origin);
		if (cached) return cached;

		const robotsUrl = `${origin}/robots.txt`;
		let text: string;

		try {
			const response = await fetch(robotsUrl, {
				headers: { "User-Agent": this.userAgent },
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				// No robots.txt or error — allow everything
				const directives = emptyDirectives();
				this.cache.set(origin, directives);
				return directives;
			}
			text = await response.text();
		} catch {
			const directives = emptyDirectives();
			this.cache.set(origin, directives);
			return directives;
		}

		const directives = this.parse(text);
		this.cache.set(origin, directives);
		return directives;
	}

	/**
	 * Parse robots.txt content into directives.
	 */
	parse(content: string): RobotsDirectives {
		const lines = content.split("\n").map((l) => l.trim());
		const sitemaps: string[] = [];

		// Collect groups: { userAgent: string, rules, crawlDelay }
		type Group = { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null };
		const groups: Group[] = [];
		let current: Group | null = null;

		for (const line of lines) {
			// Skip comments and empty lines
			const stripped = line.replace(/#.*$/, "").trim();
			if (!stripped) continue;

			const colonIdx = stripped.indexOf(":");
			if (colonIdx === -1) continue;

			const key = stripped.slice(0, colonIdx).trim().toLowerCase();
			const value = stripped.slice(colonIdx + 1).trim();

			if (key === "sitemap") {
				sitemaps.push(value);
				continue;
			}

			if (key === "user-agent") {
				// Start new group or extend current if consecutive user-agent lines
				if (!current || current.rules.length > 0 || current.crawlDelay !== null) {
					current = { agents: [], rules: [], crawlDelay: null };
					groups.push(current);
				}
				current.agents.push(value.toLowerCase());
				continue;
			}

			if (!current) continue;

			if (key === "disallow") {
				if (value === "") {
					// Empty disallow = allow all
					current.rules.push({ pattern: /^/, allow: true, priority: 0 });
				} else {
					current.rules.push({
						pattern: pathToRegex(value),
						allow: false,
						priority: value.length,
					});
				}
			} else if (key === "allow") {
				current.rules.push({
					pattern: pathToRegex(value),
					allow: true,
					priority: value.length,
				});
			} else if (key === "crawl-delay") {
				const delay = parseFloat(value);
				if (!Number.isNaN(delay)) {
					current.crawlDelay = delay;
				}
			}
		}

		// Find the best matching group for our user agent
		let matchedGroup: Group | null = null;
		let wildcardGroup: Group | null = null;

		for (const group of groups) {
			for (const agent of group.agents) {
				if (agent === "*") {
					wildcardGroup = group;
				} else if (this.userAgent.includes(agent) || agent.includes(this.userAgent)) {
					matchedGroup = group;
				}
			}
		}

		const bestGroup = matchedGroup ?? wildcardGroup;
		if (!bestGroup) {
			return { rules: [], crawlDelay: null, sitemaps };
		}

		return {
			rules: bestGroup.rules,
			crawlDelay: bestGroup.crawlDelay,
			sitemaps,
		};
	}

	/**
	 * Check if a URL is allowed by robots.txt rules.
	 */
	isAllowed(url: string, directives: RobotsDirectives): boolean {
		let path: string;
		try {
			const parsed = new URL(url);
			path = parsed.pathname + parsed.search;
		} catch {
			return true;
		}

		if (directives.rules.length === 0) return true;

		// Find all matching rules, pick the one with highest priority (longest path)
		let bestMatch: RobotsRule | null = null;

		for (const rule of directives.rules) {
			if (rule.pattern.test(path)) {
				if (!bestMatch || rule.priority > bestMatch.priority) {
					bestMatch = rule;
				}
			}
		}

		return bestMatch ? bestMatch.allow : true;
	}

	clearCache(): void {
		this.cache.clear();
	}
}

function emptyDirectives(): RobotsDirectives {
	return { rules: [], crawlDelay: null, sitemaps: [] };
}

/**
 * Convert a robots.txt path pattern to a RegExp.
 * Supports * (wildcard) and $ (end anchor).
 */
function pathToRegex(pattern: string): RegExp {
	let regex = "^";
	let i = 0;

	while (i < pattern.length) {
		const char = pattern[i];
		if (char === "*") {
			regex += ".*";
		} else if (char === "$" && i === pattern.length - 1) {
			regex += "$";
		} else {
			regex += escapeRegex(char);
		}
		i++;
	}

	return new RegExp(regex);
}

function escapeRegex(char: string): string {
	return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
