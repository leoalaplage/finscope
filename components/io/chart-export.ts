"use client";

/**
 * A chart as a picture: the figure as the reader sees it — candles, studies,
 * lower panes, drawings, dates, the symbol's watermark and Tenqay's mark —
 * without the controls laid over it, at twice the screen's resolution, saved
 * as a PNG. The capture library is loaded only when asked.
 */

/** What is on the chart to work it, not to read it. */
const CONTROLS = ["candle-nav", "candle-latest", "candle-auto", "drawing-bar", "drawing-handle", "candle-pick-note", "candle-event-card", "candle-pane-grip"];

/** The chart as a PNG file's bytes. */
async function renderChart(figure: HTMLElement, title: { symbol: string; detail: string }): Promise<Blob> {
  const { toBlob } = await import("html-to-image");
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
  const background = getComputedStyle(figure.closest(".term") ?? document.body).getPropertyValue("--bg").trim() || "#0a1222";
  const blob = await toBlob(figure, {
    pixelRatio: 2,
    backgroundColor: background,
    cacheBust: true,
    // Web fonts are left to the page's own; embedding them would fetch the stylesheets again.
    skipFonts: true,
    filter: (node) => !(node instanceof HTMLElement && CONTROLS.some((name) => node.classList.contains(name))),
    type: "image/png",
  }).finally(() => head.remove());
  if (!blob) throw new Error("The chart could not be drawn.");
  return blob;
}

/**
 * Saved as a file. The bytes go to the browser as a file of their own (an
 * object URL), not as a data: address several megabytes long, which some
 * browsers write to disk as a file the system will not open.
 */
export async function exportChartPng(figure: HTMLElement, name: string, title: { symbol: string; detail: string }): Promise<void> {
  const blob = await renderChart(figure, title);
  const url = URL.createObjectURL(new File([blob], name, { type: "image/png" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Copied to the clipboard as a picture, to paste straight into a message or a document. */
export async function copyChartPng(figure: HTMLElement, title: { symbol: string; detail: string }): Promise<void> {
  // The clipboard is handed the promise at once, so the browser still counts the click as the reason.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": renderChart(figure, title) })]);
}
