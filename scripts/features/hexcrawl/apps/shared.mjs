/**
 * Hexcrawl GM apps — shared helpers.
 *
 * Importable anywhere: nothing here touches `game`, `foundry` or `ui` at module
 * scope. Functions that need Foundry reach for it when they are called, which is
 * only ever from inside a rendered app.
 */

import { featurePath } from "../../../core/const.mjs";
import { escapeHTML } from "../../../core/util.mjs";
import {
  BUILTIN_TERRAIN_IDS, BUILTIN_TERRAINS, FEATURE_ID, MASK_PRESETS, RATING_MAX, RATING_MIN, SIGHT_PRESET,
} from "../constants.mjs";
import { glyphSvgPath } from "../glyphs.mjs";

export const tpl = (name) => featurePath(FEATURE_ID, `templates/${name}.hbs`);

/** Every template the apps render, for optional preloading. */
export const APP_TEMPLATES = Object.freeze([
  "palette", "hex-editor", "region-editor", "scene-settings", "terrain-manager", "icon-picker",
].map(tpl));

/** The viewed-scene hook the runtime fires (`HexStore.current` changed). */
export const STORE_HOOK = "glhex.storeChanged";

/** Localize, or format when `data` is given. Falls back to the key's tail. */
export function L(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

/** Display name for a terrain id: custom name, localized built-in, or "". */
export function terrainLabel(map, id) {
  if (!id) return "";
  const c = map?.terrains?.[id];
  if (c) return c.name || id;
  if (BUILTIN_TERRAINS[id]) return L(`GLHEX.terrain.${id}`);
  return id;
}

/** A mask preset's display name: the GM's own, else the seed's GLHEX.mask.<id>, else the id. */
export function presetLabel(map, id) {
  if (!id || id === SIGHT_PRESET) return L("GLHEX.mask.sight");
  const own = map?.presets?.[id]?.name;
  if (own) return own;
  return Object.hasOwn(MASK_PRESETS, id) ? L(`GLHEX.mask.${id}`) : id;
}

/** Every preset a hex can be masked with: the live "sight" preset first, then the map's own. */
export function presetChoices(map) {
  return [SIGHT_PRESET, ...Object.keys(map?.presets ?? {})].map((id) => ({ id, label: presetLabel(map, id) }));
}

/** Every terrain a GM can pick, built-ins first (a custom shadowing a built-in wins). */
export function terrainChoices(map) {
  const custom = map?.terrains ?? {};
  const out = [];
  for (const id of BUILTIN_TERRAIN_IDS) {
    if (custom[id]) continue;
    const b = BUILTIN_TERRAINS[id];
    out.push({ id, label: L(`GLHEX.terrain.${id}`), color: b.color, glyph: b.glyph, custom: false });
  }
  for (const [id, t] of Object.entries(custom)) {
    out.push({ id, label: t.name || id, color: t.color, glyph: t.glyph, custom: true });
  }
  return out;
}

/** Inline SVG for a terrain glyph. Path data comes from constants, never from users. */
export function glyphSvg(id, cls = "glhex-glyph") {
  const d = glyphSvgPath(id);
  return `<svg class="${cls}" viewBox="-10 -10 20 20" aria-hidden="true" focusable="false">${d ? `<path d="${escapeHTML(d)}"/>` : `<circle r="1.4"/>`}</svg>`;
}

/** [{on}] × 4 for a rating (null → all off). */
export function pips(rating) {
  const out = [];
  for (let n = RATING_MIN; n <= RATING_MAX; n++) out.push({ n, on: rating != null && n <= rating });
  return out;
}

export const ratingLabel = (n) => (n == null ? "" : L(`GLHEX.rating.${n}`));

/** Options [{value,label,selected}] from a list of values + a label function. */
export function optionList(values, label, selected) {
  return values.map((value) => ({ value, label: label(value), selected: String(value) === String(selected ?? "") }));
}

/** A readable form snapshot: FormDataExtended → expanded nested object. */
export function readForm(form) {
  if (!form) return {};
  const FDE = globalThis.foundry?.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
  const flat = new FDE(form).object;
  return globalThis.foundry.utils.expandObject(flat);
}

/** expandObject turns `a.0.b` into { "0": … }; give back an ordered array. */
export function indexedList(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return [];
  return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]);
}

/** A blank number input clears; anything else is a finite number or null. */
export function optionalNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ── File pickers ───────────────────────────────────────────────────────── */

