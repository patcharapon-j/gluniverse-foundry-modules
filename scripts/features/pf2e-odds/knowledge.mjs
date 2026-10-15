/**
 * What a viewer knows about a creature's stat — the Foundry half.
 *
 * Two sources, in order:
 *
 *   1. Creaturedex, when that feature is on. A revealed section is exact. A
 *      false section is ALSO exact, and the player's odds are built on it:
 *      they believe it. Only the GM's view is told it is a lie.
 *   2. The observation ledger (`od.ledger`), this feature's own store. It
 *      never writes to the dex: the dex pins "the reveal is the GM's click,
 *      no roll hook", and that stays true.
 *
 * Who knows follows the dex's Party Knowledge setting when the dex is on, and
 * this feature's own `od.partyKnowledge` when it is off — one rule per table,
 * not two that can disagree.
 *
 * Not a secrecy boundary. Foundry hands every client the full Actor document,
 * so a player who opens the console can read the ogre's AC whatever this file
 * says. What it guarantees is that nothing the suite DRAWS for a player is
 * more than the party has seen.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID as DEX_ID, SETTINGS as DEX_SETTINGS, PARTY_KEY as DEX_PARTY } from "../pf2e-creaturedex/constants.mjs";
import { dexKey } from "../pf2e-creaturedex/identity.mjs";
import { falseSections, knownSections, readAll as readDex } from "../pf2e-creaturedex/store.mjs";
import { SETTINGS } from "./constants.mjs";
import { statsFromSections } from "./dex-parse.mjs";
import { PARTY, contradicted, readStat } from "./ledger-model.mjs";

export { dexKey as kindOf };

const setting = (key, fallback) => {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
};

export const dexOn = () => {
  try {
    return Suite.enabled(DEX_ID);
  } catch {
    return false;
  }
};

/** Party mode: the dex's sidebar when the dex runs, ours otherwise. */
export const partyMode = () => (dexOn() ? !!setting(DEX_SETTINGS.party, true) : !!setting(SETTINGS.partyKnowledge, true));

/**
 * A creature, for odds purposes: anything no player owns.
 * A summoner's eidolon, a familiar or a companion is the party's own side.
 */
export const isCreature = (actor) => !!actor && !actor.hasPlayerOwner;

/** The characters a user reads knowledge as. */
export function charactersOf(user = game.user) {
  const own = (game.actors ?? []).filter((a) => a.type === "character" && a.testUserPermission?.(user, "OWNER"));
  if (user?.character && !own.includes(user.character)) own.unshift(user.character);
  return own;
}

/** The ledger owners a user reads (and, for observations, writes) under. */
export function ledgerOwners(user = game.user) {
  if (partyMode()) return [PARTY];
  return charactersOf(user).map((a) => a.id);
}

/** Every party character id, for filing an observation in per-character mode. */
export function partyCharacterIds() {
  const members = game.actors?.party?.members;
  if (Array.isArray(members) && members.length) return members.filter((a) => a?.type === "character").map((a) => a.id);
  return (game.actors ?? []).filter((a) => a.type === "character" && a.hasPlayerOwner).map((a) => a.id);
}

export const readLedger = () => setting(SETTINGS.ledger, {}) ?? {};

/**
 * What the dex states about one kind for one reader, true and false.
 * @returns {{stats: Record<string, number>, lies: Set<string>}}
 */
const DEX_CACHE = new Map();

/** Drop memoised dex reads: the dex or its party setting changed. */
export const clearKnowledgeCache = () => DEX_CACHE.clear();

function dexStats(kind, owners) {
  if (!dexOn() || !kind) return { stats: {}, lies: new Set() };
  // The dex store deep-clones its whole setting per read; one parse per
  // (kind, readers) until the next knowledge change is plenty.
  const key = `${kind}|${partyMode() ? DEX_PARTY : [...owners].sort().join(",")}`;
  if (!DEX_CACHE.has(key)) DEX_CACHE.set(key, dexStatsUncached(kind, owners));
  return DEX_CACHE.get(key);
}

function dexStatsUncached(kind, owners) {
  const all = readDex();
  const entry = all?.[kind];
  if (!entry) return { stats: {}, lies: new Set() };
  const readers = partyMode() ? [DEX_PARTY] : owners;
  const known = new Set(readers.flatMap((o) => knownSections(kind, o)));
  const trueSnaps = Object.fromEntries([...known].map((k) => [k, entry.sections?.[k]]).filter(([, v]) => v));
  const stats = statsFromSections(trueSnaps);
  const lies = new Set();
  for (const o of readers) {
    for (const lie of falseSections(kind, o)) {
      const believed = statsFromSections({ [lie.section]: lie.snapshot ?? lie });
      for (const [k, v] of Object.entries(believed)) {
        // A truth anyone reading here holds beats a lie someone else was told,
        // exactly as the dex never lets a lie overwrite a section known truly.
        if (k in stats && !lies.has(k)) continue;
        stats[k] = v;
        lies.add(k);
      }
    }
  }
  return { stats, lies };
}

/**
 * One stat, as a reader knows it.
 * @param {Actor} creature
 * @param {string} stat
 * @param {{user?: User, owners?: string[]}} [who]
 * @returns {{range: {lo,hi}|null, source: "dex"|"ledger"|null, lie: boolean, contradiction: boolean}}
 */
export function knownStat(creature, stat, { user = game.user, owners = null } = {}) {
  const kind = dexKey(creature);
  if (!kind) return { range: null, source: null, lie: false, contradiction: false };
  const chars = owners ?? charactersOf(user).map((a) => a.id);
  const dex = dexStats(kind, chars);
  if (stat in dex.stats) {
    const v = dex.stats[stat];
    return { range: { lo: v, hi: v }, source: "dex", lie: dex.lies.has(stat), contradiction: false };
  }
  const ledger = readLedger();
  const ledgerOwnersList = partyMode() ? [PARTY] : chars;
  const range = readStat(ledger, kind, ledgerOwnersList, stat);
  return { range, source: range ? "ledger" : null, lie: false, contradiction: contradicted(ledger, kind, stat) };
}

/**
 * The same stat as the PLAYERS know it, for the GM's "players see" tag.
 * In per-character mode that is the party as a whole (every character's
 * knowledge intersected), which is the honest answer to "what does the table
 * know".
 */
export function playersKnow(creature, stat) {
  const owners = partyMode() ? [PARTY] : partyCharacterIds();
  return knownStat(creature, stat, { owners });
}
