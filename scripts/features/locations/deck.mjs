/**
 * GLUniverse Suite — Locations: the deck and the scene's background.
 *
 * Two responsibilities that both amount to "where does the state live":
 *   - the **deck**, a world setting holding the GM's library of places;
 *   - the **background**, which is a real field on the Scene document, so that
 *     Foundry replicates the swap and Stage re-grades the cast off its own hooks
 *     without this feature calling into it at all.
 *
 * The background accessors carry the one piece of version awareness in the
 * feature. Foundry v14 moved `Scene#background` onto an embedded **Level**
 * document (`Scene#levels`); the old path survives only as a read-only,
 * deprecation-warning getter, and writing `scene.update({background: …})` there
 * silently does nothing. Everything else in the suite can stay ignorant of that
 * because it only ever *reads*.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { hex6 } from "../../core/util.mjs";

export const FEATURE_ID = "locations";

export const SETTING_DECK = "loc.deck";
export const SETTING_PACE = "loc.pace";
export const SETTING_SETTLE = "loc.settle";
export const SETTING_RECENTER = "loc.recenter";
export const SETTING_MOTION = "loc.motion";

export const FLAG_HOME = "loc.home";
export const FLAG_CURRENT = "loc.current";

/* ══════════════════════════════════════════════════════════════════════
   The scene background — v13 Scene field vs v14 Level document
   ══════════════════════════════════════════════════════════════════════ */

/**
 * The Level that owns the background, or null on v13 where the Scene owns it.
 * v13 Scenes have no `levels` collection at all, so this is a clean fork.
 */
function backgroundLevel(scene) {
  if (!scene?.levels?.size) return null;
  return scene.initialLevel ?? scene.firstLevel ?? null;
}

/** The scene's current backdrop as `{ src, fit }`. Never throws. */
export function readBackground(scene) {
  const level = backgroundLevel(scene);
  if (level) return { src: level.background?.src ?? null, fit: level.textures?.fit ?? "fill" };
  // v13 only — reaching for this on v14 would log a compatibility warning.
  return { src: scene?.background?.src ?? null, fit: scene?.background?.fit ?? "fill" };
}

/**
 * Write the backdrop. GM only (enforced by Foundry's own permissions anyway).
 *
 * `fit` defaults to `cover` because a theatre-of-mind deck holds art of many
 * aspect ratios and Foundry's default `fill` stretches it. Darkness is a Scene
 * field on both versions, so it stays a Scene update either way.
 */
export async function writeBackground(scene, { src, fit = "cover", darkness = null } = {}) {
  if (!scene) return;
  const level = backgroundLevel(scene);
  if (level) await level.update({ "background.src": src, "textures.fit": fit });
  else await scene.update({ "background.src": src, "background.fit": fit });
  if (darkness != null) await scene.update({ "environment.darknessLevel": darkness });
}

/* ══════════════════════════════════════════════════════════════════════
   Per-scene state
   ══════════════════════════════════════════════════════════════════════ */

/** The backdrop the scene had before its first trip, or null. */
export const getHome = (scene) => scene?.getFlag(SUITE_ID, FLAG_HOME) ?? null;

/** The deck entry the scene is currently showing, or null. */
export const getCurrent = (scene) => scene?.getFlag(SUITE_ID, FLAG_CURRENT) ?? null;

/**
 * Record where we went. Captures `home` on the **first** trip only, so "return
 * to base" always means the scene as its author built it, not the last place
 * the party happened to stand.
 */
export async function markTravelled(scene, entryId, previous) {
  if (!scene) return;
  // Full dotted paths, not a nested blob: the flag keys themselves contain a
  // dot (`loc.current`), and only `update()` expands those the same way
  // `setFlag`/`getFlag` do. One round trip for both.
  const patch = { [`flags.${SUITE_ID}.${FLAG_CURRENT}`]: entryId ?? null };
  if (!getHome(scene) && previous?.src) patch[`flags.${SUITE_ID}.${FLAG_HOME}`] = previous;
  await scene.update(patch);
}

/* ══════════════════════════════════════════════════════════════════════
   The deck
   ══════════════════════════════════════════════════════════════════════ */

/** Every entry, in stored order. Always an array. */
export function listEntries() {
  const raw = game.settings.get(SUITE_ID, SETTING_DECK);
  return Array.isArray(raw?.entries) ? raw.entries : [];
}

export const findEntry = (id) => listEntries().find((e) => e.id === id) ?? null;

/** URL-safe stable id from a name, uniquified against the current deck. */
export function slugify(name, taken = new Set()) {
  const base = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "place";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/**
 * Coerce arbitrary input into a storable entry. Everything optional is dropped
 * when absent rather than stored as null, so an entry only carries what the GM
 * actually set and `darkness: undefined` keeps meaning "don't touch it".
 */
export function normalizeEntry(input, { id = null, taken = new Set() } = {}) {
  const name = String(input?.name ?? "").trim() || "Untitled";
  const entry = {
    id: id || String(input?.id ?? "").trim() || slugify(name, taken),
    name,
    img: String(input?.img ?? "").trim(),
    style: String(input?.style ?? "fade").trim(),
  };
  const subtitle = String(input?.subtitle ?? "").trim();
  if (subtitle) entry.subtitle = subtitle;
  const accent = hex6(input?.accent, null);
  if (accent) entry.accent = accent;
  const darkness = Number(input?.darkness);
  if (Number.isFinite(darkness)) entry.darkness = Math.max(0, Math.min(1, darkness));
  const playlistId = String(input?.playlistId ?? "").trim();
  if (playlistId) entry.playlistId = playlistId;
  return entry;
}

async function saveEntries(entries) {
  await game.settings.set(SUITE_ID, SETTING_DECK, { entries });
}

/** Add or replace an entry, returning what was stored. */
export async function upsertEntry(input, existingId = null) {
  const entries = listEntries();
  const taken = new Set(entries.map((e) => e.id).filter((id) => id !== existingId));
  const entry = normalizeEntry(input, { id: existingId, taken });
  const at = entries.findIndex((e) => e.id === entry.id);
  if (at >= 0) entries[at] = entry;
  else entries.push(entry);
  await saveEntries(entries);
  return entry;
}

export async function deleteEntry(id) {
  await saveEntries(listEntries().filter((e) => e.id !== id));
}
