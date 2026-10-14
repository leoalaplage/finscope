/**
 * A page opened before a deploy, asking for a piece of the build that came
 * before it.
 *
 * The application loads its screens in pieces, named by their content. A
 * deploy replaces them, so a reader who had a page open and then moved to a
 * screen not loaded yet asked for a piece that no longer existed — and got
 * "This page couldn't load". The deploy keeps the previous pieces for a week
 * (scripts/keep-assets.mjs); where one is gone all the same, the page loads
 * the new build instead of failing: once, never in a loop.
 */
export const STALE_BUILD = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Unable to preload CSS/i;

const KEY = "finscope.reloaded-for-build";

export function isStaleBuild(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return STALE_BUILD.test(message);
}

/** Loads the page again, unless it was just loaded again for this reason (a minute), so a real outage does not loop. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Without storage, one reload is still better than the error.
  }
  window.location.reload();
  return true;
}

/** The same, as a script the document runs before anything else: a failed piece is caught wherever it fails. */
export const STALE_BUILD_BOOT = `(function(){var re=${STALE_BUILD.toString()};function go(){try{var l=+sessionStorage.getItem("${KEY}")||0;if(Date.now()-l<60000)return;sessionStorage.setItem("${KEY}",String(Date.now()))}catch(e){}location.reload()}window.addEventListener("vite:preloadError",function(e){e.preventDefault();go()});window.addEventListener("unhandledrejection",function(e){var r=e.reason;if(re.test(r&&r.message?r.name+" "+r.message:String(r)))go()});window.addEventListener("error",function(e){if(e.message&&re.test(e.message))go()})})();`;
