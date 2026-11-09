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
  describeItem, describeBlast, describeCondition, describeSkillAction, describeTick, outcomeFrom,
  weaponStyleOf, inlineTemplate, inlineDamage, runeMaterials,
} from "../scripts/features/pf2e-fx/semantics.mjs";
import { HANDOFF_ARCHES, Riders, limbOf } from "../scripts/features/pf2e-fx/handoff.mjs";
import { FUNCTIONS, MATERIALS, WEAPON_STYLES, DELIVERIES, TRADITIONS, DELIVERY_VOCAB, MOTIF_VOCAB, PROP_VOCAB, FLAVOR_VOCAB } from "../scripts/features/pf2e-fx/constants.mjs";

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

/* ── the look axes: the name shapes, the damage colours ──────────────── */

const wpn = (name, group, damageType, { range = null, traits = [], baseItem = null, usage = "held-in-one-hand" } = {}) =>
  ({ name, type: "weapon", system: { baseItem, group, range, usage: { value: usage }, damage: { damageType, dice: 1, die: "d6" }, runes: { property: [] }, traits: { value: traits } } });
const npc = (name, damage, { range = null, traits = [] } = {}) =>
  ({ name, type: "melee", system: { damageRolls: Object.fromEntries(damage.map((d, i) => [`d${i}`, { damage: "2d6", damageType: d }])), range, traits: { value: traits } } });
