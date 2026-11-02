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
 * the live actor* would be redacting a stat block the player already has: the
 * lock would be drawn on the player's own screen, over data one line away.
 *
 * A section is therefore **rendered by the GM's client at reveal time and the
 * result is written into the store**. The store then contains exactly what has
 * been handed over and nothing else, including the abilities PF2e left
 * uncategorised, which stay out of it until somebody completes the entry
 * (`ledger.mjs`, `settleMeta`).
 *
 * A revealed section is a *memory*, not a live view: a creature the GM buffed
 * last session should surprise the party, and `refresh` exists for the GM who
 * fixed a creature and wants the dex to agree. Snapshots are taken
 * **post-flatten**, because `pf2e-flatten` rewrites NPC numbers in
 * Proficiency-without-Level worlds and the player should see what will really
 * apply at their table.
 *
 * ## Ownership, and why Party Knowledge is a read
 *
 * Writes always land on the characters who earned them, one row each. The Party
 * Knowledge sidebar changes only how a read is resolved: it unions every owner
 * instead of reading one. So it can be turned on and off mid-campaign without
 * destroying or inventing a single fact.
 *
 * Every rule lives in `ledger.mjs` as a pure function; this file is the one
 * setting read and the one setting write around them.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { SETTINGS } from "./constants.mjs";
import { buildSections } from "./sections.mjs";
import {
  applyDeferred,
  applyFalse,
  applyForget,
  applyRedact,
  applyRefresh,
  applyReveal,
  falseIn,
  knownIn,
  metaIn,
  scrubDeferred,
  subjectsIn,
  truthIn,
} from "./ledger.mjs";

const KEY = "dex.knowledge";

/** The full setting key, for an `updateSetting` hook to compare against. */
export const KNOWLEDGE_SETTING = KEY;

export function get(key, fallback = undefined) {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
}

export const partyMode = () => !!get(SETTINGS.party, true);

/** The whole dex, as a plain object. Never mutated in place. */
export const readAll = () => {
  const raw = get(KEY, {});
  return raw && typeof raw === "object" ? JSON.parse(JSON.stringify(raw)) : {};
};

async function writeAll(data) {
  if (!data) return false;
  try {
    await game.settings.set(SUITE_ID, KEY, data);
    return true;
  } catch (error) {
    warn("pf2e-creaturedex | could not write the dex", error);
    return false;
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
 * back to characters a player actually owns: an unowned character is a prop,
 * and revealing to it writes knowledge nobody will ever read.
 */
export function partyCharacters() {
  const members = game.actors?.party?.members ?? null;
  if (Array.isArray(members) && members.length) return members.filter((a) => a?.type === "character");
  return (game.actors ?? []).filter(
    (a) => a.type === "character" && Object.entries(a.ownership ?? {}).some(([id, level]) => id !== "default" && level === 3)
  );
}

/** Sections this character knows truly. In Party Knowledge mode, the union. */
export const knownSections = (subject, owner) => knownIn(readAll(), subject, owner, partyMode());

/** False knowledge, each carrying its own rendered snapshot. */
export const falseSections = (subject, owner) => falseIn(readAll(), subject, owner, partyMode());

/** The stored snapshot of a truly-known section, or null. */
export const trueSnapshot = (subject, section) => truthIn(readAll(), subject, section);

/** Everything the dex records about a subject that is not a section. */
export const subjectMeta = (subject) => metaIn(readAll(), subject);

export const availableFor = (subject) => metaIn(readAll(), subject)?.available ?? [];

/** Every subject anyone has learned anything about, for the dex browser. */
export const knownSubjects = () => subjectsIn(readAll());

export const reveal = (subject, owner, keys, snapshots = {}, meta = null) =>
  writeAll(applyReveal(readAll(), subject, owner, keys, snapshots, meta, partyMode()));

export const revealFalse = (subject, owner, section, snapshot, source = null, meta = null) =>
  writeAll(applyFalse(readAll(), subject, owner, section, snapshot, source, meta, partyMode()));

export const redact = (subject, owner, section) => writeAll(applyRedact(readAll(), subject, owner, section, partyMode()));

export const refresh = (subject, snapshots = {}, meta = null) =>
  writeAll(applyRefresh(readAll(), subject, snapshots, meta, partyMode()));

export const forget = (subject) => writeAll(applyForget(readAll(), subject));

/** Drop held-back abilities nobody earned (older worlds stored them early). */
export const scrub = () => writeAll(scrubDeferred(readAll(), partyMode()));

/**
 * Bring the stored held-back abilities in line with the current read rule, in
 * both directions. Switching Party Knowledge off can un-earn them (scrubbed);
 * switching it back on earns them again, and only the live creature still has
 * them, so they are read back off it here. Active GM only.
 */
export async function settleDeferred() {
  await scrub();
  const party = partyMode();
  let data = readAll();
  let changed = false;
  for (const subject of Object.keys(data)) {
    const meta = metaIn(data, subject);
    if (!meta?.uuid || meta.deferred?.length) continue;
    // Cheap test first: a write that would be refused needs no actor lookup.
    if (!applyDeferred(data, subject, [{}], party)) continue;
    const actor = await fromUuid(meta.uuid).catch(() => null);
    const next = actor ? applyDeferred(data, subject, buildSections(actor).deferred, party) : null;
    if (next) {
      data = next;
      changed = true;
    }
  }
  return changed ? writeAll(data) : false;
}
