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
import { FEATURE_ID, SETTINGS, CAMERA, TIMING, FLAG_KNOWN, snapYawStep, yawStride } from "../constants.mjs";
import { TerrainStore, supportsScene } from "../terrain/store.mjs";
import { liveTerrain, onTerrainChange } from "../terrain/live.mjs";
import { readWalls, readTokens, backgroundSrc, loadArt } from "./snapshot.mjs";
import { Baker } from "./bake.mjs";
import { bakeHidden, bakeViewers, propsSeen } from "./props-seen.mjs";
import { Input } from "./input.mjs";
import { Hud } from "./hud.mjs";
import { PEEK, Peek, pivotToShow, sceneAt } from "./peek.mjs";
import { sendHold, sendInvite, sendSummon } from "./sync.mjs";
import { reachOf } from "./reach.mjs";
import { loadSeams, heightDist, groundDist } from "./seams.mjs";
import { el, isGM, setting, setSetting, streamOwnsView, t, typingTarget } from "./util.mjs";
import { HOOKS as STREAM_HOOKS } from "../../stream/constants.js";
import { turnState, currentCombatantToken } from "../integrations/turns.mjs";
import { templateAreas } from "../integrations/templates.mjs";
import { SequencerMirror } from "../integrations/sequencer.mjs";
import { SpellspriteMirror, fxApi, onFxChange } from "../integrations/spellsprite.mjs";
import { currentLines, linksOn, onLinesChanged } from "../integrations/target-lines.mjs";
import { OPTIONS, resolveGraphics } from "../options.mjs";
import { sceneEnvironment, environmentTouched, ENV_HOOKS } from "./environment-source.mjs";
import { PropStore } from "../terrain/props-store.mjs";
import { levelBackgroundSrc, tokenLevelId, isMultiLevel } from "../terrain/levels.mjs";
import { cutTokens } from "./levels.mjs";
import { readStack, stackProps, loadFloors, tokenLevelOf, releaseFloorArt, wallsOnLevel } from "./level-view.mjs";
import { readTiles } from "../integrations/tiles.mjs";
import { readRoofs } from "./roofs.mjs";

const ROOT_ID = "gldio-view";
const PARTS = ["terrain", "background", "walls", "tokens", "links", "cells", "overlays", "effects", "options", "lighting", "environment", "props", "levels", "tiles", "roofs"];
/** Setting keys whose change redraws with new graphics / a new environment. */
const GRAPHICS_KEYS = new Set(OPTIONS.filter((o) => o.scope === "client").map((o) => `${SUITE_ID}.${o.key}`));
const ENV_KEYS = new Set(["dio.envSource", "dio.weatherSource"].map((k) => `${SUITE_ID}.${k}`));
const emptyOverlays = () => ({ path: null, cells: [], marks: [], ruler: null, pings: [], hover: null, reach: null });
/** Setting keys whose change means a token's reach must be found again. */
const REACH_KEYS = new Set([`${SUITE_ID}.dio.reach`, `${SUITE_ID}.dio.propsBlock`]);

const fresh = () => ({
  reach: null, reachTimer: 0, dragTok: null, holds: new Map(),
  open: false, scene: null, grid: null, terrain: null, ground: null, saved: false,
  root: null, canvas: null, r: null, Renderer: null, surface: null,
  hooks: [], unTerrain: null, unLines: null, keyFn: null, resizeObs: null, tokenIds: new Set(),
  dirty: new Set(), raf: 0, labelUntil: 0, labelRaf: 0,
  baker: null, input: null, hud: null, seq: null, peek: null, sprite: null, unSprite: null,
  lighting: null, bg: null, bgSeq: 0, cellSeq: 0,
  overlays: emptyOverlays(),
  asPlayers: false, cutaway: true, savedCamera: null,
  // the Level stack (view/levels.mjs): the viewed Level, its plan, the floors' load sequence
  levelId: null, stack: null, floorSeq: 0,
  // Foundry tiles and roofs (docs/DIORAMA_BUILDINGS.md): the last walls, tiles and props read, and the GM's cut-away roofs
  walls: [], tiles: [], props: [], roofCut: false,
});