const act = (name, slug, traits, extra = {}) => ({ name, type: "action", system: { slug, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: traits }, description: { value: "" }, ...extra } });
const LOOK = [
  // PF2e firearms, crossbows, slings: never an arrow
  ["Arquebus", wpn("Arquebus", "firearm", "piercing", { range: 150, baseItem: "arquebus", traits: ["concussive", "fatal-d12", "kickback"], usage: "held-in-two-hands" }), {}, { delivery: "bullet", "weapon.style": "ranged" }],
  ["Flintlock Pistol", wpn("Flintlock Pistol", "firearm", "piercing", { range: 40, baseItem: "flintlock-pistol", traits: ["concussive", "fatal-d8"] }), {}, { delivery: "bullet" }],
  ["Blunderbuss (scatter)", wpn("Blunderbuss", "firearm", "piercing", { range: 40, baseItem: "blunderbuss", traits: ["concussive", "scatter-10"] }), {}, { delivery: "pellets" }],
  ["Crossbow", wpn("Crossbow", "crossbow", "piercing", { range: 120, baseItem: "crossbow" }), {}, { delivery: "bolt", motif: "arrow" }],
  ["Sling", wpn("Sling", "sling", "bludgeoning", { range: 50, baseItem: "sling", traits: ["propulsive"] }), {}, { delivery: "stone" }],
  ["NPC Pistol (no group)", npc("Pistol", ["piercing"], { range: { increment: 40 }, traits: ["concussive"] }), {}, { delivery: "bullet" }],
  // SF2e weapon groups
  ["SF2e Laser Pistol", wpn("Laser Pistol", "laser", "fire", { range: 60, baseItem: "laser-pistol", traits: ["tech"] }), {}, { delivery: "laser", "weapon.ranged": true, material: "fire" }],
  ["SF2e Plasma Cannon", wpn("Plasma Cannon", "plasma", "electricity", { range: 60, traits: ["tech", "area-line"], usage: "held-in-two-hands" }), {}, { delivery: "plasma", "weapon.ranged": true }],
  ["SF2e Autotarget Rifle", wpn("Autotarget Rifle", "projectile", "piercing", { range: 60, traits: ["automatic", "tech"], usage: "held-in-two-hands" }), {}, { delivery: "bullet" }],
  ["SF2e Shirren-eye Rifle", wpn("Shirren-eye Rifle", "sniper", "piercing", { range: 120, traits: ["tech", "unwieldy"], usage: "held-in-two-hands" }), {}, { delivery: "slug" }],
  ["SF2e Scattergun (area-cone)", wpn("Scattergun", "projectile", "piercing", { range: 30, traits: ["area-cone", "tech"], usage: "held-in-two-hands" }), {}, { delivery: "pellets" }],
  ["SF2e Frag Grenade", wpn("Frag Grenade", "grenade", "piercing", { range: 30, baseItem: "grenade", traits: ["area-burst-10", "consumable", "tech"] }), {}, { delivery: "grenade" }],
  ["SF2e Flamethrower", wpn("Flamethrower", "flame", "fire", { range: 30, traits: ["area-line", "tech"], usage: "held-in-two-hands" }), {}, { delivery: "jet", material: "fire" }],
  ["SF2e Arc Pistol", wpn("Arc Pistol", "shock", "electricity", { range: 40, traits: ["tech"] }), {}, { delivery: "zap" }],
  ["SF2e Sonic Rifle", wpn("Sonic Rifle", "sonic", "sonic", { range: 60, traits: ["tech"], usage: "held-in-two-hands" }), {}, { delivery: "sonicwave" }],
  ["SF2e Zero Cannon", wpn("Zero Cannon", "cryo", "cold", { range: 60, traits: ["tech", "area-line"], usage: "held-in-two-hands" }), {}, { delivery: "jet", material: "cold" }],
  ["SF2e creature: Aeon Rifle via its linked laser", npc("Aeon Rifle", ["fire"], { range: { increment: 100 } }), { weapon: wpn("Aeon Rifle", "laser", "fire", { range: 100 }) }, { delivery: "laser" }],
  // natural attacks
  ["Wolf Jaws", npc("Wolf Jaws", ["piercing"], { traits: ["unarmed"] }), {}, { delivery: "jaws" }],
  ["Troll Claw", F.trollClaw, {}, { delivery: "rake", motif: "claw" }],
  ["Dragon Tail", F.dragonTail, {}, { delivery: "lash" }],
  ["Horn", npc("Horn", ["piercing"], { traits: ["unarmed"] }), {}, { delivery: "gore" }],
  ["Stinger", npc("Stinger", ["piercing", "poison"], { traits: ["unarmed"] }), {}, { delivery: "sting" }],
  ["Wing", npc("Wing", ["bludgeoning"], { traits: ["reach-15"] }), {}, { delivery: "buffet" }],
  ["Breath Weapon", F.poisonBreath, {}, { delivery: "breath" }],
  ["Breath Weapon (named)", { ...F.poisonBreath, name: "Breath Weapon" }, {}, { delivery: "breath", motif: null }],
  // spells
  ["Fireball", F.fireball, {}, { delivery: "lob" }],
  ["Meteor Swarm", spell("Meteor Swarm", "meteor-swarm", { area: { type: "burst", value: 40 }, damage: { 0: { formula: "6d10", kinds: ["damage"], type: "fire" } }, defense: { save: { basic: true, statistic: "reflex" } }, level: { value: 9 }, range: { value: "500 feet" }, traits: { traditions: ["arcane", "primal"], value: ["concentrate", "fire", "manipulate"] } }), {}, { delivery: "fall", motif: "comet" }],
  ["Force Barrage", F.forceBarrage, {}, { delivery: "darts" }],
  ["Chain Lightning", spell("Chain Lightning", "chain-lightning", { damage: { 0: { formula: "8d12", kinds: ["damage"], type: "electricity" } }, defense: { save: { basic: true, statistic: "reflex" } }, level: { value: 6 }, range: { value: "500 feet" }, target: { value: "1 creature, plus any number of additional creatures" }, traits: { traditions: ["arcane", "primal"], value: ["concentrate", "electricity", "manipulate"] } }), {}, { motif: "chain", material: "electricity" }],
  ["Spiritual Armament", spell("Spiritual Armament", "spiritual-armament", { damage: { 0: { formula: "2d8", kinds: ["damage"], type: "spirit" } }, defense: { passive: { statistic: "ac" } }, level: { value: 2 }, range: { value: "120 feet" }, target: { value: "1 creature" }, traits: { traditions: ["divine", "occult"], value: ["attack", "concentrate", "manipulate", "sanctified", "spirit"] } }), {}, { motif: "weapon" }],
  ["Hydraulic Push", spell("Hydraulic Push", "hydraulic-push", { damage: { 0: { formula: "3d6", kinds: ["damage"], type: "bludgeoning" } }, defense: { passive: { statistic: "ac" } }, range: { value: "60 feet" }, target: { value: "1 creature" }, traits: { traditions: ["arcane", "primal"], value: ["attack", "concentrate", "manipulate", "water"] } }), {}, { motif: "wave", delivery: "ray" }],
  // class features and actions
  ["Flurry of Blows", act("Flurry of Blows", "flurry-of-blows", ["flourish", "monk"]), {}, { flavor: "flurry" }],
  ["Kineticist impulse", { ...act("Ocean's Balm", "oceans-balm", ["healing", "impulse", "kineticist", "manipulate", "water"]), type: "feat" }, {}, { flavor: "impulse" }],
  ["Rage", act("Rage", "rage", ["barbarian", "concentrate", "emotion", "mental"]), {}, { flavor: "rage" }],
  // the damage colours, the name accents; a purely physical blow yields to the named element
  ["Frost Claw dealing fire", npc("Frost Claw", ["fire"], { traits: ["unarmed"] }), {}, { material: "fire", accent: "cold", delivery: "rake" }],
  ["Ice Claw dealing slashing", npc("Ice Claw", ["slashing"], { traits: ["unarmed"] }), {}, { material: "cold", delivery: "rake" }],
  ["Stone Fist", npc("Stone Fist", ["bludgeoning"]), {}, { material: "earth", delivery: "slam" }],
  ["Cold Iron Dagger stays kinetic", wpn("Cold Iron Dagger", "knife", "piercing", { baseItem: "dagger" }), {}, { material: "kinetic", delivery: "stab" }],
  ["Light Hammer stays kinetic", wpn("Light Hammer", "hammer", "bludgeoning", { baseItem: "light-hammer" }), {}, { material: "kinetic" }],
];
for (const [label, doc, opts, want] of LOOK) expect(label, describeItem(doc, opts), want);

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
// an Elemental Blast is described from the choice in context.identifier, not the impulse
const BLAST = { type: "action", name: "Elemental Blast", system: { slug: "elemental-blast", actionType: { value: "action" }, traits: { value: ["attack", "impulse", "kineticist", "primal"] } } };
expect("Blast air+electricity is lightning", describeBlast(BLAST, { element: "air", damageType: "electricity", melee: false }), { kind: "attack", func: "harm", material: "electricity", delivery: "orb" });
expect("Blast air+slashing keeps the element", describeBlast(BLAST, { element: "air", damageType: "slashing", melee: true }), { func: "harm", material: "air", delivery: "touch" });
expect("Blast metal+piercing", describeBlast(BLAST, { element: "metal", damageType: "piercing" }), { material: "metal" });
expect("Blast fire", describeBlast(BLAST, { element: "fire", damageType: "fire" }), { material: "fire", silent: null });
expect("Blast element from traits", describeBlast({ ...BLAST, system: { ...BLAST.system, traits: { value: ["impulse", "water"] } } }, { damageType: "bludgeoning" }), { material: "water" });
// archetypes: a silent costed action an archetype rescues plays it; a damaging spell keeps its delivery
expect("Mighty Rage rescued as rage", describeItem({ type: "feat", name: "Mighty Rage", system: { slug: "mighty-rage", actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["barbarian", "rage"] } } }), { silent: null, arch: "rage", func: "support" });
expect("Pounce rescued as charge", describeItem({ type: "action", name: "Pounce", system: { slug: "pounce", actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["flourish"] } } }), { silent: null, arch: "charge" });
expect("Fire harm spell keeps its delivery", describeItem({ type: "spell", name: "Ignition", system: { slug: "ignition", level: { value: 1 }, damage: { 0: { formula: "2d4", type: "fire" } }, traits: { value: ["attack", "cantrip", "fire"] } } }), { func: "harm", arch: null });
expect("Healing Potion drinks", describeItem({ type: "consumable", name: "Healing Potion (Minor)", system: { slug: "healing-potion-minor", category: "potion", damage: { formula: "1d8", type: "vitality", kind: "healing" }, traits: { value: ["consumable", "healing", "magical", "potion", "vitality"] } } }), { arch: "drink" });
expect("Demoralize is fear", describeSkillAction("demoralize", ["auditory", "concentrate", "emotion", "fear", "mental"]), { arch: "fear" });
// a creature's Power Attack card is the Strike's announcement: the Strike plays
expect("NPC Power Attack silent", describeItem({ type: "action", name: "Power Attack", system: { slug: "power-attack", actionType: { value: "action" }, actions: { value: 2 }, traits: { value: ["flourish"] } } }), { silent: "strike-plays" });
expect("NPC Vicious Swing silent", describeItem({ type: "action", name: "Vicious Swing", system: { slug: "vicious-swing", actionType: { value: "action" }, actions: { value: 2 }, traits: { value: ["flourish"] } } }), { silent: "strike-plays" });
expect("Unarmed fist", weaponStyleOf({ name: "Fist", type: "weapon", system: { damage: { damageType: "bludgeoning" }, traits: { value: ["agile", "finesse", "nonlethal", "unarmed"] } } }), { style: "unarmed" });

