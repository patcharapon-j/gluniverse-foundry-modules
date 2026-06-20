import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady, api } from "./module.js";

Suite.register({
  id: "stream",
  title: "GLS.feature.stream.title",
  hint: "GLS.feature.stream.hint",
  icon: "fa-solid fa-video",
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
  },

  api,
});