const S = fresh();
let _opening = null;
/** main.mjs's listener for the view opening and closing (it gates the 2D entry chip). */
let _onOpenChange = null;

/* ═══════════════════════════ public ═══════════════════════════ */

export const isOpen = () => S.open;
/** The live renderer, or null while the view is closed (the cost readouts read it). */
export const viewRenderer = () => S.r ?? null;

/** Tell `fn(open)` whenever the view opens or closes. One listener: main.mjs. */
export function onOpenChange(fn) {
  _onOpenChange = typeof fn === "function" ? fn : null;
}

function announce() {
  try { _onOpenChange?.(S.open); } catch (e) { err("diorama: open listener", e); }
}

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

/**
 * Close the view. The 2D canvas is first panned to centre what the 3D camera
 * was looking at (or `at`, a scene point), so leaving keeps the player's place;
 * never on the stream capture, whose camera owns the 2D view.
 * @param {{keepPlace?: boolean, at?: {x:number, y:number}}} [o]
 */
export function closeView({ keepPlace = true, at = null } = {}) {
  if (!S.open && !S.root) return false;
  if (keepPlace && S.open) {
    try { placeCanvas(at ?? cameraTarget()); } catch (e) { err("diorama: could not keep the place in 2D", e); }
  }
  teardown();
  return true;
}

/** Shift+M and the toolbar: open or close the 2D map window. False while the view is closed. */
export function togglePeek() {
  if (!S.open || !S.peek) return false;
  setPeek(!S.peek.open);
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
  if (!mayOpen(scene, true)) { closeView({ keepPlace: false }); return; }
  if (scene !== S.scene) {
    S.scene = scene;
    S.bg = null;
    S.overlays = emptyOverlays();
    S.reach = null;
    S.input?.cancel();
    S.seq?.dispose();
    S.seq = new SequencerMirror({ onChange: () => mark("effects"), groundQ });
    readTerrain();
    S.baker?.setGrid(S.grid);
    initialCamera();
    // a new scene's 2D canvas starts wherever Foundry put it: line it up in the window again
    if (S.peek?.open) centrePeek(false);
  } else if (liveTerrain(scene)?.levelId !== S.levelId) {
    // Foundry switched the viewed Level (it redraws the canvas): a new board, the same camera.
    S.bg = null;
    S.overlays = emptyOverlays();
    S.reach = null;
    S.input?.cancel();
    readTerrain();
    S.baker?.setGrid(S.grid);
    const cam = S.r?.getCamera?.();
    if (cam?.target) setCamera({ target: { ...cam.target, zQ: groundQ(cam.target.x, cam.target.y) } });
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
  S.peek = new Peek(root, {
    onCentre: () => centrePeek(true),
    onSwitch: () => closeView({ at: peekCentreScene() }),
    onClose: () => setPeek(false),
    avoid: foundryEdges,
  });
  bindInput();
  S.baker = new Baker({
    grid: S.grid,
    mode: visionMode,
    known: () => !!S.scene?.getFlag?.(SUITE_ID, FLAG_KNOWN),
    ground: () => (S.terrain && S.grid ? { terrain: S.terrain, grid: S.grid, walls: S.walls ?? [] } : null),
    onBaked: (res) => { S.lighting = res; mark("lighting"); if (S.asPlayers) mark("tokens"); },
  });
  S.seq = new SequencerMirror({ onChange: () => mark("effects"), groundQ });
  // Spellsprite (pf2e-fx): painted by the renderer every frame while its sims run; the api fails closed
  S.sprite = new SpellspriteMirror({ sims: () => fxApi()?.sims(S.scene?.id) ?? [], groundQ, siteSeen: spriteSiteSeen });
  S.r?.setPixelSource?.(S.sprite);
  S.unSprite = onFxChange(() => S.r?.requestRender());

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
  queueReach();
  // The stream capture never shows the 2D map window: the hole would put the 2D canvas on the broadcast.
  S.hooks.push([STREAM_HOOKS.streamModeChanged, Hooks.on(STREAM_HOOKS.streamModeChanged, () => { if (streamOwnsView()) setPeek(false); })]);
  if (isGM()) sendInvite(scene.id);
  announce();
}

function createRenderer() {
  const c = el("canvas", { class: "gldio-canvas" });
  if (S.canvas?.isConnected) S.canvas.replaceWith(c);
  else S.root.prepend(c);
  S.canvas = c;
  S.r = new S.Renderer({ canvas: c, pixelRatio: globalThis.devicePixelRatio || 1 });
  // The grid first: the camera converts its px target with the grid size.
  if (S.grid) S.r.setGrid(gridArg());
  if (S.sprite) S.r.setPixelSource?.(S.sprite);
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
    reach: () => S.reach,
    dragging: (tok) => { S.dragTok = tok ?? null; computeReach(); },
    sendHold: (doc, pose) => { if (S.scene) sendHold(S.scene.id, doc, pose); },
    tokensChanged: () => mark("tokens"),
    tactics: () => setting("dio.tactics", true) !== false,
    boardTokens: () => S.tokenIds,
    anchor: (id) => tokenAnchor(id),
  });
}

