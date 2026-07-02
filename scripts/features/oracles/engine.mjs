/**
 * GLUniverse Suite — Oracles feature: the genre-blind oracle engine.
 *
 * Packs are pure-data ES modules under ./data/<packId>/ loaded lazily via
 * dynamic import() the first time they are needed (only enabled packs ever
 * load). The engine resolves tables — ranged entries, per-context range
 * columns, typed results (text / ref / compose / rollTimes) — and computes
 * the Ironsworn-style "match" on every d100. Rolls are silent internal dice
 * (no chat, no 3D dice); the panel offers explicit "send to chat".
 *
 * Schema: see ./data/README.md. Qualified table ids are "<packId>:<tableId>";
 * unqualified refs resolve inside the owning pack.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { toInt } from "../../core/util.mjs";

export const FEATURE_ID = "oracles";

export const PRIMARY_KEY = "oracle.primaryPack";
export const PACK_ENABLED_PREFIX = "oracle.pack."; // + <packId> → Boolean world setting
export const LOG_KEY = "oracle.log";
export const POS_KEY = "oracle.panelPos";
export const CONTEXT_KEY = "oracle.context"; // { [packId]: contextValueId } — per client
export const LOG_MAX = 60;

/** Tier-1 slots every genre pack binds, in panel display order. */
export const SLOT_ORDER = [
  "character", "place", "settlement", "faction",
  "creature", "encounter", "location-theme", "complication",
];

export const SLOT_ICONS = {
  character: "fa-solid fa-user",
  place: "fa-solid fa-map-location-dot",
  settlement: "fa-solid fa-house-flag",
  faction: "fa-solid fa-flag",
  creature: "fa-solid fa-spaghetti-monster-flying",
  encounter: "fa-solid fa-binoculars",
  "location-theme": "fa-solid fa-masks-theater",
  complication: "fa-solid fa-burst",
};

/* ── Pack registry ──────────────────────────────────────────────────────── */

/** Static index of shippable packs. `core` is always active. */
export const PACK_INDEX = [
  { id: "core", label: "Core Oracles", genre: false, load: () => import("./data/core/index.mjs") },
  { id: "starforged", label: "Starforged (Sci-Fi)", genre: true, load: () => import("./data/starforged/index.mjs") },
  { id: "fantasy", label: "Fantasy (Ironsworn)", genre: true, load: () => import("./data/fantasy/index.mjs") },
  { id: "dark-fantasy", label: "Dark Fantasy", genre: true, load: () => import("./data/dark-fantasy/index.mjs") },
  { id: "modern-occult", label: "Modern Occult", genre: true, load: () => import("./data/modern-occult/index.mjs") },
  { id: "vampire-modern", label: "Urban Gothic (Vampires)", genre: true, load: () => import("./data/vampire-modern/index.mjs") },
  { id: "dieselpunk", label: "Dieselpunk", genre: true, load: () => import("./data/dieselpunk/index.mjs") },
  { id: "arcanepunk", label: "Arcanepunk", genre: true, load: () => import("./data/arcanepunk/index.mjs") },
];

export const GENRE_PACKS = PACK_INDEX.filter((p) => p.genre);

/** Loaded pack cache: packId → { pack, byId: Map<tableId, table> }. */
const _loaded = new Map();

export async function ensurePack(packId) {
  if (_loaded.has(packId)) return _loaded.get(packId);
  const meta = PACK_INDEX.find((p) => p.id === packId);
  if (!meta) throw new Error(`Unknown oracle pack "${packId}"`);
  const mod = await meta.load();
  const pack = mod.default;
  const byId = new Map(pack.tables.map((t) => [t.id, t]));
  const entry = { pack, byId };
  _loaded.set(packId, entry);
  return entry;
}

export function packEnabled(packId) {
  if (packId === "core") return true;
  try { return !!game.settings.get(SUITE_ID, `${PACK_ENABLED_PREFIX}${packId}`); }
  catch (_e) { return false; }
}

export function enabledPackIds() {
  return PACK_INDEX.filter((p) => packEnabled(p.id)).map((p) => p.id);
}

export function primaryPackId() {
  let id;
  try { id = game.settings.get(SUITE_ID, PRIMARY_KEY); } catch (_e) { /* pre-init */ }
  if (GENRE_PACKS.some((p) => p.id === id)) return id;
  return GENRE_PACKS[0].id;
}

/* ── Per-pack context choice (client-remembered) ────────────────────────── */

