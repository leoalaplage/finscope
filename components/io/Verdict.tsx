import { verdictOf, type ScoreSummary, type Verdict as VerdictReading } from "@/lib/io/verdict";
import type { IoCompanyView } from "@/lib/io/view";
import type { IoQuote } from "./quote";
import { ABSENT } from "./format";

/**
 * The four answers as one line: quality, health, valuation, growth.
 *
 * Shared with the comparison, which draws the same cells a company to a column
 * (see `verdictCells`), so a company reads the same in both places.
 */

export interface VerdictCell { key: string; label: string; value: string | null; words: string | null; note: string; tone: "good" | "bad" | "neutral" | null }

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const signed = (rate: number) => `${rate >= 0 ? "+" : "−"}${Math.abs(rate * 100).toFixed(1)}%`;

export function verdictCells(verdict: VerdictReading): VerdictCell[] {
  const { quality, health, valuation, growth } = verdict;
  return [
    {
      key: "quality", label: "Quality business", value: quality.answer, words: quality.grade && quality.grade !== "NR" ? `Grade ${quality.grade}` : null,
      note: quality.note, tone: quality.answer === "Yes" ? "good" : quality.answer === "No" ? "bad" : null,
    },
    {
      key: "health", label: "Financial health", value: health.state ? capital(health.state) : null, words: null,
      note: health.note, tone: health.state === "fortress" || health.state === "sound" ? "good" : health.state === "stretched" || health.state === "strained" ? "bad" : health.state ? "neutral" : null,
    },
    {
      key: "valuation", label: "Price against growth", value: valuation.score == null ? null : `${valuation.score}/100`, words: valuation.words,
      note: valuation.note, tone: valuation.score == null ? null : valuation.score >= 67 ? "good" : valuation.score < 40 ? "bad" : "neutral",
    },
    {
      key: "growth", label: "Historic growth", value: growth.five == null ? null : `${signed(growth.five)}/yr`, words: growth.words,
      note: growth.note, tone: growth.five == null ? null : growth.five >= 0.1 ? "good" : growth.five < 0 ? "bad" : "neutral",
    },
  ];
}

export function Verdict({ view, quote, score, scoreLoading }: { view: IoCompanyView; quote: IoQuote | null; score: ScoreSummary | null; scoreLoading: boolean }) {
  const cells = verdictCells(verdictOf(view, quote, score, scoreLoading));
  return (
    <section className="section verdict" id="verdict" aria-label="At a glance">
      <div className="section-head">
        <h2 className="label">At a glance</h2>
        <span className="label">Details below</span>
      </div>
      <div className="grid-ruled verdict-grid">
        {cells.map((cell) => (
          <div className="stat" key={cell.key} title={cell.note}>
            <div className="label">{cell.label}</div>
            <div className="stat-value verdict-value" data-empty={cell.value == null} data-tone={cell.tone ?? undefined}>
              {cell.value ?? ABSENT}
              {cell.words ? <span className="verdict-words"> {cell.words}</span> : null}
            </div>
            <div className="health-meaning">{cell.note}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
