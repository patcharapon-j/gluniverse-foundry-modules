/**
 * Flatfinder — the encounter planner's working state.
 *
 * One plan per GM client, kept in the client setting `ff.planner`, so it
 * survives a reload and never reaches another client. `normalizePlan` is the
 * only reader of that value and the pure edits below are the only writers; the
 * window (planner.mjs) calls `readPlan` / `writePlan` and nothing else touches
 * the setting.
 *
 * A planned row stores the creature as it was when dropped (name, art, the
 * level it was BUILT at, hazard kind, boss factor) plus the GM's two choices:
 * an Elite/Weak adjustment and a count. Flatfinder's level is derived from the
 * base level on every read (rules.plannedLevel), so flipping the Elite/Weak
 * setting re-rates every plan without touching it.
 */

import { ADJUST_CYCLE } from "./view.mjs";
import { plannedLevel } from "./rules.mjs";

const MAX_ROWS = 40;
const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const int = (v, lo, hi, fallback) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/** One stored row, repaired. Rows with no name and no level are dropped. */
function normalizeRow(raw, index, seen) {
  if (!raw || typeof raw !== "object") return null;
  const base = isNum(raw.base) ? Math.trunc(raw.base) : null;
  const name = typeof raw.name === "string" ? raw.name : "";
  if (!name && base === null) return null;
  // Every row control resolves by id, so a missing or repeated id is minted
  // deterministically: the id a row renders with is the id its click finds.
  let id = typeof raw.id === "string" && raw.id ? raw.id : `ff-${index}`;
  while (seen.has(id)) id = `${id}-${index}`;
  seen.add(id);
  const hazard = raw.hazard === "simple" || raw.hazard === "complex" ? raw.hazard : null;
  return {
    id,
    uuid: typeof raw.uuid === "string" ? raw.uuid : null,
    name,
    img: typeof raw.img === "string" ? raw.img : "",
    base,
    hazard,
    adjustment: !hazard && (raw.adjustment === "elite" || raw.adjustment === "weak") ? raw.adjustment : null,
    count: int(raw.count, 1, 99, 1),
    bossFactor: int(raw.bossFactor, 1, 3, 1),
    bossTier: typeof raw.bossTier === "string" ? raw.bossTier : null,
    minion: raw.minion === true,
  };
}

/** The stored plan, repaired: `{ party: {level, size} | null, rows: [...] }`. */
export function normalizePlan(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const p = r.party && typeof r.party === "object" ? r.party : null;
  const party = p && isNum(Number(p.level)) && isNum(Number(p.size))
    ? { level: int(p.level, -1, 25, 1), size: int(p.size, 1, 12, 4) }
    : null;
  const seen = new Set();
  const rows = (Array.isArray(r.rows) ? r.rows : [])
    .map((row, i) => normalizeRow(row, i, seen))
    .filter(Boolean)
    .slice(0, MAX_ROWS);
  return { party, rows };
}

/** The plan's rows as model entries, under the current Elite/Weak setting. */
export function planEntries(plan, { shift = true } = {}) {
  return plan.rows.map((row) => ({
    id: row.id,
    uuid: row.uuid,
    name: row.name,
    img: row.img,
    level: plannedLevel(row.base, row.adjustment, shift),
    count: row.count,
    hazard: row.hazard,
    adjustment: row.adjustment,
    bossFactor: row.bossFactor,
    bossTier: row.bossTier,
    minion: row.minion,
  }));
}

/* ── Edits (pure: plan in, new plan out) ─────────────────────────────────── */

/** Add a creature; one already planned (same uuid and adjustment) gains a count instead. */
export function addRow(plan, entry) {
  const row = normalizeRow({ ...entry, id: entry.id ?? `ff-${Date.now().toString(36)}-${plan.rows.length}` }, plan.rows.length, new Set(plan.rows.map((r) => r.id)));
  if (!row) return plan;
  const same = row.uuid ? plan.rows.find((r) => r.uuid === row.uuid && r.adjustment === row.adjustment) : null;
  if (same) return setCount(plan, same.id, same.count + row.count);
  if (plan.rows.length >= MAX_ROWS) return plan;
  return { ...plan, rows: [...plan.rows, row] };
}

export function removeRow(plan, id) {
  return { ...plan, rows: plan.rows.filter((r) => r.id !== id) };
}

export function setCount(plan, id, count) {
  return { ...plan, rows: plan.rows.map((r) => (r.id === id ? { ...r, count: int(count, 1, 99, r.count) } : r)) };
}

/** Normal, Elite, Weak, Normal… Hazards have no adjustment. */
export function cycleAdjustment(plan, id) {
  return {
    ...plan,
    rows: plan.rows.map((r) => {
      if (r.id !== id || r.hazard) return r;
      const at = ADJUST_CYCLE.indexOf(r.adjustment ?? "normal");
      const next = ADJUST_CYCLE[(at + 1) % ADJUST_CYCLE.length];
      return { ...r, adjustment: next === "normal" ? null : next };
    }),
  };
}

/** Set the party by hand, from wherever it stands now. */
export function setParty(plan, party) {
  return { ...plan, party: { level: int(party.level, -1, 25, 1), size: int(party.size, 1, 12, 4) } };
}

/** Let the party follow the world again. */
export function clearParty(plan) {
  return { ...plan, party: null };
}

export function clearRows(plan) {
  return { ...plan, rows: [] };
}
