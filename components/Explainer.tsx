"use client";

import { useState, type ReactNode } from "react";

/**
 * The reasoning, one click away instead of in the way.
 *
 * This application has a lot to explain and had been explaining all of it at
 * once: the statistics tab carried two hundred words of prose above and
 * between its figures, and a reader who came for a number met three paragraphs
 * first. None of it was wrong and none of it was needed on arrival.
 *
 * So the pedagogy folds and the data leads. What does *not* fold is a reason a
 * figure is missing — "this filer publishes no share count" is a fact about the
 * company and belongs beside the dash it explains, which is the whole argument
 * this application makes about blank cells.
 */
export function Explainer({ children, label = "Why" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return <span className="explainer">
    <button type="button" className={`explainer-toggle${open ? " open" : ""}`} aria-expanded={open}
      onClick={() => setOpen((value) => !value)}>{open ? "Hide" : label}</button>
    {open && <span className="explainer-body">{children}</span>}
  </span>;
}

/**
 * A heading that carries its own explanation without announcing it.
 *
 * The toggle sits on the title's line, so a group with something to say is
 * distinguishable from one without at a glance, and neither costs a paragraph.
 */
export function ExplainedHeading({ title, note, level = 3 }: { title: string; note?: string; level?: 2 | 3 }) {
  const [open, setOpen] = useState(false);
  const Tag = level === 2 ? "h2" : "h3";
  return <>
    <div className="explained-heading">
      <Tag>{title}</Tag>
      {note && <button type="button" className={`explainer-toggle${open ? " open" : ""}`} aria-expanded={open}
        aria-label={`Why ${title} is measured this way`} onClick={() => setOpen((value) => !value)}>{open ? "Hide" : "Why"}</button>}
    </div>
    {note && open && <p className="stat-note">{note}</p>}
  </>;
}
