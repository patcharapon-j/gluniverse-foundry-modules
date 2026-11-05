#!/usr/bin/env node
/**
 * Flatfinder — consistency check.
 *
 * Everything here fails silently in Foundry: a wrong XP row is a plausible
 * number, a budget read the other way rates every fight one step mild, an
 * Elite creature counted +3 is still a level, a boss counted once per turn is
 * still a total, a band list drifting from Recall Knowledge's reads as the model
 * getting worse, and a missing i18n key is a bare key on the GM's screen.
 *
 *   node tools/flatfinder-check.mjs
 *
 * It drives the real rules, the real model, the real views and the real world
 * readers (with a stub `game`), and compares the tables against PF2e's own
 * bundle when one is installed. Zero problems required.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE = "scripts/features/flatfinder";
const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const problems = [];
const fail = (msg) => problems.push(msg);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── A stub world: settings, i18n, a user. Installed before any world module loads. ── */
const SETTINGS = new Map([
  ["ff.competenceBadge", "skills"],
  ["ff.incapacitation", true],
  ["ff.flattenDc", true],
  ["ff.eliteWeakLevel", true],
  ["ff.encounterBudget", true],
  ["ff.planner", {}],
  ["vr.boss.enabled", true],
  ["vr.boss.xpBudget", true],
  ["vr.boss.incapacitation", true],
]);
const EN = JSON.parse(read("lang/flatfinder.en.json"));
const fmt = (k, d) => {
  let s = EN[k] ?? k;
  if (d) for (const [key, v] of Object.entries(d)) s = s.replaceAll(`{${key}}`, String(v));
  return s;
};
globalThis.game = {
  settings: {
    get: (ns, key) => {
      if (!SETTINGS.has(key)) throw new Error(`unregistered ${key}`);
      return SETTINGS.get(key);
    },
  },
  i18n: { localize: (k) => fmt(k), format: (k, d) => fmt(k, d) },
  user: { isGM: true },
  actors: { party: null },
};
globalThis.CONST = { TOKEN_DISPOSITIONS: { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 } };

const C = await import(`../${FEATURE}/constants.js`);
const R = await import(`../${FEATURE}/rules.mjs`);
const M = await import(`../${FEATURE}/encounter-model.mjs`);
const V = await import(`../${FEATURE}/view.mjs`);
const P = await import(`../${FEATURE}/planner-store.mjs`);
const ADJ = await import(`../${FEATURE}/adjustments.js`);
const ENC = await import(`../${FEATURE}/encounter.js`);
const COMP = await import(`../${FEATURE}/competence.js`);
const { BAND_KEYS } = await import("../scripts/features/pf2e-recall/constants.mjs");

/* ═══ 1. XP and budgets, against the GM Core / GMG tables and PF2e's own bundle ═══ */

// The Proficiency-without-Level creature XP table (GMG, restated by PF2e as `pwol`).
const PWOL = { "-7": 9, "-6": 12, "-5": 14, "-4": 18, "-3": 21, "-2": 26, "-1": 32, 0: 40, 1: 48, 2: 60, 3: 72, 4: 90, 5: 108, 6: 135, 7: 160 };
for (const [d, xp] of Object.entries(PWOL)) {
  if (C.PWL_XP_BY_DIFF[String(d)] !== xp) fail(`xp: PWoL row ${d} is ${C.PWL_XP_BY_DIFF[String(d)]}, the table says ${xp}`);
  if (R.xpForDiff(Number(d)) !== xp) fail(`xp: xpForDiff(${d}) is ${R.xpForDiff(Number(d))}, expected ${xp}`);
}
if (R.xpForDiff(-12) !== 9 || R.xpForDiff(11) !== 160) fail("xp: the table must clamp at ±7, not fall off to 0");
for (let d = -7; d <= 7; d++) {
  if (R.creatureXp(5 + d, 5, { hazard: "complex" }) !== PWOL[d]) fail(`xp: a complex hazard at ${d} must count as a creature`);
  if (R.creatureXp(5 + d, 5, { hazard: "simple" }) !== Math.round(PWOL[d] * 0.2)) fail(`xp: a simple hazard at ${d} must be a fifth of a creature`);
}

// Budgets: 20 XP per character, x0.5 / x0.75 / x1 / x1.5 / x2 (PF2e's generateEncounterBudgets).
const PF2E_FRACTION = { trivial: 0.5, low: 0.75, moderate: 1, severe: 1.5, extreme: 2 };
for (let size = 1; size <= 10; size++) {
  const b = R.encounterBudgets(size);
  for (const key of C.THREAT_ORDER) {
    const want = Math.floor(size * 20 * PF2E_FRACTION[key]);
    if (b[key] !== want) fail(`budget: ${key} for ${size} PCs is ${b[key]}, PF2e says ${want}`);
  }
}
const B4 = R.encounterBudgets(4);
if (!eq(B4, { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 })) fail(`budget: a party of four is ${JSON.stringify(B4)}`);

