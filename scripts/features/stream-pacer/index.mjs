import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady } from "./module.js";

Suite.register({
  id: "stream-pacer",
  title: "GLS.feature.stream-pacer.title",
  hint: "GLS.feature.stream-pacer.hint",
  icon: "fa-solid fa-gauge-high",
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

  legacy: {
    id: "stream-pacer",
    settings: {
      perilWebGLEnabled: "sp.perilWebGLEnabled",
      perilTextDire: "sp.perilTextDire",
      perilTextPeril: "sp.perilTextPeril",
      perilTextTag: "sp.perilTextTag",
      perilTextSubtitle: "sp.perilTextSubtitle",
      pacerState: "sp.pacerState",
      spotlightState: "sp.spotlightState",
      defaultCountdown: "sp.defaultCountdown",
      resetOnSceneChange: "sp.resetOnSceneChange",
      exemptUsers: "sp.exemptUsers",
      perilExemptUsers: "sp.perilExemptUsers",
      hudPosition: "sp.hudPosition",
      handRaiseAudioEnabled: "sp.handRaiseAudioEnabled",
      handRaiseAudioVolume: "sp.handRaiseAudioVolume",
    },
  },

  api: null,
});
