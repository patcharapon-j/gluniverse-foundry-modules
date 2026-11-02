/**
 * Diorama view — small shared helpers. Nothing here runs at import.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { CLASSES as STREAM_CLASSES } from "../../stream/constants.js";

/** Localise at call time: `t(key)` / `t(key, data)`. The readouts take this too. */
export function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

/** Read a suite setting, never throwing. */
export function setting(key, fallback) {
  try {
    const v = game.settings.get(SUITE_ID, key);
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export async function setSetting(key, value) {
  try { await game.settings.set(SUITE_ID, key, value); } catch (e) { console.error(e); }
}

export const isGM = () => !!globalThis.game?.user?.isGM;

/**
 * This client is the stream capture in stream mode. The stream camera then owns
 * the shot (CLAUDE.md: "the stream camera is the only thing that may move the
 * capture client's view"), so the 3D camera follows it and nothing of ours
 * moves it, and nothing of ours draws chrome over the broadcast.
 */
export const streamOwnsView = () => !!globalThis.document?.body?.classList?.contains(STREAM_CLASSES.active);

/** Build an element: `el("div", {class: "x", title: "y"}, [children])`. */
export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}

/** True when keyboard focus is in something that takes typing. */
export function typingTarget(ev) {
  const t = ev?.target;
  if (!t || !(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/**
 * The keys a suite keybinding is bound to right now, as Foundry prints them
 * ("Shift + V"), joined with " / "; "" when it is unbound. Read at call time,
 * so a rebinding shows up the next time a tooltip is built.
 * @param {string} action  e.g. "dio.toggle"
 */
export function keyHint(action) {
  try {
    const binds = globalThis.game?.keybindings?.get?.(SUITE_ID, action) ?? [];
    const human = globalThis.foundry?.applications?.sidebar?.apps?.ControlsConfig?.humanizeBinding;
    return binds.map((b) => (typeof human === "function" ? human(b) : b.key)).filter(Boolean).join(" / ");
  } catch {
    return "";
  }
}

/** A Foundry user's colour as a CSS string. */
export function userColor(u) {
  const c = u?.color;
  if (!c) return null;
  return typeof c === "string" ? c : (c.css ?? String(c));
}
