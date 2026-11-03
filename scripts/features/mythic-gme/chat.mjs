/**
 * Mythic GME: posting a roll to chat, which only ever happens on a click.
 *
 * Two audiences, and the GM picks one per card:
 *  - "whisper": to the GMs who see the truth. The stream login is a GM account
 *    the players watch, so it is left off; a whisper is the server's own
 *    filter (`whisper` recipients), so the card never reaches a player's
 *    client at all.
 *  - "table": a public message, for a GM-less table or an answer the GM wants
 *    everyone to hear.
 *
 * No socket: chat is Foundry's own document channel.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { isConfiguredStreamUser } from "../stream/settings.js";
import { FEATURE_ID } from "./constants.mjs";
import { entryView } from "./model.mjs";
import { chatHTML } from "./render.mjs";

const t = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

function isStreamLogin(user) {
  try {
    return isConfiguredStreamUser(user);
  } catch {
    return false;
  }
}

/** The ids a GM whisper goes to: every GM but the stream login, and always the poster. */
export function whisperRecipients() {
  const ids = new Set(game.users.filter((u) => u.isGM && !isStreamLogin(u)).map((u) => u.id));
  ids.add(game.user.id);
  return [...ids];
}

export async function postEntry(entry, audience = "whisper") {
  if (!entry || !game.user.isGM) return null;
  const view = entryView(entry);
  const data = {
    content: chatHTML(view, t, { audience }),
    speaker: { alias: t("GLMYTHIC.chat.alias") },
    flags: { [SUITE_ID]: { [FEATURE_ID]: { kind: entry.kind, audience } } },
  };
  if (audience !== "table") data.whisper = whisperRecipients();
  return ChatMessage.create(data);
}
