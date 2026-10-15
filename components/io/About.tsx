"use client";

import { useEffect, useState } from "react";
import type { Description } from "@/lib/description";
import { shortDate } from "./format";

/**
 * What a company or fund is, in a paragraph, with its source (lib/description.ts):
 * the company's own annual report where it can be read, Wikipedia otherwise.
 * Folded to its first lines; one press shows the rest.
 */
export function About({ ticker, fallback = null }: { ticker: string; fallback?: { text: string; source: string; url?: string } | null }) {
  const [answer, setAnswer] = useState<{ ticker: string; value: Description | null } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (fallback) return;
    const controller = new AbortController();
    fetch(`/api/description/${encodeURIComponent(ticker)}?v=2`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Description | null> : null))
      .then((value) => { if (!controller.signal.aborted) setAnswer({ ticker, value }); })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ ticker, value: null }); });
    return () => controller.abort();
  }, [ticker, fallback]);
  const value = fallback ?? (answer?.ticker === ticker ? answer.value : null);
  if (!value) return null;
  const source = fallback
    ? fallback.source
    : value.source === "Wikipedia" ? "Wikipedia · CC BY-SA" : `${value.source}${"filed" in value && typeof value.filed === "string" ? ` filed ${shortDate(value.filed)}` : ""} · the company's own words`;
  const long = value.text.length > 360;
  return (
    <section className="about" aria-label={`About ${ticker}`}>
      <p className="about-text" data-open={open || !long || undefined}>{value.text}</p>
      <div className="about-foot">
        {long ? <button type="button" className="metric-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>{open ? "Less" : "More"}</button> : null}
        {value.url ? <a className="label" href={value.url} target="_blank" rel="noreferrer">{source}</a> : <span className="label">{source}</span>}
      </div>
    </section>
  );
}
