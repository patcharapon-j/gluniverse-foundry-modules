#!/usr/bin/env node
/**
 * PF2e Variant Rules consistency check.
 *
 * Everything below fails *silently* in a live session, which is the bar for
 * being in here at all:
 *
 *   • The dent → item-HP reflection must round DOWN. PF2e's broken threshold is
 *     `floor(max / 2)`, so on an odd-HP item rounding the other way leaves a
 *     two-dent item one point above the threshold and PF2e never calls it
 *     broken. The item looks damaged, the shield keeps its AC bonus, and
 *     nothing anywhere reports a problem — on odd-HP items only.
 *
 *   • Chip damage must fire on a *miss* and not on a *critical* miss. Both deal
 *     no damage, and the rule covers only the first; getting it wrong doubles
 *     how often the rule triggers and reads as "the module is too generous".
 *
 *   • A resisted damage type negates chip damage outright rather than reducing
 *     it. If that ever became a reduction, a raging barbarian would quietly
 *     start taking chip damage they are immune to.
 *
 *   • Every setting key must begin with a prefix the adapter declares. A key
 *     that does not is hidden from Foundry's native sheet *and* unreachable in
 *     the Control Center — it exists only in the database.
 *
 *   • Every i18n key the source builds must exist, including the two families
 *     built at runtime (`GLVR.dents.state.*` and the settings keys derived by
 *     slicing the `vr.` prefix off a setting name), which nothing else checks.
 *
 *   • Sub-feature prefixes must be strictly longer than the parent's catch-all,
 *     or the catalog's longest-first sort hands the child's keys to the parent
 *     and the child's settings group renders empty.
 *
 * Usage: node tools/pf2e-variant-rules-check.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE = join(ROOT, "scripts/features/pf2e-variant-rules");

const problems = [];
const fail = (msg) => problems.push(msg);
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/* ── 1. Pure rule logic ──────────────────────────────────────────────────── */

const rules = await import(join(FEATURE, "rules.mjs"));
const { chipTriggers, chipAmount, chipBasis, resolveChip, dentsFromDamage, dentThresholds, dentState, hpForDents, dentsRepaired, carefulQualifies, woundPenalties } = rules;

// Chip fires on the highest no-damage degree and nowhere else.
if (!chipTriggers("attack-roll", "failure")) fail("chip: a missed Strike must trigger chip damage");
if (chipTriggers("attack-roll", "criticalFailure")) {
  fail("chip: a CRITICAL miss must NOT trigger chip damage — the book excludes degrees beyond the first that deals none");
}
if (!chipTriggers("saving-throw", "criticalSuccess")) fail("chip: a critical success on a save must trigger chip damage");
if (chipTriggers("saving-throw", "success")) fail("chip: a plain successful save takes half damage and must not chip");
if (chipTriggers("skill-check", "failure")) fail("chip: a skill check is not a damaging effect");

// Amount: level, or twice the rank for a spell, never below the minimum.
if (chipAmount({ level: 5 }) !== 5) fail("chip: a level-5 effect must chip for 5");
if (chipAmount({ spellRank: 3 }) !== 6) fail("chip: a 3rd-rank spell must chip for 6 (the book's own example)");
if (chipAmount({ spellRank: 3, level: 12 }) !== 6) fail("chip: a spell's rank must win over its level");
if (chipAmount({ level: 0 }) !== 1) fail("chip: a level-0 effect must clamp to the minimum, not chip for nothing");
if (chipAmount({ level: -2 }) !== 1) fail("chip: a negative level must clamp to the minimum");

// Resistance negates outright.
const resisted = resolveChip({
  kind: "attack-roll",
  outcome: "failure",
  level: 5,
  damageTypes: ["slashing", "fire"],
  resistedTypes: ["fire"],
});
if (!resisted.negated) fail("chip: an applicable resistance must NEGATE chip damage, not reduce it");
if (resisted.amount !== 0) fail("chip: negated chip damage must be 0");
if (resisted.chosen !== "fire") fail("chip: the resisted type must be the one chosen — it is what any player would pick");

