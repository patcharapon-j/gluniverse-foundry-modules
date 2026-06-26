/**
 * GLUniverse Suite — Minimap controller.
 *
 * The single runtime hub that ties the data layer, the floating viewer, the Map
 * Studio and the socket together. It decides *what* each client renders (GM sees
 * the live draft with hidden elements ghosted; players see the published
 * snapshot), routes socket traffic, and exposes the GM authoring actions
 * (activate / push / draw-attention / stage a quick marker move).
 */

import { MODULE_ID, FEATURE_ID, MSG, PING_COOLDOWN_MS, MAP_W, MAP_H } from "./const.mjs";
import { MapStore } from "./data.mjs";
import { MinimapViewer } from "./viewer.mjs";
import * as Net from "./socket.mjs";

const log = (...a) => console.log("%cGLUniverse Suite", "color:#5eeaff", "| minimap |", ...a);

const state = {
  viewer: null,
  lastRev: 0,
  lastPingAt: 0,
  vpThrottle: 0
};

/** The single live Map Studio instance, whichever entry point opened it. */
function getStudio() {
  return foundry.applications?.instances?.get("glmm-studio") ?? null;
}

/* ------------------------------- lifecycle ------------------------------- */

export function wire() {
  Net.installDispatcher(dispatch);

  // A second GM editing the library should see it; players don't watch `maps`.
  Hooks.on("updateSetting", (setting) => {
    if (!game.user?.isGM) return;
    if (setting?.key === `${MODULE_ID}.mm.maps`) refreshGM();
  });

  // Late-join / reload: if a map is active and published, open the viewer.
  const pub = MapStore.readPublished();
  if (pub) {
    state.lastRev = pub.rev ?? 0;
    openViewer();
  }
}

/* ------------------------------- the viewer ------------------------------ */

function ensureViewer() {
  if (state.viewer) return state.viewer;
  state.viewer = new MinimapViewer({
    // callbacks the viewer fires back into the controller
    ping: (x, y) => localPingAndEmit(x, y),
    drawAttention: (x, y) => drawAttention(x, y),
    stageMarkerMove: (elId, x, y) => stageMarkerMove(elId, x, y),
    pushSilent: () => push("silent"),
    pushBroadcast: () => push("broadcast"),
    openStudio: () => openStudio(),
    viewportChanged: (pan, zoom) => onGmViewport(pan, zoom),
    recenterRequest: () => presentCurrent(),
    isGM: () => !!game.user?.isGM
  });
  return state.viewer;
}

export async function openViewer() {
  const v = ensureViewer();
  await v.open();
  presentCurrent();
  return v;
}

export function closeViewer() {
  state.viewer?.close();
}

export async function toggleViewer() {
  const v = ensureViewer();
  if (v.rendered) v.close();
  else await openViewer();
}

/** Push the current per-client content (GM draft / player published) with no animation. */
function presentCurrent() {
  const v = state.viewer;
  if (!v?.rendered) return;
  if (game.user.isGM) {
    const map = MapStore.activeMap();
    if (!map) { v.present({ snapshot: null, ghosts: [], isGM: true, viewMode: "shared", pending: 0 }); return; }
    const { snapshot, ghosts } = buildGMView(map);
    v.present({ snapshot, ghosts, isGM: true, viewMode: map.viewMode, pending: pendingCount() });
  } else {
    const snap = MapStore.readPublished();
    v.present({ snapshot: snap, ghosts: [], isGM: false, viewMode: snap?.viewMode ?? "shared" });
  }
}

/** Re-render the GM's live draft (after an edit). No-op for players. */
export function refreshGM() {
  if (!game.user?.isGM) return;
  presentCurrent();
}

/* ------------------------------ GM authoring ----------------------------- */

function buildGMView(map) {
  const visible = (map.elements ?? []).filter((e) => !e.hidden);
  const ghosts = (map.elements ?? []).filter((e) => e.hidden);
  const snapshot = {
    mapId: map.id, name: map.name, w: map.w ?? MAP_W, h: map.h ?? MAP_H,
    viewMode: map.viewMode, elements: visible, rev: -1
  };
  return { snapshot, ghosts };
}

/** How many staged changes diverge from what players currently see. */
export function pendingCount() {
  const map = MapStore.activeMap();
  if (!map) return 0;
  const pub = MapStore.readPublished();
  const draftPub = MapStore.computePublished(map, pub?.rev ?? 0);
  const d = MapStore.diff(pub, draftPub);
  return d.added.length + d.removed.length + d.moved.length + d.changed.length;
}

/** Activate a map: everyone's viewer opens and shows it (silent baseline). */
export async function activate(mapId) {
  if (!game.user?.isGM) return;
  await MapStore.setActiveMap(mapId);
  const snap = await MapStore.publishActive();
  state.lastRev = snap?.rev ?? 0;
  Net.emitActivate(true);
  await openViewer();
  getStudio()?.refresh?.();
}

export async function deactivate() {
  if (!game.user?.isGM) return;
  await MapStore.setActiveMap(null);
  await MapStore.clearPublished();
  Net.emitActivate(false);
  closeViewer();
  getStudio()?.refresh?.();
}

