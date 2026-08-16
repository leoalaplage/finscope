"use client";

import { useEffect, useRef, useState } from "react";

/** Directory form: the asset handler 307s /qs/index.html to /qs/, and paying
 *  for that redirect on every mount is a round-trip for nothing. */
const SOURCE = "/qs/?embedded=1&theme=";
/** Tall enough that nothing is clipped before the page reports its own size. */
const INITIAL_HEIGHT = 900;
const MIN_HEIGHT = 420;

export function QsScreener({ theme }: { theme: "light" | "dark" }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  // The frame was loaded with the theme nailed to light and never told
  // otherwise, so the screener sat white inside a dark application and read as
  // somebody else's product. It has understood this message all along.
  const [initialTheme] = useState(theme);

  useEffect(() => {
    // The screener reports its own content height, so the embedded page grows
    // with the generated table instead of scrolling inside a fixed box.
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "qs-ready") setStatus("ready");
      if (event.data?.type === "qs-height" && typeof event.data.height === "number") setHeight(Math.max(MIN_HEIGHT, Math.ceil(event.data.height)));
    };
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(() => setStatus((current) => current === "ready" ? current : "failed"), 8_000);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(timeout); };
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    frame.current?.contentWindow?.postMessage({ type: "finscope-theme", theme }, window.location.origin);
  }, [theme, status]);

  return <div className="qs-page">
    <header className="page-heading">
      <div>
        <h1>QS Screener</h1>
        <p>Paste an export from fiscal.ai, Excel, Google Sheets or a CSV file. The quality score is computed and rendered as a shareable image in your browser — nothing is uploaded.</p>
      </div>
      <a className="qs-standalone" href="/qs/" target="_blank" rel="noreferrer">Open full screen ↗</a>
    </header>
    {status === "failed" && <p className="notice">The embedded screener did not confirm that it loaded. <a href="/qs/" target="_blank" rel="noreferrer">Open it in its own tab</a>.</p>}
    {status === "loading" && <p className="simple-state">Loading the QS Screener…</p>}
    <iframe ref={frame} className="qs-frame" style={{ height }} onError={() => setStatus("failed")} src={`${SOURCE}${initialTheme}`} title="QS Screener: paste data, scoring settings and generated dashboard"/>
  </div>;
}
