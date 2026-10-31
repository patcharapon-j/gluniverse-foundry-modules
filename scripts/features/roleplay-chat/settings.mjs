/**
 * Roleplay Chat — settings and keybindings.
 *
 * Everything but one switch is per client: what mode somebody is typing in and who they are speaking as
 * are theirs, not the world's. `rp.streamBubbles` is the world's, because it decides what the stream
 * login draws and the stream login is not somebody who can be asked.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { DEFAULT_COMPOSER, sanitizeComposer, sanitizePin } from "./model.mjs";
import { KEYBINDINGS, SETTINGS } from "./constants.mjs";

export function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.composer, {
    scope: "client",
    config: false,
    type: Object,
    default: { ...DEFAULT_COMPOSER }
  });
  game.settings.register(SUITE_ID, SETTINGS.speaker, {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register(SUITE_ID, SETTINGS.gmPin, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.register(SUITE_ID, SETTINGS.overlays, {
    name: "GLRP.settings.overlays.name",
    hint: "GLRP.settings.overlays.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(SUITE_ID, SETTINGS.streamBubbles, {
    name: "GLRP.settings.streamBubbles.name",
    hint: "GLRP.settings.streamBubbles.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}

/**
 * Rebindable from Foundry's Configure Controls. Foundry runs no keybinding while a text box has focus —
 * which the chat box always has while somebody is typing in it — so these handlers only cover the
 * moment the box is *not* focused, and `composer.mjs` matches the same configured bindings on the
 * box's own keydowns. Either way the binding the user set is the one that works.
 */
export function registerKeybindings({ onToggle, onCycle }) {
  game.keybindings.register(SUITE_ID, KEYBINDINGS.toggle, {
    name: "GLRP.keys.toggle.name",
    hint: "GLRP.keys.toggle.hint",
    editable: [{ key: "KeyQ", modifiers: ["Alt"] }],
    onDown: () => { onToggle(); return true; },
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
  game.keybindings.register(SUITE_ID, KEYBINDINGS.cycle, {
    name: "GLRP.keys.cycle.name",
    hint: "GLRP.keys.cycle.hint",
    editable: [{ key: "KeyW", modifiers: ["Alt"] }],
    onDown: () => { onCycle(); return true; },
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}

/** The bindings currently configured for an action, user edits included. */
export function bindingsFor(action) {
  try {
    return game.keybindings.get(SUITE_ID, action) ?? [];
  } catch {
    return [];
  }
}

const read = (key) => {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return undefined;
  }
};

export const getComposer = () => sanitizeComposer(read(SETTINGS.composer));
export const setComposer = (value) => game.settings.set(SUITE_ID, SETTINGS.composer, sanitizeComposer(value));
export const getSpeakerChoice = () => String(read(SETTINGS.speaker) ?? "");
export const setSpeakerChoice = (id) => game.settings.set(SUITE_ID, SETTINGS.speaker, String(id ?? ""));
export const getGmPin = () => sanitizePin(read(SETTINGS.gmPin));
export const setGmPin = (pin) => game.settings.set(SUITE_ID, SETTINGS.gmPin, sanitizePin(pin) ?? {});
export const overlaysOn = () => read(SETTINGS.overlays) !== false;
export const streamBubblesOn = () => read(SETTINGS.streamBubbles) === true;

/** The world switch, written by a GM only. Anybody else gets the stored value back. */
export async function setStreamBubbles(on) {
  if (!game.user?.isGM) return streamBubblesOn();
  await game.settings.set(SUITE_ID, SETTINGS.streamBubbles, Boolean(on));
  return streamBubblesOn();
}
