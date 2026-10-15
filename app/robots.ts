import type { MetadataRoute } from "next";

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://tenqay.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
