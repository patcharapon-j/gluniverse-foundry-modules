/**
 * Mythic GME: the meaning tables, named for what they are.
 *
 * Pure. `data/tables.mjs` is the bundled data and is never edited by hand. Its
 * four `MEANING` columns were filed one place off when it was generated:
 *
 *   MEANING.action1      is Actions Table 2      (Advantage, Adversity, ...)
 *   MEANING.action2      is Descriptions Table 1 (Adventurously, Aggressively, ...)
 *   MEANING.descriptor1  is Descriptions Table 2 (Abnormal, Amusing, ...)
 *   MEANING.descriptor2  is the Locations elements table (Abandoned, Active, ...)
 *
 * and Actions Table 1 (the verbs) never made it into the file. So before the
 * remake an "Action" roll paired a noun with an adverb and a "Description" roll
 * paired an adjective with a place. This module is the only reader of the raw
 * columns and maps them back. Actions Table 1 is not bundled: a GM who owns the
 * book can link a RollTable for it (`mythic.actions1`), and until then an
 * Actions roll reads Table 2 alone and says so.
 */

import { ELEMENTS, MEANING } from "./data/tables.mjs";
import { die } from "./rules.mjs";

export const ACTIONS_2 = Object.freeze([...MEANING.action1]);
export const DESCRIPTIONS_1 = Object.freeze([...MEANING.action2]);
export const DESCRIPTIONS_2 = Object.freeze([...MEANING.descriptor1]);
const LOCATIONS = Object.freeze([...MEANING.descriptor2]);

/** The book's category headings, as i18n slugs (`GLMYTHIC.category.<slug>`). */
export const CATEGORY_SLUGS = Object.freeze({
  "Adventure & Plot": "plot",
  Characters: "characters",
  Actions: "actions",
  Creatures: "creatures",
  Locations: "locations",
  "Objects & Powers": "objects",
  Senses: "senses",
});

/** Every elements table, with Locations rescued from the meaning columns. */
export const ELEMENT_TABLES = Object.freeze(
  (() => {
    const rows = ELEMENTS.map((e) => ({ id: e.id, name: e.name, category: CATEGORY_SLUGS[e.category] ?? "plot", entries: e.entries }));
    const at = rows.findIndex((e) => e.category === "locations");
    rows.splice(at < 0 ? rows.length : at, 0, { id: "locations", name: "Locations", category: "locations", entries: LOCATIONS });
    return rows.map((r) => Object.freeze(r));
  })()
);

export const elementById = (id) => ELEMENT_TABLES.find((e) => e.id === id) ?? null;

/** Elements grouped by category, in the order the data lists them. */
export function elementGroups() {
  const groups = [];
  const by = new Map();
  for (const e of ELEMENT_TABLES) {
    if (!by.has(e.category)) {
      const g = { category: e.category, tables: [] };
      by.set(e.category, g);
      groups.push(g);
    }
    by.get(e.category).tables.push({ id: e.id, name: e.name });
  }
  return groups;
}

/** The two core meaning tables a Random Event or a quick roll reads. */
export const CORE_MEANING = Object.freeze(["actions", "descriptions"]);

/**
 * A linked RollTable's results as a 100-row column.
 *
 * `results` are plain `{ text, range: [lo, hi] }`. A table laid out on 1-100
 * fills its rows by range; anything else (a 1d50, a table with gaps) is read
 * as a flat list, one row per result, so a roll can always land on something.
 */
export function columnFromResults(results) {
  const rows = (results ?? [])
    .map((r) => ({ text: String(r?.text ?? r?.name ?? r?.description ?? "").trim(), lo: Number(r?.range?.[0]), hi: Number(r?.range?.[1]) }))
    .filter((r) => r.text);
  if (!rows.length) return null;
  const col = new Array(100).fill(null);
  let ok = true;
  for (const r of rows) {
    if (!Number.isInteger(r.lo) || !Number.isInteger(r.hi) || r.lo < 1 || r.hi > 100 || r.hi < r.lo) {
      ok = false;
      break;
    }
    for (let i = r.lo; i <= r.hi; i++) col[i - 1] = r.text;
  }
  if (ok && col.every(Boolean)) return col;
  return rows.map((r) => r.text);
}

const pick = (col, rng) => {
  const roll = die(col.length, rng);
  return { roll, word: col[roll - 1] };
};

/**
 * Roll a core meaning table: two columns, one word from each.
 * `actions1` is the linked Table 1 column, or null.
 */
export function rollMeaning(table, { rng = Math.random, actions1 = null } = {}) {
  if (table === "descriptions") {
    const a = pick(DESCRIPTIONS_1, rng);
    const b = pick(DESCRIPTIONS_2, rng);
    return { table, rolls: [a.roll, b.roll], words: [a.word, b.word], missing: false };
  }
  const second = pick(ACTIONS_2, rng);
  if (Array.isArray(actions1) && actions1.length) {
    const first = pick(actions1, rng);
    return { table: "actions", rolls: [first.roll, second.roll], words: [first.word, second.word], missing: false };
  }
  return { table: "actions", rolls: [second.roll], words: [second.word], missing: true };
}

/** Roll one elements table. Null for an id that is not one. */
export function rollElement(id, rng = Math.random) {
  const t = elementById(id);
  if (!t) return null;
  const { roll, word } = pick(t.entries, rng);
  return { id: t.id, name: t.name, roll, word };
}