const unresisted = resolveChip({ kind: "attack-roll", outcome: "failure", level: 4, damageTypes: ["slashing"] });
if (unresisted.negated || unresisted.amount !== 4) fail("chip: an unresisted type must deal the full amount");

// Persistent damage never chips.
const persistent = resolveChip({ kind: "attack-roll", outcome: "failure", level: 5, persistentOnly: true });
if (persistent.applies) fail("chip: persistent damage must not chip");

/* ── 2. Dents ────────────────────────────────────────────────────────────── */

if (dentsFromDamage(4, 5) !== 0) fail("dents: damage below Hardness deals no dents");
if (dentsFromDamage(5, 5) !== 0) fail("dents: damage equal to Hardness deals no dents — PF2e reduces it to zero");
if (dentsFromDamage(6, 5) !== 1) fail("dents: damage above Hardness deals 1 dent");
if (dentsFromDamage(10, 5) !== 1) fail("dents: exactly twice Hardness is still 1 dent ('more than twice')");
if (dentsFromDamage(11, 5) !== 2) fail("dents: more than twice Hardness deals 2 dents");

const plain = dentThresholds();
const sturdy = dentThresholds({ sturdy: true });
if (plain.broken !== 2 || plain.destroyed !== 4) fail("dents: base thresholds must be 2 broken / 4 destroyed");
if (sturdy.broken !== 4 || sturdy.destroyed !== 8) fail("dents: a sturdy shield must double both thresholds");

if (dentState(0) !== "intact") fail("dents: 0 dents is intact");
if (dentState(1) !== "dented") fail("dents: 1 dent is dented, not broken");
if (dentState(2) !== "broken") fail("dents: 2 dents is broken");
if (dentState(4) !== "destroyed") fail("dents: 4 dents is destroyed");
if (dentState(2, { sturdy: true }) !== "dented") fail("dents: 2 dents on a sturdy shield is only dented");
if (dentState(4, { sturdy: true }) !== "broken") fail("dents: 4 dents on a sturdy shield is broken");

// The rounding pin. PF2e: isDestroyed = hp === 0; isBroken = hp <= floor(max/2).
for (const max of [1, 5, 7, 11, 15, 23, 40, 41]) {
  const threshold = Math.floor(max / 2);
  const atBroken = hpForDents(2, max);
  if (!(atBroken <= threshold)) {
    fail(
      `dents: ${max} max HP — 2 dents yields hp ${atBroken}, above PF2e's broken threshold ${threshold}. ` +
        `The reflection must use floor(), or odd-HP items never read as broken.`
    );
  }
  if (hpForDents(4, max) !== 0) fail(`dents: ${max} max HP — 4 dents must yield 0 hp so PF2e calls it destroyed`);
  if (hpForDents(0, max) !== max) fail(`dents: ${max} max HP — 0 dents must leave HP at maximum`);
  const atOne = hpForDents(1, max);
  if (max >= 4 && !(atOne > threshold)) {
    fail(`dents: ${max} max HP — 1 dent yields hp ${atOne}, which PF2e would already call broken`);
  }
}
// Sturdy shields must reach broken at their own doubled rung, not the base one.
for (const max of [15, 20, 33]) {
  const t = Math.floor(max / 2);
  if (!(hpForDents(4, max, { sturdy: true }) <= t)) fail(`dents: sturdy ${max} max HP — 4 dents must read as broken`);
  if (!(hpForDents(2, max, { sturdy: true }) > t)) fail(`dents: sturdy ${max} max HP — 2 dents must NOT read as broken`);
  if (hpForDents(8, max, { sturdy: true }) !== 0) fail(`dents: sturdy ${max} max HP — 8 dents must be destroyed`);
}

if (dentsRepaired("criticalSuccess") !== 2) fail("dents: a critical Repair removes 2 dents");
if (dentsRepaired("success") !== 1) fail("dents: a successful Repair removes 1 dent");
if (dentsRepaired("failure") !== 0) fail("dents: a failed Repair removes none");
if (dentsRepaired("criticalFailure") !== 0) fail("dents: a critically failed Repair removes none");

/* ── 2b. Dents, as the player sees them ──────────────────────────────────── */

