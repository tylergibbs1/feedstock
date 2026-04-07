/**
 * Crawler monitor — tracks crawl statistics in real-time.
 */

export interface CrawlStats {
	startTime: number;
	pagesTotal: number;
	pagesSuccess: number;
	pagesFailed: number;
	pagesFromCache: number;
	bytesDownloaded: number;
	avgResponseTime: number;
	currentUrl: string | null;
	elapsedMs: number;
	pagesPerSecond: number;
}

export class CrawlerMonitor {
	private _startTime = 0;
	private _pagesTotal = 0;
	private _pagesSuccess = 0;
	private _pagesFailed = 0;
	private _pagesFromCache = 0;
	private _bytesDownloaded = 0;
	private _totalResponseTime = 0;
	private _currentUrl: string | null = null;

	start(): void {
		this._startTime = Date.now();
		this._pagesTotal = 0;
		this._pagesSuccess = 0;
		this._pagesFailed = 0;
		this._pagesFromCache = 0;
		this._bytesDownloaded = 0;
		this._totalResponseTime = 0;
		this._currentUrl = null;
	}

	recordPageStart(url: string): void {
		this._currentUrl = url;
	}

	recordPageComplete(opts: {
		success: boolean;
		fromCache: boolean;
		responseTimeMs: number;
		bytesDownloaded: number;
	}): void {
		this._pagesTotal++;
		if (opts.fromCache) {
			this._pagesFromCache++;
		} else if (opts.success) {
			this._pagesSuccess++;
		} else {
			this._pagesFailed++;
		}
		this._bytesDownloaded += opts.bytesDownloaded;
		this._totalResponseTime += opts.responseTimeMs;
		this._currentUrl = null;
	}

	getStats(): CrawlStats {
		const elapsed = Date.now() - this._startTime;
		const total = this._pagesTotal || 1;

		return {
			startTime: this._startTime,
			pagesTotal: this._pagesTotal,
			pagesSuccess: this._pagesSuccess,
			pagesFailed: this._pagesFailed,
			pagesFromCache: this._pagesFromCache,
			bytesDownloaded: this._bytesDownloaded,
			avgResponseTime: this._totalResponseTime / total,
			currentUrl: this._currentUrl,
			elapsedMs: elapsed,
			pagesPerSecond: elapsed > 0 ? (this._pagesTotal / elapsed) * 1000 : 0,
		};
	}

	/**
	 * Format stats as a human-readable summary.
	 */
	formatStats(): string {
		const s = this.getStats();
		const elapsed = (s.elapsedMs / 1000).toFixed(1);
		const avgMs = s.avgResponseTime.toFixed(0);
		const mb = (s.bytesDownloaded / 1024 / 1024).toFixed(2);
		const pps = s.pagesPerSecond.toFixed(1);

		return [
			`Pages: ${s.pagesTotal} (${s.pagesSuccess} ok, ${s.pagesFailed} failed, ${s.pagesFromCache} cached)`,
			`Time: ${elapsed}s | ${pps} pages/s | avg ${avgMs}ms/page`,
			`Downloaded: ${mb} MB`,
			s.currentUrl ? `Current: ${s.currentUrl}` : null,
		]
			.filter(Boolean)
			.join("\n");
	}
}
