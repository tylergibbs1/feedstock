import { describe, expect, test } from "bun:test";
import { toFriendlyError } from "../../src/utils/errors";

describe("toFriendlyError", () => {
	test("converts DNS errors", () => {
		const msg = toFriendlyError(new Error("net::ERR_NAME_NOT_RESOLVED at navigating"));
		expect(msg).toContain("DNS");
		expect(msg).toContain("domain");
	});

	test("converts connection refused", () => {
		const msg = toFriendlyError(new Error("net::ERR_CONNECTION_REFUSED"));
		expect(msg).toContain("refused");
	});

	test("converts timeout", () => {
		const msg = toFriendlyError(new Error("Timeout 30000ms exceeded"));
		expect(msg).toContain("timed out");
		expect(msg).toContain("pageTimeout");
	});

	test("converts SSL errors", () => {
		const msg = toFriendlyError(new Error("net::ERR_SSL_PROTOCOL_ERROR"));
		expect(msg).toContain("SSL");
		expect(msg).toContain("ignoreHttpsErrors");
	});

	test("converts redirect loop", () => {
		const msg = toFriendlyError(new Error("net::ERR_TOO_MANY_REDIRECTS"));
		expect(msg).toContain("redirect loop");
	});

	test("converts element not visible", () => {
		const msg = toFriendlyError(new Error("element is not visible"));
		expect(msg).toContain("not visible");
	});

	test("converts element intercepted", () => {
		const msg = toFriendlyError(new Error("element click intercepted by another element"));
		expect(msg).toContain("covering");
	});

	test("converts selector timeout", () => {
		const msg = toFriendlyError(new Error("waiting for selector '#content'"));
		expect(msg).toContain("waiting");
		expect(msg).toContain("selector");
	});

	test("converts browser closed", () => {
		const msg = toFriendlyError(new Error("browser has been closed"));
		expect(msg).toContain("closed unexpectedly");
	});

	test("converts ECONNREFUSED", () => {
		const msg = toFriendlyError(new Error("ECONNREFUSED 127.0.0.1:3000"));
		expect(msg).toContain("refused");
	});

	test("converts ENOTFOUND", () => {
		const msg = toFriendlyError(new Error("ENOTFOUND nonexistent.example.com"));
		expect(msg).toContain("not found");
	});

	test("passes through unknown errors cleaned up", () => {
		const msg = toFriendlyError(new Error("Error: something weird happened at line 42"));
		expect(msg).toBe("something weird happened");
	});

	test("handles string errors", () => {
		const msg = toFriendlyError("raw string error");
		expect(msg).toBe("raw string error");
	});
});
