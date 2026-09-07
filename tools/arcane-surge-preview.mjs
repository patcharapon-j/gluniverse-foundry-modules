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
 * What it is for: the ambient overlay has a frame budget it must live inside for
 * hours, and the burst's bake-then-blit path has a look that no diff can show
 * you. Both are here side by side, with the ambient's four levels and the
 * burst's three, and a frame-time readout.
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

/* `anim.mjs` is dependency-free by contract precisely so it can be inlined here
   as source. The export keywords are stripped so it can live inside a plain
   <script> block alongside the page's own code. */
const animSource = read(`${FEATURE}/anim.mjs`)
  .replace(/^import[^;]+;$/gm, "")
  .replace(/^export\s+/gm, "");

const template = read("tools/templates/arcane-surge-preview.html");

const page = template
  .replace("/*__VERT__*/", JSON.stringify(shader.VERT))
  .replace("/*__AMBIENT_FRAG__*/", JSON.stringify(shader.AMBIENT_FRAG))
  .replace("/*__BURST_FRAG__*/", JSON.stringify(shader.BURST_FRAG))
  .replace("/*__SEVERITY_FRAG__*/", JSON.stringify(shader.SEVERITY_FRAG))
  .replace("/*__SEVERITY_UNIFORMS__*/", JSON.stringify(shader.SEVERITY_UNIFORMS))
  .replace("/*__TIERS__*/", JSON.stringify(constants.TIERS))
  .replace("/*__BURST_SECONDS__*/", String(shader.BURST_SECONDS))
  .replace("/*__SEVERITY_SECONDS__*/", String(shader.SEVERITY_SECONDS))
  .replace("/*__BLIT_FRAG__*/", JSON.stringify(shader.BLIT_FRAG))
  .replace("/*__AMBIENT_UNIFORMS__*/", JSON.stringify(shader.AMBIENT_UNIFORMS))
  .replace("/*__BURST_UNIFORMS__*/", JSON.stringify(shader.BURST_UNIFORMS))
  .replace("/*__BLIT_UNIFORMS__*/", JSON.stringify(shader.BLIT_UNIFORMS))
  .replace("/*__LEVELS__*/", JSON.stringify(constants.LEVELS))
  .replace("/*__ANIM_SRC__*/", animSource);

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
