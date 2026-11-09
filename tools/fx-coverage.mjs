#!/usr/bin/env node
/**
 * Spellsprite coverage: run semantics.mjs over every relevant document in the
 * REAL PF2e compendium packs and report what each resolves to.
 *
 *   node tools/fx-coverage.mjs [--packs=<dir>] [--quiet]
 *
 * Writes docs/SPELLSPRITE_COVERAGE.md (summary + residue) and
 * .preview/fx-coverage.json (every document). Reads the LevelDB packs with
 * Foundry's own classic-level, from a copy of each pack (Foundry may hold the
 * LOCK while it runs).
 *
 * Exports `loadPack`, `walkPacks` and `SPOT_CHECKS` for tools/fx-semantics-check.mjs.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describeItem, describeCondition, describeSkillAction } from "../scripts/features/pf2e-fx/semantics.mjs";
import { FAMILY_OF } from "../scripts/features/pf2e-fx/constants.mjs";
import { BASE_GROUP } from "../scripts/features/pf2e-fx/depict.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The first install that exists: Windows, then Linux (Foundry's default data and app folders).
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";
const firstOf = (...paths) => paths.find((p) => existsSync(p)) ?? paths[0];
export const DEFAULT_PACKS = firstOf(
  "C:/Users/frostnoxia/AppData/Local/FoundryVTT/Data/systems/pf2e/packs",
  join(HOME, ".local/share/FoundryVTT/Data/systems/pf2e/packs"),
);
const CLASSIC_LEVEL = firstOf(
  "C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/classic-level/index.js",
  join(HOME, "foundryvtt/resources/app/node_modules/classic-level/index.js"),
);

let ClassicLevel = null;
async function classicLevel() {
  if (ClassicLevel) return ClassicLevel;
  ({ ClassicLevel } = await import(pathToFileURL(CLASSIC_LEVEL).href));
  return ClassicLevel;
}

/** Every key → JSON value of one pack, read from a temp copy. */
export async function loadPack(dir) {
  const CL = await classicLevel();
  const tmp = mkdtempSync(join(tmpdir(), "fxcov-"));
  try {
    cpSync(dir, tmp, { recursive: true });
    rmSync(join(tmp, "LOCK"), { force: true });
    const db = new CL(tmp, { valueEncoding: "json" });
    const out = new Map();
    try {
      for await (const [k, v] of db.iterator()) out.set(k, v);
    } finally {
      await db.close();
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Every pack is walked: any pack holding actors yields their embedded items,
 * any pack holding items yields those. Packs of effects, journals, macros and
 * tables hold nothing that plays and evaluate to nothing.
 */
const SKIP_PACKS = new Set(["bestiary-effects", "equipment-effects", "feat-effects", "spell-effects", "other-effects", "campaign-effects"]);

/** Embedded items of an actor in pack data. */
function embedded(all, actor) {
  return (actor.items ?? []).map((id) => all.get(`!actors.items!${actor._id}.${id}`)).filter(Boolean);
}

/** An NPC strike's linked weapon (flags.pf2e.linkedWeapon, or sf2e's scope). */
function linkedOf(items, it) {
  const id = it.flags?.pf2e?.linkedWeapon ?? it.flags?.sf2e?.linkedWeapon;
  return id ? items.find((x) => x._id === id) ?? null : null;
}

/**
 * Evaluate one document. `ctx` carries the actor for embedded items.
 * Returns null for documents outside the engine's reach (e.g. spellcasting entries).
 */
export function evaluate(doc, ctx = {}) {
  const t = doc?.type;
  if (t === "condition") return describeCondition(doc.system?.slug ?? doc.name, { value: doc.system?.value?.value, damageType: doc.system?.persistent?.damageType });
  if (["spellcastingEntry", "lore", "effect", "armor", "shield", "backpack", "treasure", "kit", "equipment", "ammo", "book"].includes(t)) return null;
  if (t === "weapon" && ctx.actor?.type === "npc") return null; // NPC strikes are their melee items
  if (t === "action" && ctx.category === "actions") {
    // The Actions pack: a skill action is rolled as a check, the rest post a card.
    const curatedCheck = describeSkillAction(doc.system?.slug ?? doc.name, doc.system?.traits?.value);
    if (!curatedCheck.silent || curatedCheck.why?.silent !== "unknown") return { ...curatedCheck, via: "skill-action" };
  }
  return describeItem(doc, ctx.opts ?? {});
}

function* itemsOf(name, all) {
  for (const [k, v] of all) {
    if (!k.startsWith("!items!")) continue;
    if (name === "equipment" && !["weapon", "consumable"].includes(v.type)) { yield { doc: v, category: "equipment-other", skip: true }; continue; }
    yield { doc: v, category: name === "equipment" ? `equipment-${v.type}` : name };
  }
}

function* actorItemsOf(name, all) {
  for (const [k, actor] of all) {
    if (!k.startsWith("!actors!")) continue;
    const items = embedded(all, actor);
    const entries = new Map(items.filter((i) => i.type === "spellcastingEntry").map((i) => [i._id, i.system?.tradition?.value ?? null]));
    const level = actor.system?.details?.level?.value ?? actor.system?.level?.value ?? 0;
    const undead = false;
    const category = actor.type === "hazard" ? "hazards" : actor.type === "character" || actor.type === "familiar" ? "pcs" : actor.type === "vehicle" ? "vehicles" : "bestiary";
    for (const it of items) {
      const tradition = it.type === "spell" ? entries.get(it.system?.location?.value) ?? null : null;
      yield {
        doc: it, actor, pack: name,
        category: it.type === "melee" ? `${category}-strike` : `${category}-${it.type}`,
        opts: { actorLevel: level, tradition, hazard: actor.type === "hazard", targetUndead: undead, weapon: it.type === "melee" ? linkedOf(items, it) : null },
      };
    }
  }
}

function* packEntries(name, all) {
  let actors = false, items = false;
  for (const k of all.keys()) { if (k.startsWith("!actors!")) actors = true; else if (k.startsWith("!items!")) items = true; if (actors && items) break; }
  if (actors) yield* actorItemsOf(name, all);
  if (items) yield* itemsOf(name, all);
}

/** Walk every pack, yielding { pack, category, doc, actor?, result }. */
export async function* walkPacks(root = DEFAULT_PACKS, { only = null } = {}) {
  const names = readdirSync(root).filter((n) => existsSync(join(root, n, "CURRENT")));
  for (const name of names) {
    if (only && !only(name)) continue;
    if (SKIP_PACKS.has(name)) continue;
    const all = await loadPack(join(root, name));
    for (const entry of packEntries(name, all)) {
      if (entry.skip) continue;
      const result = evaluate(entry.doc, { ...entry, category: entry.category });
      if (!result) continue;
      yield { pack: name, ...entry, result };
    }
  }
}

/**
 * Walk a tree of source JSON (e.g. foundryvtt/pf2e's packs/sf2e): one document
 * per file, actors with their items inline. `--sf2e=<dir>` adds it to the report.
 */
export function* walkJson(root) {
  const files = [];
  const visit = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) visit(p); else if (f.name.endsWith(".json")) files.push(p); } };
  visit(root);
  for (const p of files) {
    let doc;
    try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
    const pack = `sf2e/${p.slice(root.length + 1).split(/[\\/]/)[0]}`;
    if (Array.isArray(doc.items) && doc.items.length && doc.items[0] && typeof doc.items[0] === "object") {
      const all = new Map([[`!actors!${doc._id}`, { ...doc, items: doc.items.map((i) => i._id) }], ...doc.items.map((i) => [`!actors.items!${doc._id}.${i._id}`, i])]);
      for (const entry of actorItemsOf(pack, all)) {
        const e = { ...entry, category: `sf2e-${entry.category}` };
        const result = evaluate(e.doc, e);
        if (result) yield { ...e, result };
      }
    } else if (doc.type && doc.system) {
      const e = { doc, pack, category: `sf2e-${doc.type}` };
      if (!["weapon", "consumable", "spell", "feat", "action"].includes(doc.type)) continue;
      const result = evaluate(doc, e);
      if (result) yield { ...e, result };
    }
  }
}

