/**
 * Creaturedexing — cutting a PF2e stat block into the book's three sections.
 *
 * The book prints the exact field list for each section (pp. 78) and this
 * module is that list, in that order, read off a PF2e actor. Everything here is
 * pure property reads: no `game`, no `i18n`, no DOM — a row carries a *key* and
 * a value, and the renderer localises it. That is what lets
 * `tools/creaturedex-check.mjs` feed a fixture actor in and assert that every
 * field the book names lands in the section the book puts it in, which is the
 * one thing about this feature a diff cannot show you.
 *
 * ## The seam that makes this cheap
 *
 * PF2e already sorts an NPC's abilities into `system.category` — `interaction`,
 * `defensive`, `offensive`. Those are the book's own three headings under
 * different names ("Interaction Abilities", "Automatic/Reactive Abilities",
 * "Offensive or Proactive Abilities"), so an ability routes itself. Where a
 * category is missing — homebrew, an importer that never set one — the action
 * type decides: a reaction is reactive, a passive is automatic, and anything
 * else is proactive. Guessing wrong there puts a real ability in the wrong
 * section, which reads to the table as the GM revealing the wrong thing.
 *
 * ## Empty rows are dropped, and that is a rules decision
 *
 * A section prints only the rows the subject actually has. Printing "Weaknesses
 * —" tells a player there are none, which is knowledge they did not buy: an
 * absent row is genuinely ambiguous between "none" and "not learned", and this
 * feature is built entirely on that distinction.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { ALL_SECTION_KEYS, FLAGS } from "./constants.mjs";

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

const signed = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v}` : "";
};

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

const SIZES = { tiny: "Tiny", sm: "Small", med: "Medium", lg: "Large", huge: "Huge", grg: "Gargantuan" };

const ACTION_GLYPH = { 1: "1", 2: "2", 3: "3" };

/** Which of the two section tables this subject uses, or null if neither. */
export function subjectKind(actor) {
  const type = actor?.type ?? null;
  if (type === "hazard") return "hazard";
  if (type === "npc") return "creature";
  return null;
}

/* ── shared readers ───────────────────────────────────────────────────────── */

function iwr(actor) {
  const a = actor?.system?.attributes ?? {};
  const fmt = (entries, withValue) =>
    list(entries)
      .map((e) => {
        const label = e?.type ?? e?.label ?? String(e);
        const value = withValue && e?.value != null ? ` ${e.value}` : "";
        const except = list(e?.exceptions).length ? ` (except ${list(e.exceptions).join(", ")})` : "";
        return `${label}${value}${except}`;
      })
      .filter(Boolean);
  return {
    immunities: fmt(a.immunities, false).join(", "),
    weaknesses: fmt(a.weaknesses, true).join(", "),
    resistances: fmt(a.resistances, true).join(", "),
  };
}

function savesLine(actor) {
  const s = actor?.system?.saves ?? {};
  const parts = ["fortitude", "reflex", "will"]
    .map((k) => {
      const v = signed(s?.[k]?.value);
      if (!v) return "";
      const detail = s[k]?.saveDetail ? ` (${s[k].saveDetail})` : "";
      return `${k[0].toUpperCase()}${k.slice(1)} ${v}${detail}`;
    })
    .filter(Boolean);
  const all = actor?.system?.attributes?.allSaves?.value;
  if (all) parts.push(String(all));
  return parts.join(", ");
}

function speedLine(actor) {
  const sp = actor?.system?.attributes?.speed ?? {};
  const parts = [];
  if (sp.value != null && sp.value !== "") parts.push(`${sp.value} feet`);
  for (const other of list(sp.otherSpeeds)) {
    const label = other?.type ?? other?.label;
    if (label) parts.push(`${label} ${other.value} feet`);
  }
  if (sp.details) parts.push(`(${sp.details})`);
  return parts.join(", ");
}

/**
 * The action cost of an ability, as the glyph a stat block prints.
 *
 * A cost is not decoration: "three actions" and "reaction" are different
 * abilities, and the Offense section is where a player decides what they can
 * afford to bait out.
 */
function costOf(system) {
  const type = system?.actionType?.value ?? "action";
  if (type === "reaction") return "reaction";
  if (type === "free") return "free";
  if (type === "passive") return "passive";
  return ACTION_GLYPH[system?.actions?.value] ?? "1";
}

const abilityEntry = (item) => ({
  name: item?.name ?? "",
  cost: costOf(item?.system),
  traits: list(item?.system?.traits?.value),
  html: item?.system?.description?.value ?? "",
});

