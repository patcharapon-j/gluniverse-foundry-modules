import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady, api } from "./main.mjs";

Suite.register({
  id: "stage",
  title: "GLS.feature.stage.title",
  hint: "GLS.feature.stage.hint",
  icon: "fa-solid fa-theater-masks",
  settingPrefix: "stage.",
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
    return onReady();
  },

  // The old standalone module's keys. Only the cast and the comms are read
  // (store.mjs `migrateLegacy`); the rest describe a stage that no longer exists.
  legacy: {
    id: "gluniverse-stage",
    settings: {
      commsTheme: "stage.commsTheme",
      commsEdge: "stage.commsEdge",
      commsVAlign: "stage.commsVAlign",
      commsFrameWidth: "stage.commsFrameWidth",
      commsEdgeOffset: "stage.commsEdgeOffset",
      commsTopOffset: "stage.commsTopOffset",
      commsState: "stage.commsState",
      actorLibrary: "stage.actorLibrary",
    },
  },

  api,
});
