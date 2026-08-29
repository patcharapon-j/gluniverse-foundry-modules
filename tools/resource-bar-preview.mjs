/**
 * Resource bars — visual preview harness.
 *
 *   node tools/resource-bar-preview.mjs --out=/tmp/bars.html
 *   node tools/resource-bar-preview.mjs --artifact=/tmp/bars-body.html
 *
 * Writes a self-contained page that compiles the *real* fragment shader from
 * `scripts/features/resource-bars/shader.mjs` in the browser's own WebGL
 * context and drives it with the *real* animation model from `anim.mjs`. There
 * is no mock of the effect anywhere in it — only mock tokens.
 *
 * This exists because a shader that fails to compile degrades silently to the
 * baked fallback rather than erroring, and because nothing short of a rendered
 * pixel can tell you whether a bevel reads or smears. `--artifact` emits the
 * same page without the document wrapper, for publishing.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const arg = (name) => process.argv.find((a) => a.startsWith("--" + name + "="))?.split("=").slice(1).join("=");

const { FRAGMENT_SHADER, PREVIEW_VERTEX_SHADER, READOUT_INSET, UNIFORMS } = await import(new URL("scripts/features/resource-bars/shader.mjs", ROOT).href);
const { rampUniform, TEMP_COLOR, SHIELD_COLOR, RAIL_COLOR, hexToFloat3 } = await import(new URL("scripts/features/resource-bars/ramp.mjs", ROOT).href);

const template = await readFile(new URL("tools/templates/resource-bar-preview.html", ROOT), "utf8");
const animSrc = await readFile(new URL("scripts/features/resource-bars/anim.mjs", ROOT), "utf8");

const page = template
  /* anim.mjs is dependency-free by design, which is what lets it be inlined
     verbatim rather than reimplemented for the preview. The export keywords are
     harmless in an inline module script. */
  .replace("/*__ANIM_SRC__*/", animSrc)
  .replace("/*__FRAG__*/", JSON.stringify(FRAGMENT_SHADER))
  .replace("/*__VERT__*/", JSON.stringify(PREVIEW_VERTEX_SHADER))
  /* The harness looks up exactly the uniforms the shader declares, so a new one
     cannot be added and then silently left unfed in the preview. */
  .replace("/*__UNIFORM_NAMES__*/", JSON.stringify(Object.keys(UNIFORMS)))
  .replace("/*__RAMPS__*/", JSON.stringify({
    default: Array.from(rampUniform("default")),
    safe: Array.from(rampUniform("safe")),
  }))
  .replace("/*__TEMP_COL__*/", JSON.stringify(hexToFloat3(TEMP_COLOR)))
  .replace("/*__SHIELD_COL__*/", JSON.stringify(hexToFloat3(SHIELD_COLOR)))
  .replace("/*__RAIL_COL__*/", JSON.stringify(hexToFloat3(RAIL_COLOR)))
  .replace("/*__READOUT_INSET__*/", String(READOUT_INSET));

for (const [flag, wrap] of [["out", true], ["artifact", false]]) {
  const dest = arg(flag);
  if (!dest) continue;
  const body = wrap ? '<!doctype html><meta charset="utf-8">\n' + page : page;
  await writeFile(dest, body);
  console.log("wrote  " + dest + "  (" + (body.length / 1024).toFixed(1) + " KB)");
}

if (!arg("out") && !arg("artifact")) {
  console.log("usage: node tools/resource-bar-preview.mjs --out=<file.html> [--artifact=<body.html>]");
}
