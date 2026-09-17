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
import { FEATURE_ID, PREFIX } from "./constants.mjs";

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

  registerSettings() {},
  onInit() {},
  onReady() {},

  api: null,
});
