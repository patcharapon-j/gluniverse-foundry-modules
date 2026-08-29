/**
 * Token conditions — visual preview harness.
 *
 *   node tools/condition-preview.mjs --out=.preview/conditions.html
 *   node tools/condition-preview.mjs --artifact=/tmp/conditions-body.html
 *
 * Writes a self-contained page that compiles TWO real fragment shaders in the
 * browser's own WebGL context and draws them into ONE half-float buffer through
 * ONE bright-pass:
 *
 *   • the shipped resource bar, from `scripts/features/resource-bars/shader.mjs`,
 *     driven by the shipped animation model in `anim.mjs`; and
 *   • the candidate condition plate, from `tools/condition-shaders.mjs`.
 *
 * Sharing the buffer is the whole point. Two HUD elements can be described in
 * the same words and still not belong to each other, and the tell is almost
 * always the light: a plate drawn in CSS beside a bar drawn in GLSL has no
 * bloom, no emission above 1.0, and no bevel that survives a device pixel, so
 * it reads as a sticker next to an instrument no matter how carefully its hex
 * values were copied. Nothing on this page is a mockup of the effect.
 *
 * `--artifact` emits the same page without the document wrapper, for publishing.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const arg = (name) => process.argv.find((a) => a.startsWith("--" + name + "="))?.split("=").slice(1).join("=");

const bar = await import(new URL("scripts/features/resource-bars/shader.mjs", ROOT).href);
const ramp = await import(new URL("scripts/features/resource-bars/ramp.mjs", ROOT).href);
const plate = await import(new URL("tools/condition-shaders.mjs", ROOT).href);

const template = await readFile(new URL("tools/templates/condition-preview.html", ROOT), "utf8");
const animSrc = await readFile(new URL("scripts/features/resource-bars/anim.mjs", ROOT), "utf8");

const page = template
  /* anim.mjs is dependency-free by design, which is what lets it be inlined
     verbatim rather than reimplemented for the preview. A reimplementation is
     how a preview ends up demonstrating a beat the module does not have. */
  .replace("/*__ANIM_SRC__*/", animSrc)
  .replace("/*__BAR_FRAG__*/", JSON.stringify(bar.FRAGMENT_SHADER))
  .replace("/*__PLATE_FRAG__*/", JSON.stringify(plate.FRAGMENT_SHADER))
  .replace("/*__VERT__*/", JSON.stringify(bar.PREVIEW_VERTEX_SHADER))
  /* Both harnesses look up exactly the uniforms their shader module declares,
     so a new one cannot be added and then silently left unfed. */
  .replace("/*__BAR_UNIFORMS__*/", JSON.stringify(Object.keys(bar.UNIFORMS)))
  .replace("/*__PLATE_UNIFORMS__*/", JSON.stringify(Object.keys(plate.UNIFORMS)))
  .replace("/*__RAMPS__*/", JSON.stringify({ default: Array.from(ramp.rampUniform("default")) }))
  .replace("/*__TEMP_COL__*/", JSON.stringify(ramp.hexToFloat3(ramp.TEMP_COLOR)))
  .replace("/*__SHIELD_COL__*/", JSON.stringify(ramp.hexToFloat3(ramp.SHIELD_COLOR)))
  .replace("/*__RAIL_COL__*/", JSON.stringify(ramp.hexToFloat3(ramp.RAIL_COLOR)))
  .replace("/*__READOUT_INSET__*/", String(bar.READOUT_INSET))
  .replace("/*__TONES__*/", JSON.stringify(plate.TONES))
  .replace("/*__CONDITIONS__*/", JSON.stringify(plate.CONDITIONS))
  .replace("/*__ICONS__*/", JSON.stringify(plate.ICONS))
  .replace("/*__ICON_STROKE__*/", String(plate.ICON_STROKE))
  .replace("/*__FORM__*/", JSON.stringify(plate.FORM));

const unfilled = page.match(/\/\*__[A-Z_]+__\*\//g);
if (unfilled) {
  console.error("placeholders left unfilled: " + unfilled.join(", "));
  process.exitCode = 1;
}

for (const [flag, wrap] of [["out", true], ["artifact", false]]) {
  const dest = arg(flag);
  if (!dest) continue;
  await mkdir(dirname(dest), { recursive: true }).catch(() => {});
  const body = wrap ? '<!doctype html><meta charset="utf-8">\n' + page : page;
  await writeFile(dest, body);
  console.log("wrote  " + dest + "  (" + (body.length / 1024).toFixed(1) + " KB)");
}

if (!arg("out") && !arg("artifact")) {
  console.log("usage: node tools/condition-preview.mjs --out=<file.html> [--artifact=<body.html>]");
}
