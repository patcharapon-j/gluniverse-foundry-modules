/**
 * Creaturedexing — the dex as pure data.
 *
 * Every read and every write the store performs, written as functions over the
 * plain object kept in the `dex.knowledge` world setting. Nothing here touches
 * `game`, a setting or a document, so `tools/creaturedex-check.mjs` drives the
 * real rules (a lie never overwrites a truth, redacting the last holder drops
 * the snapshot, a whole-party reveal fans out) instead of reading the source
 * for them. `store.mjs` wraps these with the one setting read and write.
 *
 * Shape, per subject (a creature *kind*, see identity.mjs):
 *
 *   { meta: { name, img, kind, available, uuid, deferred },
 *     sections: { [sectionKey]: renderedSnapshot },        // the truths handed over
 *     owners: { [characterId]: { sections: [key…],          // known truly
 *                                false: { [key]: { snapshot, from } } } } }
 *
 * Older worlds stored an owner's lies as an array; `ownerRecord` reads either.
 */

import { ALL_SECTION_KEYS, PARTY_KEY } from "./constants.mjs";
import { isComplete } from "./rules.mjs";

const plain = (v) => (v && typeof v === "object" ? v : null);

/** One owner's record, normalised for reading. Never mutates the input. */
export function ownerRecord(rec) {
  const r = plain(rec) ?? {};
  const sections = Array.isArray(r.sections) ? r.sections.filter((k) => ALL_SECTION_KEYS.includes(k)) : [];
  let lies = r.false;
  if (Array.isArray(lies)) lies = Object.fromEntries(lies.filter((f) => f?.section).map((f) => [f.section, f]));
  const out = {};
  for (const [key, lie] of Object.entries(plain(lies) ?? {})) {
    if (ALL_SECTION_KEYS.includes(key) && !sections.includes(key)) out[key] = { snapshot: lie?.snapshot ?? null, from: lie?.from ?? null };
  }
  return { sections, false: out };
}

/**
 * The records a read resolves against.
 *
 * Party Knowledge, and the GM's "everyone" view, union every owner. That is the
 * whole effect of the sidebar: it is a READ, so flipping it never invents or
 * destroys a fact.
 */
export function recordsFor(entry, owner, party) {
  const owners = plain(entry?.owners) ?? {};
  if (party || owner === PARTY_KEY) return Object.values(owners).map(ownerRecord);
  return owner && owners[owner] ? [ownerRecord(owners[owner])] : [];
}

/** Sections held truly, for this read. */
export function knownIn(data, subject, owner, party) {
  const out = new Set();
  for (const rec of recordsFor(data?.[subject], owner, party)) for (const key of rec.sections) out.add(key);
  return [...out];
}

/**
 * Sections held falsely, for this read.
 *
 * A section somebody in the read knows truly is not reported as a lie: under a
 * union the truth wins, exactly as it does inside one record.
 */
export function falseIn(data, subject, owner, party) {
  const known = new Set(knownIn(data, subject, owner, party));
  const out = new Map();
  for (const rec of recordsFor(data?.[subject], owner, party)) {
    for (const [section, lie] of Object.entries(rec.false)) {
      if (!known.has(section) && !out.has(section)) out.set(section, { section, ...lie });
    }
  }
  return [...out.values()];
}

export const metaIn = (data, subject) => plain(data?.[subject]?.meta);

export const truthIn = (data, subject, section) => data?.[subject]?.sections?.[section] ?? null;

/** Every subject anyone holds anything about, true or false. */
export function subjectsIn(data) {
  return Object.entries(plain(data) ?? {})
    .filter(([, entry]) =>
      Object.values(plain(entry?.owners) ?? {}).some((o) => {
        const r = ownerRecord(o);
        return r.sections.length + Object.keys(r.false).length > 0;
      })
    )
    .map(([key]) => key);
}

/**
 * Is this subject truly complete for anybody, under the current read rules?
 *
 * This is what decides whether the abilities PF2e left uncategorised may sit in
 * the store at all. Until somebody has every section there is something left to
 * leak, and the store is read by every client.
 */
export function completeForSomeone(entry, party) {
  const available = entry?.meta?.available ?? [];
  const records = Object.values(plain(entry?.owners) ?? {}).map(ownerRecord);
  if (party) return isComplete([...new Set(records.flatMap((r) => r.sections))], available);
  return records.some((r) => isComplete(r.sections, available));
}

/* ── writes: each takes the dex and returns a new one, or null for "no change" ── */

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));
const ownerList = (owner) => [...new Set((Array.isArray(owner) ? owner : [owner]).filter((o) => o && o !== PARTY_KEY))];

function slot(data, subject, owner) {
  data[subject] ??= { meta: null, sections: {}, owners: {} };
  data[subject].sections ??= {};
  data[subject].owners ??= {};
  data[subject].owners[owner] = ownerRecord(data[subject].owners[owner]);
  return data[subject].owners[owner];
}

