import type { Tool } from "@/lib/term/drawings";

/**
 * The chart toolbar's icons, drawn in the stroke of the text around them so
 * they follow the theme: each a small picture of what the tool draws, the way
 * charting platforms show them, rather than a character that a font may draw
 * too thin to read.
 */

export type ToolIconName = Tool | "magnet" | "hide" | "undo" | "redo" | "clear" | "replay" | "camera";

const dot = (x: number, y: number) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.7} className="ti-dot" />;

const PICTURES: Record<ToolIconName, React.ReactNode> = {
  cursor: <path d="M5 2.5v12l3.2-3 2.3 5 2-.9-2.3-4.9h4.3z" className="ti-fill" />,
  trend: <>{<path d="M4 14L14 4" />}{dot(4, 14)}{dot(14, 4)}</>,
  ray: <>{<path d="M4 14L17 1" />}{dot(4, 14)}{dot(9.5, 8.5)}</>,
  extended: <>{<path d="M1 17L17 1" />}{dot(6, 12)}{dot(12, 6)}</>,
  arrow: <><path d="M3.5 14.5L14 4" /><path d="M8 3.5h6.5V10" /></>,
  hline: <>{<path d="M1 9h16" />}{dot(9, 9)}</>,
  hray: <>{<path d="M4 9h13" />}{dot(4, 9)}</>,
  vline: <>{<path d="M9 1v16" />}{dot(9, 9)}</>,
  channel: <><path d="M2 11L12 3" /><path d="M6 15l10-8" />{dot(2, 11)}{dot(12, 3)}{dot(16, 7)}</>,
  pitchfork: <><path d="M2 12l6-3" className="ti-thin" /><path d="M8 9l9-3" /><path d="M6 4.5l11-1" /><path d="M10 14.5l7-2" />{dot(2, 12)}{dot(6, 4.5)}{dot(10, 14.5)}</>,
  regression: <><path d="M2 9L16 3" className="ti-thin" /><path d="M2 12.5L16 6.5" /><path d="M2 16L16 10" className="ti-thin" /></>,
  fibext: <><path d="M2 15l4-8 3 4" className="ti-thin" /><path d="M9 3h8" /><path d="M9 7h8" /><path d="M9 11h8" />{dot(9, 11)}</>,
  avwap: <><path d="M3 13c3-1 4-6 7-6s3 3 6 2" />{dot(3, 13)}<path d="M3 16h12" className="ti-thin" /></>,
  fib: <><path d="M2 3h14" /><path d="M2 7h14" /><path d="M2 11h14" /><path d="M2 15h14" /><path d="M3 15L15 3" className="ti-thin" /></>,
  rect: <><rect x={3} y={5} width={12} height={8} />{dot(3, 5)}{dot(15, 13)}</>,
  range: <><rect x={3} y={3} width={12} height={12} className="ti-thin" /><path d="M9 14V4.5" /><path d="M6.5 7L9 4.5 11.5 7" /></>,
  long: <><rect x={3} y={3} width={12} height={6} /><rect x={3} y={9} width={12} height={5} className="ti-thin" /><path d="M6.5 7.5L9 5l2.5 2.5" /></>,
  short: <><rect x={3} y={4} width={12} height={5} className="ti-thin" /><rect x={3} y={9} width={12} height={6} /><path d="M6.5 10.5L9 13l2.5-2.5" /></>,
  text: <><path d="M4 4h10" /><path d="M9 4v11" /><path d="M7 15h4" /></>,
  brush: <path d="M2 13c2.5-6 4.5 3 7-3s4.5-5 7-6" />,
  erase: <><path d="M3.5 11.5l7-7 4.5 4.5-6 6H6.5z" /><path d="M7 8l4.5 4.5" /><path d="M9 15h7" /></>,
  magnet: <><path d="M4.5 3v6a4.5 4.5 0 0 0 9 0V3" /><path d="M4.5 6h3M10.5 6h3" /><path d="M7.5 3v6a1.5 1.5 0 0 0 3 0V3" className="ti-thin" /></>,
  hide: <><path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" /><circle cx={9} cy={9} r={2.2} /><path d="M3 15L15 3" /></>,
  undo: <><path d="M6.5 4L3 7.5 6.5 11" /><path d="M3 7.5h7.5a4 4 0 0 1 0 8H8" /></>,
  redo: <><path d="M11.5 4L15 7.5 11.5 11" /><path d="M15 7.5H7.5a4 4 0 0 0 0 8H10" /></>,
  replay: <><path d="M3 4v10" /><path d="M6 4.5l5 4.5-5 4.5z" className="ti-fill" /><path d="M11 4.5l5 4.5-5 4.5" /></>,
  camera: <><path d="M2.5 6h3l1.5-2h4l1.5 2h3v8.5h-13z" /><circle cx={9} cy={10} r={2.6} /></>,
  clear: <><path d="M3 5h12" /><path d="M7 5V3h4v2" /><path d="M4.5 5l1 10h7l1-10" /><path d="M7.5 8v4.5M10.5 8v4.5" className="ti-thin" /></>,
};

export function ToolIcon({ name }: { name: ToolIconName }) {
  return (
    <svg className="ti" viewBox="0 0 18 18" width={18} height={18} aria-hidden="true" focusable="false">
      {PICTURES[name]}
    </svg>
  );
}
