/**
 * Diorama view — the full-screen 3D overlay.
 *
 * Mounted right after #board, so it covers the canvas and sits UNDER
 * Foundry's interface (controls, sidebar, hotbar and chat stay usable). The
 * 2D canvas stays the only source of truth: the overlay reads Foundry through
 * snapshot.mjs and writes only ordinary documents through input.mjs.
 *
 * Everything that changes the picture marks a part dirty; one animation frame
 * flushes every dirty part into the renderer and asks for ONE render. Every
 * hook is added on open and removed on close; nothing here runs at import.
 *
 * The renderer (three.js, ~700 KB) is imported only when the view opens.
 */

import { err, SUITE_ID } from "../../../core/const.mjs";
import { Surfaces } from "../../../core/gl-surfaces.mjs";
import { FEATURE_ID, SETTINGS, CAMERA, TIMING, snapYawStep, yawStride } from "../constants.mjs";
import { TerrainStore, supportsScene } from "../terrain/store.mjs";
import { liveTerrain, onTerrainChange } from "../terrain/live.mjs";
import { readWalls, readTokens, backgroundSrc, loadArt } from "./snapshot.mjs";
import { Baker } from "./bake.mjs";
import { Input } from "./input.mjs";
import { Hud } from "./hud.mjs";
import { sendInvite, sendSummon } from "./sync.mjs";
import { loadSeams, heightDist, groundDist } from "./seams.mjs";
import { el, isGM, setting, setSetting, streamOwnsView, t, typingTarget } from "./util.mjs";
import { HOOKS as STREAM_HOOKS } from "../../stream/constants.js";
import { turnState, currentCombatantToken } from "../integrations/turns.mjs";
import { templateCells } from "../integrations/templates.mjs";
import { SequencerMirror } from "../integrations/sequencer.mjs";
import { currentLines, linksOn, onLinesChanged } from "../integrations/target-lines.mjs";
import { OPTIONS, resolveGraphics } from "../options.mjs";
import { sceneEnvironment, environmentTouched, ENV_HOOKS } from "./environment-source.mjs";
import { PropStore } from "../terrain/props-store.mjs";

const ROOT_ID = "gldio-view";
const PARTS = ["terrain", "background", "walls", "tokens", "links", "cells", "overlays", "effects", "options", "lighting", "environment", "props"];
/** Setting keys whose change redraws with new graphics / a new environment. */
const GRAPHICS_KEYS = new Set(OPTIONS.filter((o) => o.scope === "client").map((o) => `${SUITE_ID}.${o.key}`));
const ENV_KEYS = new Set(["dio.envSource", "dio.weatherSource"].map((k) => `${SUITE_ID}.${k}`));
const emptyOverlays = () => ({ path: null, cells: [], marks: [], ruler: null, pings: [], hover: null });

const fresh = () => ({
  open: false, scene: null, grid: null, terrain: null, saved: false,
  root: null, canvas: null, r: null, Renderer: null, surface: null,
  hooks: [], unTerrain: null, unLines: null, keyFn: null, resizeObs: null, tokenIds: new Set(),
  dirty: new Set(), raf: 0, labelUntil: 0, labelRaf: 0,
  baker: null, input: null, hud: null, seq: null,
  lighting: null, bg: null, bgSeq: 0, cellSeq: 0,
  overlays: emptyOverlays(),
  asPlayers: false, cutaway: true, savedCamera: null,
});

const S = fresh();
let _opening = null;

/* ═══════════════════════════ public ═══════════════════════════ */

export const isOpen = () => S.open;

/** Whether this client may open the view on a scene; notifies why not. */
export function mayOpen(scene, notify = false) {
  const say = (k) => { if (notify) ui.notifications?.warn(t(k)); return false; };
  if (!scene) return say("GLDIO.view.noScene");
  if (!supportsScene(scene)) return say("GLDIO.view.unsupported");
  if (!isGM() && TerrainStore.isOff(scene)) return say("GLDIO.view.off");
  return true;
}

