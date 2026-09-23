/** PF2e AoE — Foundry lifecycle, hooks, socket beat, and public API. */

import { SUITE_ID, log } from "../../core/const.mjs";
import { emitSocket, onSocket } from "../../core/socket.mjs";
import { MOTION_SCALE, MOTION_TIER_DEFAULT, onThemeChange } from "../../core/theme.mjs";
import { FEATURE_ID, SETTINGS } from "./constants.mjs";
import { classify as classifySource } from "./classifier.mjs";
import { addSpellglassSceneControl, bindSpellglassSceneControl } from "./controls.mjs";
import { inferredLabel } from "./data.mjs";
import { migrateLegacyPresentations } from "./migration-runtime.mjs";
import { compactPresentation } from "./schema.mjs";
import { canRenderEffectRegion, host } from "./host.mjs";
import {
  registerProfile, resolveProfile as resolveSourceProfile, unregisterProfiles,
} from "./profiles.mjs";
import { injectRegionStyle, normalizeRegionPresentationUpdate } from "./region-config.mjs";
import { injectScenePresentation } from "./scene-config.mjs";

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
    quality: get(SETTINGS.quality, "auto"),
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

function resolveUuid(uuid) {
  try { return typeof fromUuidSync === "function" ? fromUuidSync(uuid) : null; }
  catch { return null; }
}

function classify(source, options = {}) {
  return classifySource(source, { resolveUuid, ...options });
}

function resolveProfile(source, options = {}) {
  const document = source?.document ?? source;
  return resolveSourceProfile(source, {
    suiteId: SUITE_ID,
    worldProfiles: get(SETTINGS.profiles, { schema: 1, profiles: [] }),
    inheritedLabel: inferredLabel(document),
    classification: { resolveUuid },
    ...options,
  });
}

async function freezePlacement(document) {
  if (!game.user?.isGM || document?.documentName !== "Region") return;
  let current = null;
  try { current = document.getFlag(SUITE_ID, "aoe.presentation"); } catch { return; }
  if (current?.snapshot || ["profile", "custom", "native"].includes(current?.mode)) return;
  const result = classify(document);
  if (result.needsClassification) return;
  const presentation = compactPresentation({
    schema: 2, mode: "auto",
    snapshot: { semantics: result.semantics, confidence: result.confidence, evidenceVersion: result.evidenceVersion },
    label: { mode: "inherit" },
  });
  try { await document.setFlag(SUITE_ID, "aoe.presentation", presentation); }
  catch { /* Region may have been deleted before the hook settled */ }
}

export function onInit() {
  /* Register controls during init so they are present the first time Foundry
     prepares the left scene-control bar. Disabled features never reach here. */
  on("getSceneControlButtons", addSpellglassSceneControl);
  on("renderSceneControls", (_app, html) => bindSpellglassSceneControl(html));
}

export async function onReady() {
  await migrateLegacyPresentations();
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
       hot path core itself warns about; the host rebuilds the mask once the
       move has been quiet for a moment. */
    if (region?.document?.attachment?.token && (flags.refreshGeometry || flags.refreshShapes)) {
      if (!host.reposition(region)) host.refresh(region);
      return;
    }
    /* Hover and control raise refreshState -> refreshVisibility only. Those
       change nothing we draw except the label's inspected state, unless the
       Region's visibility actually flipped. */
    const structural = flags.redraw || flags.refresh || flags.refreshShapes || flags.refreshGeometry
      || flags.refreshBorder || flags.refreshMeasurements;
    if (!structural && host.entries.has(region?.id) === canRenderEffectRegion(region)) {
      host.touch(region?.id);
      return;
    }
    host.refresh(region);
  });
  on("hoverRegion", (region) => host.touch(region?.id));
  on("controlRegion", (region) => host.touch(region?.id));
  on("canvasPan", () => host.onView());
  on("destroyRegion", (region) => host.remove(region?.id));
  on("createRegion", (document) => { void freezePlacement(document); refreshSoon(); });
  on("updateRegion", (document) => {
    /* A live entry refreshes in place; anything else may be joining the set
       under the concurrency cap, which is refreshAll's decision. */
    const region = document?.object;
    if (region && host.entries.has(region.id)) host.tryRefresh(region);
    else refreshSoon();
  });
  on("deleteRegion", (document) => host.remove(document?.id, { release: true }));
  on("updateScene", refreshSoon);

  /* Region geometry never depends on a Token except through an attachment,
     and attached Regions follow through refreshRegion above. So a Token change
     only reconciles that Token's PF2e auras and the edge lights near it; it
     never rebuilds a Region. refreshVisibility fires on every frame of a
     moving Token, which is why the host coalesces and filters these. */
  on("drawToken", (token) => host.markTokens([token?.id], { rebuild: true }));
  on("refreshToken", (token, flags = {}) => {
    if (flags.refreshEffects || flags.refreshVisibility) host.markTokens([token?.id]);
  });
  on("updateToken", (document) => host.markTokens([document?.id], { rebuild: true }));
  on("destroyToken", (token) => host.markTokens([token?.id]));
  /* An actor change can add, drop or resize its tokens' auras, and can change
     what an effect it cast resolves to. Nothing else on the Scene cares. */
  on("updateActor", (actor) => {
    let tokens = [];
    try { tokens = actor?.getActiveTokens?.(false, false) ?? []; } catch { tokens = []; }
    host.markTokens(tokens.map((token) => token?.id), { rebuild: true });
    const uuid = actor?.uuid;
    if (!uuid) return;
    host.refreshWhere((region) => {
      const origin = region?.document?.flags?.pf2e?.origin;
      const source = origin?.uuid ?? origin?.itemUuid;
      return origin?.actor === uuid || (typeof source === "string" && source.startsWith(`${uuid}.`));
    });
  });

  on("renderApplicationV2", (app, element) => injectRegionStyle(app, element));
  on("renderApplicationV2", (app, element) => injectScenePresentation(app, element));
  on("preUpdateRegion", normalizeRegionPresentationUpdate);
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
  classify,
  pulse,
  registerProfile,
  reconfigure,
  resolveProfile,
  teardown,
  unregisterProfiles,
  get host() { return host; },
};
