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
   * The slots `stream-cards` and `stream-targets` fill. Exposed on the feature
   * rather than imported by them so the dependency points one way only — this
   * feature never reaches for a child.
   */
  api: { registerCardFeed, registerPanelSection, unregisterPanelSection },
});
