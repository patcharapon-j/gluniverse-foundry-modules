/**
 * Creaturedexing — Discerning Aid, as a real item.
 *
 *   "You gain access to the Discerning Aid reaction below. … The Discerning Aid
 *    counts as the Aid reaction for all purposes and effects that would work
 *    with Aid."
 *
 * The reaction is granted once, on the character's first completed creaturedex,
 * and never removed: the *requirement* is per-subject ("you have successfully
 * completed the creaturedex of the triggering creature or hazard") but the
 * access is not. Granting and revoking it per creature would put an item on the
 * sheet that appears and disappears between fights, which reads as a bug.
 *
 * It is a real Item rather than a card or a chip because "counts as the Aid
 * reaction for all purposes" only means something if the thing is on the sheet
 * where the player looks for their reactions, and if other effects can find it.
 *
 * Both traits used here — `concentrate` and `secret` — are traits PF2e already
 * knows. That matters: PF2e's trait editor is a tagify widget built with
 * `enforceWhitelist`, so a trait the system has no entry for survives the
 * `create()` and is then dropped the first time a GM opens the item's traits.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { FLAGS, SETTINGS } from "./constants.mjs";
import { get } from "./store.mjs";

export const AID_SLUG = "discerning-aid";

const L = (key) => {
  const s = game.i18n.localize(key);
  return s === key ? "" : s;
};

/** Has this character already been given the reaction? */
export function hasAid(pc) {
  if (pc?.getFlag?.(SUITE_ID, FLAGS.aidGranted)) return true;
  return !!pc?.items?.some?.((i) => i.type === "action" && i.slug === AID_SLUG);
}

function aidItemData() {
  return {
    name: L("GLDEX.aid.name") || "Discerning Aid",
    type: "action",
    img: "icons/skills/trades/academics-investigation-study-blue.webp",
    system: {
      description: { value: L("GLDEX.aid.text") },
      actionType: { value: "reaction" },
      actions: { value: null },
      category: null,
      traits: { value: ["concentrate", "secret"], rarity: "common" },
      slug: AID_SLUG,
      publication: { title: "Adventures+", license: "OGL", remaster: false },
    },
    flags: { [SUITE_ID]: { [FLAGS.aidGranted]: true } },
  };
}

/**
 * Grant the reaction, once.
 *
 * The flag is written as well as the item so a character who deletes the item
 * is not handed a fresh copy on their next completed dex — deleting it is a
 * choice, and re-granting would override it every session.
 */
export async function grantAid(pc) {
  if (!pc || !get(SETTINGS.grantAid, true)) return false;
  if (hasAid(pc)) return false;
  try {
    await pc.createEmbeddedDocuments("Item", [aidItemData()]);
    await pc.setFlag(SUITE_ID, FLAGS.aidGranted, true);
    return true;
  } catch (error) {
    warn("pf2e-creaturedex | could not grant Discerning Aid", error);
    return false;
  }
}
