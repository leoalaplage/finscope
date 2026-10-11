"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The pixel width of a box, kept current as it resizes, so a chart can be
 * drawn at its real size with real text rather than stretched.
 */
export function useWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
