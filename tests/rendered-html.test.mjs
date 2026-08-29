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
  assert.match(html, /FinScope — Simple, auditable financial research/);
  // The offline fixture, which is what makes this page renderable with no
  // network and no Worker CPU. See app/page.tsx.
  assert.match(html, /Apple Inc\./);
  // Every top-level destination, by its current label.
  for (const label of ["Watchlist", "Market", "Portfolio", "Statistics", "Charts", "DCF", "QS Screener"]) {
    assert.match(html, new RegExp(`>${label}<`), `navigation is missing ${label}`);
  }
  // The default theme is stamped in the markup rather than applied by an
  // effect, so a reader never meets a white flash before the bundle boots.
  assert.match(html, /<html lang="en" data-theme="dark"/);
  // An instrument with no filing feed says so rather than sitting on a loading
  // label for ever. See HomePage: HES Beheer was delisted in 2014.
  assert.match(html, />No filing feed available</);
  assert.doesNotMatch(html, /Quality overview/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