/**
 * Route one ability to a section, or admit that we cannot.
 *
 * A GM's own override wins outright — that is what an override is for. Then
 * PF2e's `system.category`, which enumerates `interaction` / `defensive` /
 * `offensive` and is the book's three headings under other names.
 *
 * And then **null**, not a guess. The field's schema default is `null`, PF2e's
 * own NPC sheet never reads it (it groups abilities by action cost instead) and
 * its only consumer anywhere in the system is a compendium-browser filter — so
 * nothing pressures Paizo's bestiary data to fill it in, and most abilities
 * arrive untagged. Guessing from the action cost gets a majority right and the
 * rest *leak*: an offensive ability filed under Defense hands a player exactly
 * the information they did not buy, and the stat block still looks ordinary.
 *
 * Returning null is what lets `buildSections` defer those to completion
 * instead, which makes the uncertain case safe rather than leaky.
 */
export function abilitySection(item) {
  const override = item?.flags?.[SUITE_ID]?.[FLAGS.section] ?? null;
  if (override && ALL_SECTION_KEYS.includes(override)) return override;
  const category = item?.system?.category ?? null;
  if (category === "interaction") return "characteristics";
  if (category === "defensive") return "defense";
  if (category === "offensive") return "offense";
  return null;
}

function abilitiesBySection(actor) {
  const out = { characteristics: [], defense: [], offense: [], deferred: [] };
  for (const item of list(actor?.itemTypes?.action)) {
    const key = abilitySection(item);
    out[key ?? "deferred"].push(abilityEntry(item));
  }
  return out;
}

/** NPC attacks are `melee` items either way; `system.range` splits the two. */
function strikes(actor) {
  const melee = [];
  const ranged = [];
  for (const item of list(actor?.itemTypes?.melee)) {
    const s = item.system ?? {};
    const damage = Object.values(s.damageRolls ?? {})
      .map((d) => `${d.damage} ${d.damageType}`)
      .filter(Boolean)
      .join(", ");
    const entry = {
      name: item.name,
      bonus: signed(s.bonus?.value),
      damage,
      traits: list(s.traits?.value),
      effects: list(s.attackEffects?.value),
      range: s.range?.increment ? `${s.range.increment} ft.` : "",
    };
    (s.range ? ranged : melee).push(entry);
  }
  return { melee, ranged };
}

/**
 * Spellcasting entries, split the way the book's Offense list splits them:
 * Spells, Innate Spells, Focus Spells, Rituals are four separate lines.
 */
function spellBlocks(actor) {
  const spells = list(actor?.itemTypes?.spell);
  return list(actor?.itemTypes?.spellcastingEntry).map((entry) => {
    const s = entry.system ?? {};
    const prepared = s.prepared?.value ?? "";
    const kind =
      prepared === "innate" ? "innate" : prepared === "focus" ? "focus" : prepared === "ritual" ? "ritual" : "spells";
    const byRank = new Map();
    for (const spell of spells.filter((sp) => sp.system?.location?.value === entry.id)) {
      const label = list(spell.system?.traits?.value).includes("cantrip")
        ? "Cantrips"
        : `Rank ${spell.system?.level?.value ?? "?"}`;
      if (!byRank.has(label)) byRank.set(label, []);
      byRank.get(label).push(spell.name);
    }
    return {
      kind,
      name: entry.name,
      dc: s.spelldc?.dc ? `DC ${s.spelldc.dc}` : "",
      attack: signed(s.spelldc?.value) ? `attack ${signed(s.spelldc.value)}` : "",
      tradition: s.tradition?.value ?? "",
      ranks: [...byRank.entries()].map(([label, names]) => ({ label, names })),
    };
  });
}

/* ── the two section tables ───────────────────────────────────────────────── */

const row = (key, value) => ({ key, value: value == null ? "" : String(value).trim() });

/** Drop rows with nothing in them — see the module note on absent vs. none. */
const rows = (list_) => list_.filter((r) => r.value !== "");

