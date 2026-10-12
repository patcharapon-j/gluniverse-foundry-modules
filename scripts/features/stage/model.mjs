/**
 * Stage — the data model.
 *
 * Pure: no `game`, no `foundry`, no DOM. Everything stored by this feature is
 * read back through a normalizer here, and every normalizer is TOTAL: it takes
 * anything (a missing setting, a half-written object from an older build, a
 * hand-edited flag) and returns a complete, valid value. Foundry merges object
 * writes, so a key a value lacked would otherwise survive a write.
 *
 * Three stored values:
 *
 *   cast    world setting `stage.cast`   — the characters the GM has set up
 *   state   world setting `stage.state`  — who is on stage, where, the shot
 *   comms   world setting `stage.comms`  — the call-in stack
 *
 * The scene's light lives on the scene (`light/rig.mjs`), not here.
 */

export const FEATURE_ID = "stage";
export const DEFAULT_IMAGE = "icons/svg/mystery-man.svg";

/** The two shots. "wide" is the cast on its marks; "close" pushes in on one face. */
export const SHOTS = Object.freeze(["wide", "close"]);

/** How a shot change is played. */
export const CUTS = Object.freeze(["push", "cut"]);

/** One-shot gestures the GM can fire at a character. */
export const REACTIONS = Object.freeze(["nod", "shake", "hop", "tremble", "lean"]);

/** When a name card is drawn. */
export const NAMEPLATES = Object.freeze(["off", "close", "focus"]);

/** Where the comms stack sits, and how its cards look. */
export const COMMS_EDGES = Object.freeze(["right", "left"]);
export const COMMS_ALIGN = Object.freeze(["top", "center", "bottom"]);
export const COMMS_STYLES = Object.freeze(["holo", "radio", "clean"]);

/** Most characters on stage at once; past this the marks are too tight to read. */
export const MAX_ON_STAGE = 8;
/** Most simultaneous calls. */
export const MAX_CALLS = 6;

const DEFAULT_TINT = "#6b86d6";

/* ── primitives ─────────────────────────────────────────────────────── */

const finite = (v) => typeof v === "number" && Number.isFinite(v);
export const num = (v, lo, hi, fallback) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return finite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
export const str = (v, fallback = "", max = 512) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return (s || fallback).slice(0, max);
};
export const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
export const hex = (v, fallback) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback);
const bool = (v, fallback = false) => (typeof v === "boolean" ? v : fallback);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const id = (v) => (typeof v === "string" && ID_RE.test(v) ? v : null);

/**
 * A deterministic id for an entry that arrived without one. Deterministic so
 * every client that normalizes the same stored value derives the same id —
 * a random one would differ per client and per read.
 */
export function stableId(seed, taken = new Set()) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  let out = `c${h.toString(36)}`.slice(0, 12);
  for (let n = 2; taken.has(out); n++) out = `${out.slice(0, 10)}${n}`;
  return out;
}

/* ── the cast ───────────────────────────────────────────────────────── */

/**
 * A face point for the close-up, in image fractions: the centre of the head and
 * its height. Null = let the face locator find it.
 */
export function normalizeFace(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x = num(raw.x, 0, 1, NaN);
  const y = num(raw.y, 0, 1, NaN);
  if (!finite(x) || !finite(y)) return null;
  return { x, y, h: num(raw.h, 0.03, 0.8, 0.16) };
}

/**
 * One character.
 *
 *   height   how tall this art stands relative to the stage's figure height
 *            (the lineup calibration: a child is 0.7, an ogre 1.3)
 *   offsetX  nudge across, as a fraction of the figure's own width
 *   offsetY  nudge up, as a fraction of the figure's own height (positive = up),
 *            for art with empty space under the feet or a cropped waist
 *   mirror   the art faces the other way; the stage flips it so a character
 *            on the left looks into the scene
 *   faces    which way the art looks as drawn: "left" | "right" | "front"
 */
