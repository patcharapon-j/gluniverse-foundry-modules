/**
 * Mythic GME: names and bounds shared by every module of the feature.
 *
 * Pure. The check tool and the preview import it under plain Node.
 *
 * Setting keys are stored data: a world that ran this feature has `mythic.chaos`,
 * `mythic.log`, `mythic.panelPos` and `mythic.autoEvent` in it, so they never
 * change. `mythic.lists`, `mythic.ui` and `mythic.actions1` arrived with the
 * remake.
 */

export const FEATURE_ID = "mythic-gme";

export const SETTINGS = Object.freeze({
  chaos: "mythic.chaos", //        world  · Number, 1..9
  log: "mythic.log", //            client · Array of log entries, newest first
  panelPos: "mythic.panelPos", //  client · { left, top }
  autoEvent: "mythic.autoEvent", // world · Boolean (Control Center)
  lists: "mythic.lists", //        client · { threads: [], characters: [] }
  ui: "mythic.ui", //              client · { tab, odds }
  actions1: "mythic.actions1", //  world  · RollTable UUID standing in for Actions Table 1
});

/** The Chaos Factor runs 1 to 9 and starts at 5 (Mythic GME 2e). */
export const CHAOS_MIN = 1;
export const CHAOS_MAX = 9;
export const CHAOS_DEFAULT = 5;

/** How many rolls the log keeps. */
export const LOG_MAX = 50;

/** How many rows a Thread or Character list holds, and the most an entry may weigh. */
export const LIST_MAX = 25;
export const WEIGHT_MAX = 3;

/** The panel's pages, in order. `ask` is the default. */
export const TABS = Object.freeze(["ask", "scene", "meaning", "lists"]);

/** The two lists Mythic keeps. */
export const LISTS = Object.freeze(["threads", "characters"]);

export const APP_ID = "gmyth-panel";