/** The famous ones: what each must resolve to. `pack`/`actor`/`name` find it. */
export const SPOT_CHECKS = [
  { label: "Fireball", pack: "spells", name: "Fireball", expect: { kind: "area", func: "harm", material: "fire", "area.shape": "burst", "area.r": 4 } },
  { label: "Lightning Bolt", pack: "spells", name: "Lightning Bolt", expect: { kind: "area", func: "harm", material: "electricity", "area.shape": "line", "area.len": 24 } },
  { label: "Cone of Cold", pack: "spells", name: "Cone of Cold", expect: { kind: "area", func: "harm", material: "cold", "area.shape": "cone", "area.len": 12 } },
  { label: "Heal (base)", pack: "spells", name: "Heal", expect: { func: "restore", material: "vitality" } },
  { label: "Heal on undead", pack: "spells", name: "Heal", opts: { targetUndead: true }, expect: { func: "harm", material: "vitality" } },
  { label: "Harm (base)", pack: "spells", name: "Harm", expect: { func: "harm", material: "void" } },
  { label: "Harm on undead", pack: "spells", name: "Harm", opts: { targetUndead: true }, expect: { func: "restore", material: "void" } },
  { label: "Force Barrage", pack: "spells", name: "Force Barrage", expect: { kind: "auto", func: "harm", material: "force" } },
  { label: "Electric Arc", pack: "spells", name: "Electric Arc", expect: { kind: "save", func: "harm", material: "electricity" } },
  { label: "Breathe Fire", pack: "spells", name: "Breathe Fire", expect: { kind: "area", func: "harm", material: "fire", "area.shape": "cone" } },
  { label: "Haste", pack: "spells", name: "Haste", expect: { func: "movement", material: "air" } },
  { label: "Invisibility", pack: "spells", name: "Invisibility", expect: { func: "conceal", material: "illusion" } },
  { label: "Fly", pack: "spells", name: "Fly", expect: { func: "movement", material: "air" } },
  { label: "Summon Animal", pack: "spells", name: "Summon Animal", expect: { func: "summon" } },
  { label: "Translocate (Dimension Door)", pack: "spells", name: /^(Translocate|Dimension Door)$/, expect: { func: "teleport", material: "arcane", kind: "self" } },
  { label: "Shield", pack: "spells", name: "Shield", expect: { func: "protect", material: "force", kind: "self" } },
  { label: "Bless", pack: "spells", name: "Bless", expect: { func: "support", material: "holy" } },
  { label: "Fear", pack: "spells", name: "Fear", expect: { func: "hinder", material: "mental" } },
  { label: "Slow", pack: "spells", name: "Slow", expect: { func: "hinder" } },
  { label: "Grease", pack: "spells", name: "Grease", expect: { func: "terrain" } },
  { label: "Wall of Fire", pack: "spells", name: "Wall of Fire", expect: { func: "terrain", material: "fire", "area.shape": "line" } },
  { label: "Chromatic Ray", pack: "spells", name: "Chromatic Ray", optional: true, expect: { func: "harm", material: "light" } },
  { label: "Horned Dragon (Young): Poison Breath", pack: "pathfinder-monster-core", actor: "Horned Dragon (Young)", name: "Poison Breath", expect: { kind: "area", func: "harm", material: "poison", "area.shape": "cone", "area.len": 8 } },
  { label: "Forest Troll: Claw", pack: "pathfinder-monster-core", actor: "Forest Troll", name: "Claw", expect: { kind: "strike", "weapon.style": "claw", material: "kinetic" } },
  { label: "Forest Troll: Jaws", pack: "pathfinder-monster-core", actor: "Forest Troll", name: "Jaws", expect: { kind: "strike", "weapon.style": "bite" } },
  { label: "Wolf: Jaws", pack: "pathfinder-monster-core", actor: "Wolf", name: "Jaws", expect: { kind: "strike", "weapon.style": "bite" } },
  { label: "Goblin Warrior: Shortbow", pack: "pathfinder-monster-core", actor: "Goblin Warrior", name: "Shortbow", type: "melee", expect: { kind: "strike", "weapon.style": "ranged", "weapon.ranged": true } },
  { label: "Goblin Warrior: Dogslicer", pack: "pathfinder-monster-core", actor: "Goblin Warrior", name: "Dogslicer", type: "melee", expect: { kind: "strike", "weapon.style": "slash" } },
  { label: "Alchemist's Fire (Lesser)", pack: "equipment", name: "Alchemist's Fire (Lesser)", expect: { kind: "strike", "weapon.style": "thrown", "weapon.splash": true, material: "fire" } },
  { label: "Healing Potion (Minor)", pack: "equipment", name: "Healing Potion (Minor)", expect: { kind: "self", func: "restore", material: "vitality" } },
  { label: "Longsword", pack: "equipment", name: "Longsword", expect: { kind: "strike", "weapon.style": "slash", material: "kinetic" } },
  { label: "Shortbow", pack: "equipment", name: "Shortbow", expect: { kind: "strike", "weapon.style": "ranged" } },
  { label: "Javelin", pack: "equipment", name: "Javelin", expect: { kind: "strike", "weapon.style": "thrown" } },
  { label: "Demoralize", pack: "actions", name: "Demoralize", expect: { func: "hinder", material: "mental", kind: "attack" } },
  { label: "Trip", pack: "actions", name: "Trip", expect: { func: "control", kind: "attack" } },
  { label: "Grapple", pack: "actions", name: "Grapple", expect: { func: "control", kind: "attack" } },
  { label: "Raise a Shield", pack: "actions", name: "Raise a Shield", expect: { func: "protect", kind: "self" } },
  // the look axes: the name shapes the effect
  { label: "Sniper: Arquebus", pack: "pathfinder-npc-core", actor: "Sniper", name: "Arquebus", type: "melee", expect: { kind: "strike", delivery: "bullet", "weapon.style": "ranged" } },
  { label: "Flintlock Pistol", pack: "equipment", name: "Flintlock Pistol", expect: { kind: "strike", delivery: "bullet" } },
  { label: "Blunderbuss", pack: "equipment", name: "Blunderbuss", expect: { kind: "strike", delivery: "pellets" } },
  { label: "Crossbow", pack: "equipment", name: "Crossbow", expect: { kind: "strike", delivery: "bolt" } },
  { label: "Hand Crossbow", pack: "equipment", name: "Hand Crossbow", expect: { delivery: "bolt", motif: "arrow" } },
  { label: "Sling", pack: "equipment", name: "Sling", expect: { kind: "strike", delivery: "stone" } },
  { label: "Wolf: Jaws (delivery)", pack: "pathfinder-monster-core", actor: "Wolf", name: "Jaws", expect: { delivery: "jaws" } },
  { label: "Forest Troll: Claw (delivery)", pack: "pathfinder-monster-core", actor: "Forest Troll", name: "Claw", expect: { delivery: "rake", motif: "claw" } },
  { label: "Empyreal Dragon: Tail", pack: "pathfinder-monster-core", actor: "Empyreal Dragon (Young, Spellcaster)", name: "Tail", expect: { delivery: "lash" } },
  { label: "Horned Dragon: Horn", pack: "pathfinder-monster-core", actor: "Horned Dragon (Young)", name: "Horn", expect: { delivery: "gore" } },
  { label: "Giant Wasp: Stinger", pack: "pathfinder-monster-core", actor: "Giant Wasp", name: "Stinger", expect: { delivery: "sting" } },
  { label: "Empyreal Dragon: Wing", pack: "pathfinder-monster-core", actor: "Empyreal Dragon (Young, Spellcaster)", name: "Wing", expect: { delivery: "buffet" } },
  { label: "Horned Dragon: Poison Breath (delivery)", pack: "pathfinder-monster-core", actor: "Horned Dragon (Young)", name: "Poison Breath", expect: { delivery: "breath" } },
  { label: "Fireball (delivery)", pack: "spells", name: "Fireball", expect: { delivery: "lob" } },
  { label: "Flame Strike", pack: "spells", name: "Flame Strike", expect: { delivery: "fall", material: "fire" } },
  { label: "Force Barrage (delivery)", pack: "spells", name: "Force Barrage", expect: { delivery: "darts" } },
  { label: "Chain Lightning", pack: "spells", name: "Chain Lightning", expect: { motif: "chain", material: "electricity" } },
  { label: "Spiritual Armament", pack: "spells", name: "Spiritual Armament", expect: { motif: "weapon" } },
  { label: "Hydraulic Push", pack: "spells", name: "Hydraulic Push", expect: { motif: "wave", material: "water" } },
  { label: "Flurry of Blows", pack: "actions", name: "Flurry of Blows", expect: { flavor: "flurry" } },
  { label: "Elemental Blast (impulse)", pack: "actions", name: "Elemental Blast", expect: { flavor: "impulse" } },
  { label: "Rage", pack: "actions", name: "Rage", expect: { flavor: "rage" } },
  // archetypes (archetypes/rules.mjs): one animation per meaning, never across functions
  { label: "Fireball keeps its delivery", pack: "spells", name: "Fireball", expect: { arch: null } },
  { label: "Heal is a vital rise", pack: "spells", name: "Heal", expect: { func: "restore", arch: "rise" } },
  { label: "Fear is fear", pack: "spells", name: "Fear", expect: { func: "hinder", arch: "fear" } },
  { label: "Invisibility vanishes", pack: "spells", name: "Invisibility", expect: { arch: "vanish" } },
  { label: "See the Unseen is a detect", pack: "spells", name: "See the Unseen", expect: { func: "detect", arch: "detect" } },
  { label: "Heroism is a buff", pack: "spells", name: "Heroism", expect: { func: "support", arch: "fortune" } },
  { label: "Sending is not a hinder", pack: "spells", name: "Sending", expect: { func: "support" } },
  { label: "Slow is slow", pack: "spells", name: "Slow", expect: { arch: "slow" } },
  { label: "Grab grabs", pack: "bestiary-ability-glossary-srd", name: "Grab", expect: { arch: "grab" } },
  { label: "Knockdown trips", pack: "bestiary-ability-glossary-srd", name: "Knockdown", expect: { arch: "trip" } },
  // the P1 archetypes (docs/SPELLSPRITE_ARCHETYPES.md §4 rows 12–20), and what each must not take
  { label: "Change Shape is a polymorph", pack: "bestiary-ability-glossary-srd", name: "Change Shape", expect: { func: "transform", arch: "polymorph" } },
  { label: "Humanoid Form is a polymorph", pack: "spells", name: "Humanoid Form", expect: { arch: "polymorph" } },
  { label: "Translocate folds", pack: "spells", name: /^(Translocate|Dimension Door)$/, expect: { func: "teleport", arch: "teleport" } },
  { label: "Haste hastes", pack: "spells", name: "Haste", expect: { func: "movement", arch: "haste" } },
  { label: "Fly flies", pack: "spells", name: "Fly", expect: { arch: "fly" } },
  { label: "Levitate flies", pack: "spells", name: "Levitate", expect: { arch: "fly" } },
  { label: "Shield wards", pack: "spells", name: "Shield", expect: { func: "protect", arch: "ward" } },
  { label: "Shield Block wards", pack: "bestiary-ability-glossary-srd", name: "Shield Block", expect: { arch: "ward" } },
  { label: "Wall of Force keeps its wall", pack: "spells", name: "Wall of Force", expect: { delivery: "wall", arch: null } },
  { label: "Dispel Magic unweaves", pack: "spells", name: "Dispel Magic", expect: { arch: "dispel" } },
  { label: "Counterspell is a ward, not a dispel", pack: "age-of-ashes-bestiary", actor: "King Harral", name: "Counterspell", expect: { arch: "ward" } },
  { label: "Detect Magic sweeps", pack: "spells", name: "Detect Magic", expect: { func: "detect", arch: "detect" } },
  { label: "Seek (secret) is no detect sweep", pack: "actions", name: "Seek", expect: { func: "detect", arch: null } },
  { label: "Darkness veils", pack: "spells", name: "Darkness", expect: { func: "conceal", arch: "conceal" } },
  { label: "Figment veils", pack: "spells", name: "Figment", expect: { arch: "conceal" } },
  { label: "Ghost Sound is only a sound", pack: "spells", name: "Ghost Sound", expect: { func: "conceal", arch: null } },
  { label: "Darkvision Elixir is drunk", pack: "equipment", name: "Darkvision Elixir (Lesser)", expect: { arch: "drink" } },
  { label: "Drink Blood drains", pack: "actions", name: "Drink Blood", expect: { arch: "drain" } },
  { label: "Ghoul Fever seeps", pack: "abomination-vaults-bestiary", actor: "Canker Cultist", name: "Ghoul Fever", expect: { func: "harm", arch: "drain" } },
  { label: "Summon Animal summons", pack: "spells", name: "Summon Animal", expect: { func: "summon", arch: "summon" } },
  { label: "Create Undead summons", pack: "spells", name: "Create Undead", expect: { arch: "summon" } },
];