export function openView() {
  if (S.open) return Promise.resolve(true);
  if (_opening) return _opening;
  const scene = globalThis.canvas?.scene;
  if (!globalThis.canvas?.ready || !mayOpen(scene, true)) return Promise.resolve(false);
  _opening = mount(scene)
    .then(() => true)
    .catch((e) => {
      err("diorama: the view failed to open", e);
      ui.notifications?.error(t("GLDIO.view.failed"));
      teardown();
      return false;
    })
    .finally(() => { _opening = null; });
  return _opening;
}

export function closeView() {
  if (!S.open && !S.root) return false;
  teardown();
  return true;
}

export function toggleView() {
  return S.open ? Promise.resolve(closeView()) : openView();
}

/** Q / E. Returns false while closed so the key passes on. */
export function rotate(d) {
  if (!S.open || !S.r) return false;
  const cam = S.r.getCamera();
  const snap = yawSnap();
  setCamera({ yawStep: snapYawStep(snapYawStep(cam.yawStep ?? 0, snap) + d * yawStride(snap), snap) });
  return true;
}

/** The GM's camera snap, in degrees. */
const yawSnap = () => Number(setting(SETTINGS.yawSnap, 90)) || 90;

/** R. */
export function cyclePitch() {
  if (!S.open || !S.r) return false;
  const cam = S.r.getCamera();
  setCamera({ pitchIndex: ((cam.pitchIndex ?? 0) + 1) % CAMERA.pitches.length });
  return true;
}

/** A GM's "bring everyone" camera, on this client. */
export function applySummon(sceneId, camera) {
  if (!S.open || !S.r || S.scene?.id !== sceneId) return false;
  if (streamOwnsView()) return false; // the stream camera frames the broadcast
  const c = sanitizeCamera(camera);
  if (!c) return false;
  setCamera(c);
  return true;
}

/** Close the view (the editor paints on the 2D canvas) and open the terrain editor. */
export async function editTerrain(scene = globalThis.canvas?.scene) {
  if (!isGM() || !scene) return;
  closeView();
  try {
    const m = await import("../editor/app.mjs");
    await m.openEditor(scene, { autoSetup: !TerrainStore.has(scene) });
  } catch (e) {
    err("diorama: the editor failed to open", e);
    ui.notifications?.error(t("GLDIO.editor.failed"));
  }
}

/** canvasReady: follow a scene change, or close where the view may not open. */
export function onCanvasReady() {
  if (!S.open) return;
  const scene = globalThis.canvas?.scene;
  if (!mayOpen(scene, true)) { closeView(); return; }
  if (scene !== S.scene) {
    S.scene = scene;
    S.bg = null;
    S.overlays = emptyOverlays();
    S.input?.cancel();
    S.seq?.dispose();
    S.seq = new SequencerMirror({ onChange: () => mark("effects"), groundQ });
    readTerrain();
    S.baker?.setGrid(S.grid);
    initialCamera();
  }
  markAll();
  S.baker?.request();
}

/* ═══════════════════════════ mount / teardown ═══════════════════════════ */

async function mount(scene) {
  await loadSeams();
  const { DioramaRenderer } = await import("../render/renderer.mjs");
  if (S.open) return;
  S.Renderer = DioramaRenderer;
  S.scene = scene;

  const root = el("div", { id: ROOT_ID, class: "gldio-view gl-type", dataset: { gm: isGM() ? "1" : "0" } });
  (document.getElementById("board") ?? document.body).after(root);
  S.root = root;

  readTerrain();
  // The renderer binds SHED_ORDER to the shared Budget itself
  // (Budget.ladder in its constructor) and holds Budget.claimMotion only
  // while something animates, so the view adds neither.
  createRenderer();
  S.surface = Surfaces.register({
    id: FEATURE_ID,
    element: () => S.root,
    pause: () => { S.r?.pause?.(); },
    resume: () => { S.r?.resume?.(); mark("options"); },
    release: () => {
      S.savedCamera = S.r?.getCamera?.() ?? null;
      try { S.r?.dispose(); } catch { /* gone */ }
      S.r = null;
    },
    restore: () => {
      createRenderer();
      if (S.savedCamera) S.r.setCamera(S.savedCamera, { animate: false });
      markAll();
    },
    // An on-demand renderer holds a still picture; releasing it would blank
    // the view until something moved.
    holds: () => S.open,
  });

  S.hud = new Hud(root, { isGM: isGM(), actions: hudActions() });
  bindInput();
  S.baker = new Baker({
    grid: S.grid,
    mode: visionMode,
    onBaked: (res) => { S.lighting = res; mark("lighting"); if (S.asPlayers) mark("tokens"); },
  });
  S.seq = new SequencerMirror({ onChange: () => mark("effects"), groundQ });

  S.resizeObs = new ResizeObserver(() => resize());
  S.resizeObs.observe(root);
  S.keyFn = onKey;
  window.addEventListener("keydown", S.keyFn, true);
  wireHooks();

  S.open = true;
  syncHud();
  resize();
  initialCamera();
  // Bake vision now, so the first frame that draws the ground also hides what this viewer has not seen.
  try { S.baker.bake(); } catch (e) { err("diorama: first bake failed", e); }
  markAll();
  if (isGM()) sendInvite(scene.id);
}

