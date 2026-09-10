#!/usr/bin/env node
/**
 * GLUniverse Suite — Arcane Surge preview page.
 *
 *   node tools/arcane-surge-preview.mjs --out=.preview/surge.html
 *   node tools/preview-server.mjs        # then open the page it serves
 *
 * SERVE IT. A `file://` page does not execute its module script, so the shaders
 * never compile and you see an empty box rather than a failure.
 *
 * The page compiles the REAL shaders in a real WebGL context and drives them
 * with the REAL animation model — `anim.mjs` is inlined verbatim rather than
 * reimplemented, and the uniform names come from the shader module's own tables,
 * so a uniform added to the GLSL and forgotten in the host cannot be quietly
 * fed here either.
 *
 * What it is for: the crack strip has a frame budget it must live inside for
 * hours AND a per-pixel question no diff can answer — it runs the suite's
 * weave at twenty-odd device pixels tall with one-pixel threads, which is far
 * and away the smallest place any effect in the suite has been asked to land. It is therefore drawn
 * here at SHIPPING SIZE, over a real label, at the real device-pixel ratio.
 * The beats are here at full size beside it, with a frame-time readout.
 *
 * What it cannot tell you: how any of it reads over real map art, at a real
 * table, on somebody else's monitor. That needs a session.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const FEATURE = "scripts/features/pf2e-arcane-surge";
const shader = await import(`../${FEATURE}/shader.mjs`);
const constants = await import(`../${FEATURE}/constants.mjs`);
/* Colours are RESOLVED here rather than restated in the page. `anim.mjs` keeps a
   literal ramp because it is inlined as source with no module resolution, but
   this generator is a Node process that can just import the real thing — so the
   tier and level hues arrive from `palette.mjs` and cannot drift from it. */
const palette = await import(`../${FEATURE}/palette.mjs`);

/* `anim.mjs` is dependency-free by contract precisely so it can be inlined here
   as source. The export keywords are stripped so it can live inside a plain
   <script> block alongside the page's own code. */
const animSource = read(`${FEATURE}/anim.mjs`)
  .replace(/^import[^;]+;$/gm, "")
  .replace(/^export\s+/gm, "");

const template = read("tools/templates/arcane-surge-preview.html");

const tierRgb = Object.fromEntries(constants.TIERS.map((tier) => [tier, palette.tierFloats(tier)]));
const levelRgb = Object.fromEntries(constants.LEVELS.map((level) => [level, palette.levelFloats(level).mid]));

const page = template
  .replace("/*__VERT__*/", JSON.stringify(shader.VERT))
  .replace("/*__CRACK_FRAG__*/", JSON.stringify(shader.CRACK_FRAG))
  .replace("/*__CRACK_FIELD_PX__*/", JSON.stringify(shader.CRACK_FIELD_PX))
  .replace("/*__BURST_FRAG__*/", JSON.stringify(shader.BURST_FRAG))
  .replace("/*__SEVERITY_FRAG__*/", JSON.stringify(shader.SEVERITY_FRAG))
  .replace("/*__SEVERITY_UNIFORMS__*/", JSON.stringify(shader.SEVERITY_UNIFORMS))
  .replace("/*__TIERS__*/", JSON.stringify(constants.TIERS))
  .replace("/*__TIER_RGB__*/", JSON.stringify(tierRgb))
  .replace("/*__LEVEL_RGB__*/", JSON.stringify(levelRgb))
  .replace("/*__BURST_SECONDS__*/", String(shader.BURST_SECONDS))
  .replace("/*__SEVERITY_SECONDS__*/", String(shader.SEVERITY_SECONDS))
  .replace("/*__BLIT_FRAG__*/", JSON.stringify(shader.BLIT_FRAG))
  .replace("/*__CRACK_UNIFORMS__*/", JSON.stringify(shader.CRACK_UNIFORMS))
  .replace("/*__BURST_UNIFORMS__*/", JSON.stringify(shader.BURST_UNIFORMS))
  .replace("/*__BLIT_UNIFORMS__*/", JSON.stringify(shader.BLIT_UNIFORMS))
  .replace("/*__LEVELS__*/", JSON.stringify(constants.LEVELS))
  .replace("/*__ANIM_SRC__*/", animSource);

// A placeholder left unsubstituted is a syntax error in the page, which shows up
// as a blank box rather than as a failure. Catch it here instead.
const leftover = page.match(/\/\*__[A-Z_]+__\*\//g);
if (leftover) {
  console.error(`arcane-surge-preview: unsubstituted placeholder(s): ${[...new Set(leftover)].join(", ")}`);
  process.exit(1);
}

const outArg = process.argv.slice(2).find((a) => a.startsWith("--out="));
if (!outArg) {
  console.log("usage: node tools/arcane-surge-preview.mjs --out=.preview/surge.html");
  console.log("       node tools/preview-server.mjs   # a file:// page will not run it");
  process.exit(0);
}

const target = resolve(ROOT, outArg.slice("--out=".length));
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `<!doctype html>\n${page}`);
console.log(`arcane-surge-preview: wrote ${target} (${Math.round(page.length / 1024)} KB)`);
console.log("serve it: node tools/preview-server.mjs");
