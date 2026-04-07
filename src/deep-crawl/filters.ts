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

export interface FilterResult {
	allowed: boolean;
	reason?: string;
	filter?: string;
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

	/**
	 * Apply the filter and return a reason if rejected.
	 */
	async applyWithReason(url: string): Promise<FilterResult> {
		this.stats.total++;
		const result = await this.test(url);
		if (result) {
			this.stats.passed++;
			return { allowed: true };
		}
		this.stats.rejected++;
		return {
			allowed: false,
			reason: this.getDenialReason(url),
			filter: this.name,
		};
	}

	protected abstract test(url: string): Promise<boolean> | boolean;

	/**
	 * Override to provide a human-readable denial reason.
	 */
	protected getDenialReason(_url: string): string {
		return `Rejected by ${this.name} filter`;
	}

	getStats(): FilterStats {
		return { ...this.stats };
	}
}

// ---------------------------------------------------------------------------
// Filter Chain
// ---------------------------------------------------------------------------

export class FilterChain {
	private filters: URLFilter[];
	private denials: Array<{ url: string; reason: string; filter: string }> = [];

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
			const result = await filter.applyWithReason(url);
			if (!result.allowed) {
				this.denials.push({
					url,
					reason: result.reason ?? "Unknown",
					filter: result.filter ?? filter.name,
				});
				return false;
			}
		}
		return true;
	}

	/**
	 * Apply and return a detailed result with denial reason.
	 */
	async applyWithReason(url: string): Promise<FilterResult> {
		for (const filter of this.filters) {
			const result = await filter.applyWithReason(url);
			if (!result.allowed) {
				this.denials.push({
					url,
					reason: result.reason ?? "Unknown",
					filter: result.filter ?? filter.name,
				});
				return result;
			}
		}
		return { allowed: true };
	}

	getStats(): Record<string, FilterStats> {
		const stats: Record<string, FilterStats> = {};
		for (const filter of this.filters) {
			stats[filter.name] = filter.getStats();
		}
		return stats;
	}

	/**
	 * Get all denial records (url, reason, filter name).
	 */
	getDenials(): Array<{ url: string; reason: string; filter: string }> {
		return [...this.denials];
	}

	/**
	 * Get denials grouped by filter name.
	 */
	getDenialsByFilter(): Record<string, Array<{ url: string; reason: string }>> {
		const grouped: Record<string, Array<{ url: string; reason: string }>> = {};
		for (const denial of this.denials) {
			if (!grouped[denial.filter]) grouped[denial.filter] = [];
			grouped[denial.filter].push({ url: denial.url, reason: denial.reason });
		}
		return grouped;
	}

	clearDenials(): void {
		this.denials = [];
	}
}

// ---------------------------------------------------------------------------
// Pattern Filter (glob/regex)
// ---------------------------------------------------------------------------

export class URLPatternFilter extends URLFilter {
	private includePatterns: RegExp[];
	private excludePatterns: RegExp[];
	private lastDenialReason = "";

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
		for (const pattern of this.excludePatterns) {
			if (pattern.test(url)) {
				this.lastDenialReason = `Matched exclude pattern: ${pattern.source}`;
				return false;
			}
		}
		if (this.includePatterns.length > 0) {
			if (!this.includePatterns.some((p) => p.test(url))) {
				this.lastDenialReason = "Did not match any include pattern";
				return false;
			}
		}
		return true;
	}

	protected getDenialReason(_url: string): string {
		return this.lastDenialReason || "Rejected by url-pattern filter";
	}
}

// ---------------------------------------------------------------------------
// Domain Filter
// ---------------------------------------------------------------------------

export class DomainFilter extends URLFilter {
	private allowed: Set<string> | null;
	private blocked: Set<string>;
	private lastDenialReason = "";

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
			this.lastDenialReason = "Invalid URL";
			return false;
		}

		if (this.blocked.has(domain)) {
			this.lastDenialReason = `Domain "${domain}" is blocked`;
			return false;
		}
		if (this.allowed && !this.allowed.has(domain)) {
			this.lastDenialReason = `Domain "${domain}" is not in allowed list`;
			return false;
		}
		return true;
	}

	protected getDenialReason(_url: string): string {
		return this.lastDenialReason || "Rejected by domain filter";
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
	private lastDenialReason = "";

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
		if (this.blockedExtensions.has(ext)) {
			this.lastDenialReason = `File extension ".${ext}" is blocked`;
			return false;
		}
		if (this.allowedExtensions.size > 0 && !this.allowedExtensions.has(ext)) {
			this.lastDenialReason = `File extension ".${ext}" is not in allowed list`;
			return false;
		}
		return true;
	}

	protected getDenialReason(_url: string): string {
		return this.lastDenialReason || "Rejected by content-type filter";
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

	protected getDenialReason(url: string): string {
		const depth = this.depths.get(url) ?? 0;
		return `Depth ${depth} exceeds max depth ${this.maxDepth}`;
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