// Rating: the mildest budget that holds the XP (PF2e's calculateEncounterRating).
const pf2eRating = (xp, b) => (xp <= b.trivial ? "trivial" : xp <= b.low ? "low" : xp <= b.moderate ? "moderate" : xp <= b.severe ? "severe" : "extreme");
for (let size = 1; size <= 8; size++) {
  const b = R.encounterBudgets(size);
  for (let xp = 0; xp <= 500; xp++) {
    const got = R.threatRating(xp, b);
    if (got !== pf2eRating(xp, b)) {
      fail(`rating: ${xp} XP for ${size} PCs reads ${got}, PF2e reads ${pf2eRating(xp, b)}`);
      break;
    }
    const h = R.headroom(xp, b);
    if (h.key) {
      if (R.threatRating(xp + h.gap, b) !== h.key || R.threatRating(xp + h.gap - 1, b) !== got) {
        fail(`headroom: ${xp} XP for ${size} PCs says ${h.gap} to ${h.key}, which is not where the rating turns`);
        break;
      }
    } else if (h.over - h.under !== xp - b.extreme) {
      fail(`headroom: ${xp} XP past/under Extreme is wrong`);
      break;
    }
  }
}
for (const [xp, size, want] of [[160, 4, 160], [120, 5, 96], [90, 3, 120]]) {
  if (R.awardPerPc(xp, size) !== want) fail(`award: ${xp} XP for ${size} PCs is ${R.awardPerPc(xp, size)}, PF2e says ${want}`);
}

// Against the installed PF2e bundle, when there is one.
const BUNDLES = [
  join(process.env.LOCALAPPDATA ?? "", "FoundryVTT/Data/systems/pf2e/pf2e.mjs"),
  "/Users/frostnoxia/Foundry User Data/Data/systems/pf2e/pf2e.mjs",
];
const bundlePath = BUNDLES.find((p) => p && existsSync(p));
let bundleChecked = false;
if (bundlePath) {
  const bundle = readFileSync(bundlePath, "utf8");
  const maps = [...bundle.matchAll(/new Map\(\[\s*((?:\[\s*-?\d+,\s*\d+\s*\],?\s*)+)\]\)/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/\[\s*(-?\d+),\s*(\d+)\s*\]/g)].map((x) => [x[1], Number(x[2])]))
  );
  const pwol = maps.find((m) => m["-7"] === 9 && m["7"] === 160);
  const creature = maps.find((m) => m["-4"] === 10 && m["4"] === 160 && !("-7" in m));
  const simple = maps.find((m) => m["-4"] === 2 && m["4"] === 32);
  if (!pwol) fail("pf2e: could not find PF2e's PWoL XP table in the bundle; re-read the bundle and update this check");
  else for (const [d, xp] of Object.entries(pwol)) if (C.PWL_XP_BY_DIFF[d] !== xp) fail(`pf2e: PWoL row ${d} is ${xp} in PF2e, ${C.PWL_XP_BY_DIFF[d]} here`);
  if (creature && simple) {
    for (const d of Object.keys(simple)) {
      if (simple[d] * 5 !== creature[d]) fail(`pf2e: a simple hazard is no longer a fifth of a creature at ${d}; revisit SIMPLE_HAZARD_FACTOR`);
    }
  }
  if (!/trivial:\s*Math\.floor\(\w+\s*\*\s*\.5\),\s*low:\s*Math\.floor\(\w+\s*\*\s*\.75\)/.test(bundle)) {
    fail("pf2e: generateEncounterBudgets changed shape; re-check ENCOUNTER_BUDGET against it");
  }
  if (!/\?\s*`trivial`\s*:\s*\w+\s*<=\s*\w+\.low/.test(bundle)) fail("pf2e: calculateEncounterRating changed; re-check threatRating against it");
  if (!/\.base < 1 \? \w+\.base \+ 2 : \w+\.base \+ 1/.test(bundle)) fail("pf2e: NPC Elite levelling changed; re-check pf2eAdjustedLevel");
  bundleChecked = true;
}

/* ═══ 2. Elite / Weak ═══ */

