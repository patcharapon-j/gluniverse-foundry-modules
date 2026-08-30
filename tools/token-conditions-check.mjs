/**
 * Token conditions — consistency check.
 *
 *   node tools/token-conditions-check.mjs
 *
 * Everything below fails *silently*. A shader that will not compile degrades to
 * nothing rather than erroring; a uniform declared and never written holds its
 * initial value forever; a duration written as a literal ignores the viewer's
 * motion tier; a plate whose counter is positioned from a second copy of the
 * shader's geometry drifts half off its own tab; an animated behaviour missing
 * from SHED_ORDER never degrades under load; a redacted effect that still
 * carries its name in the reading leaks it the moment somebody draws one more
 * thing; and a rail that never hears the world clock shows a gauge frozen where
 * it stood when the effect was applied.
 *
 * None of it raises. All of it renders.
 */

import { readFile } from "node:fs/promises";


const ROOT = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, ROOT), "utf8");

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

const F = "scripts/features/token-conditions/";

const [shaderSrc, hostSrc, dataSrc, toneSrc, mainSrc, animSrc, visSrc, langSrc, constSrc] = await Promise.all([
  read(F + "shader.mjs"), read(F + "host.mjs"), read(F + "data.mjs"), read(F + "tone.mjs"),
  read(F + "main.mjs"), read(F + "anim.mjs"), read(F + "visibility.mjs"),
  read("lang/token-conditions.en.json"), read(F + "constants.mjs"),
]);

const shader = await import(new URL(F + "shader.mjs", ROOT).href);
const tone = await import(new URL(F + "tone.mjs", ROOT).href);
const anim = await import(new URL(F + "anim.mjs", ROOT).href);
const lang = JSON.parse(langSrc);

/* ══ 1. Uniforms ═══════════════════════════════════════════════════════════
   Three lists that must agree: the UNIFORMS table, the GLSL's own declarations,
   and the JS that writes them. Any two of the three agreeing is not enough —
   a uniform in the table and the GLSL but never written is exactly the "the new
   effect simply does not appear" failure, and it looks like a shader bug. */
{
  const declared = new Set(
    [...shader.FRAGMENT_SHADER.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]),
  );
  const table = Object.keys(shader.UNIFORMS);

  for (const name of table) {
    if (!declared.has(name)) fail("uniforms", `${name} is in UNIFORMS but not declared in the GLSL`);
  }
  for (const name of declared) {
    /* The prelude declares uTexel, which the table also carries. */
    if (!table.includes(name)) fail("uniforms", `${name} is declared in the GLSL but missing from UNIFORMS`);
  }

  /* Written by the host, either at mesh creation or per frame. */
  const written = new Set([
    ...[...hostSrc.matchAll(/\bu\.(u[A-Z]\w*)\s*=/g)].map((m) => m[1]),
    ...[...hostSrc.matchAll(/\bu\.(u[A-Z]\w*)\[\d\]\s*=/g)].map((m) => m[1]),
    ...[...hostSrc.matchAll(/^\s{4}(u[A-Z]\w*):/gm)].map((m) => m[1]),
  ]);
  for (const name of table) {
    if (!written.has(name)) fail("uniforms", `${name} is never written by host.mjs — it will hold its initial value forever`);
  }
}