export function getContextChoice(packDef) {
  if (!packDef?.context) return null;
  let saved = {};
  try { saved = game.settings.get(SUITE_ID, CONTEXT_KEY) ?? {}; } catch (_e) { /* pre-init */ }
  const chosen = saved[packDef.id];
  const valid = packDef.context.values.some((v) => v.id === chosen);
  return valid ? chosen : (packDef.context.default ?? packDef.context.values[0].id);
}

export async function setContextChoice(packId, valueId) {
  const saved = { ...(game.settings.get(SUITE_ID, CONTEXT_KEY) ?? {}) };
  saved[packId] = valueId;
  await game.settings.set(SUITE_ID, CONTEXT_KEY, saved);
}

/* ── Dice ───────────────────────────────────────────────────────────────── */

/** Silent internal die, 1..n. */
const d = (n) => 1 + Math.floor(Math.random() * n);

/** Ironsworn match: on a d100, both digits equal — 11,22,…,99 and 100 ("00"). */
const matchOn = (roll, dieSize) =>
  dieSize === 100 && (roll === 100 || (roll >= 11 && roll <= 99 && roll % 11 === 0));

/* ── Ask the Oracle (yes/no) ────────────────────────────────────────────── */

export const ODDS = [
  { id: "small-chance", threshold: 10 },
  { id: "unlikely", threshold: 25 },
  { id: "fifty-fifty", threshold: 50 },
  { id: "likely", threshold: 75 },
  { id: "almost-certain", threshold: 90 },
];

export function askOracle(oddsId) {
  const odds = ODDS.find((o) => o.id === oddsId) ?? ODDS[2];
  const roll = d(100);
  return {
    kind: "ask",
    oddsId: odds.id,
    threshold: odds.threshold,
    roll,
    yes: roll <= odds.threshold,
    isMatch: matchOn(roll, 100),
  };
}

/* ── Table resolution ───────────────────────────────────────────────────── */

function parseRef(ref, ownerPackId) {
  const i = ref.indexOf(":");
  if (i === -1) return { packId: ownerPackId, tableId: ref };
  return { packId: ref.slice(0, i), tableId: ref.slice(i + 1) };
}

/** The effective [lo, hi] of an entry under a context value. An explicit
 *  `ranges[ctx] = null` means the row does not exist in that context. */
function entryRange(entry, ctx) {
  if (ctx && entry.ranges) return entry.ranges[ctx] ?? null;
  return entry.range;
}

/** Die size of a table under a context (max ceiling / words length). */
function dieSize(table, ctx) {
  if (table.words) return table.words.length;
  let max = 0;
  for (const e of table.entries) {
    const r = entryRange(e, ctx);
    if (r && r[1] > max) max = r[1];
  }
  return max;
}

function pickEntry(table, roll, ctx) {
  return table.entries.find((e) => {
    const r = entryRange(e, ctx);
    return r && roll >= r[0] && roll <= r[1];
  });
}

/**
 * Roll a table (qualified or unqualified relative to `ownerPackId`).
 *
 * options:
 *   context    — explicit context value id; defaults to the target pack's
 *                remembered choice (contexts only apply within their pack)
 *   expandAll  — resolve `manual` refs inline too (shift-click)
 *   _depth     — internal recursion guard
 *
 * Returns a serializable result tree:
 * { kind:"table", packId, tableId, tableName, roll, dieSize, isMatch, text,
 *   children:[result…], pending:[{ref, label}] }
 */