const pf2eLevel = (b, adj) => (adj === "elite" ? (b < 1 ? b + 2 : b + 1) : adj === "weak" ? (b === 1 ? b - 2 : b - 1) : b);
for (let b = -1; b <= 25; b++) {
  for (const adj of [null, "elite", "weak"]) {
    if (R.pf2eAdjustedLevel(b, adj) !== pf2eLevel(b, adj)) fail(`elite: PF2e's level for ${adj} ${b} is ${pf2eLevel(b, adj)}, not ${R.pf2eAdjustedLevel(b, adj)}`);
    const want = adj === "elite" ? b + 2 : adj === "weak" ? b - 2 : b;
    // Flatfinder counts from the BASE level, whatever PF2e did to the live one.
    const got = R.eliteWeakLevel({ level: pf2eLevel(b, adj), base: b, adjustment: adj });
    if (got !== want) fail(`elite: Flatfinder's level for ${adj ?? "normal"} ${b} is ${got}, expected ${want}`);
    if (R.eliteWeakLevel({ level: pf2eLevel(b, adj), base: b, adjustment: adj, shift: false }) !== pf2eLevel(b, adj)) {
      fail(`elite: with the setting off, ${adj ?? "normal"} ${b} must read PF2e's own level`);
    }
    if (R.plannedLevel(b, adj, true) !== want || R.plannedLevel(b, adj, false) !== pf2eLevel(b, adj)) fail(`elite: plannedLevel(${b}, ${adj}) disagrees`);
  }
}
// The world reader, on the exact actors the standalone module got wrong.
const npc = (base, adjustment, extra = {}) => ({
  type: "npc",
  level: pf2eLevel(base, adjustment),
  system: { details: { level: { base, value: pf2eLevel(base, adjustment) } }, attributes: { adjustment }, traits: { value: [] } },
  itemTypes: { effect: [] },
  ...extra,
});
for (const [base, adj, want] of [[0, "elite", 2], [-1, "elite", 1], [1, "weak", -1], [5, "elite", 7], [5, "weak", 3], [5, null, 5]]) {
  const got = ADJ.flatfinderEffectiveLevel(npc(base, adj));
  if (got !== want) fail(`elite: a level ${base} ${adj ?? "normal"} creature reads ${got}, Flatfinder says ${want}`);
}
{
  const withEffect = npc(4, null, { itemTypes: { effect: [{ slug: "ff-elite" }] } });
  if (ADJ.flatfinderEffectiveLevel(withEffect) !== 6) fail("elite: the bundled FF Elite effect must read +2");
}

/* ═══ 3. The boss seams and who counts ═══ */

