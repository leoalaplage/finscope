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
  assert.match(html, /FinScope — Auditable financial research/);
  assert.match(html, /Apple Inc\./);
  assert.match(html, /Per-share compounding, cash quality and dilution discipline/);
  assert.match(html, /Growth &amp; CAGR/);
  assert.match(html, /QUARTERLY/);
  assert.match(html, /TTM/);
  assert.match(html, /Sources &amp; methodology/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
