/**
 * URL filtering system for deep crawling.
 *
 * Filters decide whether a discovered URL should be crawled.
 * A FilterChain composes multiple filters with short-circuit rejection.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export interface FilterStats {
	total: number;
	passed: number;
	rejected: number;
}

export abstract class URLFilter {
	readonly name: string;
	private stats: FilterStats = { total: 0, passed: 0, rejected: 0 };

	constructor(name: string) {
		this.name = name;
	}

	async apply(url: string): Promise<boolean> {
		this.stats.total++;
		const result = await this.test(url);
		if (result) {
			this.stats.passed++;
		} else {
			this.stats.rejected++;
		}
		return result;
	}

	protected abstract test(url: string): Promise<boolean> | boolean;

	getStats(): FilterStats {
		return { ...this.stats };
	}
}

// ---------------------------------------------------------------------------
// Filter Chain
// ---------------------------------------------------------------------------

export class FilterChain {
	private filters: URLFilter[];

	constructor(filters: URLFilter[] = []) {
		this.filters = filters;
	}

	add(filter: URLFilter): this {
		this.filters.push(filter);
		return this;
	}

	/**
	 * Returns true if the URL passes ALL filters. Short-circuits on first rejection.
	 */
	async apply(url: string): Promise<boolean> {
		for (const filter of this.filters) {
			if (!(await filter.apply(url))) {
				return false;
			}
		}
		return true;
	}

	getStats(): Record<string, FilterStats> {
		const stats: Record<string, FilterStats> = {};
		for (const filter of this.filters) {
			stats[filter.name] = filter.getStats();
		}
		return stats;
	}
}

// ---------------------------------------------------------------------------
// Pattern Filter (glob/regex)
// ---------------------------------------------------------------------------

export class URLPatternFilter extends URLFilter {
	private includePatterns: RegExp[];
	private excludePatterns: RegExp[];

	constructor(
		opts: {
			include?: (string | RegExp)[];
			exclude?: (string | RegExp)[];
		} = {},
	) {
		super("url-pattern");
		this.includePatterns = (opts.include ?? []).map(toRegex);
		this.excludePatterns = (opts.exclude ?? []).map(toRegex);
	}

	protected test(url: string): boolean {
		// If exclude patterns match, reject
		for (const pattern of this.excludePatterns) {
			if (pattern.test(url)) return false;
		}
		// If include patterns exist, at least one must match
		if (this.includePatterns.length > 0) {
			return this.includePatterns.some((p) => p.test(url));
		}
		return true;
	}
}

// ---------------------------------------------------------------------------
// Domain Filter
// ---------------------------------------------------------------------------

export class DomainFilter extends URLFilter {
	private allowed: Set<string> | null;
	private blocked: Set<string>;

	constructor(
		opts: {
			allowed?: string[];
			blocked?: string[];
		} = {},
	) {
		super("domain");
		this.allowed = opts.allowed ? new Set(opts.allowed.map((d) => d.toLowerCase())) : null;
		this.blocked = new Set((opts.blocked ?? []).map((d) => d.toLowerCase()));
	}

	protected test(url: string): boolean {
		let domain: string;
		try {
			domain = new URL(url).hostname.toLowerCase();
		} catch {
			return false;
		}

		if (this.blocked.has(domain)) return false;
		if (this.allowed && !this.allowed.has(domain)) return false;
		return true;
	}
}

// ---------------------------------------------------------------------------
// Content-Type Filter
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_EXTENSIONS = new Set([
	"", // no extension = likely HTML
	"html",
	"htm",
	"php",
	"asp",
	"aspx",
	"jsp",
	"shtml",
]);

const BLOCKED_EXTENSIONS = new Set([
	"jpg",
	"jpeg",
	"png",
	"gif",
	"svg",
	"webp",
	"avif",
	"bmp",
	"ico",
	"mp3",
	"mp4",
	"avi",
	"mov",
	"wmv",
	"flv",
	"webm",
	"ogg",
	"pdf",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"zip",
	"rar",
	"tar",
	"gz",
	"7z",
	"css",
	"js",
	"json",
	"xml",
	"woff",
	"woff2",
	"ttf",
	"eot",
	"exe",
	"dmg",
	"msi",
	"deb",
	"rpm",
]);

export class ContentTypeFilter extends URLFilter {
	private allowedExtensions: Set<string>;
	private blockedExtensions: Set<string>;

	constructor(
		opts: {
			allowedExtensions?: string[];
			blockedExtensions?: string[];
		} = {},
	) {
		super("content-type");
		this.allowedExtensions = opts.allowedExtensions
			? new Set(opts.allowedExtensions.map((e) => e.toLowerCase()))
			: DEFAULT_ALLOWED_EXTENSIONS;
		this.blockedExtensions = opts.blockedExtensions
			? new Set(opts.blockedExtensions.map((e) => e.toLowerCase()))
			: BLOCKED_EXTENSIONS;
	}

	protected test(url: string): boolean {
		const ext = this.getExtension(url);
		if (this.blockedExtensions.has(ext)) return false;
		if (this.allowedExtensions.size > 0 && !this.allowedExtensions.has(ext)) return false;
		return true;
	}

	private getExtension(url: string): string {
		try {
			const pathname = new URL(url).pathname;
			const lastSegment = pathname.split("/").pop() ?? "";
			const dotIdx = lastSegment.lastIndexOf(".");
			if (dotIdx === -1) return "";
			return lastSegment.slice(dotIdx + 1).toLowerCase();
		} catch {
			return "";
		}
	}
}

// ---------------------------------------------------------------------------
// Max Depth Filter
// ---------------------------------------------------------------------------

export class MaxDepthFilter extends URLFilter {
	private maxDepth: number;
	private depths: Map<string, number>;

	constructor(maxDepth: number, depths: Map<string, number>) {
		super("max-depth");
		this.maxDepth = maxDepth;
		this.depths = depths;
	}

	protected test(url: string): boolean {
		const depth = this.depths.get(url) ?? 0;
		return depth <= this.maxDepth;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRegex(pattern: string | RegExp): RegExp {
	if (pattern instanceof RegExp) return pattern;
	// Convert glob-like patterns: * → .*, ** → .*, ? → .
	const regex = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, ".*")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, ".");
	return new RegExp(regex);
}
