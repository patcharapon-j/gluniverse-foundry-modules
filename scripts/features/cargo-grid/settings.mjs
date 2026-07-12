import { SUITE_ID } from "../../core/const.mjs";

export const SETTINGS = Object.freeze({
  boardData: "cargo.boardData",
  playerVisible: "cargo.playerVisible",
  maxShapeSize: "cargo.maxShapeSize",
  cellSize: "cargo.cellSize",
  viewState: "cargo.viewState",
});

const defaultBoardData = () => ({
  schemaVersion: 1,
  activeMissionId: null,
  missions: {},
  templates: {},
  lastUndo: null,
  updatedAt: Date.now(),
});

const runtime = () => import("./gluniverse-cargo-grid.mjs");

export function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.boardData, {
    scope: "world", config: false, type: Object, default: defaultBoardData(),
  });
  game.settings.register(SUITE_ID, SETTINGS.playerVisible, {
    name: "GLUCARGO.Settings.PlayerVisible.Name",
    hint: "GLUCARGO.Settings.PlayerVisible.Hint",
    scope: "world", config: true, restricted: true, type: Boolean, default: false,
    onChange: async (visible) => (await runtime()).onPlayerVisibleChanged(visible),
  });
  game.settings.register(SUITE_ID, SETTINGS.maxShapeSize, {
    name: "GLUCARGO.Settings.MaxShapeSize.Name",
    hint: "GLUCARGO.Settings.MaxShapeSize.Hint",
    scope: "world", config: true, restricted: true, type: Number, default: 8,
    range: { min: 3, max: 12, step: 1 },
  });
  game.settings.register(SUITE_ID, SETTINGS.cellSize, {
    name: "GLUCARGO.Settings.CellSize.Name",
    hint: "GLUCARGO.Settings.CellSize.Hint",
    scope: "client", config: true, type: Number, default: 44,
    range: { min: 28, max: 56, step: 1 },
    onChange: async () => (await runtime()).refreshBoard(),
  });
  game.settings.register(SUITE_ID, SETTINGS.viewState, {
    scope: "client", config: false, type: Object,
    default: { left: 120, top: 90, width: 1180, height: 740, activeContainerId: null },
  });
}
