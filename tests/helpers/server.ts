/**
 * Local HTTP test server for integration tests.
 * Uses Bun.serve() for zero-dependency setup.
 */

export const HOME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Home Page</title>
  <meta name="description" content="A test page for Feedstock crawler">
  <meta name="keywords" content="test, crawl, feedstock">
  <meta property="og:title" content="Test OG Title">
  <meta property="og:image" content="https://example.com/og.png">
  <link rel="canonical" href="https://example.com/">
</head>
<body>
  <header>
    <h1>Welcome to Test Site</h1>
    <nav>
      <a href="/about">About</a>
      <a href="/products">Products</a>
      <a href="https://external.com/link">External Link</a>
    </nav>
  </header>
  <main>
    <article>
      <h2>Main Article</h2>
      <p>This is the main content of the page. It has enough words to pass the word count threshold for extraction. The crawler should be able to process this text and convert it to markdown properly.</p>
      <img src="/images/hero.jpg" alt="Hero image" width="800">
      <img src="/images/thumb.png" alt="Thumbnail" width="50">
      <a href="/contact">Contact Us</a>
    </article>
    <aside>
      <h3>Sidebar</h3>
      <p>Some sidebar content that provides additional context.</p>
    </aside>
  </main>
  <footer>
    <p>&copy; 2024 Test Site</p>
  </footer>
</body>
</html>`;

export const PRODUCTS_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Products</title></head>
<body>
  <h1>Products</h1>
  <div class="product-list">
    <div class="product">
      <h2 class="product-name">Widget A</h2>
      <span class="price">$9.99</span>
      <p class="description">A fine widget for all your needs.</p>
      <div class="tags">
        <span class="tag">electronics</span>
        <span class="tag">gadgets</span>
      </div>
    </div>
    <div class="product">
      <h2 class="product-name">Widget B</h2>
      <span class="price">$19.99</span>
      <p class="description">A premium widget with extra features.</p>
      <div class="tags">
        <span class="tag">premium</span>
        <span class="tag">electronics</span>
      </div>
    </div>
    <div class="product">
      <h2 class="product-name">Widget C</h2>
      <span class="price">$4.99</span>
      <p class="description">An economy widget for budget shoppers.</p>
      <div class="tags">
        <span class="tag">budget</span>
      </div>
    </div>
  </div>
</body>
</html>`;

export const JS_RENDERED_HTML = `<!DOCTYPE html>
<html>
<head><title>JS Page</title></head>
<body>
  <div id="app">Loading...</div>
  <script>
    setTimeout(() => {
      document.getElementById('app').innerHTML = '<h1>JS Rendered Content</h1><p>This content was rendered by JavaScript after page load.</p>';
    }, 100);
  </script>
</body>
</html>`;

export const TABLES_HTML = `<!DOCTYPE html>
<html>
<head><title>Tables</title></head>
<body>
  <h1>Data Tables</h1>
  <table>
    <thead>
      <tr><th>Name</th><th>Age</th><th>City</th></tr>
    </thead>
    <tbody>
      <tr><td>Alice</td><td>30</td><td>New York</td></tr>
      <tr><td>Bob</td><td>25</td><td>San Francisco</td></tr>
      <tr><td>Charlie</td><td>35</td><td>Chicago</td></tr>
    </tbody>
  </table>
</body>
</html>`;

export const REDIRECT_TARGET_HTML = `<!DOCTYPE html>
<html>
<head><title>Redirect Target</title></head>
<body>
  <h1>You were redirected here</h1>
  <p>This is the final destination after redirect.</p>
</body>
</html>`;

export interface TestServer {
	url: string;
	stop: () => void;
}

export function startTestServer(): TestServer {
	const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });

	const server: ReturnType<typeof Bun.serve> = Bun.serve({
		port: 0,
		routes: {
			"/": () => html(HOME_HTML),
			"/products": () => html(PRODUCTS_HTML),
			"/js-rendered": () => html(JS_RENDERED_HTML),
			"/tables": () => html(TABLES_HTML),
			"/redirect-target": () => html(REDIRECT_TARGET_HTML),
			"/error": () => new Response("Internal Server Error", { status: 500 }),
			"/images/hero.jpg": () =>
				new Response("fake-image-data", { headers: { "content-type": "image/jpeg" } }),
			"/images/thumb.png": () =>
				new Response("fake-image-data", { headers: { "content-type": "image/png" } }),
		},
		fetch(req): Response | Promise<Response> {
			const url = new URL(req.url);
			if (url.pathname === "/redirect") {
				return Response.redirect(`http://localhost:${server.port}/redirect-target`, 301);
			}
			if (url.pathname === "/slow") {
				return new Promise<Response>((resolve) =>
					setTimeout(() => resolve(html("<html><body><p>Slow response</p></body></html>")), 1500),
				);
			}
			return new Response("Not Found", { status: 404 });
		},
	});

	return {
		url: `http://localhost:${server.port}`,
		stop: () => server.stop(),
	};
}