const SUITE = "gluniverse-foundry-modules";
let uid = 0;
function actor(type, base, { name = type, boss = null, traits = [], alliance = null, adjustment = null, complex = false } = {}) {
  const flags = boss ? { "vr.boss": { tier: boss, baseLevel: base } } : {};
  const a = npc(base, adjustment);
  return Object.assign(a, {
    type,
    id: `a${++uid}`,
    uuid: `Actor.a${uid}`,
    name,
    img: "",
    alliance: alliance ?? (type === "character" ? "party" : "opposition"),
    traits: new Set(traits),
    getFlag: (scope, key) => (scope === SUITE ? flags[key] : undefined),
    system: { ...a.system, details: { ...a.system.details, isComplex: complex } },
  });
}
function combatant(a, { disposition = -1, extraTurn = false, hidden = false, name } = {}) {
  const flags = extraTurn ? { "vr.bossTurn": { owner: "x", index: 2, of: 3 } } : {};
  return { id: `c${++uid}`, actor: a, name: name ?? a.name, img: "", hidden, token: { disposition }, getFlag: (s, k) => (s === SUITE ? flags[k] : undefined) };
}
{
  const boss = actor("npc", 5, { name: "Boss", boss: "supreme" });
  const pcs = [actor("character", 5), actor("character", 5), actor("character", 5), actor("character", 5)];
  const combat = {
    id: "fight",
    combatants: [
      ...pcs.map((p) => combatant(p, { disposition: 1 })),
      combatant(boss),
      combatant(boss, { extraTurn: true }),
      combatant(boss, { extraTurn: true }),
    ],
  };
  const enc = ENC.computeEncounter(combat);
  if (!enc) fail("boss: an encounter with a boss computed nothing");
  else {
    if (enc.totalXp !== 40 * 3) fail(`boss: a Supreme boss at party level is worth ${enc.totalXp}, expected 120 (once, ×3)`);
    if (enc.count !== 1) fail(`boss: the boss was counted ${enc.count} times; its extra turns are the same creature`);
    // Combat Intro's contract.
    if (enc.severity !== enc.rating || typeof enc.budget?.[enc.severity] !== "number" || enc.totalXp !== 120) {
      fail("contract: computeEncounter must keep severity, totalXp and budget[severity] for Combat Intro");
    }
  }
  // The level bump never reaches the XP lookup: boss rows carry the base level.
  const entry = ENC.threatEntry(boss);
  if (entry.level !== 5 || entry.bossFactor !== 3) fail(`boss: a Supreme boss entry is level ${entry.level} ×${entry.bossFactor}, expected level 5 ×3`);
  SETTINGS.set("vr.boss.xpBudget", false);
  if (ENC.threatEntry(boss).bossFactor !== 1) fail("boss: with the boss XP rule off, the factor must be 1");
  SETTINGS.set("vr.boss.xpBudget", true);
}
{
  // Who is a threat: friendly and neutral tokens, party-side NPCs and PCs are not.
  const pcs = [actor("character", 3), actor("character", 3, { traits: ["minion"] })];
  const foes = [actor("npc", 3, { name: "Foe" }), actor("npc", 3, { name: "Ally" }), actor("npc", 3, { name: "Bystander" }), actor("npc", 3, { name: "Pet", alliance: "party" }), actor("hazard", 3, { name: "Trap" })];
  const combat = {
    id: "mix",
    combatants: [
      combatant(pcs[0], { disposition: 1 }),
      combatant(pcs[1], { disposition: 1 }),
      combatant(foes[0]),
      combatant(foes[0]), // a linked creature added twice is one creature
      combatant(foes[1], { disposition: 1 }),
      combatant(foes[2], { disposition: 0 }),
      combatant(foes[3]),
      combatant(foes[4], { disposition: -2 }),
    ],
  };
  const snap = ENC.combatSnapshot(combat);
  if (snap.pcs.length !== 1) fail(`party: a minion character counted as a PC (${snap.pcs.length} PCs)`);
  const names = snap.threats.map((t) => t.name).sort();
  if (!eq(names, ["Foe", "Trap"])) fail(`threats: expected Foe and Trap, got ${names.join(", ")}`);
  if (snap.threats.find((t) => t.name === "Trap")?.hazard !== "simple") fail("threats: a non-complex hazard must read as simple");
}
for (const file of readdirSync(join(ROOT, FEATURE))) {
  const src = read(`${FEATURE}/${file}`);
  if (/["'`]system\.details\.level\.value["'`]\s*:/.test(src) || /details\.level\.value\s*=[^=]/.test(src)) {
    fail(`level: ${file} writes system.details.level.value; pf2e-flatten would subtract the change a second time`);
  }
  if (/variants\.pwol/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) {
    fail(`pwol: ${file} reads PF2e's PWoL variant setting; in these worlds PWoL is pf2e-flatten's modifier and that setting is off`);
  }
}
{
  const enc = read(`${FEATURE}/encounter.js`);
  if (!enc.includes("bossXpFactor(actor)")) fail("boss: the encounter no longer multiplies a boss's XP");
  if (enc.includes("bossIncapacitationLevel")) fail("boss: the encounter must never see the boss level; the XP factor already accounts for the tier");
  if (!enc.includes("isExtraTurn(combatant)")) fail("boss: the encounter must refuse a boss's extra turns");
  if (!read(`${FEATURE}/incapacitation.js`).includes("bossIncapacitationLevel")) fail("boss: incapacitation must use the boss level");
  if (!/import\s*\{\s*MODIFIER_SLUG[^}]*\}\s*from\s*"\.\.\/pf2e-flatten\/constants\.js"/.test(read(`${FEATURE}/flatten.js`))) {
    fail("pwol: flatten.js must read pf2e-flatten's modifier slug from pf2e-flatten, not a copy");
  }
}

/* ═══ 4. Competence bands, and Recall Knowledge's copy of them ═══ */

