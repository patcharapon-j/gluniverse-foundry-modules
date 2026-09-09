/**
 * Creaturedexing — what counts as "the same creature".
 *
 * The book is about a creature *kind*, not a token:
 *
 *   "When a character successfully uses Recall Knowledge on a creature, they
 *    choose which of the three stat blocks to reveal."
 *
 * You learn what a goblin warrior *is*. But one goblin warrior can exist in a
 * Foundry world three ways at once — the compendium entry, a world duplicate
 * with the compendium link severed, and something `statsblock-import` built —
 * and those are one monster to the fiction and three documents to Foundry.
 *
 * Keying on the actor's own UUID would file each of them separately, so a party
 * that fought goblins in three dungeons would have learned goblins three times
 * and completed none of them. That is the opposite of what a dex is for.
 *
 * So: the **compendium source** where the actor has one, because that is the
 * durable identity of a monster across every copy made from it, falling back to
 * a normalised name-and-level slug where it does not. Both come back as one
 * opaque `dexKey`, so the fallback is invisible to every caller.
 *
 * Pure and Foundry-free: `slugify` is written here rather than borrowed from
 * `foundry.utils` so the check tool can exercise the keying under plain Node.
 */

/** Lowercase, punctuation stripped, runs of anything else collapsed to `-`. */
export function slugify(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // NFKD does not decompose these; left alone they become hyphens, so a name
    // would key on a slug with a gap where a letter is.
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[łđ]/g, (c) => (c === "ł" ? "l" : "d"))
    .replace(/þ/g, "th")
    .replace(/ð/g, "d")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The compendium entry an actor was made from, if any.
 *
 * Foundry records this at `_stats.compendiumSource` (v12+); older worlds carry
 * `flags.core.sourceId`, and a document read straight out of a pack has neither
 * because it *is* the source. All three are checked, in that order.
 */
export function compendiumSource(actor) {
  if (!actor) return null;
  const stats = actor._stats?.compendiumSource ?? null;
  if (typeof stats === "string" && stats.startsWith("Compendium.")) return stats;
  const legacy = actor.flags?.core?.sourceId ?? null;
  if (typeof legacy === "string" && legacy.startsWith("Compendium.")) return legacy;
  const own = actor.uuid ?? null;
  return typeof own === "string" && own.startsWith("Compendium.") ? own : null;
}

/**
 * The identity a dex entry is filed under.
 *
 * An unlinked token carries a synthetic actor whose uuid names the *token*, so
 * the base actor is resolved first — otherwise every copy on the map would be
 * its own creature and would be re-filed again when the scene was reset.
 *
 * The level is part of the slug fallback deliberately. An elite variant a GM
 * built by hand is arguably a different creature, and the party learning the
 * ordinary goblin's AC should not silently answer for the one that hits harder.
 */
export function dexKey(actor) {
  if (!actor) return null;
  const base = actor.isToken ? (actor.token?.baseActor ?? actor) : actor;
  const source = compendiumSource(base);
  if (source) return source;
  const name = slugify(base.name);
  if (!name) return null;
  const level = Number(base.system?.details?.level?.value);
  return `slug.${name}.${Number.isFinite(level) ? level : "x"}`;
}
