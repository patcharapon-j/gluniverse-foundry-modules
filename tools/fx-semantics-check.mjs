#!/usr/bin/env node
/**
 * Spellsprite semantics check: plain Node, no dependencies.
 *
 *   node tools/fx-semantics-check.mjs
 *
 * 1. Fixtures: trimmed copies of real PF2e 8.5.1 documents (spells, weapons,
 *    NPC strikes, a breath weapon, consumables) and what each must resolve to.
 * 2. The outcome table (attack vs save degrees) and the privacy-neutral default.
 * 3. Robustness: junk input never throws and always yields a closed vocabulary.
 * 4. When PF2e's packs are installed, every spot check in tools/fx-coverage.mjs
 *    against the REAL compendium data.
 *
 * Exit code 1 on any failure.
 */

import { existsSync } from "node:fs";
import {
  describeItem, describeCondition, describeSkillAction, describeTick, outcomeFrom,
  weaponStyleOf, inlineTemplate, inlineDamage, runeMaterials,
} from "../scripts/features/pf2e-fx/semantics.mjs";
import { FUNCTIONS, MATERIALS, WEAPON_STYLES, DELIVERIES, TRADITIONS } from "../scripts/features/pf2e-fx/constants.mjs";

const fails = [];
let passed = 0;
const pick = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function expect(label, result, want) {
  for (const [k, v] of Object.entries(want)) {
    const got = pick(result, k);
    if (got !== v) fails.push(`${label}: ${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(got)}`);
    else passed++;
  }
}

/* ── fixtures (trimmed from PF2e 8.5.1 packs) ─────────────────────────── */

