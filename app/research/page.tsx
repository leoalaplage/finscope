import type { Metadata } from "next";
import "@/app/globals.css";
import { FinanceApp } from "@/components/FinanceApp";
import { APPLE_DATASET } from "@/lib/demo-data";

/**
 * The research workspace, where the front page used to be.
 *
 * FinScope.io took over `/` — a search and one company, drawn as plainly as the
 * data allows. This is the other half of the same engines: every period, every
 * provenance record, the coverage matrix, the screener and the charting bench.
 * It is unchanged, including the reasons it is prerendered from a fixture and
 * replaced by live data the moment it mounts. Its stylesheet is imported here
 * rather than in the root layout so that the .io pages ship none of it.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "FinScope — See the business. Verify the numbers.",
  description: "Traceable financial research from SEC filings, matched market prices and explicit formulas.",
};

export default function Research() {
  return <FinanceApp initialData={APPLE_DATASET} />;
}
