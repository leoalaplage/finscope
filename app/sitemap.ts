import type { MetadataRoute } from "next";
import { UNIVERSE } from "@/lib/universe";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://finscope-financial-research.leoalaplage.workers.dev";

/**
 * The terminal's public screens and the S&P 500's company pages. The reader's
 * own screens — account, portfolio, alerts, settings — are not listed and
 * carry noindex.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const screens: MetadataRoute.Sitemap = [
    { url: `${SITE_ORIGIN}/t`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_ORIGIN}/t/market`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_ORIGIN}/t/screener`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_ORIGIN}/t/insiders`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_ORIGIN}/t/ecal`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_ORIGIN}/t/chart`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_ORIGIN}/t/compare`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_ORIGIN}/t/dcf`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_ORIGIN}/t/backtest`, changeFrequency: "weekly", priority: 0.5 },
  ];
  const companies: MetadataRoute.Sitemap = UNIVERSE.map((member) => ({
    url: `${SITE_ORIGIN}/t/s/${encodeURIComponent(member.ticker)}`,
    changeFrequency: "daily",
    priority: 0.8,
  }));
  return [...screens, ...companies];
}
