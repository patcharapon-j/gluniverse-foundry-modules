#!/usr/bin/env node
/**
 * GLUniverse Suite — Locations consistency check.
 *
 *   node tools/locations-check.mjs
 *   node tools/locations-check.mjs --sheet=/tmp/locations.html
 *
 * Locations is held together by agreements a diff cannot see, all of which fail
 * *silently* rather than loudly:
 *
 *   · A style's duration lives twice — as a `--gl-d-*` token in the stylesheet
 *     and as the `ms` mirror in the STYLES table that `scaledMs()` uses to time
 *     the teardown. Disagree, and the curtain unmounts mid-animation.
 *   · A `url(#gl-loc-…)` naming a filter that is not in the defs resolves to no
 *     filter at all, so the style just does nothing.
 *   · An `animation:` naming a missing `@keyframes` is likewise a no-op.
 *   · A style with no i18n key renders its raw id in the picker.
 *   · feComposite works on PREMULTIPLIED colour and `arithmetic` multiplies the
 *     RGB channels too — compositing the plate against a matte whose RGB is zero
 *     renders it solid black while the alpha maths looks perfectly correct. This
 *     one shipped once already; it is checked so it cannot ship twice.
 *
 * Pure Node, no dependencies, no browser. What it cannot check is how any of it
 * *looks*: for that, `--sheet` writes a self-contained page that freezes every
 * style mid-transition over a test image. Open it and look — the ink edge and
 * the shred threshold are judgements, not assertions.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const TRAVEL = read("scripts/features/locations/travel.mjs");
const CSS = read("styles/locations.css");
const TOKENS = read("styles/gl-tokens.css");
const LANG = JSON.parse(read("lang/locations.en.json"));

const problems = [];
const fail = (msg) => problems.push(msg);

/* ── Parse the catalogue out of the adapter ───────────────────────────── */

const STYLES = [];
for (const m of TRAVEL.matchAll(
  /^\s*"?([a-z][a-z-]*)"?:\s*\{\s*group:\s*"(\w+)",\s*mech:\s*"(\w+)",\s*ms:\s*(\d+)\s*\}/gm
)) {
  STYLES.push({ id: m[1], group: m[2], mech: m[3], ms: Number(m[4]) });
}
if (STYLES.length < 20) fail(`Parsed only ${STYLES.length} styles from travel.mjs — the STYLES regex has drifted.`);

const GROUPS = (TRAVEL.match(/STYLE_GROUPS\s*=\s*\[([^\]]*)\]/)?.[1] ?? "")
  .split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);

/* ── Durations: the CSS token and the JS mirror must agree ────────────── */

