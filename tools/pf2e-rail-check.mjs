#!/usr/bin/env node
/**
 * tools/pf2e-rail-check.mjs — consistency check for the PF2e HUD (`pf2e-rail`).
 *
 *   node tools/pf2e-rail-check.mjs
 *
 * Everything here fails silently in a live world. A press the view draws and
 * the host never answers is a button that does nothing. A reader that emits a
 * field under a name the view does not read draws an empty plate, and one
 * that forgets a field draws `undefined`. A runtime-built i18n key prints
 * itself. A skin rule outside `.gph`, a foundation token redeclared or a
 * bare keyframe name repaints somebody else's feature. A rail on the stream
 * login puts the GM's rail on the recording, and an echo of a blind roll
 * tells a player the number PF2e hid from them. None of that throws.
 *
 * The readers are driven with fake PF2e actors (a fighter, a prepared caster,
 * a kineticist, a familiar, an NPC, a hazard, a dying fighter) in the shapes
 * PF2e 8.7 prepares, and their output is held to the fixtures
 * (tools/pf2e-rail-fixtures.mjs), which are the view's model contract.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as V from "../scripts/features/pf2e-rail/view.mjs";
import * as S from "../scripts/features/pf2e-rail/shape.mjs";
import * as R from "../scripts/features/pf2e-rail/read.mjs";
import { Turn, economyOf, turnKey } from "../scripts/features/pf2e-rail/turn.mjs";
import { answers, echoOf } from "../scripts/features/pf2e-rail/echo.mjs";
import { combatOf, isTurnOf, shouldMount, subjectOf } from "../scripts/features/pf2e-rail/subject.mjs";
import { PEEK_PRESSES, ROW_KEYS, actionPeek, effectRows, inventoryRows, macroSlots, spellPeek, strikePeek } from "../scripts/features/pf2e-rail/peeks.mjs";
import { PRESSES } from "../scripts/features/pf2e-rail/presses.mjs";
import { FEATURE_ID, PREFIX } from "../scripts/features/pf2e-rail/const.mjs";
import { FLAGS, SETTINGS } from "../scripts/features/pf2e-rail/settings.mjs";
import * as K from "../scripts/features/pf2e-rail/skill-actions.mjs";
const { SKILL_ACTIONS } = K;
import { STATES } from "./pf2e-rail-fixtures.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8").replace(/\r\n/g, "\n");
const problems = [];
let passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else problems.push(msg); };
const section = (title, fn) => {
  const before = problems.length;
  try { fn(); } catch (e) { problems.push(`${title}: threw ${e?.stack ?? e}`); }
  console.log(`${problems.length === before ? "✓" : "✗"} ${title}`);
};
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/[^\n"'`]*$/gm, "$1");

const DIR = "scripts/features/pf2e-rail/";
const src = Object.fromEntries(["view.mjs", "read.mjs", "turn.mjs", "echo.mjs", "subject.mjs", "peeks.mjs", "presses.mjs", "shape.mjs", "skill-actions.mjs", "host.mjs", "index.mjs", "settings.mjs", "const.mjs", "drive.mjs"].map((f) => [f, read(DIR + f)]));
const css = read("styles/pf2e-rail.css");
const lang = JSON.parse(read("lang/pf2e-rail.en.json"));
const seen = new Set();
const t = (k, d) => { seen.add(k); let s = lang[k] ?? `‹${k}›`; if (d) for (const [a, b] of Object.entries(d)) s = s.replaceAll(`{${a}}`, String(b)); return s; };
const loc = (k) => String(k).replace(/^PF2E\./, "");
const art = (p) => `/art/${p}`;

/* ══ fake PF2e ═════════════════════════════════════════════════════════ */

const stat = (label, mod, rank = 1, extra = {}) => ({ label, mod, rank, dc: { value: 10 + mod }, ...extra });
const cond = (slug, name, value = null) => ({ id: `c-${slug}`, slug, name, type: "condition", img: `/c/${slug}.webp`, system: { value: { value } }, isActive: true });
const item = (id, name, type, sys = {}, extra = {}) => ({ id, name, type, slug: name.toLowerCase().replace(/[^a-z]+/g, "-"), img: `/i/${id}.webp`, sort: 0, system: { traits: { value: [] }, ...sys }, ...extra });
const skillsFor = (ranks) => Object.fromEntries(R.SKILLS.map((s) => [s, stat(s[0].toUpperCase() + s.slice(1), ranks[s]?.[1] ?? 1, ranks[s]?.[0] ?? 0)]));
const strike = (label, mod, o = {}) => ({
  type: "strike", label, totalModifier: mod, ready: o.ready ?? true, visible: true,
  item: { id: `w-${label}`, name: label, img: `/w/${label}.webp`, system: { baseItem: o.base ?? null, traits: { value: o.traits ?? [] } }, range: null, isRanged: false },
  variants: [0, -5, -10].map((p, i) => ({ penalty: p, label: i ? `${mod + p} (MAP ${p})` : `+${mod}` })), traits: [],
});
const base = (o) => ({
  id: o.id, uuid: `Actor.${o.id}`, name: o.name, type: o.type ?? "character", img: `/a/${o.id}.webp`, isOwner: true, hasPlayerOwner: o.pc ?? true,
  level: o.level ?? 5, class: o.cls ? { name: o.cls } : null,
  armorClass: { value: o.ac ?? 20 },
  perception: stat("Perception", o.per ?? 10, 2),
  saves: { fortitude: stat("Fortitude", 12, 2), reflex: stat("Reflex", 10, 2), will: stat("Will", 8, 2) },
  skills: { ...skillsFor(o.ranks ?? { athletics: [2, 14], intimidation: [1, 10] }), ...(o.lores ?? {}) },
  system: {
    attributes: { hp: { value: o.hp?.[0] ?? 40, max: o.hp?.[1] ?? 50, temp: o.temp ?? 0 }, ac: { value: o.ac ?? 20 }, shield: o.shield ?? { itemId: null }, dying: o.dying ?? { value: 0, max: 4 } },
    details: { level: { value: o.level ?? 5 }, ...(o.details ?? {}) },
    resources: o.type && o.type !== "character" ? {} : { heroPoints: { value: o.hero ?? 1, max: 3 } },
    movement: { speeds: { land: { value: 25 } } },
    actions: o.strikes ?? [],
    exploration: o.exploration ?? [],
    traits: { value: o.traits ?? [], size: { value: o.size ?? "med" } },
  },
  itemTypes: { condition: o.conds ?? [], effect: o.effects ?? [], action: o.actions ?? [], feat: o.feats ?? [], consumable: o.consumables ?? [] },
  synthetics: { toggles: o.toggles ?? {} },
  classDC: o.type && o.type !== "character" ? null : { dc: { value: 21 } },
  statuses: new Set(o.statuses ?? []),
  identificationDCs: { standard: { dc: 18 }, skills: ["society"] },
  ...(o.extra ?? {}),
});

