/** Run with `node scripts/generate-brand-assets.mjs` after editing lib/brand-art.mjs: browser icons, brand files, social preview. */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { BRAND_ACCENT, BRAND_INK, BRAND_PAPER, brandArtwork, brandSvg, iconSvg, SIGNATURE_VIEWBOX } from "../lib/brand-art.mjs";

const root = new URL("../public/", import.meta.url);
await mkdir(new URL("brand/", root), { recursive: true });
for (const variant of ["mark", "wordmark", "lockup", "signature"]) {
  for (const [tone, color] of [["navy", BRAND_INK], ["light", BRAND_PAPER]]) {
    await writeFile(new URL(`brand/tenqay-${variant}-${tone}.svg`, root), brandSvg(variant, color));
  }
}
const icon = iconSvg(64);
await writeFile(new URL("favicon.svg", root), icon + "\n");
for (const [file, size] of [["favicon-32.png", 32], ["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  await sharp(Buffer.from(iconSvg(size))).resize(size, size).png().toFile(new URL(file, root).pathname);
}
// An ICO holding a PNG, which every current browser and Windows read.
const small = await sharp(Buffer.from(iconSvg(32))).resize(32, 32).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header[6] = 32; header[7] = 32;
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(small.length, 14); header.writeUInt32LE(22, 18);
await writeFile(new URL("favicon.ico", root), Buffer.concat([header, small]));

// The link preview: the mark and the signature on navy, the line the welcome tour opens with, the address.
const [, , sw, sh] = SIGNATURE_VIEWBOX.split(" ").map(Number);
const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${BRAND_INK}"/>`
  + `<svg x="96" y="110" width="150" height="150" viewBox="0 0 48 48" color="${BRAND_PAPER}">${brandArtwork("mark")}</svg>`
  + `<svg x="290" y="150" width="${(70 * sw) / sh}" height="70" viewBox="${SIGNATURE_VIEWBOX}" color="${BRAND_PAPER}">${brandArtwork("signature")}</svg>`
  + `<text x="96" y="400" font-family="Menlo, monospace" font-size="46" fill="${BRAND_PAPER}">Market intelligence.</text>`
  + `<path d="M96 462H1104" stroke="#26354f" stroke-width="2"/>`
  + `<text x="96" y="512" font-family="Menlo, monospace" font-size="24" fill="#a3aec2">Markets · Fundamentals · Valuation</text>`
  + `<text x="1104" y="512" text-anchor="end" font-family="Menlo, monospace" font-size="24" fill="${BRAND_ACCENT}">tenqay.com</text></svg>`;
await writeFile(new URL("brand/tenqay-social.svg", root), social + "\n");
await sharp(Buffer.from(social)).png().toFile(new URL("og.png", root).pathname);
console.log("Brand files, browser icons and the social preview are written.");
