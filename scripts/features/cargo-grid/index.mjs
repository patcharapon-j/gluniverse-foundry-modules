import { Suite } from "../../core/registry.mjs";
import { registerSettings } from "./settings.mjs";

let runtimePromise = null;
const loadRuntime = () => runtimePromise ??= import("./gluniverse-cargo-grid.mjs");

Suite.register({
  id: "cargo-grid",
  title: "GLS.feature.cargo-grid.title",
  hint: "GLS.feature.cargo-grid.hint",
  icon: "fa-solid fa-boxes-stacked",
  settingPrefix: "cargo.",
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    registerSettings();
  },

  async onInit() {
    (await loadRuntime()).onInit();
  },

  async onReady() {
    (await loadRuntime()).onReady();
  },

  legacy: {
    id: "gluniverse-cargo-grid",
    settings: {
      boardData: "cargo.boardData",
      playerVisible: "cargo.playerVisible",
      maxShapeSize: "cargo.maxShapeSize",
      cellSize: "cargo.cellSize",
      viewState: "cargo.viewState",
    },
  },

  api: null,
});
