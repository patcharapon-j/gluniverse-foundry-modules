/**
 * Theatre — the data model.
 *
 * Pure. Every normaliser is TOTAL: it returns a complete object with every key
 * present whatever it is handed, because Foundry merges a flag update and a key
 * a value lacked would otherwise survive the write.
 *
 * Shot (an entry of flags[SUITE_ID].th.shots):
 * {
 *   id:        string (stable, unique within the scene),
 *   src:       path to an image or video ("" = no image yet),
 *   eyebrow:   string — act / chapter / time label above the title ("" = none),
 *   title:     string,
 *   subtitle:  string,
 *   notes:     string — GM only, never drawn for players,
 *   style:     STYLES key | null (null = the scene's default),
 *   face:      FACES key  | null (null = the scene's default),
 *   hold:      ms | null (null = the scene's default),
 *   focus:     { x: 0..1, y: 0..1 } — the point of the image kept in frame when it is cropped to cover,
 *   drift:     { mode: DRIFT_MODES, strength: 0..1 },
 *   treatment: Treatment,
 *   grade:     Stage grade object | null — the Stage character grade this shot relights to (null = leave Stage alone),
 * }
 *
 * Treatment — the backdrop's own look, separate from Stage's character grade:
 * { exposure: -2..2 (stops), saturation: 0..2 (1 = as authored), tint: "#rrggbb",
 *   tintAmount: 0..1, vignette: 0..1, blur: 0..1, letterbox: null | 0..0.2 (fraction of
 *   the frame height per bar; null = the scene's letterbox) }
 *
 * SceneConfig (flags[SUITE_ID].th.config):
 * { style: STYLES key, face: FACES key, hold: ms, letterbox: 0..0.2, tag: boolean }
 *
 * PlayState (flags[SUITE_ID].th.state):
 * { shotId: string | null  — the shot on screen (null = black),
 *   cue: Cue | null        — the last thing the GM fired }
 *
 * Cue: { seq: integer (monotonic), at: server-time ms the cue starts,
 *        kind: CUE_KINDS, shotId: string | null, style: STYLES key, text: string }
 *
 * RestoreData (flags[SUITE_ID].th.restore):
 * { background: string, width, height, padding, gridType, tokenVision, backgroundColor } | null
 */

import { DEFAULT_FACE, DEFAULT_STYLE, DRIFT_MODES, FACES, STYLES, TIMING, VIDEO_RE, CUE_KINDS } from "./constants.mjs";

const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);
const hex = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const orNull = (v, fn) => (v === null || v === undefined || v === "" ? null : fn(v));

export const DEFAULT_TREATMENT = Object.freeze({
  exposure: 0, saturation: 1, tint: "#000000", tintAmount: 0, vignette: 0.35, blur: 0, letterbox: null,
});

/** A treatment that changes nothing — the identity the renderer must skip exactly. */
export const NEUTRAL_TREATMENT = Object.freeze({
  exposure: 0, saturation: 1, tint: "#000000", tintAmount: 0, vignette: 0, blur: 0, letterbox: null,
});

export const DEFAULT_DRIFT = Object.freeze({ mode: "push", strength: 0.5 });

export const DEFAULT_CONFIG = Object.freeze({
  style: DEFAULT_STYLE, face: DEFAULT_FACE, hold: TIMING.hold, letterbox: 0, tag: false,
});

export function normalizeTreatment(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  return {
    exposure: num(t.exposure, -2, 2, DEFAULT_TREATMENT.exposure),
    saturation: num(t.saturation, 0, 2, DEFAULT_TREATMENT.saturation),
    tint: hex(t.tint, DEFAULT_TREATMENT.tint),
    tintAmount: num(t.tintAmount, 0, 1, DEFAULT_TREATMENT.tintAmount),
    vignette: num(t.vignette, 0, 1, DEFAULT_TREATMENT.vignette),
    blur: num(t.blur, 0, 1, DEFAULT_TREATMENT.blur),
    letterbox: orNull(t.letterbox, (v) => num(v, 0, 0.2, null)),
  };
}

export function isNeutralTreatment(t) {
  const n = normalizeTreatment(t);
  return n.exposure === 0 && n.saturation === 1 && n.tintAmount === 0 && n.vignette === 0 && n.blur === 0;
}

export function normalizeDrift(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return { mode: oneOf(d.mode, DRIFT_MODES, DEFAULT_DRIFT.mode), strength: num(d.strength, 0, 1, DEFAULT_DRIFT.strength) };
}

/**
 * Deterministic id for a shot that arrived without one: derived from its
 * position and source so every client mints the same id without a write.
 */
