/**
 * Roleplay Chat — who a posted line is from, as this viewer may read it.
 *
 * The chat log, the bubbles and the caption lane all ask here, so a name hidden from players is hidden
 * the same way on all three. The rule is the stream roll cards' own (`speakerNameHidden` in
 * `stream-cards/text/read-text.js`): a GM speaking as a creature no player owns, whose name the table
 * cannot see. Under PF2e that is the system's `playersCanSeeName`; anywhere else it is the token's
 * Display Name. The art is never hidden: a face is what the players are looking at on the map anyway.
 */

import { rpModeOf } from "../../core/rp-mode.mjs";
import { playersSeeDisplayName, speakerNameHidden } from "../stream-cards/text/read-text.js";
import { nameFor } from "./model.mjs";

const loc = (key) => game.i18n.localize(key);

/** The token document a message's speaker names, on whichever scene it is. */
export function speakerTokenDoc(speaker) {
  if (!speaker?.token) return null;
  const scene = speaker.scene ? game.scenes?.get(speaker.scene) : null;
  return scene?.tokens?.get(speaker.token) ?? null;
}

/** Whether players may read this token's name. */
function playersCanSeeName(tokenDoc) {
  if (!tokenDoc) return undefined;
  if (game.system?.id === "pf2e") return tokenDoc.playersCanSeeName;
  return playersSeeDisplayName(tokenDoc.displayName) ?? undefined;
}

/**
 * @returns {{mode: string|null, name: string, img: string|null, narrator: boolean, unknown: boolean,
 *            hiddenFromPlayers: boolean, tokenDoc: object|null}}
 */
export function identityOf(message) {
  const mode = rpModeOf(message?.flags);
  const speaker = message?.speaker ?? {};
  if (mode === "narrator") {
    return { mode, name: speaker.alias || loc("GLRP.narrator"), img: null, narrator: true, unknown: false, hiddenFromPlayers: false, tokenDoc: null };
  }
  const tokenDoc = speakerTokenDoc(speaker);
  const actor = tokenDoc?.actor ?? ChatMessage.implementation.getSpeakerActor(speaker) ?? null;
  const base = speaker.alias || tokenDoc?.name || actor?.name || message?.author?.name || "";
  const hidden = speakerNameHidden({
    authorIsGM: Boolean(message?.author?.isGM),
    hasPlayerOwner: Boolean(actor?.hasPlayerOwner),
    nameVisibility: game.system?.id === "pf2e" ? Boolean(game.pf2e?.settings?.tokens?.nameVisibility) : true,
    playersCanSeeName: playersCanSeeName(tokenDoc)
  });
  const shown = nameFor({ name: base, hidden, viewerIsGM: Boolean(game.user?.isGM) });
  return {
    mode,
    name: shown.unknown ? loc("GLRP.unknown") : shown.name,
    img: actor?.img ?? tokenDoc?.texture?.src ?? null,
    narrator: false,
    unknown: shown.unknown,
    hiddenFromPlayers: shown.hiddenFromPlayers,
    tokenDoc
  };
}
