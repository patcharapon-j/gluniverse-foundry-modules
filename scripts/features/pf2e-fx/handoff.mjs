/**
 * Spellsprite — the rider hand-off. Pure: read.mjs feeds it what it saw.
 *
 * A creature's Strike that lists Grab, Knockdown or Push (Improved too) does
 * not grab, trip or shove anyone by itself: PF2e makes it a follow-up, either
 * the creature's own Grab / Knockdown / Push action or a Grapple / Trip / Shove
 * check, and Spellsprite already plays that follow-up as its archetype with its
 * real outcome. So the Strike plays only its blow (semantics.mjs `riderOf`
 * still marks it), and this module remembers, per attacker TOKEN, which body
 * part delivered it. When that attacker's follow-up of the same archetype
 * arrives inside `TIMING.handoff`, the follow-up draws with that body part: a
 * frog's tongue grab closes as coils, a wolf's knockdown keeps its jaws.
 *
 * It only ever restyles a spec that is already playing; it never makes one.
 */

/** The archetypes a Strike rider hands over to (semantics.mjs RIDER_RULES). */
export const HANDOFF_ARCHES = Object.freeze(new Set(["grab", "trip", "shove", "rend"]));

/** The PF2e action each hand-off archetype's follow-up check rolls. Rend has none: it just deals damage. */
const FOLLOW_UP_ACTION = Object.freeze({ grab: "grapple", trip: "trip", shove: "shove" });
/** packs/actions ids of Grapple, Trip and Shove, for `@UUID[Compendium.pf2e.actionspf2e.Item.<id>]` links. */
const ACTION_IDS = Object.freeze({ PMbdMWc2QroouFGD: "grapple", ge56Lu1xXVFYUnLP: "trip", "7blmbDrQFNfdT731": "shove" });

/**
 * Is a maneuver action's card only the button for a check? PF2e's Grab,
 * Improved Grab, Knockdown and Push (packs/bestiary-ability-glossary-srd) are
 * `@Localize[PF2E.NPC.Abilities.Glossary.*]`, whose text has the monster
 * "attempt to [[/act grapple]]" (trip, shove); older printings link the action
 * (`@UUID[...actionspf2e.Item.<id>]{Trip}`). That check is the maneuver, and
 * plays it with its real outcome and the Strike's body part, so the card plays
 * nothing. A card with none of these (an older "automatically Grabs") is the
 * maneuver itself. A bare `@Check[athletics]` does not count: its roll carries
 * no `action:` option, so nothing would play it (Clutch, Reposition), and it is
 * as often the TARGET's way out (Tangled Forest Trip: "a Reflex save, Acrobatics
 * or Athletics"), whose save joins the card. Only one that tags the action
 * itself (`@Check[athletics|traits:action:trip]`) is the attacker's maneuver.
 * @param {string} arch   the card's archetype
 * @param {object} item   the action item (its `system.description.value` is read raw)
 * @param {(key: string) => string} [localize]  expands `@Localize[key]` (game.i18n.localize)
 */
export function checkBacked(arch, item, localize = null) {
  const act = FOLLOW_UP_ACTION[arch];
  if (!act) return false;
  let text = String(item?.system?.description?.value ?? "");
  if (localize) {
    text = text.replace(/@Localize\[([^\]]+)\]/g, (m, key) => {
      try { const v = localize(key); return typeof v === "string" ? v : m; } catch { return m; }
    });
  }
  if (new RegExp(`\\[\\[/act ${act}\\b`, "i").test(text)) return true;
  for (const m of text.matchAll(/@Check\[(?:type:)?athletics\b([^\]]*)\]/gi)) if (new RegExp(`\\baction:${act}\\b`, "i").test(m[1])) return true;
  for (const m of text.matchAll(/@UUID\[Compendium\.pf2e\.actionspf2e\.Item\.([A-Za-z0-9-]+)\](?:\{([^}]*)\})?/g)) {
    if ((ACTION_IDS[m[1]] ?? m[1].toLowerCase()) === act || String(m[2] ?? "").trim().toLowerCase() === act) return true;
  }
  return false;
}

/** A Strike's body part, from its described spec: what a follow-up draws with. */
export function limbOf(desc, itemSlug = null) {
  if (!desc) return null;
  return {
    delivery: desc.delivery ?? null, motif: desc.motif ?? null,
    slug: itemSlug ?? desc.slug ?? null, rider: desc.rider?.slug ?? null,
    style: desc.weapon?.style ?? null,
  };
}

/**
 * The last rider-bearing hit per attacker token. Bounded (oldest dropped
 * first), keyed by token id only (two goblins of one actor are two creatures),
 * and every entry expires `window` seconds after the Strike arrived.
 */
export class Riders {
  constructor({ window = 12, limit = 64 } = {}) { this.window = window; this.limit = limit; this.map = new Map(); }

  /**
   * A Strike from `tokenId` arrived. Any Strike replaces what that token held:
   * only the LAST one's rider is followed up, and a miss or a hidden degree
   * leaves nothing behind.
   * @param {string} tokenId
   * @param {{rider?: {arch: string}|null, limb?: object|null, outcome: string, target?: string|null, at: number}} strike
   */
  note(tokenId, { rider = null, limb = null, outcome = "neutral", target = null, at = 0 } = {}) {
    if (!tokenId) return;
    this.map.delete(tokenId);
    if (!rider || !HANDOFF_ARCHES.has(rider.arch) || !limb) return;
    if (outcome !== "hit" && outcome !== "crit") return;
    this.map.set(tokenId, { arch: rider.arch, limb, target: target ?? null, at });
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }

  /**
   * The body part for `tokenId`'s follow-up of archetype `arch`, or null. A
   * different archetype, an expired entry, or a follow-up aimed at somebody
   * else takes nothing. A match is consumed: one Strike, one follow-up.
   * @param {string} tokenId
   * @param {string} arch
   * @param {{at: number, targets?: string[]}} follow
   */
  take(tokenId, arch, { at = 0, targets = [] } = {}) {
    const e = tokenId ? this.map.get(tokenId) : null;
    if (!e) return null;
    if (at - e.at > this.window || at < e.at) { this.map.delete(tokenId); return null; }
    if (e.arch !== arch) return null;
    if (e.target && targets.length && !targets.includes(e.target)) return null;
    this.map.delete(tokenId);
    return e.limb;
  }

  get size() { return this.map.size; }
  clear() { this.map.clear(); }
}
