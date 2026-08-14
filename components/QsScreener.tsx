"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, FileImage, ShieldCheck } from "lucide-react";

export function QsScreener({ dark }: { dark: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = dark ? "dark" : "light";
  const [source] = useState(() => `/qs/index.html?embedded=1&theme=${theme}`);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === "qs-ready") setStatus("ready");
    };
    window.addEventListener("message", onMessage);
    frame.current?.contentWindow?.postMessage({ type: "finscope-theme", theme }, window.location.origin);
    const timeout = window.setTimeout(() => setStatus((current) => current === "ready" ? current : "failed"), 8_000);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(timeout); };
  }, [theme]);

  return <div className="qs-page">
    <section className="view-title qs-title"><div><span className="panel-kicker">QUALITY SCORING WORKSPACE</span><h2>QS Screener</h2><p>Paste an Excel, Google Sheets, fiscal.ai, CSV or TSV table. Scoring and image generation stay in your browser.</p></div><div className="qs-capabilities"><span><ClipboardPaste size={13}/> Paste or drop data</span><span><FileImage size={13}/> Dashboard + methodology PNG</span><span><ShieldCheck size={13}/> Local processing</span></div></section>
    <section className="panel qs-embed-panel">
      {status === "loading" && <p className="simple-state">Loading the QS Screener…</p>}
      {status === "failed" && <p className="notice">The embedded view did not confirm that it was ready. <a href="/qs/index.html" target="_blank" rel="noreferrer">Open the QS Screener directly</a>.</p>}
      <iframe ref={frame} onError={() => setStatus("failed")} onLoad={() => frame.current?.contentWindow?.postMessage({ type: "finscope-theme", theme }, window.location.origin)} src={source} title="QS Screener dashboard, methodology and data import"/>
    </section>
  </div>;
}