const spell = (name, slug, system) => ({ name, type: "spell", system: { slug, area: null, damage: {}, defense: null, range: { value: "" }, target: { value: "" }, level: { value: 1 }, ...system } });
const F = {
  fireball: spell("Fireball", "fireball", { area: { type: "burst", value: 20 }, damage: { 0: { formula: "6d6", kinds: ["damage"], type: "fire" } }, defense: { save: { basic: true, statistic: "reflex" } }, level: { value: 3 }, range: { value: "500 feet" }, traits: { traditions: ["arcane", "primal"], value: ["concentrate", "fire", "manipulate"] } }),
  lightningBolt: spell("Lightning Bolt", "lightning-bolt", { area: { type: "line", value: 120 }, damage: { 0: { formula: "4d12", kinds: ["damage"], type: "electricity" } }, defense: { save: { basic: true, statistic: "reflex" } }, level: { value: 3 }, traits: { traditions: ["arcane", "primal"], value: ["concentrate", "electricity", "manipulate"] } }),
  electricArc: spell("Electric Arc", "electric-arc", { damage: { 0: { formula: "2d4", kinds: ["damage"], type: "electricity" } }, defense: { save: { basic: true, statistic: "reflex" } }, range: { value: "30 feet" }, target: { value: "1 or 2 creatures" }, traits: { traditions: ["arcane", "primal"], value: ["cantrip", "concentrate", "electricity", "manipulate"] } }),
  forceBarrage: spell("Force Barrage", "force-barrage", { damage: { 0: { formula: "1d4+1", kinds: ["damage"], type: "force" } }, range: { value: "120 feet" }, target: { value: "1 creature" }, traits: { traditions: ["arcane", "occult"], value: ["concentrate", "force", "manipulate"] } }),
  heal: spell("Heal", "heal", { damage: { 0: { formula: "1d8", kinds: ["damage", "healing"], type: "vitality" } }, defense: { save: { basic: true, statistic: "fortitude" } }, range: { value: "varies" }, target: { value: "1 willing living creature or 1 undead" }, traits: { traditions: ["divine", "primal"], value: ["healing", "manipulate", "vitality"] }, description: { value: "<p>…@Template[emanation|distance:30]…</p>" } }),
  harmVsUndead: spell("Harm (vs. Undead)", "harm", { damage: { 0: { formula: "1d8+8", kinds: ["healing"], type: "void" } }, range: { value: "30 feet" }, target: { value: "1 willing undead creature" }, traits: { traditions: ["divine"], value: ["concentrate", "manipulate", "void"] } }),
  haste: spell("Haste", "haste", { level: { value: 3 }, range: { value: "30 feet" }, target: { value: "1 creature" }, traits: { traditions: ["arcane", "occult", "primal"], value: ["concentrate", "manipulate"] } }),
  shield: spell("Shield", "shield", { traits: { traditions: ["arcane", "divine", "occult"], value: ["cantrip", "concentrate", "force"] } }),
  fireRay: spell("Fire Ray", "fire-ray", { damage: { 0: { formula: "2d6", kinds: ["damage"], type: "fire" } }, defense: { passive: { statistic: "ac" } }, level: { value: 2 }, range: { value: "60 feet" }, target: { value: "1 creature" }, traits: { value: ["attack", "cleric", "concentrate", "fire", "focus", "manipulate"] } }),
  longsword: { name: "Longsword", type: "weapon", system: { slug: "longsword", group: "sword", range: null, damage: { damageType: "slashing", dice: 1, die: "d8" }, runes: { potency: 1, striking: 1, property: ["flaming"] }, traits: { value: ["versatile-p"] } } },
  shortbow: { name: "Shortbow", type: "weapon", system: { slug: "shortbow", group: "bow", range: 60, damage: { damageType: "piercing", dice: 1, die: "d6" }, runes: { property: [] }, traits: { value: ["deadly-d10"] } } },
  javelin: { name: "Javelin", type: "weapon", system: { slug: "javelin", group: "dart", range: 30, damage: { damageType: "piercing", dice: 1, die: "d6" }, runes: { property: [] }, traits: { value: ["thrown"] } } },
  dagger: { name: "Dagger", type: "weapon", system: { slug: "dagger", group: "knife", range: null, damage: { damageType: "piercing", dice: 1, die: "d4" }, runes: { property: ["greaterFrost"] }, traits: { value: ["agile", "finesse", "thrown-10", "versatile-s"] } } },
  alchemistsFire: { name: "Alchemist's Fire (Lesser)", type: "weapon", system: { slug: "alchemists-fire-lesser", group: "bomb", range: 20, damage: { damageType: "fire", dice: 1, die: "d8", persistent: { number: 1, type: "fire" } }, splashDamage: { value: 1 }, level: { value: 1 }, traits: { value: ["alchemical", "bomb", "consumable", "fire", "splash"] } } },
  healingPotion: { name: "Healing Potion (Minor)", type: "consumable", system: { slug: "healing-potion-minor", category: "potion", damage: { formula: "1d8", kind: "healing", type: "vitality" }, level: { value: 1 }, traits: { value: ["consumable", "healing", "magical", "potion", "vitality"] } } },
  rations: { name: "Rations", type: "consumable", system: { slug: "rations", category: "other", traits: { value: ["consumable"] } } },
  wolfJaws: { name: "Jaws", type: "melee", system: { damageRolls: { a: { damage: "1d6+2", damageType: "piercing" } }, range: null, traits: { value: ["unarmed"] } } },
  trollClaw: { name: "Claw", type: "melee", system: { damageRolls: { a: { damage: "2d8+5", damageType: "slashing" } }, range: null, traits: { value: ["agile", "reach-10", "unarmed"] } } },
  dragonJaws: { name: "Jaws", type: "melee", system: { damageRolls: { a: { damage: "2d10+8", damageType: "piercing" }, b: { damage: "2d4", damageType: "poison" } }, range: null, traits: { value: ["magical", "poison", "reach-10", "unarmed"] } } },
  dragonTail: { name: "Tail", type: "melee", system: { damageRolls: { a: { damage: "2d8+7", damageType: "bludgeoning" } }, range: null, traits: { value: ["magical", "reach-15"] } } },
  goblinBow: { name: "Shortbow", type: "melee", system: { damageRolls: { a: { damage: "1d6", damageType: "piercing" } }, range: { increment: 60, max: null }, traits: { value: ["deadly-d10", "reload-0"] } } },
  poisonBreath: { name: "Poison Breath", type: "action", system: { actionType: { value: "action" }, actions: { value: 2 }, category: "offensive", slug: null, traits: { value: ["poison", "primal"] }, description: { value: "<p>The dragon breathes a toxic cloud that deals @Damage[9d6[poison]|options:area-damage] damage in a @Template[cone|distance:40] (@Check[fortitude|dc:25|basic|options:area-effect] save).</p>" } } },
  regeneration: { name: "Regeneration 20", type: "action", system: { actionType: { value: "passive" }, actions: { value: null }, category: "defensive", slug: "regeneration", traits: { value: [] }, description: { value: "" } } },
  scroll: { name: "Scroll of Fireball", type: "consumable", system: { category: "scroll", traits: { value: ["consumable", "magical", "scroll"] }, spell: null } },
};
F.scroll.system.spell = { ...F.fireball, system: { ...F.fireball.system, location: { heightenedLevel: 5 } } };

