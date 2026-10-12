/**
 * Stage — the store. The only module that reads or writes Stage's stored values.
 *
 * Every read goes through a normalizer (model.mjs, light/rig.mjs), so a missing
 * setting, an old build's half-written object or a hand-edited flag all come
 * back complete. Every write is the GM's: the world settings are GM-writable
 * only, and the scene flag rides a scene update. A player's client never calls
 * a writer; the GM panel is GM-only.
 *
 * Scene light is a FORCED replacement (v14 `ForcedReplacement`, v13 `==key`):
 * Foundry merges a nested update, so a key the new light lacked would survive.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { KEY, get, set } from "./settings.mjs";
import {
  MAX_ON_STAGE, REACTIONS, migrateLegacyCast, migrateLegacyComms, migrateLegacyCommsLayout,
  normalizeCast, normalizeComms, normalizeCommsLayout, normalizeLayout, normalizeMember, normalizeState,
  openMark, spreadMarks, stableId,
} from "./model.mjs";
import { LIGHT_FLAG, normalizeLight } from "./light/rig.mjs";
import { TWEEN_OPTION } from "./timing.mjs";

const isGM = () => !!game.user?.isGM;
const safeGet = (key, fallback) => {
  try { return get(key); } catch { return fallback; }
};

/** The full dotted path of the scene light flag. */
export const LIGHT_PATH = `flags.${SUITE_ID}.${LIGHT_FLAG}`;

/* ── reads ──────────────────────────────────────────────────────────── */

export function readCast() { return normalizeCast(safeGet(KEY.cast, [])); }
export function castIds() { return readCast().map((m) => m.id); }
export function readMember(id) { return readCast().find((m) => m.id === id) ?? null; }
export function readState() { return normalizeState(safeGet(KEY.state, {}), castIds()); }
export function readLayout() { return normalizeLayout(safeGet(KEY.layout, {})); }
export function readComms() { return normalizeComms(safeGet(KEY.comms, {}), castIds()); }
export function readCommsLayout() { return normalizeCommsLayout(safeGet(KEY.commsLayout, {})); }
export function readBreath() { return safeGet(KEY.breath, false) === true; }
export function readQuality() { return safeGet(KEY.quality, "full") === "lite" ? "lite" : "full"; }

/* ── writes: the cast ───────────────────────────────────────────────── */

function gmOnly(what) {
  if (isGM()) return true;
  warn(`stage | ${what} is the GM's`);
  return false;
}

export async function writeCast(list) {
  if (!gmOnly("the cast")) return false;
  await set(KEY.cast, normalizeCast(list));
  return true;
}

/** Add or replace one character. Returns its id. */
export async function upsertMember(raw) {
  if (!gmOnly("the cast")) return null;
  const cast = readCast();
  const i = raw?.id ? cast.findIndex((m) => m.id === raw.id) : -1;
  const taken = new Set(cast.map((m) => m.id));
  if (i >= 0) taken.delete(raw.id);
  const m = normalizeMember(i >= 0 ? { ...cast[i], ...raw } : { ...raw, id: raw?.id ?? stableId(`${raw?.name}|${raw?.image}|${Date.now()}`, taken) }, taken);
  if (i >= 0) cast[i] = m; else cast.push(m);
  await set(KEY.cast, cast);
  return m.id;
}

/** Remove a character, and take them off the stage and off the comms. */
export async function removeMember(id) {
  if (!gmOnly("the cast")) return false;
  const cast = readCast().filter((m) => m.id !== id);
  await set(KEY.cast, cast);
  const ids = cast.map((m) => m.id);
  await set(KEY.state, normalizeState(safeGet(KEY.state, {}), ids));
  await set(KEY.comms, normalizeComms(safeGet(KEY.comms, {}), ids));
  return true;
}

/* ── writes: the stage ──────────────────────────────────────────────── */

export async function writeState(next) {
  if (!gmOnly("the stage")) return false;
  await set(KEY.state, normalizeState(next, castIds()));
  return true;
}