function createRenderer() {
  const c = el("canvas", { class: "gldio-canvas" });
  if (S.canvas?.isConnected) S.canvas.replaceWith(c);
  else S.root.prepend(c);
  S.canvas = c;
  S.r = new S.Renderer({ canvas: c, pixelRatio: globalThis.devicePixelRatio || 1 });
  // The grid first: the camera converts its px target with the grid size.
  if (S.grid) S.r.setGrid(gridArg());
  if (S.input) bindInput();
  resize();
}

function bindInput() {
  S.input?.dispose();
  S.input = new Input({
    canvas: S.canvas,
    r: () => S.r,
    scene: () => S.scene,
    grid: () => S.grid,
    terrain: () => S.terrain,
    hud: S.hud,
    setOverlays: (patch) => { Object.assign(S.overlays, patch); mark("overlays"); },
    onHover: () => mark("tokens"),
    asPlayers: () => S.asPlayers,
    cameraMoved: () => trackLabels(0),
  });
}

function teardown() {
  S.open = false;
  if (S.raf) cancelAnimationFrame(S.raf);
  if (S.labelRaf) cancelAnimationFrame(S.labelRaf);
  for (const [name, id] of S.hooks) Hooks.off(name, id);
  S.unTerrain?.();
  S.unLines?.();
  if (S.keyFn) window.removeEventListener("keydown", S.keyFn, true);
  S.resizeObs?.disconnect();
  const safe = (fn) => { try { fn(); } catch (e) { err("diorama: teardown", e); } };
  safe(() => S.input?.dispose());
  safe(() => S.hud?.dispose());
  safe(() => S.baker?.dispose());
  safe(() => S.seq?.dispose());
  safe(() => S.r?.dispose());
  safe(() => S.surface?.dispose());
  S.root?.remove();
  Object.assign(S, fresh());
}

/* ═══════════════════════════ hooks ═══════════════════════════ */

