/**
 * Roleplay Chat — identifiers. Pure: importable under plain Node.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { RP_PREFIX } from "../../core/rp-mode.mjs";

export const FEATURE_ID = "roleplay-chat";

/** Setting, flag and keybinding prefix. The flag contract itself lives in `core/rp-mode.mjs`. */
export const PREFIX = RP_PREFIX;

export const SETTINGS = Object.freeze({
  /** client · `{ ic: boolean|null, sub: "say"|"do"|"think" }`. `ic: null` = never chosen, use the default. */
  composer: `${PREFIX}composer`,
  /** client · a player's chosen speaker, an actor id. Empty = the assigned character. */
  speaker: `${PREFIX}speaker`,
  /** client · a GM's pinned speaker, `{ kind: "narrator" }` or `{ kind: "token", sceneId, tokenId }`. */
  gmPin: `${PREFIX}gmPin`,
  /** client · bubbles and captions on this screen. */
  overlays: `${PREFIX}overlays`,
  /** world · bubbles and captions on the stream login too (the stream card already shows the line). */
  streamBubbles: `${PREFIX}streamBubbles`
});

export const KEYBINDINGS = Object.freeze({
  toggle: `${PREFIX}toggleIc`,
  cycle: `${PREFIX}cycleMode`
});

/** Hooks this feature raises, built in one place so an emitter and a listener cannot drift. */
export const HOOKS = Object.freeze({
  /** The composer's mode or speaker changed on this client. */
  composerChanged: `${SUITE_ID}.rp.composerChanged`
});

/** Class prefix and the ids of the roots this feature injects. */
export const CSS = Object.freeze({
  prefix: "glrp-",
  bar: "glrp-bar",
  hint: "glrp-hint",
  layer: "glrp-layer",
  lane: "glrp-lane",
  bodyOn: "glrp-on"
});
