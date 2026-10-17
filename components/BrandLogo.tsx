import type { SVGProps } from "react";
import { BRAND_NAME, brandArtwork, brandViewBox } from "@/lib/brand-art.mjs";

export type BrandVariant = "mark" | "wordmark" | "lockup" | "signature";

/**
 * Tenqay's mark (TQ in its frame over a gold rule), wordmark, lockup or signature (TENQAY | RESEARCH), drawn from
 * lib/brand-art.mjs. Ink is the text colour around it; the gold rule is --brand-accent, so on the gold bar of the
 * terminal it can turn navy. It sits inside HTML or inside a chart's own SVG (x, y, width, height).
 */
export function BrandLogo({ variant = "lockup", decorative = false, className = "", ...props }: SVGProps<SVGSVGElement> & {
  variant?: BrandVariant;
  decorative?: boolean;
}) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={brandViewBox(variant)} className={`brand-logo brand-${variant} ${className}`.trim()}
      role={decorative ? undefined : "img"} aria-label={decorative ? undefined : BRAND_NAME} aria-hidden={decorative || undefined} focusable="false"
      {...props} dangerouslySetInnerHTML={{ __html: brandArtwork(variant) }} />
  );
}
