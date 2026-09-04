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
  title: "FinScope — Simple, auditable financial research",
  description: "Research companies, compare financial metrics and build a traceable DCF in one focused workspace.",
};

export default function Research() {
  return (
    <>
      {/*
        * The one typeface this workspace owns, requested by the only route
        * that sets anything in it.
        *
        * It used to be asked for in the root layout, which meant a company
        * page on FinScope.io opened two connections to a font server and
        * waited on a stylesheet for a face it never uses. React hoists a
        * stylesheet declared in a component into the document head, so the
        * request happens here and only here. Preconnected so the two requests
        * overlap it, and swapped so text is readable from the first paint.
        */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* The rule this silences is about the Pages Router's `_document`, where
          a per-page font really would load for one page only. In the App
          Router a stylesheet declared in a route component is hoisted into the
          head by React, which is exactly the scoping wanted here. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap" />
      <FinanceApp initialData={APPLE_DATASET} />
    </>
  );
}