const CASES = [
  ["Fireball", F.fireball, { castRank: 3 }, { kind: "area", func: "harm", material: "fire", "area.shape": "burst", "area.r": 4, mode: "save", rank: 3, tradition: "arcane" }],
  ["Fireball cast by a primal caster", F.fireball, { casting: { tradition: "primal" } }, { tradition: "primal" }],
  ["Lightning Bolt", F.lightningBolt, {}, { kind: "area", material: "electricity", "area.shape": "line", "area.len": 24, "area.width": 1 }],
  ["Electric Arc", F.electricArc, { actorLevel: 7 }, { kind: "save", func: "harm", material: "electricity", rank: 4, mode: "save" }],
  ["Force Barrage", F.forceBarrage, {}, { kind: "auto", func: "harm", material: "force", mode: null }],
  ["Heal (no template from the text)", F.heal, {}, { func: "restore", material: "vitality", area: null }],
  ["Heal on an undead", F.heal, { targetUndead: true }, { func: "harm", material: "vitality" }],
  ["Harm (vs. Undead)", F.harmVsUndead, {}, { func: "restore", material: "void" }],
  ["Haste", F.haste, {}, { func: "movement", material: "air" }],
  ["Shield", F.shield, {}, { func: "protect", material: "force", kind: "self" }],
  ["Fire Ray (spell attack)", F.fireRay, { castRank: 2 }, { kind: "attack", func: "harm", material: "fire", mode: "attack", rank: 2 }],
  ["Flaming longsword", F.longsword, {}, { kind: "strike", "weapon.style": "slash", material: "fire", mode: "attack" }],
  ["Shortbow", F.shortbow, {}, { "weapon.style": "ranged", "weapon.ranged": true, material: "kinetic" }],
  ["Javelin", F.javelin, {}, { "weapon.style": "thrown" }],
  ["Dagger in melee", F.dagger, { ranged: false }, { "weapon.style": "pierce", material: "cold" }],
  ["Dagger thrown", F.dagger, { ranged: true }, { "weapon.style": "thrown" }],
  ["Alchemist's fire", F.alchemistsFire, {}, { kind: "strike", "weapon.style": "thrown", "weapon.splash": true, material: "fire", "area.shape": "burst" }],
  ["Healing potion", F.healingPotion, {}, { kind: "self", func: "restore", material: "vitality" }],
  ["Rations", F.rations, {}, { silent: "gear" }],
  ["Wolf jaws", F.wolfJaws, {}, { kind: "strike", "weapon.style": "bite", material: "kinetic" }],
  ["Troll claw", F.trollClaw, {}, { "weapon.style": "claw" }],
  ["Dragon jaws (poison partial)", F.dragonJaws, {}, { "weapon.style": "bite", material: "poison" }],
  ["Dragon tail", F.dragonTail, {}, { "weapon.style": "bludgeon" }],
  ["Goblin shortbow (NPC)", F.goblinBow, {}, { "weapon.style": "ranged", "weapon.ranged": true }],
  ["Poison Breath", F.poisonBreath, { actorLevel: 8 }, { kind: "area", func: "harm", material: "poison", "area.shape": "cone", "area.len": 8, tradition: "primal", silent: null }],
  ["Regeneration (passive)", F.regeneration, {}, { silent: "passive" }],
  ["Scroll of Fireball", F.scroll, {}, { kind: "area", material: "fire", rank: 5 }],
];
for (const [label, doc, opts, want] of CASES) expect(label, describeItem(doc, opts), want);

