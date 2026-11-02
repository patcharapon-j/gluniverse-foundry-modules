import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady } from "./module.js";

Suite.register({
  id: "stream-pacer",
  title: "GLS.feature.stream-pacer.title",
  hint: "GLS.feature.stream-pacer.hint",
  icon: "fa-solid fa-gauge-high",
  settingPrefix: "sp.",
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    registerSettings();
  },

  onInit() {
    onInit();
  },

  onReady() {
    onReady();
  },

  // The standalone module's keys that still mean the same thing. Its pacing and
  // spotlight state, its WebGL toggle and its per-cue audio keys have no
  // counterpart in the remake (docs/STREAM_PACER.md, "What changed").
  legacy: {
    id: "stream-pacer",
    settings: {
      perilTextDire: "sp.perilTextDire",
      perilTextPeril: "sp.perilTextPeril",
      perilTextTag: "sp.perilTextTag",
      perilTextSubtitle: "sp.perilTextSubtitle",
      defaultCountdown: "sp.defaultCountdown",
      resetOnSceneChange: "sp.resetOnSceneChange",
      exemptUsers: "sp.exemptUsers",
      perilExemptUsers: "sp.perilExemptUsers",
      hudPosition: "sp.hudPosition",
    },
  },

  api: null,
});
