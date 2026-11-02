/**
 * Creaturedexing — what happens after the GM hands something over.
 *
 * Two things, and they run the same way for a truth and for a lie, because a
 * lie that behaved differently afterwards would be a lie the player can see:
 *
 * - **The notice.** One chat card saying who learned which section of what.
 *   In-band on purpose: the table seeing that the party now knows a thing is
 *   half of why anybody rolls. Whispered to the owners told and the GMs unless
 *   the whole table shares the knowledge (`noticeModel`).
 * - **Discerning Aid.** Granted (when the table switched that on) to every
 *   character told whose entry now reads as complete. "Reads as" is the
 *   player's completion, lies included: a reaction that arrived only on true
 *   completions would tell its owner which of their entries hold a lie.
 *
 * Runs on the GM's client only, at call time. Nothing here is a hook.
 */

import { warn } from "../../core/const.mjs";
import { grantAid } from "./aid.mjs";
import { falseIn, knownIn, metaIn } from "./ledger.mjs";
import { noticeModel } from "./model.mjs";
import { noticeHTML } from "./render.mjs";
import { isComplete } from "./rules.mjs";
import { partyMode, readAll } from "./store.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Does this character's entry read as complete, lies included? */
function readsComplete(data, subject, ownerId, party) {
  const available = metaIn(data, subject)?.available ?? [];
  const held = [...knownIn(data, subject, ownerId, party), ...falseIn(data, subject, ownerId, party).map((l) => l.section)];
  return isComplete(held, available);
}

/**
 * @param {object} o
 * @param {string} o.subject    the dex key
 * @param {string} o.section    the section handed over
 * @param {Actor[]} o.owners    the characters told
 * @param {boolean} o.everyone  the GM revealed to the whole party
 */
export async function afterHandover({ subject, section, owners = [], everyone = false }) {
  if (!game.user?.isGM || !owners.length) return;
  const data = readAll();
  const party = partyMode();
  const done = owners.filter((pc) => readsComplete(data, subject, pc.id, party));

  for (const pc of done) await grantAid(pc);

  try {
    const users = (game.users?.contents ?? [...(game.users ?? [])]).map((u) => ({
      id: u.id,
      isGM: !!u.isGM,
      owns: owners.filter((pc) => pc.testUserPermission?.(u, "OWNER")).map((pc) => pc.id),
    }));
    const notice = noticeModel({
      section,
      subjectName: metaIn(data, subject)?.name ?? "",
      owners: owners.map((pc) => ({ id: pc.id, name: pc.name })),
      everyone,
      party,
      complete: done.length === owners.length,
      users,
    });
    await ChatMessage.create({
      content: noticeHTML(notice, { t }),
      ...(notice.whisper ? { whisper: notice.whisper } : {}),
    });
  } catch (error) {
    // A notification is not worth losing the reveal that earned it.
    warn("pf2e-creaturedex | could not post the reveal notice", error);
  }
}