expect("Demoralize", describeSkillAction("demoralize", ["auditory", "concentrate", "emotion", "fear", "mental"]), { func: "hinder", material: "mental", kind: "attack", mode: "attack" });
expect("Trip", describeSkillAction("trip", ["attack"]), { func: "control", kind: "attack" });
expect("Grapple", describeSkillAction("grapple", ["attack"]), { func: "control", kind: "attack" });
expect("Hide (secret)", describeSkillAction("hide", []), { silent: "secret" });
expect("Recall Knowledge", describeSkillAction("recall-knowledge", []), { silent: "no-visual" });
expect("Frightened 2", describeCondition("frightened", { value: 2 }), { kind: "condition", material: "mental", "condition.slug": "frightened", "condition.value": 2 });
expect("Persistent fire", describeCondition("persistent-damage", { damageType: "fire" }), { material: "fire", "condition.damageType": "fire" });
expect("Persistent bleed", describeCondition("persistent-damage", { damageType: "bleed" }), { material: "kinetic", "condition.damageType": "bleed" });
expect("Hidden (a detection state)", describeCondition("hidden"), { silent: "state" });
expect("Friendly (an attitude)", describeCondition("friendly"), { silent: "state" });
expect("Bleed tick", describeTick("bleed"), { kind: "tick", func: "harm", material: "kinetic" });
expect("Acid tick", describeTick("acid"), { kind: "tick", material: "acid" });

/* ── helpers ─────────────────────────────────────────────────────────── */

expect("@Template cone", inlineTemplate("@Template[cone|distance:40]"), { shape: "cone", len: 8 });
expect("@Template legacy line", inlineTemplate("@Template[type:line|distance:30|width:10]"), { shape: "line", len: 6, width: 2 });
expect("@Template emanation", inlineTemplate("x @Template[emanation|distance:10] y"), { shape: "emanation", r: 2 });
expect("@Damage persistent", inlineDamage("@Damage[(2d6+4)[persistent,fire]]")[0], { type: "fire", persistent: true });
expect("@Damage healing", { has: inlineDamage("@Damage[2d8[healing]]")[0]?.kinds.has("healing") }, { has: true });
expect("Runes", { r: runeMaterials({ system: { runes: { property: ["greaterShock", "ghostTouch"] } } }).join(",") }, { r: "electricity,spirit" });
// weight: a two-handed weapon swings heavy; a one-hander and a bow never do
expect("Greatsword heavy", weaponStyleOf({ name: "Greatsword", type: "weapon", system: { group: "sword", usage: { value: "held-in-two-hands" }, damage: { damageType: "slashing" }, traits: { value: ["versatile-p"] } } }), { style: "slash", heavy: true });
expect("Bastard sword two-hand trait heavy", weaponStyleOf({ name: "Bastard Sword", type: "weapon", system: { group: "sword", usage: { value: "held-in-one-hand" }, damage: { damageType: "slashing" }, traits: { value: ["two-hand-d12"] } } }), { heavy: true });
expect("Longsword not heavy", weaponStyleOf(F.longsword), { style: "slash", heavy: false });
expect("Shortbow not heavy", weaponStyleOf(F.shortbow), { ranged: true, heavy: false });
// medicine is a craft: drawn as a kit, never as a spell
expect("Battle Medicine craft", describeSkillAction("battle-medicine", ["healing", "manipulate"]), { func: "restore", craft: "medicine" });
expect("Treat Wounds craft", describeItem({ type: "action", name: "Treat Wounds", system: { slug: "treat-wounds", actionType: { value: "action" }, traits: { value: ["exploration", "healing", "manipulate"] } } }), { craft: "medicine" });
expect("Lay on Hands is not a craft", describeItem({ type: "spell", name: "Lay on Hands", system: { slug: "lay-on-hands", level: { value: 1 }, traits: { value: ["focus", "healing", "vitality"] } } }), { func: "restore", craft: null });
// a creature's Power Attack card is the Strike's announcement: the Strike plays
expect("NPC Power Attack silent", describeItem({ type: "action", name: "Power Attack", system: { slug: "power-attack", actionType: { value: "action" }, actions: { value: 2 }, traits: { value: ["flourish"] } } }), { silent: "strike-plays" });
expect("NPC Vicious Swing silent", describeItem({ type: "action", name: "Vicious Swing", system: { slug: "vicious-swing", actionType: { value: "action" }, actions: { value: 2 }, traits: { value: ["flourish"] } } }), { silent: "strike-plays" });
expect("Unarmed fist", weaponStyleOf({ name: "Fist", type: "weapon", system: { damage: { damageType: "bludgeoning" }, traits: { value: ["agile", "finesse", "nonlethal", "unarmed"] } } }), { style: "unarmed" });

/* ── outcomes ────────────────────────────────────────────────────────── */

