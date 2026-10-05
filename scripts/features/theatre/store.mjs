/**
 * Theatre — the store. The one road the GM UI takes to the world.
 *
 * It owns no truth: every read is normalised straight off the Scene document,
 * so what a getter returns after an `await` is what the server accepted, never
 * an assembly of the `updateScene` diff (whose shape for dotted keys is not the
 * shape the document ends up with).
 *
 * Every write is ONE scene.update and every value in it is a FORCED replacement
 * (v14 `ForcedReplacement`, v13 `==key`): Foundry merges a nested update, so a
 * shot that lost a field or a config key the GM cleared would otherwise keep the
 * old value forever. Only a GM writes; a player's call resolves to null/false.
 *
 * A cue is a write of `th.state` stamped `at = serverTime + TIMING.cueLead`, so
 * every client starts it together on its own clock. When Stage is running and
 * the shot carries a grade, the same update writes Stage's grade fragment and
 * carries the relight timing as an update OPTION, so the relight lands behind
 * the black (or at the wipe's midpoint) on every client.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { motionScale } from "../../core/theme.mjs";
import { DEFAULT_FACE, DEFAULT_SHAKE, FACES, FLAGS, SETTINGS, TIMING } from "./constants.mjs";
import {
  hasTitle, newFolderId, newShotId, normalizeConfig, normalizeFolder, normalizeFolders, normalizeShot, normalizeShots,
  normalizeState, orderShots, resolveHold, resolveLetterbox, resolveStyle, titleOf,
} from "./model.mjs";
import { scaleTimeline, timelineFor } from "./timeline.mjs";
import { currentGrade, gradeFragment, sampleGrade, stageEnabled, tweenOptions } from "./stage-bridge.mjs";

/** Fired as Hooks.callAll(HOOK_CHANGED, store|null, detail) on every change the viewed scene's Theatre data goes through. */
export const HOOK_CHANGED = "gluniverse.theatre.changed";

const FLAG_ROOT = `flags.${SUITE_ID}`;
export const PATHS = Object.freeze({
  enabled: `${FLAG_ROOT}.${FLAGS.enabled}`,
  shots: `${FLAG_ROOT}.${FLAGS.shots}`,
  folders: `${FLAG_ROOT}.${FLAGS.folders}`,
  config: `${FLAG_ROOT}.${FLAGS.config}`,
  state: `${FLAG_ROOT}.${FLAGS.state}`,
  restore: `${FLAG_ROOT}.${FLAGS.restore}`,
});

/* ── Update builders ────────────────────────────────────────────────────── */

const operators = () => globalThis.foundry?.data?.operators ?? null;

/** Force-replace the value at a dotted path (exactly hexcrawl/store.mjs's rule). */
export function forceSet(upd, path, value) {
  const O = operators();
  if (O?.ForcedReplacement) { upd[path] = O.ForcedReplacement.create(value); return upd; }
  const i = path.lastIndexOf(".");
  upd[`${path.slice(0, i)}.==${path.slice(i + 1)}`] = value;
  return upd;
}

