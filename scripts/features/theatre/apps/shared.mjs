/**
 * Theatre GM apps — shared helpers.
 *
 * Importable under plain Node: nothing here touches `game`, `foundry`, `ui`,
 * `canvas` or `Hooks` at module scope. Anything that needs Foundry reaches for
 * it when called, which is only ever from inside a rendered app.
 *
 * The apps reach the world ONLY through the store (`../store.mjs`), which is
 * loaded lazily so this folder imports without it — the store touches Foundry,
 * and a check tool importing an app must not take the tooling down with it.
 */

import { featurePath, SUITE_ID } from "../../../core/const.mjs";
import { Suite } from "../../../core/registry.mjs";
import { DEFAULT_FACE, DEFAULT_SHAKE, FACE_KEYS, FACES, FEATURE_ID, STYLES, VIDEO_RE } from "../constants.mjs";
import { titleFromFilename } from "../model.mjs";

export const tpl = (name) => featurePath(FEATURE_ID, `templates/${name}.hbs`);

/** Every template the apps render, for optional preloading. */
export const APP_TEMPLATES = Object.freeze(["filmstrip", "editor"].map(tpl));

/** Where dropped OS files are uploaded: worlds/<world id>/theatre. */
export const uploadFolder = () => `worlds/${globalThis.game?.world?.id ?? "world"}/theatre`;

/** Localize, or format when `data` is given. */
export function L(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

/* ── The store, lazily ──────────────────────────────────────────────────── */

let _storeMod = null;

/** Resolve `../store.mjs` once. Every opener awaits this before rendering. */
export async function loadStore() {
  if (!_storeMod) _storeMod = await import("../store.mjs");
  return _storeMod;
}
/** The loaded store module, or null before `loadStore()` resolved. */
export const storeModule = () => _storeMod;
/** The store for the viewed scene when it is a Theatre scene, else null. */
export const currentStore = () => _storeMod?.TheatreStore?.current ?? null;
/** The GM's default title typeface (world setting). */
export const gmFace = () => _storeMod?.defaultFace?.() ?? DEFAULT_FACE;
/** The GM's default camera shake, 0..1 (world setting). */
export const gmShake = () => _storeMod?.defaultShake?.() ?? DEFAULT_SHAKE;

/* ── The camera host, lazily (free pan is a local camera toggle, not world data) ── */

let _hostMod = null;
export async function loadHost() {
  if (!_hostMod) {
    try { _hostMod = await import("../host.mjs"); } catch (e) { console.warn("GLUniverse Suite | theatre host unavailable", e); _hostMod = {}; }
  }
  return _hostMod.host ?? null;
}
export const cameraHost = () => _hostMod?.host ?? null;

/* ── Feature gates ──────────────────────────────────────────────────────── */

/** Stage-related controls appear only while the Stage feature is running. */
export function stageEnabled() {
  try { return Suite.enabled("stage"); } catch { return false; }
}

export const suiteApi = () => globalThis.game?.modules?.get(SUITE_ID)?.api ?? null;

/* ── Choice lists (dynamic i18n families are W5's: GLTH.style/face.*) ── */

export const styleLabel = (k) => L(`GLTH.style.${k}.name`);
export const faceLabel = (k) => L(`GLTH.face.${k}`);

/**
 * Options for an override select: first "Scene default (<resolved>)" (value ""),
 * then every key. `selected` null means the default row. `defaultKey` names the
 * default row's label (the scene's, or for the scene itself the GM's).
 */
export function overrideOptions(keys, label, selected, sceneValue, defaultKey = "GLTH.editor.sceneDefault") {
  return [
    { value: "", label: L(defaultKey, { value: label(sceneValue) }), selected: selected == null },
    ...keys.map((k) => ({ value: k, label: label(k), selected: k === selected })),
  ];
}

export function plainOptions(keys, label, selected) {
  return keys.map((k) => ({ value: k, label: label(k), selected: k === selected }));
}

export const styleKeys = () => [...STYLES];
export const faceKeys = () => [...FACE_KEYS];

/** Inline style for a type specimen in a given FACES entry (data from constants, never users). */
export function faceSpecimenStyle(key) {
  const f = FACES[key];
  if (!f) return "";
  return `font-family:${f.family};font-weight:${f.weight};font-stretch:${f.stretch};letter-spacing:${f.track};text-transform:${f.upper ? "uppercase" : "none"}`;
}
export function faceSecondaryStyle(key) {
  const s = FACES[key]?.secondary;
  if (!s) return "";
  return `font-family:${s.family};font-weight:${s.weight};font-stretch:${s.stretch};font-style:${s.style};letter-spacing:${s.track};text-transform:${s.upper ? "uppercase" : "none"}`;
}

/* ── Media ──────────────────────────────────────────────────────────────── */

export const isVideoSrc = (src) => VIDEO_RE.test(String(src ?? ""));

const IMAGE_RE = /\.(apng|avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(\?.*)?$/i;

/** True when a path or filename is something a shot can show. */
export function isMediaPath(path) {
  const p = String(path ?? "");
  return IMAGE_RE.test(p) || VIDEO_RE.test(p);
}

/** True when an OS File is an image or a video a shot can show. */
export function isMediaFile(file) {
  if (!file) return false;
  if (/^(image|video)\//.test(file.type ?? "")) return true;
  return isMediaPath(file.name);
}

/** "Natural" sort: shot_2 before shot_10. */
export function naturalSort(paths) {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...paths].sort((a, b) => coll.compare(String(a), String(b)));
}

/** A partial shot for a freshly added file: title from the filename. */
export const partialFromSrc = (src) => ({ src, title: titleFromFilename(src) });

/* ── File picker / upload / browse ──────────────────────────────────────── */

const FP = () => globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/** Open Foundry's FilePicker for one image/video. Resolves the path, or null on cancel. */
export function pickFile(current = "") {
  const Picker = FP();
  if (!Picker) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const picker = new Picker({
      type: "imagevideo",
      current,
      callback: (path) => { done = true; resolve(path || null); },
    });
    // A closed picker never calls back; resolve null so the caller is not left hanging.
    const close = picker.close?.bind(picker);
    if (close) picker.close = async (...a) => { const r = await close(...a); if (!done) resolve(null); return r; };
    picker.render(true);
  });
}

