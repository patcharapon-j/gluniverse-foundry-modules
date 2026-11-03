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

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describeItem, describeCondition, describeSkillAction } from "../scripts/features/pf2e-fx/semantics.mjs";
import { FAMILY_OF } from "../scripts/features/pf2e-fx/constants.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PACKS = "C:/Users/frostnoxia/AppData/Local/FoundryVTT/Data/systems/pf2e/packs";
const CLASSIC_LEVEL = "C:/Program Files/Foundry Virtual Tabletop/resources/app/node_modules/classic-level/index.js";

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

const ITEM_PACKS = ["spells", "feats", "actions", "class-features", "equipment", "bestiary-ability-glossary-srd", "bestiary-family-ability-glossary"];
const isActorPack = (name) => /bestiary|npc-gallery|iconics|paizo-pregens|^hazards$/.test(name);

/** Embedded items of an actor in pack data. */
function embedded(all, actor) {
  return (actor.items ?? []).map((id) => all.get(`!actors.items!${actor._id}.${id}`)).filter(Boolean);
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
    const level = actor.system?.details?.level?.value ?? 0;
    const undead = false;
    const category = actor.type === "hazard" ? "hazards" : actor.type === "character" ? "pcs" : "bestiary";
    for (const it of items) {
      const tradition = it.type === "spell" ? entries.get(it.system?.location?.value) ?? null : null;
      yield {
        doc: it, actor, pack: name,
        category: it.type === "melee" ? `${category}-strike` : `${category}-${it.type}`,
        opts: { actorLevel: level, tradition, hazard: actor.type === "hazard", targetUndead: undead },
      };
    }
  }
}

/** Walk every relevant pack, yielding { pack, category, doc, actor?, result }. */
export async function* walkPacks(root = DEFAULT_PACKS, { only = null } = {}) {
  const names = readdirSync(root).filter((n) => existsSync(join(root, n, "CURRENT")));
  for (const name of names) {
    if (only && !only(name)) continue;
    const item = ITEM_PACKS.includes(name) || name === "conditions";
    const actor = isActorPack(name);
    if (!item && !actor) continue;
    const all = await loadPack(join(root, name));
    const iter = actor ? actorItemsOf(name, all) : itemsOf(name, all);
    for (const entry of iter) {
      if (entry.skip) continue;
      const result = evaluate(entry.doc, { ...entry, category: entry.category });
      if (!result) continue;
      yield { pack: name, ...entry, result };
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
      if (it) return { doc: it, actor, opts: { actorLevel: actor.system?.details?.level?.value ?? 0, ...(spot.opts ?? {}) } };
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

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
  const root = args.packs ?? DEFAULT_PACKS;
  if (!existsSync(root)) { console.error(`no packs at ${root}`); process.exit(2); }
  const t0 = Date.now();
  const cats = new Map();
  const full = [];
  const residue = new Map();
  const silentReview = new Map();
  for await (const e of walkPacks(root)) {
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

  lines.push("## Spot checks", "");
  lines.push("| what | kind | func | material | style / area | ok |", "|---|---|---|---|---|---|");
  for (const s of spots) {
    if (s.missing) { lines.push(`| ${s.spot.label} | — | — | — | not in packs | ${s.spot.optional ? "n/a" : "MISSING"} |`); continue; }
    const r = s.result;
    const extra = r.weapon ? `${r.weapon.style}${r.weapon.splash ? " +splash" : ""}` : r.area ? `${r.area.shape} ${r.area.len ?? r.area.r}` : "";
    lines.push(`| ${s.spot.label} | ${r.kind} | ${r.func} | ${r.material}${r.accent ? ` (+${r.accent})` : ""} | ${extra} | ${s.fails.length ? `FAIL: ${s.fails.join("; ")}` : "yes"} |`);
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
