/**
 * Hexcrawl — scene controls and the undo keybinding (GM only; nothing for players).
 *
 * Tools live in the suite's own group (ensureSuiteGroup), gate-then-ensure.
 * A `button` tool fires onChange only when the active tool CHANGES, so the
 * clicks are also bound directly (bindSuiteToolClicks) — which means a click
 * can arrive through both roads. Opening a dialog twice is harmless; toggling
 * the palette twice is a no-op that looks like a dead button, so every action
 * here goes through a short de-duplication window.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { bindSuiteToolClicks, ensureSuiteGroup } from "../../core/scene-controls.mjs";
import { HexStore } from "./store.mjs";
import { isPaletteOpen } from "./input.mjs";

export const TOOL_PALETTE = "glhex-palette";
export const TOOL_SCENE = "glhex-scene";

/** A click arriving twice within this window (onChange + bound click) runs once. */
const DEDUPE_MS = 250;
const lastRun = new Map();
const once = (name, fn) => () => {
  const now = performance.now();
  if (now - (lastRun.get(name) ?? -Infinity) < DEDUPE_MS) return;
  lastRun.set(name, now);
  Promise.resolve().then(fn).catch((e) => warn(`hexcrawl | ${name} failed`, e));
};

const togglePalette = once(TOOL_PALETTE, async () => {
  const apps = await import("./apps/index.mjs");
  apps.togglePalette?.();
});
const openScene = once(TOOL_SCENE, async () => {
  const { openSceneDialog } = await import("./scene-setup.mjs");
  await openSceneDialog();
});

export function onGetSceneControlButtons(controls) {
  if (!game.user.isGM) return;
  const group = ensureSuiteGroup(controls);
  if (!group) return;
  if (HexStore.current) {
    group.tools[TOOL_PALETTE] = {
      name: TOOL_PALETTE,
      title: "GLHEX.controls.palette",
      icon: "fa-solid fa-palette",
      order: Object.keys(group.tools).length,
      button: true,
      visible: true,
      onChange: togglePalette,
    };
  }
  group.tools[TOOL_SCENE] = {
    name: TOOL_SCENE,
    title: "GLHEX.controls.scene",
    icon: "fa-solid fa-map-location-dot",
    order: Object.keys(group.tools).length,
    button: true,
    visible: true,
    onChange: openScene,
  };
}

export function onRenderSceneControls(_app, html) {
  if (!game.user.isGM) return;
  bindSuiteToolClicks(html, { [TOOL_PALETTE]: togglePalette, [TOOL_SCENE]: openScene });
}

/**
 * Ctrl+Z undoes the last hex edit — but only while the palette is open and
 * there is something to undo. Returning false otherwise hands the key on to
 * Foundry's own undo (a token move, a deleted drawing), which is what a GM
 * pressing Ctrl+Z without the palette open means.
 */
export function registerKeybindings() {
  game.keybindings.register(SUITE_ID, "hex.undo", {
    name: "GLHEX.controls.undo",
    hint: "GLHEX.controls.undoHint",
    editable: [{ key: "KeyZ", modifiers: ["Control"] }],
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE?.PRIORITY ?? 0,
    onDown: () => {
      const s = HexStore.current;
      if (!game.user.isGM || !s || !s.canUndo || !isPaletteOpen(s)) return false;
      s.undo().catch((e) => warn("hexcrawl | undo failed", e));
      return true;
    },
  });
}