function creatureSections(actor) {
  const sys = actor?.system ?? {};
  const abilities = abilitiesBySection(actor);
  const { immunities, weaknesses, resistances } = iwr(actor);
  const { melee, ranged } = strikes(actor);
  const spells = spellBlocks(actor);
  const carried = list(actor?.items?.contents ?? actor?.items)
    .filter((i) => ["weapon", "armor", "shield", "equipment", "consumable", "backpack", "treasure"].includes(i?.type))
    .map((i) => (Number(i.system?.quantity) > 1 ? `${i.name} (${i.system.quantity})` : i.name))
    .join(", ");

  const perception = [
    signed(sys.perception?.mod ?? sys.attributes?.perception?.value),
    list(sys.perception?.senses)
      .map((s) => s?.type ?? s?.label ?? s)
      .join(", "),
    sys.perception?.details ?? "",
  ]
    .filter(Boolean)
    .join("; ");

  return [
    {
      key: "characteristics",
      rows: rows([
        row("level", sys.details?.level?.value),
        row("rarity", sys.traits?.rarity),
        row("size", SIZES[sys.traits?.size?.value] ?? sys.traits?.size?.value),
        row("traits", list(sys.traits?.value).join(", ")),
        row("perception", perception),
        row("languages", [list(sys.details?.languages?.value).join(", "), sys.details?.languages?.details].filter(Boolean).join("; ")),
        row(
          "skills",
          Object.entries(sys.skills ?? {})
            .map(([slug, d]) => {
              const mod = d?.base ?? d?.mod ?? d?.value;
              return Number.isFinite(Number(mod)) ? `${slug} ${signed(mod)}` : "";
            })
            .filter(Boolean)
            .join(", ")
        ),
        row(
          "attributes",
          ABILITY_KEYS.map((k) => {
            const mod = sys.abilities?.[k]?.mod;
            return Number.isFinite(Number(mod)) ? `${k[0].toUpperCase()}${k.slice(1)} ${signed(mod)}` : "";
          })
            .filter(Boolean)
            .join(", ")
        ),
        row("items", carried),
      ]),
      abilities: abilities.characteristics,
    },
    {
      key: "defense",
      rows: rows([
        row("ac", [sys.attributes?.ac?.value, sys.attributes?.ac?.details].filter((v) => v != null && v !== "").join(" ")),
        row("saves", savesLine(actor)),
        row("hp", [sys.attributes?.hp?.max, sys.attributes?.hp?.details].filter((v) => v != null && v !== "").join(" ")),
        row("immunities", immunities),
        row("weaknesses", weaknesses),
        row("resistances", resistances),
      ]),
      abilities: abilities.defense,
    },
    {
      key: "offense",
      rows: rows([row("speed", speedLine(actor))]),
      strikes: { melee, ranged },
      spells,
      abilities: abilities.offense,
    },
  ];
}

function hazardSections(actor) {
  const sys = actor?.system ?? {};
  const { immunities, weaknesses, resistances } = iwr(actor);
  const stealth = sys.attributes?.stealth ?? {};

  return [
    {
      key: "complexity",
      rows: rows([
        row("level", sys.details?.level?.value),
        row("complexity", sys.details?.isComplex ? "complex" : "simple"),
        row("rarity", sys.traits?.rarity),
        row("traits", list(sys.traits?.value).join(", ")),
        row("stealth", [signed(stealth.value), stealth.details].filter(Boolean).join(" ")),
      ]),
      prose: sys.details?.description ?? "",
      abilities: [],
    },
    {
      key: "disable",
      rows: rows([
        row("ac", sys.attributes?.ac?.value),
        row("saves", savesLine(actor)),
        row("hardness", sys.attributes?.hardness),
        row("hp", sys.attributes?.hp?.max ?? sys.attributes?.hp?.value),
        row("immunities", immunities),
        row("weaknesses", weaknesses),
        row("resistances", resistances),
      ]),
      prose: sys.details?.disable ?? "",
      // A hazard's trigger is an action in PF2e's data and lands here rather
      // than under Routine: the book puts "Trigger Action" in Disable and
      // Trigger, and knowing what sets a trap off is how you avoid setting it
      // off, not how you predict what it does next.
      abilities: list(actor?.itemTypes?.action)
        .filter((i) => i?.system?.actionType?.value === "reaction")
        .map(abilityEntry),
    },
    {
      key: "routine",
      rows: rows([row("reset", sys.details?.reset)]),
      prose: sys.details?.routine ?? "",
      abilities: list(actor?.itemTypes?.action)
        .filter((i) => i?.system?.actionType?.value !== "reaction")
        .map(abilityEntry)
        .concat(list(actor?.itemTypes?.melee).map((i) => ({
          name: i.name,
          cost: "1",
          traits: list(i.system?.traits?.value),
          html: i.system?.description?.value ?? "",
        }))),
    },
  ];
}

/**
 * Every section of a subject, in printed order.
 *
 * A section with no rows, no abilities and no prose is dropped entirely — that
 * is what makes the book's "you need only reveal the number of sections it has
 * available" rule computable rather than a judgement call at the table.
 */
export function buildSections(actor) {
  const kind = subjectKind(actor);
  if (!kind) return { kind: null, sections: [], deferred: [] };
  const all = kind === "hazard" ? hazardSections(actor) : creatureSections(actor);
  const sections = all.filter(
    (s) => s.rows.length || s.abilities?.length || s.prose || s.spells?.length || s.strikes?.melee?.length || s.strikes?.ranged?.length
  );
  return { kind, sections, deferred: kind === "hazard" ? [] : abilitiesBySection(actor).deferred };
}

/** The keys a subject can actually have revealed. */
export const availableSections = (actor) => buildSections(actor).sections.map((s) => s.key);
