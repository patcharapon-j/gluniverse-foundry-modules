/**
 * Resource bars — visual preview harness.
 *
 *   node tools/resource-bar-preview.mjs --out=.preview/bars.html
 *   node tools/resource-bar-preview.mjs --artifact=/tmp/bars-body.html
 *
 * Writes a page that compiles the *real* fragment shaders — all three liquids —
 * from `scripts/features/resource-bars/shader.mjs` in the browser's own WebGL
 * context and drives them with the *real* animation model from `anim.mjs`.
 * There is no mock of the effect anywhere in it — only mock tokens.
 *
 * This exists because a shader that fails to compile degrades silently rather
 * than erroring, and because nothing short of a rendered pixel can tell you
 * whether a liquid reads or smears.
 *
 * ── Two ways to get the animation model into the page ──
 *
 * `anim.mjs` is built on anime.js, through `core/motion.mjs` and the vendored
 * copy under `scripts/vendor/animejs/`, so it can no longer be pasted into the
 * page verbatim.
 *
 * `--out` writes a page that **imports the real modules** by a path relative to
 * the page, so it has to be served from the repository root:
 * `node tools/preview-server.mjs` and open `/.preview/bars.html`. That is the
 * page to judge the feature on; it runs exactly the files Foundry loads.
 *
 * `--artifact` has no server behind it, so it inlines anim.mjs and everything it
 * imports — anime.js included — through a small linker below, which rewrites
 * each module's imports and exports into one module script. That only works
 * because the graph is acyclic and every import/export statement sits at column
 * 0, which is how every file in it is written; the linker refuses to guess
 * otherwise.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const arg = (name) => process.argv.find((a) => a.startsWith("--" + name + "="))?.split("=").slice(1).join("=");

const {
  FRAGMENT_SHADERS, LIQUIDS, DEFAULT_LIQUID, PREVIEW_VERTEX_SHADER, READOUT_INSET, UNIFORMS,
} = await import(new URL("scripts/features/resource-bars/shader.mjs", ROOT).href);
const { rampUniform, TEMP_COLOR, SHIELD_COLOR, RAIL_COLOR, BREAK_AMBER, BREAK_HOT, hexToFloat3 } = await import(new URL("scripts/features/resource-bars/ramp.mjs", ROOT).href);

const template = await readFile(new URL("tools/templates/resource-bar-preview.html", ROOT), "utf8");
const ANIM = new URL("scripts/features/resource-bars/anim.mjs", ROOT);
const ANIM_NAMES = "BarAnim, RevealAnim, POPUP_LIFT, POPUP_RISE";

/* ── The linker, for --artifact ─────────────────────────────────────────── */

const IMPORT_FROM = /^import\s*(?:\{([^}]*)\}|\*\s+as\s+([\w$]+))\s*from\s*["']([^"']+)["'];?/gm;
const IMPORT_BARE = /^import\s*["']([^"']+)["'];?/gm;
const EXPORT_FROM = /^export\s*(?:\{([^}]*)\}|\*)\s*from\s*["']([^"']+)["'];?/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\};?/gm;
const EXPORT_DECL = /^export\s+((?:async\s+)?(?:const|let|var|function\*?|class)\s+([\w$]+))/gm;

const pairs = (list) => list.split(",").map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [from, to = from] = s.split(/\s+as\s+/).map((x) => x.trim()); return [from, to]; });

