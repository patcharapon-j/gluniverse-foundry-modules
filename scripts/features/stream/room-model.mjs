/**
 * The Control Room's pure half: what the on-air strip says, which tab icons the room draws, which camera
 * modes are offered outside combat. `director-app.js` reaches `foundry.applications` at module scope, so
 * everything the preview (`tools/stream-preview.mjs`) and the check need from it lives here instead.
 *
 * Pure: no Foundry, no DOM.
 */

import { CAMERA_MODES } from "./constants.js";

/** The modes a camera may take outside combat: the combat-only ones need a turn order to follow. */
export const OUT_OF_COMBAT_MODES = Object.freeze([CAMERA_MODES.manual, CAMERA_MODES.scene, CAMERA_MODES.trackedToken, CAMERA_MODES.party]);

export const TAB_ICONS = Object.freeze({
  shot: "fas fa-video",
  overlay: "fas fa-layer-group",
  screen: "fas fa-display",
  access: "fas fa-user-shield"
});

/** Every state the on-air strip can be in. Each has a `GLUNIVERSE_STREAM.room.state.*` label. */
export const ON_AIR_STATES = Object.freeze(["live", "exposed", "idle", "unknown", "offline", "unset"]);

/**
 * What the on-air lamp says. `live` is the only state that means the audience is watching the shot;
 * `exposed` is live with Foundry's own UI showing on the capture, which is the one a director must not
 * miss, so it has a state of its own rather than a footnote.
 *
 * @param {{ streamUserId: string, connected: boolean, status: {active?: boolean, restoreVisible?: boolean} | null }} input
 */
export function onAirState({ streamUserId, connected, status }) {
  if (!streamUserId) return "unset";
  if (!connected) return "offline";
  if (!status) return "unknown";
  if (status.active) return status.restoreVisible ? "exposed" : "live";
  return "idle";
}