/* ── archetype routing: the P1 archetypes (catalogue §4 rows 12–20) and their collisions ── */

const ab = (name, slug, traits, { act = "action", category = null, damage = null, area = null, defense = null } = {}) => ({ name, type: "action", system: { slug, actionType: { value: act }, actions: { value: act === "action" ? 1 : null }, category, traits: { value: traits }, defense, area, description: { value: damage ? `<p>@Damage[${damage}]</p>` : "" } } });
const featCost = (name, slug, traits = []) => ({ name, type: "feat", system: { slug, actionType: { value: "reaction" }, traits: { value: traits }, description: { value: "" } } });
const ARCHS = [
  // polymorph · teleport · haste · fly
  ["Humanoid Form is a polymorph", spell("Humanoid Form", "humanoid-form", { level: { value: 2 }, traits: { value: ["concentrate", "manipulate", "polymorph"] } }), { func: "transform", arch: "polymorph" }],
  ["Change Shape (creature) is a polymorph", ab("Change Shape", "change-shape", ["concentrate", "polymorph"]), { arch: "polymorph" }],
  ["Translocate folds", spell("Translocate", "translocate", { level: { value: 4 }, range: { value: "120 feet" }, traits: { value: ["concentrate", "manipulate", "teleportation"] } }), { func: "teleport", arch: "teleport" }],
  ["Haste hastes", F.haste, { func: "movement", arch: "haste" }],
  ["Fly flies", spell("Fly", "fly", { level: { value: 4 }, range: { value: "touch" }, target: { value: "1 creature" }, traits: { value: ["concentrate", "manipulate"] } }), { func: "movement", arch: "fly" }],
  ["Spider Climb is no haste", spell("Spider Climb", "spider-climb", { level: { value: 2 }, range: { value: "touch" }, target: { value: "1 creature" }, traits: { value: ["concentrate", "manipulate"] } }), { func: "movement", arch: null }],
  ["Flyby Attack does not fly", ab("Flyby Attack", "flyby-attack", [], { category: "offensive" }), { arch: "hex" }],
  // ward: Shield, Shield Block, dodge, counterspell; a shield Strike and a riposte by heading alone are not wards
  ["Shield wards", F.shield, { func: "protect", arch: "ward" }],
  ["Shield Block wards", ab("Shield Block", "shield-block", [], { act: "reaction", category: "defensive" }), { func: "protect", arch: "ward" }],
  ["Nimble Dodge wards", ab("Nimble Dodge", "nimble-dodge", [], { act: "reaction", category: "defensive" }), { arch: "ward" }],
  ["Counterspell wards (never a dispel)", ab("Counterspell", null, [], { act: "reaction", category: "defensive" }), { arch: "ward" }],
  ["a defensive retort is no ward", ab("Cutting Rebuke", null, [], { act: "reaction", category: "defensive" }), { func: "protect", arch: null }],
  ["a shield Strike plays its Strike", npc("Shield Bash", ["bludgeoning"]), { kind: "strike", arch: null }],
  ["Shield Bash, the action, is harm and keeps its blow", ab("Shield Bash", "shield-bash", ["attack"], { category: "offensive", damage: "2d6[bludgeoning]" }), { func: "harm", arch: null }],
  ["Dodge Away (silent) is rescued as a ward", featCost("Dodge Away", "dodge-away"), { silent: null, arch: "ward", func: "protect", material: "force" }],
  // dispel
  ["Dispel Magic unweaves", spell("Dispel Magic", "dispel-magic", { level: { value: 2 }, range: { value: "120 feet" }, target: { value: "1 spell effect or unattended magic item" }, traits: { value: ["concentrate", "manipulate"] } }), { func: "control", arch: "dispel" }],
  ["Dispelling Globe stays a terrain", spell("Dispelling Globe", "dispelling-globe", { area: { type: "emanation", value: 10 }, level: { value: 5 }, traits: { value: ["abjuration", "concentrate", "manipulate"] } }), { arch: null }],
  // detect: the sweep, never Seek (secret) or a mark
  ["Detect Magic sweeps", spell("Detect Magic", "detect-magic", { area: { type: "emanation", value: 30 }, traits: { value: ["cantrip", "concentrate", "detection", "manipulate"] } }), { func: "detect", arch: "detect" }],
  // conceal: a veil, a darkness, a blur; Invisibility stays vanish, a phantom sound and a fear stay generic
  ["Darkness veils", spell("Darkness", "darkness", { area: { type: "burst", value: 20 }, level: { value: 2 }, range: { value: "120 feet" }, traits: { value: ["concentrate", "darkness", "manipulate"] } }), { arch: "conceal" }],
  ["Figment veils", spell("Figment", "figment", { range: { value: "30 feet" }, traits: { value: ["cantrip", "concentrate", "illusion", "manipulate", "subtle"] } }), { func: "conceal", arch: "conceal" }],
  ["Blur veils", spell("Blur", "blur", { level: { value: 2 }, range: { value: "touch" }, target: { value: "1 creature" }, traits: { value: ["concentrate", "illusion", "manipulate", "visual"] } }), { arch: "conceal" }],
  ["Invisibility stays vanish", spell("Invisibility", "invisibility", { level: { value: 2 }, range: { value: "touch" }, target: { value: "1 creature" }, traits: { value: ["concentrate", "illusion", "manipulate", "subtle"] } }), { arch: "vanish" }],
  ["Disappearance vanishes", spell("Disappearance", "disappearance", { level: { value: 8 }, range: { value: "touch" }, target: { value: "1 creature" }, traits: { value: ["illusion", "manipulate", "subtle"] } }), { arch: "vanish" }],
  ["Ghost Sound is only a sound", spell("Ghost Sound", "ghost-sound", { range: { value: "30 feet" }, traits: { value: ["auditory", "cantrip", "concentrate", "illusion", "manipulate"] } }), { func: "conceal", arch: null }],
  ["Darkvision Elixir is drunk", { name: "Darkvision Elixir (Lesser)", type: "consumable", system: { slug: "darkvision-elixir-lesser", category: "elixir", traits: { value: ["alchemical", "consumable", "elixir"] } } }, { arch: "drink" }],
  // drain: feed, affliction seep, poison apply; a bite keeps its jaws, a cloud its area
  ["Drink Blood drains", ab("Drink Blood", "drink-blood", ["divine"], { category: "offensive", damage: "3d6[healing]" }), { func: "restore", arch: "drain" }],
  ["Ghoul Fever seeps", ab("Ghoul Fever", "ghoul-fever", ["disease"], { act: "passive", category: "offensive", damage: "1d6[void]" }), { func: "harm", arch: "drain" }],
  ["Blood Drain (a Strike) keeps its jaws", npc("Jaws", ["piercing"], { traits: ["unarmed"] }), { delivery: "jaws", arch: null }],
  ["a poison cloud keeps its area (no drain)", spell("Stinking Cloud", "stinking-cloud", { area: { type: "burst", value: 20 }, defense: { save: { statistic: "fortitude" } }, level: { value: 3 }, range: { value: "60 feet" }, traits: { value: ["concentrate", "manipulate", "poison"] } }), { arch: "hex" }],
  ["Drain Bonded Item is a spellshape, not a feed", ab("Drain Bonded Item", "drain-bonded-item", ["arcane", "wizard"]), { arch: null }],
  // summon
  ["Summon Animal summons", spell("Summon Animal", "summon-animal", { range: { value: "30 feet" }, traits: { value: ["concentrate", "manipulate", "summon"] } }), { func: "summon", arch: "summon" }],
];
for (const [label, doc, want] of ARCHS) expect(label, describeItem(doc), want);
expect("Seek (secret) is no detect sweep", describeSkillAction("seek", ["concentrate", "secret"]), { func: "detect", arch: null });
expect("Hunt Prey marks, it does not sweep", describeSkillAction("hunt-prey", ["concentrate", "ranger"]), { func: "detect", arch: null });

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
  if (r.delivery != null && !DELIVERY_VOCAB.includes(r.delivery)) bad.push(`delivery ${r.delivery}`);
  if (r.motif != null && !MOTIF_VOCAB.includes(r.motif)) bad.push(`motif ${r.motif}`);
  if (!Array.isArray(r.props) || r.props.some((p) => !PROP_VOCAB.includes(p))) bad.push(`props ${r.props}`);
  if (r.flavor != null && !FLAVOR_VOCAB.includes(r.flavor)) bad.push(`flavor ${r.flavor}`);
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