const OUT = [
  ["criticalSuccess", "attack", "crit"], ["success", "attack", "hit"], ["failure", "attack", "miss"], ["criticalFailure", "attack", "miss"],
  ["criticalFailure", "save", "crit"], ["failure", "save", "hit"], ["success", "save", "miss"], ["criticalSuccess", "save", "miss"],
  [3, "attack", "crit"], [0, "save", "crit"], [null, "attack", "neutral"], [undefined, "save", "neutral"], ["junk", "attack", "neutral"], ["success", null, "neutral"],
];
for (const [d, m, want] of OUT) expect(`outcome ${d}/${m}`, { o: outcomeFrom(d, m) }, { o: want });

/* ── robustness: junk never throws, and stays in vocabulary ──────────── */

const JUNK = [null, undefined, 0, "", "fireball", [], {}, { type: "spell" }, { type: "spell", system: null }, { type: "weapon", system: { damage: 5, runes: { property: "flaming" } } },
  { type: "melee", system: { damageRolls: null, range: 7 } }, { type: "action", system: { description: { value: "@Damage[[[[" } } }, { type: "consumable", system: { spell: { type: "spell" } } },
  { type: "spell", system: { area: { type: "hexagon", value: "far" }, damage: { x: null, y: { type: 3 } }, traits: { value: "fire" } } },
  { type: "feat", name: "Burning ☃ Cold", system: { actionType: { value: "action" }, traits: { value: [null, 3, "fire"] } } }];
const ROLLS = [{}, { castRank: "x" }, { actorLevel: -4 }, { targetUndead: 1, ranged: "yes" }, { casting: { tradition: "nonsense" } }];
for (const [i, j] of JUNK.entries()) for (const o of ROLLS) {
  let r;
  try { r = describeItem(j, o); } catch (e) { fails.push(`junk #${i} threw: ${e.message}`); continue; }
  const bad = [];
  if (!DELIVERIES.includes(r.kind)) bad.push(`kind ${r.kind}`);
  if (!FUNCTIONS.includes(r.func)) bad.push(`func ${r.func}`);
  if (!MATERIALS.includes(r.material)) bad.push(`material ${r.material}`);
  if (r.accent != null && !MATERIALS.includes(r.accent)) bad.push(`accent ${r.accent}`);
  if (r.tradition != null && !TRADITIONS.includes(r.tradition)) bad.push(`tradition ${r.tradition}`);
  if (r.weapon && !WEAPON_STYLES.includes(r.weapon.style)) bad.push(`style ${r.weapon.style}`);
  if (!(r.rank >= 1 && r.rank <= 10)) bad.push(`rank ${r.rank}`);
  if (bad.length) fails.push(`junk #${i}: ${bad.join(", ")}`); else passed++;
}
for (const s of [null, "", "nonsense", "persistent-damage", "stunned", 42]) {
  try { const r = describeCondition(s, { value: "x" }); if (!MATERIALS.includes(r.material)) fails.push(`condition ${s}: material ${r.material}`); else passed++; }
  catch (e) { fails.push(`condition ${s} threw: ${e.message}`); }
}

/* ── the real packs, when installed ──────────────────────────────────── */

let spotNote = "packs not installed: real-data spot checks skipped";
try {
  const cov = await import("./fx-coverage.mjs");
  if (existsSync(cov.DEFAULT_PACKS)) {
    const packs = new Map();
    for (const p of new Set(cov.SPOT_CHECKS.map((s) => s.pack))) packs.set(p, await cov.loadPack(`${cov.DEFAULT_PACKS}/${p}`));
    let n = 0;
    for (const spot of cov.SPOT_CHECKS) {
      const r = cov.runSpot(spot, packs);
      if (r.missing) { if (!spot.optional) fails.push(`pack spot ${spot.label}: not found`); continue; }
      n++;
      if (r.fails.length) fails.push(`pack spot ${spot.label}: ${r.fails.join("; ")}`); else passed++;
    }
    spotNote = `${n} real-data spot checks`;
  }
} catch (e) {
  spotNote = `real-data spot checks unavailable (${e.message})`;
}

if (fails.length) {
  console.error(`fx-semantics-check: ${fails.length} failure(s), ${passed} passed; ${spotNote}`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`fx-semantics-check: ${passed} passed, 0 failures; ${spotNote}`);
