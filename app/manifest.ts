import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tenqay",
    short_name: "Tenqay",
    description: "Filed financials, market prices and valuation for US-listed companies.",
    start_url: "/",
    display: "standalone",
    background_color: "#090909",
    theme_color: "#090909",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