/* ══ 2. Geometry described from two files ══════════════════════════════════
   The GLSL places the sigil and the counter tab; the host places the artwork
   and the digits that go on them. Two copies of one piece of geometry is how a
   badge ends up half off its own tab, and it does not read as a two-pixel error
   — it reads as two people having drawn the same plate. */
{
  const plateConst = (name) => {
    const m = constSrc.match(new RegExp(`^\\s*${name}: ([0-9.]+),`, "m"));
    return m ? Number(m[1]) : null;
  };
  const glslNum = (re, label) => {
    const m = shader.FRAGMENT_SHADER.match(re);
    if (!m) { fail("geometry", `could not find ${label} in the GLSL`); return null; }
    return Number(m[1]);
  };

  const pairs = [
    ["tabHalfX", /vec2 nb = vec2\(min\(([0-9.]+),/, "the tab's half-width cap"],
    ["tabOfBody", /vec2 nb = vec2\(min\([0-9.]+, bb\.x \* ([0-9.]+)\)/, "the tab's width fraction"],
    ["tabHalfY", /vec2 nb = vec2\(min\([0-9.]+, bb\.x \* [0-9.]+\), ([0-9.]+)\)/, "the tab's half-height"],
  ];
  for (const [name, re, label] of pairs) {
    const inGlsl = glslNum(re, label);
    const inConst = plateConst(name);
    if (inGlsl === null || inConst === null) {
      fail("geometry", `${name} could not be read from both sides`);
    } else if (Math.abs(inGlsl - inConst) > 1e-6) {
      fail("geometry", `PLATE.${name} is ${inConst} but the GLSL uses ${inGlsl} — the counter will not sit on its tab`);
    }
  }
  /* And that the host takes them from there rather than keeping its own. */
  if (/^const (ICON_HALF|TAB_HALF_[XY]|TAB_OF_BODY) = /m.test(hostSrc)) {
    fail("geometry", "host.mjs redeclares a plate proportion instead of reading PLATE from constants.mjs");
  }
  /* The sigil's box is written by the host and read by the GLSL, so only the
     host holds its numbers; what has to be true is that the GLSL reads them
     from the uniform rather than re-deriving anything. */
  if (/float ih = /.test(shader.FRAGMENT_SHADER)) {
    fail("geometry", "the GLSL computes its own icon half-extent; uIconBox is supposed to be the only source");
  }
  if (!/uIconBox\.zw/.test(shader.FRAGMENT_SHADER) || !/uIconBox\.xy/.test(shader.FRAGMENT_SHADER)) {
    fail("geometry", "the GLSL does not read uIconBox for both the sigil's centre and its extent");
  }
}

/* ══ 3. Hairlines are measured in device pixels ════════════════════════════
   Anything meant to read as a hairline has to be sized in px, never in the
   shader's geometry units: a fixed value is ~2 device pixels on a HiDPI display
   and sub-pixel on an ordinary one, where the detail fade correctly deletes it —
   so the feature silently disappears for every player without a retina monitor,
   and no preview run at dpr 2 can show you that. */
{
  const hairlines = [
    [/float sw\s*=\s*max\(([0-9.]+), px \* [0-9.]+\)/, "the stroke"],
    [/float railW = max\(px \* [0-9.]+, ([0-9.]+)\)/, "the gauge rail"],
    [/cBand\(dRib, max\(px \* [0-9.]+, ([0-9.]+)\)\)/, "the redaction hatch"],
  ];
  for (const [re, label] of hairlines) {
    if (!re.test(shader.FRAGMENT_SHADER)) fail("hairlines", `${label} is not clamped against px`);
  }
}

/* ══ 4. Load shedding ══════════════════════════════════════════════════════
   Every animated behaviour must be able to degrade. One that is not in
   SHED_ORDER is one a forty-token encounter pays for whatever the frame time. */
{
  const asked = new Set([...hostSrc.matchAll(/this\.allows\("(\w+)"\)/g)].map((m) => m[1]));
  for (const name of asked) {
    if (!anim.SHED_ORDER.includes(name)) fail("shed", `host.mjs sheds "${name}", which is not in SHED_ORDER`);
  }
  for (const name of anim.SHED_ORDER) {
    if (name === "print") continue;  // the event itself; never actually shed
    if (!asked.has(name)) fail("shed", `SHED_ORDER names "${name}", which host.mjs never consults`);
  }
  if (anim.SHED_ORDER.at(-1) !== "print") {
    fail("shed", "the print must be last in SHED_ORDER — it is the event, not decoration");
  }
}

/* ══ 5. Durations come from the timing table ═══════════════════════════════
   A literal millisecond count in the animation ignores the viewer's motion
   tier, which is an explicit accessibility choice in this suite rather than an
   OS preference we may override. */
{
  const body = animSrc.slice(animSrc.indexOf("export class PlateAnim"));
  for (const m of body.matchAll(/\b(\d{2,4})\s*\*\s*scale/g)) {
    fail("timing", `PlateAnim multiplies a literal ${m[1]} by the motion scale; every duration belongs in TIMING`);
  }
  if (!/this\.motionScale <= 0/.test(animSrc)) {
    fail("timing", "PlateAnim has no still path — at motion 0 a plate would hold mid-print rather than simply being there");
  }
}

/* ══ 6. Permission ═════════════════════════════════════════════════════════
   The redaction happens at the point of READING, not of drawing. A field that
   is never populated cannot leak through a later refactor that draws one more
   thing; a field that is populated and merely not drawn can, and will. */
{
  const block = dataSrc.slice(dataSrc.indexOf("function readEffects"));
  for (const [field, re] of [
    ["name", /name: redacted \? "" :/],
    ["img", /img: redacted \? null :/],
    ["value", /value: redacted \? null :/],
    ["badgeText", /badgeText: redacted \? null :/],
  ]) {
    if (!re.test(block)) fail("permission", `readEffects populates \`${field}\` without checking \`redacted\` first`);
  }
  if (!/const redacted = !identified && !gm;/.test(block)) {
    fail("permission", "readEffects does not derive `redacted` from both identification and GM status");
  }
  if (!/canViewPlates\(token\)/.test(visSrc.slice(visSrc.indexOf("export function canViewLabels")))) {
    fail("permission", "canViewLabels does not defer to canViewPlates — a label mode could widen what a client sees");
  }
  if (/effects\.visible\s*=/.test(mainSrc)) {
    fail("permission", "main.mjs writes token.effects.visible; `visible` is the permission answer and must never be assigned");
  }
  if (!/effects\.renderable = false/.test(mainSrc)) {
    fail("permission", "main.mjs does not suppress Foundry's icons with `renderable = false`");
  }
}

/* ══ 7. The system's own gates ═════════════════════════════════════════════
   Three switches PF2e already gives a GM. Ignoring any one of them takes a
   control away from every user who already knows where it is. */
{
  const block = dataSrc.slice(dataSrc.indexOf("function readEffects"));
  for (const [re, label] of [
    [/item\?\.isExpired/, "isExpired — an expired effect is still on the sheet and no longer on the creature"],
    [/system\?\.tokenIcon\?\.show === false/, "system.tokenIcon.show — PF2e's own per-effect \"show on token\" switch"],
    [/item\?\.isIdentified !== false/, "isIdentified — an unidentified effect is one the GM deliberately hid"],
  ]) {
    if (!re.test(block)) fail("pf2e", `readEffects does not honour ${label}`);
  }
  if (!/conditions\?\.active/.test(dataSrc)) {
    fail("pf2e", "readConditions does not use `conditions.active`, which is PF2e's own resolution of the override rules");
  }
}

/* ══ 8. Durations tick with the world clock ════════════════════════════════
   A rail refreshed only on item changes shows a gauge frozen where it stood
   when the effect was applied, and keeps showing an effect for the rest of the
   session after it expires. Both hooks matter: the clock moves on its own, and
   advancing a turn is the commonest way it moves. */
{
  for (const hook of ["updateWorldTime", "updateCombat"]) {
    if (!new RegExp(`on\\("${hook}"`).test(mainSrc)) {
      fail("clock", `main.mjs does not listen for ${hook}; durations would not tick`);
    }
  }
}

/* ══ 9. `null` life and `0` life are different answers ═════════════════════
   null draws a constant hairline (a condition, or an effect with no duration);
   0 draws an empty gauge. Collapsing them puts a full-width bar under every
   unlimited effect and makes the gauge meaningless on the plates that have one. */
{
  if (!/return \{ life: null, remaining: Infinity \}/.test(dataSrc)) {
    fail("duration", "lifeOf never returns a null life — an unlimited effect would draw a full gauge");
  }
  if (!/uLifeOn = state\.life === null \? 0 : 1/.test(hostSrc)) {
    fail("duration", "host.mjs does not map a null life to uLifeOn = 0");
  }
}

/* ══ 10. Tones ═════════════════════════════════════════════════════════════
   Six tones, every condition mapped to one of them, every one of them
   separable, and none of them the suite's gold — which is spent on chrome and
   on a sustained effect's gauge, and means two unrelated things the moment a
   tone borrows it. */
{
  const GOLD = new Set(["#ffd24a", "#ffe070", "#ffe9b8"]);
  for (const [key, t] of Object.entries(tone.TONES)) {
    if (GOLD.has(t.body.toLowerCase()) || GOLD.has(t.hot.toLowerCase())) {
      fail("tone", `${key} uses the suite's gold, which is reserved for chrome`);
    }
    if (!(`GLTC.tone.${key}` in lang)) fail("tone", `no lang key for tone "${key}"`);
  }
  const ranks = Object.values(tone.TONES).map((t) => t.rank);
  if (new Set(ranks).size !== ranks.length) fail("tone", "two tones share a rank; the rail's order would not be stable");

  for (const [slug, key] of Object.entries(tone.CONDITION_TONES)) {
    if (!(key in tone.TONES)) fail("tone", `condition "${slug}" maps to unknown tone "${key}"`);
  }
  if (!(tone.DEFAULT_TONE in tone.TONES)) fail("tone", "DEFAULT_TONE is not a tone");

  /* The classifier is a heuristic and must therefore be overridable, or the only
     remedy for one wrong plate is turning the whole channel off. */
  if (!/readToneOverride/.test(toneSrc) || !/tc\.tone/.test(toneSrc)) {
    fail("tone", "effectTone has no per-effect GM override");
  }
}

/* ══ 11. Settings and prefixes ═════════════════════════════════════════════
   One package id owns every flag and setting every feature writes, and the
   prefix is the only thing keeping two features apart. A key without it would
   silently overwrite somebody else's. */
{
  const prefix = constSrc.match(/export const PREFIX = "([^"]+)"/)?.[1];
  if (prefix !== "tc.") fail("settings", `PREFIX is ${prefix}, not "tc."`);
  for (const m of constSrc.matchAll(/^\s{2}(\w+): PREFIX \+ "(\w+)"/gm)) {
    if (!(`GLTC.Settings.${m[2][0].toUpperCase()}${m[2].slice(1)}.Name` in lang)) {
      fail("settings", `setting "${m[2]}" has no GLTC.Settings.*.Name lang key`);
    }
  }
}

/* ══ Report ════════════════════════════════════════════════════════════════ */
if (problems.length) {
  console.error(`token-conditions: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.error("  • " + p);
  process.exitCode = 1;
} else {
  console.log("token-conditions: no problems");
}
