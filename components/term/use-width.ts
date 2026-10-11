"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The pixel width of a box, kept current as it resizes, so a chart can be
 * drawn at its real size with real text rather than stretched.
 *
 * Measured once as soon as it mounts as well as on every resize: a resize
 * observer reports only with a rendered frame, and a page opened in a tab
 * that is not being painted would otherwise draw no chart at all.
 */
export function useWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.getBoundingClientRect().width));
    queueMicrotask(measure);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return { ref, width };
}
