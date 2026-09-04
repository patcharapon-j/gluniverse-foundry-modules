/** PF2e AoE — Foundry lifecycle, hooks, socket beat, and public API. */

import { SUITE_ID, log } from "../../core/const.mjs";
import { emitSocket, onSocket } from "../../core/socket.mjs";
import { MOTION_SCALE, MOTION_TIER_DEFAULT, onThemeChange } from "../../core/theme.mjs";
import { FEATURE_ID, SETTINGS } from "./constants.mjs";
import { host } from "./host.mjs";
import { injectRegionStyle } from "./region-config.mjs";

const H = [];
const on = (event, fn) => H.push([event, Hooks.on(event, fn)]);
let untheme = null;
let queued = false;

const get = (key, fallback) => {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
};

function options() {
  const tier = get(SETTINGS.motionTier, MOTION_TIER_DEFAULT);
  const max = Number(get(SETTINGS.maxConcurrent, 24));
  return {
    motionScale: MOTION_SCALE[tier] ?? MOTION_SCALE[MOTION_TIER_DEFAULT],
    maxConcurrent: Number.isFinite(max) ? Math.min(64, Math.max(1, Math.round(max))) : 24,
  };
}

export function reconfigure() {
  host.configure(options());
  host.refreshAll();
}

function refreshSoon() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; host.refreshAll(); });
}

function idCandidates(value, out = new Set(), seen = new Set(), depth = 0) {
  if (depth > 4 || value == null) return out;
  if (typeof value === "string") { out.add(value); return out; }
  if (typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) idCandidates(child, out, seen, depth + 1);
    return out;
  }
  for (const key of ["id", "_id", "messageId", "uuid"]) {
    if (typeof value[key] === "string") out.add(value[key]);
  }
  for (const key of ["message", "roll", "context", "options", "flags"]) {
    if (value[key]) idCandidates(value[key], out, seen, depth + 1);
  }
  return out;
}

function pulseForDamage(...args) {
  const ids = idCandidates(args);
  for (const entry of host.entries.values()) {
    const messageId = entry.region?.document?.flags?.pf2e?.messageId;
    if (messageId && ids.has(messageId)) entry.anim.pulse();
  }
}

function pulse(regionId, { broadcast = true } = {}) {
  const ok = host.pulse(String(regionId ?? ""));
  if (ok && broadcast) emitSocket(FEATURE_ID, { type: "pulse", regionId: String(regionId) });
  return ok;
}

export function onInit() {
  /* All hooks are ready/canvas concerns. Keeping init empty makes the feature
     completely inert when its suite toggle is off. */
}

export function onReady() {
  host.configure(options());
  onSocket(FEATURE_ID, (payload) => {
    if (payload.type === "pulse") host.pulse(payload.regionId);
  }, { validate: (payload) => payload?.type === "pulse" && typeof payload.regionId === "string" });

  on("canvasReady", () => host.attach());
  on("canvasTearDown", () => host.detach());
  on("drawRegion", (region) => host.refresh(region));
  on("refreshRegion", (region, flags = {}) => {
    /* Attached Regions receive a geometry refresh on every token animation
       frame. Rebuilding four meshes and a coverage texture there is the exact
       hot path core itself warns about; the committed Token/Region update that
       follows refreshes us once at the final position. */
    if (region?.document?.attachment?.token && (flags.refreshGeometry || flags.refreshShapes)) return;
    host.refresh(region);
  });
  on("destroyRegion", (region) => host.remove(region?.id));
  on("createRegion", refreshSoon);
  on("updateRegion", refreshSoon);
  on("deleteRegion", (document) => host.remove(document?.id, { release: true }));
  on("updateScene", refreshSoon);

  /* Token image/size/visibility changes only rebuild the lightweight edge
     overlays; Region geometry itself is unchanged. Coalescing all three hooks
     prevents one token update from rebuilding the scene three times. */
  let tokenEdgesQueued = false;
  const refreshTokenEdges = () => {
    if (tokenEdgesQueued) return;
    tokenEdgesQueued = true;
    queueMicrotask(() => { tokenEdgesQueued = false; host.refreshTokenEdges(); });
  };
  on("drawToken", refreshTokenEdges);
  on("updateToken", refreshTokenEdges);
  on("destroyToken", refreshTokenEdges);

  on("renderApplicationV2", (app, element) => injectRegionStyle(app, element));
  on("pf2e.damageRoll", pulseForDamage);
  untheme = onThemeChange(() => host.refreshAll());

  if (canvas?.ready) host.attach();
  log("pf2e-aoe | Spellglass Region renderer ready");
}

export function teardown() {
  for (const [event, id] of H.splice(0)) Hooks.off(event, id);
  untheme?.(); untheme = null;
  host.detach();
}

export const api = {
  pulse,
  reconfigure,
  teardown,
  get host() { return host; },
};
