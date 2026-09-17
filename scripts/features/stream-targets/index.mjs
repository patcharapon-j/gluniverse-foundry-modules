/**
 * GLUniverse Targeting Lines — suite adapter.
 *
 * During combat, an etched glass arc runs from the combatant whose turn it is
 * to every token it targets, landing an arrowhead on a turning reticle.
 *
 * A **sibling** of `stream`, not a child. The arcs draw on every client that
 * can see both tokens — a table with no capture login still wants them — so
 * this carries its own prefix and its own settings editor rather than nesting
 * under the stream rig. When `stream` *is* enabled its control panel shows the
 * same editor inline, and the "visible to" choice gains its stream-only
 * options; with `stream` off those options are absent rather than inert.
 */

import { Suite } from "../../core/registry.mjs";
import { TARGETS_FEATURE_ID, TARGETS_PREFIX } from "../stream/constants.mjs";

Suite.register({
  id: TARGETS_FEATURE_ID,
  title: "GLS.feature.stream-targets.title",
  hint: "GLS.feature.stream-targets.hint",
  icon: "fa-solid fa-crosshairs",
  settingPrefix: TARGETS_PREFIX,
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {},
  onInit() {},
  onReady() {},

  api: null,
});
