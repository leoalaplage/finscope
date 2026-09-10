import type { MetadataRoute } from "next";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://finscope-financial-research.leoalaplage.workers.dev";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