/** Delete the key at a dotted path. */
export function forceDelete(upd, path) {
  const O = operators();
  if (O?.ForcedDeletion) { upd[path] = new O.ForcedDeletion(); return upd; }
  const i = path.lastIndexOf(".");
  upd[`${path.slice(0, i)}.-=${path.slice(i + 1)}`] = null;
  return upd;
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

export const isTheatreScene = (scene) => !!scene?.getFlag?.(SUITE_ID, FLAGS.enabled);

export const readShots = (scene) => normalizeShots(scene?.getFlag?.(SUITE_ID, FLAGS.shots));
export const readFolders = (scene) => normalizeFolders(scene?.getFlag?.(SUITE_ID, FLAGS.folders));
export const readConfig = (scene) => normalizeConfig(scene?.getFlag?.(SUITE_ID, FLAGS.config));
export const readState = (scene) => normalizeState(scene?.getFlag?.(SUITE_ID, FLAGS.state));

/** Plain-object flatten (Foundry's own is used when present). */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** Did an updateScene change touch any th.* flag? (on the flattened diff) */
export function touchedKeys(changes) {
  const out = { enabled: false, shots: false, folders: false, config: false, state: false, restore: false, any: false };
  if (!changes) return out;
  const flat = globalThis.foundry?.utils?.flattenObject?.(changes) ?? flatten(changes);
  const strip = (k) => k.replace(/(^|\.)(==|-=)/g, "$1");
  for (const raw of Object.keys(flat)) {
    const k = strip(raw);
    if (k === `${FLAG_ROOT}.th` || k === FLAG_ROOT) { for (const key of Object.keys(out)) out[key] = true; break; }
    for (const key of ["enabled", "shots", "folders", "config", "state", "restore"]) {
      if (k === PATHS[key] || k.startsWith(`${PATHS[key]}.`)) { out[key] = true; out.any = true; }
    }
  }
  return out;
}

const chatOnCut = () => {
  try { return !!game.settings.get(SUITE_ID, SETTINGS.chatOnCut); } catch { return false; }
};

/** The GM's default title typeface (world setting): what a scene that picks none of its own uses. */
export function defaultFace() {
  try {
    const v = game.settings.get(SUITE_ID, SETTINGS.defaultFace);
    return Object.hasOwn(FACES, v) ? v : DEFAULT_FACE;
  } catch { return DEFAULT_FACE; }
}

/** The GM's default camera shake strength, 0..1 (the world setting is per cent). */
export function defaultShake() {
  try {
    const v = Number(game.settings.get(SUITE_ID, SETTINGS.defaultShake));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : DEFAULT_SHAKE;
  } catch { return DEFAULT_SHAKE; }
}

/* ── The store ──────────────────────────────────────────────────────────── */

let _cached = null;

export class TheatreStore {
  /** The store for canvas.scene when it is a Theatre scene, else null. */
  static get current() {
    const scene = globalThis.canvas?.scene ?? null;
    if (!scene || !isTheatreScene(scene)) return null;
    if (_cached?.scene !== scene) _cached = new TheatreStore(scene);
    return _cached;
  }

  /** A store for any scene (the GM editing a scene that is not on the canvas). */
  static for(scene) {
    if (!scene) return null;
    if (_cached?.scene === scene) return _cached;
    return new TheatreStore(scene);
  }

  constructor(scene) {
    this.scene = scene;
    this._queue = Promise.resolve();
  }

  /* ── Reading (always off the document) ── */

  get isGM() { return !!globalThis.game?.user?.isGM; }
  get enabled() { return isTheatreScene(this.scene); }
  /** The shots in play order (folder order, then unfiled). Every index the store speaks is into this list. */
  get shots() { return orderShots(readShots(this.scene), this.folders); }
  get folders() { return readFolders(this.scene); }
  folder(id) { return id ? this.folders.find((f) => f.id === id) ?? null : null; }
  get config() { return readConfig(this.scene); }
  /** The scene's title typeface: its own, else the GM's default. */
  get face() { return this.config.face ?? defaultFace(); }
  get state() { return readState(this.scene); }

  shot(id) { return id ? this.shots.find((s) => s.id === id) ?? null : null; }
  indexOf(id) { return id ? this.shots.findIndex((s) => s.id === id) : -1; }

  /** The shot on screen; under a black cue, the shot the black is hiding. */
  get currentShotId() {
    const st = this.state;
    return st.shotId ?? (st.cue?.kind === "black" ? st.cue.shotId : null);
  }
  get currentShot() { return this.shot(this.currentShotId); }
  get isBlack() { return this.state.shotId === null && !!this.state.cue && this.state.cue.kind === "black"; }

  /* ── Writing ── */

  /**
   * Serialise writes: two quick PageDowns must each read the state the other
   * wrote, or both compute the same next shot and the same seq.
   */
  _write(fn) {
    if (!this.isGM) return Promise.resolve(null);
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run.catch((e) => { warn("theatre | write failed", e); throw e; });
  }

  /**
   * Write the shot list in play order. With `folders`, the folder list is
   * written in the same update and the shots are ordered (and orphaned shots
   * unfiled) against it.
   */
  async _writeShots(shots, folders = null) {
    const upd = {};
    const list = folders ? normalizeFolders(folders) : this.folders;
    forceSet(upd, PATHS.shots, orderShots(normalizeShots(shots), list));
    if (folders) forceSet(upd, PATHS.folders, list);
    await this.scene.update(upd);
  }

  /** A folder id that exists in this scene, else null (unfiled). */
  _folderOrNull(id) {
    return typeof id === "string" && this.folders.some((f) => f.id === id) ? id : null;
  }

  /**
   * Add shots (partial objects) at `at` (default: the end of their folder).
   * `folder` files every new shot that does not name its own. Returns the new ids.
   */
  addShots(partialShots, { at = null, folder = undefined } = {}) {
    return this._write(async () => {
      const list = (Array.isArray(partialShots) ? partialShots : [partialShots]).filter(Boolean);
      if (!list.length) return [];
      const sampling = stageEnabled();
      const fresh = await Promise.all(list.map(async (p) => {
        const shot = normalizeShot({ ...p, id: newShotId() });
        shot.folder = this._folderOrNull("folder" in p ? p.folder : folder);
        if (sampling && shot.src && !shot.grade && !("grade" in p)) shot.grade = await sampleGrade(shot.src);
        return shot;
      }));
      const shots = this.shots;
      const index = Number.isInteger(at) ? Math.max(0, Math.min(shots.length, at)) : shots.length;
      shots.splice(index, 0, ...fresh);
      await this._writeShots(shots);
      return fresh.map((s) => s.id);
    });
  }

  /** Deep-merge `patch` into a shot and write the whole list back. `grade` is replaced, never merged. */
  updateShot(id, patch = {}) {
    return this._write(async () => {
      const shots = this.shots;
      const i = shots.findIndex((s) => s.id === id);
      if (i < 0) return false;
      const { grade, id: _ignored, ...rest } = patch ?? {};
      const merged = foundry.utils.mergeObject(foundry.utils.deepClone(shots[i]), rest, { inplace: false, insertKeys: true, insertValues: true });
      if ("grade" in (patch ?? {})) merged.grade = grade ?? null;
      merged.id = id;
      shots[i] = normalizeShot(merged, i);
      await this._writeShots(shots);
      return true;
    });
  }

  removeShot(id) {
    return this._write(async () => {
      const shots = this.shots;
      const next = shots.filter((s) => s.id !== id);
      if (next.length === shots.length) return false;
      await this._writeShots(next);
      return true;
    });
  }

  /**
   * Move a shot to `toIndex` in the play order (after it is lifted out). With
   * `folder` (an id, or null for unfiled) it is refiled too; a null `toIndex`
   * puts it at the end of its (new) folder.
   */
  moveShot(id, toIndex, { folder = undefined } = {}) {
    return this._write(async () => {
      const shots = this.shots;
      const from = shots.findIndex((s) => s.id === id);
      if (from < 0) return false;
      const [shot] = shots.splice(from, 1);
      const refile = folder !== undefined && this._folderOrNull(folder) !== shot.folder;
      if (folder !== undefined) shot.folder = this._folderOrNull(folder);
      const to = toIndex == null ? shots.length : Math.max(0, Math.min(shots.length, Math.trunc(Number(toIndex)) || 0));
      shots.splice(to, 0, shot);
      if (to === from && !refile) return true;
      await this._writeShots(shots);
      return true;
    });
  }

  /* ── Folders ── */

  /** Add a folder at the end (or at `at`). `shotIds` are filed into it in the same write. Returns its id. */
  addFolder({ name = "", color = null } = {}, { at = null, shotIds = [] } = {}) {
    return this._write(async () => {
      const folders = this.folders;
      const folder = normalizeFolder({ id: newFolderId(), name, color });
      const index = Number.isInteger(at) ? Math.max(0, Math.min(folders.length, at)) : folders.length;
      folders.splice(index, 0, folder);
      const move = new Set(shotIds ?? []);
      const shots = this.shots.map((s) => (move.has(s.id) ? { ...s, folder: folder.id } : s));
      await this._writeShots(shots, folders);
      return folder.id;
    });
  }

  /** Rename / recolour a folder. */
  updateFolder(id, patch = {}) {
    return this._write(async () => {
      const folders = this.folders;
      const i = folders.findIndex((f) => f.id === id);
      if (i < 0) return false;
      folders[i] = normalizeFolder({ ...folders[i], ...(patch ?? {}), id }, i);
      const upd = {};
      forceSet(upd, PATHS.folders, normalizeFolders(folders));
      await this.scene.update(upd);
      return true;
    });
  }

  /** Delete a folder. Its shots are kept and become unfiled, in the same write. */
  removeFolder(id) {
    return this._write(async () => {
      const folders = this.folders;
      const next = folders.filter((f) => f.id !== id);
      if (next.length === folders.length) return false;
      await this._writeShots(this.shots, next);
      return true;
    });
  }

  /** Move a folder (and so its shots' place in the play order) to `toIndex` in the folder list. */
  moveFolder(id, toIndex) {
    return this._write(async () => {
      const folders = this.folders;
      const from = folders.findIndex((f) => f.id === id);
      if (from < 0) return false;
      const [folder] = folders.splice(from, 1);
      const to = Math.max(0, Math.min(folders.length, Math.trunc(Number(toIndex)) || 0));
      folders.splice(to, 0, folder);
      if (to === from) return true;
      await this._writeShots(this.shots, folders);
      return true;
    });
  }

  /** Copy a shot in after itself. Returns the copy's id. */
  duplicateShot(id) {
    return this._write(async () => {
      const shots = this.shots;
      const i = shots.findIndex((s) => s.id === id);
      if (i < 0) return null;
      const copy = { ...foundry.utils.deepClone(shots[i]), id: newShotId() };
      shots.splice(i + 1, 0, copy);
      await this._writeShots(shots);
      return copy.id;
    });
  }

  setConfig(patch = {}) {
    return this._write(async () => {
      const upd = {};
      forceSet(upd, PATHS.config, normalizeConfig({ ...this.config, ...(patch ?? {}) }));
      await this.scene.update(upd);
      return true;
    });
  }

  /* ── Cues ── */

  /**
   * The one cue path. kind ∈ CUE_KINDS:
   *   shot   cut to `shotId` with `style` (default: the shot's resolved style)
   *   title  re-announce the title of `shotId` (default: the shot on screen)
   *   card   an interlude text card over black; the image does not change
   *   black  cut to black (the shot under it is remembered in cue.shotId)
   *   clear  lift the black and any title
   * Resolves the written cue, or null when refused.
   */
  cue(args = {}) {
    return this._write(() => this._cue(args));
  }

  /** The cue body, run inside the write queue. */
  async _cue({ kind = "shot", shotId = null, style = null, text = "" } = {}) {
    const shots = this.shots;
    const config = this.config;
    const prev = this.state;
    const onScreen = this.currentShotId;
    const seq = (prev.cue?.seq ?? 0) + 1;
    const at = game.time.serverTime + TIMING.cueLead;
    let state;
    let shot = null;

    switch (kind) {
      case "shot": {
        shot = shots.find((s) => s.id === shotId) ?? null;
        if (!shot) return null;
        state = { shotId: shot.id, cue: { seq, at, kind, shotId: shot.id, style: style ?? resolveStyle(shot, config), text: "" } };
        break;
      }
      case "title": {
        shot = shots.find((s) => s.id === (shotId ?? onScreen)) ?? null;
        if (!shot) return null;
        state = { shotId: prev.shotId, cue: { seq, at, kind, shotId: shot.id, style: style ?? resolveStyle(shot, config), text: "" } };
        break;
      }
      case "card":
        state = { shotId: prev.shotId, cue: { seq, at, kind, shotId: onScreen, style: "interlude", text: String(text ?? "") } };
        break;
      case "black":
        state = { shotId: null, cue: { seq, at, kind, shotId: onScreen, style: style ?? config.style, text: "" } };
        break;
      case "clear":
        state = { shotId: onScreen, cue: { seq, at, kind, shotId: onScreen, style: style ?? config.style, text: "" } };
        break;
      default:
        return null;
    }

    const normalized = normalizeState(state);
    const upd = {};
    forceSet(upd, PATHS.state, normalized);
    let options = {};

    // A cut relights the cast in the same write, timed to land behind the transition.
    if (kind === "shot" && shot?.grade) {
      const frag = gradeFragment(shot.grade);
      if (frag) {
        Object.assign(upd, frag);
        const t = scaleTimeline(timelineFor(normalized.cue.style, {
          hold: resolveHold(shot, config),
          letterbox: resolveLetterbox(shot, config),
          letters: (shot.title ?? "").length,
          title: hasTitle(shot),
        }), motionScale());
        // Pinned to the clock, not to this client's image-ready start: a client
        // whose image loads late relights before its own black. Preloading every
        // shot in the background is what keeps that rare.
        options = tweenOptions({ at, delayMs: t.relight.at, durationMs: t.relight.dur });
      }
    }

    await this.scene.update(upd, options);
    if (kind === "shot" && shot && hasTitle(shot) && chatOnCut()) postCutLine(this.scene, shot);
    return normalized.cue;
  }

  /** Cut to the next shot in order (from black: the shot after the hidden one; nothing on screen: the first). */
  next() {
    return this._write(() => {
      const shots = this.shots;
      const i = this.indexOf(this.currentShotId);
      const target = i < 0 ? shots[0] : shots[i + 1];
      return target ? this._cue({ kind: "shot", shotId: target.id }) : null;
    });
  }

  /** Cut to the previous shot in order. */
  prev() {
    return this._write(() => {
      const shots = this.shots;
      const i = this.indexOf(this.currentShotId);
      const target = i > 0 ? shots[i - 1] : null;
      return target ? this._cue({ kind: "shot", shotId: target.id }) : null;
    });
  }

  reannounce() { return this.cue({ kind: "title" }); }
  card(text) { return this.cue({ kind: "card", text }); }
  black() { return this.cue({ kind: "black" }); }
  clear() { return this.cue({ kind: "clear" }); }

  /* ── Stage grade on a shot ── */

  /** Store the scene's grade as it is right now on the shot. */
  async captureStageGrade(id) {
    if (!this.isGM) return false;
    const grade = currentGrade(this.scene);
    if (!grade) return false;
    return this.updateShot(id, { grade });
  }

  /** Propose a fresh grade from the shot's own image. */
  async resampleStageGrade(id) {
    if (!this.isGM) return false;
    const shot = this.shot(id);
    if (!shot?.src) return false;
    const grade = await sampleGrade(shot.src);
    if (!grade) return false;
    return this.updateShot(id, { grade });
  }
}

/* ── Chat line on a cut (th.chatOnCut) ──────────────────────────────────── */

function postCutLine(scene, shot) {
  const t = titleOf(shot);
  const line = (cls, v) => (v ? `<div class="glth-chat-${cls}">${escapeHTML(v)}</div>` : "");
  const content = `<div class="glth-chat-cut gl-type">${line("eyebrow", t.eyebrow)}${line("title", t.title)}${line("subtitle", t.subtitle)}</div>`;
  const data = { content, speaker: { scene: scene.id, alias: scene.navName || scene.name } };
  const styles = globalThis.CONST?.CHAT_MESSAGE_STYLES;
  if (styles?.OOC !== undefined) data.style = styles.OOC;
  Promise.resolve(globalThis.ChatMessage?.create?.(data)).catch((e) => warn("theatre | chat line failed", e));
}