/**
 * Merge new meta in, holding back what nobody has earned yet.
 *
 * `deferred` arrives as the full ability entries read off the live creature.
 * They are kept only while the subject is truly complete for somebody; until
 * then the store keeps none of them, not even a count, because a count is the
 * shape of something that has not been learned.
 */
function settleMeta(data, subject, meta, party) {
  const entry = data[subject];
  if (!entry) return;
  const incoming = plain(meta);
  const next = { ...(plain(entry.meta) ?? {}), ...(incoming ?? {}) };
  const deferred = Array.isArray(incoming?.deferred) ? incoming.deferred : Array.isArray(entry.meta?.deferred) ? entry.meta.deferred : [];
  entry.meta = next;
  next.deferred = completeForSomeone(entry, party) ? deferred : [];
}

/**
 * Record sections as truly learned, for one owner or several.
 *
 * A whole-party reveal arrives here as a LIST of characters, one row each,
 * never as a shared `party` row: a shared row would read back only while
 * Party Knowledge was on. `PARTY_KEY` is therefore refused as a write target.
 */
export function applyReveal(data, subject, owner, keys, snapshots = {}, meta = null, party = false) {
  const owners = ownerList(owner);
  const wanted = (Array.isArray(keys) ? keys : [keys]).filter((k) => ALL_SECTION_KEYS.includes(k));
  if (!subject || !owners.length || !wanted.length) return null;
  const out = clone(data);
  for (const one of owners) {
    const rec = slot(out, subject, one);
    rec.sections = [...new Set([...rec.sections, ...wanted])];
    // A section learned truly replaces a lie about it. The reverse never holds.
    for (const key of wanted) delete rec.false[key];
  }
  for (const key of wanted) if (snapshots?.[key]) out[subject].sections[key] = snapshots[key];
  settleMeta(out, subject, meta, party);
  return out;
}

/**
 * Record a lie beside the truth, never over it.
 *
 * A character who has seen a creature's real AC does not un-see it by rolling
 * badly later, so an owner who knows the section truly is skipped. When every
 * owner is skipped nothing is written and the caller hears null.
 */
export function applyFalse(data, subject, owner, section, snapshot, source = null, meta = null, party = false) {
  const owners = ownerList(owner);
  if (!subject || !owners.length || !ALL_SECTION_KEYS.includes(section)) return null;
  const out = clone(data);
  let wrote = false;
  for (const one of owners) {
    const rec = slot(out, subject, one);
    if (rec.sections.includes(section)) continue;
    rec.false[section] = { snapshot: snapshot ?? null, from: source ?? null };
    wrote = true;
  }
  if (!wrote) return null;
  settleMeta(out, subject, meta, party);
  return out;
}

/**
 * Take a section back, true or false: the GM's undo, and the only way a lie
 * is corrected.
 *
 * Once nobody holds the section truly its stored snapshot goes too, so the
 * store keeps its one guarantee: it contains only what somebody was told.
 */
export function applyRedact(data, subject, owner, section, party = false) {
  const out = clone(data);
  let wrote = false;
  for (const one of ownerList(owner)) {
    if (!out[subject]?.owners?.[one]) continue;
    const rec = slot(out, subject, one);
    rec.sections = rec.sections.filter((k) => k !== section);
    delete rec.false[section];
    wrote = true;
  }
  if (!wrote) return null;
  const stillKnown = Object.values(out[subject].owners).some((r) => ownerRecord(r).sections.includes(section));
  if (!stillKnown) delete out[subject].sections[section];
  settleMeta(out, subject, null, party);
  return out;
}

/**
 * Re-take the snapshots the dex already holds. Never hands out a section
 * nobody bought, and leaves lies alone because they were authored, not read.
 */
export function applyRefresh(data, subject, snapshots = {}, meta = null, party = false) {
  if (!data?.[subject]) return null;
  const out = clone(data);
  for (const key of Object.keys(out[subject].sections ?? {})) {
    if (snapshots?.[key]) out[subject].sections[key] = snapshots[key];
  }
  settleMeta(out, subject, meta, party);
  return out;
}

export function applyForget(data, subject) {
  if (!data || !(subject in data)) return null;
  const out = clone(data);
  delete out[subject];
  return out;
}

/**
 * Drop held-back abilities nobody has earned, across the whole dex.
 *
 * Worlds from before this rule kept every subject's uncategorised abilities in
 * the store from the first reveal on. Run once by the active GM; null when
 * there was nothing to drop. It reads under the loosest rule (the union), so it
 * only ever drops what no reading of the table could have earned.
 */
export function scrubDeferred(data) {
  let changed = false;
  const out = clone(data);
  for (const entry of Object.values(out)) {
    if (!plain(entry?.meta) || !Array.isArray(entry.meta.deferred) || !entry.meta.deferred.length) continue;
    if (completeForSomeone(entry, true)) continue;
    entry.meta.deferred = [];
    changed = true;
  }
  return changed ? out : null;
}
