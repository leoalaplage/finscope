"use client";

/**
 * A chart as a picture: the figure as the reader sees it — candles, studies,
 * lower panes, drawings, dates, the symbol's watermark and Tenqay's mark —
 * without the controls laid over it, at twice the screen's resolution, saved
 * as a PNG. The capture library is loaded only when asked.
 */

/** What is on the chart to work it, not to read it. */
const CONTROLS = ["candle-nav", "candle-latest", "candle-auto", "drawing-bar", "drawing-handle", "candle-pick-note", "candle-event-card", "candle-pane-grip"];

export async function exportChartPng(figure: HTMLElement, name: string, title: { symbol: string; detail: string }): Promise<void> {
  const { toPng } = await import("html-to-image");
  // A title line for the picture alone — what is charted, at what interval, and from where — taken off again once it is captured.
  const head = document.createElement("div");
  head.className = "candle-export-head";
  const symbol = document.createElement("b");
  symbol.textContent = title.symbol;
  const detail = document.createElement("span");
  detail.textContent = title.detail;
  const source = document.createElement("span");
  source.className = "candle-export-source";
  source.textContent = `tenqay.com · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  // appendChild and insertBefore: the Worker's types give append and prepend another meaning.
  for (const part of [symbol, detail, source]) head.appendChild(part);
  figure.insertBefore(head, figure.firstChild);
  const background = getComputedStyle(figure.closest(".term") ?? document.body).getPropertyValue("--bg").trim() || "#0d1012";
  const url = await toPng(figure, {
    pixelRatio: 2,
    backgroundColor: background,
    cacheBust: true,
    // Web fonts are left to the page's own; embedding them would fetch the stylesheets again.
    skipFonts: true,
    filter: (node) => !(node instanceof HTMLElement && CONTROLS.some((name) => node.classList.contains(name))),
  }).finally(() => head.remove());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
