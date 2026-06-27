import { Suite } from "../../core/registry.mjs";
import { featureRegisterSettings, onInit, onReady } from "./module.mjs";

Suite.register({
  id: "etched-chat",
  title: "GLS.feature.etched-chat.title",
  hint: "GLS.feature.etched-chat.hint",
  icon: "fa-solid fa-gem",
  settingPrefix: "ec.",
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    featureRegisterSettings();
  },

  onInit() {
    onInit();
  },

  async onReady() {
    await onReady();
  },

  api: null,
});
