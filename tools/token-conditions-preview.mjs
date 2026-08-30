/**
 * Token conditions — visual preview harness.
 *
 *   node tools/token-conditions-preview.mjs --out=.preview/conditions.html
 *   node tools/token-conditions-preview.mjs --artifact=/tmp/conditions-body.html
 *
 * Writes a self-contained page that compiles TWO shipped fragment shaders in the
 * browser's own WebGL context and draws them into ONE half-float buffer through
 * ONE bright-pass:
 *
 *   • the resource bar, from `features/resource-bars/shader.mjs`, driven by the
 *     shipped animation model in that feature's `anim.mjs`; and
 *   • the condition plate, from `features/token-conditions/shader.mjs`, driven
 *     by that feature's own `anim.mjs` and its real tone table.
 *
 * Nothing here is a mockup of the effect. Sharing the buffer is the point: two
 * HUD elements can be described in the same words and still not belong to each
 * other, and the tell is almost always the light — a plate drawn in CSS beside a
 * bar drawn in GLSL has no emission above 1.0, no bloom and no bevel that
 * survives a device pixel, so it reads as a sticker next to an instrument no
 * matter how carefully its hex values were copied.
 *
 * What the page CANNOT show: PF2e's own artwork. The shipped feature samples
 * `item.img`; a page outside Foundry has no access to it, so the sigils come
 * from `tools/preview-glyphs.mjs` — drawn to the same brief the etch expects.
 * One plate on the page deliberately carries a full-colour stand-in instead, so
 * the `uArt` path is exercised too.
 *
 * `--artifact` emits the same page without the document wrapper, for publishing.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const ROOT = new URL("../", import.meta.url);
const arg = (name) => process.argv.find((a) => a.startsWith("--" + name + "="))?.split("=").slice(1).join("=");

const bar = await import(new URL("scripts/features/resource-bars/shader.mjs", ROOT).href);
const ramp = await import(new URL("scripts/features/resource-bars/ramp.mjs", ROOT).href);
const plate = await import(new URL("scripts/features/token-conditions/shader.mjs", ROOT).href);
const consts = await import(new URL("scripts/features/token-conditions/constants.mjs", ROOT).href);
const tone = await import(new URL("scripts/features/token-conditions/tone.mjs", ROOT).href);
const glyphs = await import(new URL("tools/preview-glyphs.mjs", ROOT).href);

const template = await readFile(new URL("tools/templates/token-conditions-preview.html", ROOT), "utf8");
const barAnim = await readFile(new URL("scripts/features/resource-bars/anim.mjs", ROOT), "utf8");
const plateAnim = await readFile(new URL("scripts/features/token-conditions/anim.mjs", ROOT), "utf8");

/* Both animation models are dependency-free by design, which is what lets them
   be inlined verbatim rather than reimplemented. A reimplementation is how a
   preview ends up demonstrating a beat the module does not have. The export
   keywords are harmless inside an inline module script; `PlateAnim` is renamed
   only so two files' worth of `TIMING` cannot collide. */
const inlined = barAnim + "\n" + plateAnim
  /* Both files are complete modules with their own top-level names, and the two
     of them concatenated into one script must not collide. Every collision is
     renamed rather than deleted, so the inlined copy stays the module's own
     source and the preview keeps demonstrating the beat the feature actually
     has. The class names differ already; TIMING and easeOut do not. */
  .replace(/export const TIMING/, "const PLATE_TIMING")
  .replace(/\bTIMING\./g, "PLATE_TIMING.")
  .replace(/\beaseOut\b/g, "platePrintEase")
  /* Shedding is the host's job, and there is no host here. */
  .replace(/export const SHED_ORDER[\s\S]*?\]\);/, "")
  .replace(/export const SHED_AT[^\n]*\n/, "")
  .replace(/export const UNSHED_AT[^\n]*\n/, "");

const page = template
  .replace("/*__ANIM_SRC__*/", inlined)
  .replace("/*__BAR_FRAG__*/", JSON.stringify(bar.FRAGMENT_SHADER))
  .replace("/*__PLATE_FRAG__*/", JSON.stringify(plate.FRAGMENT_SHADER))
  .replace("/*__VERT__*/", JSON.stringify(bar.PREVIEW_VERTEX_SHADER))
  /* Both harnesses look up exactly the uniforms their shader module declares, so
     a new one cannot be added and then silently left unfed in the preview. */
  .replace("/*__BAR_UNIFORMS__*/", JSON.stringify(Object.keys(bar.UNIFORMS)))
  .replace("/*__PLATE_UNIFORMS__*/", JSON.stringify(Object.keys(plate.UNIFORMS)))
  .replace("/*__RAMPS__*/", JSON.stringify({ default: Array.from(ramp.rampUniform("default")) }))
  .replace("/*__TEMP_COL__*/", JSON.stringify(ramp.hexToFloat3(ramp.TEMP_COLOR)))
  .replace("/*__SHIELD_COL__*/", JSON.stringify(ramp.hexToFloat3(ramp.SHIELD_COLOR)))
  .replace("/*__RAIL_COL__*/", JSON.stringify(ramp.hexToFloat3(ramp.RAIL_COLOR)))
  .replace("/*__READOUT_INSET__*/", String(bar.READOUT_INSET))
  .replace("/*__TONES__*/", JSON.stringify(tone.TONES))
  .replace("/*__CONDITION_TONES__*/", JSON.stringify(tone.CONDITION_TONES))
  .replace("/*__DEFAULT_TONE__*/", JSON.stringify(tone.DEFAULT_TONE))
  .replace("/*__ICONS__*/", JSON.stringify(glyphs.ICONS))
  .replace("/*__ICON_STROKE__*/", String(glyphs.ICON_STROKE))
  .replace("/*__INSET__*/", String(plate.INSET))
  /* The plate proportions and the rail geometry come from the module, so the
     preview cannot place a counter somewhere the shipped feature would not. */
  .replace("/*__PLATE__*/", JSON.stringify(consts.PLATE))
  .replace("/*__LAYOUT__*/", JSON.stringify(consts.LAYOUT))
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
  console.log("usage: node tools/token-conditions-preview.mjs --out=<file.html> [--artifact=<body.html>]");
}
