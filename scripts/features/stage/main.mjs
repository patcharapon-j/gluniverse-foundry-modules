/**
 * Stage — wiring. Everything here runs inside the registry's lifecycle, never
 * at import, so a disabled Stage is inert.
 */

import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { warn } from "../../core/const.mjs";
import { registerQuickProvider } from "../../core/quick-palette.mjs";
import { QUICK_PROVIDERS } from "./search.mjs";
import { registerSettings as registerStageSettings } from "./settings.mjs";
import { wireChannel, sendReaction } from "./channel.mjs";
import { StageOverlay } from "./overlay.mjs";
import { lightUpdateData, migrateLegacy, readLight, tweenUpdateOptions, writeLight } from "./store.mjs";
import { normalizeLight } from "./light/rig.mjs";
import { TWEEN_OPTION } from "./timing.mjs";

const TOOL = "glstage-director";
let overlay = null;

export function registerSettings() {
  registerStageSettings();
}

async function openDirector() {
  try {
    const { openDirector: open } = await import("./apps/director-app.mjs");
    return open();
  } catch (e) {
    warn("stage | the director panel could not be opened", e);
    return null;
  }
}

export function onInit() {
  for (const p of QUICK_PROVIDERS) registerQuickProvider(p);
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM) return;
    ensureSuiteGroup(controls).tools[TOOL] = {
      name: TOOL,
      title: "GLSTAGE.controls.director",
      icon: "fa-solid fa-masks-theater",
      button: true,
      onChange: () => openDirector(),
    };
  });
  // A `button` tool resolves through onChange, which fires only when the
  // active tool changes; the click binding opens it on every press.
  Hooks.on("renderSceneControls", (_app, html) => {
    if (game.user?.isGM) bindSuiteToolClicks(html, { [TOOL]: () => openDirector() });
  });
}

export async function onReady() {
  wireChannel();
  await migrateLegacy();
  overlay = new StageOverlay();
  try { overlay.start(); } catch (e) { warn("stage | the stage overlay could not start", e); }
}

/**
 * The public api. Theatre reaches Stage only through this (see
 * theatre/stage-bridge.mjs), so the grade names it speaks are kept: a "grade"
 * is now a scene light.
 */
export const api = {
  TWEEN_OPTION,
  open: () => openDirector(),
  react: (id, kind) => sendReaction(id, kind),
  readLight,
  writeLight,
  lightUpdateData,
  tweenUpdateOptions,
  gradeUpdateData: (grade) => lightUpdateData(grade),
  gradeFromSrc: async (src) => (src ? normalizeLight({ src }) : null),
  readSceneGrade: (scene) => readLight(scene),
  setSceneGrade: (scene, grade, timing = null) => writeLight(scene, grade, timing),
  get overlay() { return overlay; },
};
