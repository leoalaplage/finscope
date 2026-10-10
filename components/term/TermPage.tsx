import type { CSSProperties, ReactNode } from "react";

/**
 * A whole page of the document site, worn as a terminal screen.
 *
 * The screener, compare, the DCF and the portfolio are long, careful
 * components with their own state and their own <main>; redrawing them would
 * be a second copy to keep right. Instead each is put inside this frame, which
 * hands its function code down as `--t-code` so every section heading in it
 * becomes a panel header headed by that code, and app/terminal.css retunes the
 * page under `.t-page` — the page heading as the terminal's header strip, the
 * sections as panels, the tables at terminal density.
 */
export function TermPage({ code, children }: { code: string; children: ReactNode }) {
  return (
    <div className="t-page" style={{ "--t-code": JSON.stringify(code) } as CSSProperties}>
      {children}
    </div>
  );
}
