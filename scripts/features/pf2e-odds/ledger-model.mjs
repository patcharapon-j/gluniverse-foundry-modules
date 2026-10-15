/**
 * The observation ledger — the pure half.
 *
 * Shape (the `od.ledger` world setting):
 *
 *   {
 *     [kindKey]: {
 *       name: "Ogre Warrior",
 *       owners: {
 *         [ownerKey]: {                // a character id, or "party"
 *           [statKey]: { lo, hi, at, src, contradiction? }
 *         }
 *       }
 *     }
 *   }
 *
 * `kindKey` is the creature's KIND (Creaturedex's `dexKey`), so one goblin
 * warrior teaches the party about every goblin warrior. Ranges are bounds on
 * the BARE stat: what is left once the status and circumstance modifiers the
 * table could see at the time of the roll are taken off (see probe.mjs, `bare`),
 * so an AC learned while the ogre was off-guard is not two points low forever.
 *
 * Open ends are stored as null (JSON has no Infinity) — `storeRange` /
 * `loadRange` in the engine.
 *
 * Who knows: in party mode every observation is filed under "party" and every
 * read is the party's. Otherwise it is filed under each character who saw it
 * and a read intersects nothing — it is that character's alone.
 */

import { loadRange, narrow, storeRange, intersect } from "../../core/pf2e-odds.mjs";

export const PARTY = "party";

/**
 * Fold one proof into a ledger, returning a NEW ledger and what changed.
 * @param {object} ledger
 * @param {{kind: string, name?: string, owners: string[], stat: string, proof: {lo,hi}, src?: string, at?: number}} obs
 */
export function fold(ledger, obs) {
  const next = structuredClone(ledger ?? {});
  const changes = [];
  if (!obs?.kind || !obs.stat || !obs.proof || !obs.owners?.length) return { ledger: next, changes };
  const entry = (next[obs.kind] ??= { name: obs.name ?? "", owners: {} });
  if (obs.name) entry.name = obs.name;
  entry.owners ??= {};
  for (const owner of obs.owners) {
    const stats = (entry.owners[owner] ??= {});
    const prev = loadRange(stats[obs.stat]);
    const { range, contradiction, changed } = narrow(prev, obs.proof);
    if (!changed && !contradiction) continue;
    stats[obs.stat] = { ...storeRange(range), at: obs.at ?? 0, src: obs.src ?? "", ...(contradiction ? { contradiction: true } : {}) };
    changes.push({ owner, stat: obs.stat, from: prev, to: range, contradiction });
  }
  return { ledger: next, changes };
}

/**
 * What a reader knows about one stat of one kind.
 * Several owners (a GM previewing "the party" in per-character mode) intersect;
 * a contradiction between owners falls back to the newest.
 * @returns {{lo,hi}|null}
 */
export function readStat(ledger, kind, owners, stat) {
  const entry = ledger?.[kind];
  if (!entry?.owners) return null;
  let out = null;
  let newest = null;
  for (const owner of owners ?? []) {
    const rec = entry.owners[owner]?.[stat];
    if (!rec) continue;
    const r = loadRange(rec);
    if (!newest || (rec.at ?? 0) > newest.at) newest = { at: rec.at ?? 0, r };
    const next = out ? intersect(out, r) : r;
    out = next ?? newest.r;
  }
  return out;
}

/** Every stat a reader knows about one kind. */
export function readKind(ledger, kind, owners) {
  const entry = ledger?.[kind];
  const keys = new Set();
  for (const owner of owners ?? []) for (const k of Object.keys(entry?.owners?.[owner] ?? {})) keys.add(k);
  return Object.fromEntries([...keys].map((k) => [k, readStat(ledger, kind, owners, k)]));
}

/** Drop one stat (or every stat) of a kind, for every owner. */
export function forget(ledger, kind, stat = null) {
  const next = structuredClone(ledger ?? {});
  if (!next[kind]) return next;
  if (!stat) {
    delete next[kind];
    return next;
  }
  for (const rec of Object.values(next[kind].owners ?? {})) delete rec[stat];
  return next;
}

/** True when any owner's record of this stat was reset by a contradiction. */
export function contradicted(ledger, kind, stat) {
  return Object.values(ledger?.[kind]?.owners ?? {}).some((rec) => rec?.[stat]?.contradiction);
}