export const pick = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

export function findSpot(spot, packs) {
  const all = packs.get(spot.pack);
  if (!all) return null;
  const nameOk = (n) => (spot.name instanceof RegExp ? spot.name.test(n) : n === spot.name);
  if (spot.actor) {
    for (const [k, actor] of all) {
      if (!k.startsWith("!actors!") || actor.name !== spot.actor) continue;
      const items = embedded(all, actor);
      const it = items.find((i) => nameOk(i.name) && (!spot.type || i.type === spot.type) && i.type !== "weapon");
      if (it) return { doc: it, actor, opts: { actorLevel: actor.system?.details?.level?.value ?? 0, weapon: it.type === "melee" ? linkedOf(items, it) : null, ...(spot.opts ?? {}) } };
    }
    return null;
  }
  for (const [k, v] of all) if (k.startsWith("!items!") && nameOk(v.name)) return { doc: v, opts: spot.opts ?? {} };
  return null;
}

export function runSpot(spot, packs) {
  const found = findSpot(spot, packs);
  if (!found) return { spot, missing: true };
  const result = evaluate(found.doc, { opts: found.opts, actor: found.actor, category: spot.pack });
  const fails = Object.entries(spot.expect).filter(([k, v]) => pick(result, k) !== v).map(([k, v]) => `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(pick(result, k))}`);
  return { spot, result, fails };
}