const fighter = () => base({
  id: "valeros", name: "Valeros", cls: "Fighter", ac: 23, hp: [68, 76], temp: 5, hero: 2,
  shield: { itemId: "s1", name: "Steel Shield", ac: 2, hp: { value: 14, max: 20 }, hardness: 5, brokenThreshold: 10, raised: false, broken: false, destroyed: false },
  strikes: [strike("+1 Striking Longsword", 14, { base: "longsword" }), strike("Shortbow", 12, { ready: false }), strike("Fist", 12, { traits: ["unarmed", "agile"] })],
  conds: [cond("off-guard", "Off-Guard")],
  actions: [
    item("a1", "Sudden Charge", "action", { actionType: { value: "action" }, actions: { value: 2 } }),
    item("a2", "Reactive Strike", "action", { actionType: { value: "reaction" } }),
    item("a3", "Search", "action", { actionType: { value: "passive" }, traits: { value: ["exploration"] } }),
  ],
  feats: [
    item("f1", "Mountain Stance", "feat", { actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["stance"] } }),
    item("f2", "Battle Medicine", "feat", { actionType: { value: "action" }, actions: { value: 1 }, frequency: { value: 1, max: 1, per: "day" } }),
    item("f3", "Toughness", "feat", { actionType: { value: "passive" } }),
  ],
  effects: [{ id: "e1", slug: "stance-mountain-stance", name: "Stance: Mountain Stance", img: "/e.webp" }],
  consumables: [item("p1", "Healing Potion", "consumable", { quantity: 2, traits: { value: ["consumable", "potion"] } }), item("p2", "Arrows", "consumable", { quantity: 20, category: "ammo", traits: { value: ["consumable"] } }), item("p3", "Chalk", "consumable", { quantity: 10, category: "other" })],
  toggles: { "all": { "power-attack": { itemId: "f9", label: "Power Attack", checked: true, enabled: true }, "hidden": { itemId: "f8", label: "Always", checked: true, alwaysActive: true } } },
  exploration: ["a3"],
  lores: { "warfare-lore": stat("Warfare Lore", 8, 1, { lore: true, slug: "warfare-lore" }) },
});
const caster = () => base({ id: "ezren", name: "Ezren", cls: "Wizard", hp: [29, 52], temp: 6, ranks: { arcana: [3, 17], society: [2, 15] } });
const kineticist = () => base({ id: "nahoa", name: "Nahoa", cls: "Kineticist", conds: [cond("quickened", "Quickened")], strikes: [strike("Fist", 12, { traits: ["unarmed"] })],
  actions: [item("eb", "Elemental Blast", "action", { actionType: { value: "action" }, actions: { value: 1 } }, { slug: "elemental-blast" })] });
const familiar = () => base({ id: "fam", name: "Hoot", type: "familiar", hp: [10, 15], extra: { master: { name: "Ezren" } } });
const ogre = () => base({ id: "ogre", name: "Ogre Warrior", type: "npc", pc: false, level: 3, ac: 17, hp: [50, 50], traits: ["giant"], size: "lg",
  strikes: [strike("Ogre Hook", 12), strike("Javelin", 8)],
  actions: [item("n1", "Reactive Strike", "action", { actionType: { value: "reaction" } }), item("n2", "Sweeping Hook", "action", { actionType: { value: "action" }, actions: { value: 2 } })],
  extra: { isElite: true } });
const trapBase = () => base({ id: "trap", name: "Spear Launcher", type: "hazard", pc: false, level: 2, traits: ["trap", "mechanical"], hp: [32, 32],
  details: { disable: "<p>Thievery <strong>DC 18</strong> (trained)</p>", isComplex: false },
  extra: {} });
const trap = () => { const a = trapBase(); a.system.attributes.stealth = { dc: 20 }; return a; };
const dying = () => base({ id: "valeros", name: "Valeros", cls: "Fighter", hp: [0, 76], dying: { value: 2, max: 4 }, conds: [cond("dying", "Dying", 2), cond("unconscious", "Unconscious"), cond("wounded", "Wounded", 1), cond("prone", "Prone")] });

const SPELL = (id, name, rank, time = "2", extra = {}) => ({ id, name, rank, baseRank: rank, img: `/s/${id}.webp`, system: { time: { value: time }, traits: { value: ["fire"] }, range: { value: "500 feet" }, area: { value: 20, type: "burst" }, defense: { save: { statistic: "reflex", basic: true } } }, ...extra });
const ENTRIES = [
  { id: "arc", name: "Arcane Prepared", isPrepared: true, isFocusPool: false, isRitual: false, dc: 25, atk: 15, groups: [
    { id: "cantrips", active: [{ spell: SPELL("ea", "Electric Arc", 0) }, { spell: SPELL("sh", "Shield", 0, "1") }] },
    { id: 1, uses: { max: 2 }, active: [{ spell: SPELL("fb", "Force Barrage", 1, "1 to 3"), castRank: 1 }, null] },
    { id: 3, uses: { max: 2 }, active: [{ spell: SPELL("fire", "Fireball", 3), castRank: 3 }, { spell: SPELL("fire", "Fireball", 3), castRank: 3, expended: true }] },
    { id: 4, uses: { max: 1 }, active: [{ spell: SPELL("fire", "Fireball", 3), castRank: 4 }] },
  ] },
  { id: "foc", name: "Focus", isPrepared: false, isFocusPool: true, isRitual: false, dc: 25, atk: 15, groups: [{ id: 3, uses: { value: 1, max: 1 }, active: [{ spell: SPELL("fbolt", "Force Bolt", 1, "1") }] }] },
  { id: "rit", name: "Rituals", isRitual: true, groups: [] },
];
const BLASTS = [{ element: "water", label: "Elemental Blast", elementLabel: "Water", img: "/b/water.webp", range: { max: 30 }, damageTypes: [{ value: "bludgeoning", label: "Bludgeoning", selected: true }],
  maps: { melee: { map0: "+15", map1: "+10 (MAP -5)", map2: "+5 (MAP -10)" }, ranged: { map0: "+15", map1: "+10 (MAP -5)", map2: "+5 (MAP -10)" } } }];

