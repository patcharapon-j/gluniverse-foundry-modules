/**
 * Theatre — scene-control tools and keybindings (GM only; nothing for players).
 *
 * Tools live in the suite's own group, gate-then-ensure, and only while the
 * viewed scene is a Theatre scene. A `button` tool fires onChange only when the
 * active tool CHANGES, so clicks are also bound directly (bindSuiteToolClicks)
 * and every action goes through a short de-duplication window, because a click
 * can arrive through both roads and toggling the filmstrip twice looks like a
 * dead button.
 *
 * The GM apps are imported lazily: they are another worker's files and a
 * missing or broken one must never take the feature's init down with it.
 *   apps/filmstrip.mjs  export function toggleFilmstrip()
 *   apps/editor.mjs     export function openEditor(shotId?)
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { bindSuiteToolClicks, ensureSuiteGroup } from "../../core/scene-controls.mjs";
import { TheatreStore } from "./store.mjs";

export const TOOL_FILMSTRIP = "glth-filmstrip";
export const TOOL_EDITOR = "glth-editor";

const DEDUPE_MS = 250;
const lastRun = new Map();
const once = (name, fn) => (...args) => {
  const now = performance.now();
  if (now - (lastRun.get(name) ?? -Infinity) < DEDUPE_MS) return;
  lastRun.set(name, now);
  Promise.resolve().then(() => fn(...args)).catch((e) => warn(`theatre | ${name} failed`, e));
};

export async function toggleFilmstrip() {
  const m = await import("./apps/filmstrip.mjs");
  return m.toggleFilmstrip?.();
}

export async function openEditor(shotId = null) {
  const m = await import("./apps/editor.mjs");
  return m.openEditor?.(shotId ?? undefined);
}

const onFilmstrip = once(TOOL_FILMSTRIP, toggleFilmstrip);
const onEditor = once(TOOL_EDITOR, () => openEditor());

export function onGetSceneControlButtons(controls) {
  if (!game.user.isGM || !TheatreStore.current) return;
  const group = ensureSuiteGroup(controls);
  if (!group) return;
  group.tools[TOOL_FILMSTRIP] = {
    name: TOOL_FILMSTRIP,
    title: "GLTH.controls.filmstrip",
    icon: "fa-solid fa-film",
    order: Object.keys(group.tools).length,
    button: true,
    visible: true,
    onChange: onFilmstrip,
  };
  group.tools[TOOL_EDITOR] = {
    name: TOOL_EDITOR,
    title: "GLTH.controls.editor",
    icon: "fa-solid fa-clapperboard",
    order: Object.keys(group.tools).length,
    button: true,
    visible: true,
    onChange: onEditor,
  };
}

export function onRenderSceneControls(_app, html) {
  if (!game.user.isGM) return;
  bindSuiteToolClicks(html, { [TOOL_FILMSTRIP]: onFilmstrip, [TOOL_EDITOR]: onEditor });
}

/**
 * GM only, and only on a Theatre scene: returning false anywhere else hands the
 * key on, so PageDown keeps whatever it means outside a Theatre scene.
 */
const BINDINGS = [
  { key: "th.next", name: "GLTH.keys.next", hint: "GLTH.keys.nextHint", editable: [{ key: "PageDown" }], run: (s) => s.next() },
  { key: "th.prev", name: "GLTH.keys.prev", hint: "GLTH.keys.prevHint", editable: [{ key: "PageUp" }], run: (s) => s.prev() },
  { key: "th.reannounce", name: "GLTH.keys.reannounce", hint: "GLTH.keys.reannounceHint", editable: [], run: (s) => s.reannounce() },
  { key: "th.black", name: "GLTH.keys.black", hint: "GLTH.keys.blackHint", editable: [], run: (s) => (s.isBlack ? s.clear() : s.black()) },
];

export function registerKeybindings() {
  for (const b of BINDINGS) {
    try {
      game.keybindings.register(SUITE_ID, b.key, {
        name: b.name,
        hint: b.hint,
        editable: b.editable,
        restricted: true,
        precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL ?? 0,
        onDown: () => {
          const store = TheatreStore.current;
          if (!game.user.isGM || !store) return false;
          Promise.resolve(b.run(store)).catch((e) => warn(`theatre | ${b.key} failed`, e));
          return true;
        },
      });
    } catch (e) {
      warn(`theatre | could not register keybinding ${b.key}`, e);
    }
  }
}
