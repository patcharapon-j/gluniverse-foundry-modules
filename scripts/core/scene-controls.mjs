/**
 * GLUniverse Suite — shared scene-control grouping.
 *
 * Foundry models the left scene-control bar as a record of control *groups*, each
 * with its own `tools` map. Historically every suite feature injected its tools
 * straight into Foundry's built-in **Token Controls** group, cluttering the core
 * token tools. This module gives the suite ONE dedicated top-level group
 * (`controls.gluniverse`) that all features contribute to instead.
 *
 * Usage from a feature's `getSceneControlButtons` handler — gate first, then ensure,
 * so the group is only created when there is actually a tool to show:
 *
 *   import { ensureSuiteGroup } from "../../core/scene-controls.mjs";
 *   if (game.user.isGM) {
 *     const group = ensureSuiteGroup(controls);
 *     group.tools["my-tool"] = { name: "my-tool", title: "…", icon: "…", button: true, onChange };
 *   }
 *
 * No import-time side effects (constitution Principle III): this module only acts
 * when its functions are called from within a hook.
 */

/** Key the suite's top-level control group lives under in the `controls` record. */
export const SUITE_GROUP_KEY = "gluniverse";

/** Recommended order slot for the suite group within the left bar. */
const SUITE_GROUP_ORDER = 100;

/**
 * Idempotently create and return the suite's top-level scene-control group.
 *
 * The first feature to call this (in a given hook pass) creates the group; every
 * later call returns the same object so tools from all features merge into one
 * group. Never touches `controls.tokens`.
 *
 * @param {Record<string, object>} controls  The record Foundry passes to
 *   `getSceneControlButtons` (keyed by group name in v13+).
 * @returns {object} The suite group; add tools via `group.tools[name] = {…}`.
 */
export function ensureSuiteGroup(controls) {
  if (!controls || typeof controls !== "object") return null;

  let group = controls[SUITE_GROUP_KEY];
  if (!group) {
    group = controls[SUITE_GROUP_KEY] = {
      name: SUITE_GROUP_KEY,
      title: "GLS.controls.suiteGroup",
      // All suite tools are momentary buttons (toggle a HUD / open a dialog); the
      // group owns no canvas layer of its own.
      icon: "fa-solid fa-meteor",
      order: SUITE_GROUP_ORDER,
      visible: true,
      tools: {}
    };
  }
  if (!group.tools || typeof group.tools !== "object") group.tools = {};
  return group;
}

/**
 * Remove the suite group if it ended a hook pass with no tools. Safety net for any
 * feature that calls {@link ensureSuiteGroup} before deciding it has nothing to
 * show; with the gate-then-ensure pattern this is usually a no-op.
 *
 * @param {Record<string, object>} controls
 */
export function pruneEmptySuiteGroup(controls) {
  const group = controls?.[SUITE_GROUP_KEY];
  if (group && (!group.tools || Object.keys(group.tools).length === 0)) {
    delete controls[SUITE_GROUP_KEY];
  }
}

/**
 * Guarantee that `button` scene-control tools fire their action on every click. A
 * `button` tool resolves via `onChange`, but that only fires when the active tool
 * *changes* — so a sticky button can swallow repeat clicks. Binding the click on the
 * rendered node makes each click invoke the tool's handler directly.
 *
 * Idempotent: each node is bound once (guarded by a dataset flag), so calling this
 * on every `renderSceneControls` never stacks duplicate listeners.
 *
 * @param {HTMLElement|JQuery} html  The `renderSceneControls` html.
 * @param {Record<string, () => void>} handlers  Map of tool `name` → action to run
 *   on click (the same callback the tool's `onChange` invokes).
 */
export function bindSuiteToolClicks(html, handlers) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || !handlers || typeof handlers !== "object") return;
  for (const [name, action] of Object.entries(handlers)) {
    if (typeof action !== "function") continue;
    const node = root.querySelector(`[data-tool="${name}"]`);
    if (!node || node.dataset.glSuiteBound) continue;
    node.dataset.glSuiteBound = "true";
    node.addEventListener("click", () => action());
  }
}
