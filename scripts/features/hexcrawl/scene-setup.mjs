/**
 * Hexcrawl — making a scene a hexcrawl.
 *
 *   createHexcrawlScene(opts)   a new Scene sized to exactly cols × rows hexes
 *   enableHexcrawl(scene, map)  switch an existing HEX-grid scene on
 *   disableHexcrawl(scene)      switch it off (the map flag is KEPT, so turning
 *                               it back on restores the map)
 *   openSceneDialog()           the scene-control dialog offering all of the above
 *
 * A new scene is created with Foundry's token vision and fog exploration off:
 * the hexcrawl's own fog is the map's hex states, and Foundry's vision would
 * black out everything beyond each token's light. Nothing here re-asserts that
 * later — a GM who turns vision back on for a scene has made a choice.
 *
 * Padding is 0 on purpose: with padding Foundry offsets the scene rectangle by
 * whole hex strides, so the scene's first hex stops being offset "0,0" and an
 * imported map (keys counted from the top-left hex) lands shifted.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { PALETTE } from "../../core/theme.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FLAGS } from "./constants.mjs";
import { HEX_TYPES, hexSceneDims, isHexType } from "./hex-math.mjs";
import { emptyMap, normalizeMap } from "./model.mjs";
import { L, F } from "./labels.mjs";
import { forceSet, isHexcrawlScene } from "./store.mjs";

const SQRT3 = Math.sqrt(3);

/**
 * Scene pixel dimensions that hold exactly cols × rows hexes (by centre, which
 * is how the host decides a hex is in bounds). One pixel is shaved off the
 * axis where the next row's centres would land exactly on the edge.
 */
export function hexSceneDimensions({ gridType = HEX_TYPES.HEXODDQ, size = 100, cols = 20, rows = 14, pad = 0 } = {}) {
  // One statement of the sizing rule: hex-math owns it, beside the origin it implies.
  return hexSceneDims({ type: gridType, size, cols, rows, pad });
}

const fogOff = () => (globalThis.CONST?.FOG_EXPLORATION_MODES
  ? { mode: CONST.FOG_EXPLORATION_MODES.DISABLED }
  : { exploration: false });

/** Create (and view) a new hexcrawl scene. Returns the Scene. */
export async function createHexcrawlScene({
  name, gridType = CONST.GRID_TYPES?.HEXODDQ ?? HEX_TYPES.HEXODDQ, size = 100, cols = 20, rows = 14,
  background = null, map = null, pad = 0,
} = {}) {
  if (!game.user.isGM) return null;
  if (!isHexType(gridType)) gridType = HEX_TYPES.HEXODDQ;
  size = Math.max(50, Math.min(400, Math.round(Number(size) || 100)));
  cols = Math.max(1, Math.min(200, Math.round(Number(cols) || 20)));
  rows = Math.max(1, Math.min(200, Math.round(Number(rows) || 14)));
  const dims = hexSceneDimensions({ gridType, size, cols, rows, pad });
  // A scene created with padding holds a frame of hexes the map does not: the
  // map's extent says so, and the renderer draws that frame as border. Without
  // this the frame is ordinary uncharted ground the party can walk into, which
  // is exactly what it was put there to stop.
  const placed = normalizeMap(map ?? emptyMap());
  if (!placed.bounds) placed.bounds = { i: dims.origin.i, j: dims.origin.j, rows, cols };
  const data = {
    name: name || L("GLHEX.scene.defaultName"),
    width: dims.width,
    height: dims.height,
    padding: 0,
    // The map draws its own hex edges; Foundry's grid lines over it would cut every
    // fused region back into single hexes. A GM can turn them back on in Scene Config.
    grid: { type: gridType, size, alpha: 0 },
    backgroundColor: PALETTE.ink1,
    tokenVision: false,
    fog: fogOff(),
    flags: { [SUITE_ID]: { hex: { enabled: true, map: placed } } },
  };
  if (background) data.background = { src: background };
  const scene = await Scene.create(data);
  // v14 moved the background onto the scene's Levels and drops the legacy
  // fields without a word: the scene comes out Foundry grey, which shows in
  // every channel between regions. Restate them on the initial Level.
  const level = scene?.levels?.contents?.[0] ?? null;
  if (level) {
    const upd = { "background.color": PALETTE.ink1 };
    if (background && !level.background?.src) upd["background.src"] = background;
    await level.update(upd);
  }
  if (scene) await scene.view();
  return scene;
}