/** Open the FilePicker in folder mode. Resolves { path, source, bucket } or null. */
export function pickFolder(current = "") {
  const Picker = FP();
  if (!Picker) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const picker = new Picker({
      type: "folder",
      current,
      callback: (path, fp) => {
        done = true;
        const p = fp ?? picker;
        const source = p?.activeSource ?? "data";
        const bucket = p?.sources?.[source]?.bucket ?? p?.source?.bucket ?? null;
        resolve(path ? { path, source, bucket } : null);
      },
    });
    const close = picker.close?.bind(picker);
    if (close) picker.close = async (...a) => { const r = await close(...a); if (!done) resolve(null); return r; };
    picker.render(true);
  });
}

/** Every image/video directly inside a folder, naturally sorted. */
export async function browseMedia({ path, source = "data", bucket = null }) {
  const Picker = FP();
  if (!Picker || !path) return [];
  const opts = source === "s3" && bucket ? { bucket } : {};
  const result = await Picker.browse(source, path, opts);
  return naturalSort((result?.files ?? []).filter(isMediaPath));
}

/** Upload OS files to worlds/<world>/theatre (folder created if needed). Resolves their paths. */
export async function uploadFiles(files) {
  const Picker = FP();
  const media = [...(files ?? [])].filter(isMediaFile);
  if (!Picker || !media.length) return [];
  const folder = uploadFolder();
  // createDirectory rejects when the folder exists already; that is the normal case.
  await Picker.createDirectory("data", folder).catch(() => {});
  const out = [];
  for (const file of media) {
    try {
      const res = await Picker.upload("data", folder, file, {}, { notify: false });
      const path = res?.path ?? (res?.status === "success" ? `${folder}/${file.name}` : null);
      if (path) out.push(path);
    } catch (e) {
      console.warn("GLUniverse Suite | theatre upload failed", file?.name, e);
    }
  }
  return out;
}

/* ── Drops ──────────────────────────────────────────────────────────────── */

/** Parse Foundry drag data (file browser / tile / anything with a path). */
function dragData(event) {
  const TE = globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  try {
    const d = TE?.getDragEventData?.(event);
    if (d && typeof d === "object" && Object.keys(d).length) return d;
  } catch { /* not JSON */ }
  const raw = event.dataTransfer?.getData("text/plain");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { src: raw.trim() }; }
}

/**
 * Resolve the media paths a drop carries, uploading OS files first.
 * Handles: OS files, Foundry's file-browser drag data (`{type:"Tile", texture:{src}}`),
 * a Tile document (`{type:"Tile", uuid}`), and a bare path/URL as text.
 * Never throws; an unusable drop resolves [].
 */
export async function pathsFromDrop(event) {
  const files = event.dataTransfer?.files;
  if (files?.length) {
    const media = [...files].filter(isMediaFile);
    if (!media.length) return [];
    globalThis.ui?.notifications?.info(L("GLTH.editor.uploading", { n: media.length }));
    return uploadFiles(media);
  }
  const data = dragData(event);
  if (!data) return [];
  let src = data.texture?.src ?? data.src ?? data.path ?? null;
  if (!src && data.uuid) {
    try {
      const doc = await globalThis.fromUuid(data.uuid);
      src = doc?.texture?.src ?? doc?.img ?? doc?.src ?? null;
    } catch { src = null; }
  }
  if (!src && data.data?.texture?.src) src = data.data.texture.src;
  return src && isMediaPath(src) ? [src] : [];
}

/** True when a drag carries something we might accept (cheap, for dragover). */
export function dragLooksUseful(event) {
  const types = [...(event.dataTransfer?.types ?? [])];
  return types.includes("Files") || types.includes("text/plain") || types.includes("text/uri-list");
}

/** The internal mime the apps use to reorder shots, so a reorder is never read as a file drop. */
export const SHOT_MIME = "application/x-glth-shot";
/** The internal mime the editor uses to reorder folders. */
export const FOLDER_MIME = "application/x-glth-folder";