/* ── the report ───────────────────────────────────────────────────────── */

const bump = (m, k) => m.set(k ?? "—", (m.get(k ?? "—") ?? 0) + 1);
const table = (title, m, total) => {
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return [`| ${title} | n | % |`, "|---|---:|---:|", ...rows.map(([k, n]) => `| ${k} | ${n} | ${((100 * n) / total).toFixed(1)} |`)].join("\n");
};

/** Something that would play and looks unconvincing. */
function suspect(entry) {
  const r = entry.result;
  if (r.silent) return null;
  if (r.func === "neutral" && r.material === "neutral") return "neutral/neutral";
  if (r.kind === "strike" && !r.weapon?.style) return "strike without a style";
  if (r.func === "neutral") return "neutral function";
  if (r.material === "neutral") return "neutral material";
  return null;
}

/* ── the look axes (docs/SPELLSPRITE_LOOK.md) ────────────────────────── */

const isNpcStrike = (e) => e.doc.type === "melee";
const normName = (n) => String(n ?? "").toLowerCase().replace(/\s*\([^)]*\)\s*/g, " ").trim();
const lookClass = (r) => (r.kind === "strike" ? "strike" : r.kind === "condition" || r.kind === "tick" ? "condition" : r.func === "harm" || r.func === "hazard" ? "harm" : "other");

