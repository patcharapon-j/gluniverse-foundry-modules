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

/* ── 9. Boss Creatures ───────────────────────────────────────────────────── */

const BOSS = join(FEATURE, "boss");
const bossRules = await import(join(BOSS, "rules.mjs"));
const bossData = await import(join(BOSS, "data.mjs"));
const bossPlacement = await import(join(BOSS, "initiative.mjs"));
const {
  TIERS,
  bossLevel,
  bossHp,
  bossDc,
  bossModifier,
  bossTurns,
  bossXpFactor,
  downfallPenalty,
  downfallAvailable,
  downfallBalance,
  turnOffsets,
  perLevels,
  levelDc,
  LEVEL_DC,
  resolveScale,
  SCALE_KEYS,
  MAX_ABILITIES,
  impenetrableResistance,
  infusedWeakness,
  targetedAssaultDice,
  appendageCount,
  reinforcementCount,
  consumeUnderlingHealing,
} = bossRules;
const { ABILITIES, CORE_ACTIONS, INFUSED } = bossData;
const { planTurns } = bossPlacement;

/* 9a. Tiers, and the three numbers each one moves. */

if (bossHp(100, "greater") !== 150) fail("boss: a Greater boss has 1.5x the base creature's Hit Points");
if (bossHp(100, "supreme") !== 200) fail("boss: a Supreme boss has 2x the base creature's Hit Points");
if (bossHp(101, "greater") !== 151) {
  fail("boss: a fractional Hit Point total must floor — PF2e cannot spend half a Hit Point");
}
if (bossHp(100, null) !== 100) fail("boss: an unmarked creature keeps its own Hit Points");

if (bossLevel(8, "greater") !== 10) fail("boss: a Greater boss counts as 2 levels higher");
if (bossLevel(8, "supreme") !== 12) fail("boss: a Supreme boss counts as 4 levels higher");
if (bossLevel(8, null) !== 8) fail("boss: an unmarked creature keeps its own level");

if (bossXpFactor("greater") !== 2) fail("boss: a Greater boss is worth twice the base creature");
if (bossXpFactor("supreme") !== 3) fail("boss: a Supreme boss is worth three times the base creature");
if (bossXpFactor(null) !== 1) fail("boss: an unmarked creature is worth its own XP");

if (bossTurns("greater") !== 2) fail("boss: a Greater boss takes 2 turns a round");
if (bossTurns("supreme") !== 3) fail("boss: a Supreme boss takes 3 turns a round");
if (bossTurns(null) !== 1) fail("boss: an unmarked creature takes one turn a round");

/*
 * The level bump must never be written back to the actor.
 *
 * pf2e-flatten implements Proficiency-without-Level as a custom modifier equal
 * to minus the actor's stored level, and refreshes it whenever that level
 * changes. Storing the boss level would therefore subtract another 2 or 4 from
 * every check and DC the boss makes — a Supreme boss would come out four points
 * *worse* than the creature it was built from, in a PWoL world only, with every
 * number on its sheet looking entirely ordinary. This is the same trap
 * Flatfinder's own Elite/Weak handling is written to avoid.
 */