/** Shallow patch of the stage. */
export async function patchState(patch) {
  return writeState({ ...readState(), ...patch });
}

export async function showStage(visible = true) { return patchState({ visible: !!visible }); }

/** Bring a character on at the widest gap (or at `x`/`depth` if given). */
export async function enter(id, { x, depth = 0 } = {}) {
  const s = readState();
  if (s.on.some((m) => m.id === id)) return true;
  if (s.on.length >= MAX_ON_STAGE) return false;
  const on = [...s.on, { id, x: Number.isFinite(x) ? x : openMark(s.on), depth, flip: false }];
  return writeState({ ...s, on, visible: true });
}

export async function exit(id) {
  const s = readState();
  return writeState({
    ...s,
    on: s.on.filter((m) => m.id !== id),
    focus: s.focus === id ? null : s.focus,
    close: s.close === id ? null : s.close,
  });
}

/** Everyone off; the stage stays up on its empty room. */
export async function clearStage() {
  const s = readState();
  return writeState({ ...s, on: [], focus: null, close: null, shot: "wide" });
}

/** Move a character's mark: any of { x, depth, flip }. */
export async function moveMark(id, patch) {
  const s = readState();
  return writeState({ ...s, on: s.on.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

/** Even out the marks, keeping left-to-right order. */
export async function spread() {
  const s = readState();
  return writeState({ ...s, on: spreadMarks(s.on) });
}

/** Pull focus onto one character (null: nobody). */
export async function setFocus(id) { return patchState({ focus: id ?? null }); }

/** Push in on one character (null: back to the wide shot). */
export async function closeUp(id, cut) {
  const s = readState();
  const next = id ? { ...s, shot: "close", close: id, focus: id } : { ...s, shot: "wide" };
  if (cut) next.cut = cut;
  return writeState(next);
}

/* ── writes: layout ─────────────────────────────────────────────────── */

export async function patchLayout(patch) {
  if (!gmOnly("the stage layout")) return false;
  await set(KEY.layout, normalizeLayout({ ...readLayout(), ...patch }));
  return true;
}

/* ── writes: comms ──────────────────────────────────────────────────── */

export async function writeComms(next) {
  if (!gmOnly("the comms")) return false;
  await set(KEY.comms, normalizeComms(next, castIds()));
  return true;
}

/** Open a call from a character (the comms show if they were hidden). */
export async function call(castId) {
  const c = readComms();
  if (c.calls.some((x) => x.castId === castId)) return true;
  const taken = new Set(c.calls.map((x) => x.callId));
  const callId = stableId(`call|${castId}|${Date.now()}`, taken);
  return writeComms({ ...c, visible: true, calls: [...c.calls, { callId, castId }] });
}

export async function hangUp(callId) {
  const c = readComms();
  const calls = c.calls.filter((x) => x.callId !== callId);
  return writeComms({ ...c, calls, speaking: c.speaking === callId ? null : c.speaking, visible: c.visible && calls.length > 0 });
}

export async function speak(callId) { return writeComms({ ...readComms(), speaking: callId ?? null }); }
export async function showComms(visible = true) { return writeComms({ ...readComms(), visible: !!visible }); }
export async function clearComms() { return writeComms({ visible: false, calls: [], speaking: null }); }

export async function patchCommsLayout(patch) {
  if (!gmOnly("the comms layout")) return false;
  await set(KEY.commsLayout, normalizeCommsLayout({ ...readCommsLayout(), ...patch }));
  return true;
}

/* ── the scene's light ──────────────────────────────────────────────── */

/**
 * The scene's own picture. v14 keeps it on the scene's Levels (the viewed one,
 * else the first) and deprecates `Scene#background`; v13 keeps it on the scene.
 */
export function sceneBackground(scene) {
  if (!scene) return null;
  const levels = scene.levels;
  if (levels) {
    const viewed = globalThis.canvas?.scene === scene ? globalThis.canvas?.level : null;
    const level = viewed ?? levels.contents?.[0] ?? null;
    return level?.background?.src || null;
  }
  return scene._source?.background?.src || null;
}

/** The light on a scene (always complete; a scene with none reads the defaults). */
export function readLight(scene) {
  return normalizeLight(scene?.getFlag?.(SUITE_ID, LIGHT_FLAG) ?? null);
}

/** The update-data fragment that writes `light` to a scene as a forced replacement. */
export function lightUpdateData(light) {
  const value = normalizeLight(light);
  const O = globalThis.foundry?.data?.operators;
  if (O?.ForcedReplacement) return { [LIGHT_PATH]: O.ForcedReplacement.create(value) };
  const i = LIGHT_PATH.lastIndexOf(".");
  return { [`${LIGHT_PATH.slice(0, i)}.==${LIGHT_PATH.slice(i + 1)}`]: value };
}

/**
 * The update OPTIONS that make every client land a light change at one moment
 * rather than on receipt (merge into the update carrying `lightUpdateData`).
 * `at` is server time; delay and duration are already motion-scaled.
 */
export function tweenUpdateOptions({ at, delayMs = 0, durationMs } = {}) {
  const stamp = Number.isFinite(at) ? at : game.time?.serverTime ?? Date.now();
  const opt = { at: stamp, delayMs: Math.max(Number(delayMs) || 0, 0) };
  if (Number.isFinite(durationMs)) opt.durationMs = Math.max(durationMs, 0);
  return { [TWEEN_OPTION]: opt };
}

/** Write a scene's light. With `timing`, every client relights together. */
export async function writeLight(scene, light, timing = null) {
  if (!gmOnly("the scene light") || !scene) return false;
  await scene.update(lightUpdateData(light), timing ? tweenUpdateOptions(timing) : {});
  return true;
}

/** Patch the light on a scene. */
export async function patchLight(scene, patch, timing = null) {
  return writeLight(scene, { ...readLight(scene), ...patch }, timing);
}

/* ── the gesture channel ────────────────────────────────────────────── */

/** Whether a reaction kind exists. */
export const isReaction = (kind) => REACTIONS.includes(kind);

/* ── migration ──────────────────────────────────────────────────────── */

const MIGRATION_VERSION = 1;

/**
 * Carry the old Stage's cast, comms and comms layout across, once per world.
 * The old stage state, grades and slots are not carried: they describe a stage
 * that no longer exists. GM only, idempotent, and never overwrites a cast the
 * new Stage already has.
 */
export async function migrateLegacy() {
  if (!isGM()) return;
  if (safeGet(KEY.migrated, 0) >= MIGRATION_VERSION) return;
  try {
    const legacy = safeGet(KEY.legacyLibrary, []);
    let cast = readCast();
    if (!cast.length && Array.isArray(legacy) && legacy.length) {
      cast = migrateLegacyCast(legacy);
      await set(KEY.cast, cast);
    }
    const ids = cast.map((m) => m.id);
    const oldComms = safeGet(KEY.legacyComms, {});
    if (oldComms && typeof oldComms === "object" && Array.isArray(oldComms.calls) && !readComms().calls.length) {
      await set(KEY.comms, migrateLegacyComms(oldComms, ids));
    }
    const theme = safeGet(KEY.legacyCommsTheme, "");
    if (theme) {
      await set(KEY.commsLayout, migrateLegacyCommsLayout({
        theme,
        edge: safeGet(KEY.legacyCommsEdge, ""),
        valign: safeGet(KEY.legacyCommsVAlign, ""),
        width: safeGet(KEY.legacyCommsWidth, 0),
        inset: safeGet(KEY.legacyCommsInset, 0),
        top: safeGet(KEY.legacyCommsTop, 0),
      }));
    }
    await set(KEY.migrated, MIGRATION_VERSION);
  } catch (e) {
    warn("stage | migration of the old Stage's data failed", e);
  }
}
