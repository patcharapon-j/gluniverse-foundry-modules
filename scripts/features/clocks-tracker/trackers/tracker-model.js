/**
 * Tracker model: the shape of a tracker and every rule about it.
 *
 * Both stores hold the same tracker shape: the world store behind the shared
 * dock ({@link TrackerStore}) and the per-actor store behind a PC's private
 * sheet tab ({@link ActorTrackerStore}). So the coercion, stepping, factory and
 * pool maths live here, once.
 *
 * PURE. No `game`, no `foundry`, no DOM: the check tool and the preview import
 * this under plain Node and in a bare page. The Foundry half of a pool roll
 * (the Roll, Dice So Nice, the chat card) is in ./pool-roll.js.
 */

import { TRACKER_TYPES } from "../const.js";
import { clamp, toInt } from "../../../core/util.mjs";

/** Per-type factory defaults for newly created trackers. */
export const TRACKER_DEFAULTS = {
  point: { name: "Points", value: 0, min: null, max: null },
  clock: { name: "Clock", slices: 6, value: 0, bad: false },
  pool: { name: "Pool", size: 6, count: 5, discard: 2, current: 5, playerRoll: false },
  task: { title: "Task", subtitle: "", boxes: 6, value: 0 },
  hazard: { title: "Hazard", subtitle: "", boxes: 8, value: 0 },
  separator: { label: "" },
};

/** One Font Awesome glyph per type (the editor's picker, the context menu). */
export const TYPE_ICON = {
  point: "fa-solid fa-hashtag",
  clock: "fa-solid fa-chart-pie",
  pool: "fa-solid fa-dice",
  task: "fa-solid fa-list-check",
  hazard: "fa-solid fa-triangle-exclamation",
  separator: "fa-solid fa-grip-lines",
};

/** The editor's field limits, which are also the sanitizer's. */
export const LIMITS = {
  slices: [1, 24],
  boxes: [1, 30],
  size: [2, 100],
  count: [1, 50],
};

// Kept as named exports: the stores and the editor have always imported them
// from here.
export { clamp };
export const tInt = toInt;

/** Optional integer bound: blank/null/undefined stays unset (null). */
export const optInt = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
};

const str = (v) => (v === null || v === undefined ? "" : String(v));

/** A random 16-character id in Foundry's alphabet (what `foundry.utils.randomID` makes). */
function newId() {
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 16; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** Small stable string hash (FNV-1a), for repaired ids. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Build a fresh tracker of `type`, ordered after everything in `list`. */
export function makeNewTracker(type, overrides = {}, list = [], idFn = newId) {
  if (!TRACKER_TYPES.includes(type)) type = "point";
  const base = structuredClone(TRACKER_DEFAULTS[type]);
  const order = list.reduce((m, t) => Math.max(m, Number(t.order) || 0), 0) + 1;
  const t = {
    id: idFn(),
    type,
    order,
    visibleToPlayers: true,
    prominent: false,
    ...base,
    ...overrides,
  };
  t.type = type;
  sanitizeTracker(t);
  return t;
}

/** Coerce a tracker's fields into their valid ranges (mutates in place). */
export function sanitizeTracker(t) {
  if (!TRACKER_TYPES.includes(t.type)) t.type = "point";
  // Prominence is a shared-dock presentation flag; a separator is a divider.
  t.prominent = t.type === "separator" ? false : !!t.prominent;
  t.visibleToPlayers = t.visibleToPlayers !== false;
  t.order = Number.isFinite(Number(t.order)) ? Number(t.order) : 0;
  switch (t.type) {
    case "point": {
      t.name = str(t.name);
      let lo = optInt(t.min), hi = optInt(t.max);
      if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];
      t.min = lo; t.max = hi;
      t.value = bounded(tInt(t.value), lo, hi);
      break;
    }
    case "clock":
      t.name = str(t.name);
      t.slices = clamp(tInt(t.slices, 6), ...LIMITS.slices);
      t.value = clamp(tInt(t.value), 0, t.slices);
      t.bad = !!t.bad;
      break;
    case "pool":
      t.name = str(t.name);
      t.size = clamp(tInt(t.size, 6), ...LIMITS.size);
      t.count = clamp(tInt(t.count, 5), ...LIMITS.count);
      t.discard = clamp(tInt(t.discard, 2), 0, t.size);
      t.current = clamp(tInt(t.current, t.count), 0, t.count);
      t.playerRoll = !!t.playerRoll;
      break;
    case "task":
    case "hazard":
      t.title = str(t.title);
      t.subtitle = str(t.subtitle);
      t.boxes = clamp(tInt(t.boxes, t.type === "hazard" ? 8 : 6), ...LIMITS.boxes);
      t.value = clamp(tInt(t.value), 0, t.boxes);
      break;
    case "separator":
      t.label = str(t.label).trim();
      break;
  }
  return t;
}

