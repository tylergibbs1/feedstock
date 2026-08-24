import { afterEach, describe, expect, mock, test } from "bun:test";
import { createCrawlerRunConfig } from "../../src/config";
import { FetchEngine } from "../../src/engines/fetch";
import { URLSeeder } from "../../src/utils/url-seeder";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function htmlResponse(body: BodyInit, init: ResponseInit & { url?: string } = {}): Response {
	const response = new Response(body, {
		status: init.status ?? 200,
		headers: { "content-type": "text/html", ...init.headers },
	});
	Object.defineProperty(response, "url", { value: init.url ?? "https://example.com/" });
	return response;
}

describe("FetchEngine modern request behavior", () => {
	test("passes custom headers and exposes the final redirect URL", async () => {
		let authorization = "";
		globalThis.fetch = mock(async (_url, init) => {
			authorization = new Headers(init?.headers).get("Authorization") ?? "";
			return htmlResponse("<h1>ok</h1>", { url: "https://example.com/final" });
		}) as unknown as typeof fetch;

		const response = await new FetchEngine().fetch(
			"https://example.com/start",
			createCrawlerRunConfig({ headers: { Authorization: "Bearer secret" } }),
		);
		expect(authorization).toBe("Bearer secret");
		expect(response.redirectedUrl).toBe("https://example.com/final");
	});

	test("retries configured status codes and respects the attempt limit", async () => {
		let attempts = 0;
		globalThis.fetch = mock(async () => {
			attempts++;
			return attempts === 1
				? htmlResponse("busy", { status: 429, headers: { "retry-after": "0" } })
				: htmlResponse("ready");
		}) as unknown as typeof fetch;

		const response = await new FetchEngine().fetch(
			"https://example.com/",
			createCrawlerRunConfig({
				retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 },
			}),
		);
		expect(response.html).toBe("ready");
		expect(attempts).toBe(2);
	});

	test("rejects non-text content and oversized streaming bodies", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(new Uint8Array([1, 2, 3]), {
					headers: { "content-type": "application/octet-stream" },
				}),
		) as unknown as typeof fetch;
		expect(
			new FetchEngine().fetch("https://example.com/file", createCrawlerRunConfig()),
		).rejects.toThrow("Unsupported content type");

		globalThis.fetch = mock(async () => htmlResponse("123456")) as unknown as typeof fetch;
		expect(
			new FetchEngine().fetch(
				"https://example.com/large",
				createCrawlerRunConfig({ maxResponseBytes: 5 }),
			),
		).rejects.toThrow("exceeds 5 byte limit");
	});
});

describe("URLSeeder", () => {
	test("reads gzipped sitemap bytes once and follows nested indexes", async () => {
		const sitemapIndex = Bun.gzipSync(
			Buffer.from("<sitemapindex><sitemap><loc>/nested.xml</loc></sitemap></sitemapindex>"),
		);
		globalThis.fetch = mock(async (input) => {
			const url = String(input);
			if (url.endsWith("/robots.txt")) {
				return new Response("Sitemap: /sitemap.xml", { status: 200 });
			}
			if (url.endsWith("/sitemap.xml")) return new Response(sitemapIndex);
			if (url.endsWith("/nested.xml")) {
				return new Response(
					"<urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url></urlset>",
				);
			}
			return new Response("", { status: 404 });
		}) as unknown as typeof fetch;

		const result = await new URLSeeder().seed("https://example.com/start");
		expect(result.urls).toEqual(["https://example.com/a?x=1&y=2"]);
		expect(result.sitemaps).toContain("https://example.com/nested.xml");
	});
});
