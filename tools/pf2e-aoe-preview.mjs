#!/usr/bin/env node
/**
 * PF2e AoE (Spellglass) — renderer preview generator.
 *
 * Writes a page that imports the SHIPPED renderer (`render/area.mjs`), the
 * shipped look tables, data adapter and animation model over the preview
 * server and drives them with PIXI v7 — the version Foundry v13/v14 ship.
 * Nothing is restated: the areas are built from fixture Regions through the
 * real `regionGeometry()` / `regionCells()`, so the staircase you judge here is
 * PF2e's coverage, not a drawing of it.
 *
 *   node tools/pf2e-aoe-preview.mjs [--out=.preview/aoe.html]
 *   node tools/preview-server.mjs
 *   → http://localhost:8931/.preview/aoe.html
 *
 * SERVE IT, from the repository root. A file:// page does not execute its
 * module script, and a server rooted anywhere else cannot resolve the imports.
 *
 * Query parameters (for headless stills): sheet=functions|profiles|materials|
 * shapes, floor=dark|bright, zoom=<scale>, shed=0..5, motion=0, seek=<ms>
 * (advance a paused clock). The page exposes window.__aoeSeek(ms).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/aoe.html");

const rel = relative(dirname(OUT), ROOT).replaceAll("\\", "/") || ".";
if (relative(ROOT, OUT).startsWith("..")) {
  console.warn("warning: --out is outside the repository; the page's imports only resolve when served from the repo root.");
}
const template = readFileSync(join(ROOT, "tools/templates/pf2e-aoe-preview.html"), "utf8");
const page = template.replaceAll("__ROOT__", rel);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, page);
console.log(`wrote ${relative(ROOT, OUT)} — serve with: node tools/preview-server.mjs, then /${relative(ROOT, OUT).replaceAll("\\", "/")}`);