export async function rollTable(id, { ownerPackId = null, context = null, expandAll = false, _depth = 0 } = {}) {
  if (_depth > 8) { warn(`oracles: ref depth cap hit at "${id}"`); return null; }
  const { packId, tableId } = parseRef(id, ownerPackId ?? primaryPackId());
  const { pack, byId } = await ensurePack(packId);
  const table = byId.get(tableId);
  if (!table) { warn(`oracles: unknown table "${packId}:${tableId}"`); return null; }

  // Context only applies inside the pack that declares the axis.
  const ctx = pack.context ? (context ?? getContextChoice(pack)) : null;

  const base = {
    kind: "table",
    packId,
    tableId,
    tableName: table.name,
    roll: null,
    dieSize: null,
    isMatch: false,
    text: "",
    children: [],
    pending: [],
  };

  // Virtual composite table — roll every part, no die of its own.
  if (table.compose && !table.entries && !table.words) {
    for (const part of table.compose) {
      const child = await rollTable(part, { ownerPackId: packId, context, expandAll, _depth: _depth + 1 });
      if (child) base.children.push(child);
    }
    base.text = base.children.map((c) => c.text).join(" · ");
    base.isMatch = base.children.some((c) => c.isMatch);
    return base;
  }

  const size = dieSize(table, ctx);
  if (!size) { warn(`oracles: table "${packId}:${tableId}" has no rollable entries`); return null; }
  const roll = d(size);
  base.roll = roll;
  base.dieSize = size;
  base.isMatch = matchOn(roll, size);

  if (table.words) {
    base.text = table.words[roll - 1];
    return base;
  }

  const entry = pickEntry(table, roll, ctx);
  if (!entry) { warn(`oracles: no entry for ${roll} on "${packId}:${tableId}" (ctx ${ctx})`); return base; }
  base.text = entry.text ?? "";

  // Roll twice / thrice: reroll this same table N times (skip re-triggering rows).
  if (entry.rollTimes) {
    for (let i = 0; i < entry.rollTimes; i++) {
      let child = null;
      for (let tries = 0; tries < 5 && !child; tries++) {
        child = await rollTable(`${packId}:${tableId}`, { context, expandAll, _depth: _depth + 1 });
        if (child && child.tableId === tableId && !child.text && !child.children.length) child = null;
      }
      if (child) base.children.push(child);
    }
    if (!base.text) base.text = game.i18n?.localize("GLORACLE.rollTimes") ?? "Roll again";
    return base;
  }

  // Compose: roll the listed tables, always inline.
  if (entry.compose) {
    for (const part of entry.compose) {
      const child = await rollTable(part, { ownerPackId: packId, context, expandAll, _depth: _depth + 1 });
      if (child) base.children.push(child);
    }
    if (!base.text) base.text = base.children.map((c) => c.text).join(" · ");
  }

  // Ref: inline when auto (or shift-click expandAll), else offer a drill button.
  if (entry.ref) {
    if (entry.auto || expandAll) {
      const child = await rollTable(entry.ref, { ownerPackId: packId, context, expandAll, _depth: _depth + 1 });
      if (child) base.children.push(child);
    } else {
      const target = parseRef(entry.ref, packId);
      let label = entry.ref;
      try {
        const { byId: targetById } = await ensurePack(target.packId);
        label = targetById.get(target.tableId)?.name ?? entry.ref;
      } catch (_e) { /* label stays qualified id */ }
      base.pending.push({ ref: `${target.packId}:${target.tableId}`, label });
    }
  }

  return base;
}

/* ── Panel-facing pack views ────────────────────────────────────────────── */

/** Load every enabled pack and return display-ready views (categories in
 *  declaration order, tables grouped). Core first, then primary, then rest. */
export async function packViews() {
  const ids = enabledPackIds();
  const primary = primaryPackId();
  ids.sort((a, b) => {
    const rank = (x) => (x === "core" ? 0 : x === primary ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  const views = [];
  for (const id of ids) {
    let entry;
    try { entry = await ensurePack(id); }
    catch (e) { warn(`oracles: failed to load pack "${id}"`, e); continue; }
    const { pack } = entry;
    const cats = [];
    const byName = new Map();
    for (const t of pack.tables) {
      const cat = t.category ?? pack.label;
      if (!byName.has(cat)) { byName.set(cat, []); cats.push({ name: cat, tables: byName.get(cat) }); }
      byName.get(cat).push({ id: `${pack.id}:${t.id}`, name: t.name });
    }
    views.push({
      id: pack.id,
      label: pack.label,
      isPrimary: pack.id === primary,
      attribution: pack.attribution ?? "",
      context: pack.context
        ? (() => {
            const chosen = getContextChoice(pack);
            return {
              key: pack.context.key,
              label: pack.context.label,
              chosen,
              values: pack.context.values.map((v) => ({ ...v, selected: v.id === chosen })),
            };
          })()
        : null,
      categories: cats,
    });
  }
  return views;
}

/** The primary pack's Tier-1 slot bindings, display-ready. */
export async function slotButtons() {
  const primary = primaryPackId();
  let entry;
  try { entry = await ensurePack(primary); }
  catch (e) { warn(`oracles: failed to load primary pack "${primary}"`, e); return []; }
  const { pack } = entry;
  return SLOT_ORDER
    .filter((slot) => pack.slots?.[slot])
    .map((slot) => ({
      slot,
      icon: SLOT_ICONS[slot],
      tableId: `${pack.id}:${pack.slots[slot]}`,
    }));
}

/* ── Utility for settings choices ───────────────────────────────────────── */

export function primaryPackChoices() {
  const out = {};
  for (const p of GENRE_PACKS) out[p.id] = p.label;
  return out;
}

/** Coerce an unknown persisted log array into shape (defensive). */
export function sanitizeLog(raw) {
  return Array.isArray(raw) ? raw.slice(0, toInt(LOG_MAX, 60)) : [];
}
