"use client";

import { useMemo, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import type { IoQuote } from "./quote";
import { balanceSheetIsTheBusiness } from "@/lib/business-type";
import type { BusinessType } from "@/lib/types";
import { dcfFoundation, defaultDrivers, valueWith } from "@/lib/io/dcf-model";
import { useCostOfEquity } from "./use-cost-of-equity";
import { deleteThesisNote, saveThesisNote, useThesisNotes, type Stance } from "./thesis";
import { ABSENT, price as writePrice, shortDate } from "./format";

const STANCES: Array<{ id: Stance; label: string }> = [
  { id: "buy", label: "Buy" }, { id: "hold", label: "Hold" }, { id: "sell", label: "Sell" }, { id: "watch", label: "Watch" },
];
const signed = (value: number | null) => (value == null || !Number.isFinite(value) ? ABSENT : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`);
const tone = (value: number | null) => (value == null ? undefined : value >= 0 ? "up" : "down");
const amount = (text: string) => { const value = Number(text.replace(/[^0-9.]/g, "")); return text.trim() && Number.isFinite(value) && value > 0 ? value : null; };

/**
 * NOTE: the reader's thesis on this company, kept in their browser — what
 * they think and why, the price and the DCF value the day they wrote it, and
 * the prices they would act at, which the alerts watch. Each earlier note
 * says how the price has moved since.
 */
export function ThesisNotes({ view, quote }: { view: IoCompanyView; quote: IoQuote | null }) {
  const ticker = view.company.ticker;
  const notes = useThesisNotes().filter((note) => note.ticker === ticker);
  const [stance, setStance] = useState<Stance>("watch");
  const [text, setText] = useState("");
  const [buyBelow, setBuyBelow] = useState("");
  const [sellAbove, setSellAbove] = useState("");
  const [saved, setSaved] = useState(false);

  // The base-case value the DCF panel shows, struck the same way, for the note to keep.
  const lender = balanceSheetIsTheBusiness((view.company.businessType ?? undefined) as BusinessType | undefined);
  const coe = useCostOfEquity(ticker);
  const price = quote?.price ?? null;
  const fairValue = useMemo(() => {
    if (lender) return null;
    const foundation = dcfFoundation(view);
    if (!foundation || !coe.settled) return null;
    const drivers = defaultDrivers(foundation, coe.value?.rate ?? null, price != null ? price * foundation.base.dilutedShares : null, coe.value?.riskFree ?? coe.market?.riskFree ?? null);
    return valueWith(foundation, drivers).intrinsicValuePerShare;
  }, [lender, view, coe.settled, coe.value, coe.market, price]);
  const currency = quote?.currency ?? view.company.currency;

  const save = () => {
    if (!text.trim()) return;
    saveThesisNote({ ticker, stance, text: text.trim(), price, fairValue, currency, buyBelow: amount(buyBelow), sellAbove: amount(sellAbove) });
    setText(""); setSaved(true);
  };

  return (
    <div className="thesis">
      <div className="thesis-form">
        <div className="seg" role="group" aria-label="Stance">
          {STANCES.map((entry) => <button key={entry.id} type="button" aria-pressed={stance === entry.id} onClick={() => setStance(entry.id)}>{entry.label}</button>)}
        </div>
        <textarea className="field" rows={4} value={text} placeholder={`Why ${ticker}? What would make you wrong?`} onChange={(event) => { setText(event.target.value); setSaved(false); }} aria-label="Your note" />
        <div className="thesis-levels">
          <label>Alert me below <input className="field" inputMode="decimal" value={buyBelow} placeholder={fairValue ? writePrice(fairValue * 0.85, currency) : "price"} onChange={(event) => setBuyBelow(event.target.value)} /></label>
          <label>Alert me above <input className="field" inputMode="decimal" value={sellAbove} placeholder={fairValue ? writePrice(fairValue * 1.15, currency) : "price"} onChange={(event) => setSellAbove(event.target.value)} /></label>
          <button type="button" className="t-chip thesis-save" onClick={save} disabled={!text.trim()}>Save note</button>
        </div>
        <p className="t-study-note">Kept with the price ({writePrice(price, currency)}) and the DCF base case ({fairValue == null ? (lender ? "not for a lender" : "being struck…") : writePrice(fairValue, currency)}) of today. In this browser only.{saved ? " Saved." : ""}</p>
      </div>
      <div className="thesis-list">
        {notes.length ? notes.map((note) => {
          const moved = note.price && price ? price / note.price - 1 : null;
          return (
            <article key={note.id} className="thesis-note">
              <header>
                <span className="thesis-stance" data-stance={note.stance}>{note.stance}</span>
                <span className="t-dim">{shortDate(note.written)}</span>
                <span>at {writePrice(note.price, note.currency ?? currency)}{note.fairValue != null ? ` · value ${writePrice(note.fairValue, note.currency ?? currency)}` : ""}</span>
                <span data-dir={tone(moved)}>{signed(moved)} since</span>
                <button type="button" className="thesis-delete" aria-label="Delete this note" onClick={() => { if (window.confirm("Delete this note?")) deleteThesisNote(note.id); }}>×</button>
              </header>
              <p>{note.text}</p>
              {note.buyBelow != null || note.sellAbove != null ? (
                <p className="t-dim">Alerts: {note.buyBelow != null ? `below ${writePrice(note.buyBelow, note.currency ?? currency)}` : ""}{note.buyBelow != null && note.sellAbove != null ? " · " : ""}{note.sellAbove != null ? `above ${writePrice(note.sellAbove, note.currency ?? currency)}` : ""}</p>
              ) : null}
            </article>
          );
        }) : <p className="t-empty">No note on {ticker} yet.</p>}
      </div>
    </div>
  );
}
