/**
 * Creaturedexing — what the party knows, and where it is kept.
 *
 * One world setting holds the whole dex. It is deliberately *not* actor flags:
 * knowledge is a relation between a character and a creature, and a flag can
 * only live on one end of it. On the creature it would be wiped by re-importing
 * the bestiary entry; on the character it would be writable by that character's
 * own player, who is precisely the person it is being kept from.
 *
 * ## Identity
 *
 * A dex entry is keyed by the **base actor's** UUID, so the eight goblin
 * warriors in a room are one creature to learn, not eight. That is the book's
 * reading — you learn what a goblin warrior *is* — and it is also the only one
 * that survives a GM deleting the tokens after the fight.
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

export const partyMode = () => !!get(SETTINGS.party, false);

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

/**
 * The identity a dex entry is filed under.
 *
 * An unlinked token carries a synthetic actor whose uuid names the *token*, so
 * reading `actor.uuid` there would file every copy separately and re-file it
 * again the moment the scene was reset. `token.baseActor` is the thing the GM
 * dragged onto the map, which is what the party is learning about.
 */
export function subjectKey(actor) {
  if (!actor) return null;
  const base = actor.isToken ? (actor.token?.baseActor ?? null) : null;
  return base?.uuid ?? actor.uuid ?? null;
}

/** The character a piece of knowledge belongs to. */
export const ownerKey = (pc) => pc?.id ?? null;

const entryOf = (data, subject) => data[subject] ?? null;

/**
 * Sections this character knows about this subject.
 *
 * In Party Knowledge mode every owner's set is unioned, which is the sidebar's
 * whole effect.
 */
export function knownSections(subject, owner) {
  const entry = entryOf(readAll(), subject);
  if (!entry?.owners) return [];
  const owners = partyMode() || owner === PARTY_KEY ? Object.values(entry.owners) : [entry.owners[owner]];
  const out = new Set();
  for (const rec of owners) for (const key of rec?.sections ?? []) out.add(key);
  return [...out];
}

/** False knowledge: a section this character believes and should not. */
export function falseSections(subject, owner) {
  const entry = entryOf(readAll(), subject);
  if (!entry?.owners) return [];
  const owners = partyMode() || owner === PARTY_KEY ? Object.values(entry.owners) : [entry.owners[owner]];
  return owners.flatMap((rec) => rec?.false ?? []).filter(Boolean);
}

const blankOwner = () => ({ sections: [], false: [], attempts: 0, encounterId: null });

function mutate(data, subject, owner) {
  data[subject] ??= { owners: {} };
  data[subject].owners ??= {};
  data[subject].owners[owner] ??= blankOwner();
  return data[subject].owners[owner];
}

/** Record one or more sections as truly learned. */
export async function reveal(subject, owner, keys) {
  if (!subject || !owner) return false;
  const wanted = (Array.isArray(keys) ? keys : [keys]).filter((k) => ALL_SECTION_KEYS.includes(k));
  if (!wanted.length) return false;

  const data = readAll();
  const rec = mutate(data, subject, owner);
  const set = new Set(rec.sections);
  for (const key of wanted) set.add(key);
  rec.sections = [...set];
  // A section learned truly overrides a lie about the same section. The reverse
  // is not true — see `revealFalse`.
  rec.false = (rec.false ?? []).filter((f) => !set.has(f.section));
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
 * A lie never overwrites a section already known truly: a character who has
 * seen a creature's real AC does not un-see it by rolling badly later, and
 * silently replacing true knowledge with false would make a bad roll *destroy*
 * something the player earned rather than fail to add to it.
 */
export async function revealFalse(subject, owner, section, fromUuid) {
  if (!subject || !owner || !ALL_SECTION_KEYS.includes(section)) return false;
  const data = readAll();
  const rec = mutate(data, subject, owner);
  if (rec.sections.includes(section)) return false;
  rec.false = (rec.false ?? []).filter((f) => f.section !== section);
  rec.false.push({ section, from: fromUuid ?? null });
  await writeAll(data);
  return true;
}

/** Take a section back — the GM's undo, and the only way a lie is corrected. */
export async function redact(subject, owner, section) {
  const data = readAll();
  const rec = data[subject]?.owners?.[owner];
  if (!rec) return false;
  rec.sections = (rec.sections ?? []).filter((k) => k !== section);
  rec.false = (rec.false ?? []).filter((f) => f.section !== section);
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

/* ── attempts and observed turns ─────────────────────────────────────────── */

/**
 * Attempts and observed turns are both per-encounter, so both are stamped with
 * the encounter they were counted in and read as zero the moment that changes.
 * Carrying them across fights would make the second encounter with a creature
 * start already out of retries.
 */
export function attemptsIn(subject, owner, encounterId) {
  const rec = readAll()[subject]?.owners?.[owner];
  if (!rec || rec.encounterId !== encounterId) return 0;
  return Math.max(0, Number(rec.attempts) || 0);
}

export async function noteAttempt(subject, owner, encounterId) {
  const data = readAll();
  const rec = mutate(data, subject, owner);
  if (rec.encounterId !== encounterId) {
    rec.encounterId = encounterId;
    rec.attempts = 0;
  }
  rec.attempts += 1;
  await writeAll(data);
}

export function observedIn(subject, encounterId) {
  const entry = readAll()[subject]?.encounter;
  if (!entry || entry.id !== encounterId) return 0;
  return Math.max(0, Number(entry.observed) || 0);
}

export async function noteObserved(subject, encounterId) {
  const data = readAll();
  data[subject] ??= { owners: {} };
  const cur = data[subject].encounter;
  data[subject].encounter = cur?.id === encounterId ? { id: encounterId, observed: (cur.observed || 0) + 1 } : { id: encounterId, observed: 1 };
  await writeAll(data);
}

/** Every subject anyone has learned anything about, for the dex browser. */
export function knownSubjects() {
  const data = readAll();
  return Object.entries(data)
    .filter(([, entry]) => Object.values(entry?.owners ?? {}).some((o) => (o?.sections?.length ?? 0) + (o?.false?.length ?? 0) > 0))
    .map(([uuid]) => uuid);
}
