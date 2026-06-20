import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady } from "./insight.mjs";

Suite.register({
  id: "insight",
  title: "GLS.feature.insight.title",
  hint: "GLS.feature.insight.hint",
  icon: "fa-solid fa-eye",
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
    id: "insight",
    settings: {
      theme: "insight.theme",
      soundEnabled: "insight.soundEnabled",
      soundVolume: "insight.soundVolume",
      soundFile: "insight.soundFile",
      animationSpeed: "insight.animationSpeed",
    },
  },

  api: null,
});
