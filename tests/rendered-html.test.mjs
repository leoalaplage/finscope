import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

/** The current terminal routes must survive the production Worker build. */
test("redirects the former front door to the terminal", async () => {
  const response = await render();
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).pathname, "/t");
});

test("server-renders the terminal and DCF screen without a data provider", async () => {
  for (const path of ["/t", "/t/dcf"]) {
    const response = await render(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Tenqay/);
    assert.match(html, /aria-label="Command"/);
    assert.match(html, /<html lang="en" data-theme="dark"/);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
    if (path === "/t/dcf") {
      assert.match(html, /DCF calculator from SEC filings/);
      assert.match(html, /aria-label="Ticker"/);
    }
  }
});
