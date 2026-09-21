/**
 * Hexcrawl — runtime label helpers shared by the tooltip, the arrival card and
 * the host. Runtime only (reads game.i18n); never imported by the renderer.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { BUILTIN_TERRAINS, MASK_PRESETS, RATING_NAMES, SETTINGS, SIGHT_PRESET } from "./constants.mjs";

export const L = (key) => game.i18n.localize(key);
export const F = (key, data) => game.i18n.format(key, data);

export function setting(key, fallback) {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
}

/** Localized terrain name: a custom terrain's own name, else GLHEX.terrain.<id>. */
export function terrainName(map, id) {
  if (!id) return L("GLHEX.tooltip.blank");
  const custom = map?.terrains?.[id];
  if (custom?.name) return custom.name;
  if (Object.hasOwn(BUILTIN_TERRAINS, id)) return L(`GLHEX.terrain.${id}`);
  return id;
}

/** A mask preset's display name: the GM's own, else the seed's GLHEX.mask.<id>, else the id. */
export function presetName(map, id) {
  if (!id || id === SIGHT_PRESET) return L("GLHEX.mask.sight");
  const own = map?.presets?.[id]?.name;
  if (own) return own;
  return Object.hasOwn(MASK_PRESETS, id) ? L(`GLHEX.mask.${id}`) : id;
}

export const ratingName = (n) => (RATING_NAMES[n] ? L(`GLHEX.rating.${n}`) : "");

/** "3 days" — amount in the scene's configured unit. */
export function costLabel(config, amount) {
  const n = Number(amount) || 0;
  const unit = config?.cost?.unit ?? "days";
  return F("GLHEX.card.cost", { n: Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, ""), unit: L(`GLHEX.unitCount.${unit}.${n === 1 ? "one" : "other"}`) });
}

/** A duration in seconds as the scene's unit (for leg totals). */
export function secondsLabel(config, seconds) {
  const unit = config?.cost?.unit ?? "days";
  const per = unit === "watches" ? config.cost.watchHours * 3600
    : { minutes: 60, hours: 3600, days: 86400 }[unit] ?? 86400;
  return costLabel(config, (Number(seconds) || 0) / per);
}

export const tooltipDelay = () => Math.max(0, Number(setting(SETTINGS.tooltipDelay, 350)) || 0);
