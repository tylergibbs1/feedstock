/**
 * AI-friendly error message conversion.
 *
 * Converts cryptic Playwright/fetch/network errors into
 * actionable human-readable messages.
 */

const ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
	// Navigation
	{
		pattern: /net::ERR_NAME_NOT_RESOLVED/i,
		message: "DNS resolution failed. The domain does not exist or DNS is unreachable.",
	},
	{
		pattern: /net::ERR_CONNECTION_REFUSED/i,
		message: "Connection refused. The server is not running or is blocking connections.",
	},
	{
		pattern: /net::ERR_CONNECTION_TIMED_OUT|Timeout \d+ms exceeded/i,
		message:
			"Connection timed out. The server took too long to respond. Try increasing pageTimeout.",
	},
	{
		pattern: /net::ERR_SSL_PROTOCOL_ERROR|ERR_CERT/i,
		message: "SSL/TLS error. The site has certificate issues. Try setting ignoreHttpsErrors: true.",
	},
	{
		pattern: /net::ERR_TOO_MANY_REDIRECTS/i,
		message: "Too many redirects. The page is stuck in a redirect loop.",
	},
	{
		pattern: /net::ERR_ABORTED/i,
		message: "Request was aborted. The page may have redirected or the download was cancelled.",
	},
	{
		pattern: /net::ERR_INTERNET_DISCONNECTED/i,
		message: "No internet connection.",
	},

	// Element interaction
	{
		pattern: /element is not visible/i,
		message:
			"Element exists but is not visible. It may be hidden, off-screen, or covered by another element.",
	},
	{
		pattern: /element is not attached/i,
		message: "Element was removed from the DOM. The page may have re-rendered.",
	},
	{
		pattern: /strict mode violation/i,
		message: "Selector matched multiple elements. Use a more specific selector.",
	},
	{
		pattern: /element .* intercepted|intercept/i,
		message:
			"Another element is covering the target. There may be a modal, overlay, or popup blocking it.",
	},
	{
		pattern: /waiting for selector/i,
		message:
			"Timed out waiting for element to appear. The page may not have loaded fully or the selector is wrong.",
	},

	// Browser
	{
		pattern: /browser has been closed/i,
		message: "Browser was closed unexpectedly. The browser process may have crashed.",
	},
	{
		pattern: /target (page|frame) (closed|crashed)/i,
		message:
			"Page or frame crashed. The page may have run out of memory or encountered a fatal error.",
	},
	{
		pattern: /execution context was destroyed/i,
		message: "Page navigated away during operation. The JS context was lost.",
	},
	{
		pattern: /protocol error/i,
		message: "Communication error with browser. The CDP connection may have dropped.",
	},

	// Fetch
	{
		pattern: /fetch failed/i,
		message: "HTTP request failed. The server may be down or unreachable.",
	},
	{
		pattern: /AbortError|aborted/i,
		message: "Request was aborted due to timeout.",
	},
	{
		pattern: /ECONNREFUSED/i,
		message: "Connection refused. No server is listening at this address.",
	},
	{
		pattern: /ENOTFOUND/i,
		message: "Domain not found. Check the URL for typos.",
	},
];

/**
 * Convert an error into an AI-friendly message.
 * Returns the converted message, or the original if no pattern matches.
 */
export function toFriendlyError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);

	for (const { pattern, message: friendly } of ERROR_PATTERNS) {
		if (pattern.test(message)) {
			return friendly;
		}
	}

	// Clean up common noise
	return message
		.replace(/^Error:\s*/i, "")
		.replace(/\s+at\s+.*/s, "")
		.trim();
}

/**
 * Wrap a function to convert errors to friendly messages.
 */
export async function withFriendlyErrors<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		throw new Error(toFriendlyError(err));
	}
}
