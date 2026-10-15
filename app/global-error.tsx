"use client";

import { useEffect } from "react";
import { isStaleBuild, reloadForNewBuild } from "@/lib/stale-build";

/**
 * What replaces the whole page when it cannot be drawn.
 *
 * Most often, after a deploy, a page open from the build before asked for a
 * piece that is gone (lib/stale-build.ts): then it loads the new build at
 * once and the reader sees a line saying so rather than an error.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleBuild(error);
  useEffect(() => {
    if (stale) reloadForNewBuild();
  }, [stale]);

  return (
    <html lang="en" data-theme="dark">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#050608", color: "#e8e6e1", font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        <main style={{ maxWidth: 420, padding: 24 }}>
          <p style={{ margin: 0, color: "#ffa028", letterSpacing: ".08em", textTransform: "uppercase", fontSize: 11 }}>Tenkay</p>
          <h1 style={{ margin: "8px 0", fontSize: 18, fontWeight: 600 }}>
            {stale ? "A new version was just published" : "This page couldn't load"}
          </h1>
          <p style={{ margin: "0 0 16px", color: "#9a978f" }}>
            {stale ? "Loading it now… If nothing happens, reload." : "Something failed while drawing this page. Reloading usually fixes it."}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => window.location.reload()} style={{ font: "inherit", padding: "6px 12px", background: "#ffa028", color: "#1a0f00", border: 0, cursor: "pointer" }}>Reload</button>
            {!stale ? <button type="button" onClick={reset} style={{ font: "inherit", padding: "6px 12px", background: "transparent", color: "#e8e6e1", border: "1px solid #333", cursor: "pointer" }}>Try again</button> : null}
          </div>
        </main>
      </body>
    </html>
  );
}
