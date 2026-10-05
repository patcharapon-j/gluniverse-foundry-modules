/**
 * Theatre — making a scene a Theatre scene, and giving it back.
 *
 *   createTheatreScene({ name })  a new Scene laid out on FRAME, flagged th.enabled
 *   convertScene(scene)           switch an existing scene on; what it replaces is kept in th.restore
 *   leaveScene(scene)             switch it off and put th.restore back (shots and config are KEPT,
 *                                 so converting again restores the reel)
 *
 * Reached from a "Create Theatre scene" button in the Scenes directory header
 * and Convert / Leave entries in a scene's context menu (v13's
 * get<Doc>DirectoryEntryContext and v14's get<Doc>ContextOptions both).
 *
 * The layout a Theatre scene needs: FRAME-sized, padding 0 (Theatre's layer
 * covers the scene rect; padding would show the canvas around it), gridless,
 * no token vision or fog (vision would black out the shot), and a black
 * background colour behind the shots. Convert also clears the background
 * image, because the shots replace it; Leave restores it. Between the two,
 * Theatre never touches scene.background.
 *
 * v14 moved the background onto the scene's Levels and drops the legacy fields
 * without a word, so every read and write of the background goes through
 * `bgRead` / `bgWrite`, which use the first Level where there is one.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { PALETTE } from "../../core/theme.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { DEFAULT_STYLE, FRAME, SETTINGS, STYLES } from "./constants.mjs";
import { normalizeConfig, normalizeShots, normalizeState, titleFromFilename } from "./model.mjs";
import { forceDelete, forceSet, isTheatreScene, PATHS, readShots } from "./store.mjs";
import { gradeFragment, initialGrade, sampleGrade, stageEnabled } from "./stage-bridge.mjs";

const L = (k) => game.i18n.localize(k);
const F = (k, d) => game.i18n.format(k, d);

/** The colour behind every shot: the darkest ink of the palette. */
const BLACK = PALETTE.ink0;

const gridless = () => globalThis.CONST?.GRID_TYPES?.GRIDLESS ?? 0;
const fogOff = () => (globalThis.CONST?.FOG_EXPLORATION_MODES
  ? { mode: CONST.FOG_EXPLORATION_MODES.DISABLED }
  : { exploration: false });

function setting(key, list, fallback) {
  try {
    const v = game.settings.get(SUITE_ID, key);
    return list.includes(v) ? v : fallback;
  } catch { return fallback; }
}

/**
 * The starting config of a new / newly converted Theatre scene. Its face is left
 * empty, so it follows the GM's default typeface for as long as nobody picks one.
 */
export function initialConfig() {
  return normalizeConfig({ style: setting(SETTINGS.defaultStyle, STYLES, DEFAULT_STYLE), face: null });
}

/* ── Background (v13 fields / v14 Level) ────────────────────────────────── */

const levelOf = (scene) => scene?.levels?.contents?.[0] ?? null;

function bgRead(scene) {
  const level = levelOf(scene);
  return {
    src: level?.background?.src ?? scene?.background?.src ?? "",
    color: level?.background?.color ?? scene?.backgroundColor ?? null,
  };
}

/** Write the background src/colour where this generation keeps it. */
async function bgWrite(scene, { src, color }) {
  const level = levelOf(scene);
  if (level) {
    const upd = {};
    if (src !== undefined) upd["background.src"] = src || null;
    if (color !== undefined && color !== null) upd["background.color"] = color;
    if (Object.keys(upd).length) await level.update(upd);
    return;
  }
  const upd = {};
  if (src !== undefined) upd["background.src"] = src || null;
  if (color !== undefined && color !== null) upd.backgroundColor = color;
  if (Object.keys(upd).length) await scene.update(upd);
}

/* ── Create / convert / leave ───────────────────────────────────────────── */

/** Create a new Theatre scene. Returns the Scene (or null when refused). */
export async function createTheatreScene({ name = null, view = true, openEditor = true } = {}) {
  if (!game.user.isGM) return null;
  const scene = await Scene.create({
    name: name || L("GLTH.scene.defaultName"),
    width: FRAME.width,
    height: FRAME.height,
    padding: 0,
    grid: { type: gridless() },
    backgroundColor: BLACK,
    tokenVision: false,
    fog: fogOff(),
    flags: { [SUITE_ID]: { th: { enabled: true, shots: [], config: initialConfig(), state: normalizeState(null), restore: null } } },
  });
  if (!scene) return null;
  if (levelOf(scene)) await bgWrite(scene, { color: BLACK });
  await seedStageGrade(scene, []);
  if (view) await scene.view();
  if (openEditor) openEditorLater();
  return scene;
}

