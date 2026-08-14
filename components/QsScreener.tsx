"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, FileImage, ShieldCheck } from "lucide-react";

export function QsScreener({ dark }: { dark: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = dark ? "dark" : "light";
  const [source] = useState(() => `/qs/index.html?embedded=1&theme=${theme}`);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "finscope-theme", theme }, window.location.origin);
  }, [theme]);

  return <div className="qs-page">
    <section className="view-title qs-title"><div><span className="panel-kicker">QUALITY SCORING WORKSPACE</span><h2>QS Screener</h2><p>Paste an Excel, Google Sheets, fiscal.ai, CSV or TSV table. Scoring and image generation stay in your browser.</p></div><div className="qs-capabilities"><span><ClipboardPaste size={13}/> Paste or drop data</span><span><FileImage size={13}/> Dashboard + methodology PNG</span><span><ShieldCheck size={13}/> Local processing</span></div></section>
    <section className="panel qs-embed-panel">
      <iframe ref={frame} onLoad={() => frame.current?.contentWindow?.postMessage({ type: "finscope-theme", theme }, window.location.origin)} src={source} title="QS Screener dashboard, methodology and data import"/>
    </section>
  </div>;
}
