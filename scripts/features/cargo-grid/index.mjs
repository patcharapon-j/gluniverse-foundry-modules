import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady } from "./gluniverse-cargo-grid.mjs";

Suite.register({
  id: "cargo-grid",
  title: "GLS.feature.cargo-grid.title",
  hint: "GLS.feature.cargo-grid.hint",
  icon: "fa-solid fa-boxes-stacked",
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
