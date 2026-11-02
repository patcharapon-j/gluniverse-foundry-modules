/**
 * Tracker view model: what a row says, decided once for every surface.
 *
 * PURE. Takes clean trackers (./tracker-model.js `normalizeList`) and who is
 * looking, returns plain rows. Text leaves as `{ k, d }` refs resolved by the
 * renderer's `L`, so the check tool can resolve every key, the runtime-built
 * ones included. The dock, the sheet tab, the editor's live sample and the
 * preview all draw from this, so they cannot disagree about a tracker.
 */

import { tInt, optInt, valueOf, rangeOf } from "./tracker-model.js";

/** The state tags a row can wear, and the i18n key each prints. */
export const TAGS = {
  filled: "GLCT.tracker.filled",
  doom: "GLCT.tracker.doom",
  done: "GLCT.tracker.completed",
  empty: "GLCT.tracker.empty",
  sprung: "GLCT.tracker.sprung",
};

/** The tone a row is drawn in. Danger is red, a finished track green. */
export const TONES = ["paper", "red", "green", "amber"];

/**
 * One row.
 *
 * @param {object} t  A clean tracker.
 * @param {object} ctx
 * @param {boolean} ctx.isGM       The viewer is a GM (sees hidden rows, gets the menu).
 * @param {boolean} ctx.canWrite   The viewer may step and edit this tracker's store.
 * @param {boolean} [ctx.sheet]    Drawn on a PC sheet (no player-visibility marks).
 */
export function rowView(t, { isGM = false, canWrite = false, sheet = false } = {}) {
  const value = valueOf(t);
  const { min, max } = rangeOf(t);
  const row = {
    id: t.id,
    type: t.type,
    tone: "paper",
    name: "",
    sub: null,
    hidden: !sheet && isGM && t.visibleToPlayers === false,
    prominent: !sheet && !!t.prominent && t.type !== "separator",
    value,
    max,
    min,
    cap: null,
    meter: null,
    tag: null,
    canStep: false,
    canRoll: false,
    rollable: false,
    menu: canWrite,
  };

  switch (t.type) {
    case "point": {
      row.name = t.name;
      row.cap = max !== null ? `/${max}` : null;
      if (max !== null) {
        const lo = min ?? 0;
        const span = Math.max(1, max - lo);
        row.meter = { kind: "bar", fill: Math.max(0, Math.min(1, (value - lo) / span)) };
      }
      if (max !== null && value >= max) row.tone = "green";
      if (min !== null && value <= min && max !== null) row.tone = "red";
      row.canStep = canWrite;
      break;
    }
    case "clock": {
      row.name = t.name;
      row.cap = `/${max}`;
      row.meter = { kind: "pie", n: max, filled: value };
      if (t.bad) row.tone = "red";
      if (value >= max) row.tag = t.bad ? "doom" : "filled";
      if (value >= max && !t.bad) row.tone = "green";
      row.canStep = canWrite;
      break;
    }
    case "pool": {
      row.name = t.name;
      const size = tInt(t.size, 6), discard = tInt(t.discard, 2);
      row.cap = `d${size}`;
      row.sub = { k: "GLCT.tracker.dropLE", d: { n: discard } };
      row.meter = { kind: "pips", n: max, filled: value };
      if (value === 0) { row.tag = "empty"; row.tone = "red"; }
      row.canStep = canWrite;   // right-click / the menu resets a pool
      // The owner of a sheet pool rolls it; on the dock a GM always may and a
      // player only where the GM said so.
      row.canRoll = value > 0 && (sheet ? canWrite : (isGM || !!t.playerRoll));
      row.rollable = sheet ? canWrite : (isGM || !!t.playerRoll);
      break;
    }
    case "task":
    case "hazard": {
      row.name = t.title;
      row.cap = `/${max}`;
      row.sub = t.subtitle ? { raw: t.subtitle } : null;
      row.meter = { kind: "cells", n: max, filled: value };
      if (t.type === "hazard") {
        row.tone = "red";
        if (value >= max) row.tag = "sprung";
      } else if (value >= max) {
        row.tag = "done";
        row.tone = "green";
      }
      row.canStep = canWrite;
      break;
    }
    case "separator":
      row.name = t.label;
      row.menu = canWrite;
      break;
  }

  row.sig = structuralSig(t, row);
  return row;
}

/** Fields that change a row's shape: a change rebuilds it, anything else patches it. */
export function structuralSig(t, row) {
  return [
    t.type, row.meter?.kind ?? "", row.meter?.n ?? "", row.prominent ? 1 : 0, row.canStep ? 1 : 0,
    row.rollable ? 1 : 0, row.menu ? 1 : 0, row.cap === null ? 0 : 1, row.sub ? 1 : 0,
  ].join("|");
}

/**
 * The whole dock or tab.
 *
 * A player sees only what the GM shows (visibility is a presentation flag, not
 * a secret: the world setting reaches every client). A GM sees everything, with
 * hidden rows marked.
 */
export function listView(list, { isGM = false, canWrite = false, sheet = false, compact = false } = {}) {
  const shown = sheet || isGM ? list : list.filter((t) => t.visibleToPlayers !== false);
  const rows = shown.map((t) => rowView(t, { isGM, canWrite, sheet }));
  return {
    rows,
    count: rows.filter((r) => r.type !== "separator").length,
    hiddenCount: rows.filter((r) => r.hidden).length,
    empty: rows.length === 0,
    compact: !!compact && !sheet,
    canWrite,
    // A player with nothing to see gets no dock at all.
    show: rows.length > 0 || canWrite,
  };
}

/** The pool chat card, as data. */
export function poolCardView({ name, faces, size, discard, before }) {
  const kept = faces.filter((v) => v > discard).length;
  return {
    name: String(name ?? ""),
    size: tInt(size, 6),
    discard: tInt(discard, 2),
    before: tInt(before, faces.length),
    after: kept,
    kept,
    gone: faces.length - kept,
    faces: faces.map((v) => ({ v, drop: v <= discard })),
    empty: kept === 0,
  };
}

/** The text a delta chip prints for a value change. */
export function deltaText(from, to) {
  const d = tInt(to) - tInt(from);
  if (!d) return "";
  return d > 0 ? `+${d}` : `−${Math.abs(d)}`;
}

export { optInt };
