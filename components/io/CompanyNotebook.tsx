"use client";

import { useEffect, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import { edgarUrl } from "./format";
import { ExportMenu, type ExportRow } from "./ExportMenu";

interface Note { thesis: string; risks: string; catalysts: string; reviewDate: string; updatedAt: string }
const empty = (): Note => ({ thesis: "", risks: "", catalysts: "", reviewDate: "", updatedAt: "" });
const key = (ticker: string) => `finscope.io.note.${ticker}.v1`;

function read(ticker: string): Note {
  try {
    const value = JSON.parse(localStorage.getItem(key(ticker)) ?? "null") as Partial<Note> | null;
    return value ? { ...empty(), ...value } : empty();
  } catch { return empty(); }
}

export function CompanyNotebook({ view }: { view: IoCompanyView }) {
  const ticker = view.company.ticker;
  const [note, setNote] = useState<Note>(empty);
  const [saved, setSaved] = useState("");
  useEffect(() => { const timer = setTimeout(() => setNote(read(ticker)), 0); return () => clearTimeout(timer); }, [ticker]);
  const update = (field: keyof Note, value: string) => setNote((current) => ({ ...current, [field]: value }));
  const save = () => {
    const next = { ...note, updatedAt: new Date().toISOString() };
    try { localStorage.setItem(key(ticker), JSON.stringify(next)); } catch { /* The draft remains in memory. */ }
    setNote(next); setSaved("Saved on this device"); setTimeout(() => setSaved(""), 1_800);
  };
  const rows: ExportRow[] = view.annual.slice(-8).reverse().map((period) => ({
    ticker,
    period: period.label,
    periodEnd: period.end,
    revenue: period.values.revenue,
    freeCashFlow: period.values.freeCashFlow,
    operatingMargin: period.values.operatingMargin,
    dilutedShares: period.values.dilutedShares,
    filing: edgarUrl(view.company.cik, period.accession),
  }));
  const latest = view.annual.at(-1) ?? view.quarterly.at(-1);
  const source = latest ? edgarUrl(view.company.cik, latest.accession) : null;

  return (
    <section className="section company-notebook" aria-labelledby="notebook-title">
      <div className="section-head">
        <div><h2 className="label" id="notebook-title">Research notebook</h2><p className="stat-note">Private to this browser · tied to {ticker}</p></div>
        <ExportMenu name={`${ticker}-financials`} rows={rows} provenance={[`SEC EDGAR · ${source ?? "source unavailable"}`, `Filings read ${view.retrievedAt}`]} />
      </div>
      <div className="notebook-grid">
        <label><span>Thesis</span><textarea value={note.thesis} onChange={(event) => update("thesis", event.target.value)} placeholder="What must remain true?" /></label>
        <label><span>Risks</span><textarea value={note.risks} onChange={(event) => update("risks", event.target.value)} placeholder="What would break the thesis?" /></label>
        <label><span>Catalysts</span><textarea value={note.catalysts} onChange={(event) => update("catalysts", event.target.value)} placeholder="What could change the market’s view?" /></label>
      </div>
      <div className="notebook-foot">
        <label><span>Review on</span><input type="date" value={note.reviewDate} onChange={(event) => update("reviewDate", event.target.value)} /></label>
        {source ? <a href={source} target="_blank" rel="noreferrer">Latest filing source →</a> : null}
        <span aria-live="polite">{saved || (note.updatedAt ? `Last saved ${new Date(note.updatedAt).toLocaleDateString("en-GB")}` : "")}</span>
        <button type="button" onClick={save}>Save note</button>
      </div>
    </section>
  );
}
