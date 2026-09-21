#!/usr/bin/env node
/**
 * Hexcrawl — renderer preview generator.
 *
 * Writes a page that imports the SHIPPED renderer and the shipped core modules
 * (constants, hex-math, model, core/theme) over the preview server and drives
 * them against a sample 14×10 map with PIXI v7 — the version Foundry v13/v14
 * ship. Nothing is restated: a preview built on a second copy of the renderer
 * flatters whichever copy was touched last.
 *
 *   node tools/hexcrawl-preview.mjs [--out=.preview/hexcrawl.html]
 *   node tools/preview-server.mjs
 *   → http://localhost:8931/.preview/hexcrawl.html
 *
 * SERVE IT, from the repository root. A file:// page does not execute its
 * module script, and a server rooted anywhere else cannot resolve the imports.
 *
 * Query parameters (for headless stills): grid=2..5, view=gm|vap|player,
 * mode=tiles|tint|outlines, zoom=<scale>, motion=0, big=1 (60×40 map, for the
 * static-rebuild timing), act=move,ring,hide,stage (comma list, run paused),
 * seek=<ms> (advance the paused clock), hover=<i,j>.
 * The page exposes window.__hexcrawlSeek(ms) and window.__hexcrawl.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/hexcrawl.html");

const rel = relative(dirname(OUT), ROOT).replaceAll("\\", "/") || ".";
if (rel.startsWith("..") && relative(ROOT, OUT).startsWith("..")) {
  console.warn("warning: --out is outside the repository; the page's imports only resolve when served from the repo root.");
}
const template = readFileSync(join(ROOT, "tools/templates/hexcrawl-preview.html"), "utf8");
const page = template.replaceAll("__ROOT__", rel);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, page);
console.log(`wrote ${relative(ROOT, OUT)} — serve with: node tools/preview-server.mjs, then /${relative(ROOT, OUT).replaceAll("\\", "/")}`);
