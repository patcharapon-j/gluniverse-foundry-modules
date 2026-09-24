/**
 * Hexcrawl — lifecycle. Every hook is registered here, from onInit/onReady,
 * never at import time, so a disabled feature is inert.
 *
 * The viewed scene decides everything: on canvasReady, if it carries
 * flags hex.enabled, a HexStore is built for it and the renderer, the paint
 * input and the tooltip attach; otherwise all three are torn down. Enabling or
 * disabling the scene while it is on the canvas does the same without a
 * redraw.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { coalescePan } from "../../core/pan.mjs";
import { motionScale } from "../../core/theme.mjs";
import { isHexType } from "./hex-math.mjs";
import { HexStore, HOOK_STORE_CHANGED, isHexcrawlScene } from "./store.mjs";
import { canvasAdapter, host } from "./host.mjs";
import { input } from "./input.mjs";
import { tooltip } from "./tooltip.mjs";
import { playSound } from "./sounds.mjs";
import { onPreUpdateToken, onUpdateTokenAll, onUpdateTokenGM, undoLastMove, revealAround } from "./movement.mjs";
import { onRenderTokenHUD } from "./hud.mjs";
import { onRenderChatMessage } from "./arrival.mjs";
import { onGetSceneControlButtons, onRenderSceneControls, registerKeybindings } from "./controls.mjs";
import { createHexcrawlScene, disableHexcrawl, enableHexcrawl, openSceneDialog } from "./scene-setup.mjs";

/* ── Scene attach / detach ──────────────────────────────────────────────── */

function onStoreChange(_store, detail) {
  if (detail.kind === "scene" && detail.diff && (detail.diff.revealed.length || detail.diff.masked.length)) {
    playSound("reveal");
  }
  if (detail.kind === "scene" || detail.kind === "view") tooltip.refresh();
}

let attachedStore = null;

function attachScene() {
  const scene = canvas?.ready ? canvas.scene : null;
  const on = !!scene && isHexcrawlScene(scene) && isHexType(canvas.grid?.type);
  const store = HexStore.rebuild(on ? scene : null, on ? canvasAdapter() : null);
  if (store === attachedStore && store) return;
  detachScene({ keepStore: true });
  attachedStore = store;
  if (!store) return;
  store.on("change", onStoreChange);
  host.attach(store).catch((e) => warn("hexcrawl | host attach failed", e));
  input.attach(store);
  tooltip.attach();
}

function detachScene({ keepStore = false } = {}) {
  attachedStore?.off("change", onStoreChange);
  attachedStore = null;
  tooltip.detach();
  input.detach();
  host.detach();
  if (!keepStore) HexStore.rebuild(null, null);
}

// `reset` re-runs getSceneControlButtons; a bare render() redraws the tool list it
// built last time, so the palette button would only appear after a scene reload.
const refreshControls = () => { try { ui.controls?.render({ reset: true }); } catch { /* not rendered yet */ } };

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

export function onInit() {
  registerKeybindings();
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderSceneControls", onRenderSceneControls);
  Hooks.on("preUpdateToken", onPreUpdateToken);
}

export function onReady() {
  Hooks.on("canvasReady", () => attachScene());
  Hooks.on("canvasTearDown", () => detachScene());
  Hooks.on(HOOK_STORE_CHANGED, () => refreshControls());

  // Enabling / disabling the viewed scene, or its grid changing, without a redraw.
  Hooks.on("updateScene", (scene, changes) => {
    if (scene !== canvas?.scene) return;
    const flat = foundry.utils.flattenObject(changes ?? {});
    if (Object.keys(flat).some((k) => k.startsWith(`flags.${SUITE_ID}.hex.enabled`) || /^flags\.[^.]+\.(-=|==)?hex$/.test(k))) attachScene();
  });

  Hooks.on("updateToken", (doc, changes, options, userId) => {
    try { onUpdateTokenAll(doc, changes, options, userId); } catch (e) { warn("hexcrawl | updateToken", e); }
    try { onUpdateTokenGM(doc, changes, options, userId); } catch (e) { warn("hexcrawl | updateToken (GM)", e); }
    if (doc.parent === canvas?.scene && attachedStore) { host.refreshParty(); }
  });
  const partyRefresh = (doc) => { if (doc?.parent === canvas?.scene && attachedStore) host.refreshParty(); };
  Hooks.on("createToken", partyRefresh);
  Hooks.on("deleteToken", partyRefresh);

  Hooks.on("canvasPan", coalescePan((_c, pos) => host.setZoom(pos?.scale ?? canvas.stage.scale.x)));
  Hooks.on("renderTokenHUD", onRenderTokenHUD);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);

  // Palette open-state fallback: re-check the paint capture when any app opens or closes.
  const resync = () => setTimeout(() => input.sync(), 0);
  Hooks.on("renderApplicationV2", resync);
  Hooks.on("closeApplicationV2", resync);

  if (canvas?.ready) attachScene();
}

export const api = {
  get store() { return HexStore.current; },
  HexStore,
  createHexcrawlScene,
  enableHexcrawl,
  disableHexcrawl,
  openSceneDialog,
  undoLastMove,
  revealAround,
  get motionScale() { return motionScale(); },
  get host() { return host; },
};
