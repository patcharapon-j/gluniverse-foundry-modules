/**
 * GLUniverse Stream — suite adapter.
 *
 * The stream client: a dedicated login that hides Foundry's UI, frames the
 * canvas camera, and renders chat and presentation overlays for an OBS or
 * browser capture. A control panel drives the live shot.
 *
 * Nothing runs at import time — the adapter only defines. Hooks and UI are
 * registered from `onInit`/`onReady`, so a disabled feature is inert.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID, warn } from "../../core/const.mjs";
import { FEATURE_ID, PREFIX } from "./constants.js";
import { onInit, onReady, registerSettings } from "./main.js";
import { registerCardFeed, registerPanelSection, unregisterPanelSection } from "./extensions.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.stream.title",
  hint: "GLS.feature.stream.hint",
  icon: "fa-solid fa-tower-broadcast",
  settingPrefix: PREFIX,
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() { registerSettings(); },
  onInit() { onInit(); },
  onReady() { return onReady(); },

  /**
   * Settings carried over from the standalone `gluniverse-stream` module.
   *
   * Three of its ten keys are absent because they moved to the other two
   * features, which carry their own `legacy` blocks for them. `defaultRollArt`
   * → `stream-cards`; `targetingSettings` and `showTargetLines` →
   * `stream-targets`. The engine only copies into a setting still at its
   * default, so it never clobbers a value the GM has already set here.
   *
   * The old flags are deliberately **left in place** rather than unset. The
   * standalone repo is being archived, but a GM who has not upgraded yet — or
   * who rolls a world back — still has a working module, and copy-only-when-
   * empty makes a re-run harmless either way.
   */
  legacy: {
    id: "gluniverse-stream",
    settings: {
      streamUserId: "stream.streamUserId",
      autoStartStreamUserIds: "stream.autoStartStreamUserIds",
      trustedDirectorUserIds: "stream.trustedDirectorUserIds",
      cameraSettings: "stream.cameraSettings",
      chatSettings: "stream.chatSettings",
      dialogSettings: "stream.dialogSettings",
      uiRules: "stream.uiRules",
    },

    /**
     * Tracked tokens are a per-scene flag, so they need a sweep rather than a
     * settings remap.
     *
     * World scenes only. A compendium scene is normally locked and is re-imported
     * rather than upgraded in place, and reaching into packs to rewrite flags is
     * a far larger promise than this migration should make.
     */
    migrate: async () => {
      const OLD = "gluniverse-stream";
      const NEW = SUITE_ID;
      for (const scene of game.scenes ?? []) {
        const ids = scene.flags?.[OLD]?.trackedTokenIds;
        if (ids === undefined) continue;
        try {
          if (scene.getFlag(NEW, "stream.trackedTokenIds") === undefined) {
            await scene.setFlag(NEW, "stream.trackedTokenIds", ids);
          }
        } catch (e) {
          warn(`Stream: tracked-token migration failed for scene ${scene.id}:`, e);
        }
      }
    },
  },

  /**
   * The slots `stream-cards` and `stream-targets` fill. Exposed on the feature
   * rather than imported by them so the dependency points one way only — this
   * feature never reaches for a child.
   */
  api: { registerCardFeed, registerPanelSection, unregisterPanelSection },
});