const tokenMs = new Map();
for (const m of TOKENS.matchAll(/--gl-d-([a-z]+):\s*calc\((\d+)ms/g)) tokenMs.set(m[1], Number(m[2]));

for (const style of STYLES) {
  const block = [...CSS.matchAll(new RegExp(`\\[data-gl-loc-style="${style.id}"\\]\\s*\\{([^}]*)\\}`, "g"))]
    .map((m) => m[1]).join("\n");
  if (!block) {
    fail(`Style "${style.id}" has no [data-gl-loc-style] rule in locations.css.`);
    continue;
  }
  const token = block.match(/--gl-loc-dur:\s*var\(--gl-d-([a-z]+)\)/)?.[1];
  if (!token) {
    fail(`Style "${style.id}" never sets --gl-loc-dur, so it silently inherits the default.`);
    continue;
  }
  const ms = tokenMs.get(token);
  if (ms === undefined) fail(`Style "${style.id}" uses --gl-d-${token}, which gl-tokens.css does not define.`);
  else if (ms !== style.ms) {
    fail(`Style "${style.id}": CSS says --gl-d-${token} (${ms}ms) but STYLES.ms says ${style.ms}ms. ` +
         `The curtain would unmount ${ms > style.ms ? "before" : "after"} the animation ends.`);
  }
}

/* ── Filters: every reference resolves, every definition is used ──────── */

const defined = new Set([...TRAVEL.matchAll(/<filter id="(gl-loc-[\w-]+)"/g)].map((m) => m[1]));
const referenced = new Set([...CSS.matchAll(/url\(#(gl-loc-[\w-]+)\)/g)].map((m) => m[1]));

for (const id of referenced) if (!defined.has(id)) fail(`locations.css references filter #${id}, which travel.mjs does not define.`);
for (const id of defined) if (!referenced.has(id)) fail(`travel.mjs defines filter #${id}, which no stylesheet rule uses.`);

/* ── The premultiply trap ─────────────────────────────────────────────── */

for (const filter of TRAVEL.matchAll(/<filter id="(gl-loc-[\w-]+)"[\s\S]*?<\/filter>/g)) {
  const [body, id] = [filter[0], filter[1]];
  for (const comp of body.matchAll(/<feComposite[^>]*operator="arithmetic"[^>]*>/g)) {
    const in2 = comp[0].match(/in2="(\w+)"/)?.[1];
    if (!in2) continue;
    // Does the matte it composites against carry colour, or only alpha?
    const matte = body.match(new RegExp(`<feColorMatrix[^>]*result="${in2}"[^>]*>`))?.[0];
    const values = matte?.match(/values="([^"]+)"/)?.[1]?.trim().split(/\s+/).map(Number);
    if (values?.length === 20 && values.slice(0, 15).every((v) => v === 0)) {
      fail(`Filter #${id}: feComposite/arithmetic against the zero-RGB matte "${in2}" multiplies the ` +
           `colour channels by zero and renders the source solid black. Use operator="in".`);
    }
  }
}

/* ── Keyframes: every animation names one that exists ─────────────────── */

const keyframes = new Set([...CSS.matchAll(/@keyframes\s+(gl-loc-[\w-]+)/g)].map((m) => m[1]));
for (const m of CSS.matchAll(/animation:\s*(gl-loc-[\w-]+)/g)) {
  if (!keyframes.has(m[1])) fail(`locations.css animates "${m[1]}", which has no @keyframes block.`);
}
for (const name of keyframes) {
  if (!new RegExp(`animation:\\s*${name}\\b`).test(CSS)) fail(`@keyframes ${name} is defined but never used.`);
}

/* ── Localization: keys built from the table at runtime ───────────────── */

for (const style of STYLES) {
  if (!LANG[`GLLOC.style.${style.id}`]) fail(`Missing i18n key GLLOC.style.${style.id} — the picker would show the raw id.`);
  if (!GROUPS.includes(style.group)) fail(`Style "${style.id}" is in group "${style.group}", which is not in STYLE_GROUPS.`);
}
for (const group of GROUPS) {
  if (!LANG[`GLLOC.group.${group}`]) fail(`Missing i18n key GLLOC.group.${group}.`);
}

/* ── Mechanisms: each one has CSS behind it ───────────────────────────── */

for (const mech of new Set(STYLES.map((s) => s.mech))) {
  if (mech === "none") continue;
  const byMech = CSS.includes(`[data-gl-loc-mech="${mech}"]`);
  const byStyle = STYLES.filter((s) => s.mech === mech)
    .every((s) => new RegExp(`\\.is-playing\\[data-gl-loc-style="${s.id}"\\]`).test(CSS));
  if (!byMech && !byStyle) fail(`Mechanism "${mech}" has no rules in locations.css — its styles would do nothing.`);
}

/* ── The contact sheet ────────────────────────────────────────────────── */

const sheetArg = process.argv.find((a) => a.startsWith("--sheet="));
if (sheetArg) {
  const defs = TRAVEL.match(/<defs>[\s\S]*<\/defs>/)?.[0] ?? "";
  const cells = STYLES.map(
    (s) => `<div class="cell"><div class="under"></div>
    <div class="gl-loc-curtain is-playing" style="--frac:.5" data-gl-loc-style="${s.id}" data-gl-loc-mech="${s.mech}">
      <div class="gl-loc-stage">
        <div class="gl-loc-platewrap"><div class="gl-loc-plate"></div></div>
        <div class="gl-loc-veilwrap"><div class="gl-loc-veil"></div></div>
      </div>
    </div><b>${s.id}</b></div>`
  ).join("\n");

  const html = `<!doctype html><meta charset="utf-8"><title>Locations — contact sheet</title>
<style>
${read("styles/gl-tokens.css")}
${read("styles/gl-motion.css")}
${CSS}
body{margin:0;background:#111;font:12px system-ui}
.sheet{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px}
.cell{position:relative;aspect-ratio:16/10;overflow:hidden;border:1px solid #333}
.under{position:absolute;inset:0;background:repeating-linear-gradient(45deg,#1b6e4a 0 18px,#2aa06c 18px 36px)}
.cell b{position:absolute;left:0;bottom:0;z-index:9;background:#000a;color:#fff;padding:1px 5px;font:11px monospace}
.cell .gl-loc-curtain{position:absolute;z-index:5}
.cell .gl-loc-plate{background:linear-gradient(120deg,#b8452e,#e0a33c 45%,#4c2a6b)}
/* A negative delay seeks; paused holds it there. Every style frozen at 50%. */
.gl-loc-curtain.is-playing,.gl-loc-curtain.is-playing *{
  animation-play-state:paused!important;
  animation-delay:calc(-1 * var(--frac) * var(--gl-loc-dur))!important}
</style>
<svg width="0" height="0" aria-hidden="true">${defs}</svg>
<div class="sheet">${cells}</div>`;

  const out = sheetArg.slice("--sheet=".length);
  writeFileSync(out, html);
  console.log(`sheet  ${out} — open it in a browser; every style is frozen at 50%.`);
}

/* ── Report ───────────────────────────────────────────────────────────── */

console.log(`checked ${STYLES.length} styles, ${defined.size} filters, ${keyframes.size} keyframe sets`);
if (problems.length) {
  for (const p of problems) console.log(`FAIL  ${p}`);
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("OK");
