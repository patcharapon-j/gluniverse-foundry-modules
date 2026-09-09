/**
 * Creaturedexing — what the party knows, and where it is kept.
 *
 * One world setting holds the whole dex. It is deliberately *not* actor flags:
 * knowledge is a relation between a character and a creature, and a flag can
 * only live on one end of it. On the creature it would be wiped by re-importing
 * the bestiary entry; on the character it would be writable by that character's
 * own player, who is precisely the person it is being kept from.
 *
 * ## The store holds snapshots, not pointers
 *
 * This is the load-bearing decision and it is a privacy one, not a performance
 * one. Foundry hands every client the full Actor document; a player who holds
 * no permission on a creature can still read `actor.system` from the console.
 * So a dex that stored "Seri knows the Defense section" and then *rendered from
 * the live actor* would be redacting a stat block the player already has — the
 * lock would be drawn on the player's own screen, over data sitting one line of
 * console away.
 *
 * A section is therefore **rendered by the GM's client at reveal time and the
 * result is written into the store**. The store then contains exactly what has
 * been handed over and nothing else. A player who reads it directly learns
 * precisely what they were told, which is the only kind of honesty that
 * survives a curious player.
 *
 * The consequence is that a revealed section is a *memory*, not a live view.
 * That is thematically right — a creature the GM buffed last session should
 * surprise the party — and `refresh` exists for the GM who edits a creature and
 * wants the dex to agree.
 *
 * Snapshots are taken **post-flatten**, because `pf2e-flatten` rewrites NPC
 * numbers in Proficiency-without-Level worlds and the player should see the
 * numbers that will really apply at their table.
 *
 * ## Ownership, and why Party Knowledge is a read
 *
 *   "In the event that shared party knowledge is fully transferable between the
 *    party, any party member succeeding at Recall Knowledge contributes to a
 *    Completed Creaturedex."
 *
 * Writes always land on the character who earned them. The Party Knowledge
 * sidebar changes only how a read is resolved: it unions every owner instead of
 * reading one. So the setting can be turned on and off mid-campaign without
 * destroying or inventing a single fact, which a shared-pool-on-write design
 * could not manage in either direction.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { ALL_SECTION_KEYS, PARTY_KEY, SETTINGS } from "./constants.mjs";

const KEY = "dex.knowledge";

const clone = (v) => foundry.utils.deepClone(v ?? {});

export function get(key, fallback = undefined) {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
}

export const partyMode = () => !!get(SETTINGS.party, true);

/** The whole dex, as a plain object. Never mutated in place. */
export const readAll = () => clone(get(KEY, {}));

async function writeAll(data) {
  try {
    return await game.settings.set(SUITE_ID, KEY, data);
  } catch (error) {
    warn("pf2e-creaturedex | could not write the dex", error);
    return undefined;
  }
}

/** The character a piece of knowledge belongs to. */
export const ownerKey = (pc) => pc?.id ?? null;

/**
 * The characters "the whole party" means.
 *
 * PF2e's party actor is the answer when the world has one, because it is the
 * roster the GM already curates and it excludes the retired characters and NPC
 * stand-ins that `type === "character"` alone would sweep up. Without one, fall
 * back to characters a player actually owns — an unowned character is a prop,
 * and revealing to it writes knowledge nobody will ever read.
 */
export function partyCharacters() {
  const party = game.actors?.party ?? null;
  const members = party?.members ?? null;
  if (Array.isArray(members) && members.length) return members.filter((a) => a?.type === "character");
  return (game.actors ?? []).filter(
    (a) => a.type === "character" && Object.entries(a.ownership ?? {}).some(([id, level]) => id !== "default" && level === 3)
  );
}

const entryOf = (data, subject) => data[subject] ?? null;

const ownerRecords = (entry, owner) =>
  partyMode() || owner === PARTY_KEY ? Object.values(entry?.owners ?? {}) : [entry?.owners?.[owner]];

/**
 * Sections this character knows about this subject.
 *
 * In Party Knowledge mode every owner's set is unioned, which is the sidebar's
 * whole effect.
 */
export function knownSections(subject, owner) {
  const entry = entryOf(readAll(), subject);
  if (!entry?.owners) return [];
  const out = new Set();
  for (const rec of ownerRecords(entry, owner)) for (const key of rec?.sections ?? []) out.add(key);
  return [...out];
}

/**
 * False knowledge: sections this character believes and should not.
 *
 * Each carries its own rendered snapshot, because a lie told to one character
 * need not be the lie told to another — the GM may doctor differently, or
 * borrow a different creature, for two people who rolled separately.
 */
export function falseSections(subject, owner) {
  const entry = entryOf(readAll(), subject);
  if (!entry?.owners) return [];
  const out = new Map();
  for (const rec of ownerRecords(entry, owner)) {
    for (const [section, lie] of Object.entries(rec?.false ?? {})) {
      if (!out.has(section)) out.set(section, { section, ...lie });
    }
  }
  return [...out.values()];
}

/** The stored snapshot of a truly-known section, or null. */
export const trueSnapshot = (subject, section) => entryOf(readAll(), subject)?.sections?.[section] ?? null;

/** Everything the dex records about a subject that is not a section. */
export const subjectMeta = (subject) => entryOf(readAll(), subject)?.meta ?? null;

/** Which sections this subject is known to have at all, for completion. */
export const availableFor = (subject) => entryOf(readAll(), subject)?.meta?.available ?? [];

const blankOwner = () => ({ sections: [], false: {} });

