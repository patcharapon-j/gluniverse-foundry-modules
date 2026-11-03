/** Spellsprite — Foundry lifecycle, the Director's wiring and the public API. */

import { SUITE_ID } from "../../core/const.mjs";
import { Budget } from "../../core/budget.mjs";
import { FEATURE_ID, SETTINGS, SHED_ORDER } from "./constants.mjs";
import { compile } from "./compile.mjs";
import { Director } from "./director.mjs";
import { Host2D } from "./host-2d.mjs";
import { wireReader } from "./read.mjs";
import { addLookControls } from "./looks-app.mjs";

export const CHANGED_HOOK = "gluniverse.fx.changed";

const H = [];
const on = (event, fn) => H.push([event, Hooks.on(event, fn)]);

const get = (key, fallback) => {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
};

/** Live options the host reads every frame. */
const opts = {
  get(key) {
    if (key === "floor") return get(SETTINGS.floor, "auto");
    if (key === "shake") return get(SETTINGS.shake, true);
    if (key === "impactFrames") return get(SETTINGS.impactFrames, true);
    return undefined;
  },
};

let director = null;
let host = null;
let ladder = null;

/** Where a creature stands now, in squares. Null when it is not on the viewed scene. */
function locate(tokenId, sceneId) {
  if (!canvas?.ready || (sceneId && canvas.scene?.id !== sceneId)) return null;
  const token = canvas.tokens?.get(tokenId);
  if (!token) return null;
  const g = canvas.dimensions?.size ?? 100;
  /* The animated position, not the document's: a loop slides with the token. */
  const c = token.center;
  return { x: c.x / g, y: c.y / g };
}

export function reconfigure() {
  if (!director) return;
  const max = Number(get(SETTINGS.maxConcurrent, 12));
  director.maxConcurrent = Number.isFinite(max) ? Math.min(32, Math.max(1, Math.round(max))) : 12;
  host?.refreshFloor();
}

/** The public surface. Filled at ready; stable identity so the registry can expose it. */
export const api = {
  /** Play an FxSpec. Returns its key. */
  play: (spec, options) => director?.play(spec, options) ?? null,
  startLoop: (key, spec, options) => director?.startLoop(key, spec, options) ?? null,
  stopLoop: (key) => director?.stopLoop(key) ?? false,
  /** [{key, sim, sceneId}] of the effects running now, for another host (Diorama). */
  sims: (sceneId) => director?.sims(sceneId) ?? [],
  onChange: (fn) => director?.onChange(fn) ?? (() => {}),
  compile,
  hook: CHANGED_HOOK,
};

export function onInit() {
  addLookControls(on);
}

export function onReady() {
  ladder = Budget.ladder(FEATURE_ID, SHED_ORDER);
  director = new Director({
    ladder,
    locate,
    claim: (v) => Budget.claimMotion(FEATURE_ID, v),
    announce: (list) => Hooks.callAll(CHANGED_HOOK, list),
    measure: (fn) => Budget.measure("pf2e-fx:step", fn),
  });
  reconfigure();
  host = new Host2D(director, opts);
  on("canvasReady", () => host.attach());
  on("canvasTearDown", () => { host.detach(); director.clear(); });
  on("updateScene", (scene, changes) => {
    if (scene.id !== canvas.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${SUITE_ID}`) || "environment" in changes || "darkness" in changes) host.refreshFloor();
  });
  if (canvas?.ready) host.attach();
  wireReader(director);
}
