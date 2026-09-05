import type { Metadata } from "next";
import "@/app/io.css";
import { Portfolio } from "@/components/io/Portfolio";
import { Shell } from "@/components/io/Shell";

/**
 * Prerendered, like every page here, and for a stronger reason than the rest.
 *
 * A portfolio is the one thing on this site that is nobody's business but the
 * reader's, so it is not sent anywhere to be rendered: the document is the same
 * constant for everyone, the holdings are read from this device, and the
 * valuation is struck in the browser from figures that were public already.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Portfolio — FinScope.io",
  description: "What you own, read through to the revenue and free cash flow of the businesses underneath it.",
};

export default function PortfolioPage() {
  return (
    <Shell>
      <Portfolio />
    </Shell>
  );
}
