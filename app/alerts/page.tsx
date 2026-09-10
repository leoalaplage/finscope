import type { Metadata } from "next";
import "@/app/io.css";
import { AlertsCenter } from "@/components/io/AlertsCenter";
import { Shell } from "@/components/io/Shell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Alerts — FinScope.io", description: "Monitor new filings, insider decisions, valuation thresholds and grade changes locally." };

export default function AlertsPage() { return <Shell><AlertsCenter /></Shell>; }
