#!/usr/bin/env node
/**
 * PF2e AoE — visual preview generator.
 *
 * Writes a page that compiles the REAL shipped shader in a real WebGL2 context
 * and drives it with the REAL animation model, inlined verbatim. What you
 * approve here is what ships. A reimplementation is how a preview ends up
 * demonstrating a beat the module does not have.
 *
 *   node tools/pf2e-aoe-preview.mjs --out=.preview/aoe.html
 *   node tools/preview-server.mjs
 *
 * SERVE IT. A file:// page does not execute its module script, so opening the
 * output directly shows you a header and nothing else.
 *
 * Flags:
 *   --out=<file.html>       full document
 *   --artifact=<body.html>  bare body, for publishing
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const { FRAGMENT_SHADER, PREVIEW_VERTEX_SHADER, UNIFORMS } =
  await import(new URL("scripts/features/pf2e-aoe/shader.mjs", ROOT).href);

const constSrc = await readFile(new URL("scripts/features/pf2e-aoe/constants.mjs", ROOT), "utf8");
const animSrc = await readFile(new URL("scripts/features/pf2e-aoe/anim.mjs", ROOT), "utf8");
const template = await readFile(new URL("tools/templates/pf2e-aoe-preview.html", ROOT), "utf8");

/* Both modules are dependency-free and side-effect-free by design, so they
   inline verbatim. `export` is harmless inside an inline module script; the
   only thing that must go is an import, and neither has one. */
for (const [name, src] of [["constants.mjs", constSrc], ["anim.mjs", animSrc]]) {
  if (/^\s*import\s/m.test(src)) {
    console.error(`${name} has grown an import — it can no longer be inlined verbatim.`);
    process.exit(1);
  }
}

const page = template
  .replace("/*__CONST_SRC__*/", constSrc)
  .replace("/*__ANIM_SRC__*/", animSrc)
  .replace("/*__FRAG__*/", JSON.stringify(FRAGMENT_SHADER))
  .replace("/*__VERT__*/", JSON.stringify(PREVIEW_VERTEX_SHADER))
  .replace("/*__UNIFORM_NAMES__*/", JSON.stringify(Object.keys(UNIFORMS)));

const unfilled = page.match(/\/\*__[A-Z_]+__\*\//g);
if (unfilled) {
  console.error("placeholders left unfilled: " + unfilled.join(", "));
  process.exitCode = 1;
}

const out = flag("out");
const artifact = flag("artifact");
if (!out && !artifact) {
  console.error("nothing to do — pass --out=<file.html> and/or --artifact=<body.html>");
  process.exit(1);
}

async function emit(target, body) {
  const path = fileURLToPath(new URL(target, ROOT));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
  console.log(`wrote ${target} (${(body.length / 1024).toFixed(1)} kB)`);
}

if (out) await emit(out, "<!doctype html>\n<meta charset=\"utf-8\">\n" + page);
if (artifact) await emit(artifact, page);

console.log(`shader ${FRAGMENT_SHADER.length} chars · ${Object.keys(UNIFORMS).length} uniforms`);
console.log("serve it:  node tools/preview-server.mjs   (a file:// page will not run the module script)");
