import { describe, expect, test } from "bun:test";
import { buildStaticSnapshot } from "../../src/snapshot/accessibility";

const PAGE_HTML = `<html>
<head><title>Test Page</title></head>
<body>
  <h1>Main Heading</h1>
  <h2>Sub Heading</h2>
  <p>This is a paragraph with enough text to be included in the snapshot.</p>
  <a href="https://example.com">Example Link</a>
  <a href="/about">About Us</a>
  <button>Click Me</button>
  <input type="text" placeholder="Enter name" />
  <input type="checkbox" name="agree" />
  <input type="hidden" name="token" value="abc" />
  <img src="/photo.jpg" alt="A photo" />
  <img src="/icon.png" />
  <p>Short</p>
</body>
</html>`;

describe("buildStaticSnapshot", () => {
	const snap = buildStaticSnapshot(PAGE_HTML);

	test("extracts headings with levels", () => {
		const headings = snap.tree.filter((n) => n.role === "heading");
		expect(headings.length).toBe(2);
		expect(headings[0].name).toBe("Main Heading");
		expect(headings[0].level).toBe(1);
		expect(headings[1].name).toBe("Sub Heading");
		expect(headings[1].level).toBe(2);
	});

	test("extracts links with URLs", () => {
		const links = snap.tree.filter((n) => n.role === "link");
		expect(links.length).toBe(2);
		expect(links[0].name).toBe("Example Link");
		expect(links[0].url).toBe("https://example.com");
		expect(links[1].name).toBe("About Us");
		expect(links[1].url).toBe("/about");
	});

	test("extracts buttons", () => {
		const buttons = snap.tree.filter((n) => n.role === "button");
		expect(buttons.length).toBe(1);
		expect(buttons[0].name).toBe("Click Me");
	});

	test("extracts text inputs", () => {
		const inputs = snap.tree.filter((n) => n.role === "textbox");
		expect(inputs.length).toBe(1);
		expect(inputs[0].name).toBe("Enter name");
	});

	test("extracts checkboxes", () => {
		const checks = snap.tree.filter((n) => n.role === "checkbox");
		expect(checks.length).toBe(1);
	});

	test("skips hidden inputs", () => {
		const all = snap.tree.map((n) => n.name);
		expect(all).not.toContain("token");
	});

	test("extracts images with alt text only", () => {
		const images = snap.tree.filter((n) => n.role === "img");
		expect(images.length).toBe(1);
		expect(images[0].name).toBe("A photo");
	});

	test("extracts paragraphs over 20 chars", () => {
		const paras = snap.tree.filter((n) => n.role === "paragraph");
		expect(paras.length).toBe(1);
		expect(paras[0].name).toContain("paragraph");
	});

	test("assigns refs to interactive/content nodes", () => {
		expect(snap.nodeCount).toBeGreaterThan(0);
		expect(snap.refs.size).toBe(snap.nodeCount);
	});

	test("renders text output", () => {
		expect(snap.text).toContain("[heading]");
		expect(snap.text).toContain("[link]");
		expect(snap.text).toContain("[button]");
		expect(snap.text).toContain("@e1");
		expect(snap.text.length).toBeGreaterThan(50);
	});
});
