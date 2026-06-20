/**
 * Tracker model — the shared, store-agnostic core of a tracker.
 *
 * Both backends (the world-scope {@link TrackerStore} that feeds the global dock
 * and the per-actor {@link ActorTrackerStore} that feeds a PC's private sheet tab)
 * hold the *same* tracker shape and need the *same* coercion, stepping, factory
 * and pool-roll maths. That logic lives here so the two stores stay in lockstep
 * — a tracker created on a sheet is byte-for-byte one created on the dock.
 */

import { MODULE_ID, TRACKER_TYPES } from "../const.js";

/** Per-type factory defaults for newly created trackers. */
export const TRACKER_DEFAULTS = {
  point: { name: "Points", value: 0, min: null, max: null },
  clock: { name: "Clock", slices: 6, value: 0, bad: false },
  pool:  { name: "Pool", size: 6, count: 5, discard: 2, current: 5, playerRoll: false },
  task:  { title: "Task", subtitle: "", boxes: 6, value: 0 },
  hazard:{ title: "Hazard", subtitle: "", boxes: 8, value: 0 },
  separator: { label: "" }
};

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const tInt = (v, fallback = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : fallback; };
/** Optional integer bound: blank/null/undefined stays unset (null); otherwise an int. */
export const optInt = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
};

/** Build a fresh tracker of `type`, ordered after everything in `list`. */
export function makeNewTracker(type, overrides = {}, list = []) {
  if (!TRACKER_TYPES.includes(type)) type = "point";
  const base = foundry.utils.deepClone(TRACKER_DEFAULTS[type]);
  const order = list.reduce((m, t) => Math.max(m, t.order ?? 0), 0) + 1;
  return {
    id: foundry.utils.randomID(),
    type,
    order,
    visibleToPlayers: true,
    ...base,
    ...overrides
  };
}

/** Coerce a tracker's numeric fields into their valid ranges (mutates in place). */
export function sanitizeTracker(t) {
  switch (t.type) {
    case "point": {
      let lo = optInt(t.min), hi = optInt(t.max);
      if (lo !== null && hi !== null && lo > hi) { const tmp = lo; lo = hi; hi = tmp; }
      t.min = lo; t.max = hi;
      let v = tInt(t.value);
      if (lo !== null) v = Math.max(lo, v);
      if (hi !== null) v = Math.min(hi, v);
      t.value = v;
      break;
    }
    case "clock":
      t.slices = clamp(tInt(t.slices, 6), 1, 24);
      t.value = clamp(tInt(t.value), 0, t.slices);
      t.bad = !!t.bad;
      break;
    case "pool":
      t.size = clamp(tInt(t.size, 6), 2, 100);
      t.count = clamp(tInt(t.count, 5), 1, 50);
      t.discard = clamp(tInt(t.discard, 2), 0, t.size);
      t.current = clamp(tInt(t.current, t.count), 0, t.count);
      t.playerRoll = !!t.playerRoll;
      break;
    case "task":
    case "hazard":
      t.boxes = clamp(tInt(t.boxes, 6), 1, 30);
      t.value = clamp(tInt(t.value), 0, t.boxes);
      break;
    case "separator":
      t.label = String(t.label ?? "").trim();
      break;
  }
}

/** Step a point/clock/task/hazard's value by `delta`, clamped to its type's range
 *  (mutates in place). Returns true when the tracker actually has a steppable value. */
export function stepTracker(t, delta) {
  switch (t.type) {
    case "point": {
      const lo = optInt(t.min), hi = optInt(t.max);
      let nv = tInt(t.value) + delta;
      if (lo !== null) nv = Math.max(lo, nv);
      if (hi !== null) nv = Math.min(hi, nv);
      t.value = nv;
      return true;
    }
    case "clock":
      t.value = clamp(tInt(t.value) + delta, 0, tInt(t.slices, 6));
      return true;
    case "task":
    case "hazard":
      t.value = clamp(tInt(t.value) + delta, 0, tInt(t.boxes, 6));
      return true;
    default:
      return false;
  }
}

/**
 * Roll a pool's dice and tally what survives the discard threshold.
 * Pure maths + dice evaluation; the caller decides how to animate (3D dice) and
 * persist (world setting vs actor flag). Returns null for an empty/invalid pool.
 */
export async function rollPoolDice(t) {
  const n = tInt(t.current, 0);
  if (n <= 0) return null;                    // an exhausted pool stays empty until reset
  const size = tInt(t.size, 6);
  const discard = tInt(t.discard, 2);
  const roll = await new Roll(`${n}d${size}`).evaluate();
  const faces = roll.dice[0]?.results?.map(r => r.result) ?? [];
  const remaining = faces.filter(v => v > discard).length;
  return { roll, faces, size, discard, remaining };
}

/** Compact, on-brand chat-card HTML listing a pool roll's kept vs discarded dice. */
export function poolCardContent({ tracker, faces, discard, size, remaining }) {
  const empty = remaining === 0;
  const keptCount = remaining;
  const goneCount = faces.length - keptCount;

  const dice = faces.map(v => {
    const drop = v <= discard;
    return `<span class="glct-cc-d${drop ? " drop" : ""}">${v}</span>`;
  }).join("");

  const summary = empty
    ? `<div class="glct-cc-empty">${game.i18n.localize("GLCT.tracker.poolEmpty")}</div>`
    : `<div class="glct-cc-sum"><span class="keep">${game.i18n.format("GLCT.tracker.kept", { n: keptCount })}</span>` +
      `<span class="gone">${game.i18n.format("GLCT.tracker.discarded", { n: goneCount })}</span></div>`;

  return `<div class="glct-chatcard${empty ? " empty" : ""}">
      <div class="glct-cc-head">
        <span class="glct-cc-ico"><i class="fa-solid fa-dice"></i></span>
        <span class="glct-cc-title"><span class="n">${foundry.utils.escapeHTML(tracker.name ?? "Pool")}</span>` +
        `<span class="s">${game.i18n.localize("GLCT.tracker.types.pool")} · d${size} · ${game.i18n.format("GLCT.tracker.dropLE", { n: discard })}</span></span>
      </div>
      <div class="glct-cc-body">
        <div class="glct-cc-dice">${dice}</div>
        ${summary}
      </div>
    </div>`;
}
