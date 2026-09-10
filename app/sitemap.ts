import type { MetadataRoute } from "next";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://finscope-financial-research.leoalaplage.workers.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_ORIGIN, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_ORIGIN}/compare`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_ORIGIN}/dcf`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_ORIGIN}/markets`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_ORIGIN}/portfolio`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_ORIGIN}/research`, changeFrequency: "weekly", priority: 0.5 },
  ];
  const companies: MetadataRoute.Sitemap = DEFAULT_WATCHLIST.map((company) => ({
    url: `${SITE_ORIGIN}/s/${encodeURIComponent(company.ticker)}`,
    changeFrequency: "daily",
    priority: 0.8,
  }));
  return [...staticRoutes, ...companies];
}
