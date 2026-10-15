import type { CSSProperties, ReactNode } from "react";

/**
 * One function on a terminal screen.
 *
 * Every panel is headed by its function code, the word a reader types to come
 * back to it. Given a title, the panel draws its own header. Without one it is
 * a frame around a section borrowed from the document site, whose own heading
 * row becomes the header: the code is handed down as `--t-code` and drawn in
 * front of it (app/terminal.css), so a borrowed section is never headed twice.
 *
 * `id` is the code in lower case, so `AAPL HDS` lands on `#hds` and the shell
 * can bring that panel into view. A screen with two panels under one code
 * names the second itself, so no two elements share an id.
 */
export function Panel({
  code,
  id,
  title,
  area,
  actions,
  className,
  children,
}: {
  code: string;
  /** For a second panel under the same code on one screen. */
  id?: string;
  title?: string;
  /** The grid area this panel occupies on its screen. */
  area?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const style = { "--t-code": JSON.stringify(code), gridArea: area } as CSSProperties;
  return (
    <section className={className ? `t-panel ${className}` : "t-panel"} id={id ?? code.toLowerCase()} style={style} aria-label={title}>
      {/* A title, even an empty one, draws the header: the code and the actions with nothing between them. */}
      {title != null ? (
        <header className="t-panel-head">
          <span className="t-code">{code}</span>
          {title ? <h2>{title}</h2> : null}
          {actions ? <div className="t-panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="t-panel-body">{children}</div>
    </section>
  );
}
