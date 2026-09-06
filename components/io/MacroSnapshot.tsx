"use client";

import { useEffect, useState } from "react";
import { readParsed } from "@/lib/fetch-json";
import { MACRO_SERIES, type MacroIndicator } from "@/lib/macro";

interface MacroAnswer { indicators?: MacroIndicator[]; error?: string }

function valueOf(indicator: Pick<MacroIndicator, "value" | "unit" | "decimals">) {
  if (indicator.value == null || !Number.isFinite(indicator.value)) return "—";
  const sign = indicator.unit === "percentage-points" && indicator.value > 0 ? "+" : "";
  const suffix = indicator.unit === "percentage-points" ? " pp" : "%";
  return `${sign}${indicator.value.toFixed(indicator.decimals)}${suffix}`;
}

function periodOf(date: string | null, frequency: MacroIndicator["frequency"]) {
  if (!date) return "Observation unavailable";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", frequency === "Monthly"
    ? { month: "short", year: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function MacroSnapshot() {
  const [answer, setAnswer] = useState<MacroAnswer | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/macro", { signal: controller.signal });
        const parsed = await readParsed<MacroAnswer>(response, { what: "the macro backdrop" });
        if (!controller.signal.aborted) {
          setAnswer(parsed.data ?? { error: parsed.error ?? "Macro data is unavailable." });
        }
      } catch (cause) {
        if (!controller.signal.aborted) setAnswer({ error: cause instanceof Error ? cause.message : "Macro data is unavailable." });
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const indicators = answer?.indicators ?? MACRO_SERIES.map((definition) => ({
    ...definition,
    value: null,
    date: null,
  }));

  return (
    <section className="section macro-section" aria-labelledby="macro-heading">
      <div className="section-head">
        <h2 className="label" id="macro-heading">Macro</h2>
        <span className="label">Latest published observation</span>
      </div>
      {answer?.error && <p className="notice">{answer.error}</p>}
      <div className="grid-ruled macro-grid" aria-busy={answer == null}>
        {indicators.map((indicator) => (
          <article className="macro-card" key={indicator.id}>
            <span className="label">{indicator.label}</span>
            <strong data-empty={indicator.value == null}>{answer == null ? "···" : valueOf(indicator)}</strong>
            <small>{indicator.note}</small>
            <time dateTime={indicator.date ?? undefined}>{periodOf(indicator.date, indicator.frequency)}</time>
          </article>
        ))}
      </div>
      <p className="macro-foot">
        Official US series from <a href="https://www.bls.gov/bls/api_features.htm" target="_blank" rel="noreferrer">BLS</a>, <a href="https://www.newyorkfed.org/markets/reference-rates" target="_blank" rel="noreferrer">New York Fed</a> and <a href="https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" target="_blank" rel="noreferrer">U.S. Treasury</a>. Daily and monthly figures keep their own observation date.
      </p>
    </section>
  );
}
