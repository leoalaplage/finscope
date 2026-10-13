"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useCompany } from "@/components/io/use-company";
import { DcfModel } from "@/components/io/DcfModel";
import { price as writePrice } from "@/components/io/format";

/**
 * The DCF on a screen of its own (/t/dcf?s=TICKER): the same model as the
 * company page's DCF panel (components/io/DcfModel.tsx), full width, with a
 * field to switch company. The address carries the company, so the screen can
 * be shared and comes back where it was.
 */

const EVENT = "finscope:dcf-ticker";
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify); window.addEventListener(EVENT, notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener(EVENT, notify); };
};
const readTicker = () => (new URLSearchParams(window.location.search).get("s") ?? "").toUpperCase();

export function DcfScreen({ initial }: { initial: string }) {
  const fromAddress = useSyncExternalStore(subscribe, readTicker, () => "");
  const ticker = fromAddress || initial;
  const [draft, setDraft] = useState("");
  const go = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim().toUpperCase();
    if (!next) return;
    window.history.pushState(null, "", `/t/dcf?s=${encodeURIComponent(next)}`);
    window.dispatchEvent(new Event(EVENT));
    setDraft("");
  };
  return (
    <div className="dcf-screen">
      <form className="dcf-screen-bar" onSubmit={go}>
        <label>
          <span className="t-dim">Company</span>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={ticker} aria-label="Ticker" />
        </label>
        <button type="submit" className="t-chip">Value</button>
        <a className="t-chip" href={`/t/s/${encodeURIComponent(ticker)}#dcf`}>{ticker} on its page</a>
      </form>
      <Loaded key={ticker} ticker={ticker} />
    </div>
  );
}

function Loaded({ ticker }: { ticker: string }) {
  const { state, quote, valuationQuote } = useCompany(ticker);
  if (state.kind === "failed") return <p className="t-empty">{ticker}: {state.message}</p>;
  if (state.kind !== "ready") return <p className="t-empty">Reading {ticker}&apos;s filings… {state.kind === "building" ? `${state.progress}%` : ""}</p>;
  const view = state.view;
  return (
    <>
      <header className="dcf-screen-head">
        <h1>{view.company.ticker}</h1>
        <span>{view.company.name}</span>
        {quote ? <b>{writePrice(quote.price, quote.currency)}</b> : null}
      </header>
      <DcfModel view={view} quote={valuationQuote} fullPage />
    </>
  );
}
