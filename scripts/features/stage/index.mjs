import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady, api } from "./module.js";

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
    onReady();
  },

  legacy: {
    id: "gluniverse-stage",
    settings: {
      stageHeight: "stage.stageHeight",
      stageWidth: "stage.stageWidth",
      stageXOffset: "stage.stageXOffset",
      stageYOffset: "stage.stageYOffset",
      commsTheme: "stage.commsTheme",
      commsEdge: "stage.commsEdge",
      commsVAlign: "stage.commsVAlign",
      commsFrameWidth: "stage.commsFrameWidth",
      commsEdgeOffset: "stage.commsEdgeOffset",
      commsTopOffset: "stage.commsTopOffset",
      commsState: "stage.commsState",
      actorLibrary: "stage.actorLibrary",
      stageState: "stage.stageState",
    },
  },

  api,
});