/* ═══════════════════════════ reach ═══════════════════════════ */

/** Find the reach again soon (several hooks fire for one change). */
function queueReach() {
  if (!S.open || S.reachTimer) return;
  S.reachTimer = setTimeout(computeReach, TIMING.reachDebounce);
}

/**
 * The squares the selected (or carried) token can reach in one, two and three
 * Strides. Shown per this player's `dio.reach`; a drag always finds it, since
 * the lift style routes the move along it.
 */
function computeReach() {
  if (S.reachTimer) clearTimeout(S.reachTimer);
  S.reachTimer = 0;
  if (!S.open) return;
  const mode = setting("dio.reach", "selected");
  let tok = S.dragTok;
  if (!tok && mode === "selected") {
    const c = globalThis.canvas?.tokens?.controlled ?? [];
    if (c.length === 1 && c[0].document?.parent === S.scene && c[0].document.isOwner) tok = c[0];
  }
  // viewing as the players: a token not on their board has no reach (its squares would outline it)
  const onBoard = S.asPlayers ? (id) => S.tokenIds.has(id) : null;
  if (tok && onBoard && !onBoard(tok.id)) tok = null;
  let reach = null;
  if (tok && S.grid) {
    try { reach = reachOf({ tok, scene: S.scene, grid: S.grid, terrain: S.terrain, seen: onBoard }); } catch (e) { err("diorama: reach failed", e); }
  }
  S.reach = reach;
  const show = reach && mode !== "off" && (mode === "selected" || S.dragTok);
  const next = show ? { cells: reach.cells, start: { ...reach.start, w: reach.w, h: reach.h } } : null;
  if (!next && !S.overlays.reach) return;
  S.overlays.reach = next;
  mark("overlays");
}

/** A miniature in another player's hand (sync.mjs), shown here if this viewer sees that token. */
export function applyHold(p, sender) {
  if (!S.open || !S.r || S.scene?.id !== p?.sceneId || !sender) return false;
  const tok = globalThis.canvas?.tokens?.get(p.tokenId);
  const doc = tok?.document;
  if (!doc) return false;
  if (!sender.isGM && !doc.testUserPermission(sender, "OWNER")) return false;
  if (!S.tokenIds.has(doc.id)) return false; // not on this viewer's board (hidden, unseen)
  const pose = { x: Number(p.x), y: Number(p.y), footQ: Number(p.footQ), groundQ: Number(p.groundQ),
    phase: p.phase === "drop" ? "drop" : "carry", tone: typeof p.tone === "string" ? p.tone : "info" };
  if (![pose.x, pose.y, pose.footQ].every(Number.isFinite)) return false;
  clearTimeout(S.holds.get(doc.id));
  S.holds.delete(doc.id);
  S.r.setHold(doc.id, pose);
  if (pose.phase === "carry") {
    // A hand that goes quiet (a closed tab) lets go; the figure walks back to its token.
    S.holds.set(doc.id, setTimeout(() => { S.holds.delete(doc.id); S.r?.setHold(doc.id, null); mark("tokens"); }, TIMING.holdStale));
  }
  return true;
}