const ctxBase = (actor, o = {}) => ({
  actor, token: null, t, loc, config: { baseWeaponTypes: { longsword: "PF2E.Weapon.Base.longsword" }, actorSizes: { lg: "PF2E.ActorSizeLarge" }, creatureTraits: { giant: "PF2E.TraitGiant" }, frequencies: { day: "PF2E.Frequency.day" } },
  readonly: false, stamina: false, mode: "encounter", turn: { mine: true, current: "", round: 2 }, econ: { max: 3, spent: 1, reaction: true }, map: 1,
  formulas: new Map([["0", { damage: "1d8+4 slashing", critical: "2d8+8 slashing" }]]), blasts: null, spells: null, rank: null, tab: null,
  target: { name: "Ogre Warrior", img: "/o.webp", recallSkill: "society", recallDC: 18 },
  know: (s) => ({ ac: 17, reflex: 16, will: { lo: 13, hi: 15 } }[s] ?? null), truth: false,
  party: [{ actor: caster(), observe: true, turn: false }, { actor: base({ id: "meri", name: "Merisiel", conds: [cond("frightened", "Frightened", 2)] }), observe: false, turn: true }],
  pins: ["demoralize"], frame: null, folded: false, ...o,
});

/* ══ shapes: paths a model holds, arrays folded to [] ══════════════════ */

function paths(o, pre = "", out = new Set()) {
  if (Array.isArray(o)) { for (const x of o) paths(x, `${pre}[]`, out); return out; }
  if (o && typeof o === "object") { for (const [k, v] of Object.entries(o)) { out.add(`${pre}.${k}`); paths(v, `${pre}.${k}`, out); } return out; }
  return out;
}
/* Fields the view reads that no fixture happens to carry. Each is named in
   view.mjs; a path here that the view does not read is a reader bug. */
const VIEW_EXTRAS = [".plinth.img", ".plinth.frame", ".plinth.dead", ".plinth.frame.x", ".plinth.frame.y", ".plinth.frame.scale", ".deck.spells.cards[].entry",
  ".vitals.shield.destroyed", ".stack[].turn", ".stack[].self", ".stack[].temp", ".creature.adjust", ".hazard.complex", ".foes.foes[].turn", ".folded", ".readonly",
  ".deck.skills.target.known", ".vitals.sp", ".vitals.sp.value", ".vitals.sp.max", ".turnbar.economy.note", ".turnbar.economy.tone",
  ".deck.skills.suggested[].vs.degrees[]", ".sk.target.recallDC", ".plinth.speed"];
const playerFix = ["martial", "prepared", "spontaneous", "kineticist", "companion", "dying", "stress"].map((k) => STATES[k](art));
const gmFix = ["gm", "hazard", "gm-horde"].map((k) => STATES[k](art));
const union = (models) => { const u = new Set(VIEW_EXTRAS); for (const m of models) for (const p of paths(m)) u.add(p); return u; };
/* `deck.skills.suggested` is the finder's output in both; compare it through the finder, not the fixtures (which leave it to the host). */
const fold = (p) => p.replace(/^\.deck\.skills\.(suggested|target)(\[\])?\..*$/, ".deck.skills.$1");
const allowP = new Set([...union(playerFix)].map(fold)), allowG = new Set([...union(gmFix)].map(fold));