function wireHooks() {
  const on = (name, fn) => S.hooks.push([name, Hooks.on(name, fn)]);
  const here = (doc) => !doc?.parent || doc.parent === S.scene;
  const tokens = () => mark("tokens");
  const tokensHere = (doc) => { if (here(doc)) mark("tokens"); };
  const wallsHere = (doc) => { if (here(doc)) mark("walls"); };
  const onActor = (doc) => { if (doc?.parent?.documentName === "Actor" || doc?.parent?.documentName === "Token") mark("tokens"); };

  for (const h of ["createToken", "updateToken", "deleteToken"]) on(h, tokensHere);
  on("refreshToken", tokens);
  on("targetToken", tokens);
  on("controlToken", () => { mark("tokens"); S.baker?.request(); S.input?.hoverLabel(); });
  for (const h of ["createWall", "updateWall", "deleteWall"]) on(h, wallsHere);
  for (const h of ["updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) on(h, tokens);
  on("combatTurnChange", (combat) => { mark("tokens"); follow(combat); });
  on("combatStart", (combat) => { mark("tokens"); follow(combat); });
  on("updateActor", tokens);
  for (const h of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) on(h, onActor);
  on("sightRefresh", () => { S.baker?.request(); mark("tokens"); });
  on("lightingRefresh", () => S.baker?.request());
  for (const h of ["createRegion", "updateRegion", "deleteRegion"]) on(h, (doc) => { if (here(doc)) mark("cells"); });
  on("updateScene", (scene, changes) => {
    if (scene !== S.scene) return;
    if ("levels" in changes || "background" in changes || "initialLevel" in changes) mark("background");
    if ("environment" in changes) { S.baker?.request(); mark("environment"); }
    if (environmentTouched(changes)) mark("environment");
    if (PropStore.touched(changes)) mark("props");
  });
  // Time and weather from elsewhere (the calendar, the Weather feature).
  for (const h of ENV_HOOKS) on(h, () => mark("environment"));
  on("updateUser", (_u, changes) => { if ("color" in changes) mark("tokens"); });
  // The stream capture: its camera moves the 2D canvas; the 3D camera follows.
  on("canvasPan", (_c, pos) => followCanvas(pos));
  on(STREAM_HOOKS.streamModeChanged, () => followCanvas());
  // The GM changed the camera snap: put an open view back on it.
  on("updateSetting", (s) => {
    if (s?.key === `${SUITE_ID}.${SETTINGS.effects}`) { mark("tokens"); return; }
    if (GRAPHICS_KEYS.has(s?.key)) { mark("options"); if (s.key.endsWith(".dayNight")) mark("environment"); return; }
    if (ENV_KEYS.has(s?.key)) { mark("environment"); return; }
    if (s?.key === `${SUITE_ID}.dio.propsBlock`) { mark("props"); return; }
    if (s?.key !== `${SUITE_ID}.${SETTINGS.yawSnap}` || !S.r) return;
    const cam = S.r.getCamera();
    const step = snapYawStep(cam.yawStep ?? 0, yawSnap());
    if (step !== cam.yawStep) setCamera({ yawStep: step });
  });
  // The controls change width with the active tool set; place again after a render.
  on("renderSceneControls", () => placeBesideControls());
  S.unTerrain = onTerrainChange((scene) => { if (!scene || scene.id === S.scene?.id) mark("terrain"); });
  // The targeting lines: exactly the ones stream-targets draws on this client.
  S.unLines = onLinesChanged(() => mark("links"));
}

function onKey(ev) {
  if (!S.open || typingTarget(ev)) return;
  const consume = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
  if (ev.code === "KeyT" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    if (!ev.repeat) S.input?.targetHovered(ev.shiftKey);
    consume();
    return;
  }
  if (ev.code === "Escape") {
    if (S.hud?.closeMenu() || S.input?.cancel()) { consume(); return; }
    if (!windowsOpen()) { closeView(); consume(); }
  }
}

/** Is any framed Foundry window open (Escape is theirs then)? */
function windowsOpen() {
  try {
    for (const app of globalThis.foundry?.applications?.instances?.values?.() ?? []) {
      if (app.rendered && app.hasFrame) return true;
    }
    return Object.keys(globalThis.ui?.windows ?? {}).length > 0;
  } catch {
    return false;
  }
}

/* ═══════════════════════════ the frame ═══════════════════════════ */

function mark(part) {
  if (!S.open) return;
  S.dirty.add(part);
  if (!S.raf) S.raf = requestAnimationFrame(flush);
}

function markAll() { for (const p of PARTS) mark(p); }

function flush() {
  S.raf = 0;
  if (!S.open || !S.surface) return;
  if (!S.surface.use() || !S.r) return; // stays dirty; resume marks again
  const d = S.dirty;
  S.dirty = new Set();
  const r = S.r;
  const gm = isGM();
  try {
    if (d.has("terrain")) {
      readTerrain();
      r.setGrid(gridArg());
      r.setTerrain(S.terrain);
      S.baker?.setGrid(S.grid);
      S.baker?.request();
      S.hud?.setSetup(gm && !S.saved);
      d.add("walls"); d.add("tokens"); d.add("cells"); d.add("background");
    }
    if (d.has("background")) loadBackground();
    if (d.has("walls")) {
      r.setWalls(readWalls({ isGM: gm && !S.asPlayers, terrain: S.terrain, grid: S.grid, defaultMaterial: setting(SETTINGS.wallMaterial, "stone") }));
    }
    if (d.has("tokens")) {
      const tokens = readTokens({
        isGM: gm,
        asPlayers: S.asPlayers,
        grid: S.grid,
        hoveredId: S.input?.hoverId ?? null,
        turns: turnState({ isGM: gm && !S.asPlayers }),
        heightOf: heightDist,
        groundOf: (doc) => groundDist(S.scene, doc._source?.x ?? doc.x, doc._source?.y ?? doc.y, doc.width, doc.height),
        seen: S.asPlayers ? (S.baker?.seen ?? (() => false)) : null,
        systemId: game.system?.id ?? "",
        halo: haloLayout(),
      });
      r.setTokens(tokens);
      S.tokenIds = new Set(tokens.map((tk) => tk.id));
      d.add("links");
    }
    // A line whose end is not standing on the board is dropped here, not drawn to nowhere.
    if (d.has("links")) r.setLinks?.(linksOn(currentLines(), S.tokenIds));
    if (d.has("cells")) loadCells();
    if (d.has("overlays")) {
      const { marks, cells, ...rest } = S.overlays;
      r.setOverlays({ ...rest, cells: [...(cells ?? []), ...(marks ?? [])] });
    }
    if (d.has("effects")) {
      const fx = S.seq?.states() ?? [];
      r.setEffects(fx);
      if (fx.length) mark("effects"); // follow attached effects every frame while any play
    }
    if (d.has("options")) {
      r.setOptions({ tiltShift: !!setting(SETTINGS.tiltShift, false), cutaway: S.cutaway, ghosts: gm && !S.asPlayers, grid: gridLook(), graphics: readGraphics() });
    }
    if (d.has("environment")) r.setEnvironment?.(sceneEnvironment(S.scene, { dayNight: !!setting("dio.dayNight", true) }));
    if (d.has("props")) r.setProps?.(PropStore.states(S.scene, { isGM: gm && !S.asPlayers }));
    if (d.has("lighting") && S.lighting) r.setLighting(S.lighting);
    r.requestRender();
    if (d.has("tokens") || d.has("terrain")) S.input?.relabel();
  } catch (e) {
    err("diorama: frame failed", e);
  }
}

function readTerrain() {
  const live = liveTerrain(S.scene);
  S.grid = live?.grid ?? null;
  S.terrain = live?.terrain ?? null;
  S.saved = !!live?.saved;
}

const gridArg = () => ({ size: S.grid.size, distance: S.grid.distance, cols: S.grid.cols, rows: S.grid.rows, sceneRect: S.grid.sceneRect });

function groundQ(x, y) {
  try { return S.terrain ? S.terrain.groundAt(x, y, S.grid.size) : 0; } catch { return 0; }
}

async function loadBackground() {
  const src = backgroundSrc(S.scene);
  if (S.bg && S.bg.src === src) { S.r?.setBackground(S.bg.img, S.grid.sceneRect); S.r?.requestRender(); return; }
  const seq = ++S.bgSeq;
  const img = await loadArt(src);
  if (!S.open || seq !== S.bgSeq || !S.r) return;
  S.bg = { src, img };
  S.r.setBackground(img, S.grid.sceneRect);
  S.r.requestRender();
}

async function loadCells() {
  const seq = ++S.cellSeq;
  let cells = [];
  try { cells = await templateCells({ grid: S.grid, isGM: isGM() && !S.asPlayers }); } catch (e) { err("diorama: templates", e); }
  if (!S.open || seq !== S.cellSeq) return;
  S.overlays.cells = cells;
  mark("overlays");
}

/** Vision bake mode: null = everything visible. */
function visionMode() {
  if (isGM() && !S.asPlayers) return null;
  const tokenVision = globalThis.canvas?.visibility?.tokenVision ?? S.scene?.tokenVision;
  if (!tokenVision) return null;
  return isGM() ? "players" : "own";
}

/**
 * The 3D grid: the scene's own grid colour, at the scene's alpha, but never so
 * faint it vanishes or so strong it fights the art. Off by the client toggle.
 */
/** Conditions ring the base (the default, as PF2e Effects Halo does in 2D) or sit on the head plate. */
function haloLayout() {
  return setting(SETTINGS.effects, "halo") !== "plate";
}

function gridLook() {
  const g = S.scene?.grid;
  const on = !!setting(SETTINGS.grid, true);
  const color = typeof g?.color === "string" ? g.color : (g?.color?.css ?? "#000000");
  const alpha = Math.max(0.1, Math.min(0.8, Number(setting("dio.gridStrength", 0.3)) || 0.3));
  return { on, color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000", alpha };
}

/** This client's graphics choices, resolved (options.mjs). */
function readGraphics() {
  const raw = {};
  for (const o of OPTIONS) if (o.scope === "client") raw[o.name] = setting(o.key, o.default);
  return resolveGraphics(raw);
}

/** Keep the toolbar beside Foundry's scene controls, whatever their width. */
function placeBesideControls() {
  if (!S.root) return;
  const sc = document.getElementById("scene-controls") ?? document.getElementById("ui-left-column-1");
  const right = sc?.getBoundingClientRect?.().right;
  const left = Number.isFinite(right) && right > 0 ? right : 88;
  S.root.style.setProperty("--gldio-left", `${Math.round(left)}px`);
}

function resize() {
  placeBesideControls();
  if (!S.root || !S.r) return;
  const w = S.root.clientWidth || globalThis.innerWidth, h = S.root.clientHeight || globalThis.innerHeight;
  S.r.resize(w, h);
  S.r.requestRender();
  S.input?.relabel();
}

/* ═══════════════════════════ camera ═══════════════════════════ */

function setCamera(patch, animate = true) {
  if (!S.r) return;
  S.r.setCamera({ ...S.r.getCamera(), ...patch }, { animate });
  S.r.requestRender();
  trackLabels(animate ? TIMING.camera : 0);
}

/** Keep the DOM labels on their anchors while a camera tween runs. */
function trackLabels(ms) {
  S.labelUntil = Math.max(S.labelUntil, performance.now() + ms);
  if (S.labelRaf) return;
  const step = () => {
    S.labelRaf = 0;
    if (!S.open) return;
    S.input?.relabel();
    if (performance.now() < S.labelUntil) S.labelRaf = requestAnimationFrame(step);
  };
  S.labelRaf = requestAnimationFrame(step);
}

function zoomBy(k) {
  if (!S.r) return;
  const z = (S.r.getCamera().zoom || 1) * k;
  setCamera({ zoom: Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, z)) });
}

function focusOn(pt) {
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
  setCamera({ target: { x: pt.x, y: pt.y, zQ: groundQ(pt.x, pt.y) } });
}

function initialCamera() {
  if (!S.r || !S.grid) return;
  const layer = globalThis.canvas?.tokens;
  const tok = layer?.controlled?.[0]
    ?? (isGM() ? null : layer?.placeables?.find((t) => t.isOwner && t.isVisible && t.actor?.hasPlayerOwner))
    ?? currentCombatantToken();
  const r = S.grid.sceneRect;
  const p = tok?.center ? { x: tok.center.x, y: tok.center.y } : { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  S.r.setGrid(gridArg());
  S.r.setCamera({ yawStep: 0, pitchIndex: CAMERA.defaultPitch, zoom: 1, target: { ...p, zQ: groundQ(p.x, p.y) } }, { animate: false });
  followCanvas();
}

/** Cells top to bottom at 3D zoom 1: render/camera.mjs VIEW_CELLS (diorama-check pins them equal). */
export const VIEW_CELLS = 12;

/**
 * On the stream capture, the stream camera pans and zooms the 2D canvas under
 * us; the 3D camera takes the same centre, and the zoom that shows the same
 * number of cells top to bottom. Snapped, because the stream camera already
 * eases its own pans frame by frame.
 */
function followCanvas(pos = null) {
  if (!S.open || !S.r || !S.grid || !streamOwnsView()) return;
  const c = globalThis.canvas;
  const x = Number(pos?.x ?? c?.stage?.pivot?.x), y = Number(pos?.y ?? c?.stage?.pivot?.y);
  const scale = Number(pos?.scale ?? c?.stage?.scale?.x);
  if (![x, y, scale].every(Number.isFinite) || scale <= 0) return;
  const cellsTall = (S.root?.clientHeight || globalThis.innerHeight || 800) / scale / (S.grid.size || 100);
  const zoom = Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, VIEW_CELLS / Math.max(0.5, cellsTall)));
  setCamera({ target: { x, y, zQ: groundQ(x, y) }, zoom }, false);
}