export function normalizeMember(raw, taken = new Set()) {
  const r = raw && typeof raw === "object" ? raw : {};
  const name = str(r.name, "New character", 120);
  const image = str(r.image, DEFAULT_IMAGE, 1024);
  return {
    id: id(r.id) && !taken.has(r.id) ? r.id : stableId(`${name}|${image}`, taken),
    name,
    title: str(r.title, "", 120),
    image,
    faces: oneOf(r.faces, ["left", "right", "front"], "front"),
    height: num(r.height, 0.3, 2, 1),
    offsetX: num(r.offsetX, -1, 1, 0),
    offsetY: num(r.offsetY, -1, 1, 0),
    face: normalizeFace(r.face),
    tint: hex(r.tint, DEFAULT_TINT),
    actorUuid: str(r.actorUuid, "", 200) || null,
  };
}

export function normalizeCast(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const taken = new Set();
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const m = normalizeMember(entry, taken);
    taken.add(m.id);
    out.push(m);
  }
  return out;
}

/**
 * The old Stage's actor library, carried across. Ids are kept so a stage or a
 * call that pointed at a character still does. Scale becomes height. The old
 * offsets were a CSS `translate(x%, y%)` on the scaled image, y down; ours are
 * fractions of the figure, y up.
 */
export function migrateLegacyCast(library) {
  const list = Array.isArray(library) ? library : [];
  return normalizeCast(list.map((a) => ({
    id: a?.id,
    name: a?.name,
    image: a?.image,
    height: num(a?.scale, 0.3, 2, 1),
    offsetX: num(a?.offsetX, -100, 100, 0) / 100,
    offsetY: -num(a?.offsetY, -100, 100, 0) / 100,
    tint: a?.commsTint,
  })));
}

/* ── the stage ──────────────────────────────────────────────────────── */

/**
 * One character standing on stage.
 *
 *   x      0 = far left mark, 1 = far right
 *   depth  0 = front row, 1 = upstage (smaller, hazier, behind)
 *   flip   turn to face the other way, on top of the cast's own facing
 */
export function normalizeMark(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const castId = id(r.id);
  if (!castId) return null;
  return {
    id: castId,
    x: num(r.x, 0, 1, 0.5),
    depth: num(r.depth, 0, 1, 0),
    flip: bool(r.flip, false),
    // Shown as a silhouette until the GM reveals them.
    masked: bool(r.masked, false),
  };
}

export const DEFAULT_STATE = Object.freeze({
  visible: false,
  shot: "wide",
  cut: "push",
  focus: null,
  close: null,
  on: [],
});

/**
 * The stage. `castIds`, when given, drops marks for characters that no longer
 * exist, and a focus or close-up on someone who is not on stage.
 */
export function normalizeState(raw, castIds = null) {
  const r = raw && typeof raw === "object" ? raw : {};
  const known = castIds ? new Set(castIds) : null;
  const seen = new Set();
  const on = [];
  for (const m of Array.isArray(r.on) ? r.on : []) {
    const mark = normalizeMark(m);
    if (!mark || seen.has(mark.id) || (known && !known.has(mark.id))) continue;
    seen.add(mark.id);
    on.push(mark);
    if (on.length >= MAX_ON_STAGE) break;
  }
  const focus = id(r.focus) && seen.has(r.focus) ? r.focus : null;
  const close = id(r.close) && seen.has(r.close) ? r.close : null;
  const shot = oneOf(r.shot, SHOTS, "wide");
  return {
    visible: bool(r.visible, false),
    // A close-up of nobody is the wide shot.
    shot: shot === "close" && !close ? "wide" : shot,
    cut: oneOf(r.cut, CUTS, "push"),
    focus,
    close,
    on,
  };
}

/**
 * Where the n-th of `count` characters stands when nobody has placed them:
 * evenly spread, the middle of the stage for one.
 */
export function autoX(index, count) {
  if (count <= 1) return 0.5;
  const spread = Math.min(1, 0.34 + count * 0.13);
  const lo = 0.5 - spread / 2;
  return lo + (spread * index) / (count - 1);
}