/** Publish the active map's draft to players — silently or as a broadcast. */
export async function push(mode = "silent") {
  if (!game.user?.isGM) return;
  const snap = await MapStore.publishActive();
  if (!snap) return;
  state.lastRev = snap.rev;
  Net.emitPublished(mode, snap.rev);
  refreshGM(); // clears the pending pill; GM keeps editing the draft
  const key = mode === "broadcast" ? "GLMM.notify.broadcast" : "GLMM.notify.silent";
  ui.notifications?.info(game.i18n.localize(key));
}

/** GM dragged a marker in the floating window → stage it on the draft. */
export async function stageMarkerMove(elId, x, y) {
  const map = MapStore.activeMap();
  if (!map || !game.user?.isGM) return;
  await MapStore.updateElement(map.id, elId, { x, y });
  refreshGM();
  getStudio()?.refresh?.();
}

/* --------------------------------- pings --------------------------------- */

function localPingAndEmit(x, y) {
  const now = Date.now();
  if (now - state.lastPingAt < PING_COOLDOWN_MS) return;
  state.lastPingAt = now;
  showPing(x, y, game.user?.id);
  Net.emitPing(x, y);
}

function userColor(userId) {
  const u = game.users?.get(userId);
  if (!u) return "#5eeaff";
  return u.color?.css ?? (typeof u.color === "string" ? u.color : "#5eeaff");
}

function showPing(x, y, userId) {
  const v = state.viewer;
  if (!v?.rendered) return;
  v.ping(x, y, { color: userColor(userId), name: game.users?.get(userId)?.name ?? "" });
}

/* ------------------------------ draw attention --------------------------- */

export function drawAttention(x, y) {
  if (!game.user?.isGM) return;
  showAttention(x, y, game.user.id, "#ffd24a", { expand: false });
  Net.emitAttention(x, y, "#ffd24a");
}

function showAttention(x, y, userId, color, { expand } = {}) {
  const v = state.viewer;
  if (!v) return;
  v.attention(x, y, { color: color || "#ffd24a", expand });
}

/* ----------------------------- shared viewport --------------------------- */

function onGmViewport(pan, zoom) {
  if (!game.user?.isGM) return;
  const map = MapStore.activeMap();
  if (map?.viewMode !== "shared") return;
  const now = Date.now();
  if (now - state.vpThrottle < 90) return;
  state.vpThrottle = now;
  Net.emitViewport(pan, zoom, state.lastRev);
}

/* ----------------------------- socket dispatch --------------------------- */

function dispatch(msg, senderId) {
  if (!msg?.type) return;
  switch (msg.type) {
    case MSG.ping:
      showPing(msg.x, msg.y, msg.userId);
      break;
    case MSG.attention:
      onAttentionMsg(msg);
      break;
    case MSG.published:
      onPublishedMsg(msg);
      break;
    case MSG.viewport:
      onViewportMsg(msg);
      break;
    case MSG.activate:
      onActivateMsg(msg);
      break;
    case MSG.requestSync:
      if (game.user?.isGM && MapStore.activeMap()) Net.emitPublished("silent", state.lastRev);
      break;
  }
}

async function onPublishedMsg(msg) {
  if (game.user?.isGM) return; // GM already applied its own push locally
  const snap = MapStore.readPublished();
  if (!snap) return;
  if ((snap.rev ?? 0) <= state.lastRev) return;
  state.lastRev = snap.rev;
  if (msg.mode === "broadcast") {
    const v = ensureViewer();
    await v.ensureRendered();
    v.applyPublished(snap, "broadcast");
  } else if (state.viewer?.rendered) {
    state.viewer.applyPublished(snap, "silent");
  }
}

async function onAttentionMsg(msg) {
  // A spotlight should reach a player even if they closed their viewer.
  if (!game.user?.isGM) {
    const v = ensureViewer();
    await v.ensureRendered();
    if (!v._displayed) presentCurrent();
  }
  showAttention(msg.x, msg.y, msg.userId, msg.color, { expand: true });
}

function onViewportMsg(msg) {
  if (game.user?.isGM) return;
  const snap = MapStore.readPublished();
  if (snap?.viewMode !== "shared") return;
  state.viewer?.followViewport?.(msg.pan, msg.zoom);
}

async function onActivateMsg(msg) {
  if (game.user?.isGM) return;
  if (msg.open) {
    const snap = MapStore.readPublished();
    if (snap) state.lastRev = snap.rev ?? state.lastRev;
    await openViewer();
  } else {
    closeViewer();
  }
}

/* -------------------------------- studio --------------------------------- */

export async function openStudio() {
  if (!game.user?.isGM) return;
  const existing = getStudio();
  if (existing) { existing.render(true); existing.bringToFront?.(); return existing; }
  const { MapStudio } = await import("./studio.mjs");
  const studio = new MapStudio(); // defaults its callbacks to these controller actions
  await studio.render(true);
  return studio;
}

/** Exposed on the suite api for macros/power users. */
export const api = {
  openStudio,
  toggleViewer,
  openViewer,
  closeViewer,
  activate,
  deactivate,
  push,
  get store() { return MapStore; }
};
