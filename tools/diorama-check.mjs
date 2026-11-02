#!/usr/bin/env node
/**
 * Diorama consistency check.
 *
 *   node tools/diorama-check.mjs
 *
 * Runs every section in tools/diorama-check/*.mjs. Each section default-exports
 * `async (ctx) => {}` and reports through `ctx.ok(name, pass, detail?)`.
 * Zero problems required. Almost everything this feature can get wrong fails
 * silently (a cliff edge that never reaches the sweep, a uniform never written,
 * a dynamic i18n key with no entry), so the sections drive the real modules
 * rather than reading them.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dir = join(here, "diorama-check");

let fails = 0;
let passes = 0;
const ctx = {
  root,
  url: (rel) => pathToFileURL(join(root, rel)).href,
  ok(name, pass, detail = "") {
    if (pass) { passes++; return true; }
    fails++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    return false;
  },
};

const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
for (const f of files) {
  const before = fails;
  console.log(`• ${f.replace(/\.mjs$/, "")}`);
  try {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    await mod.default(ctx);
  } catch (e) {
    ctx.ok(`${f} threw`, false, e?.stack ?? String(e));
  }
  if (fails === before) console.log("  ok");
}

console.log(`\n${passes} passed, ${fails} problem${fails === 1 ? "" : "s"}`);
process.exit(fails ? 1 : 0);
