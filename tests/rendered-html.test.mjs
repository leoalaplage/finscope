import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

/**
 * The prerendered document, checked for the things that must survive a build.
 *
 * Assertions here are deliberately about structure rather than copy. This test
 * spent several releases failing on `>Companies<` and on two card labels that
 * had been renamed long before, which is worse than having no test: a suite
 * nobody can run green is a suite nobody reads.
 */
test("server-renders the FinScope research workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /FinScope\.io — Every US filer\. Every filed figure\./);
  // The front door: the thesis, and the field that is the whole page.
  assert.match(html, /Every US filer\.<br\/>Every filed figure\./);
  assert.match(html, /aria-label="Search any US-listed company"/);
  // The default watchlist is prerendered, so the front page works without
  // network access or Worker CPU and keeps its primary destination visible.
  assert.match(html, /href="\/s\/NVDA">NVDA/);
  for (const label of ["Market", "Company", "Compare", "Screener"]) {
    assert.match(html, new RegExp(`>${label}<`), `navigation is missing ${label}`);
  }
  assert.match(html, /href="\/settings" aria-label="Open settings"/);
  // The default theme is stamped in the markup rather than applied by an
  // effect, so a reader never meets a white flash before the bundle boots.
  assert.match(html, /<html lang="en" data-theme="dark"/);
  assert.doesNotMatch(html, /Quality overview/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