function newLook() {
  const m = () => new Map();
  return {
    delivery: m(), deliverySrc: m(), motif: m(), motifSrc: m(), props: m(), flavor: m(), flavorSrc: m(), byClass: new Map(),
    npcStrikes: 0, npcSpecific: 0, npcDefault: m(), harmSpells: 0, harmSpellDefault: m(), harmSpellNoMotif: new Map(),
    harmSpellMotif: 0, spellsPackHarm: 0, abilities: 0, abilityDefault: m(), unknownBase: m(), playing: 0, withMotif: 0, withFlavor: 0,
    arch: m(), archSrc: m(), archEx: new Map(), rescued: 0,
  };
}

function tallyLook(L, e) {
  const r = e.result;
  if (r.silent) return;
  L.playing++;
  const cls = lookClass(r);
  let c = L.byClass.get(cls);
  if (!c) L.byClass.set(cls, (c = { n: 0, delivery: new Map(), src: new Map(), motif: 0 }));
  c.n++; bump(c.delivery, r.delivery); bump(c.src, r.why?.delivery);
  if (r.motif) { c.motif++; L.withMotif++; }
  if (r.flavor) L.withFlavor++;
  bump(L.delivery, r.delivery); bump(L.deliverySrc, r.why?.delivery);
  bump(L.motif, r.motif ?? "(none)"); bump(L.motifSrc, r.why?.motif);
  bump(L.flavor, r.flavor ?? "(none)"); bump(L.flavorSrc, r.why?.flavor);
  for (const p of r.props ?? []) bump(L.props, p);
  // the archetype (archetypes/rules.mjs): one animation shared by every document that means the same thing
  bump(L.arch, r.arch ?? "(none)"); if (r.arch) bump(L.archSrc, r.why?.arch);
  if (r.why?.func === "arch") L.rescued++;
  if (r.arch) { const ex = L.archEx.get(r.arch) ?? new Map(); bump(ex, e.doc.name); L.archEx.set(r.arch, ex); }
  const name = normName(e.doc.name);
  if (isNpcStrike(e)) {
    L.npcStrikes++;
    if (r.why?.delivery !== "default") L.npcSpecific++;
    else bump(L.npcDefault, `${name} → ${r.delivery}`);
  }
  if (["weapon", "melee"].includes(e.doc.type)) {
    const b = String(e.doc.system?.baseItem ?? "");
    if (b && !BASE_GROUP[b]) bump(L.unknownBase, `${b} (${e.doc.system?.group ?? "?"})`);
  }
  if (e.doc.type === "spell" && cls === "harm") {
    L.harmSpells++;
    if (r.why?.delivery === "default") bump(L.harmSpellDefault, `${e.doc.name} → ${r.delivery}`);
    if (e.pack === "spells") {
      L.spellsPackHarm++;
      if (r.motif) L.harmSpellMotif++;
      else L.harmSpellNoMotif.set(e.doc.name, r.delivery);
    }
  }
  if (["action", "feat"].includes(e.doc.type) && cls === "harm" && e.doc.system?.actionType?.value !== "passive") {
    L.abilities++;
    if (r.why?.delivery === "default") bump(L.abilityDefault, `${name} → ${r.delivery}`);
  }
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "0.0");
const list = (m, n = 60) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`).join("; ") || "None.";

function lookReport(L) {
  const withArch = L.playing - (L.arch.get("(none)") ?? 0);
  const lines = ["## Archetypes", "", `An archetype (docs/SPELLSPRITE_ARCHETYPES.md, archetypes/rules.mjs) is one animation reused by every document that means the same thing. **${withArch}** of ${L.playing} playing documents (${pct(withArch, L.playing)}%) play one; **${L.rescued}** of those were silent actions an archetype rescued. Sources: ${list(L.archSrc)}.`, "",
    "| archetype | docs | top documents |", "|---|---:|---|",
    ...[...L.arch.entries()].filter(([k]) => k !== "(none)").sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} | ${list(L.archEx.get(k) ?? new Map(), 6)} |`), "",
    "## Look axes", "", "The five-axis look model (docs/SPELLSPRITE_LOOK.md), over every playing document. A source of `default` means no structure, name or trait said anything and the kind's fallback was used.", ""];
  lines.push(`- NPC strike instances with a specific delivery: **${L.npcSpecific} / ${L.npcStrikes} (${pct(L.npcSpecific, L.npcStrikes)}%)**`);
  lines.push(`- Harm spells (every pack) with a delivery: **${L.harmSpells} / ${L.harmSpells}**, ${L.harmSpells - [...L.harmSpellDefault.values()].reduce((a, b) => a + b, 0)} from structure or name`);
  lines.push(`- Harm spells in the Spells pack with a motif: **${L.harmSpellMotif} / ${L.spellsPackHarm}**`);
  lines.push(`- Playing documents with a motif: ${L.withMotif} (${pct(L.withMotif, L.playing)}%), with a flavor: ${L.withFlavor} (${pct(L.withFlavor, L.playing)}%)`, "");
  lines.push("| class | n | with motif | deliveries (top 12) | delivery source |", "|---|---:|---:|---|---|");
  for (const [k, c] of [...L.byClass.entries()].sort((a, b) => b[1].n - a[1].n)) {
    lines.push(`| ${k} | ${c.n} | ${pct(c.motif, c.n)}% | ${[...c.delivery.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([d, n]) => `${d} ${n}`).join(", ")} | ${[...c.src.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${pct(n, c.n)}%`).join(", ")} |`);
  }
  lines.push("");
  lines.push(table("delivery", L.delivery, L.playing), "", table("delivery source", L.deliverySrc, L.playing), "");
  lines.push(table("motif", L.motif, L.playing), "", table("motif source", L.motifSrc, L.playing), "");
  lines.push(table("prop (a document may carry several)", L.props, L.playing), "");
  lines.push(table("flavor", L.flavor, L.playing), "", table("flavor source", L.flavorSrc, L.playing), "");
  lines.push("### Look residue", "");
  lines.push(`**NPC strikes on a fallback delivery** (${L.npcStrikes - L.npcSpecific} instances; name, what the fallback chose, count): ${list(L.npcDefault, 80)}`, "");
  lines.push(`**Harm spells on a fallback delivery**: ${list(L.harmSpellDefault, 40)}`, "");
  lines.push(`**Spells-pack harm spells with no motif** (${L.harmSpellNoMotif.size}; nothing in the name names an object): ${[...L.harmSpellNoMotif.keys()].sort().join(", ") || "None."}`, "");
  lines.push(`**Active abilities with harm on a fallback delivery**: ${list(L.abilityDefault, 80)}`, "");
  lines.push(`**Base items missing from depict.mjs BASE_GROUP**: ${list(L.unknownBase, 40)}`, "");
  return lines;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
  const root = args.packs ?? DEFAULT_PACKS;
  if (!existsSync(root)) { console.error(`no packs at ${root}`); process.exit(2); }
  const t0 = Date.now();
  const cats = new Map();
  const full = [];
  const residue = new Map();
  const silentReview = new Map();
  const look = newLook();
  const sf2e = typeof args.sf2e === "string" && existsSync(args.sf2e) ? args.sf2e : null;
  async function* sources() {
    yield* walkPacks(root);
    if (sf2e) yield* walkJson(sf2e);
  }
  for await (const e of sources()) {
    tallyLook(look, e);
    const r = e.result;
    const group = e.category.replace(/^(bestiary|hazards|pcs)-.*/, (m) => m) ;
    let c = cats.get(group);
    if (!c) cats.set(group, (c = { n: 0, kind: new Map(), func: new Map(), material: new Map(), family: new Map(), style: new Map(), shape: new Map(), silent: new Map(), playing: 0 }));
    c.n++;
    if (r.silent) bump(c.silent, r.silent);
    else {
      c.playing++;
      bump(c.kind, r.kind); bump(c.func, r.func); bump(c.material, r.material); bump(c.family, FAMILY_OF[r.material] ?? "?");
      if (r.weapon) bump(c.style, r.weapon.style);
      if (r.area) bump(c.shape, r.area.shape);
    }
    full.push({ pack: e.pack, category: e.category, actor: e.actor?.name ?? null, name: e.doc.name, type: e.doc.type, ...r });
    const why = suspect(e);
    const dedupe = `${e.category}|${e.doc.name}`;
    if (why && !residue.has(dedupe)) residue.set(dedupe, { why, category: e.category, name: e.doc.name, actor: e.actor?.name ?? null, pack: e.pack, func: r.func, material: r.material, kind: r.kind, src: r.why });
    // actions that take an action yet play nothing: worth a look
    const acts = e.doc.system?.actionType?.value;
    if (r.silent === "no-function" && acts && acts !== "passive" && !silentReview.has(dedupe)) silentReview.set(dedupe, { category: e.category, name: e.doc.name, actor: e.actor?.name ?? null, actionType: acts });
  }

  // spot checks
  const packs = new Map();
  for (const p of new Set(SPOT_CHECKS.map((s) => s.pack))) packs.set(p, await loadPack(join(root, p)));
  const spots = SPOT_CHECKS.map((s) => runSpot(s, packs));

  const total = full.length;
  const playing = full.filter((r) => !r.silent).length;
  const neutralBoth = full.filter((r) => !r.silent && r.func === "neutral" && r.material === "neutral").length;
  const lines = [];
  lines.push("# Spellsprite coverage", "");
  lines.push(`Generated by \`node tools/fx-coverage.mjs\` over PF2e's own compendium packs (${new Date().toISOString().slice(0, 10)}). Every document is run through \`scripts/features/pf2e-fx/semantics.mjs\`; the full result per document is \`.preview/fx-coverage.json\`.`, "");
  lines.push(`**${total}** documents evaluated, **${playing}** play an effect, **${total - playing}** are silent by design, **${neutralBoth}** would play as neutral/neutral.`, "");
  lines.push("## By category", "");
  lines.push("| category | docs | play | silent | neutral func | neutral material |", "|---|---:|---:|---:|---:|---:|");
  for (const [k, c] of [...cats.entries()].sort()) lines.push(`| ${k} | ${c.n} | ${c.playing} | ${c.n - c.playing} | ${c.func.get("neutral") ?? 0} | ${c.material.get("neutral") ?? 0} |`);
  lines.push("");
  const merged = (field) => {
    const m = new Map();
    for (const c of cats.values()) for (const [k, n] of c[field]) m.set(k, (m.get(k) ?? 0) + n);
    return m;
  };
  lines.push("## Axes, every playing document", "");
  lines.push(table("kind", merged("kind"), playing), "", table("func", merged("func"), playing), "", table("family", merged("family"), playing), "");
  lines.push(table("material", merged("material"), playing), "");
  const styles = merged("style"), shapes = merged("shape"), silent = merged("silent");
  lines.push(table("weapon style", styles, [...styles.values()].reduce((a, b) => a + b, 0) || 1), "");
  lines.push(table("area shape", shapes, [...shapes.values()].reduce((a, b) => a + b, 0) || 1), "");
  lines.push(table("silent because", silent, (total - playing) || 1), "");
  lines.push(...lookReport(look));

  lines.push("## Spot checks", "");
  lines.push("| what | kind | func | material | style / area | delivery | motif | flavor | ok |", "|---|---|---|---|---|---|---|---|---|");
  for (const s of spots) {
    if (s.missing) { lines.push(`| ${s.spot.label} | — | — | — | not in packs | — | — | — | ${s.spot.optional ? "n/a" : "MISSING"} |`); continue; }
    const r = s.result;
    const extra = r.weapon ? `${r.weapon.style}${r.weapon.splash ? " +splash" : ""}` : r.area ? `${r.area.shape} ${r.area.len ?? r.area.r}` : "";
    lines.push(`| ${s.spot.label} | ${r.kind} | ${r.func} | ${r.material}${r.accent ? ` (+${r.accent})` : ""} | ${extra} | ${r.delivery ?? "—"} | ${r.motif ?? "—"} | ${r.flavor ?? "—"} | ${s.fails.length ? `FAIL: ${s.fails.join("; ")}` : "yes"} |`);
  }
  lines.push("");

  const res = [...residue.values()];
  const byWhy = new Map();
  for (const r of res) bump(byWhy, `${r.why} (${r.category})`);
  lines.push("## Residue", "", "Playing documents that resolve to a neutral axis, deduplicated by category and name.", "");
  lines.push(table("residue", byWhy, res.length || 1), "");
  const both = res.filter((r) => r.why === "neutral/neutral");
  lines.push(`### neutral/neutral (${both.length})`, "");
  lines.push(both.length ? both.slice(0, 60).map((r) => `- ${r.name}${r.actor ? ` (${r.actor})` : ""}, ${r.category}`).join("\n") : "None.");
  if (both.length > 60) lines.push(`- …and ${both.length - 60} more in the JSON.`);
  lines.push("");
  const silentList = [...silentReview.values()];
  lines.push(`### Silent with an action cost (${silentList.length})`, "", "Actions and feats that cost an action but carry no area, no damage and no recognisable function. They post a card and play nothing. A sample:", "");
  lines.push(silentList.slice(0, 40).map((r) => `- ${r.name}${r.actor ? ` (${r.actor})` : ""}, ${r.category}, ${r.actionType}`).join("\n") || "None.");
  lines.push("");

  writeFileSync(join(ROOT, "docs/SPELLSPRITE_COVERAGE.md"), lines.join("\n"));
  mkdirSync(join(ROOT, ".preview"), { recursive: true });
  writeFileSync(join(ROOT, ".preview/fx-coverage.json"), JSON.stringify({ total, playing, neutralBoth, spots: spots.map((s) => ({ label: s.spot.label, missing: !!s.missing, fails: s.fails ?? [], result: s.result ?? null })), residue: res, silentReview: silentList, documents: full }, null, 0));
  const failed = spots.filter((s) => (s.missing && !s.spot.optional) || s.fails?.length);
  if (!args.quiet) {
    console.log(`fx-coverage: ${total} docs, ${playing} play, ${neutralBoth} neutral/neutral, ${res.length} residual, ${silentList.length} silent-with-cost, ${Date.now() - t0} ms`);
    for (const s of failed) console.log(`  spot ${s.spot.label}: ${s.missing ? "MISSING" : s.fails.join("; ")}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
