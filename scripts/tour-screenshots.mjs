/**
 * The welcome tour's screenshots (components/term/Welcome.tsx → public/tour/*.webp),
 * taken from the live site in a fresh browser — what a first-time visitor
 * sees: the default watchlist, the example portfolio, the chart's defaults.
 *
 * Run again after a screen changes:
 *   npm i --no-save playwright-core && npx playwright install chromium
 *   node scripts/tour-screenshots.mjs
 * CHROMIUM=/path/to/chrome overrides the browser playwright installed.
 */
import { chromium } from "playwright-core";
import sharp from "sharp";

const ORIGIN = process.env.ORIGIN ?? "https://tenqay.com";
/**
 * Full screens at 1600 × 1000; the shots shown in pairs at 820–1200 wide, so they
 * keep their proportions in a half-width frame (4:3) and are only ever cut at
 * the foot.
 */
const ONLY = process.argv.slice(2);
const SHOTS = [
  { name: "market", url: "/t/market", wait: 14000, viewport: { width: 1600, height: 1000 } },
  { name: "company", url: "/t/s/NVDA", wait: 16000, viewport: { width: 1600, height: 1000 } },
  { name: "kpi", url: "/t/s/DAL", element: "#kpi", wait: 16000, viewport: { width: 820, height: 1000 } },
  { name: "segments", url: "/t/s/AAPL", element: "#seg", wait: 16000, viewport: { width: 820, height: 1000 } },
  { name: "chart", url: "/t/chart", wait: 14000, viewport: { width: 1200, height: 900 } },
  { name: "fundamentals", url: "/t/s/NVDA", element: "#gf", wait: 16000, viewport: { width: 1200, height: 900 } },
  { name: "portfolio", url: "/t/portfolio", wait: 16000, viewport: { width: 1600, height: 1000 } },
];

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const shot of SHOTS.filter((each) => !ONLY.length || ONLY.includes(each.name))) {
  const context = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: 1.5, colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}${shot.url}`, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(shot.wait);
  let png;
  if (shot.element) {
    const element = page.locator(shot.element).first();
    await element.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    png = await element.screenshot();
  } else {
    png = await page.screenshot();
  }
  await sharp(png).webp({ quality: 80 }).toFile(`public/tour/${shot.name}.webp`);
  console.log(shot.name);
  await context.close();
}
await browser.close();