export function mintShotId(index, src = "") {
  let h = 2166136261;
  const s = `${index}|${src}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `s${(h >>> 0).toString(36)}`;
}

/** A fresh, random id for a shot the GM is adding now. */
export function newShotId() {
  return `s${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function normalizeShot(raw, index = 0) {
  const s = raw && typeof raw === "object" ? raw : {};
  const src = str(s.src).trim();
  const focus = s.focus && typeof s.focus === "object" ? s.focus : {};
  return {
    id: typeof s.id === "string" && s.id.trim() ? s.id.trim() : mintShotId(index, src),
    src,
    eyebrow: str(s.eyebrow),
    title: str(s.title),
    subtitle: str(s.subtitle),
    notes: str(s.notes),
    style: orNull(s.style, (v) => oneOf(v, STYLES, null)),
    face: orNull(s.face, (v) => (v in FACES ? v : null)),
    hold: orNull(s.hold, (v) => num(v, TIMING.holdMin, TIMING.holdMax, null)),
    focus: { x: num(focus.x, 0, 1, 0.5), y: num(focus.y, 0, 1, 0.5) },
    drift: normalizeDrift(s.drift),
    treatment: normalizeTreatment(s.treatment),
    grade: s.grade && typeof s.grade === "object" ? s.grade : null,
  };
}

/** Normalise a whole shot list; duplicate ids are re-minted deterministically. */
export function normalizeShots(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  const seen = new Set();
  return list.map((r, i) => {
    const shot = normalizeShot(r, i);
    if (seen.has(shot.id)) shot.id = mintShotId(i, `${shot.src}#dup`);
    seen.add(shot.id);
    return shot;
  });
}

export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    style: oneOf(c.style, STYLES, DEFAULT_CONFIG.style),
    face: c.face in FACES ? c.face : DEFAULT_CONFIG.face,
    hold: num(c.hold, TIMING.holdMin, TIMING.holdMax, DEFAULT_CONFIG.hold),
    letterbox: num(c.letterbox, 0, 0.2, DEFAULT_CONFIG.letterbox),
    tag: c.tag === true,
  };
}

export function normalizeCue(raw) {
  if (!raw || typeof raw !== "object") return null;
  const seq = Math.trunc(Number(raw.seq));
  const at = Number(raw.at);
  if (!Number.isFinite(seq) || !Number.isFinite(at)) return null;
  return {
    seq,
    at,
    kind: oneOf(raw.kind, CUE_KINDS, "shot"),
    shotId: typeof raw.shotId === "string" && raw.shotId ? raw.shotId : null,
    style: oneOf(raw.style, STYLES, DEFAULT_STYLE),
    text: str(raw.text),
  };
}

export function normalizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    shotId: typeof s.shotId === "string" && s.shotId ? s.shotId : null,
    cue: normalizeCue(s.cue),
  };
}

/* ── Resolution: a shot's effective values against its scene ─────────────── */

export const resolveStyle = (shot, config) => shot?.style ?? config.style;
export const resolveFace = (shot, config) => shot?.face ?? config.face;
export const resolveHold = (shot, config) => shot?.hold ?? config.hold;
export const resolveLetterbox = (shot, config) => shot?.treatment?.letterbox ?? config.letterbox;
export const isVideo = (src) => VIDEO_RE.test(String(src ?? ""));

/** Title fields a viewer is shown. GM notes are never part of it. */
export function titleOf(shot) {
  return { eyebrow: shot?.eyebrow ?? "", title: shot?.title ?? "", subtitle: shot?.subtitle ?? "" };
}

/** A title with no text at all draws nothing (the transition still plays). */
export const hasTitle = (shot) => !!(shot && (shot.eyebrow || shot.title || shot.subtitle));

/**
 * Default title for a shot imported from a file: the filename, de-slugged.
 * "the-drowned-chapel_02.webp" → "The Drowned Chapel".
 */
export function titleFromFilename(path) {
  const base = String(path ?? "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  return decodeURIComponent(base)
    .replace(/[_-]+/g, " ")
    .replace(/\s*\d+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Cover-fit an image of (iw × ih) into a frame (fw × fh), keeping `focus`
 * (0..1 in image space) as close to the frame centre as the crop allows.
 * Returns the image's placement in frame coordinates.
 */
export function coverRect(iw, ih, fw, fh, focus = { x: 0.5, y: 0.5 }) {
  if (!(iw > 0 && ih > 0 && fw > 0 && fh > 0)) return { x: 0, y: 0, width: fw, height: fh, scale: 1 };
  const scale = Math.max(fw / iw, fh / ih);
  const w = iw * scale, h = ih * scale;
  const x = Math.min(0, Math.max(fw - w, fw / 2 - focus.x * w));
  const y = Math.min(0, Math.max(fh - h, fh / 2 - focus.y * h));
  return { x, y, width: w, height: h, scale };
}
