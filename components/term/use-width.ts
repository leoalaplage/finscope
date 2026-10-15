"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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

/** Width and height of a box, for a chart that fills a band of the page's choosing. */
export function useSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize({ width: Math.floor(box.width), height: Math.floor(box.height) });
    };
    queueMicrotask(measure);
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }));
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return { ref, ...size };
}

/** The point under the pointer, across a plot `count` points wide: for a cursor and the readout over it. */
export function useHoverIndex(count: number) {
  const [hover, setHover] = useState<number | null>(null);
  const pick = (event: ReactPointerEvent<Element>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || count < 1) return;
    setHover(Math.max(0, Math.min(count - 1, Math.round(((event.clientX - box.left) / box.width) * (count - 1)))));
  };
  return { hover: hover != null && hover < count ? hover : null, pick, leave: () => setHover(null) };
}
