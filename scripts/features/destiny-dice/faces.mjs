/**
 * The face table: what each of the six faces is, read through one normalizer.
 *
 * Pure. Settings are passed in as a plain `{ [key]: value }` lookup so the check
 * and the preview drive the same code the world does.
 */

import {
  DEFAULT_FACES,
  FACE_NUMBERS,
  FATE_KINDS,
  KIND_ALIASES,
  KIND_BLANK,
  KIND_COMPLICATION,
  KIND_OPPORTUNITY,
  LEGACY_IMAGE_PATHS,
  PRESETS,
  PRESET_DEFAULT,
} from "./constants.mjs";

export const BONUS_MIN = -9;
export const BONUS_MAX = 9;

/** Stored kind → one of FATE_KINDS. Unknown values read as blank. */
export function normalizeKind(kind) {
  if (typeof kind !== "string") return KIND_BLANK;
  const aliased = KIND_ALIASES[kind] ?? kind;
  return FATE_KINDS.includes(aliased) ? aliased : KIND_BLANK;
}

/** A whole number in the range a face can print, or `fallback`. */
export function normalizeBonus(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(BONUS_MIN, Math.min(BONUS_MAX, Math.trunc(n)));
}

/** An opportunity carries no number: the bonus is a complication's, or a GM's blank. */
export function bonusFor(kind, bonus) {
  return normalizeKind(kind) === KIND_OPPORTUNITY ? 0 : normalizeBonus(bonus);
}

/** A stored image path, or "" for "follow the preset". Old shipped art reads as "". */
export function normalizeImage(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || LEGACY_IMAGE_PATHS.has(trimmed)) return "";
  return trimmed;
}

export function presetId(value) {
  return PRESETS[value] ? value : PRESET_DEFAULT;
}

export const faceKeys = (face) => ({
  kind: `dd.face${face}Kind`,
  bonus: `dd.face${face}Bonus`,
  image: `dd.face${face}Image`,
});

/**
 * One face, resolved.
 *
 * @param {number} face  1..6
 * @param {(key: string) => unknown} read  settings lookup (undefined = unset)
 */
export function resolveFace(face, read = () => undefined) {
  if (!FACE_NUMBERS.includes(face)) return null;
  const keys = faceKeys(face);
  const fallback = DEFAULT_FACES[face];
  const rawKind = read(keys.kind);
  const kind = rawKind === undefined ? fallback.kind : normalizeKind(rawKind);
  const bonus = bonusFor(kind, read(keys.bonus) ?? fallback.bonus);
  return { face, kind, bonus, image: normalizeImage(read(keys.image)) };
}

export function resolveFaces(read) {
  return FACE_NUMBERS.map((face) => resolveFace(face, read));
}

/**
 * What a face prints: the glyph the die carries and the chat strip draws.
 * Keyed so equal faces share one baked texture.
 */
export function glyphSpec(face) {
  const kind = normalizeKind(face?.kind);
  const bonus = bonusFor(kind, face?.bonus);
  if (kind === KIND_OPPORTUNITY) return { key: "opportunity", kind, mark: "star", text: "" };
  if (bonus !== 0) return { key: `${kind}${signed(bonus)}`, kind, mark: "number", text: signed(bonus) };
  if (kind === KIND_COMPLICATION) return { key: "complication", kind, mark: "bolt", text: "" };
  return { key: "blank", kind, mark: "none", text: "" };
}

export function signed(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

/**
 * The die in numbers, for the config window's footer: how many faces of each
 * kind, and the expected bonus one throw adds.
 */
export function summarize(faces) {
  const counts = Object.fromEntries(FATE_KINDS.map((k) => [k, 0]));
  let total = 0;
  for (const face of faces) {
    counts[normalizeKind(face.kind)] += 1;
    total += bonusFor(face.kind, face.bonus);
  }
  return { counts, mean: total / Math.max(1, faces.length) };
}