function holds(model, allow, name) {
  const html = V.RAIL(model, t);
  ok(!/undefined|NaN|\[object Object\]/.test(html.replace(/data-[a-z-]+="[^"]*"/g, "")), `${name}: the drawn rail prints undefined/NaN/[object Object]`);
  for (const p of paths(model)) {
    const f = fold(p);
    if (/^\.deck\.skills\.(suggested|target)/.test(f) || f.startsWith(".sk.")) continue;
    ok(allow.has(f), `${name}: the reader emits ${p}, which no fixture draws and view.mjs does not read`);
  }
  return html;
}
function requires(model, fixtureKeys, name) {
  const have = new Set([...paths(model)].map(fold));
  for (const k of fixtureKeys) ok(have.has(k), `${name}: the reader drops ${k}, which the fixtures always carry`);
}

/* ══ the readers ═══════════════════════════════════════════════════════ */

section("the readers are pure", () => {
  for (const f of ["read.mjs", "turn.mjs", "echo.mjs", "subject.mjs", "peeks.mjs", "presses.mjs"]) {
    const code = strip(src[f]);
    for (const g of ["game", "canvas", "ui", "CONFIG", "Hooks", "foundry", "document", "window", "fromUuid"]) ok(!new RegExp(`(?<![.\\w])${g}\\b(?!\\s*:)`).test(code), `${f} reaches ${g}; the check tool and the preview drive it under Node`);
  }
});

section("player readers hold the fixture shape", () => {
  const always = [".role", ".mode", ".turnbar", ".plinth.kind", ".plinth.name", ".plinth.sub", ".vitals.ac", ".vitals.hp.value", ".vitals.hp.max", ".vitals.perception", ".vitals.saves.fortitude",
    ".strikes.list", ".deck.tab", ".deck.tabs[].key", ".deck.actions.toggles", ".deck.actions.list", ".deck.items.list", ".sk.skills", ".stack"];
  const m = R.readPlayer(ctxBase(fighter()));
  holds(m, allowP, "fighter"); requires(m, always, "fighter");
  ok(m.plinth.kind === "character" && m.plinth.sub === "Fighter 5" && m.plinth.speed === "25 ft" && m.plinth.frameable === true, "fighter: plinth kind/sub/speed/frameable");
  ok(JSON.stringify(m.plinth.hero) === "[2,3]" && JSON.stringify(m.plinth.hp) === "[68,76]" && m.plinth.turn === true, "fighter: hero points, hp and the turn mark");
  ok(m.plinth.conds?.[0]?.tone === "danger" && m.plinth.conds[0].name === "Off-Guard", "fighter: off-guard is a danger chip");
  ok(m.vitals.shield?.bt === 10 && m.vitals.shield.raised === false && m.vitals.classDC === 21, "fighter: shield and class DC");
  const [ls, bow] = m.strikes.list;
  ok(ls.id === "0" && JSON.stringify(ls.variants) === JSON.stringify(["+14", "+9", "+4"]) && ls.damage === "1d8+4 slashing" && ls.short === "Weapon.Base.longsword", `fighter: the longsword row (got ${JSON.stringify(ls)})`);
  ok(bow.ready === false, "fighter: a bow not in hand is ready:false");
  ok(m.turnbar.mode === "encounter" && m.turnbar.mine && m.turnbar.map === 1 && m.turnbar.economy.max === 3 && m.turnbar.economy.spent === 1, "fighter: the encounter bar");
  const acts = m.deck.actions.list;
  ok(acts.map((a) => a.name).join("|") === "Sudden Charge|Reactive Strike|Battle Medicine|Mountain Stance", `fighter: action rows (got ${acts.map((a) => a.name)})`);
  ok(acts.at(-1).stance && acts.at(-1).active && acts[1].cost === "r" && acts[0].cost === 2, "fighter: the stance is last and lit; costs read");
  ok(acts[2].freq?.max === 1 && acts[2].freq.used === 0 && acts[2].freq.per === "Frequency.day", "fighter: frequency pips");
  ok(m.deck.actions.toggles.length === 1 && m.deck.actions.toggles[0].id === "all|power-attack|f9" && m.deck.actions.toggles[0].on, "fighter: toggles (always-active ones are not switches)");
  ok(m.deck.items.list.length === 1 && m.deck.items.list[0].qty === 2, "fighter: consumables, ammunition and chalk left out");
  ok(m.sk.skills.unarmed?.mod === 12 && m.sk.lores?.[0]?.slug === "warfare-lore" && m.sk.skills.athletics.rank === 2, "fighter: finder skills, unarmed and lores");
  ok(m.sk.target.defences.reflex === 16 && m.sk.target.defences.fortitude === null && m.sk.target.recallDC === undefined, "fighter: the target as the party knows it; no recall DC for a player");
  ok(m.sk.target.known === "AC 17 · Ref 16 · Will 13–15", `fighter: the known line (got ${m.sk.target.known})`);
  ok(!m.deck.skills.suggested, "fighter: the reader leaves the Skills tab keys to the host (they print the MAP step, a driven value)");
  ok(R.withSkills(m.deck, m.sk, { mode: m.mode, map: 1, t }).skills.suggested?.[0]?.id === "demoralize", "fighter: a pin leads the Skills tab");
  ok(m.stack.length === 2 && m.stack[0].hp && !m.stack[1].hp && m.stack[1].note === "Frightened 2" && m.stack[1].turn, "fighter: a seat without OBSERVER carries no numbers");
  ok(m.util && !m.slim, "fighter: full rail");
  /* Exploring: the bar is the activity, from the character's own exploration items. */
  const x = R.readPlayer(ctxBase(fighter(), { mode: "exploration", turn: null, map: 0 }));
  ok(x.turnbar.mode === "exploration" && x.turnbar.activities.length === 1 && x.turnbar.activities[0].on, "fighter exploring: the activity bar");
  holds(x, allowP, "fighter exploring");
});

section("the caster's hand", () => {
  const m = R.readPlayer(ctxBase(caster(), { spells: ENTRIES, tab: null }));
  holds(m, allowP, "caster");
  const sp = m.deck.spells;
  ok(m.deck.tab === "spells", "caster: a caster opens on Spells");
  ok(sp.ranks.map((r) => r.key).join(",") === "c,1,3,4,f", `caster: ranks c,1,3,4,f in order (got ${sp.ranks.map((r) => r.key)})`);
  ok(sp.dc === 25 && sp.atk === 15 && JSON.stringify(sp.focus) === "[1,1]", "caster: DC, attack and the focus pool");
  const r3 = sp.ranks.find((r) => r.key === 3), r1 = sp.ranks.find((r) => r.key === 1);
  ok(JSON.stringify(r3.slots) === "[1,2]" && JSON.stringify(r1.slots) === "[1,2]", `caster: prepared slots left/max (got ${JSON.stringify(r3.slots)} ${JSON.stringify(r1.slots)})`);
  ok(sp.cards.some((c) => c.socket && c.rank === 1), "caster: an empty prepared slot is a socket");
  const spent = sp.cards.filter((c) => c.rank === 3 && c.spent);
  ok(spent.length === 1 && spent[0].slot === 1 && spent[0].id === "arc.fire.3.1", `caster: an expended slot is a card put down, addressed by slot (got ${JSON.stringify(spent)})`);
  ok(sp.cards.find((c) => c.rank === 4)?.heightened === 4, "caster: a heightened card prints its rank");
  ok(sp.cards.find((c) => c.id.startsWith("arc.fb."))?.cost === "1-3" && sp.cards.find((c) => c.name === "Shield")?.cost === 1, "caster: casting times as costs");
  ok(sp.rank === 4, `caster: the dial opens on the highest rank with a slot left (got ${sp.rank})`);
  ok(m.deck.tabs[0].key === "spells" && m.deck.tabs[0].count === sp.cards.filter((c) => !c.socket && !c.spent).length, "caster: the Spells tab counts castable cards");
  ok(R.spellsOf([ENTRIES[2]]) === null, "caster: rituals alone are no hand");
  ok(R.readPlayer(ctxBase(caster(), { spells: ENTRIES, rank: "f" })).deck.spells.rank === "f", "caster: a chosen rank is kept");
});

section("the kineticist's blasts", () => {
  const m = R.readPlayer(ctxBase(kineticist(), { blasts: BLASTS, econ: new Turn().economy(economyOf(kineticist().itemTypes.condition)), formulas: new Map([["blast:water:m", { damage: "2d8+4 bludgeoning", critical: "4d8+8 bludgeoning" }]]) }));
  holds(m, allowP, "kineticist");
  const [mel, rng] = m.strikes.list;
  ok(mel.kind === "blast" && mel.id === "blast:water:m" && mel.short === "Water" && mel.damage === "2d8+4 bludgeoning", `kineticist: the melee blast (got ${JSON.stringify(mel)})`);
  ok(rng.id === "blast:water:r" && rng.short === "Water 30 ft" && JSON.stringify(rng.variants) === JSON.stringify(["+15", "+10", "+5"]), `kineticist: the ranged blast (got ${JSON.stringify(rng)})`);
  ok(!m.deck.actions.list.some((a) => a.name === "Elemental Blast"), "kineticist: the blast action is a strike row, not an action row");
  ok(m.turnbar.economy.max === 4 && m.turnbar.economy.tone === "good", "kineticist: Quickened is four actions, in green");
  /* PF2e's unconfigured fallback config has empty MAP labels: the steps come from the statistic. */
  const fb = R.blastRows([{ ...BLASTS[0], statistic: { check: { mod: 12 } }, maps: { melee: { map0: "", map1: "", map2: "" }, ranged: { map0: "", map1: "", map2: "" } } }], { t, loc });
  ok(JSON.stringify(fb[0].variants) === JSON.stringify(["+12", "+7", "+2"]), `kineticist: PF2e's fallback blast still draws its MAP steps (got ${JSON.stringify(fb[0].variants)})`);
});

section("familiar, dying, GM and hazard", () => {
  const f = R.readPlayer(ctxBase(familiar()));
  holds(f, allowP, "familiar");
  ok(f.slim && !f.util && f.plinth.kind === "npc" && !f.plinth.hero && f.plinth.sub === "Familiar · Ezren", "familiar: the slim rail, no Hero Points");
  const d = R.readPlayer(ctxBase(dying(), { turn: { mine: false, current: "Ogre Warrior", round: 3 } }));
  holds(d, allowP, "dying");
  ok(JSON.stringify(d.plinth.dying) === '{"value":2,"max":4}' && !d.plinth.conds.some((c) => c.slug === "dying"), "dying: the dying plate, not a dying chip");
  ok(d.plinth.conds.find((c) => c.slug === "prone") && !d.plinth.conds.find((c) => c.slug === "prone").tone, "dying: prone carries no edge");
  ok(d.turnbar.current === "Ogre Warrior" && !d.turnbar.mine && !d.plinth.turn, "dying: off-turn bar");
  const tokens = [
    { id: "t1", name: "Goblin", document: { disposition: 1 }, actor: base({ id: "g", name: "Goblin", type: "npc", pc: false, level: -1, hp: [6, 6] }) },
    { id: "t2", name: "Ogre Warrior", document: { disposition: -1 }, actor: ogre() },
    { id: "t3", name: "Valeros", document: { disposition: 1 }, actor: fighter() },
    { id: "t4", name: "Spear Launcher", document: { disposition: -1 }, actor: trap() },
  ];
  const gmCtx = (actor, tk) => ({ ...ctxBase(actor), token: tk, name: tk?.name, tokens, selected: tk?.id ?? null, turnTokenId: "t2", know: (s) => ({ fortitude: 23, reflex: 21 }[s] ?? null), truth: true, target: { name: "Valeros", img: "/v.webp", recallDC: null } });
  const g = R.readGM(gmCtx(ogre(), tokens[1]));
  holds(g, allowG, "gm");
  requires(g, [".role", ".plinth.kind", ".plinth.name", ".plinth.sub", ".plinth.fold", ".creature.ac", ".creature.hp.value", ".creature.saves.will", ".creature.strikes[].variants", ".creature.abilities[].cost", ".foes.foes[].disp", ".foes.selected", ".stack"], "gm");
  ok(g.plinth.sub === "ActorSizeLarge TraitGiant · Level 3" && g.creature.recallDC === 18 && g.creature.adjust === "Elite", `gm: the creature's line (got ${g.plinth.sub})`);
  ok(g.foes.foes.map((x) => x.id).join(",") === "t2,t4,t1" && g.foes.foes[0].turn && g.foes.selected === "t2", `gm: the hand is hostile first, scene order, no PCs (got ${g.foes.foes.map((x) => x.id)})`);
  ok(g.sk?.target?.recallDC === undefined || g.sk.target.recallDC === null || typeof g.sk.target.recallDC === "number", "gm: the GM finder target");
  ok(g.stack.every((s) => s.hp), "gm: the GM sees every seat's numbers");
  const z = R.readGM(gmCtx(trap(), tokens[3]));
  holds(z, allowG, "hazard");
  ok(z.hazard && z.creature === null && z.hazard.stealthDC === 20 && z.hazard.disable === "Thievery DC 18 (trained)" && z.plinth.kind === "hazard", `hazard: the hazard panel (got ${JSON.stringify(z.hazard)})`);
  const e = R.readGM({ ...gmCtx(null, null), actor: null, tokens: [] });
  ok(e.role === "gm" && !e.foes && e.plinth.fold && !e.creature, "gm with nothing on the scene: the empty panel");
  ok(V.RAIL(e, t).includes("gph-empty"), "gm with nothing on the scene: the empty plate is drawn");
  /* Creatures on the scene and none selected: the hand, never "no creatures on this scene" over it. */
  const n = R.readGM({ ...gmCtx(null, null), actor: null });
  const nh = V.RAIL(n, t);
  ok(n.foes?.foes?.length === 3 && !nh.includes("gph-empty") && nh.includes("gph-foes"), "gm with foes and none selected: the hand without the empty plate");
  /* PF2e authors a Disable line in inline syntax; it must read as words. */
  const iz = R.readGM(gmCtx((() => { const a = trap(); a.system.details.disable = "<p>@Check[thievery|dc:18|name:Disable Thievery] (trained) on the plate, or @Check[type:athletics|dc:20]{Force it open}; see @UUID[Compendium.pf2e.x.Item.y]{Spear}. [[/r 2d6#piercing]] @Damage[2d6[piercing]]</p>"; return a; })(), tokens[3]));
  const want = "Thievery DC 18 (trained) on the plate, or Force it open; see Spear. 2d6 2d6";
  ok(iz.hazard.disable === want, `hazard: PF2e inline syntax reads as words (got ${JSON.stringify(iz.hazard.disable)})`);
});

section("shape and live values", () => {
  const a = R.readPlayer(ctxBase(fighter())), act = fighter();
  act.system.attributes.hp.value = 40; act.system.resources.heroPoints.value = 0;
  const b = R.readPlayer(ctxBase(act));
  ok(S.shapeOf(a) === S.shapeOf(b), "losing Hit Points or a Hero Point is a value change (drive), not a redraw");
  ok(S.liveOf(b).hp.value === 40 && S.liveOf(b).hero === 0, "liveOf carries the new values");
  const c = R.readPlayer(ctxBase(fighter(), { econ: { max: 3, spent: 2, reaction: false }, map: 2 }));
  ok(S.shapeOf(a) === S.shapeOf(c), "spending actions and the MAP step are values");
  ok(S.shapeOf(a) !== S.shapeOf(R.readPlayer(ctxBase(dying()))), "dying is shape");
});

/* ══ presses ═══════════════════════════════════════════════════════════ */

section("every press the view draws has a host handler", () => {
  for (const h of V.HANDLES) ok(PRESSES.attrs.includes(h), `view.mjs HANDLES ${h}, which the host does not answer`);
  const camel = (a) => a.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const onClick = src["host.mjs"].slice(src["host.mjs"].indexOf("async onClick("), src["host.mjs"].indexOf("async check("));
  for (const a of PRESSES.attrs) {
    if (a === "data-find") { ok(/closest\("\[data-find\]"\)/.test(src["host.mjs"]), "the host never reads data-find (typing opens the finder)"); continue; }
    if (a === "data-seat") { ok(/closest\("\[data-seat\]"\)/.test(onClick), "the host never answers a seat"); continue; }
    ok(new RegExp(`\\bd\\.${camel(a)}\\b`).test(onClick), `onClick never reads ${a} (dataset.${camel(a)})`);
  }
  for (const v of PRESSES.acts) ok(onClick.includes(`d.act === "${v}"`), `onClick has no branch for data-act="${v}"`);
  /* The markup of every state, every host-built drawer and peek. */
  const marks = [];
  for (const [name, build] of Object.entries(STATES)) {
    const m = build(art);
    marks.push(V.RAIL({ ...m, util: { ...(m.util ?? {}), open: null } }, t));
    if (m.sk) marks.push(V.FINDER({ ...finderOf(m), expanded: [] }, t));
    if (m.deck?.spells) marks.push(V.RANKS(m.deck.spells, t));
  }
  const fa = fighter();
  marks.push(V.DLIST({ rows: inventoryRows({ itemTypes: { ...fa.itemTypes, weapon: [item("w", "Longsword", "weapon", { quantity: 1, equipped: { carryType: "held", handsHeld: 1 } })] } }, t) }, t));
  marks.push(V.DLIST({ rows: effectRows(dying()) }, t), V.REST(t), V.MACROS({ page: 1, slots: macroSlots([{ slot: 1, macro: { id: "m1", name: "Hi" } }, { slot: 2 }]) }, t));
  const ps = [strikePeek(fa.system.actions[0], { t, loc, mod: "+14", damage: "1d8", critical: "2d8" }), spellPeek(SPELL("fire", "Fireball", 3), { t, rank: 3, entryName: "Arcane", dc: 25 }), actionPeek(fa.itemTypes.feat[1], { t })];
  for (const p of ps) marks.push(V.PEEK(p, t));
  const html = marks.join("\n");
  const tags = html.match(/<(button|div)\b[^>]*>/g) ?? [];
  const acts = new Set(), drawers = new Set(), rows = new Set(), pas = new Set();
  for (const tag of tags) {
    const isButton = tag.startsWith("<button");
    for (const [, k, v] of tag.matchAll(/\s(data-[a-z-]+)(?:="([^"]*)")?/g)) {
      if (isButton && V.HANDLES.includes(k)) ok(PRESSES.attrs.includes(k), `a press carries ${k}, which the host does not answer`);
      if (k === "data-act") acts.add(v);
      if (k === "data-drawer") drawers.add(v);
      if (k === "data-row") rows.add(v.split(":")[0]);
      if (k === "data-pa") pas.add(v);
    }
  }
  for (const v of acts) ok(PRESSES.acts.includes(v), `the view draws data-act="${v}", which the host does not answer`);
  for (const v of drawers) ok(PRESSES.drawers.includes(v), `the view draws data-drawer="${v}", which the host cannot open`);
  for (const v of rows) ok(ROW_KEYS.includes(v), `a drawer row "${v}:" has no host branch`);
  for (const k of ROW_KEYS) ok(src["host.mjs"].includes(`kind === "${k}"`), `pressRow has no branch for "${k}:"`);
  for (const v of pas) ok(PEEK_PRESSES.includes(v), `a peek carries data-pa="${v}", which the host does not answer`);
  for (const k of PEEK_PRESSES) ok(src["host.mjs"].includes(`pa === "${k}"`), `pressPeek has no branch for "${k}"`);
  for (const d of PRESSES.drawers.filter((x) => x !== "sheet")) ok(src["host.mjs"].includes(`kind === "${d}"`), `the host builds no "${d}" drawer`);
  /* Every skill action the finder offers is one PF2e defines: a new-style action or a legacy function. */
  const pf2e = readPf2eActions();
  if (pf2e) for (const a of SKILL_ACTIONS) ok(pf2e.has(a.slug) || pf2e.has(a.slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase())), `PF2e 8.7 defines no action "${a.slug}": its press would do nothing`);
});

function finderOf(m) { return K.finderModel({ ...m.sk, query: "", group: "all", sel: 0, mode: m.mode ?? "encounter", map: m.turnbar?.map ?? 0, t }); }

/** The slugs and legacy names `game.pf2e.actions` carries, read from the
 *  local PF2e bundle when there is one. */
function readPf2eActions() {
  const home = process.env.HOME ?? "";
  for (const p of [`${home}/.local/share/FoundryVTT/Data/systems/pf2e/pf2e.mjs`]) {
    try {
      const b = readFileSync(p, "utf8");
      const out = new Set([...b.matchAll(/slug: `([a-z-]+)`/g)].map((m) => m[1]));
      const im = /Im = \{([^}]*)\}/.exec(b);
      if (im) for (const n of im[1].split(",")) out.add(n.trim());
      /* and what zm attaches beside them: raiseAShield, restForTheNight, earnIncome… */
      const zm = /Object\.entries\(\{([^}]*?)\.\.\.Im/.exec(b);
      if (zm) for (const n of zm[1].split(",")) out.add(n.split(":")[0].trim());
      console.log(`  (PF2e actions read from ${p})`);
      return out;
    } catch { /* no local PF2e */ }
  }
  console.log("  (no local PF2e bundle: skill-action slugs not checked)");
  return null;
}

/* ══ the turn, the echo, the gates ═════════════════════════════════════ */

section("the action economy is local and follows PF2e's counts", () => {
  ok(economyOf([]).max === 3 && !economyOf([]).note, "three actions");
  ok(economyOf([cond("quickened", "Quickened")]).max === 4, "Quickened: four");
  ok(economyOf([cond("slowed", "Slowed", 1)]).max === 2 && economyOf([cond("slowed", "Slowed", 1)]).tone === "danger", "Slowed 1: two, in red");
  ok(economyOf([cond("stunned", "Stunned", 2), cond("quickened", "Quickened")]).max === 2, "Stunned 2 and Quickened: two");
  ok(economyOf([cond("stunned", "Stunned", 1), cond("slowed", "Slowed", 2)]).max === 1, "Stunned 1 and Slowed 2: one (the larger loss, never the sum)");
  const tn = new Turn();
  ok(tn.sync("c:1:0", true) === true && tn.spent === 0, "a new turn refills");
  tn.spend(2, false, { mine: true, max: 3 }); tn.spend(1, true, { mine: true, max: 3 });
  ok(tn.spent === 3 && tn.map === 1, "two then an attack: three spent, MAP −5");
  ok(tn.sync("c:1:0", true) === false && tn.spent === 3, "a refresh inside the same turn keeps the tally");
  ok(tn.spend(1, true, { mine: false, max: 3 }) === false && tn.spend("r", false, { mine: false, max: 3 }) === true && !tn.reaction, "off-turn only a reaction is spent");
  tn.sync("c:2:0", true);
  ok(tn.spent === 0 && tn.map === 0 && tn.reaction, "the next turn refills actions, reaction and MAP");
  tn.pip(0, 3);
  ok(tn.spent === 3, "pressing the first lit diamond spends all three");
  ok(turnKey({ id: "c", round: 2, turn: 1 }) === "c:2:1" && turnKey(null) === null, "the turn key");
  ok(!/setFlag|update\(|setting\(/.test(strip(src["turn.mjs"])), "turn.mjs writes nothing");
  const hostSpend = src["host.mjs"].slice(src["host.mjs"].indexOf("spend(cost, attack = false)"), src["host.mjs"].indexOf("deny(el)"));
  ok(!/setFlag|actor\.update|emitSocket|game\.settings\.set/.test(hostSpend), "the host's spend() stores or syncs the tally");
});

section("a secret roll never echoes, and the stream login never does", () => {
  const msg = (o = {}) => ({ rolls: [{ total: 23 }], whisper: [], blind: false, author: { id: "u1" }, speaker: { actor: "valeros" }, flags: { pf2e: { context: { outcome: "success" } } }, ...o });
  ok(echoOf(msg(), { userId: "u1", degreeShown: true, words: ["a", "b", "c", "d"] })?.degree === 2, "a public roll echoes its total and degree");
  ok(echoOf(msg(), { userId: "u1", degreeShown: false })?.degree === null, "the degree only where PF2e would show it");
  ok(echoOf(msg({ blind: true }), { userId: "u1", degreeShown: true }) === null, "a blind roll never echoes");
  ok(echoOf(msg({ blind: true }), { userId: "gm", degreeShown: true }) === null, "a blind roll never echoes, even for the GM");
  ok(echoOf(msg({ whisper: ["gm"], author: { id: "u2" } }), { userId: "u1" }) === null, "a whisper the viewer is not in never echoes");
  ok(echoOf(msg({ isContentVisible: false }), { userId: "u1" }) === null, "content Foundry hides never echoes");
  ok(echoOf(msg(), { userId: "u1", stream: true, degreeShown: true }) === null, "the stream login never echoes");
  ok(answers(msg(), { actorId: "valeros", at: 0 }, { userId: "u1", now: 100 }) && !answers(msg(), { actorId: "valeros", at: 0 }, { userId: "u2", now: 100 }), "only the presser's own roll answers the press");
  ok(!answers(msg(), { actorId: "valeros", at: 0 }, { userId: "u1", now: 60_000 }), "a late message answers nothing");
  ok(/echoOf\(message, \{[^}]*stream: this\.stream/.test(src["host.mjs"]), "the host passes the stream flag to echoOf");
  ok(/degreeShown: seesTruth\(\) \|\| metagame\("results"\)/.test(src["host.mjs"]), "the host shows a degree only to the truth or under PF2e's metagame results setting");
  ok(!shouldMount({ system: "pf2e", stream: true }), "the stream login never mounts");
  ok(!shouldMount({ system: "pf2e", pf2eHud: true }), "never beside pf2e-hud");
  ok(!shouldMount({ system: "dnd5e" }) && shouldMount({ system: "pf2e" }), "pf2e only");
  const idx = strip(src["index.mjs"]);
  ok(idx.indexOf("shouldMount(") > -1 && idx.indexOf("shouldMount(") < idx.indexOf("new RailHost"), "index.mjs asks shouldMount before it builds the host");
  ok(/stream:\s*isStream\(\)/.test(idx) && /pf2eHud/.test(idx), "index.mjs hands shouldMount the stream login and pf2e-hud");
  ok(!/Hooks\.on|document\.|new RailHost/.test(idx.slice(0, idx.indexOf("Suite.register("))), "index.mjs does nothing at import time");
  ok(!/\bHooks\.on\(/.test(idx), "index.mjs wires no hooks itself; the host does, from onReady");
});

section("whose rail it is", () => {
  const pc = { id: "p", type: "character" }, npc = { id: "n", type: "npc" }, fam = { id: "f", type: "familiar" }, hz = { id: "h", type: "hazard" };
  ok(subjectOf({ isGM: false, controlled: [{ id: "t", actor: fam }] })?.actor === fam, "a player's controlled familiar is the subject");
  ok(subjectOf({ isGM: false, controlled: [], character: pc })?.actor === pc, "then the assigned character");
  ok(subjectOf({ isGM: false, controlled: [], sceneTokens: [{ actor: pc }] })?.actor === pc, "then an owned character on the scene");
  ok(subjectOf({ isGM: false, controlled: [], sceneTokens: [] }) === null, "a player with nothing has no rail");
  ok(subjectOf({ isGM: true, controlled: [{ actor: npc }] }).role === "gm" && subjectOf({ isGM: true, controlled: [{ actor: hz }] }).actor === hz, "a GM's NPC or hazard is the GM rail");
  ok(subjectOf({ isGM: true, controlled: [{ actor: pc }] }).role === "player", "a GM controlling a character gets its player rail");
  ok(subjectOf({ isGM: true, controlled: [] }).actor === null, "a GM with nothing: the panel with no creature");
  const combat = { started: true, scene: { id: "s" }, combatant: { tokenId: "t1" }, combatants: [{ tokenId: "t1", actorId: "n" }] };
  ok(combatOf([combat], npc, { id: "t1" }, "s") === combat && combatOf([{ ...combat, started: false }], npc, { id: "t1" }, "s") === null, "an encounter only once the combat has started");
  ok(combatOf([combat], npc, { id: "t1" }, "other") === null, "and only on this scene");
  ok(isTurnOf(combat.combatant, npc, { id: "t1" }) && !isTurnOf(combat.combatant, npc, { id: "t2" }), "two tokens of one actor are two turns");
});

/* ══ keys ══════════════════════════════════════════════════════════════ */

section("settings and flags are ph.", () => {
  ok(FEATURE_ID === "pf2e-rail" && PREFIX === "ph.", "feature id and prefix");
  for (const v of [...Object.values(SETTINGS), ...Object.values(FLAGS)]) ok(v.startsWith("ph."), `${v} is not under ph.`);
  const idx = src["index.mjs"];
  ok(/settingPrefix:\s*PREFIX/.test(idx) && /system:\s*"pf2e"/.test(idx) && /defaultEnabled:\s*false/.test(idx), "the adapter declares ph., pf2e and off by default");
  ok(/frame: "ph\.frame"/.test(src["settings.mjs"]) && /pins: "ph\.pins"/.test(src["settings.mjs"]), "the frame is ph.frame and the pins ph.pins");
  for (const m of src["host.mjs"].matchAll(/(?:set|get)Flag\(SUITE_ID,\s*([^,)]+)/g)) ok(/^FLAGS\.\w+$/.test(m[1].trim()), `a flag written outside FLAGS: ${m[1]}`);
  for (const m of src["settings.mjs"].matchAll(/register\(SUITE_ID,\s*([^,]+),/g)) ok(/^SETTINGS\.\w+$/.test(m[1].trim()), `a setting registered outside SETTINGS: ${m[1]}`);
  ok(/actor\.setFlag\(SUITE_ID, FLAGS\.frame/.test(src["host.mjs"]) && /game\.user\.setFlag\(SUITE_ID, FLAGS\.pins/.test(src["host.mjs"]), "the frame is the actor's, the pins the user's");
  const reg = read("scripts/features/index.mjs"), mod = JSON.parse(read("module.json"));
  ok(reg.includes('import "./pf2e-rail/index.mjs";'), "features/index.mjs imports the adapter");
  ok(mod.styles.includes("styles/pf2e-rail.css") && mod.languages.some((l) => l.path === "lang/pf2e-rail.en.json"), "module.json loads the skin and the strings");
});

/* ══ i18n ══════════════════════════════════════════════════════════════ */

section("every key resolves, including the runtime-built ones", () => {
  const families = [
    ...["perception", "fortitude", "reflex", "will", "stealth", "deception"].map((k) => `GLRAIL.check.${k}`),
    ...["perception", "fortitude", "reflex", "will"].map((k) => `GLRAIL.check.${k}Short`),
    ...["spells", "actions", "skills", "items"].map((k) => `GLRAIL.tab.${k}`),
    ...["rest", "macros", "sheet", "effects", "inventory", "strikes", "foes"].map((k) => `GLRAIL.drawer.${k}`),
    ...[0, 1, 2, 3, 4].flatMap((r) => [`GLRAIL.prof.${r}`, `GLRAIL.prof.${r}Short`]),
    ...["1", "2", "3", "r", "f", "range"].map((c) => `GLRAIL.cost.${c}`),
    ...["hostile", "friendly", "neutral", "secret"].map((d) => `GLRAIL.disp.${d}`),
    ...["dying", "dead"].map((s) => `GLRAIL.state.${s}`),
    ...[0, 1, 2, 3].map((i) => `GLRAIL.degree.${i}`),
    "GLS.feature.pf2e-rail.title", "GLS.feature.pf2e-rail.hint",
  ];
  /* Foundry expands every lang file with expandObject: a key that is also the
     head of another ("GLRAIL.deck" beside "GLRAIL.deck.expand") throws, and the
     WHOLE file is dropped — every string on the rail prints its key. */
  const keys = Object.keys(lang);
  for (const k of keys) ok(!keys.some((o) => o.startsWith(`${k}.`)), `lang key ${k} is also the head of another key; Foundry drops the whole file`);
  for (const k of families) ok(k in lang, `missing ${k}`);
  for (const [f, s] of Object.entries(src)) for (const m of s.matchAll(/["`]((?:GLRAIL|GLS)\.[A-Za-z0-9_.-]+[A-Za-z0-9])["`]/g)) ok(m[1] in lang, `${f} uses ${m[1]}, which lang/pf2e-rail.en.json lacks`);
  for (const k of seen) ok(k in lang, `a render asked for ${k}, which does not resolve`);
});

/* ══ the skin ══════════════════════════════════════════════════════════ */

function ruleSelectors(text) {
  const out = []; let prelude = ""; const stack = [];
  for (const ch of text.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      const head = prelude.trim(); prelude = "";
      if (stack.includes("kf") || head.startsWith("@keyframes")) { stack.push("kf"); continue; }
      if (head.startsWith("@")) { stack.push("at"); continue; }
      stack.push("rule");
      let depth = 0, cur = "";
      for (const c of head) { if (c === "(") depth++; if (c === ")") depth--; if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += c; }
      if (cur.trim()) out.push(cur.trim());
    } else if (ch === "}") { stack.pop(); prelude = ""; } else if (ch === ";") prelude = ""; else prelude += ch;
  }
  return out;
}

section("the skin is scoped", () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/:root\b/.test(bare), "pf2e-rail.css writes on :root");
  for (const s of ruleSelectors(bare)) ok(/^(?:[a-z]+)?(?::is\(|:where\()?\.gph(?:-[\w-]+)?(?![\w-])/.test(s), `a rule outside the .gph names: ${s}`);
  for (const m of bare.matchAll(/(?:^|[;{\s])(--gl-[\w-]+)\s*:/g)) problems.push(`pf2e-rail.css redeclares the foundation token ${m[1]}`);
  for (const m of bare.matchAll(/@keyframes\s+([\w-]+)/g)) ok(m[1].startsWith("gph-"), `keyframes ${m[1]} is not gph-`);
  for (const m of bare.matchAll(/@property\s+(--[\w-]+)/g)) ok(m[1].startsWith("--gph-"), `@property ${m[1]} is not --gph-`);
  ok(!/prefers-reduced-motion/.test(bare) && !/prefers-reduced-motion/.test(strip(Object.values(src).join("\n"))), "the suite does not honour prefers-reduced-motion");
  for (const m of bare.matchAll(/(?:transition|animation)(?:-duration|-delay)?\s*:([^;]*);/g)) {
    const raw = m[1].replace(/var\([^)]*\)/g, "").replace(/calc\([^;]*\)/g, "");
    ok(!/\b\d*\.?\d+m?s\b/.test(raw), `a raw duration: ${m[0].trim()}`);
  }
  for (const m of bare.matchAll(/font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)px/g)) ok(+m[1] >= 11, `type under 11px: ${m[0].trim()}`);
  ok(!/@import|@font-face/.test(bare), "no @import or @font-face");
  ok(!/rgba\(255,\s*255,\s*255/.test(bare), "no raw white veils");
});

section("the host keeps to its own corner", () => {
  const h = strip(src["host.mjs"]);
  ok(!/game\.socket|emitSocket/.test(h), "the host syncs nothing");
  ok(!/\.roll\(\{[^}]*dialog/i.test(h) && !/new\s+\w*Dialog/.test(h), "no HUD roll dialog: every press is PF2e's own");
  ok(/style\.display = hide \? "none" : ""/.test(h), "the hotbar is hidden, and given back");
  ok(/--gph-rail-top/.test(h), "the rail publishes its top edge");
  ok(/Budget\.claimMotion/.test(h) === false, "the rail animates only on input, so it claims no motion");
  ok(/hidden[^\n]*GLRAIL\.turnbar\.someone|GLRAIL\.turnbar\.someone[^\n]*hidden/.test(h) || /veiled[\s\S]{0,200}GLRAIL\.turnbar\.someone/.test(h), "a hidden combatant's name never reaches a player's turn bar");
  ok(/variants[\s\S]{0,400}kind: "variant"/.test(h) && /variant: kind/.test(h), "an action with several PF2e variants asks which, and passes it to use()");
  ok(/spendCtx\(\)[\s\S]{0,40}await/.test(h) && !/await [^;]+;\s*(return )?this\.spend\([^)]*\)\s*;?\s*(\}|$)/m.test(h.replace(/this\.spend\([^)]*ctx\)/g, "")), "every press that awaits PF2e spends against the context it started in");
  ok(/turnKey\(ctx\.combat\) !== ctx\.key/.test(h), "a pending press checks its own combat's live turn before spending");
  ok(/updateSetting[\s\S]{0,240}clearKnowledgeCache/.test(h), "a knowledge change refreshes the rail");
  ok(/hotbar\(hide = !!this\.el && !!this\.model/.test(h), "the hotbar is hidden only while a rail is drawn");
});

console.log(problems.length ? `\n${problems.length} problem(s):\n  ${problems.join("\n  ")}` : `\nall ${passed} checks passed`);
process.exit(problems.length ? 1 : 0);