/** Switch an existing hex-grid scene into hexcrawl mode (replacing the map when given). */
export async function enableHexcrawl(scene, map = null) {
  if (!game.user.isGM || !scene) return false;
  if (!isHexType(scene.grid?.type)) {
    ui.notifications.warn(L("GLHEX.notify.notHexGrid"));
    return false;
  }
  const next = map ? normalizeMap(map) : normalizeMap(scene.getFlag(SUITE_ID, FLAGS.map));
  const upd = { [`flags.${SUITE_ID}.hex.enabled`]: true };
  forceSet(upd, `flags.${SUITE_ID}.hex.map`, next);
  await scene.update(upd);
  return true;
}

/** Switch it off. The map stays on the scene. */
export async function disableHexcrawl(scene) {
  if (!game.user.isGM || !scene) return false;
  await scene.setFlag(SUITE_ID, FLAGS.enabled, false);
  return true;
}

/* ── The dialog ─────────────────────────────────────────────────────────── */

export async function openSceneDialog() {
  if (!game.user.isGM) return;
  const { DialogV2 } = foundry.applications.api;
  const scene = canvas?.scene ?? null;
  const on = isHexcrawlScene(scene);
  const hexGrid = isHexType(scene?.grid?.type);

  const status = !scene ? L("GLHEX.scene.noScene")
    : on ? F("GLHEX.scene.isOn", { name: scene.name })
      : hexGrid ? F("GLHEX.scene.canEnable", { name: scene.name })
        : F("GLHEX.scene.notHex", { name: scene.name });

  const content = `<div class="glhex-scene-dialog gl-type">
    <p class="glhex-scene-status">${escapeHTML(status)}</p>
    <fieldset class="glhex-scene-new">
      <legend class="gl-tech-label">${escapeHTML(L("GLHEX.scene.newLegend"))}</legend>
      <label>${escapeHTML(L("GLHEX.scene.name"))}<input type="text" name="name" value="${escapeHTML(L("GLHEX.scene.defaultName"))}"></label>
      <div class="glhex-scene-row">
        <label>${escapeHTML(L("GLHEX.scene.cols"))}<input type="number" name="cols" value="20" min="1" max="200"></label>
        <label>${escapeHTML(L("GLHEX.scene.rows"))}<input type="number" name="rows" value="14" min="1" max="200"></label>
        <label>${escapeHTML(L("GLHEX.scene.size"))}<input type="number" name="size" value="100" min="50" max="400" step="10"></label>
      </div>
      <label class="glhex-scene-orient">${escapeHTML(L("GLHEX.scene.orientation"))}
        <select name="gridType">
          <option value="${HEX_TYPES.HEXODDQ}" selected>${escapeHTML(L("GLHEX.scene.flat"))}</option>
          <option value="${HEX_TYPES.HEXODDR}">${escapeHTML(L("GLHEX.scene.pointy"))}</option>
        </select>
      </label>
    </fieldset>
  </div>`;

  const buttons = [{
    action: "create", label: L("GLHEX.scene.create"), icon: "fa-solid fa-map", default: true,
    callback: (_ev, button) => {
      const f = button.form.elements;
      return { action: "create", name: f.name.value, cols: f.cols.value, rows: f.rows.value, size: f.size.value, gridType: Number(f.gridType.value) };
    },
  }, {
    action: "import", label: L("GLHEX.scene.import"), icon: "fa-solid fa-file-import",
    callback: () => ({ action: "import" }),
  }];
  if (scene && !on && hexGrid) buttons.push({ action: "enable", label: L("GLHEX.scene.enable"), icon: "fa-solid fa-toggle-on", callback: () => ({ action: "enable" }) });
  if (scene && on) buttons.push({ action: "disable", label: L("GLHEX.scene.disable"), icon: "fa-solid fa-toggle-off", callback: () => ({ action: "disable" }) });

  let result = null;
  try {
    result = await DialogV2.wait({
      window: { title: L("GLHEX.scene.title"), icon: "fa-solid fa-map-location-dot" },
      classes: ["glhex-dialog"],
      content,
      buttons,
      rejectClose: false,
    });
  } catch { return; }
  if (!result || typeof result !== "object") return;

  try {
    if (result.action === "create") await createHexcrawlScene(result);
    else if (result.action === "enable") {
      if (await enableHexcrawl(scene)) ui.notifications.info(F("GLHEX.notify.enabled", { name: scene.name }));
    } else if (result.action === "disable") {
      if (await disableHexcrawl(scene)) ui.notifications.info(F("GLHEX.notify.disabled", { name: scene.name }));
    } else if (result.action === "import") {
      const mod = await import("./import-dialog.mjs");
      await mod.openImportDialog?.();
    }
  } catch (e) {
    warn("hexcrawl | scene action failed", e);
    ui.notifications.error(L("GLHEX.notify.sceneFailed"));
  }
}