const dentsSrc = readFileSync(join(FEATURE, "dents.mjs"), "utf8");

// A dent is the state of a player's own gear, so reading it and writing it are
// different questions. Gate the *readout* on `isGM` and it looks perfectly
// correct on the GM's screen while being absent on every other one, which is the
// one failure nobody at the table is in a position to report. The two sheet
// passes must therefore reach `game.user.isGM` only through `canEdit()`.
const bodyOf = (name) => {
  const start = dentsSrc.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const end = dentsSrc.indexOf("\n}", start);
  return end < 0 ? null : dentsSrc.slice(start, end);
};
for (const name of ["onRenderItemSheet", "onRenderActorSheet"]) {
  const body = bodyOf(name);
  if (body === null) {
    fail(`dents: ${name} is missing — the player-visible readout has no entry point`);
  } else if (/isGM/.test(body)) {
    fail(`dents: ${name} tests isGM directly; a readout behind it is invisible to every player`);
  }
}
if (!/renderActorSheetPF2e/.test(dentsSrc)) {
  fail("dents: nothing renders the count on the actor sheet, which is the only inventory a player reads");
}
// The override writes an absolute value; routing it through `addDents` would
// make typing 3 mean "add 3" and the box would climb every time it was used.
if (!/setDents\(item, event/.test(dentsSrc)) {
  fail("dents: the GM's override must set an absolute value, not add one");
}

/* ── 3. Careful Consumption ──────────────────────────────────────────────── */

const elixir = { type: "consumable", actionCost: 1, formula: "1d6+6", kind: "healing" };
if (!carefulQualifies(elixir)) fail("careful: a 1-action healing elixir must qualify");
if (!carefulQualifies({ ...elixir, actionCost: "free" })) fail("careful: a free-action consumable is '1 action or less'");
if (!carefulQualifies({ ...elixir, actionCost: null })) fail("careful: a consumable with no action cost is '1 action or less'");
if (carefulQualifies({ ...elixir, actionCost: 2 })) fail("careful: a 2-action consumable must NOT qualify — the activity already costs two");
if (carefulQualifies({ ...elixir, type: "weapon" })) fail("careful: only consumables qualify");
if (carefulQualifies({ ...elixir, formula: "6" })) fail("careful: a flat formula has no roll to maximize");
if (carefulQualifies({ ...elixir, formula: null })) fail("careful: an item with no formula must not qualify");
if (carefulQualifies({ ...elixir, kind: "damage" }, { healingOnly: true })) {
  fail("careful: healingOnly must exclude damaging consumables");
}
if (!carefulQualifies(elixir, { healingOnly: true })) fail("careful: healingOnly must still permit healing consumables");

// The card prints the sum under the figure, so the sum has to come from the same
// place the figure does. A basis that disagrees with the amount is a card that
// says 6 and applies 5, and nothing anywhere reports it.
for (const source of [{ spellRank: 3 }, { level: 7 }, { level: 0 }, { level: -4 }, { spellRank: 1, level: 20 }]) {
  const basis = chipBasis(source);
  if (basis.amount !== chipAmount(source)) {
    fail(`chip: the printed basis disagrees with the applied amount for ${JSON.stringify(source)}`);
  }
  if (basis.source === "spell" && basis.rank === null) fail("chip: a spell basis must carry the rank it printed");
  if (basis.source === "level" && basis.level === null) fail("chip: a level basis must carry the level it printed");
}
if (!chipBasis({ level: 0 }).clamped) {
  fail("chip: a clamped figure must say so, or the card prints a sum that is not the number applied");
}
if (chipBasis({ level: 6 }).clamped) fail("chip: an unclamped figure must not claim the minimum was applied");
if (chipBasis({ spellRank: 3 }).source !== "spell") fail("chip: a spell must be attributed to its rank, not its level");
if (!resolveChip({ kind: "attack-roll", outcome: "failure", level: 4, damageTypes: ["slashing"] }).basis) {
  fail("chip: an applicable outcome must carry the basis the card prints");
}

/* ── 4. Lasting Wounds ───────────────────────────────────────────────────── */

const w2 = woundPenalties(2);
if (w2.medicine !== -2) fail("wounds: the Medicine penalty equals the wounded value, as a penalty");
if (w2.healing !== -4) fail("wounds: the healing penalty is TWICE the wounded value, as a penalty");
if (woundPenalties(0).healing !== 0) fail("wounds: an unwounded creature takes no penalty");
if (woundPenalties(3).healing >= 0) fail("wounds: the healing penalty must be negative — a positive value would INCREASE healing");

/* ── 4b. Careful Consumption, at the seams with PF2e ─────────────────────── */

const carefulSrc = readFileSync(join(FEATURE, "careful.mjs"), "utf8");

// There is no Roll#maximumValue in Foundry — the property appears nowhere in
// core. Reading one yields undefined, the guard in front of it always trips, and
// the chat-card button silently never appears, which is how this first shipped.
if (/maximumValue/.test(carefulSrc)) {
  fail("careful: Roll#maximumValue does not exist in Foundry; the button it gates would never render");
}
if (!/evaluateSync\(/.test(carefulSrc)) {
  fail("careful: the maximum must be produced by evaluating the formula, not read off a property");
}

// `system.uses.value` is the dose count, not an action cost. Read as one, every
// multi-dose consumable is disqualified for having doses left in the bottle.
if (/actionCostOf[\s\S]{0,400}?uses\?\.\s*value/.test(carefulSrc)) {
  fail("careful: system.uses.value is a dose count and must not be read as an action cost");
}

// Doses and quantity are different counters; spending quantity first destroys a
// part-used elixir at the first sip.
if (!/"system\.uses\.value"/.test(carefulSrc)) {
  fail("careful: spending a use must decrement system.uses.value, mirroring ConsumablePF2e#consume");
}

/* ── 4c. Lasting Wounds, at the seam with Check.roll ─────────────────────── */

const woundsSrc = readFileSync(join(FEATURE, "wounds.mjs"), "utf8");

// `Check.roll(check, context)` sums `check.modifiers`. The context's own
// `modifiers` array is copied into `context.origin` as metadata about the roller
// and is never added to anything, so a penalty written there is recorded,
// displayed nowhere, and changes no result: the card renders perfectly with the
// wrong total, on the one check this rule exists for.
if (/context\.modifiers\s*=/.test(woundsSrc)) {
  fail("wounds: the Medicine penalty must go on the check; Check.roll never sums context.modifiers");
}
if (!/applyMedicinePenalty\(check, context\)/.test(woundsSrc)) {
  fail("wounds: the Check.roll wrapper must hand the check itself to applyMedicinePenalty");
}
if (!/check\.push\(/.test(woundsSrc)) {
  fail("wounds: the penalty must be pushed onto the check, which is what recalculates the total");
}

/* ── 5. Prefix routing ───────────────────────────────────────────────────── */

const { PREFIX, RULES, SETTINGS } = await import(join(FEATURE, "constants.mjs"));
const childPrefixes = Object.values(RULES).map((r) => r.prefix);

for (const p of childPrefixes) {
  if (!p.startsWith(PREFIX)) fail(`prefix: '${p}' must sit inside the parent catch-all '${PREFIX}'`);
  if (p.length <= PREFIX.length) {
    fail(`prefix: '${p}' must be strictly longer than '${PREFIX}', or the parent claims the child's keys`);
  }
}
if (new Set(childPrefixes).size !== childPrefixes.length) fail("prefix: two sub-features share a prefix");

const declared = [PREFIX, ...childPrefixes];
for (const [name, key] of Object.entries(SETTINGS)) {
  if (!declared.some((p) => key.startsWith(p))) {
    fail(`settings: '${key}' (${name}) matches no declared prefix — it would be unreachable in the Control Center`);
  }
}

/* ── 6. i18n ─────────────────────────────────────────────────────────────── */

const langPath = "lang/pf2e-variant-rules.en.json";
if (!existsSync(join(ROOT, langPath))) {
  fail(`i18n: ${langPath} is missing`);
} else {
  const lang = JSON.parse(read(langPath));
  const has = (k) => Object.prototype.hasOwnProperty.call(lang, k);

  // Runtime-built family 1: every dent state names a key.
  for (const state of ["intact", "dented", "broken", "destroyed"]) {
    if (!has(`GLVR.dents.state.${state}`)) fail(`i18n: missing GLVR.dents.state.${state} (built at runtime)`);
  }

  // Runtime-built family 2: settings.mjs derives name/hint by slicing "vr." off
  // the key, so a renamed setting silently loses its label.
  for (const key of Object.values(SETTINGS)) {
    if (key.endsWith(".enabled")) continue; // config:false, no label needed
    const base = `GLVR.settings.${key.slice("vr.".length)}`;
    if (!has(`${base}.name`)) fail(`i18n: missing ${base}.name for setting '${key}'`);
    if (!has(`${base}.hint`)) fail(`i18n: missing ${base}.hint for setting '${key}'`);
  }

  // Every feature registered needs a Control Center title and hint.
  for (const id of ["pf2e-variant-rules", ...Object.values(RULES).map((r) => r.id)]) {
    if (!has(`GLS.feature.${id}.title`)) fail(`i18n: missing GLS.feature.${id}.title`);
    if (!has(`GLS.feature.${id}.hint`)) fail(`i18n: missing GLS.feature.${id}.hint`);
  }

  // Every literal GLVR.* key referenced in source must exist.
  const sources = ["chip.mjs", "dents.mjs", "careful.mjs", "wounds.mjs", "apply.mjs"];
  const referenced = new Set();
  for (const file of sources) {
    const text = readFileSync(join(FEATURE, file), "utf8");
    for (const m of text.matchAll(/["'`](GLVR\.[A-Za-z0-9_.]+)["'`]/g)) referenced.add(m[1]);
  }
  for (const key of referenced) {
    if (key.endsWith(".")) continue;
    if (!has(key)) fail(`i18n: source references '${key}', which the language file does not define`);
  }
}

/* ── 7. Wiring ───────────────────────────────────────────────────────────── */

const moduleJson = JSON.parse(read("module.json"));
if (!moduleJson.styles.includes("styles/pf2e-variant-rules.css")) {
  fail("wiring: styles/pf2e-variant-rules.css is not listed in module.json");
}
if (!moduleJson.languages.some((l) => l.path === langPath)) {
  fail(`wiring: ${langPath} is not listed in module.json`);
}
if (!read("scripts/features/index.mjs").includes("pf2e-variant-rules/index.mjs")) {
  fail("wiring: the adapter is not imported from scripts/features/index.mjs");
}

// Belts deliberately ships no code; a stray belt module would mean the scope
// decision was quietly reversed.
if (existsSync(join(FEATURE, "belt.mjs"))) {
  fail("scope: belt.mjs exists — Belts was cut deliberately, see the note in index.mjs");
}

/* ── 8. Design system ────────────────────────────────────────────────────── */

const css = read("styles/pf2e-variant-rules.css");
for (const [pattern, message] of [
  [/@font-face/, "css: a feature sheet must not declare @font-face"],
  [/@import\s+url\(['"]?http/, "css: a feature sheet must not reach the network"],
  [/rgba\(\s*255\s*,\s*255\s*,\s*255/, "css: strike white veils from --gl-tint-light, not a literal rgba()"],
  [/rgba\(\s*0\s*,\s*0\s*,\s*0/, "css: strike black veils from --gl-tint-dark, not a literal rgba()"],
  [/(transition|animation)[^;]*?\b\d+m?s\b/, "css: a raw duration is invisible to --gl-motion-scale; use a --gl-d-* token"],
  [/prefers-reduced-motion/, "css: the suite does not honour the OS reduced-motion preference"],
]) {
  if (pattern.test(css)) fail(message);
}
// A bare `gl-` keyframe would silently override another feature's animation.
for (const m of css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
  if (m[1].startsWith("gl-")) fail(`css: @keyframes '${m[1]}' takes a bare gl- name and would override the shared pool`);
}

/* ── Report ──────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.error(`\npf2e-variant-rules: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  process.exit(1);
}
console.log("pf2e-variant-rules: no problems found");