function follow() {
  if (!S.open || !setting(SETTINGS.follow, false) || streamOwnsView()) return;
  const tok = currentCombatantToken();
  if (tok) focusOn(tok.center);
}

/** A scene point (px, elevation in distance units) on screen, client px. */
export function projectPoint(x, y, elevation = 0) {
  if (!S.open || !S.r || !S.grid) return null;
  const zQ = (Number(elevation) || 0) / (S.grid.distance || 5) * 4;
  const p = S.r.project(Number(x), Number(y), zQ);
  return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null;
}

/** Above a token's standee (its leaned top), client px; null if it has none. */
export function tokenAnchor(tokenId) {
  if (!S.open || !S.r || !S.grid) return null;
  const head = S.r.standees?.headOf?.(String(tokenId));
  if (!head) return null;
  const size = S.grid.size || 100;
  const p = S.r.project(head.x * size, head.z * size, head.y * 4);
  return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null;
}

/** A camera from the socket, made safe, its yaw on this world's snap. */
export function sanitizeCamera(c, snap = yawSnap()) {
  if (!c || typeof c !== "object") return null;
  const yaw = Math.round(Number(c.yawStep));
  const pitch = Math.round(Number(c.pitchIndex));
  const zoom = Number(c.zoom);
  const tx = Number(c.target?.x), ty = Number(c.target?.y);
  if (![yaw, pitch, zoom, tx, ty].every(Number.isFinite)) return null;
  return {
    yawStep: snapYawStep(yaw, snap),
    pitchIndex: Math.max(0, Math.min(CAMERA.pitches.length - 1, pitch)),
    zoom: Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, zoom)),
    target: { ...c.target, x: tx, y: ty },
  };
}

