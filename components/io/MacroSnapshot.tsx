"use client";

import { useEffect, useState } from "react";
import { readParsed } from "@/lib/fetch-json";
import {
  EUROSTAT_SERIES,
  MACRO_COUNTRIES,
  eurostatUrls,
  macroDefinitionsFor,
  parseEurostatObservation,
  type MacroCountry,
  type MacroIndicator,
} from "@/lib/macro";

interface MacroAnswer {
  country?: { code: string; name: string };
  indicators?: MacroIndicator[];
  error?: string;
}

function valueOf(indicator: Pick<MacroIndicator, "value" | "unit" | "decimals">) {
  if (indicator.value == null || !Number.isFinite(indicator.value)) return "—";
  const sign = indicator.unit === "percentage-points" && indicator.value > 0 ? "+" : "";
  const suffix = indicator.unit === "index" ? "" : indicator.unit === "percentage-points" ? " pp" : "%";
  return `${sign}${indicator.value.toFixed(indicator.decimals)}${suffix}`;
}

function periodOf(date: string | null, frequency: MacroIndicator["frequency"]) {
  if (!date) return "Observation unavailable";
  if (frequency === "Annual") return date;
  if (frequency === "Quarterly") return date.replace("-Q", " Q");
  if (frequency === "Monthly" && /^\d{4}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}-01T12:00:00Z`);
    return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

async function readEurostatDirect(country: MacroCountry, signal: AbortSignal) {
  if (!country.eurostat) return [];
  const results = await Promise.all(EUROSTAT_SERIES.map(async ({ definition, dataset, parameters }): Promise<MacroIndicator | null> => {
    const urls = eurostatUrls(dataset, country.eurostat as string, parameters, definition.frequency);
    try {
      const response = await fetch(urls.api, { headers: { Accept: "application/json" }, signal });
      if (!response.ok) return null;
      const observation = parseEurostatObservation(await response.json());
      return observation ? {
        ...definition,
        ...observation,
        source: "Eurostat",
        sourceUrl: urls.source,
      } satisfies MacroIndicator : null;
    } catch {
      return null;
    }
  }));
  return results.filter((indicator): indicator is MacroIndicator => indicator !== null);
}

function mergeEurostat(answer: MacroAnswer | null, country: MacroCountry, eurostat: MacroIndicator[]): MacroAnswer {
  if (!eurostat.length) return answer ?? { error: "Macro data is unavailable." };
  const base = answer?.indicators ?? [];
  const indicators = macroDefinitionsFor(country.code).flatMap((definition) =>
    eurostat.find((indicator) => indicator.id === definition.id)
    ?? base.find((indicator) => indicator.id === definition.id)
    ?? [],
  );
  return { ...answer, country: { code: country.code, name: country.name }, indicators, error: undefined };
}

export function MacroSnapshot() {
  const [countryCode, setCountryCode] = useState("US");
  const [answers, setAnswers] = useState<Record<string, MacroAnswer>>({});
  const answer = answers[countryCode];
  const country = MACRO_COUNTRIES.find((candidate) => candidate.code === countryCode) ?? MACRO_COUNTRIES[0];

  useEffect(() => {
    if (answers[countryCode]) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const [response, eurostat] = await Promise.all([
          fetch(`/api/macro?country=${encodeURIComponent(countryCode)}`, { signal: controller.signal }),
          readEurostatDirect(country, controller.signal),
        ]);
        const parsed = await readParsed<MacroAnswer>(response, { what: `${country.name}'s macro backdrop` });
        if (!controller.signal.aborted) {
          setAnswers((current) => ({
            ...current,
            [countryCode]: mergeEurostat(parsed.data, country, eurostat),
          }));
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setAnswers((current) => ({ ...current, [countryCode]: { error: cause instanceof Error ? cause.message : "Macro data is unavailable." } }));
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [answers, country.name, countryCode]);

  const indicators = answer?.indicators ?? macroDefinitionsFor(countryCode).map((definition) => ({
    ...definition,
    value: null,
    date: null,
    source: "",
    sourceUrl: "",
  }));

  return (
    <section className="section macro-section" aria-labelledby="macro-heading">
      <div className="section-head">
        <h2 className="label" id="macro-heading">Macro</h2>
        <span className="label">{country.name} · latest available data</span>
      </div>
      <div className="macro-countries" role="group" aria-label="Select a macro geography">
        {MACRO_COUNTRIES.map((option) => (
          <button
            className={`macro-country${option.code === countryCode ? " active" : ""}`}
            type="button"
            aria-pressed={option.code === countryCode}
            onClick={() => setCountryCode(option.code)}
            key={option.code}
          >
            {option.name}
          </button>
        ))}
      </div>
      {answer?.error && <p className="notice">{answer.error}</p>}
      <div className="grid-ruled macro-grid" aria-busy={answer == null}>
        {indicators.map((indicator) => (
          <article className="macro-card" key={indicator.id}>
            <span className="label">{indicator.label}</span>
            <strong data-empty={indicator.value == null}>{answer == null ? "···" : valueOf(indicator)}</strong>
            <small>{indicator.note}</small>
            <div className="macro-card-meta">
              {indicator.sourceUrl ? <a href={indicator.sourceUrl} target="_blank" rel="noreferrer">{indicator.source}</a> : <span>Official release</span>}
              <time dateTime={indicator.date ?? undefined}>{periodOf(indicator.date, indicator.frequency)}</time>
            </div>
          </article>
        ))}
      </div>
      <p className="macro-foot">Official releases only. Frequencies differ by series; no estimate is substituted for a missing observation.</p>
    </section>
  );
}
