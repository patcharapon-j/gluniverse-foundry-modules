/**
 * GLUniverse Targeting Lines — suite adapter.
 *
 * During combat, an etched glass arc runs from the combatant whose turn it is
 * to every token it targets, landing an arrowhead on a turning reticle.
 *
 * A **sibling** of `stream`, not a child. The arcs draw on every client that
 * can see both tokens — a table with no capture login still wants them — so
 * this carries its own prefix, its own settings and its own editor rather than
 * nesting under the stream rig. When `stream` *is* enabled, the same editor is
 * contributed into its control panel so the arcs are configured beside the shot
 * they appear in, and the "visible to" choice gains its stream-only options.
 *
 * It imports pure modules from `stream/` (constants, the motion wrapper, the
 * token and combat helpers). That is a feature→feature import the contract
 * allows: those modules have no import-time side effects, so they resolve
 * whether or not `stream` is enabled, and nothing of `stream` *runs*.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { TARGETS_FEATURE_ID, TARGETS_PREFIX } from "../stream/constants.js";
import { registerPanelSection } from "../stream/extensions.mjs";
import { SETTINGS, registerSettings } from "./settings.js";
import { TargetingEditorMenu } from "./editor.js";
import { claimChange, renderSection } from "./panel.js";
import { TargetLineController } from "./targeting/target-lines.js";

let controller = null;

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

  registerSettings() {
    registerSettings();
    game.settings.registerMenu(SUITE_ID, `${TARGETS_PREFIX}editor`, {
      name: "GLUNIVERSE_STREAM.settings.targetingSettings.name",
      label: "GLUNIVERSE_STREAM.menu.targeting.label",
      hint: "GLUNIVERSE_STREAM.settings.targetingSettings.hint",
      icon: "fas fa-crosshairs",
      type: TargetingEditorMenu,
      restricted: true
    });
  },

  onInit() {},

  onReady() {
    controller = new TargetLineController();
    controller.registerHooks();

    // Contribute the editor into the stream control panel. The slot module is
    // imported directly rather than reached through the suite api, which is
    // only exposed *after* every onReady has run. It is a pure module, so the
    // import resolves whether or not `stream` is enabled — and if it is
    // disabled nothing ever renders the section, which is the intended no-op.
    // The dependency still points one way: `stream` never knows this exists.
    registerPanelSection({
      id: TARGETS_FEATURE_ID,
      order: 10,
      render: renderSection,
      change: claimChange,
      // This feature has no delegated write path, and `settings.js` says so:
      // `setTargetingSettings` returns the stored value for a non-GM rather
      // than throwing. Declaring it lets the panel disable the section for a
      // trusted director instead of showing them controls that discard edits.
      gmOnly: true
    });
  },

  /**
   * The targeting half of the standalone module's settings. No document sweep:
   * this feature stores nothing on a document.
   *
   * `showTargetLines` was client-scoped and stays so. The migration engine reads
   * the scope from the *new* registered setting and reaches into the right
   * store for it, so both arrive from where they actually lived.
   */
  legacy: {
    id: "gluniverse-stream",
    settings: {
      targetingSettings: SETTINGS.settings,
      showTargetLines: SETTINGS.showLines,
    },
  },

  api: { get controller() { return controller; }, SETTINGS },
});
