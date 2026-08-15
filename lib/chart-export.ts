/**
 * Properties a chart draws with that are declared as CSS custom properties.
 *
 * An exported SVG is opened outside the document that defined `--chart-grid`,
 * so anything still referring to a variable resolves to nothing and the grid,
 * axes and labels vanish from the image. Reading the computed value off each
 * node before serialising is what makes the PNG look like the chart.
 */
const INLINED = ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-size", "font-family", "font-weight", "opacity", "fill-opacity", "stroke-opacity", "text-anchor"] as const;

function inlineComputedStyles(source: Element, clone: Element) {
  const computed = getComputedStyle(source);
  const declarations: string[] = [];
  for (const property of INLINED) {
    const value = computed.getPropertyValue(property);
    if (value && value !== "none" || property === "fill") declarations.push(`${property}:${value}`);
  }
  const existing = clone.getAttribute("style");
  clone.setAttribute("style", [existing, declarations.join(";")].filter(Boolean).join(";"));

  const sourceChildren = source.children; const cloneChildren = clone.children;
  for (let index = 0; index < sourceChildren.length && index < cloneChildren.length; index++) {
    inlineComputedStyles(sourceChildren[index], cloneChildren[index]);
  }
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

export interface PngOptions {
  /** Written above the chart, so a saved image says what it is. */
  title?: string;
  /** Written under the title in a lighter weight. */
  subtitle?: string;
  /** Written bottom-right, small: where the numbers came from. */
  footer?: string;
  /** Pixel density. Two is enough to stay sharp when pasted into a document. */
  scale?: number;
}

const PADDING = 20;
const HEADER = 56;
const FOOTER = 22;

/**
 * Saves an on-screen chart as a PNG that stands on its own.
 *
 * A bare screenshot of a plot is not much use once it leaves the page: nothing
 * on it says which company, which measure, or over what period. This redraws
 * the chart onto a titled card, on the surface colour of the current theme, at
 * twice the pixel density so it survives being pasted into a document.
 */
export function exportSvgToPng(svg: SVGSVGElement, filename: string, options: PngOptions = {}) {
  const { title, subtitle, footer, scale = 2 } = options;
  const width = svg.clientWidth || svg.viewBox.baseVal.width || 900;
  const height = svg.clientHeight || svg.viewBox.baseVal.height || 360;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const styles = getComputedStyle(document.documentElement);
  const read = (token: string, fallback: string) => styles.getPropertyValue(token).trim() || fallback;
  const surface = read("--card", "#ffffff");
  const ink = read("--text", "#111111");
  const muted = read("--muted", "#666666");

  const headerHeight = title ? HEADER : 0;
  const footerHeight = footer ? FOOTER : 0;
  const canvasWidth = width + PADDING * 2;
  const canvasHeight = height + headerHeight + footerHeight + PADDING * 2;

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth * scale; canvas.height = canvasHeight * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.fillStyle = surface;
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    if (title) {
      context.fillStyle = ink;
      context.font = "600 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
      context.fillText(title, PADDING, PADDING + 18);
      if (subtitle) {
        context.fillStyle = muted;
        context.font = "400 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
        context.fillText(subtitle, PADDING, PADDING + 38);
      }
    }

    context.drawImage(image, PADDING, PADDING + headerHeight, width, height);

    if (footer) {
      context.fillStyle = muted;
      context.font = "400 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
      context.textAlign = "right";
      context.fillText(footer, canvasWidth - PADDING, canvasHeight - PADDING + 8);
    }

    canvas.toBlob((blob) => blob && downloadBlob(filename, blob), "image/png");
  };
  image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(clone))))}`;
}

/** The chart inside a container, whichever library drew it. */
export function chartSurface(container: HTMLElement | null): SVGSVGElement | null {
  return container?.querySelector<SVGSVGElement>("svg.recharts-surface") ?? container?.querySelector("svg") ?? null;
}