/* ── Strike riders (catalogue §1.1) ─────────────────────────────────────
   A melee item's system.attackEffects.value names what the hit hands over to.
   A rider read from nothing plays only the bite; one read from an affliction
   grabs someone a disease was meant to sicken. */
{
  const rid = (name, effects, damage = ["piercing"]) => ({ ...npc(name, damage), system: { ...npc(name, damage).system, attackEffects: { value: effects } } });
  const RIDERS = [
    ["Grab", rid("Jaws", ["grab"]), { kind: "strike", "rider.arch": "grab", "rider.slug": "grab" }],
    ["Improved Grab", rid("Jaws", ["improved-grab"]), { "rider.arch": "grab" }],
    ["Constrict keeps its slug (the coil variant)", rid("Body", ["constrict"], ["bludgeoning"]), { "rider.arch": "grab", "rider.slug": "constrict" }],
    ["Tongue Grab", rid("Tongue", ["tongue-grab"]), { "rider.arch": "grab" }],
    ["Knockdown", rid("Jaws", ["knockdown"]), { "rider.arch": "trip" }],
    ["Improved Knockdown", rid("Fist", ["improved-knockdown"], ["bludgeoning"]), { "rider.arch": "trip" }],
    ["Trip", rid("Tail", ["trip"], ["bludgeoning"]), { "rider.arch": "trip" }],
    ["Push", rid("Tail", ["push"], ["bludgeoning"]), { "rider.arch": "shove" }],
    ["Push 20 feet", rid("Tail", ["push-20-feet"], ["bludgeoning"]), { "rider.arch": "shove" }],
    ["Rend", rid("Claw", ["rend"], ["slashing"]), { "rider.arch": "rend" }],
    ["the first rider listed wins", rid("Jaws", ["ghoul-fever", "knockdown", "grab"]), { "rider.arch": "trip" }],
    ["a disease rides nothing", rid("Jaws", ["ghoul-fever"]), { rider: null }],
    ["Rend Faith is not a rend", rid("Hand", ["rend-faith"], ["void"]), { rider: null }],
    ["Clutching Cold is not a grab", rid("Touch", ["clutching-cold"], ["cold"]), { rider: null }],
    ["no attackEffects, no rider", npc("Jaws", ["piercing"]), { rider: null }],
    ["a malformed attackEffects never throws", { ...npc("Jaws", ["piercing"]), system: { ...npc("Jaws", ["piercing"]).system, attackEffects: "grab" } }, { kind: "strike", rider: null }],
  ];
  for (const [label, doc, want] of RIDERS) expect(`rider: ${label}`, describeItem(doc), want);
  // never off a Strike: a Grab action card plays its own archetype, not a rider
  expect("rider: only a Strike carries one", describeItem({ name: "Grab", type: "action", system: { slug: "grab", actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "" }, attackEffects: { value: ["grab"] } } }), { rider: undefined });

  /* The hand-off (handoff.mjs): the rider is never drawn on the Strike. PF2e's
     follow-up routes to the rider's own archetype and takes the Strike's body
     part: the creature's Grab / Knockdown / Push action, or the Athletics check. */
  const act = (name, slug) => ({ name, type: "action", system: { slug, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "" } } });
  const FOLLOW = [
    ["Grab action", describeItem(act("Grab", "grab"), { use: "action" }), "grab"],
    ["Improved Grab action", describeItem(act("Improved Grab", "improved-grab"), { use: "action" }), "grab"],
    ["Knockdown action", describeItem(act("Knockdown", "knockdown"), { use: "action" }), "trip"],
    ["Push action", describeItem(act("Push", "push"), { use: "action" }), "shove"],
    ["Grapple check", describeSkillAction("grapple", ["attack"]), "grab"],
    ["Trip check", describeSkillAction("trip", ["attack"]), "trip"],
    ["Shove check", describeSkillAction("shove", ["attack"]), "shove"],
  ];
  for (const [label, desc, arch] of FOLLOW) {
    expect(`handoff: ${label} routes to the rider's archetype`, desc, { arch });
    if (!HANDOFF_ARCHES.has(desc.arch)) fails.push(`handoff: ${label} routes to ${desc.arch}, which takes no body part`); else passed++;
  }
  const tongue = describeItem(rid("Tongue", ["tongue-grab"]), { use: "strike" });
  const limb = limbOf(tongue, "tongue");
  expect("handoff: a tongue Strike's body part", limb, { delivery: tongue.delivery, slug: "tongue", rider: "tongue-grab" });
  const R = new Riders({ window: 12 });
  R.note("tok", { rider: tongue.rider, limb, outcome: "hit", target: "vic", at: 0 });
  if (R.take("tok", FOLLOW[4][1].arch, { at: 8, targets: ["vic"] }) !== limb) fails.push("handoff: a Grapple 8 s after a tongue grab hit did not take the tongue"); else passed++;
  R.note("tok", { rider: tongue.rider, limb, outcome: "hit", at: 0 });
  if (R.take("tok", FOLLOW[5][1].arch, { at: 1 }) !== null) fails.push("handoff: a Trip took a tongue grab's body part"); else passed++;
  if (R.take("tok", "grab", { at: 13 }) !== null) fails.push("handoff: a Grapple 13 s later took the body part (past the 12 s window)"); else passed++;
  if (R.take("other", "grab", { at: 1 }) !== null) fails.push("handoff: a token that never struck took a body part"); else passed++;
}