async function bundle(entry) {
  const order = [];
  const index = new Map();
  async function visit(url) {
    if (index.has(url.href)) {
      if (index.get(url.href) === null) throw new Error("import cycle through " + url.href);
      return;
    }
    index.set(url.href, null);
    const text = await readFile(url, "utf8");
    if (/^export\s+default\b/m.test(text) || /\bimport\.meta\b/.test(text) || /^[ \t]+(?:import|export)\s*[{*]/m.test(text))
      throw new Error("the linker cannot inline " + url.href + " (default export, import.meta or an indented import/export)");
    const specs = [
      ...[...text.matchAll(IMPORT_FROM)].map((m) => m[3]),
      ...[...text.matchAll(IMPORT_BARE)].map((m) => m[1]),
      ...[...text.matchAll(EXPORT_FROM)].map((m) => m[2]),
    ];
    for (const spec of specs) await visit(new URL(spec, url));
    index.set(url.href, order.length);
    order.push({ url, text });
  }
  await visit(entry);

  const id = (spec, from) => index.get(new URL(spec, from).href);
  const modules = order.map(({ url, text }, i) => {
    const declared = [];
    const body = text
      .replace(IMPORT_FROM, (_, list, ns, spec) => ns
        ? `const ${ns} = __m[${id(spec, url)}];`
        : `const { ${pairs(list).map(([f, t]) => (f === t ? f : `${f}: ${t}`)).join(", ")} } = __m[${id(spec, url)}];`)
      .replace(IMPORT_BARE, "")
      .replace(EXPORT_FROM, (_, list, spec) => list === undefined
        ? `Object.assign(__e, __m[${id(spec, url)}]);`
        : pairs(list).map(([f, t]) => `__e.${t} = __m[${id(spec, url)}].${f};`).join(" "))
      .replace(EXPORT_LIST, (_, list) => pairs(list).map(([f, t]) => `__e.${t} = ${f};`).join(" "))
      .replace(EXPORT_DECL, (_, decl, name) => { declared.push(name); return decl; });
    const tail = declared.map((n) => `__e.${n} = ${n};`).join("\n");
    const label = relative(fileURLToPath(ROOT), fileURLToPath(url)).split("\\").join("/");
    return `/* ── ${label} ── */\n__m[${i}] = (() => {\nconst __e = {};\n${body}\n${tail}\nreturn __e;\n})();`;
  });
  return `const __m = [];\n${modules.join("\n\n")}\nconst { ${ANIM_NAMES} } = __m[${order.length - 1}];`;
}

/* ── The page ───────────────────────────────────────────────────────────── */

function page(animImport, root) {
  const put = (text, token, value) => text.split(token).join(value);
  let out = put(template, "__ROOT__/", root);
  const swaps = {
    "/*__ANIM_IMPORT__*/": animImport,
    "/*__FRAGS__*/": JSON.stringify(FRAGMENT_SHADERS),
    "/*__LIQUIDS__*/": JSON.stringify(LIQUIDS),
    "/*__DEFAULT_LIQUID__*/": JSON.stringify(DEFAULT_LIQUID),
    "/*__VERT__*/": JSON.stringify(PREVIEW_VERTEX_SHADER),
    /* The harness looks up exactly the uniforms the shader declares, so a new
       one cannot be added and then silently left unfed in the preview. */
    "/*__UNIFORM_NAMES__*/": JSON.stringify(Object.keys(UNIFORMS)),
    "/*__RAMPS__*/": JSON.stringify({ default: Array.from(rampUniform("default")), safe: Array.from(rampUniform("safe")) }),
    "/*__TEMP_COL__*/": JSON.stringify(hexToFloat3(TEMP_COLOR)),
    "/*__SHIELD_COL__*/": JSON.stringify(hexToFloat3(SHIELD_COLOR)),
    "/*__RAIL_COL__*/": JSON.stringify(hexToFloat3(RAIL_COLOR)),
    "/*__BREAK_AMBER__*/": JSON.stringify(hexToFloat3(BREAK_AMBER)),
    "/*__BREAK_HOT__*/": JSON.stringify(hexToFloat3(BREAK_HOT)),
    "/*__READOUT_INSET__*/": String(READOUT_INSET),
  };
  /* split/join rather than String#replace: the inlined sources contain `$`
     sequences that a replacement string would expand. */
  for (const [token, value] of Object.entries(swaps)) {
    if (!out.includes(token)) throw new Error("template has no " + token);
    out = put(out, token, value);
  }
  return out;
}

const outDest = arg("out");
if (outDest) {
  /* Relative to the page, so the page works from wherever it is written as long
     as the server's root is the repository. */
  const rel = relative(dirname(resolve(outDest)), fileURLToPath(ROOT)).split("\\").join("/");
  const root = rel ? rel + "/" : "./";
  const body = '<!doctype html><meta charset="utf-8">\n'
    + page(`import { ${ANIM_NAMES} } from "${root}scripts/features/resource-bars/anim.mjs";`, root);
  await writeFile(outDest, body);
  console.log("wrote  " + outDest + "  (" + (body.length / 1024).toFixed(1) + " KB) — serve the repo root: node tools/preview-server.mjs");
}

const artifactDest = arg("artifact");
if (artifactDest) {
  const body = page(await bundle(ANIM), "../");
  await writeFile(artifactDest, body);
  console.log("wrote  " + artifactDest + "  (" + (body.length / 1024).toFixed(1) + " KB, animation model and anime.js inlined)");
}

if (!outDest && !artifactDest) {
  console.log("usage: node tools/resource-bar-preview.mjs --out=<file.html> [--artifact=<body.html>]");
}
