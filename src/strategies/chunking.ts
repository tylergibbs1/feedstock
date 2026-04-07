/**
 * Text chunking strategies for splitting content into segments.
 * Used for extraction pipelines that need bounded input sizes.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export abstract class ChunkingStrategy {
	abstract chunk(text: string): string[];
}

// ---------------------------------------------------------------------------
// Identity (no chunking)
// ---------------------------------------------------------------------------

export class IdentityChunking extends ChunkingStrategy {
	chunk(text: string): string[] {
		return [text];
	}
}

// ---------------------------------------------------------------------------
// Regex chunking (split by pattern)
// ---------------------------------------------------------------------------

export class RegexChunking extends ChunkingStrategy {
	private patterns: RegExp[];

	constructor(patterns: (string | RegExp)[] = [/\n\n+/]) {
		super();
		this.patterns = patterns.map((p) => (typeof p === "string" ? new RegExp(p) : p));
	}

	chunk(text: string): string[] {
		let chunks = [text];

		for (const pattern of this.patterns) {
			const next: string[] = [];
			for (const c of chunks) {
				next.push(...c.split(pattern).filter((s) => s.trim().length > 0));
			}
			chunks = next;
		}

		return chunks;
	}
}

// ---------------------------------------------------------------------------
// Sliding window chunking
// ---------------------------------------------------------------------------

export class SlidingWindowChunking extends ChunkingStrategy {
	private windowSize: number;
	private overlap: number;

	constructor(windowSize = 500, overlap = 50) {
		super();
		this.windowSize = windowSize;
		this.overlap = overlap;
	}

	chunk(text: string): string[] {
		const words = text.split(/\s+/);
		if (words.length <= this.windowSize) return [text];

		const chunks: string[] = [];
		let start = 0;

		while (start < words.length) {
			const end = Math.min(start + this.windowSize, words.length);
			chunks.push(words.slice(start, end).join(" "));
			if (end >= words.length) break;
			start += this.windowSize - this.overlap;
		}

		return chunks;
	}
}

// ---------------------------------------------------------------------------
// Fixed-size chunking (by character count)
// ---------------------------------------------------------------------------

export class FixedSizeChunking extends ChunkingStrategy {
	private size: number;
	private overlap: number;

	constructor(size = 2000, overlap = 200) {
		super();
		this.size = size;
		this.overlap = overlap;
	}

	chunk(text: string): string[] {
		if (text.length <= this.size) return [text];

		const chunks: string[] = [];
		let start = 0;

		while (start < text.length) {
			const end = Math.min(start + this.size, text.length);
			chunks.push(text.slice(start, end));
			if (end >= text.length) break;
			start += this.size - this.overlap;
		}

		return chunks;
	}
}