/**
 * Switch an existing scene into Theatre. Its background image, if any, becomes
 * the first shot when the scene has none yet, so a GM converting a scene loses
 * nothing to look at.
 */
export async function convertScene(scene) {
  if (!game.user.isGM || !scene || isTheatreScene(scene)) return false;
  const bg = bgRead(scene);
  const restore = {
    background: bg.src || "",
    width: scene.width,
    height: scene.height,
    padding: scene.padding,
    gridType: scene.grid?.type ?? gridless(),
    tokenVision: scene.tokenVision,
    backgroundColor: bg.color,
  };

  let shots = readShots(scene);
  if (!shots.length && bg.src) {
    const grade = stageEnabled() ? await sampleGrade(bg.src) : null;
    shots = normalizeShots([{ src: bg.src, title: scene.navName || scene.name || titleFromFilename(bg.src), grade }]);
  }
  const hadConfig = !!scene.getFlag(SUITE_ID, "th.config");

  const upd = {
    width: FRAME.width,
    height: FRAME.height,
    padding: 0,
    "grid.type": gridless(),
    tokenVision: false,
    [PATHS.enabled]: true,
  };
  forceSet(upd, PATHS.restore, restore);
  forceSet(upd, PATHS.shots, shots);
  if (!hadConfig) forceSet(upd, PATHS.config, initialConfig());
  forceSet(upd, PATHS.state, normalizeState(null));
  // Stage seeds an ungraded scene from its background the first time it shows
  // an actor; a Theatre background is flat black, so give the scene a grade now.
  const frag = gradeFragment(initialGrade(scene, shots));
  if (frag) Object.assign(upd, frag);
  // The background is cleared BEFORE the scene turns Theatre on, so Theatre
  // never touches it while it is on (Leave restores it after switching off).
  await bgWrite(scene, { src: "", color: BLACK });
  await scene.update(upd);
  return true;
}

/** Switch a Theatre scene off and restore what Convert replaced. */
export async function leaveScene(scene) {
  if (!game.user.isGM || !scene || !isTheatreScene(scene)) return false;
  const restore = scene.getFlag(SUITE_ID, "th.restore");
  const upd = { [PATHS.enabled]: false };
  forceDelete(upd, PATHS.restore);
  if (restore && typeof restore === "object") {
    if (Number.isFinite(restore.width)) upd.width = restore.width;
    if (Number.isFinite(restore.height)) upd.height = restore.height;
    if (restore.padding !== undefined) upd.padding = restore.padding;
    if (restore.gridType !== undefined) upd["grid.type"] = restore.gridType;
    if (typeof restore.tokenVision === "boolean") upd.tokenVision = restore.tokenVision;
  }
  await scene.update(upd);
  if (restore && typeof restore === "object") {
    await bgWrite(scene, { src: restore.background || "", color: restore.backgroundColor ?? undefined });
  }
  return true;
}

/** Write a starting Stage grade onto a freshly created scene (Stage on only). */
async function seedStageGrade(scene, shots) {
  const frag = gradeFragment(initialGrade(scene, shots));
  if (!frag) return;
  try { await scene.update(frag); } catch (e) { warn("theatre | could not seed the Stage grade", e); }
}

function openEditorLater() {
  import("./apps/editor.mjs")
    .then((m) => m.openEditor?.())
    .catch((e) => warn("theatre | editor unavailable", e));
}

/* ── Confirmations ──────────────────────────────────────────────────────── */

async function confirm(titleKey, bodyKey, scene) {
  const { DialogV2 } = foundry.applications.api;
  try {
    return await DialogV2.confirm({
      window: { title: L(titleKey), icon: "fa-solid fa-clapperboard" },
      content: `<p class="gl-type">${escapeHTML(F(bodyKey, { name: scene.name }))}</p>`,
      rejectClose: false,
    });
  } catch { return false; }
}