function mutate(data, subject, owner) {
  data[subject] ??= { meta: null, sections: {}, owners: {} };
  data[subject].sections ??= {};
  data[subject].owners ??= {};
  data[subject].owners[owner] ??= blankOwner();
  const rec = data[subject].owners[owner];
  rec.sections ??= [];
  // Older entries stored lies as an array; read either shape.
  if (Array.isArray(rec.false)) rec.false = Object.fromEntries(rec.false.map((f) => [f.section, f]));
  rec.false ??= {};
  return rec;
}

/**
 * Owners as a list.
 *
 * Every write takes one owner or many and performs a single settings write, so
 * revealing to a five-member party is one round trip rather than five — and,
 * more importantly, cannot half-apply if one of them fails.
 */
const ownerList = (owner) => (Array.isArray(owner) ? owner : [owner]).filter(Boolean);

/**
 * Record one or more sections as truly learned, for one owner or several.
 *
 * `snapshots` is `{ [sectionKey]: renderedSection }` and `meta` describes the
 * subject. Both are produced by the GM's client, which is the only one that can
 * read the creature honestly.
 */
export async function reveal(subject, owner, keys, snapshots = {}, meta = null) {
  const owners = ownerList(owner);
  if (!subject || !owners.length) return false;
  const wanted = (Array.isArray(keys) ? keys : [keys]).filter((k) => ALL_SECTION_KEYS.includes(k));
  if (!wanted.length) return false;

  const data = readAll();
  for (const one of owners) {
    const rec = mutate(data, subject, one);
    const set = new Set(rec.sections);
    for (const key of wanted) set.add(key);
    rec.sections = [...set];
    // A section learned truly overrides a lie about the same section. The
    // reverse is not true — see `revealFalse`.
    for (const key of wanted) delete rec.false[key];
  }
  if (meta) data[subject].meta = { ...(data[subject].meta ?? {}), ...meta };
  for (const key of wanted) {
    if (snapshots[key]) data[subject].sections[key] = snapshots[key];
  }
  await writeAll(data);
  return true;
}

/**
 * Record a lie.
 *
 *   "the GM also reveals an incorrect stat block for the creature or hazard of
 *    your choice (either by modifying the existing stat block or giving one for
 *    another creature)."
 *
 * The lie's own rendered snapshot is stored beside the truth rather than
 * replacing it, so the GM can still see what the real answer was three sessions
 * later — the single most useful property of lying to players on purpose.
 *
 * A lie never overwrites a section already known truly: a character who has
 * seen a creature's real AC does not un-see it by rolling badly later, and
 * silently replacing true knowledge with false would make a bad roll *destroy*
 * something the player earned rather than fail to add to it.
 */
export async function revealFalse(subject, owner, section, snapshot, source = null, meta = null) {
  const owners = ownerList(owner);
  if (!subject || !owners.length || !ALL_SECTION_KEYS.includes(section)) return false;
  const data = readAll();
  let wrote = false;
  for (const one of owners) {
    const rec = mutate(data, subject, one);
    if (rec.sections.includes(section)) continue;
    rec.false[section] = { snapshot: snapshot ?? null, from: source ?? null };
    wrote = true;
  }
  if (!wrote) return false;
  if (meta) data[subject].meta = { ...(data[subject].meta ?? {}), ...meta };
  await writeAll(data);
  return true;
}

/** Take a section back — the GM's undo, and the only way a lie is corrected. */
export async function redact(subject, owner, section) {
  const data = readAll();
  let wrote = false;
  for (const one of ownerList(owner)) {
    const rec = data[subject]?.owners?.[one];
    if (!rec) continue;
    rec.sections = (rec.sections ?? []).filter((k) => k !== section);
    if (Array.isArray(rec.false)) rec.false = Object.fromEntries(rec.false.map((f) => [f.section, f]));
    delete (rec.false ??= {})[section];
    wrote = true;
  }
  if (!wrote) return false;
  // Drop the truth snapshot once nobody holds that section any more, so the
  // store keeps its one guarantee: it contains only what somebody was told.
  const stillKnown = Object.values(data[subject]?.owners ?? {}).some((r) => (r?.sections ?? []).includes(section));
  if (!stillKnown) delete data[subject]?.sections?.[section];
  await writeAll(data);
  return true;
}

/**
 * Re-take every snapshot the dex is currently holding for this subject.
 *
 * The GM edited a creature and wants the dex to agree. Only sections somebody
 * already holds are re-taken; refreshing never hands out a section nobody
 * bought, and a lie is left alone because it was authored rather than read.
 */
export async function refresh(subject, snapshots = {}, meta = null) {
  const data = readAll();
  const entry = data[subject];
  if (!entry) return false;
  for (const key of Object.keys(entry.sections ?? {})) {
    if (snapshots[key]) entry.sections[key] = snapshots[key];
  }
  if (meta) entry.meta = { ...(entry.meta ?? {}), ...meta };
  await writeAll(data);
  return true;
}

/** Forget a subject entirely, for every character. */
export async function forget(subject) {
  const data = readAll();
  if (!(subject in data)) return false;
  delete data[subject];
  await writeAll(data);
  return true;
}

/** Every subject anyone has learned anything about, for the dex browser. */
export function knownSubjects() {
  const data = readAll();
  return Object.entries(data)
    .filter(([, entry]) =>
      Object.values(entry?.owners ?? {}).some(
        (o) => (o?.sections?.length ?? 0) + Object.keys(o?.false ?? {}).length > 0
      )
    )
    .map(([key]) => key);
}