function teardown() {
  S.open = false;
  if (S.raf) cancelAnimationFrame(S.raf);
  if (S.labelRaf) cancelAnimationFrame(S.labelRaf);
  for (const [name, id] of S.hooks) Hooks.off(name, id);
  if (S.reachTimer) clearTimeout(S.reachTimer);
  for (const timer of S.holds.values()) clearTimeout(timer);
  S.unTerrain?.();
  S.unLines?.();
  S.unSprite?.();
  if (S.keyFn) window.removeEventListener("keydown", S.keyFn, true);
  S.resizeObs?.disconnect();
  const safe = (fn) => { try { fn(); } catch (e) { err("diorama: teardown", e); } };
  safe(() => S.input?.dispose());
  safe(() => S.peek?.dispose());
  safe(() => S.hud?.dispose());
  safe(() => S.baker?.dispose());
  safe(() => S.seq?.dispose());
  safe(() => S.sprite?.dispose());
  safe(() => S.r?.dispose());
  safe(() => S.surface?.dispose());
  safe(() => releaseFloorArt());
  S.root?.remove();
  Object.assign(S, fresh());
  announce();
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
  // The reach follows the selected token, the creatures around it, the walls and doors, and difficult terrain.
  on("updateToken", (doc) => { if (here(doc) && (S.reach || doc.object?.controlled)) queueReach(); });
  for (const h of ["createToken", "deleteToken"]) on(h, (doc) => { if (here(doc) && S.reach) queueReach(); });
  on("refreshToken", tokens);
  on("targetToken", tokens);
  on("controlToken", () => { mark("tokens"); S.baker?.request(); S.input?.hoverLabel(); queueReach(); });
  for (const h of ["createWall", "updateWall", "deleteWall"]) on(h, (doc) => { wallsHere(doc); if (here(doc)) queueReach(); });
  for (const h of ["createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) on(h, () => queueReach());
  // any actor: the mover's Speed, or a creature around it dying (a dead body is not in the way)
  on("updateActor", () => { if (S.reach) queueReach(); });
  for (const h of ["createActiveEffect", "deleteActiveEffect"]) on(h, () => { if (S.reach) queueReach(); });
  for (const h of ["updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) on(h, tokens);
  on("combatTurnChange", (combat) => { mark("tokens"); follow(combat); });
  on("combatStart", (combat) => { mark("tokens"); follow(combat); });
  on("updateActor", tokens);
  for (const h of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) on(h, onActor);
  on("sightRefresh", () => { S.baker?.request(); mark("tokens"); });
  on("lightingRefresh", () => S.baker?.request());
  for (const h of ["createRegion", "updateRegion", "deleteRegion"]) on(h, (doc) => { if (here(doc)) { mark("cells"); queueReach(); } });
  // Foundry tiles: decals and roofs (integrations/tiles.mjs). Roofs follow "tokens" in flush().
  for (const h of ["createTile", "updateTile", "deleteTile"]) on(h, (doc) => { if (here(doc)) mark("tiles"); });
  on("updateScene", (scene, changes) => {
    if (scene !== S.scene) return;
    if ("levels" in changes || "background" in changes || "initialLevel" in changes) { mark("background"); mark("levels"); }
    if ("environment" in changes) { S.baker?.request(); mark("environment"); }
    // a known layout (FLAG_KNOWN) is read off the document by the bake; any flag write re-bakes
    if (changes?.flags?.[SUITE_ID]) S.baker?.request();
    if (changes?.flags?.[SUITE_ID]) mark("tiles"); // dio.tiles (integrations/tiles.mjs)
    if (environmentTouched(changes)) mark("environment");
    if (PropStore.touched(changes)) mark("props");
  });
  // Time and weather from elsewhere (the calendar, the Weather feature).
  for (const h of ENV_HOOKS) on(h, () => mark("environment"));
  on("updateUser", (_u, changes) => { if ("color" in changes) mark("tokens"); });
  // The stream capture: its camera moves the 2D canvas; the 3D camera follows.
  on("canvasPan", (_c, pos) => followCanvas(pos));
  // #hud follows the 2D stage (HeadsUpDisplayContainer#align): an open Token HUD is re-placed in it.
  on("canvasPan", () => S.input?.hudFollow());
  // Selecting and Foundry's own token keys (Delete, the movement keys, Tab) act on the active layer.
  on("canvasReady", (c) => { if (c?.tokens && !c.tokens.active) c.tokens.activate(); });
  on(STREAM_HOOKS.streamModeChanged, () => followCanvas());
  // A client-scope setting never becomes a Setting document, so it never fires
  // updateSetting: Foundry announces it on clientSettingChanged instead.
  on("clientSettingChanged", (key) => {
    if (REACH_KEYS.has(key)) { queueReach(); return; }
    if (GRAPHICS_KEYS.has(key)) { mark("options"); if (key.endsWith(".dayNight")) mark("environment"); }
  });
  // The GM changed the camera snap: put an open view back on it.
  on("updateSetting", (s) => {
    if (s?.key === `${SUITE_ID}.${SETTINGS.effects}`) { mark("tokens"); return; }
    if (REACH_KEYS.has(s?.key)) queueReach();
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
  S.unTerrain = onTerrainChange((scene) => { if (!scene || scene.id === S.scene?.id) { mark("terrain"); queueReach(); } });
  // The targeting lines: exactly the ones stream-targets draws on this client.
  S.unLines = onLinesChanged(() => mark("links"));
}

function onKey(ev) {
  if (!S.open || typingTarget(ev)) return;
  // Over the 2D map window the keys are Foundry's canvas's (T targets there, Escape cancels there).
  if (S.peek?.hovered) return;
  const consume = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
  if (ev.code === "KeyT" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    if (!ev.repeat) S.input?.targetHovered(ev.shiftKey);
    consume();
    return;
  }
  if (ev.code === "Escape") {
    if (S.input?.closeHud() || S.input?.cancel()) { consume(); return; }
    if (windowsOpen()) return;
    // the 2D map window first, then the view
    if (S.peek?.open) setPeek(false);
    else closeView();
    consume();
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
    // the Level stack moved (a Level edited, "view as players"): who is cut, which floors show
    if (d.has("levels") && !d.has("terrain")) { S.stack = readStack(S.scene, { gm: gm && !S.asPlayers }); d.add("tokens"); d.add("props"); }
    if (d.has("terrain")) {
      readTerrain();
      r.setGrid(gridArg());
      // The ground is drawn; props draw themselves on it (the rules terrain,
      // S.terrain, has the solid ones stamped in, for movement and picks).
      r.setTerrain(S.ground);
      S.baker?.setGrid(S.grid);
      S.baker?.request();
      S.hud?.setSetup(gm && !S.saved);
      d.add("walls"); d.add("tokens"); d.add("cells"); d.add("background"); d.add("props"); d.add("levels");
      queueReach();
    }
    if (d.has("background")) loadBackground();
    if (d.has("walls")) {
      const walls = readWalls({ isGM: gm && !S.asPlayers, terrain: S.ground, grid: S.grid, defaultMaterial: setting(SETTINGS.wallMaterial, "stone") });
      // v14 Levels: only the viewed Level's walls stand in the view.
      r.setWalls(S.walls = wallsOnLevel(walls, (id) => S.scene?.walls?.get?.(id) ?? null, isMultiLevel(S.scene) ? S.levelId : null));
      d.add("tiles"); // a roof stands on its walls
    }
    if (d.has("tokens")) {
      const read = readTokens({
        isGM: gm,
        asPlayers: S.asPlayers,
        grid: S.grid,
        hoveredId: S.input?.hoverId ?? null,
        turns: turnState({ isGM: gm && !S.asPlayers }),
        heightOf: heightDist,
        // each token's glass stand reaches down to its OWN Level's ground
        groundOf: (doc) => groundDist(S.scene, doc._source?.x ?? doc.x, doc._source?.y ?? doc.y, doc.width, doc.height, tokenLevelId(doc)),
        seen: S.asPlayers ? (S.baker?.seen ?? (() => false)) : null,
        systemId: game.system?.id ?? "",
        halo: haloLayout(),
      });
      // a token on a Level cut away above this one: a ghost to the GM, off a player's board
      const tokens = cutTokens(read, tokenLevelOf, S.stack?.cut, { gm: gm && !S.asPlayers });
      r.setTokens(tokens);
      const was = S.tokenIds;
      S.tokenIds = new Set(tokens.map((tk) => tk.id));
      d.add("links");
      // who is on the board decides which attached areas (auras) show, and whose squares the reach steps round
      if (was.size !== S.tokenIds.size || [...was].some((id) => !S.tokenIds.has(id))) { d.add("cells"); d.add("effects"); queueReach(); }
    }
    // A line whose end is not standing on the board is dropped here, not drawn to nowhere.
    if (d.has("links")) r.setLinks?.(linksOn(currentLines(), S.tokenIds));
    if (d.has("cells")) loadCells();
    if (d.has("overlays")) {
      const { marks, cells, ...rest } = S.overlays;
      r.setOverlays({ ...rest, cells: [...(cells ?? []), ...(marks ?? [])] });
    }
    if (d.has("effects")) {
      // an effect on a creature this viewer's board does not hold is not drawn (it would outline it)
      const fx = S.seq?.states((id) => S.tokenIds.has(id)) ?? [];
      r.setEffects(fx);
      if (fx.length) mark("effects"); // follow attached effects every frame while any play
    }
    if (d.has("options")) {
      r.setOptions({ tiltShift: !!setting(SETTINGS.tiltShift, false), cutaway: S.cutaway, ghosts: gm && !S.asPlayers, grid: gridLook(), graphics: readGraphics() });
    }
    if (d.has("environment")) r.setEnvironment?.(sceneEnvironment(S.scene, { dayNight: !!setting("dio.dayNight", true) }));
    // the viewed Level's props at its base, and those of every floor drawn below it
    if (d.has("props")) { r.setProps?.(S.props = stackProps(S.scene, S.stack, { isGM: gm && !S.asPlayers })); d.add("roofs"); }
    if (d.has("levels")) loadLevelFloors();
    if (d.has("lighting") && S.lighting) r.setLighting(S.lighting);
    // props standing in plain 3D sight over ground the polygon hides (a tree on a cliff's top)
    if (d.has("lighting") || d.has("props")) r.setPropsSeen?.(propsSeenNow());
    // Foundry tiles as decals and roofs, then which roofs open, for whom (docs/DIORAMA_BUILDINGS.md)
    if (d.has("tiles")) {
      S.tiles = readTiles({ scene: S.scene, isGM: gm, asPlayers: S.asPlayers, grid: S.grid, walls: S.walls, ground: S.ground });
      r.setTiles?.(S.tiles);
      d.add("roofs");
    }
    if (d.has("roofs") || d.has("tokens") || d.has("lighting")) r.setRoofs?.(roofsNow());
    r.requestRender();
    if (d.has("tokens") || d.has("terrain")) S.input?.relabel();
  } catch (e) {
    err("diorama: frame failed", e);
  }
}

/**
 * The viewed Level's terrain, in the view's ABSOLUTE frame (q 0 = elevation 0):
 * a Level's own heights lifted by its base (terrain/live.mjs absolute()), so a
 * token's absolute elevation stands on it. A one-Level scene's base is 0, and
 * these are the stored terrains themselves.
 */
function readTerrain() {
  const live = liveTerrain(S.scene);
  const abs = live?.absolute?.() ?? live;
  S.grid = live?.grid ?? null;
  S.terrain = abs?.terrain ?? null;
  S.ground = abs?.ground ?? S.terrain;
  S.saved = !!live?.saved;
  S.levelId = live?.levelId ?? null;
  S.stack = S.scene ? readStack(S.scene, { gm: isGM() && !S.asPlayers }) : null;
}

/** The floors below the viewed Level, their art loaded, into the renderer. */
async function loadLevelFloors() {
  const seq = ++S.floorSeq;
  let floors = [];
  try { floors = await loadFloors(S.stack, S.scene, S.grid?.sceneRect ?? null); } catch (e) { err("diorama: level floors", e); }
  if (!S.open || seq !== S.floorSeq || !S.r) return;
  S.r.setLevels?.(floors);
}

const gridArg = () => ({ size: S.grid.size, distance: S.grid.distance, cols: S.grid.cols, rows: S.grid.rows, sceneRect: S.grid.sceneRect });

/** A Spellsprite site named for a token (a target) stands only while that token is on this viewer's board. */
function spriteSiteSeen(id) {
  return !/^[A-Za-z0-9]{16}$/.test(String(id)) || S.tokenIds.has(String(id));
}

function groundQ(x, y) {
  try { return S.terrain ? S.terrain.groundAt(x, y, S.grid.size) : 0; } catch { return 0; }
}

async function loadBackground() {
  // the viewed Level's own art (v14 Levels carry their own background)
  const src = S.levelId ? levelBackgroundSrc(S.scene, S.levelId) : backgroundSrc(S.scene);
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
  let cells = [], areas = [];
  try {
    // an area attached to a creature shows only while that creature is on this viewer's board
    ({ cells, areas } = await templateAreas({ grid: S.grid, isGM: isGM(), asPlayers: S.asPlayers, tokenSeen: (id) => S.tokenIds.has(id) }));
  } catch (e) { err("diorama: templates", e); }
  if (!S.open || seq !== S.cellSeq) return;
  S.overlays.cells = cells;
  S.r?.setAreas?.(areas);
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
  S.peek?.layout();
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
  const own = layer?.controlled?.[0]
    ?? (isGM() ? null : layer?.placeables?.find((t) => t.isOwner && t.isVisible && t.actor?.hasPlayerOwner));
  const r = S.grid.sceneRect;
  // Then what the 2D canvas was showing, when it is on the map (closing pans 2D to
  // the 3D camera, so a round trip keeps the place); then the current combatant.
  const pivot = globalThis.canvas?.stage?.pivot;
  const onMap = pivot && pivot.x >= r.x && pivot.x <= r.x + r.width && pivot.y >= r.y && pivot.y <= r.y + r.height;
  const tok = own ?? (onMap ? null : currentCombatantToken());
  const p = tok?.center ? { x: tok.center.x, y: tok.center.y }
    : onMap ? { x: pivot.x, y: pivot.y }
      : { x: r.x + r.width / 2, y: r.y + r.height / 2 };
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
  // While the 2D map window is open, a 2D pan is the user's own, inside it.
  if (S.peek?.open) return;
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

/* ═══════════════════════════ roofs ═══════════════════════════ */

/** What every roof should show now, for this viewer (view/roofs.mjs). */
function roofsNow() {
  const gm = isGM();
  return readRoofs({
    tiles: S.tiles, props: S.props, isGM: gm, asPlayers: S.asPlayers, cutaway: gm && S.roofCut,
    // the GM's own view bakes no sight: every roof counts as seen
    vision: gm && !S.asPlayers ? null : (S.lighting?.vision ?? null),
    bakeScale: S.baker?.scale ?? 0.16,
    grid: S.grid,
    heightQ: (tok) => (heightDist(tok?.actor ?? null, tok?.document ?? null) / (S.grid?.distance || 5)) * 4,
  });
}

/** The props this viewer sees in 3D over hidden ground (view/props-seen.mjs); none without a vision bake. */
function propsSeenNow() {
  const hidden = bakeHidden(S.lighting?.vision ?? null, S.baker?.scale ?? 0);
  if (!hidden || !S.grid || !S.terrain) return new Set();
  try {
    return propsSeen({ props: S.props, grid: S.grid, hidden, viewers: bakeViewers(S.baker, { terrain: S.terrain, grid: S.grid }) });
  } catch (e) {
    err("diorama: props sight failed", e);
    return new Set();
  }
}

/** The GM's "cut away roofs": every roof in the GM's own view shows the room under it. */
export function toggleRoofs() {
  if (!S.open || !isGM()) return;
  S.roofCut = !S.roofCut;
  syncHud();
  mark("roofs");
}

/* ═══════════════════════════ the 2D map window ═══════════════════════════ */

/**
 * Open or close the 2D map window (view/peek.mjs): a hole in this overlay
 * through which Foundry's own canvas shows and takes input. Never on the
 * stream capture, where the hole would put the 2D canvas on the broadcast.
 */
function setPeek(on) {
  const p = S.peek;
  if (!p || !S.open) return;
  if (on && !p.open && !streamOwnsView()) {
    p.show();
    centrePeek(false);
  } else if (!on && p.open) {
    p.hide();
  }
  S.hud?.setPressed("peek", p.open);
}

/** Pan the 2D canvas so what the 3D camera looks at sits in the middle of the window. */
function centrePeek(animate) {
  const c = globalThis.canvas;
  const at = S.peek?.open ? S.peek.centre() : null;
  const pt = cameraTarget();
  if (!at || !pt || !c?.ready || !c.stage || c.scene !== S.scene || streamOwnsView()) return;
  const pv = pivotToShow(pt, at, { x: c.stage.position.x, y: c.stage.position.y }, c.stage.scale.x || 1);
  if (animate) c.animatePan({ x: pv.x, y: pv.y });
  else c.pan({ x: pv.x, y: pv.y });
}

/** The scene point in the middle of the 2D map window, or null while it is shut. */
function peekCentreScene() {
  const c = globalThis.canvas;
  const at = S.peek?.open ? S.peek.centre() : null;
  if (!at || !c?.ready || !c.stage) return null;
  return sceneAt(at, c.stage.position, c.stage.pivot, c.stage.scale.x || 1);
}

/** What the 3D camera is looking at, scene px (the saved camera while the context is released). */
function cameraTarget() {
  const tg = (S.r?.getCamera?.() ?? S.savedCamera)?.target;
  const x = Number(tg?.x), y = Number(tg?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Centre the 2D canvas on a scene point (leaving the view). Never moves the stream capture's camera. */
function placeCanvas(pt) {
  const c = globalThis.canvas;
  if (!pt || streamOwnsView() || !c?.ready || c.scene !== S.scene) return;
  c.pan({ x: pt.x, y: pt.y });
}

/**
 * Where Foundry's own UI starts, for the window's first position: the
 * sidebar's left edge, and the hotbar's top when the two would share columns.
 */
function foundryEdges() {
  const out = {};
  const vw = globalThis.innerWidth || 1280;
  const sb = document.getElementById("sidebar")?.getBoundingClientRect?.();
  if (sb && sb.width > 0 && sb.left > 0) out.right = sb.left;
  const hb = document.getElementById("hotbar")?.getBoundingClientRect?.();
  const left = (out.right ?? vw) - vw * PEEK.widthFrac - 2 * PEEK.margin;
  if (hb && hb.height > 0 && hb.right > left) out.bottom = hb.top;
  return out;
}

/* ═══════════════════════════ HUD ═══════════════════════════ */

function syncHud() {
  const h = S.hud;
  if (!h) return;
  h.setPressed("peek", !!S.peek?.open);
  h.setPressed("grid", !!setting(SETTINGS.grid, true));
  h.setPressed("tiltShift", !!setting(SETTINGS.tiltShift, false));
  h.setPressed("cutaway", S.cutaway);
  h.setPressed("follow", !!setting(SETTINGS.follow, false));
  h.setPressed("asPlayers", S.asPlayers);
  h.setPressed("roofs", S.roofCut);
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
    roofs: () => toggleRoofs(),
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
      queueReach();
    },
    graphics: () => import("./graphics-app.mjs").then((m) => m.openGraphics()).catch((e) => err("diorama: graphics", e)),
    environment: () => import("./environment-app.mjs").then((m) => m.openEnvironment(S.scene)).catch((e) => err("diorama: environment", e)),
    autoSetup: () => editTerrain(S.scene),
    peek: () => setPeek(!S.peek?.open),
    close: () => closeView(),
  };
}
