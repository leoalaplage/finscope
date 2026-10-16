"use client";

import { useSyncExternalStore } from "react";

/**
 * The crosshair the charts of one layout share: the time under the pointer on
 * the chart being read, which the others mark with a line of their own.
 * Kept in memory for this page only.
 */

export interface SharedCross { group: string; source: string; t: number }

let current: SharedCross | null = null;
const listeners = new Set<() => void>();

export function publishCross(next: SharedCross | null) {
  if (current?.group === next?.group && current?.source === next?.source && current?.t === next?.t) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Lets go of the crosshair, if this chart is the one holding it. */
export function releaseCross(source: string) {
  if (current?.source === source) publishCross(null);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => current;
const none = () => null;
const idle = () => () => {};

/** The shared crosshair from another chart of the same group; null when there is none, or when ungrouped. */
export function useSharedCross(group: string | undefined, self: string): SharedCross | null {
  const cross = useSyncExternalStore(group ? subscribe : idle, group ? read : none, none);
  return cross && group && cross.group === group && cross.source !== self ? cross : null;
}