/* The same against the real packs: a wolf's jaws knock down, a crocodile's grab,
   a dire wolf's do both (Grab is listed first), a giant frog's tongue grabs, and
   a living wildfire's tendril burns with no rider at all. */
let riderNote = "";
try {
  const cov = await import("./fx-coverage.mjs");
  if (existsSync(cov.DEFAULT_PACKS)) {
    const SPOTS = [
      { label: "Wolf jaws", pack: "pathfinder-monster-core", actor: "Wolf", name: "Jaws", type: "melee", expect: { kind: "strike", delivery: "jaws", "rider.arch": "trip", "rider.slug": "knockdown" } },
      { label: "Crocodile jaws", pack: "pathfinder-monster-core", actor: "Crocodile", name: "Jaws", type: "melee", expect: { kind: "strike", delivery: "jaws", "rider.arch": "grab" } },
      { label: "Dire Wolf jaws", pack: "pathfinder-monster-core", actor: "Dire Wolf", name: "Jaws", type: "melee", expect: { "rider.arch": "grab" } },
      { label: "Giant Anaconda tail", pack: "pathfinder-monster-core", actor: "Giant Anaconda", name: "Tail", type: "melee", expect: { "rider.arch": "shove" } },
      { label: "Giant Frog tongue", pack: "pathfinder-monster-core-2", actor: "Giant Frog", name: "Tongue", type: "melee", expect: { "rider.arch": "grab", "rider.slug": "tongue-grab" } },
      { label: "Living Wildfire tendril", pack: "pathfinder-monster-core", actor: "Living Wildfire", name: "Tendril", type: "melee", expect: { material: "fire", rider: null } },
      { label: "Crocodile tail", pack: "pathfinder-monster-core", actor: "Crocodile", name: "Tail", type: "melee", expect: { rider: null } },
    ];
    const packs = new Map();
    for (const p of new Set(SPOTS.map((s) => s.pack))) packs.set(p, await cov.loadPack(`${cov.DEFAULT_PACKS}/${p}`));
    let n = 0;
    for (const spot of SPOTS) {
      const r = cov.runSpot(spot, packs);
      if (r.missing) { fails.push(`rider spot ${spot.label}: not found`); continue; }
      n++;
      if (r.fails.length) fails.push(`rider spot ${spot.label}: ${r.fails.join("; ")}`); else passed++;
    }
    riderNote = `, ${n} real-data rider checks`;
  }
} catch (e) {
  riderNote = `, real-data rider checks unavailable (${e.message})`;
}
spotNote += riderNote;

if (fails.length) {
  console.error(`fx-semantics-check: ${fails.length} failure(s), ${passed} passed; ${spotNote}`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`fx-semantics-check: ${passed} passed, 0 failures; ${spotNote}`);
