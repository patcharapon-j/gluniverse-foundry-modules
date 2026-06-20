import { LOCALIZATION_FALLBACKS } from "./constants.mjs";

// Pure, framework-light helpers: localization, formatting, escaping, math.

export function normalizeInitiativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.round(number * 10) / 10;
}

export function getDisposition(combatant, mystery) {
  if (mystery) return "secret";

  const disposition = combatant.token?.disposition;
  const tokenDispositions = globalThis.CONST?.TOKEN_DISPOSITIONS ?? {};

  if (disposition === tokenDispositions.FRIENDLY || disposition === 1) return "friendly";
  if (disposition === tokenDispositions.HOSTILE || disposition === -1) return "hostile";
  if (disposition === tokenDispositions.SECRET || disposition === -2) return "secret";
  return "neutral";
}

export function formatRound(round) {
  const value = Number(round) || 1;
  if (value < 100) return String(value).padStart(2, "0");
  return String(value);
}

export function formatInitiative(initiative) {
  if (initiative === null || initiative === undefined) return "--";
  const value = Number(initiative);
  if (!Number.isFinite(value)) return String(initiative);
  const rounded = normalizeInitiativeNumber(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1);
}

export function localize(key) {
  const value = game.i18n?.localize(key);
  return value && value !== key ? value : LOCALIZATION_FALLBACKS[key] ?? key;
}

export function formatLocalized(key, data = {}) {
  const value = game.i18n?.format?.(key, data);
  const template = value && value !== key ? value : LOCALIZATION_FALLBACKS[key] ?? key;
  return String(template).replace(/\{([^}]+)\}/g, (_match, field) => data[field] ?? "");
}

export function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function escapeCSSIdentifier(value) {
  const raw = String(value ?? "");
  if (globalThis.CSS?.escape) return CSS.escape(raw);
  return raw.replace(/[^a-zA-Z0-9_-]/g, match => `\\${match}`);
}
