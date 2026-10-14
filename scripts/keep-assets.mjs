#!/usr/bin/env node
/**
 * Keeps the previous builds' pieces beside the new one, for a week.
 *
 * Run after `vinext build`, before `wrangler deploy`. A deploy publishes only
 * the files of the build it carries; a reader with a page open from the build
 * before asks for pieces named after their old contents, which were gone, and
 * got "This page couldn't load". Every piece any build of the last seven days
 * produced is copied into the new one (names are content hashes, so nothing is
 * overwritten), and the new pieces join the archive for the next deploy.
 *
 *   node scripts/keep-assets.mjs [dist/client] [archive dir]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { join, relative } from "node:path";

const client = process.argv[2] ?? "dist/client";
const archive = process.argv[3] ?? ".assets-archive";
const WEEK = 7 * 86_400_000;
const STATIC = "_next/static";

const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]) : []);

const fresh = join(client, STATIC);
if (!existsSync(fresh)) { console.error(`No ${fresh}: build first.`); process.exit(1); }
const kept = join(archive, STATIC);
mkdirSync(kept, { recursive: true });

// Forget what no build of the last week produced.
let pruned = 0;
for (const file of walk(kept)) {
  if (Date.now() - statSync(file).mtimeMs > WEEK) { rmSync(file); pruned++; }
}
// The week's pieces into the new build, where it has no piece of that name.
let restored = 0;
for (const file of walk(kept)) {
  const target = join(fresh, relative(kept, file));
  if (!existsSync(target)) { mkdirSync(join(target, ".."), { recursive: true }); cpSync(file, target); restored++; }
}
// The new build's pieces into the archive, dated today.
const now = new Date();
for (const file of walk(fresh)) {
  const target = join(kept, relative(fresh, file));
  if (!existsSync(target)) { mkdirSync(join(target, ".."), { recursive: true }); cpSync(file, target); }
  utimesSync(target, now, now);
}
console.log(`keep-assets: ${restored} earlier pieces kept, ${pruned} older than a week dropped.`);