const bands = C.COMPETENCE_BANDS;
if (bands.length !== 8) fail(`bands: expected 8 competence bands, found ${bands.length}`);
for (let i = 1; i < bands.length; i++) if (!(bands[i].min > bands[i - 1].min)) fail(`bands: ${bands[i].key} does not start above ${bands[i - 1].key}`);
if (!eq(bands.map((b) => b.min), [-Infinity, 0, 5, 10, 15, 20, 25, 30])) fail("bands: the thresholds are no longer Flatfinder's 0/5/10/.../30");
if (!eq([...BAND_KEYS], bands.map((b) => b.key))) fail(`recall: BAND_KEYS ${BAND_KEYS.join(",")} disagrees with Flatfinder's ${bands.map((b) => b.key).join(",")}`);
// recall-check reads constants.js with this regex; keep the shape it reads.
const regexKeys = [...read(`${FEATURE}/constants.js`).matchAll(/\{\s*key:\s*"([a-z]+)"\s*,\s*min:/g)].map((m) => m[1]);
if (!eq(regexKeys, bands.map((b) => b.key))) fail("bands: constants.js no longer reads as `{ key: \"…\", min:` per band; recall-check parses that shape");
for (let i = 1; i < bands.length; i++) {
  const m = bands[i].min;
  if (R.bandIndexFromTotal(m) !== i || R.bandIndexFromTotal(m - 1) !== i - 1) fail(`bands: the edge at ${m} is off by one`);
}
if (R.bandIndexFromTotal(-4) !== 0) fail("bands: a negative total must be Disastrous");
const cases = [
  [{ total: 17 }, "solid", []],
  [{ total: 17, lore: true }, "impressive", ["lore"]],
  [{ total: 17, natural: 20 }, "impressive", ["nat20"]],
  [{ total: 17, natural: 1 }, "passable", ["nat1"]],
  [{ total: 17, natural: 20, lore: true }, "remarkable", ["lore", "nat20"]],
  [{ total: 34, natural: 20, lore: true }, "phenomenal", ["lore", "nat20"]],
  [{ total: -3, natural: 1 }, "disastrous", ["nat1"]],
];
for (const [input, key, shifts] of cases) {
  const got = R.competence(input);
  if (got?.band.key !== key || !eq(got.shifts, shifts)) fail(`competence: ${JSON.stringify(input)} reads ${got?.band.key} ${got?.shifts}, expected ${key} ${shifts}`);
}
{
  const msg = (type, total, face, domains = []) => ({
    flags: { pf2e: { context: { type, domains } } },
    rolls: [{ total, dice: [{ faces: 20, results: [{ result: 3, active: false }, { result: face, active: true }] }] }],
  });
  if (COMP.computeCompetence(msg("skill-check", 22, 20, ["arcana"]), "skills")?.band.key !== "remarkable") fail("competence: the kept d20 of a fortune roll must count as the natural");
  if (COMP.computeCompetence(msg("skill-check", 12, 9, ["warfare-lore"]), "skills")?.band.key !== "solid") fail("competence: a Lore check must gain a band");
  if (COMP.computeCompetence(msg("perception-check", 12, 9), "skills") !== null) fail("competence: perception reads only in the 'all' mode");
  if (COMP.computeCompetence(msg("perception-check", 12, 9), "all")?.band.key !== "passable") fail("competence: perception must read in the 'all' mode");
  if (COMP.computeCompetence(msg("attack-roll", 22, 9), "all") !== null) fail("competence: an attack roll is not a competence check");
  if (COMP.isCompetenceResultVisible({ visible: true, isContentVisible: false })) fail("competence: a blind roll's band must stay hidden");
}

/* ═══ 5. Incapacitation, through the real Check.roll wrapper ═══ */

for (const [target, source, bonus] of [[5, 5, 0], [6, 5, 2], [9, 5, 8], [10, 5, 10], [20, 5, 10], [3, 5, 0]]) {
  if (R.incapacitationBonus(target, source) !== bonus) fail(`incapacitation: ${target} vs ${source} gives ${R.incapacitationBonus(target, source)}, expected ${bonus}`);
}
if (R.spellLevel(3) !== 6) fail("incapacitation: a spell counts as twice its rank");
{
  class Modifier { constructor(o) { Object.assign(this, o); } }
  game.pf2e = { Check: { roll: (check, context) => ({ check, context }) }, Modifier };
  const { registerIncapacitation } = await import(`../${FEATURE}/incapacitation.js`);
  registerIncapacitation();
  const native = () => [{ adjustments: { all: { label: "PF2E.TraitIncapacitation", amount: 1 } } }, { adjustments: { all: { label: "other" } } }];
  const roll = (targetBase, rank) => {
    const check = { modifiers: [], push(m) { this.modifiers.push(m); } };
    const context = {
      type: "saving-throw",
      actor: npc(targetBase, null),
      item: { type: "spell", rank, actor: null },
      options: new Set(["incapacitation"]),
      dosAdjustments: native(),
    };
    game.pf2e.Check.roll(check, context);
    return { check, context };
  };
  const hi = roll(9, 2); // level 9 vs a rank 2 spell (level 4): +10
  if (hi.check.modifiers[0]?.modifier !== 10) fail(`incapacitation: level 9 vs rank 2 should add +10, added ${hi.check.modifiers[0]?.modifier}`);
  if (hi.context.dosAdjustments.length !== 1) fail("incapacitation: the core rule's degree step must go when Flatfinder's applies");
  const lo = roll(3, 2); // level 3 vs level 4: no bonus, and still no core degree step
  if (lo.check.modifiers.length) fail("incapacitation: a lower-level target gains nothing");
  if (lo.context.dosAdjustments.length !== 1) fail("incapacitation: Flatfinder replaces the core rule, so its degree step must go even when no bonus applies");
  SETTINGS.set("ff.incapacitation", false);
  const off = roll(9, 2);
  if (off.check.modifiers.length || off.context.dosAdjustments.length !== 2) fail("incapacitation: with the rule off the roll must be untouched");
  SETTINGS.set("ff.incapacitation", true);
}

/* ═══ 6. The model and the planner store ═══ */

{
  const party = { level: 5, size: 4, source: "combat" };
  const m = M.buildEncounter({ party, threats: [{ name: "Gob", level: 4 }, { name: "Gob", level: 4 }, { name: "Wolf", level: 2, minion: true }], group: true, sort: true });
  if (m.rows.length !== 2 || m.rows[0].count !== 2 || m.rows[0].xp !== 64) fail("model: identical creatures must fold into one row ×2");
  if (m.totalXp !== 64 || m.rating !== "moderate") fail(`model: 64 XP for four at level 5 must be Moderate, got ${m.totalXp} ${m.rating}`);
  if (m.rows[1].xp !== 0) fail("model: a minion is worth no XP");
  let prev = -1;
  for (let xp = 0; xp <= 400; xp += 1) {
    const at = M.meterPosition(xp, R.encounterBudgets(4));
    if (at < prev || at < 0 || at > 1) fail(`meter: position at ${xp} XP is not monotonic in 0..1`);
    prev = at;
  }
  for (const tick of m.meter.ticks) {
    if (Math.abs(M.meterPosition(tick.xp, m.budgets) - tick.at) > 1e-9) fail(`meter: the ${tick.key} tick is not where its budget lands on the fill`);
  }
}
{
  const raw = { party: { level: "7", size: 30 }, rows: [{ id: "x", name: "A", base: 3, count: 500 }, { id: "x", name: "B", base: 2 }, { name: "C", base: 1, hazard: "simple", adjustment: "elite" }, null, { junk: true }] };
  const a = P.normalizePlan(raw);
  const b = P.normalizePlan(raw);
  if (!eq(a, b)) fail("planner: normalizePlan must be deterministic (row ids are minted the same every read)");
  if (new Set(a.rows.map((r) => r.id)).size !== a.rows.length) fail("planner: two rows share an id; every row control resolves by id");
  if (a.rows.length !== 3) fail(`planner: expected 3 rows after repair, got ${a.rows.length}`);
  if (a.rows[0].count !== 99 || a.party.size !== 12 || a.party.level !== 7) fail("planner: counts and the party must clamp");
  if (a.rows[2].adjustment !== null) fail("planner: a hazard cannot be Elite");
  let p = P.cycleAdjustment(a, a.rows[1].id);
  if (p.rows[1].adjustment !== "elite") fail("planner: Normal must cycle to Elite");
  p = P.cycleAdjustment(P.cycleAdjustment(p, a.rows[1].id), a.rows[1].id);
  if (p.rows[1].adjustment !== null) fail("planner: Weak must cycle back to Normal");
  const merged = P.addRow(P.addRow(P.normalizePlan({}), { uuid: "Actor.z", name: "Z", base: 2 }), { uuid: "Actor.z", name: "Z", base: 2 });
  if (merged.rows.length !== 1 || merged.rows[0].count !== 2) fail("planner: dropping the same creature twice must count it twice, in one row");
  const e = P.planEntries(P.normalizePlan({ rows: [{ id: "q", name: "Q", base: 0, adjustment: "elite" }] }), { shift: true });
  if (e[0].level !== 2) fail("planner: a planned Elite level 0 must read level 2");
  if (P.normalizePlan(P.clearParty(a)).party !== null) fail("planner: Follow the party must clear the hand-set party");
}

/* ═══ 7. Markup, i18n and actions ═══ */

const t = (k, d) => {
  if (!(k in EN)) fail(`i18n: ${k} is drawn but not in lang/flatfinder.en.json`);
  return fmt(k, d);
};
const party = { level: 5, size: 4, source: "party" };
const full = M.buildEncounter({
  party,
  group: true,
  sort: true,
  threats: [
    { name: "Boss", level: 6, bossFactor: 2, bossTier: "greater" },
    { name: "Elite", level: 7, adjustment: "elite" },
    { name: "Weak", level: 3, adjustment: "weak" },
    { name: "Trap", level: 5, hazard: "simple" },
    { name: "Gallery", level: 5, hazard: "complex" },
    { name: "Wolf", level: 1, minion: true },
    { name: "Titan", level: 20, hidden: true },
  ],
});
const marks = [
  ...C.COMPETENCE_BANDS.map((b) => V.competenceHTML(R.competence({ total: Number.isFinite(b.min) ? b.min : -2 }), { t })),
  ...C.COMPETENCE_BANDS.map((_, i) => V.competenceHTML(R.competence({ total: i * 5 - 1, natural: i % 2 ? 20 : 1, lore: true }), { t, fresh: true })),
  V.trackerHTML(full, { t, open: true, from: 0, rerated: true }),
  V.trackerHTML(null, { t }),
  ...C.THREAT_ORDER.map((_, i) => V.trackerHTML(M.buildEncounter({ party, threats: [{ name: "x", level: 5, count: [1, 2, 2, 3, 5][i] }] }), { t })),
  V.plannerHTML(full, { t, manual: true, canCopy: true, rerated: true }),
  V.plannerHTML(M.buildEncounter({ party, threats: [] }), { t }),
  V.plannerHTML(M.buildEncounter({ party: { level: 1, size: 4, source: "combat" }, threats: [{ name: "x", level: 9, count: 9 }] }), { t }),
  V.plannerHTML(M.buildEncounter({ party: { level: 1, size: 4, source: "default" }, threats: [{ name: "x", level: 1 }] }), { t }),
].join("\n");
for (const key of V.dynamicKeys()) if (!(key in EN)) fail(`i18n: runtime key ${key} has no string`);
for (const k of ["GLS.feature.flatfinder.title", "GLS.feature.flatfinder.hint"]) if (!(k in JSON.parse(read("lang/en.json")))) fail(`i18n: ${k} missing from lang/en.json`);
if (/undefined|\[object Object\]|NaN/.test(marks)) fail("markup: a view printed undefined, NaN or an object");
// Every literal key in the feature's sources resolves.
for (const file of readdirSync(join(ROOT, FEATURE))) {
  for (const [, key] of read(`${FEATURE}/${file}`).matchAll(/["'`](PF2E-FLATFINDER\.[A-Za-z0-9.]+[A-Za-z0-9])["'`]/g)) {
    if (!(key in EN)) fail(`i18n: ${file} uses ${key}, which has no string`);
  }
}
// Foundry expands dotted keys into objects: a key that is also another key's parent loses one of them.
const keys = Object.keys(EN);
for (const k of keys) if (keys.some((o) => o.startsWith(`${k}.`))) fail(`i18n: ${k} is both a string and a parent of other keys`);

// Every action drawn has a handler.
const handlers = read(`${FEATURE}/planner.mjs`) + read(`${FEATURE}/encounter.js`);
for (const action of new Set([...marks.matchAll(/data-ff-action="([a-z]+)"/g)].map((m) => m[1]))) {
  if (!handlers.includes(`action === "${action}"`)) fail(`actions: data-ff-action="${action}" is drawn with no handler`);
}
// Every button carries a class that sizes it (a bare button takes the host's type, 14px in chat).
const SIZED = new Set(["ff-btn", "ff-step", "ff-adj", "ff-remove", "ff-enc-head"]);
for (const [, cls] of marks.matchAll(/<button[^>]*class="([^"]*)"/g)) {
  if (!cls.split(/\s+/).some((c) => SIZED.has(c))) fail(`markup: a button (${cls}) has no sizing class`);
}

/* ═══ 8. CSS: the skin's own rules ═══ */

const css = read("styles/flatfinder.css");
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
if (/(^|[\s,}]):root\b/.test(cssCode)) fail("css: flatfinder.css writes on :root; the skin lives on the feature's roots only");
const declared = new Set([...cssCode.matchAll(/(--ff-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
for (const [, name] of cssCode.matchAll(/var\((--ff-[a-z0-9-]+)\s*\)/g)) if (!declared.has(name)) fail(`css: ${name} is read with no fallback and never declared`);
for (const [, name] of cssCode.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) if (!name.startsWith("flatfinder-")) fail(`css: keyframes ${name} must be prefixed flatfinder-`);
const pool = new Set([...read("styles/gl-motion.css").matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g), ...cssCode.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
for (const [, decl] of cssCode.matchAll(/animation:\s*([^;]+);/g)) {
  const name = decl.trim().split(/\s+/)[0];
  if (!pool.has(name)) fail(`css: animation ${name} names keyframes that do not exist`);
}
for (const [, decl] of cssCode.matchAll(/(?:transition|animation)(?:-duration|-delay)?:\s*([^;]+);/g)) {
  if (/\b\d*\.?\d+m?s\b/.test(decl) || /\b(ease-in-out|ease-out|ease-in|linear)\b/.test(decl.replace(/var\([^)]*\)/g, ""))) fail(`css: raw duration or easing in "${decl.trim()}"`);
}
if (/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(cssCode)) fail("css: a raw white veil; strike it from --gl-tint-light");
if (/@font-face|@import/.test(cssCode)) fail("css: @font-face or @import in a feature sheet");
if (/prefers-reduced-motion/.test(cssCode)) fail("css: the suite does not honour the OS reduced-motion preference");
if (/backdrop-filter/.test(cssCode)) fail("css: a backdrop blur must be written against --gl-glass-k (budget-check)");
// Classes drawn vs classes styled, both ways (feature prefixes only).
const drawn = new Set([...marks.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
const styled = new Set([...cssCode.matchAll(/\.((?:ff|flatfinder)-[a-z0-9-]+|is-[a-z-]+|has-[a-z-]+)/g)].map((m) => m[1]));
// The standalone module's class names, kept on the elements for anything that targets them; the skin styles the ff- ones.
const UNSTYLED_OK = new Set(["flatfinder-encounter-budget", "flatfinder-competence"]);
for (const c of drawn) {
  if (!/^(ff-|flatfinder-|is-|has-)/.test(c)) continue;
  if (!styled.has(c) && !UNSTYLED_OK.has(c)) fail(`css: .${c} is drawn but never styled`);
}
for (const c of styled) {
  if (c === "flatfinder-planner-app" || c === "is-dragging") continue; // the window frame class, and the drag state planner.mjs sets
  if (!drawn.has(c)) fail(`css: .${c} is styled but nothing draws it`);
}

/* ═══ 9. Purity, settings and the adapter ═══ */

const PURE = ["constants.js", "rules.mjs", "encounter-model.mjs", "view.mjs", "planner-store.mjs"];
for (const file of PURE) {
  const code = read(`${FEATURE}/${file}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  for (const word of ["game", "document", "foundry", "Hooks", "canvas", "CONFIG", "window", "ui"]) {
    if (new RegExp(`\\b${word}\\s*[.?\\[]`).test(code)) fail(`purity: ${file} reaches ${word}; it must stay pure so the check and the preview run the shipped copy`);
  }
}
{
  const settingsSrc = read(`${FEATURE}/settings.js`);
  const registered = [...settingsSrc.matchAll(/ffKey\("([A-Za-z]+)"\)/g)].map((m) => m[1]);
  if (!eq([...registered].sort(), [...C.SETTING_KEYS].sort())) fail(`settings: registered ${registered} vs SETTING_KEYS ${C.SETTING_KEYS}`);
  for (const file of readdirSync(join(ROOT, FEATURE))) {
    for (const [, key] of read(`${FEATURE}/${file}`).matchAll(/getSetting\("([A-Za-z]+)"\)/g)) {
      if (!C.SETTING_KEYS.includes(key)) fail(`settings: ${file} reads ff.${key}, which is never registered`);
    }
  }
  for (const [, name, hint] of settingsSrc.matchAll(/name:\s*"([^"]+)",\s*hint:\s*"([^"]+)"/g)) {
    if (!(name in EN) || !(hint in EN)) fail(`settings: ${name} / ${hint} has no string`);
  }
  const adapter = read(`${FEATURE}/index.mjs`);
  for (const key of ["competenceBadge", "incapacitation", "flattenDc", "eliteWeakLevel", "encounterBudget"]) {
    if (!adapter.includes(`${key}: "ff.${key}"`)) fail(`settings: the legacy migration lost ${key}`);
  }
  if (/Hooks\.(on|once)/.test(adapter)) fail("adapter: index.mjs registers a hook at import time");
  if (!/settingPrefix:\s*"ff\."/.test(adapter)) fail("adapter: the setting prefix must stay ff.");
  if (/\bconst\s*\{[^}]*\}\s*=\s*foundry\./.test(read(`${FEATURE}/planner.mjs`).split("function plannerClass")[0])) {
    fail("planner: foundry is reached at module scope; build the class in its factory");
  }
}

/* ── report ── */
if (!bundleChecked) console.log("note: no PF2e bundle found; the tables were checked against the printed values only");
if (problems.length) {
  for (const p of problems) console.log(`✗ ${p}`);
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log("flatfinder-check: 0 problems.");
