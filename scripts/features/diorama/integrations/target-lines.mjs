/**
 * Diorama — the targeting lines, drawn again in 3D.
 *
 * `stream-targets` decides which lines this client draws (its audience rules,
 * the hand-off, a player hiding them) and announces the result after every
 * sync (`TARGETS_HOOKS.linesChanged`, `[{sourceId, targetId, color}]`). The
 * view draws exactly those and nothing else, so a line shows in 3D only where
 * it would show in 2D, in the same colour. pf2e-odds hangs its badges on the
 * same announcement, which keeps badge and line together in both views.
 *
 * The listener is wired at init and keeps the last announcement, because the
 * lines are announced when targets change, not when the view opens.
 */

import { PALETTE, hexToRgbFloat } from "../../../core/theme.mjs";
import { TARGETS_HOOKS } from "../../stream-targets/settings.js";

let _lines = [];
const _listeners = new Set();
let _wired = false;

/** 0xRRGGBB (or "#rrggbb") to 0..1 rgb, or the suite accent when unset. */
export function lineRgb(color) {
  if (Number.isFinite(color)) {
    const n = Math.max(0, Math.min(0xffffff, Math.round(color)));
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) return hexToRgbFloat(color);
  return hexToRgbFloat(PALETTE.accent);
}

/**
 * The announcement, made safe: string ids, no self-lines, no duplicates.
 * @returns {Array<{sourceId:string, targetId:string, color:number[]}>}
 */
export function sanitizeLines(pairs) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const sourceId = typeof p?.sourceId === "string" ? p.sourceId : "";
    const targetId = typeof p?.targetId === "string" ? p.targetId : "";
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const key = `${sourceId}>${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sourceId, targetId, color: lineRgb(p.color) });
  }
  return out;
}

/** The lines whose two ends are both standing on the board. */
export function linksOn(lines, tokenIds) {
  return lines.filter((l) => tokenIds.has(l.sourceId) && tokenIds.has(l.targetId));
}

export const currentLines = () => _lines;

/** @returns {() => void} unsubscribe */
export function onLinesChanged(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Called from onInit: start remembering what the line feature draws. */
export function watchTargetLines() {
  if (_wired) return;
  _wired = true;
  Hooks.on(TARGETS_HOOKS.linesChanged, (pairs) => {
    _lines = sanitizeLines(pairs);
    for (const fn of _listeners) {
      try { fn(_lines); } catch { /* a view mid-teardown */ }
    }
  });
}
