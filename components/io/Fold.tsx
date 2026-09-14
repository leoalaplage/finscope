"use client";

import { useState, type ReactNode } from "react";

/**
 * A section a reader opens, rather than one put in front of them.
 *
 * The pages had grown to carry everything this site can say about a company or
 * a market, top to bottom, and a first look was a wall. So the few readings a
 * reader comes for stay open and the rest sit behind a line with their name on
 * it: the page says what it holds without making anybody scroll past it.
 *
 * Nothing inside is mounted until it is opened. A closed fold costs the page no
 * request and no render, which is most of what "lighter at first sight" means
 * for a page that fetches per section.
 *
 * The fold's line carries the section's name, so the section's own title is
 * hidden once it is open (see `.fold-body` in io.css) — one name, not two
 * stacked. Its controls stay where they were.
 *
 * Controlled when `open` is given, because one fold is opened from elsewhere:
 * choosing a measure to chart on a company page opens the chart.
 */
export function Fold({ title, children, open, onToggle }: {
  title: string;
  children: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const [held, setHeld] = useState(false);
  const shown = open ?? held;
  const toggle = () => {
    const next = !shown;
    if (open === undefined) setHeld(next);
    onToggle?.(next);
  };

  return (
    <section className={shown ? "fold fold-open" : "fold"}>
      <button type="button" className="fold-head" aria-expanded={shown} onClick={toggle}>
        <span className="label">{title}</span>
        <span className="fold-mark" aria-hidden="true">{shown ? "−" : "+"}</span>
      </button>
      {shown ? <div className="fold-body">{children}</div> : null}
    </section>
  );
}
