/**
 * Reading numbers back out of a Creaturedex snapshot.
 *
 * The dex stores *rendered* sections, not live numbers (see the store's module
 * note — a snapshot is what the party was told, which is the whole privacy
 * model). So odds built on the dex read what was told: "AC 21 (all-around
 * vision)" is AC 21, "Fortitude +12, Reflex +9, Will +8" are DCs 22, 19 and 18,
 * an offense strike's "+14" is that Strike's modifier, "DC 25" is a spell DC.
 *
 * A lie is a snapshot in the same shape, so a believed number parses exactly
 * like a true one — which is the point: the player's odds are built on what
 * they believe.
 *
 * Pure; the check tool drives it with snapshots in the shape
 * `features/pf2e-creaturedex/sections.mjs` builds.
 */

import { strikeStat } from "./constants.mjs";

/** The leading signed or unsigned integer of a string, or null. */
export function leadingInt(text) {
  const m = String(text ?? "").match(/^\s*([+-−]?\d+)/);
  if (!m) return null;
  const n = Number(m[1].replace("−", "-"));
  return Number.isFinite(n) ? n : null;
}

/** "Fortitude +12, Reflex +9, Will +8" → { fortitude: 22, reflex: 19, will: 18 } (DCs). */
export function parseSaves(text) {
  const out = {};
  for (const [, name, value] of String(text ?? "").matchAll(/\b(Fortitude|Reflex|Will)\s*([+-−]\d+)/gi)) {
    const mod = Number(value.replace("−", "-"));
    if (Number.isFinite(mod)) out[name.toLowerCase()] = 10 + mod;
  }
  return out;
}

/** The slug a Strike is filed under, from its name. Matches PF2e's sluggify for plain names. */
export function strikeSlug(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const rowValue = (section, key) => section?.rows?.find?.((r) => r?.key === key)?.value ?? null;

/**
 * Every number a set of sections states, keyed by odds stat.
 * @param {Record<string, object>} sections  section key → snapshot
 * @returns {Record<string, number>}
 */
export function statsFromSections(sections) {
  const out = {};
  const defense = sections?.defense;
  if (defense) {
    const ac = leadingInt(rowValue(defense, "ac"));
    if (ac != null) out.ac = ac;
    Object.assign(out, parseSaves(rowValue(defense, "saves")));
  }
  const characteristics = sections?.characteristics;
  if (characteristics) {
    const per = leadingInt(rowValue(characteristics, "perception"));
    if (per != null) out.perception = 10 + per;
  }
  const offense = sections?.offense;
  if (offense) {
    for (const s of [...(offense.strikes?.melee ?? []), ...(offense.strikes?.ranged ?? [])]) {
      const mod = leadingInt(s?.bonus);
      const slug = strikeSlug(s?.name);
      if (mod != null && slug) out[strikeStat(slug)] = mod;
    }
    // The highest stated spell DC and spell attack: a creature with several
    // entries casts from whichever the GM picks, and the dex cannot tell which.
    for (const sp of offense.spells ?? []) {
      const dc = String(sp?.dc ?? "").match(/DC\s*(\d+)/i);
      if (dc) out["spell-dc"] = Math.max(out["spell-dc"] ?? 0, Number(dc[1]));
      const atk = String(sp?.attack ?? "").match(/([+-−]\d+)/);
      if (atk) out["spell-attack"] = Math.max(out["spell-attack"] ?? -Infinity, Number(atk[1].replace("−", "-")));
    }
  }
  return out;
}