for (const [file, source] of [
  ["boss/apply.mjs", read("scripts/features/pf2e-variant-rules/boss/apply.mjs")],
  ["boss/sheet.mjs", read("scripts/features/pf2e-variant-rules/boss/sheet.mjs")],
  ["boss/profile.mjs", read("scripts/features/pf2e-variant-rules/boss/profile.mjs")],
]) {
  if (/["']system\.details\.level\.value["']\s*:/.test(source)) {
    fail(
      `boss: ${file} writes system.details.level.value — the boss level is for incapacitation and XP only, ` +
        "and storing it makes pf2e-flatten subtract it a second time from every roll"
    );
  }
}

/* 9b. Boss DC and Boss modifier. */

// Against PF2e's own table, read straight out of the system bundle. A hand-typed
// copy of this table goes wrong at the top, where the steps widen to +2.
const PF2E_BUNDLE = "/Users/frostnoxia/Foundry User Data/Data/systems/pf2e/pf2e.mjs";
if (existsSync(PF2E_BUNDLE)) {
    const bundle = readFileSync(PF2E_BUNDLE, "utf8");
  // The table is a multi-line `new Map([[-1, 13], ...])`, so this matches across
  // newlines and spaces. A silent miss here would be the worst kind of pin: one
  // that passes forever while comparing nothing, so an unlocatable table is a
  // failure that says the system changed shape and this needs a human.
  const start = bundle.search(/new Map\(\s*\[\s*\[\s*-1\s*,\s*13\s*\]/);
  if (start < 0) {
    fail("boss: could not find PF2e own level-based DC table to check ours against");
  } else {
    const table = bundle.slice(start, bundle.indexOf("])", start));
    const pairs = [...table.matchAll(/\[\s*(-?\d+)\s*,\s*(\d+)\s*\]/g)].map(([, l, dc]) => [Number(l), Number(dc)]);
    if (pairs.length !== 27) {
      fail(`boss: PF2e level-based DC table read as ${pairs.length} rows, expected 27`);
    }
    for (const [level, dc] of pairs) {
      if (levelDc(level) !== dc) {
        fail(`boss: the level-based DC for level ${level} is ${levelDc(level)} here and ${dc} in the PF2e system`);
      }
    }
  }
}

if (LEVEL_DC.length !== 27) fail("boss: the level-based DC table must cover levels -1 through 25");

// Very hard is +5, and the DC comes from the *base* creature's level.
if (bossDc(8) !== 29) fail("boss: the Boss DC is a very hard DC (+5) of the base creature's level");
if (bossDc(8) !== bossDc(8, { flatten: 0 })) fail("boss: an unflattened world must not shift the Boss DC");
if (bossModifier(8) !== 19) fail("boss: the boss modifier is the Boss DC less 10");

/*
 * A Boss DC is a static number computed from a table, so nothing in pf2e-flatten
 * can reach it. In a Proficiency-without-Level world the PCs' saves are
 * flattened by their own level and this DC would not be, leaving every save
 * against the boss roughly a level too hard while every number involved looks
 * correct on its own.
 */
if (bossDc(8, { flatten: -8 }) !== 21) fail("boss: the Boss DC must carry the actor's Proficiency-without-Level offset");
if (bossDc(8, { flatten: 4 }) !== bossDc(8)) {
  fail("boss: a positive 'flatten' must be ignored — flattening only ever lowers a number");
}
if (bossDc(-1, { flatten: -100 }) < 1) fail("boss: a flattened Boss DC must never fall below 1");

/* 9c. Downfalls. */

if (downfallPenalty(0) !== 0) fail("boss: an untriggered boss carries no defence penalty");
if (downfallPenalty(1) !== -1) fail("boss: one Downfall is a -1 penalty to all defences");
if (downfallPenalty(3) !== -3) fail("boss: three separate Downfalls reach the -3 cap");
if (downfallPenalty(9) !== -3) fail("boss: the defence penalty is capped at -3");
if (downfallPenalty(2) > 0) {
  fail("boss: the Downfall penalty must be negative — a positive value would harden the boss at the moment the party got through");
}

/*
 * The two locks are different locks and must stay so. A boss suffers at most one
 * Downfall per boss *turn*; a specific trigger is spent until the beginning of
 * the boss's next *initial* turn. A Supreme boss takes three turns between
 * initial turns, so collapsing them lets one critical hit disrupt it twice.
 */
if (downfallAvailable({ turnSerial: 4, roundSerial: 2, lastTurn: 4, lastRound: null })) {
  fail("boss: a second Downfall in the same boss turn must be refused");
}
if (downfallAvailable({ turnSerial: 5, roundSerial: 2, lastTurn: null, lastRound: 2 })) {
  fail("boss: a trigger that already fired this round must stay spent until the boss's next initial turn");
}
if (!downfallAvailable({ turnSerial: 5, roundSerial: 2, lastTurn: 4, lastRound: 1 })) {
  fail("boss: a new turn and a new round must re-arm a Downfall");
}
if (!downfallAvailable({})) fail("boss: a boss that has suffered nothing must be triggerable");

const balance = downfallBalance({ abilities: 3, downfalls: 2 });
if (balance.balanced) fail("boss: three abilities against two downfalls is not balanced");
if (!downfallBalance({ abilities: 2, downfalls: 2 }).balanced) {
  fail("boss: equal counts must report as balanced");
}
if (MAX_ABILITIES !== 3) fail("boss: the book allows at most 3 Boss Abilities");

/* 9d. Turn rotation. */

// The book's own rotations, which it states for a party of four.
const greaterFour = turnOffsets("greater", 4);
if (greaterFour.length !== 1 || greaterFour[0] !== 2) {
  fail("boss: a Greater boss's second turn comes after 2 party members have acted");
}
const supremeFour = turnOffsets("supreme", 4);
if (supremeFour.length !== 2 || supremeFour[0] !== 1 || supremeFour[1] !== 3) {
  fail("boss: a Supreme boss's turns come after 1 and 3 party members have acted");
}
if (turnOffsets(null, 4).length !== 0) fail("boss: an unmarked creature takes no extra turns");

// "A boss should never be able to take multiple turns in succession."
for (const tier of ["greater", "supreme"]) {
  for (let size = 1; size <= 8; size++) {
    const offsets = turnOffsets(tier, size);
    if (offsets.some((gap) => gap < 1)) {
      fail(`boss: a ${tier} boss at a party of ${size} would take two turns in succession`);
    }
    if (new Set(offsets).size !== offsets.length) {
      fail(`boss: a ${tier} boss at a party of ${size} would place two turns in the same slot`);
    }
  }
}

/*
 * Placement. An extra turn that sorts *above* the boss's own entry acts before
 * the turn it is supposed to follow, which reads at the table as the boss simply
 * getting a free turn at the top of the round.
 */
const order = [
  { id: "boss", initiative: 20, boss: true },
  { id: "pc1", initiative: 18 },
  { id: "pc2", initiative: 15 },
  { id: "pc3", initiative: 12 },
  { id: "pc4", initiative: 9 },
];
const placed = planTurns(order, "boss", [1, 3]);
if (placed.length !== 2) fail("boss: a Supreme boss must place two extra turns");
if (placed.some((value) => value >= 20)) {
  fail("boss: an extra turn must never sort at or above the boss's own initiative");
}
if (!(placed[0] > placed[1])) fail("boss: the extra turns must come out in turn order");
if (new Set(placed).size !== placed.length) fail("boss: two extra turns must never share an initiative value");

// An offset past the end of the order clamps to the bottom rather than wrapping.
const shortOrder = [
  { id: "boss", initiative: 20, boss: true },
  { id: "pc1", initiative: 18 },
];
const clamped = planTurns(shortOrder, "boss", [3]);
if (clamped.length !== 1 || clamped[0] >= 18) {
  fail("boss: an offset past the end of the order must land below the last entry, not wrap above the boss");
}
if (planTurns(order, "missing", [1]).length !== 0) fail("boss: an absent boss places nothing");

/* 9e. Ability scaling. */

// "N per X levels (minimum N)" — floors, and never returns nothing.
if (perLevels(1, 2, 1) !== 1) fail("boss: a level-1 boss must still deal the minimum step");
if (perLevels(9, 2, 1) !== 4) fail("boss: 'per 2 levels' floors");
if (impenetrableResistance(1) !== 6) fail("boss: Impenetrable's resistance has a minimum of 6");
if (impenetrableResistance(12) !== 18) fail("boss: Impenetrable is 6 resistance per 4 levels");
if (infusedWeakness(7) !== 14) fail("boss: Infused gives a weakness of twice the base creature's level");
if (consumeUnderlingHealing(1) !== 15) fail("boss: Consume Underling heals at least 15");
if (consumeUnderlingHealing(10) !== 75) fail("boss: Consume Underling heals 15 per 2 levels");
if (appendageCount(0) !== 2) fail("boss: Grasping Appendages starts at 2 appendages");
if (appendageCount(10) !== 4) fail("boss: Grasping Appendages gains 1 appendage per 5 levels");
if (reinforcementCount(0) !== 4) fail("boss: Reinforcements! starts at 4 underlings");
if (reinforcementCount(9) !== 7) fail("boss: Reinforcements! gains 1 underling per 3 levels");
if (targetedAssaultDice(9) !== 1) fail("boss: Targeted Assault deals 1 extra die below 10th level");
if (targetedAssaultDice(10) !== 2) fail("boss: Targeted Assault deals 2 extra dice from 10th level");
if (targetedAssaultDice(18) !== 3) fail("boss: Targeted Assault deals 3 extra dice from 18th level");

/*
 * 9f. The catalogue, its declared scale keys, and the rule text — three lists
 * that must agree.
 *
 * An ability whose text spends a placeholder its entry does not declare prints
 * a literal `{dc}` in the item description, which the GM reads out at the table.
 * A declared key the text never spends is the same bug caught earlier: a number
 * the ability needs that stopped being shown.
 */
const bossLang = JSON.parse(read("lang/pf2e-variant-rules.en.json"));
const scaleKeys = new Set(SCALE_KEYS);

const allEntries = [
  ...ABILITIES.map((entry) => [entry, "GLVR.boss.ability"]),
  ...CORE_ACTIONS.map((entry) => [entry, "GLVR.boss.core"]),
];

if (ABILITIES.length !== 33) {
  fail(`boss: the catalogue holds ${ABILITIES.length} abilities; the book prints 33`);
}

const seenIds = new Set();
for (const [entry, root] of allEntries) {
  if (seenIds.has(entry.id)) fail(`boss: duplicate ability id '${entry.id}'`);
  seenIds.add(entry.id);

  const name = bossLang[`${root}.${entry.id}.name`];
  const text = bossLang[`${root}.${entry.id}.text`];
  if (!name) fail(`boss: '${entry.id}' has no ${root}.${entry.id}.name`);
  if (!text) {
    fail(`boss: '${entry.id}' has no ${root}.${entry.id}.text`);
    continue;
  }

  const spent = new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  const declared = new Set(entry.scale ?? []);

  for (const key of spent) {
    if (!declared.has(key)) {
      fail(`boss: '${entry.id}' spends {${key}} but does not declare it — the item would print the literal braces`);
    }
    if (!scaleKeys.has(key)) fail(`boss: '${entry.id}' spends {${key}}, which resolveScale cannot produce`);
  }
  for (const key of declared) {
    if (!spent.has(key)) fail(`boss: '${entry.id}' declares scale key '${key}' its text never uses`);
    if (!scaleKeys.has(key)) fail(`boss: '${entry.id}' declares '${key}', which resolveScale cannot produce`);
  }

  // Frequencies and costs must name a label that exists; both are built at
  // runtime by appending to a key, so nothing else would catch a missing one.
  if (entry.frequency && !bossLang[`GLVR.boss.frequency.${entry.frequency}`]) {
    fail(`boss: '${entry.id}' has frequency '${entry.frequency}' with no GLVR.boss.frequency label`);
  }
  const cost = entry.cost;
  if (!cost || !["action", "free", "passive"].includes(cost.type)) {
    fail(`boss: '${entry.id}' has no valid PF2e action type`);
  }
  if (cost?.type === "action" && ![1, 2, 3].includes(cost.count)) {
    fail(`boss: '${entry.id}' costs ${cost.count} actions; PF2e models only 1, 2 or 3`);
  }
  for (const trait of entry.bookTraits ?? []) {
    if (!bossLang[`GLVR.boss.bookTrait.${trait}`]) {
      fail(`boss: '${entry.id}' carries book trait '${trait}' with no GLVR.boss.bookTrait label`);
    }
  }
}

/*
 * Traits written to an item must be traits PF2e knows.
 *
 * PF2e builds the trait field as a tagify widget with `enforceWhitelist`, so a
 * trait it has no entry for survives an `update()` and is then dropped the first
 * time a GM touches the traits on that item. The ability quietly stops being a
 * telegraph ability and nothing anywhere says so, which is why the book's own
 * new traits live in `bookTraits` and are printed in the description instead.
 */
const PF2E_LANG = "/Users/frostnoxia/Foundry User Data/Data/systems/pf2e/lang/en.json";
if (existsSync(PF2E_LANG)) {
  const pf2eLang = JSON.parse(readFileSync(PF2E_LANG, "utf8")).PF2E ?? {};
  const known = (trait) => {
    const key = `Trait${trait.charAt(0).toUpperCase()}${trait.slice(1)}`;
    return pf2eLang[key] !== undefined;
  };
  for (const [entry] of allEntries) {
    for (const trait of entry.traits ?? []) {
      if (!known(trait)) {
        fail(
          `boss: '${entry.id}' writes trait '${trait}' to the item, but PF2e has no entry for it — ` +
            "it belongs in bookTraits, or the whitelisted trait field will silently drop it"
        );
      }
    }
    for (const trait of entry.bookTraits ?? []) {
      if (known(trait)) {
        fail(`boss: '${entry.id}' keeps '${trait}' in bookTraits, but PF2e knows it — it should be a real trait chip`);
      }
    }
  }
}

// Every Infused element must name a damage type, or Elemental Strike deals none.
for (const [element, damage] of Object.entries(INFUSED)) {
  if (typeof damage !== "string" || !damage) fail(`boss: Infused element '${element}' has no damage type`);
}

/* 9g. Downfall triggers, tiers and settings, all built at runtime. */

for (const trigger of Object.values(bossData.ABILITIES.length ? {} : {})) void trigger;
const bossConstants = await import(join(BOSS, "constants.mjs"));
for (const trigger of Object.values(bossConstants.DOWNFALL_TRIGGER)) {
  if (!bossLang[`GLVR.boss.trigger.${trigger}`]) fail(`boss: downfall trigger '${trigger}' has no label`);
  if (!bossLang[`GLVR.boss.triggerHint.${trigger}`]) fail(`boss: downfall trigger '${trigger}' has no hint`);
}
for (const tier of Object.keys(TIERS)) {
  if (!bossLang[`GLVR.boss.tier.${tier}`]) fail(`boss: tier '${tier}' has no label`);
  if (!bossLang[`GLVR.boss.tierHint.${tier}`]) fail(`boss: tier '${tier}' has no hint`);
}
for (const key of ["free", "passive", "1", "2", "3", "range"]) {
  if (!bossLang[`GLVR.boss.cost.${key}`]) fail(`boss: action cost '${key}' has no label`);
}

/* 9h. The cross-feature seams. */

/*
 * Two other features import from `boss/profile.mjs`. That module must stay
 * side-effect-free and must never reach a Foundry global at import time, or the
 * initiative rail — which is system-agnostic and loads in every world — would
 * throw on load in a game that is not PF2e.
 */
const profileSource = read("scripts/features/pf2e-variant-rules/boss/profile.mjs");
const profileBody = profileSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
for (const [pattern, message] of [
  [/^\s*(?:await\s+)?(?:game|ui|Hooks|CONFIG|canvas)\./m, "boss/profile.mjs touches a Foundry global at import time"],
  [/^\s*Hooks\.on/m, "boss/profile.mjs registers a hook at import time"],
]) {
  if (pattern.test(profileBody)) fail(`boss: ${message} — two other features import it and one loads in every world`);
}

const initSource = read("scripts/features/initiative/gluniverse-initiative.mjs");
if (!initSource.includes('from "../pf2e-variant-rules/boss/profile.mjs"')) {
  fail("boss: the initiative rail no longer imports bossBadge — the boss card would render as an ordinary hostile");
}
if (!initSource.includes("gluni-card--boss")) fail("boss: the initiative rail draws no boss class on the card");
const initCss = read("styles/initiative.css");
for (const cls of ["gluni-card--boss", "gluni-card--boss-supreme", "gluni-card--boss-extra", "gluni-boss-tag"]) {
  if (!initCss.includes(`.${cls}`)) fail(`boss: styles/initiative.css defines no .${cls}`);
}

const encounterSource = read("scripts/features/flatfinder/encounter.js");
if (!encounterSource.includes("bossXpFactor(actor)")) {
  fail("boss: the Flatfinder encounter budget no longer multiplies a boss's XP");
}
/*
 * The level bump and the XP factor must reach the budget by different routes.
 * `threatXp` already derives XP from the level difference, so a boss level fed
 * into that lookup *and* an XP multiplier on top of it counts the boss twice.
 */
if (/flatfinderEffectiveLevel[\s\S]{0,200}bossIncapacitationLevel/.test(encounterSource)) {
  fail("boss: the encounter budget must not use the boss level — the XP factor already accounts for the tier");
}

const incapSource = read("scripts/features/flatfinder/incapacitation.js");
if (!incapSource.includes("bossIncapacitationLevel")) {
  fail("boss: Flatfinder's incapacitation maths no longer uses the boss level, which is what that level exists for");
}

/*
 * Card mode and standard mode must never both give a boss its extra turns. The
 * card deal already multiplies an actor's slots by `cardConfig.turns`, so extra
 * Combatant documents on top of it would be dealt once each — a Supreme boss
 * taking nine turns a round.
 */
const bossInitSource = read("scripts/features/pf2e-variant-rules/boss/initiative.mjs");
if (!bossInitSource.includes("!cardMode()")) {
  fail("boss: extra combatants are not gated on card mode — the card deal would multiply them again");
}
if (!bossInitSource.includes("deleteEmbeddedDocuments")) {
  fail("boss: a boss whose extra turns are switched off must have them removed, not merely stopped");
}

/*
 * Raising max Hit Points and current Hit Points in one update silently clamps
 * the value back to the old maximum: `CreaturePF2e#_preUpdate` clamps an
 * incoming `hp.value` against the maximum the actor has at that moment. The
 * boss would gain its Hit Points and immediately sit at half of them.
 */
const applySource = read("scripts/features/pf2e-variant-rules/boss/apply.mjs");
const writeHp = applySource.slice(applySource.indexOf("async function writeHp"));
const writeHpBody = writeHp.slice(0, writeHp.indexOf("\n}\n") + 1);
if (!/hp\.max[\s\S]*?actor\.update[\s\S]*?hp\.value/.test(writeHpBody)) {
  fail("boss: writeHp must write the maximum in its own update before the value, or PF2e clamps the value to the old max");
}
if ((writeHpBody.match(/actor\.update\(/g) ?? []).length < 2) {
  fail("boss: writeHp writes max and value in one update — PF2e clamps the value against the old maximum");
}

/* 9i. Settings and registration. */

const bossPrefix = "vr.boss";
if (!bossPrefix.startsWith(PREFIX) || bossPrefix.length <= PREFIX.length) {
  fail("boss: the sub-feature prefix must be strictly longer than the parent's catch-all");
}
const adapterSource = read("scripts/features/pf2e-variant-rules/index.mjs");
if (!adapterSource.includes("RULES.boss.id")) fail("boss: the sub-feature is not registered with the suite");
if (!adapterSource.includes("registerBoss()")) fail("boss: registerBoss is never called from onInit");
if (!bossLang["GLS.feature.vr-boss-creatures.title"]) fail("boss: the Control Center entry has no title");
if (!bossLang["GLS.feature.vr-boss-creatures.hint"]) fail("boss: the Control Center entry has no hint");

const bossCss = read("styles/pf2e-variant-rules-boss.css");
for (const [pattern, message] of [
  [/@font-face/, "css: the boss sheet must not declare @font-face"],
  [/@import\s+url\(['"]?http/, "css: the boss sheet must not reach the network"],
  [/rgba\(\s*255\s*,\s*255\s*,\s*255/, "css: strike white veils from --gl-tint-light, not a literal rgba()"],
  [/rgba\(\s*0\s*,\s*0\s*,\s*0/, "css: strike black veils from --gl-tint-dark, not a literal rgba()"],
  [/(transition|animation)[^;]*?\b\d+m?s\b/, "css: a raw duration is invisible to --gl-motion-scale"],
  [/prefers-reduced-motion/, "css: the suite does not honour the OS reduced-motion preference"],
]) {
  if (pattern.test(bossCss)) fail(message);
}
for (const m of bossCss.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
  if (m[1].startsWith("gl-")) fail(`css: @keyframes '${m[1]}' takes a bare gl- name and would override the shared pool`);
}
if (!moduleJson.styles.includes("styles/pf2e-variant-rules-boss.css")) {
  fail("boss: styles/pf2e-variant-rules-boss.css is not listed in module.json");
}

/* ── Report ──────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.error(`\npf2e-variant-rules: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  process.exit(1);
}
console.log("pf2e-variant-rules: no problems found");
