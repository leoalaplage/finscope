/**
 * A criterion, said as what it says about the company.
 *
 * The engine names each measure as the virtue it scores — "Low LT debt", "Low
 * dilution", "Attractive EV/EBIT" — which is the right name for a column
 * heading and exactly the wrong one under the word "Weakest". Booking is scored
 * badly on long-term debt because it carries a great deal of it, and the page
 * said its weakness was *low long-term debt*: the sentence read as the opposite
 * of the finding, on the one part of the page that offers a judgement.
 *
 * So a criterion has two readings and the list decides which one is meant. The
 * measure is the same measure and the score is untouched; only the sentence
 * changes, and it now changes in the direction the score went.
 *
 * Keyed by the engine's own label, so a criterion this table has never heard of
 * still appears — under the name the engine gave it, which is what used to
 * happen to every one of them.
 */
const STANDING: Readonly<Record<string, { strong: string; weak: string }>> = {
  "ROIC": { strong: "High ROIC", weak: "Low ROIC" },
  "ROIC 5y": { strong: "High ROIC over 5y", weak: "Low ROIC over 5y" },
  "Operating margin": { strong: "High operating margin", weak: "Thin operating margin" },
  "FCF margin 5y": { strong: "High FCF margin over 5y", weak: "Thin FCF margin over 5y" },
  "FCF/Net income conv.": { strong: "Strong FCF conversion", weak: "Weak FCF conversion" },
  "Gross margin": { strong: "High gross margin", weak: "Thin gross margin" },
  "Low dilution": { strong: "No dilution", weak: "Share dilution" },
  "Low SBC/Revenue": { strong: "Light stock-based pay", weak: "Heavy stock-based pay" },
  "Low leverage": { strong: "Low leverage", weak: "High leverage" },
  "High interest coverage": { strong: "High interest coverage", weak: "Thin interest coverage" },
  "Strong current ratio": { strong: "Strong current ratio", weak: "Weak current ratio" },
  "Low LT debt": { strong: "Low long-term debt", weak: "High long-term debt" },
  "Capex coverage": { strong: "Self-funded capex", weak: "Capex outruns cash flow" },
  "Revenue growth 5y": { strong: "Strong revenue growth", weak: "Weak revenue growth" },
  "Fwd revenue growth": { strong: "Strong forecast revenue growth", weak: "Weak forecast revenue growth" },
  "FCF growth 5y": { strong: "Strong FCF growth", weak: "Weak FCF growth" },
  "Net income growth 5y": { strong: "Strong net income growth", weak: "Weak net income growth" },
  "Revenue/share growth 5y": { strong: "Strong revenue per share growth", weak: "Weak revenue per share growth" },
  "FCF/share growth 5y": { strong: "Strong FCF per share growth", weak: "Weak FCF per share growth" },
  "Attractive EV/EBIT": { strong: "Cheap on EV/EBIT", weak: "Expensive on EV/EBIT" },
  "Attractive EV/FCF": { strong: "Cheap on EV/FCF", weak: "Expensive on EV/FCF" },
  "Attractive P/FCF fwd": { strong: "Cheap on forward P/FCF", weak: "Expensive on forward P/FCF" },
  "FCF yield": { strong: "High FCF yield", weak: "Low FCF yield" },
};

/** What the company does well on this measure. */
export function asStrength(name: string): string {
  return STANDING[name]?.strong ?? name;
}

/** What it does badly on it — never the virtue it failed to reach. */
export function asWeakness(name: string): string {
  return STANDING[name]?.weak ?? name;
}
