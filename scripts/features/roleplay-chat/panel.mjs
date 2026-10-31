/**
 * Roleplay Chat — its section of the stream Control Room.
 *
 * One switch: whether the stream login draws bubbles and captions too. Off by default, because a line
 * that reaches the stream already arrives as a card in the stream's chat overlay, and drawing it twice
 * says it twice. The setting is a world setting with no delegated write path, so the section declares
 * `gmOnly` and a trusted director sees it disabled rather than live controls that discard every edit.
 *
 * The setting is also reachable from the Control Center, so a table that runs Roleplay Chat without the
 * stream feature still has it — but there it is only a switch nobody needs.
 */

import { featurePath } from "../../core/const.mjs";
import { FEATURE_ID, SETTINGS } from "./constants.mjs";
import { setStreamBubbles, streamBubblesOn } from "./settings.mjs";

export async function renderSection() {
  return foundry.applications.handlebars.renderTemplate(featurePath(FEATURE_ID, "templates/section.hbs"), {
    name: SETTINGS.streamBubbles,
    streamBubbles: streamBubblesOn(),
    canEdit: Boolean(game.user?.isGM)
  });
}

export async function claimChange(name, value) {
  if (name !== SETTINGS.streamBubbles) return false;
  await setStreamBubbles(Boolean(value));
  return true;
}