/**
 * Where a drag over a list of items would land: the item nearest the pointer
 * along `axis` ("x" or "y"), and which half of it. Items are the visible ones
 * only, so a filtered or collapsed list still drops where the pointer is.
 * Resolves { el, side: "before" | "after" } or { el: null } for an empty list.
 */
export function dropSlot(items, pos, axis = "y") {
  let best = null, bestD = Infinity;
  for (const el of items) {
    const b = el.getBoundingClientRect();
    const lo = axis === "x" ? b.left : b.top, hi = axis === "x" ? b.right : b.bottom;
    const d = pos < lo ? lo - pos : pos > hi ? pos - hi : 0;
    if (d < bestD) { bestD = d; best = { el, side: pos < (lo + hi) / 2 ? "before" : "after" }; }
  }
  return best ?? { el: null, side: "after" };
}

/** The folder id a list item carries (`data-folder`; "" is unfiled → null). */
export const folderOf = (el) => (el?.dataset?.folder ? el.dataset.folder : null);

/** Inline style carrying a folder's colour (validated #rrggbb by the model), or "". */
export const folderStyle = (color) => (/^#[0-9a-f]{6}$/i.test(String(color ?? "")) ? `--glth-folder: ${color}` : "");

/** A folder name from an imported directory path: its last segment, as written. */
export function folderNameFromPath(path) {
  const last = String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  try { return decodeURIComponent(last).trim(); } catch { return last.trim(); }
}

/* ── Dialogs ────────────────────────────────────────────────────────────── */

export async function confirmDialog(title, content) {
  const { DialogV2 } = globalThis.foundry.applications.api;
  try {
    return !!(await DialogV2.confirm({ window: { title }, content: `<p>${content}</p>`, rejectClose: false, modal: true }));
  } catch {
    return false;
  }
}

/** Ask for an interlude card's text. Resolves the trimmed text, or null on cancel/empty. */
export async function promptCardText(initial = "") {
  const { DialogV2 } = globalThis.foundry.applications.api;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  try {
    const text = await DialogV2.prompt({
      window: { title: L("GLTH.filmstrip.cardTitle"), icon: "fa-solid fa-quote-left" },
      classes: ["glth-dialog"],
      content: `<div class="glth-card-prompt gl-type"><p>${esc(L("GLTH.filmstrip.cardHint"))}</p>
        <textarea name="text" rows="4" class="gl-field" autofocus placeholder="${esc(L("GLTH.filmstrip.cardPlaceholder"))}">${esc(initial)}</textarea></div>`,
      ok: {
        label: L("GLTH.filmstrip.cardShow"),
        icon: "fa-solid fa-play",
        callback: (event, button) => button.form.elements.text.value,
      },
      rejectClose: false,
      modal: true,
    });
    const t = typeof text === "string" ? text.trim() : "";
    return t || null;
  } catch {
    return null;
  }
}

/**
 * Ask for a folder's name and colour. Resolves { name, color } (color null =
 * the accent), or null on cancel. `initial` pre-fills an existing folder.
 */
export async function promptFolder(initial = null) {
  const { DialogV2 } = globalThis.foundry.applications.api;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const color = /^#[0-9a-f]{6}$/i.test(String(initial?.color ?? "")) ? initial.color : null;
  try {
    const out = await DialogV2.prompt({
      window: { title: L(initial ? "GLTH.folders.editTitle" : "GLTH.folders.newTitle"), icon: "fa-solid fa-folder" },
      classes: ["glth-dialog"],
      content: `<div class="glth-folder-prompt gl-type">
        <label class="glth-folder-prompt-field"><span>${esc(L("GLTH.folders.name"))}</span>
          <input type="text" name="name" class="gl-field" autofocus value="${esc(initial?.name ?? "")}" placeholder="${esc(L("GLTH.folders.namePlaceholder"))}"></label>
        <label class="glth-folder-prompt-check"><input type="checkbox" name="colorOn" ${color ? "checked" : ""}>
          <span>${esc(L("GLTH.folders.ownColor"))}</span>
          <input type="color" name="color" value="${esc(color ?? "#808080")}" aria-label="${esc(L("GLTH.folders.color"))}"></label>
      </div>`,
      ok: {
        label: L(initial ? "GLTH.folders.save" : "GLTH.folders.create"),
        icon: "fa-solid fa-check",
        callback: (event, button) => {
          const els = button.form.elements;
          return { name: String(els.name.value ?? "").trim(), color: els.colorOn.checked ? els.color.value : null };
        },
      },
      rejectClose: false,
      modal: true,
    });
    if (!out || typeof out !== "object") return null;
    return { name: out.name || L("GLTH.folders.untitled"), color: out.color };
  } catch {
    return null;
  }
}

/** Run a store write, reporting a failure instead of swallowing it. */
export async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error("GLUniverse Suite | theatre", e);
    globalThis.ui?.notifications?.error(L("GLTH.app.writeFailed", { error: e?.message ?? String(e) }));
    return undefined;
  }
}
