"use client";

import { useMemo, useSyncExternalStore } from "react";
import { lineLevel, newRule, parseRules, RULES_KEY, type AlertLine, type AlertRule, type LineReach } from "@/lib/alert-rules";
import type { Drawing, DrawingKind } from "@/lib/term/drawings";

/**
 * Alerts on the lines a reader draws: set from the drawing's bar on the chart,
 * kept with the other alert rules (finscope.io.alert-rules.v1), so ALRT lists
 * them and the evening email sends them (lib/email-alerts.ts). Moving the line
 * moves its alert; deleting it deletes the alert.
 */

const EVENT = "finscope:alerts";

/** The drawings an alert can watch, and how far each runs. */
const REACH: Partial<Record<DrawingKind, LineReach>> = { hline: "level", hray: "hray", trend: "segment", arrow: "segment", ray: "ray", extended: "extended" };
export const canAlert = (kind: DrawingKind) => REACH[kind] != null;

const read = () => { try { return localStorage.getItem(RULES_KEY); } catch { return null; } };
const write = (rules: AlertRule[]) => {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)); } catch { /* not kept */ }
  window.dispatchEvent(new Event(EVENT));
};
const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); };
};

/** The ids of the drawings that have an alert. */
export function useAlertedDrawings(): ReadonlySet<string> {
  const text = useSyncExternalStore(subscribe, read, () => null);
  return useMemo(() => new Set(parseRules(text).flatMap((rule) => (rule.type === "line" && rule.drawingId ? [rule.drawingId] : []))), [text]);
}

const lineOf = (drawing: Drawing, log: boolean): AlertLine | null => {
  const reach = REACH[drawing.kind];
  return reach ? { reach, a: drawing.a, b: drawing.b, log } : null;
};

/**
 * An alert on the drawing, or none if it had one. It watches for the price
 * crossing the line from the side it is on now: above the line, a fall
 * through it; below, a rise.
 */
export function toggleLineAlert(symbol: string, drawing: Drawing, lastPrice: number, log: boolean) {
  const rules = parseRules(read());
  if (rules.some((rule) => rule.drawingId === drawing.id)) {
    write(rules.filter((rule) => rule.drawingId !== drawing.id));
    return;
  }
  const line = lineOf(drawing, log);
  if (!line) return;
  const level = lineLevel(line, new Date()) ?? line.b.p;
  const rule: AlertRule = { ...newRule("line", symbol), line, drawingId: drawing.id, direction: lastPrice > level ? "below" : "above" };
  write([rule, ...rules]);
}

/** The alerts of one symbol's drawings brought in line with them: moved with their line, gone with it. */
export function syncLineAlerts(symbol: string, drawings: Drawing[], log: boolean, lastPrice: number | null) {
  const rules = parseRules(read());
  if (!rules.some((rule) => rule.type === "line" && rule.ticker === symbol && rule.drawingId)) return;
  const byId = new Map(drawings.map((drawing) => [drawing.id, drawing]));
  let changed = false;
  const next = rules.flatMap((rule): AlertRule[] => {
    if (rule.type !== "line" || rule.ticker !== symbol || !rule.drawingId) return [rule];
    const drawing = byId.get(rule.drawingId);
    if (!drawing) { changed = true; return []; }
    const line = lineOf(drawing, log);
    if (!line || JSON.stringify(line) === JSON.stringify(rule.line)) return [rule];
    changed = true;
    // A line moved is a new alert, armed again, watching for a cross from the side the price is on now.
    const level = lineLevel(line, new Date());
    const direction = lastPrice != null && level != null ? (lastPrice > level ? "below" as const : "above" as const) : rule.direction;
    return [{ ...rule, line, direction, armedAt: new Date().toISOString() }];
  });
  if (changed) write(next);
}
