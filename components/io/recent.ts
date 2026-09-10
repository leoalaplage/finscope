"use client";

import { useSyncExternalStore } from "react";
import { readRecentCompanies, RECENT_COMPANIES_EVENT } from "@/lib/io/last-company";

const EMPTY: string[] = [];
const subscribe = (notify: () => void) => {
  window.addEventListener(RECENT_COMPANIES_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(RECENT_COMPANIES_EVENT, notify); window.removeEventListener("storage", notify); };
};
const snapshot = () => JSON.stringify(readRecentCompanies());

export function useRecentCompanies(): string[] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  try { return JSON.parse(raw) as string[]; } catch { return EMPTY; }
}