/* ═══════════════════════════ HUD ═══════════════════════════ */

function syncHud() {
  const h = S.hud;
  if (!h) return;
  h.setPressed("grid", !!setting(SETTINGS.grid, true));
  h.setPressed("tiltShift", !!setting(SETTINGS.tiltShift, false));
  h.setPressed("cutaway", S.cutaway);
  h.setPressed("follow", !!setting(SETTINGS.follow, false));
  h.setPressed("asPlayers", S.asPlayers);
  h.setSetup(isGM() && !S.saved);
  S.root?.toggleAttribute("data-as-players", S.asPlayers);
}

function hudActions() {
  return {
    yawLeft: () => rotate(-1),
    yawRight: () => rotate(1),
    pitch: () => cyclePitch(),
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(1 / 1.25),
    grid: async () => { await setSetting(SETTINGS.grid, !setting(SETTINGS.grid, true)); syncHud(); mark("options"); },
    tiltShift: async () => { await setSetting(SETTINGS.tiltShift, !setting(SETTINGS.tiltShift, false)); syncHud(); mark("options"); },
    cutaway: () => { S.cutaway = !S.cutaway; syncHud(); mark("options"); },
    follow: async () => {
      const on = !setting(SETTINGS.follow, false);
      await setSetting(SETTINGS.follow, on);
      syncHud();
      if (on) follow();
    },
    summon: () => {
      if (!S.r || !S.scene) return;
      sendSummon(S.scene.id, S.r.getCamera());
      ui.notifications?.info(t("GLDIO.view.summoned"));
    },
    asPlayers: () => {
      S.asPlayers = !S.asPlayers;
      S.input?.cancel();
      syncHud();
      markAll();
      S.baker?.request();
    },
    graphics: () => import("./graphics-app.mjs").then((m) => m.openGraphics()).catch((e) => err("diorama: graphics", e)),
    environment: () => import("./environment-app.mjs").then((m) => m.openEnvironment(S.scene)).catch((e) => err("diorama: environment", e)),
    autoSetup: () => editTerrain(S.scene),
    close: () => closeView(),
  };
}
