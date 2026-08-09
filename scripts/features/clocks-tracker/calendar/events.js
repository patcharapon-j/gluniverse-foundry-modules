/**
 * Calendar events & holidays — the one place stored event data is read,
 * repaired and written.
 *
 * Every GM control on an event (edit, delete, pin, player visibility) resolves
 * the row it was clicked on by that event's `id`, in both the events editor and
 * the calendar's day-detail panel. An event that reaches the setting without a
 * unique id — legacy data carried in from the standalone module, a hand-edited
 * world setting, an imported list — therefore renders perfectly and then
 * silently ignores every one of those controls: the lookup misses, the handler
 * returns, and nothing anywhere says why.
 *
 * So identity is normalized on read and repaired in the stored list once,
 * GM-side. The minted ids are DETERMINISTIC rather than random: the id a row
 * renders with has to be the id its click resolves, including in a session
 * where the repair has not been (or cannot be) written back — a player's
 * client, or a GM who has yet to open either window.
 */

import { MODULE_ID, SETTINGS, HOOKS } from "../const.js";

const LOG = `${MODULE_ID} | clocks-tracker |`;

/** A deterministic id for the event at `index`, kept clear of the ids in use. */
function mintId(index, taken) {
  let id = `glct-ev-${index}`;
  for (let n = 1; taken.has(id); n++) id = `glct-ev-${index}-${n}`;
  return id;
}

/**
 * Clone `raw` and give every event a unique, non-empty string id, keeping the
 * ids that are already usable. Returns the list plus whether anything had to be
 * minted (which is what tells the caller the stored data needs repairing).
 */
export function normalizeEvents(raw) {
  const events = (Array.isArray(raw) ? raw : []).map(e => foundry.utils.deepClone(e) ?? {});

  // Pass 1 — keep every id that is a non-empty string and not already claimed.
  const taken = new Set();
  for (const e of events) {
    const id = typeof e.id === "string" ? e.id.trim() : "";
    e.id = id && !taken.has(id) ? id : "";
    if (e.id) taken.add(e.id);
  }

  // Pass 2 — mint one for everything left over (missing, blank, or duplicated).
  let changed = false;
  events.forEach((e, i) => {
    if (e.id) return;
    e.id = mintId(i, taken);
    taken.add(e.id);
    changed = true;
  });

  return { events, changed };
}

/** The stored events, cloned and id-normalized. Never throws, never returns null. */
export function readEvents() {
  let raw = [];
  try { raw = game.settings.get(MODULE_ID, SETTINGS.events) ?? []; }
  catch (err) { console.warn(`${LOG} calendar events could not be read`, err); }
  return normalizeEvents(raw).events;
}

/** Persist the list (world setting, GM only) and announce the change. */
export async function writeEvents(events) {
  const { events: normalized } = normalizeEvents(events);
  await game.settings.set(MODULE_ID, SETTINGS.events, normalized);
  Hooks.callAll(HOOKS.eventsChanged, normalized);
  return normalized;
}

/**
 * Write the id repair back so ids stay stable across renders and reloads.
 * GM only (the setting is world-scoped), and a no-op when nothing is missing —
 * so it is safe to call every time one of the calendar windows opens.
 */
export async function ensureEventIds() {
  if (!game.user?.isGM) return false;
  let raw = [];
  try { raw = game.settings.get(MODULE_ID, SETTINGS.events) ?? []; }
  catch (err) { console.warn(`${LOG} calendar events could not be read`, err); return false; }

  const { events, changed } = normalizeEvents(raw);
  if (!changed) return false;

  await writeEvents(events);
  console.warn(`${LOG} repaired calendar events with a missing or duplicate id — GM controls (edit, delete, pin, visibility) had no way to resolve them`);
  return true;
}

/** One event by id, or null when it cannot be resolved. */
export function findEvent(events, id) {
  if (!id) return null;
  return events.find(e => e.id === id) ?? null;
}

/**
 * Report a row whose event could not be resolved. Called wherever a handler
 * would otherwise return silently — a dead button with no explanation is the
 * exact failure this module exists to prevent, so it stays loud even now that
 * the ids are repaired on the way in.
 */
export function reportMissingEvent(id, events = readEvents()) {
  console.error(`${LOG} no calendar event matches id "${id ?? ""}" — known ids:`, events.map(e => e.id));
  ui.notifications?.warn(game.i18n.localize("GLCT.events.notFound"));
}