/** Spread every mark evenly, keeping their left-to-right order. */
export function spreadMarks(on) {
  const sorted = [...on].sort((a, b) => a.x - b.x);
  return sorted.map((m, i) => ({ ...m, x: autoX(i, sorted.length) }));
}

/**
 * The x for a newcomer: the widest gap on stage, so nobody is stepped on. An
 * empty stage puts them centre.
 */
export function openMark(on) {
  if (!on.length) return 0.5;
  const xs = [0, ...on.map((m) => m.x).sort((a, b) => a - b), 1];
  let best = 0.5;
  let gap = -1;
  for (let i = 0; i < xs.length - 1; i++) {
    // The edges count half: a gap against the wall is only half a gap.
    const edge = i === 0 || i === xs.length - 2;
    const g = (xs[i + 1] - xs[i]) * (edge ? 0.5 : 1);
    if (g > gap) {
      gap = g;
      best = edge ? (i === 0 ? xs[1] * 0.4 : xs[i] + (1 - xs[i]) * 0.6) : (xs[i] + xs[i + 1]) / 2;
    }
  }
  return num(best, 0, 1, 0.5);
}

/* ── layout settings ────────────────────────────────────────────────── */

/**
 * The world's stage geometry, in fractions of the viewport.
 *
 *   figure  how tall a height-1 character stands, of the viewport height
 *   floor   where feet meet the floor, up from the bottom edge
 *   width   how much of the viewport width the marks span
 */
export function normalizeLayout(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    figure: num(r.figure, 0.4, 1.4, 0.92),
    floor: num(r.floor, -0.5, 0.4, 0),
    width: num(r.width, 0.4, 1, 0.86),
    nameplates: oneOf(r.nameplates, NAMEPLATES, "close"),
  };
}

/* ── comms ──────────────────────────────────────────────────────────── */

export function normalizeComms(raw, castIds = null) {
  const r = raw && typeof raw === "object" ? raw : {};
  const known = castIds ? new Set(castIds) : null;
  const calls = [];
  const callIds = new Set();
  const cast = new Set();
  for (const c of Array.isArray(r.calls) ? r.calls : []) {
    const castId = id(c?.castId) ?? id(c?.actorId);
    if (!castId || cast.has(castId) || (known && !known.has(castId))) continue;
    const callId = id(c.callId) && !callIds.has(c.callId) ? c.callId : stableId(`call|${castId}`, callIds);
    callIds.add(callId);
    cast.add(castId);
    calls.push({ callId, castId });
    if (calls.length >= MAX_CALLS) break;
  }
  const speaking = id(r.speaking ?? r.speakingCall);
  return {
    visible: bool(r.visible, false) && calls.length > 0,
    calls,
    speaking: speaking && callIds.has(speaking) ? speaking : null,
  };
}

export function normalizeCommsLayout(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    edge: oneOf(r.edge, COMMS_EDGES, "right"),
    align: oneOf(r.align, COMMS_ALIGN, "center"),
    style: oneOf(r.style, COMMS_STYLES, "holo"),
    width: num(r.width, 120, 320, 188),
    inset: num(r.inset, 0, 240, 20),
    shift: num(r.shift, -40, 40, 0),
  };
}

/** The old comms state, carried across (`actorId` → `castId`, `speakingCall` → `speaking`). */
export function migrateLegacyComms(old, castIds) {
  return normalizeComms(old, castIds);
}

/**
 * The old comms layout settings, carried across. The old themes map onto the
 * new styles by intent: the sci-fi frame is the hologram, the ethereal one the
 * radio, the minimal one the clean card.
 */
export function migrateLegacyCommsLayout(old) {
  const o = old && typeof old === "object" ? old : {};
  const style = { scifi: "holo", ethereal: "radio", minimal: "clean" }[o.theme];
  const align = { centered: "center", top: "top", bottom: "bottom" }[o.valign];
  return normalizeCommsLayout({
    edge: o.edge,
    align,
    style,
    width: num(o.width, 0, 400, NaN) || undefined,
    inset: Number.isFinite(o.inset) ? o.inset : undefined,
    shift: Number.isFinite(o.top) ? o.top : undefined,
  });
}
