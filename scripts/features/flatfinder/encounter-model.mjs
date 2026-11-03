/**
 * Flatfinder — the encounter, as a model.
 *
 * Pure: plain entries in, a plain model out. The tracker strip, the planner
 * window and Combat Intro's threat card all read this one model, so a fight is
 * rated the same way wherever the GM looks at it. snapshot.mjs builds the
 * entries from the world; tools/flatfinder-check.mjs and the preview build them
 * by hand.
 *
 * An entry:
 *   { id, name, img, level, count?, hazard?: null|"simple"|"complex",
 *     adjustment?: null|"elite"|"weak", bossFactor?: 1|2|3, bossTier?, minion?, hidden? }
 * `level` is already Flatfinder's level (Elite/Weak applied, boss bump NOT
 * applied: a boss reaches the budget through `bossFactor` alone).
 */

import { PWL_DIFF_MAX, PWL_DIFF_MIN, THREAT_ORDER } from "./constants.js";
import { awardPerPc, creatureXp, encounterBudgets, headroom, threatRating } from "./rules.mjs";

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * The meter is drawn in six equal segments, one per rating plus the stretch
 * past Extreme (to half again its budget), and the fill is placed within its
 * rating's segment by XP. A linear XP scale packed Trivial, Low and Moderate
 * into the first third of the bar where nobody could read them; a segment per
 * rating keeps every budget the same width at every party size, which is what
 * the meter is for. Each tick sits where its rating ends: at or below it is
 * still that rating (rules.threatRating).
 */
const PAST_EXTREME = 1.5;
const SEGMENTS = THREAT_ORDER.length + 1;

/** Where `xp` sits on the meter, 0..1. */
export function meterPosition(xp, budgets) {
  const stops = [0, ...THREAT_ORDER.map((k) => budgets[k]), budgets.extreme * PAST_EXTREME];
  const total = Math.max(0, isNum(xp) ? xp : 0);
  for (let i = 1; i < stops.length; i++) {
    if (total <= stops[i]) {
      const span = stops[i] - stops[i - 1];
      const within = span > 0 ? (total - stops[i - 1]) / span : 1;
      return (i - 1 + within) / SEGMENTS;
    }
  }
  return 1;
}

/** Normalise one entry; anything unreadable becomes a level-less row worth nothing. */
export function normalizeEntry(raw, index = 0) {
  const e = raw && typeof raw === "object" ? raw : {};
  const hazard = e.hazard === "simple" || e.hazard === "complex" ? e.hazard : null;
  const adjustment = e.adjustment === "elite" || e.adjustment === "weak" ? e.adjustment : null;
  const factor = Math.trunc(Number(e.bossFactor));
  return {
    id: String(e.id ?? `row-${index}`),
    uuid: typeof e.uuid === "string" ? e.uuid : null,
    name: String(e.name ?? ""),
    img: typeof e.img === "string" ? e.img : "",
    level: isNum(e.level) ? Math.trunc(e.level) : null,
    count: Math.max(1, Math.min(99, Math.trunc(Number(e.count)) || 1)),
    hazard,
    adjustment,
    bossFactor: factor >= 2 ? factor : 1,
    bossTier: typeof e.bossTier === "string" ? e.bossTier : null,
    minion: e.minion === true,
    hidden: e.hidden === true,
  };
}

/** The key two tracker entries must share to be drawn as one row "×N". */
const groupKey = (e) => [e.name, e.level, e.hazard, e.adjustment, e.bossFactor, e.minion, e.hidden].join("|");

/**
 * Fold identical entries together (the tracker's five goblins are one row).
 * The planner keeps its own rows as the GM arranged them and does not group.
 */
export function groupEntries(entries) {
  const out = [];
  const byKey = new Map();
  for (const e of entries) {
    const key = groupKey(e);
    const hit = byKey.get(key);
    if (hit) hit.count += e.count;
    else {
      const row = { ...e };
      byKey.set(key, row);
      out.push(row);
    }
  }
  return out;
}

/**
 * Build the model.
 *
 * @param {object} input
 * @param {{level:number, size:number, source:string}} input.party
 * @param {object[]} input.threats  entries (see top of file)
 * @param {boolean} [input.group]   fold identical entries (the tracker does)
 * @param {boolean} [input.sort]    order rows by XP, largest first (the tracker does)
 */
export function buildEncounter({ party, threats, group = false, sort = false }) {
  const level = isNum(party?.level) ? Math.trunc(party.level) : 1;
  const size = Math.max(1, Math.min(99, Math.trunc(Number(party?.size)) || 4));
  const source = typeof party?.source === "string" ? party.source : "default";
  const budgets = encounterBudgets(size);

  let entries = (threats ?? []).map(normalizeEntry);
  if (group) entries = groupEntries(entries);

  const rows = entries.map((e) => {
    const diff = e.level === null ? null : e.level - level;
    // A minion is part of another creature's kit and is worth nothing on its own.
    const each = e.minion || e.level === null ? 0 : creatureXp(e.level, level, { hazard: e.hazard }) * e.bossFactor;
    const capped = diff === null ? null : diff > PWL_DIFF_MAX ? "high" : diff < PWL_DIFF_MIN ? "low" : null;
    return { ...e, diff, each, xp: each * e.count, capped };
  });
  if (sort) rows.sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));

  const totalXp = rows.reduce((sum, r) => sum + r.xp, 0);
  const rating = threatRating(totalXp, budgets);
  const ticks = THREAT_ORDER.map((key, i) => ({ key, xp: budgets[key], at: (i + 1) / SEGMENTS, mid: (i + 0.5) / SEGMENTS }));

  return {
    party: { level, size, source },
    budgets,
    rows,
    count: rows.reduce((n, r) => n + r.count, 0),
    totalXp,
    rating,
    ratingIndex: THREAT_ORDER.indexOf(rating),
    budget: budgets[rating],
    next: headroom(totalXp, budgets),
    award: awardPerPc(totalXp, size),
    meter: { fill: meterPosition(totalXp, budgets), ticks },
  };
}
