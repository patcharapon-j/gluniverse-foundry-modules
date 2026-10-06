/**
 * Combat Intro — the skin roster. The skin itself is the initiative feature's
 * world setting `init.skin`; this only maps its value to a module. Pure.
 */
import etched from "./etched.mjs";
import aegis from "./aegis.mjs";
import { DEFAULT_SKIN } from "../constants.mjs";

export const SKIN_MODULES = Object.freeze({ etched, aegis });

/** The module for a skin id; anything unknown falls back to the default skin. */
export function skinFor(id) {
  return SKIN_MODULES[id] ?? SKIN_MODULES[DEFAULT_SKIN] ?? etched;
}