export async function confirmConvert(scene) {
  if (!scene || !(await confirm("GLTH.scene.convertTitle", "GLTH.scene.convertBody", scene))) return;
  try {
    if (await convertScene(scene)) ui.notifications.info(F("GLTH.notify.converted", { name: scene.name }));
  } catch (e) {
    warn("theatre | convert failed", e);
    ui.notifications.error(L("GLTH.notify.sceneFailed"));
  }
}

export async function confirmLeave(scene) {
  if (!scene || !(await confirm("GLTH.scene.leaveTitle", "GLTH.scene.leaveBody", scene))) return;
  try {
    if (await leaveScene(scene)) ui.notifications.info(F("GLTH.notify.left", { name: scene.name }));
  } catch (e) {
    warn("theatre | leave failed", e);
    ui.notifications.error(L("GLTH.notify.sceneFailed"));
  }
}

/** Ask for a name, then create. */
export async function promptCreate() {
  if (!game.user.isGM) return null;
  const { DialogV2 } = foundry.applications.api;
  let name = null;
  try {
    name = await DialogV2.prompt({
      window: { title: L("GLTH.scene.createTitle"), icon: "fa-solid fa-clapperboard" },
      content: `<div class="gl-type"><label>${escapeHTML(L("GLTH.scene.name"))}
        <input type="text" name="name" value="${escapeHTML(L("GLTH.scene.defaultName"))}" autofocus></label></div>`,
      ok: {
        label: L("GLTH.scene.create"),
        icon: "fa-solid fa-clapperboard",
        callback: (_ev, button) => button.form.elements.name.value,
      },
      rejectClose: false,
    });
  } catch { return null; }
  if (name === null || name === undefined) return null;
  try {
    return await createTheatreScene({ name: String(name).trim() || null });
  } catch (e) {
    warn("theatre | create failed", e);
    ui.notifications.error(L("GLTH.notify.sceneFailed"));
    return null;
  }
}

/* ── Directory wiring (called from onInit) ──────────────────────────────── */

const ENTRY_CONVERT = "GLTH.scene.convert";
const ENTRY_LEAVE = "GLTH.scene.leave";

const sceneFromTarget = (target) => {
  const li = target instanceof HTMLElement ? target : target?.[0];
  return game.scenes?.get(li?.dataset?.entryId ?? li?.dataset?.documentId ?? li?.dataset?.sceneId) ?? null;
};

/**
 * A FRESH entry object per menu (ContextMenu writes `element` onto the entry it
 * renders and resolves the click by matching it back; one shared object in two
 * menus makes the loser's click do nothing).
 */
function addContextEntries(options) {
  if (!Array.isArray(options) || options.some((o) => o?.name === ENTRY_CONVERT)) return;
  options.push({
    name: ENTRY_CONVERT,
    icon: '<i class="fa-solid fa-clapperboard"></i>',
    condition: (t) => game.user.isGM && !!sceneFromTarget(t) && !isTheatreScene(sceneFromTarget(t)),
    callback: (t) => confirmConvert(sceneFromTarget(t)),
  }, {
    name: ENTRY_LEAVE,
    icon: '<i class="fa-solid fa-door-open"></i>',
    condition: (t) => game.user.isGM && isTheatreScene(sceneFromTarget(t)),
    callback: (t) => confirmLeave(sceneFromTarget(t)),
  });
}

function onRenderSceneDirectory(_app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? null);
  if (!root || root.querySelector("[data-glth-create]")) return;
  const header = root.querySelector(".directory-header") ?? root.querySelector("header");
  if (!header) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.glthCreate = "";
  button.classList.add("glth-create-scene");
  button.innerHTML = `<i class="fa-solid fa-clapperboard"></i> ${escapeHTML(L("GLTH.scene.createButton"))}`;
  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    promptCreate();
  });
  const actions = header.querySelector(".header-actions, .action-buttons");
  if (actions) actions.append(button);
  else header.append(button);
}

export function registerSceneSetup() {
  Hooks.on("getSceneDirectoryEntryContext", (_html, options) => addContextEntries(options));
  Hooks.on("getSceneContextOptions", (_app, options) => addContextEntries(options));
  Hooks.on("renderSceneDirectory", onRenderSceneDirectory);
}