/**
 * Wire every `[data-pick="image"]` button under `root`: it opens Foundry's
 * FilePicker (S3 included, where the world is set up for it) and writes the
 * chosen path into the input named by `data-target`, firing `change` so the
 * owning app sees it exactly as if it had been typed.
 */
export function bindFilePickers(root) {
  for (const btn of root.querySelectorAll("[data-pick]")) {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const input = root.querySelector(`[name="${btn.dataset.target}"], [data-field="${btn.dataset.target}"]`);
      const FP = globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      if (!input || !FP) return;
      new FP({
        type: btn.dataset.pick || "image",
        current: input.value || "",
        callback: (path) => { input.value = path; input.dispatchEvent(new Event("change", { bubbles: true })); },
      }).render(true);
    });
  }
}

/* ── Document links ─────────────────────────────────────────────────────── */

function textEditor() {
  return globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
}

/**
 * Wire every `[data-uuid-drop="TypeA,TypeB"]` input under `root` to accept a
 * dragged document of those types. The input receives the UUID and fires
 * `change`, so the owning app sees it exactly as if it had been typed.
 */
export function bindUuidDrops(root) {
  for (const input of root.querySelectorAll("[data-uuid-drop]")) {
    const allowed = input.dataset.uuidDrop.split(",").map((s) => s.trim()).filter(Boolean);
    const host = input.closest(".glhex-link") ?? input;
    host.addEventListener("dragover", (ev) => { ev.preventDefault(); host.classList.add("is-drop"); });
    host.addEventListener("dragleave", () => host.classList.remove("is-drop"));
    host.addEventListener("drop", (ev) => {
      ev.preventDefault();
      host.classList.remove("is-drop");
      let data = null;
      try { data = textEditor()?.getDragEventData(ev); } catch { data = null; }
      if (!data?.uuid) return;
      if (allowed.length && !allowed.includes(data.type)) {
        globalThis.ui?.notifications?.warn(L("GLHEX.app.common.wrongDrop", { types: allowed.join(" / ") }));
        return;
      }
      input.value = data.uuid;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
}

/** Open a linked document's sheet, quietly doing nothing on a dead link. */
export async function openUuid(uuid) {
  if (!uuid) return;
  let doc = null;
  try { doc = await globalThis.fromUuid(uuid); } catch { doc = null; }
  if (!doc) { globalThis.ui?.notifications?.warn(L("GLHEX.app.common.deadLink")); return; }
  if (doc.documentName === "JournalEntryPage") doc.parent?.sheet?.render(true, { pageId: doc.id });
  else doc.sheet?.render(true);
}

/** Plain text of a table result across v13/v14 result shapes. */
export function resultText(r) {
  const strip = (html) => {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = String(html);
    return div.textContent.trim();
  };
  const name = typeof r?.name === "string" ? r.name.trim() : "";
  const desc = strip(r?.description);
  const parts = [name, desc].filter(Boolean);
  if (!parts.length && typeof r?.text === "string") parts.push(strip(r.text));
  return [...new Set(parts)].join(" — ");
}

/** Draw once from a linked RollTable and return its text, or null. */
export async function drawTableText(uuid) {
  if (!uuid) { globalThis.ui?.notifications?.warn(L("GLHEX.app.common.noTable")); return null; }
  let table = null;
  try { table = await globalThis.fromUuid(uuid); } catch { table = null; }
  if (!table || table.documentName !== "RollTable") {
    globalThis.ui?.notifications?.warn(L("GLHEX.app.common.deadLink"));
    return null;
  }
  const draw = await table.draw({ displayChat: false });
  const text = (draw?.results ?? []).map(resultText).filter(Boolean).join("\n");
  return text || null;
}

/** DialogV2 yes/no. */
export async function confirmDialog(title, content) {
  const { DialogV2 } = globalThis.foundry.applications.api;
  try {
    return !!(await DialogV2.confirm({
      window: { title },
      content: `<p>${content}</p>`,
      rejectClose: false,
      modal: true,
    }));
  } catch {
    return false;
  }
}

/** Resolve the store module lazily so this folder imports under plain Node. */
let _storeMod = null;
export async function loadStore() {
  if (!_storeMod) _storeMod = await import("../store.mjs");
  return _storeMod.HexStore;
}
export const currentStore = () => _storeMod?.HexStore?.current ?? null;
