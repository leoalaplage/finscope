import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the FinScope research workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /FinScope — Simple, auditable financial research/);
  assert.match(html, /Apple Inc\./);
  assert.match(html, />Companies</);
  assert.match(html, />Charts</);
  assert.match(html, />DCF</);
  assert.match(html, /FCF\/share CAGR 5Y/);
  assert.match(html, /Revenue\/share CAGR 5Y/);
  assert.doesNotMatch(html, /Quality overview/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