const bounded = (v, lo, hi) => {
  if (lo !== null) v = Math.max(lo, v);
  if (hi !== null) v = Math.min(hi, v);
  return v;
};

/**
 * Read a stored list into clean trackers, in display order.
 *
 * Every control on a row resolves its tracker by `id`, so a row with a missing
 * or duplicated id renders perfectly and then edits, deletes or rolls the wrong
 * tracker. Such ids are repaired here, DETERMINISTICALLY (from the position and
 * the content), so the id a row renders with is the id its click resolves on
 * every client, including one that never writes the repair back. The next
 * write by a writer persists it.
 */
export function normalizeList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  list.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const t = sanitizeTracker(structuredClone(entry));
    let id = typeof t.id === "string" ? t.id.trim() : "";
    if (!id || seen.has(id)) {
      const base = `trk${hash(`${index}|${t.type}|${t.name ?? t.title ?? t.label ?? ""}`)}`;
      id = base;
      for (let n = 2; seen.has(id); n++) id = `${base}${n}`;
    }
    t.id = id;
    seen.add(id);
    out.push({ t, index });
  });
  // A stable sort: equal orders keep their stored position.
  out.sort((a, b) => (a.t.order - b.t.order) || (a.index - b.index));
  return out.map((x) => x.t);
}

/** Step a point/clock/task/hazard's value by `delta` (mutates in place).
 *  Returns true when the value actually moved. */
export function stepTracker(t, delta) {
  const before = valueOf(t);
  if (before === null) return false;
  return setTrackerValue(t, before + delta);
}

/** Set a steppable tracker's value, clamped to its range. Returns true on a change. */
export function setTrackerValue(t, v) {
  const before = valueOf(t);
  if (before === null) return false;
  const n = tInt(v);
  switch (t.type) {
    case "point": t.value = bounded(n, optInt(t.min), optInt(t.max)); break;
    case "clock": t.value = clamp(n, 0, tInt(t.slices, 6)); break;
    case "task":
    case "hazard": t.value = clamp(n, 0, tInt(t.boxes, 6)); break;
    case "pool": t.current = clamp(n, 0, tInt(t.count, 0)); break;
    default: return false;
  }
  return valueOf(t) !== before;
}

/** The live number a tracker shows, or null for a separator. */
export function valueOf(t) {
  switch (t?.type) {
    case "point": case "clock": case "task": case "hazard": return tInt(t.value);
    case "pool": return tInt(t.current);
    default: return null;
  }
}

/** Where a tracker's value can go: { min, max } (either may be null). */
export function rangeOf(t) {
  switch (t?.type) {
    case "point": return { min: optInt(t.min), max: optInt(t.max) };
    case "clock": return { min: 0, max: tInt(t.slices, 6) };
    case "task": case "hazard": return { min: 0, max: tInt(t.boxes, 6) };
    case "pool": return { min: 0, max: tInt(t.count, 0) };
    default: return { min: null, max: null };
  }
}

/** Apply a drag-reorder: every listed id takes its position as its order. */
export function reorderList(list, idsInOrder) {
  const pos = new Map(idsInOrder.map((id, i) => [id, i]));
  let changed = false;
  let tail = idsInOrder.length;
  for (const t of list) {
    const next = pos.has(t.id) ? pos.get(t.id) : tail++;
    if (t.order !== next) { t.order = next; changed = true; }
  }
  return changed;
}

/* ------------------------------- pools ------------------------------- */

/** How many dice survive a roll: every face above the discard threshold. */
export function tallyPool(faces, discard) {
  return faces.filter((v) => v > discard).length;
}

/**
 * Check a pool result before it is persisted, and re-derive the count from it.
 *
 * A player's roll reaches the GM as a chat message, and a chat message is
 * something any client can create with any flags it likes. So the GM never
 * takes the count a message carries: it re-derives it from the faces, and only
 * after checking the faces could have come from THIS pool as it stands now (one
 * die per die left, each a face of its size, at its current threshold). That
 * also refuses a stale roll: a pool the GM reset or that another roll already
 * spent no longer has the number of dice this result was rolled with.
 *
 * Returns the new `current`, or null when the result does not fit the pool.
 */
export function verifyPoolResult(t, result) {
  if (t?.type !== "pool" || !result) return null;
  const faces = Array.isArray(result.faces) ? result.faces : null;
  if (!faces || !faces.length) return null;
  const size = tInt(t.size, 6), discard = tInt(t.discard, 2), current = tInt(t.current, 0);
  if (faces.length !== current) return null;
  if (tInt(result.size, -1) !== size || tInt(result.discard, -1) !== discard) return null;
  if (!faces.every((v) => Number.isInteger(v) && v >= 1 && v <= size)) return null;
  return tallyPool(faces, discard);
}
