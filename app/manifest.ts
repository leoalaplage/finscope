import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tenqay",
    short_name: "Tenqay",
    description: "Filed financials, market prices and valuation for US-listed companies.",
    start_url: "/t",
    display: "standalone",
    background_color: "#0c0f14",
    theme_color: "#0c0f14",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
