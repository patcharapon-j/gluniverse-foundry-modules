/**
 * Theatre — the shot editor.
 *
 * Left: the scene's shots (drag to reorder, duplicate, delete; drop images,
 * tiles or OS files onto it; Add shot; Import folder), grouped under the
 * scene's folders with a search box over them. Folders collapse, rename,
 * recolour, delete (their shots become unfiled) and reorder by dragging their
 * header; a shot dropped on a header is filed there. Folder order IS play
 * order. Importing a directory files its shots in a new folder named after it.
 * Right: two tabs — the selected shot's detail form, and the scene's defaults.
 *
 * A shot's folder is not part of the draft: it is organisation, written the
 * moment it is picked, so a draft saved later can never file the shot back.
 *
 * The shot form is a DRAFT. Typing never writes: the draft is read back from
 * the form on every input, so a re-render caused by someone else's write keeps
 * what the GM typed, and Save writes ONE `store.updateShot(id, patch)` with
 * every editable field (the store normalises it, so clamping lives in one
 * place). A dirty draft is saved automatically when the GM selects another shot
 * or closes the editor — losing typed notes is worse than an unasked save.
 *
 * Scene defaults are few and coarse, so they write on change.
 *
 * Stage controls (capture / re-sample / clear the shot's grade) are drawn only
 * while the Stage feature is running; Theatre works with Stage switched off.
 *
 * Bound to the scene it opened on: switching the viewed scene closes it.
 */

import { FRAME, TIMING } from "../constants.mjs";
import { coverRect, groupShots, matchesQuery, normalizeShot, resolveFace, resolveHold, resolveStyle, searchText } from "../model.mjs";
import { escapeHTML } from "../../../core/util.mjs";
import { TheatreAppBase } from "./base.mjs";
import {
  FOLDER_MIME, L, SHOT_MIME, browseMedia, confirmDialog, currentStore, dragLooksUseful, dropSlot, faceKeys, faceLabel,
  faceSecondaryStyle, faceSpecimenStyle, folderNameFromPath, folderOf, folderStyle, gmFace, gmShake, guarded, isVideoSrc, loadStore,
  overrideOptions, partialFromSrc, pathsFromDrop, pickFile, pickFolder, plainOptions, promptFolder, stageEnabled, styleKeys, styleLabel, modeKeys, modeLabel, tpl,
} from "./shared.mjs";

export const EDITOR_ID = "glth-editor";

let lastTab = "shot";
let lastPosition = null;
/** The list's search text, kept across re-renders within the session. */
let query = "";
/** Collapsed folder ids per scene ("" is the unfiled group). */
const collapsedFolders = new Map();
const collapsedSet = (sceneId) => {
  if (!collapsedFolders.has(sceneId)) collapsedFolders.set(sceneId, new Set());
  return collapsedFolders.get(sceneId);
};

const sec = (ms) => Math.round((ms / 1000) * 10) / 10;
const fmt = {
  exposure: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`,
  saturation: (v) => `×${Number(v).toFixed(2)}`,
  pct: (v) => `${Math.round(Number(v) * 100)}%`,
  letterbox: (v) => `${(Number(v) * 100).toFixed(1)}%`,
};
/** Which formatter each range output uses (data-fmt). */
const FMT_OF = { exposure: fmt.exposure, saturation: fmt.saturation, pct: fmt.pct, letterbox: fmt.letterbox };

/** Every field the detail form edits — the patch Save writes is exactly these. */
function patchFromForm(f, base) {
  const num = (v, fb) => (v === "" || v == null || !Number.isFinite(Number(v)) ? fb : Number(v));
  const t = f.treatment ?? {};
  const holdSec = String(f.hold ?? "").trim();
  return {
    src: String(f.src ?? "").trim(),
    eyebrow: String(f.eyebrow ?? ""),
    title: String(f.title ?? ""),
    subtitle: String(f.subtitle ?? ""),
    notes: String(f.notes ?? ""),
    style: f.style || null,
    face: f.face || null,
    hold: holdSec === "" || !Number.isFinite(Number(holdSec)) ? null : Number(holdSec) * 1000,
    focus: { x: num(f.focus?.x, base.focus.x), y: num(f.focus?.y, base.focus.y) },
    shake: f.shakeOn ? num(f.shake, 0) : null,
    treatment: {
      exposure: num(t.exposure, base.treatment.exposure),
      saturation: num(t.saturation, base.treatment.saturation),
      tint: t.tint || base.treatment.tint,
      tintAmount: num(t.tintAmount, base.treatment.tintAmount),
      vignette: num(t.vignette, base.treatment.vignette),
      blur: num(t.blur, base.treatment.blur),
      letterbox: t.letterboxOn ? num(t.letterbox, 0) : null,
    },
  };
}

function readForm(form) {
  if (!form) return {};
  const FDE = foundry.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
  return foundry.utils.expandObject(new FDE(form).object);
}

let _Editor = null;

function EditorApp() {
  if (_Editor) return _Editor;
  const Base = TheatreAppBase();

  _Editor = class TheatreEditor extends Base {
    static DEFAULT_OPTIONS = {
      id: EDITOR_ID,
      classes: ["glth-app", "glth-editor"],
      tag: "section",
      window: { title: "GLTH.editor.title", icon: "fa-solid fa-clapperboard", resizable: true, minimizable: true },
      position: { width: 900, height: 680 },
      actions: {
        select: TheatreEditor.#onSelect,
        tab: TheatreEditor.#onTab,
        addShot: TheatreEditor.#onAddShot,
        importFolder: TheatreEditor.#onImportFolder,
        duplicate: TheatreEditor.#onDuplicate,
        remove: TheatreEditor.#onRemove,
        browseSrc: TheatreEditor.#onBrowseSrc,
        save: TheatreEditor.#onSave,
        revert: TheatreEditor.#onRevert,
        cue: TheatreEditor.#onCue,
        resetFocus: TheatreEditor.#onResetFocus,
        addFolder: TheatreEditor.#onAddFolder,
        editFolder: TheatreEditor.#onEditFolder,
        removeFolder: TheatreEditor.#onRemoveFolder,
        toggleFolder: TheatreEditor.#onToggleFolder,
        resetTreatment: TheatreEditor.#onResetTreatment,
        captureGrade: TheatreEditor.#onCaptureGrade,
        resampleGrade: TheatreEditor.#onResampleGrade,
        clearGrade: TheatreEditor.#onClearGrade,
      },
    };

    static PARTS = { main: { template: tpl("editor"), scrollable: [".glth-ed-list", ".glth-ed-detail"] } };

    /** Selected shot id. */
    selectedId = null;
    /** { id, values } — the shot form as typed, or null when clean. */
    _draft = null;
    /** The last store seen for this scene, so a dirty draft can still be saved while closing. */
    _lastStore = null;
    /** Caret of a focused search box, carried across a re-render. */
    _refocus = null;

    constructor(options = {}) {
      if (lastPosition) options.position = { ...(options.position ?? {}), ...lastPosition };
      super(options);
      this.selectedId = options.shotId ?? null;
    }

    get title() {
      const name = this.store?.scene?.name ?? this._lastStore?.scene?.name ?? "";
      return name ? `${L("GLTH.editor.title")} · ${name}` : L("GLTH.editor.title");
    }

    get dirty() { return !!this._draft && this._draft.id === this.selectedId; }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const store = this.store;
      if (!store) return { ...context, empty: true };
      this._lastStore = store;
      const { shots, folders, config, state } = store;
      if (!this.selectedId || !store.shot(this.selectedId)) this.selectedId = shots[0]?.id ?? null;
      if (this._draft && !store.shot(this._draft.id)) this._draft = null;

      const row = (s, i, folderName) => ({
        id: s.id,
        pos: i,
        folder: s.folder ?? "",
        search: searchText(s, folderName),
        src: s.src,
        hasSrc: !!s.src,
        video: isVideoSrc(s.src),
        label: s.title || s.eyebrow || s.subtitle || L("GLTH.app.untitled"),
        untitled: !(s.title || s.eyebrow || s.subtitle),
        sub: styleLabel(resolveStyle(s, config)),
        selected: s.id === this.selectedId,
        onAir: s.id === state.shotId,
        dirty: this._draft?.id === s.id,
      });

      const collapsed = collapsedSet(this.sceneId);
      const hasFolders = folders.length > 0;
      const groups = groupShots(shots, folders).map((g) => {
        const folder = g.folder?.id ?? "";
        return {
          folder,
          name: g.folder ? (g.folder.name || L("GLTH.folders.untitled")) : L("GLTH.folders.unfiled"),
          style: g.folder ? folderStyle(g.folder.color) : "",
          unfiled: !g.folder,
          showHead: hasFolders,
          collapsed: hasFolders && collapsed.has(folder),
          count: g.shots.length,
          rows: g.shots.map(({ shot, index }) => row(shot, index, g.folder?.name ?? "")),
        };
      });
      const rows = groups.flatMap((g) => g.rows);

      const stage = stageEnabled();
      const stored = this.selectedId ? store.shot(this.selectedId) : null;
      let detail = null;
      if (stored) {
        // The draft wins over the stored shot for everything the form edits; grade is never drafted.
        const d = this.dirty ? normalizeShot({ ...stored, ...this._draft.values, id: stored.id, grade: stored.grade }) : stored;
        const sceneFace = config.face ?? gmFace();
        const face = resolveFace(d, config, gmFace());
        const shake = d.shake ?? gmShake();
        const t = d.treatment;
        detail = {
          id: d.id,
          src: d.src,
          hasSrc: !!d.src,
          video: isVideoSrc(d.src),
          eyebrow: d.eyebrow,
          title: d.title,
          subtitle: d.subtitle,
          notes: d.notes,
          onAir: d.id === state.shotId,
          styles: overrideOptions(styleKeys(), styleLabel, d.style, config.style),
          faces: overrideOptions(faceKeys(), faceLabel, d.face, sceneFace),
          hold: d.hold == null ? "" : sec(d.hold),
          holdDefault: sec(config.hold),
          focusX: d.focus.x,
          focusY: d.focus.y,
          shakeOn: d.shake != null,
          shakeValue: shake,
          shakeOut: fmt.pct(shake),
          shakeDefault: fmt.pct(gmShake()),
          t,
          out: {
            exposure: fmt.exposure(t.exposure),
            saturation: fmt.saturation(t.saturation),
            tintAmount: fmt.pct(t.tintAmount),
            vignette: fmt.pct(t.vignette),
            blur: fmt.pct(t.blur),
            letterbox: fmt.letterbox(t.letterbox ?? config.letterbox),
          },
          letterboxOn: t.letterbox != null,
          letterboxValue: t.letterbox ?? config.letterbox,
          letterboxDefault: fmt.letterbox(config.letterbox),
          titleStyle: faceSpecimenStyle(face),
          secondaryStyle: faceSecondaryStyle(face),
          specimen: d.title || L("GLTH.editor.specimen"),
          hasGrade: !!stored.grade,
          resolvedHold: sec(resolveHold(d, config)),
          folders: [
            { value: "", label: L("GLTH.folders.unfiled"), selected: !stored.folder },
            ...folders.map((f) => ({ value: f.id, label: f.name || L("GLTH.folders.untitled"), selected: f.id === stored.folder })),
          ],
        };
      }

      return {
        ...context,
        empty: false,
        tab: lastTab,
        isShotTab: lastTab === "shot",
        isSceneTab: lastTab === "scene",
        rows,
        groups,
        query,
        count: rows.length,
        detail,
        dirty: this.dirty,
        stage,
        holdMin: sec(TIMING.holdMin),
        holdMax: sec(TIMING.holdMax),
        config: {
          modes: plainOptions(modeKeys(), modeLabel, config.mode),
          modeHint: L(`GLTH.mode.${config.mode}.hint`),
          styles: plainOptions(styleKeys(), styleLabel, config.style),
          faces: overrideOptions(faceKeys(), faceLabel, config.face, gmFace(), "GLTH.editor.gmDefault"),
          hold: sec(config.hold),
          letterbox: config.letterbox,
          letterboxOut: fmt.letterbox(config.letterbox),
          tag: config.tag,
          styleHint: L(`GLTH.style.${config.style}.hint`),
          titleStyle: faceSpecimenStyle(config.face ?? gmFace()),
          secondaryStyle: faceSecondaryStyle(config.face ?? gmFace()),
        },
      };
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      this.#bindSearch(root.querySelector("[data-search]"));
      this.#bindList(root.querySelector(".glth-ed-list"));
      this.#applyFilter();
      this.#bindDetail(root.querySelector("form[data-shot-form]"));
      this.#bindConfig(root.querySelector("form[data-config-form]"));
    }

    async _preRender(context, options) {
      await super._preRender?.(context, options);
      const a = document.activeElement;
      this._refocus = a?.matches?.(".glth-editor [data-search]") ? { start: a.selectionStart, end: a.selectionEnd } : null;
    }

    /* ── list: search + collapse ─────────────────────────────────────── */

    #bindSearch(input) {
      if (!input) return;
      if (this._refocus) {
        input.focus({ preventScroll: true });
        try { input.setSelectionRange(this._refocus.start, this._refocus.end); } catch { /* not a text input */ }
        this._refocus = null;
      }
      input.addEventListener("input", () => { query = input.value; this.#applyFilter(); });
      input.addEventListener("keydown", async (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          const first = this.element?.querySelector(".glth-row[data-id]:not([hidden])");
          if (first && first.dataset.id !== this.selectedId) {
            await this.#flushDraft();
            this.selectedId = first.dataset.id;
            lastTab = "shot";
            this.render();
          }
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          if (input.value) { input.value = ""; query = ""; this.#applyFilter(); } else input.blur();
        }
      });
    }

    /**
     * Rows show when they match the search and their folder is open; while
     * searching, every match shows whatever is collapsed. A folder header shows
     * unless a search leaves it nothing to head.
     */
    #applyFilter() {
      const root = this.element;
      if (!root) return;
      const collapsed = collapsedSet(this.sceneId);
      const rows = [...root.querySelectorAll(".glth-row[data-id]")];
      const hits = new Set();
      let n = 0;
      for (const r of rows) {
        const match = matchesQuery(r.dataset.haystack ?? "", query);
        if (match) { n++; hits.add(r.dataset.folder); }
        r.hidden = !match || (!query && collapsed.has(r.dataset.folder) && !!root.querySelector("[data-group]"));
      }
      for (const g of root.querySelectorAll("[data-group]")) {
        const shut = collapsed.has(g.dataset.folder);
        g.hidden = !!query && !hits.has(g.dataset.folder);
        g.classList.toggle("is-collapsed", shut && !query);
        g.setAttribute("aria-expanded", shut && !query ? "false" : "true");
      }
      const none = root.querySelector("[data-no-match]");
      if (none) none.hidden = !(rows.length && !n);
      root.querySelector(".glth-search")?.classList.toggle("is-active", !!query);
    }

    /* ── list: select, reorder, drop ─────────────────────────────────── */

    #bindList(list) {
      if (!list) return;
      const rows = () => [...list.querySelectorAll(".glth-row[data-id]:not([hidden])")];
      const heads = () => [...list.querySelectorAll("[data-group]:not([hidden]):not(.is-unfiled)")];
      const marked = () => list.querySelectorAll(".glth-row, [data-group]");
      const clearMarks = () => {
        for (const r of marked()) r.classList.remove("is-drop-before", "is-drop-after", "is-dragging", "is-drop");
        list.classList.remove("is-drop");
      };
      /**
       * Where a shot or a file lands: on a folder header, at the end of that
       * folder; between rows, beside the nearest row and in its folder.
       */
      const slot = (ev) => {
        const head = ev.target?.closest?.("[data-group]");
        if (head) return { el: head, head: true, index: null, folder: folderOf(head) };
        const s = dropSlot(rows(), ev.clientY, "y");
        if (!s.el) return { el: null, index: null, folder: undefined };
        const i = Number(s.el.dataset.index);
        return { el: s.el, side: s.side, index: s.side === "before" ? i : i + 1, folder: folderOf(s.el) };
      };
      for (const r of list.querySelectorAll(".glth-row[data-id]")) {
        r.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData(SHOT_MIME, r.dataset.id);
          ev.dataTransfer.effectAllowed = "move";
          r.classList.add("is-dragging");
        });
        r.addEventListener("dragend", clearMarks);
      }
      for (const h of list.querySelectorAll("[data-group][draggable='true']")) {
        h.addEventListener("dblclick", (ev) => {
          if (ev.target.closest("button")) return;
          ev.preventDefault();
          TheatreEditor.#onEditFolder.call(this, ev, h);
        });
        h.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData(FOLDER_MIME, h.dataset.folder);
          ev.dataTransfer.effectAllowed = "move";
          h.classList.add("is-dragging");
        });
        h.addEventListener("dragend", clearMarks);
      }
      list.addEventListener("dragover", (ev) => {
        const types = ev.dataTransfer?.types ?? [];
        const folderDrag = types.includes(FOLDER_MIME);
        const internal = folderDrag || types.includes(SHOT_MIME);
        if (!internal && !dragLooksUseful(ev)) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = internal ? "move" : "copy";
        for (const r of marked()) r.classList.remove("is-drop-before", "is-drop-after", "is-drop");
        if (folderDrag) {
          const s = dropSlot(heads(), ev.clientY, "y");
          s.el?.classList.add(s.side === "before" ? "is-drop-before" : "is-drop-after");
        } else {
          const s = slot(ev);
          s.el?.classList.add(s.head ? "is-drop" : s.side === "before" ? "is-drop-before" : "is-drop-after");
        }
        list.classList.toggle("is-drop", !internal);
      });
      list.addEventListener("dragleave", (ev) => { if (!list.contains(ev.relatedTarget)) clearMarks(); });
      list.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        const store = this.store;
        const folderId = ev.dataTransfer?.getData(FOLDER_MIME);
        if (folderId) {
          const s = dropSlot(heads(), ev.clientY, "y");
          clearMarks();
          if (!store || !s.el) return;
          const from = store.folders.findIndex((f) => f.id === folderId);
          const at = store.folders.findIndex((f) => f.id === s.el.dataset.folder);
          if (from < 0 || at < 0) return;
          const target = s.side === "before" ? at : at + 1;
          const to = target > from ? target - 1 : target;
          if (to !== from) await guarded(() => store.moveFolder(folderId, to));
          return;
        }
        const s = slot(ev);
        clearMarks();
        if (!store) return;
        const id = ev.dataTransfer?.getData(SHOT_MIME);
        if (id) {
          const from = store.indexOf(id);
          if (from < 0) return;
          const to = s.index == null ? null : s.index > from ? s.index - 1 : s.index;
          await guarded(() => store.moveShot(id, to, { folder: s.folder }));
          return;
        }
        await this.#addPaths(await pathsFromDrop(ev), s.index, s.folder);
      });
    }

    async #addPaths(paths, at, folder) {
      const store = this.store;
      if (!store) return;
      if (!paths?.length) { ui.notifications.warn(L("GLTH.editor.dropNothing")); return; }
      await this.#flushDraft();
      const ids = await guarded(() => store.addShots(paths.map(partialFromSrc), { at: at ?? null, folder }));
      if (ids?.length) {
        this.selectedId = ids[0];
        lastTab = "shot";
        ui.notifications.info(L("GLTH.editor.added", { n: ids.length }));
      }
      this.render();
    }

    /* ── detail: the draft ───────────────────────────────────────────── */

    #bindDetail(form) {
      if (!form) return;
      form.addEventListener("submit", (ev) => { ev.preventDefault(); this.#save(); });
      const capture = () => {
        const id = form.dataset.shotId;
        this._draft = { id, values: patchFromForm(readForm(form), this.store?.shot(id) ?? normalizeShot({})) };
        this.element.querySelector(".glth-ed")?.classList.add("is-dirty");
        this.element.querySelector(`.glth-row[data-id="${CSS.escape(id)}"]`)?.classList.add("is-dirty");
      };
      const organise = (el) => !!el?.matches?.("[data-folder-select]");
      form.addEventListener("input", (ev) => { if (organise(ev.target)) return; this.#liveOutputs(form, ev.target); capture(); });
      form.addEventListener("change", async (ev) => {
        if (organise(ev.target)) {
          // Filing is organisation, not a draft edit: it writes now and leaves the draft alone.
          const store = this.store;
          const id = form.dataset.shotId;
          if (store && id) await guarded(() => store.moveShot(id, null, { folder: ev.target.value || null }));
          return;
        }
        this.#liveOutputs(form, ev.target);
        capture();
        if (ev.target?.name === "src") this.#bindFocus(form, true);
      });
      this.#bindFocus(form, false);
      this.#bindPicDrop(form);
    }

    /** Range readouts, the letterbox override switch and the type specimen, without a re-render. */
    #liveOutputs(form, el) {
      if (el?.type === "range") {
        const out = form.querySelector(`output[data-for="${CSS.escape(el.name)}"]`);
        const f = FMT_OF[out?.dataset.fmt];
        if (out && f) out.textContent = f(el.value);
      }
      if (el?.name === "treatment.letterboxOn") {
        const range = form.querySelector('input[name="treatment.letterbox"]');
        if (range) range.disabled = !el.checked;
      }
      if (el?.name === "shakeOn") {
        const range = form.querySelector('input[name="shake"]');
        if (range) range.disabled = !el.checked;
      }
      if (el?.name === "face" || el?.name === "title" || el?.name === "eyebrow" || el?.name === "subtitle") {
        const store = this.store;
        if (!store) return;
        const faceKey = form.elements.face?.value || store.face;
        const spec = form.querySelector("[data-specimen]");
        if (!spec) return;
        const t = spec.querySelector("[data-spec-title]");
        const s = spec.querySelector("[data-spec-sub]");
        if (t) { t.setAttribute("style", faceSpecimenStyle(faceKey)); t.textContent = form.elements.title?.value || L("GLTH.editor.specimen"); }
        if (s) { s.setAttribute("style", faceSecondaryStyle(faceKey)); s.textContent = form.elements.subtitle?.value || form.elements.eyebrow?.value || ""; }
      }
    }

    /**
     * The focus picker: the whole image, the point kept in frame, and the 16:9
     * crop the players actually see (coverRect against FRAME — the same maths
     * the renderer uses). Click or drag to move the point.
     */
    #bindFocus(form, srcChanged) {
      const box = form.querySelector("[data-focus]");
      if (!box) return;
      const media = box.querySelector("img, video");
      const dot = box.querySelector("[data-focus-dot]");
      const crop = box.querySelector("[data-focus-crop]");
      const fx = form.elements["focus.x"], fy = form.elements["focus.y"];
      if (srcChanged) {
        const src = form.elements.src?.value?.trim() ?? "";
        const isVid = isVideoSrc(src);
        const fresh = document.createElement(isVid ? "video" : "img");
        if (isVid) Object.assign(fresh, { muted: true, loop: true, autoplay: true, playsInline: true });
        else fresh.alt = "";
        fresh.className = "glth-focus-media";
        fresh.src = src;
        if (media) media.replaceWith(fresh); else box.prepend(fresh);
        box.classList.toggle("is-blank", !src);
        this.#bindFocus(form, false);
        return;
      }
      if (!media) return;
      const size = () => (media.tagName === "VIDEO" ? [media.videoWidth, media.videoHeight] : [media.naturalWidth, media.naturalHeight]);
      const paint = () => {
        const x = Number(fx.value), y = Number(fy.value);
        dot.style.left = `${x * 100}%`;
        dot.style.top = `${y * 100}%`;
        const [iw, ih] = size();
        if (!(iw > 0 && ih > 0)) { crop.hidden = true; return; }
        box.style.setProperty("--glth-ar", String(iw / ih));
        const r = coverRect(iw, ih, FRAME.width, FRAME.height, { x, y });
        crop.hidden = false;
        crop.style.left = `${(-r.x / r.scale / iw) * 100}%`;
        crop.style.top = `${(-r.y / r.scale / ih) * 100}%`;
        crop.style.width = `${(FRAME.width / r.scale / iw) * 100}%`;
        crop.style.height = `${(FRAME.height / r.scale / ih) * 100}%`;
      };
      media.addEventListener(media.tagName === "VIDEO" ? "loadedmetadata" : "load", paint);
      paint();
      this._paintFocus = paint;

      const set = (ev) => {
        const b = box.getBoundingClientRect();
        if (!b.width || !b.height) return;
        const clamp = (v) => Math.min(1, Math.max(0, v));
        fx.value = clamp((ev.clientX - b.left) / b.width).toFixed(3);
        fy.value = clamp((ev.clientY - b.top) / b.height).toFixed(3);
        paint();
      };
      box.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        box.setPointerCapture(ev.pointerId);
        set(ev);
        const move = (e) => set(e);
        const up = () => {
          box.removeEventListener("pointermove", move);
          box.removeEventListener("pointerup", up);
          box.removeEventListener("pointercancel", up);
          fx.dispatchEvent(new Event("change", { bubbles: true }));
        };
        box.addEventListener("pointermove", move);
        box.addEventListener("pointerup", up);
        box.addEventListener("pointercancel", up);
      });
    }

    /** Dropping an image onto the detail picture replaces this shot's source. */
    #bindPicDrop(form) {
      const box = form.querySelector("[data-focus]");
      const input = form.elements.src;
      if (!box || !input) return;
      box.addEventListener("dragover", (ev) => {
        if (ev.dataTransfer?.types?.includes(SHOT_MIME) || !dragLooksUseful(ev)) return;
        ev.preventDefault();
        ev.stopPropagation();
        box.classList.add("is-drop");
      });
      box.addEventListener("dragleave", () => box.classList.remove("is-drop"));
      box.addEventListener("drop", async (ev) => {
        if (ev.dataTransfer?.types?.includes(SHOT_MIME)) return;
        ev.preventDefault();
        ev.stopPropagation();
        box.classList.remove("is-drop");
        const [path] = await pathsFromDrop(ev);
        if (!path) { ui.notifications.warn(L("GLTH.editor.dropNothing")); return; }
        input.value = path;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    async #save() {
      const store = this.store ?? (this._lastStore?.scene?.id === this.sceneId ? this._lastStore : null);
      const draft = this._draft;
      if (!store || !draft) return;
      if (!store.shot(draft.id)) { this._draft = null; return; }
      this._draft = null;
      await guarded(() => store.updateShot(draft.id, draft.values));
    }

    /** Save a dirty draft before the selection moves or the window closes. */
    async #flushDraft() {
      if (this._draft) await this.#save();
    }

    /* ── scene config: writes on change ──────────────────────────────── */

    #bindConfig(form) {
      if (!form) return;
      form.addEventListener("submit", (ev) => ev.preventDefault());
      form.addEventListener("input", (ev) => {
        const el = ev.target;
        if (el?.type === "range") {
          const out = form.querySelector(`output[data-for="${CSS.escape(el.name)}"]`);
          const f = FMT_OF[out?.dataset.fmt];
          if (out && f) out.textContent = f(el.value);
        }
      });
      form.addEventListener("change", async (ev) => {
        const store = this.store;
        if (!store) return;
        const f = readForm(form);
        const key = ev.target?.name;
        const holdSec = Number(f.hold);
        const patch = {
          mode: f.mode,
          style: f.style,
          face: f.face || null,
          hold: Number.isFinite(holdSec) && String(f.hold).trim() !== "" ? holdSec * 1000 : store.config.hold,
          letterbox: Number(f.letterbox) || 0,
          tag: !!f.tag,
        };
        if (!key) return;
        await guarded(() => store.setConfig(patch));
      });
    }

    /* ── lifecycle ───────────────────────────────────────────────────── */

    async close(options = {}) {
      // Save BEFORE the base tears down its hooks and the frame goes away.
      await this.#flushDraft();
      return super.close(options);
    }

    _onClose(options) {
      const { left, top, width, height } = this.position ?? {};
      if ([left, top, width, height].every(Number.isFinite)) lastPosition = { left, top, width, height };
      super._onClose(options);
    }

    /** Bring this editor to a shot (from the filmstrip / opener). */
    async focusShot(shotId) {
      if (shotId && shotId !== this.selectedId) {
        await this.#flushDraft();
        this.selectedId = shotId;
      }
      lastTab = "shot";
      await this.render({ force: true });
      this.bringToFront?.();
    }

    /* ── actions ─────────────────────────────────────────────────────── */

    static async #onSelect(event, target) {
      if (event.target.closest("button")) return;
      const id = target.closest("[data-id]")?.dataset.id;
      if (!id || id === this.selectedId) {
        if (lastTab !== "shot") { lastTab = "shot"; this.render(); }
        return;
      }
      await this.#flushDraft();
      this.selectedId = id;
      lastTab = "shot";
      this.render();
    }

    static #onTab(event, target) {
      const tab = target.dataset.tab;
      if (tab !== "shot" && tab !== "scene") return;
      lastTab = tab;
      this.render();
    }

    static async #onAddShot() {
      const path = await pickFile();
      if (!path) return;
      const sel = this.store?.shot(this.selectedId) ?? null;
      const at = sel ? this.store.indexOf(sel.id) + 1 : null;
      await this.#addPaths([path], at, sel ? sel.folder : undefined);
    }

    static async #onImportFolder() {
      const picked = await pickFolder();
      if (!picked || !this.store) return;
      let paths = [];
      try {
        paths = await browseMedia(picked);
      } catch (e) {
        console.error("GLUniverse Suite | theatre import folder", e);
        ui.notifications.error(L("GLTH.editor.importFailed"));
        return;
      }
      if (!paths.length) { ui.notifications.warn(L("GLTH.editor.importEmpty", { path: picked.path })); return; }
      // A directory arrives as a folder of its own, named after it.
      const store = this.store;
      if (!store) return;
      const folder = await guarded(() => store.addFolder({ name: folderNameFromPath(picked.path) || L("GLTH.folders.untitled") }));
      await this.#addPaths(paths, null, typeof folder === "string" ? folder : undefined);
    }

    static async #onDuplicate(event, target) {
      const store = this.store;
      const id = target.closest("[data-id]")?.dataset.id ?? this.selectedId;
      if (!store || !id) return;
      await this.#flushDraft();
      const newId = await guarded(() => store.duplicateShot(id));
      if (typeof newId === "string") this.selectedId = newId;
      this.render();
    }

    static async #onRemove(event, target) {
      const store = this.store;
      const id = target.closest("[data-id]")?.dataset.id ?? this.selectedId;
      const shot = id ? store?.shot(id) : null;
      if (!shot) return;
      const name = shot.title || shot.eyebrow || L("GLTH.app.untitled");
      const ok = await confirmDialog(L("GLTH.editor.removeTitle"), L("GLTH.editor.removeBody", { name: escapeHTML(name) }));
      if (!ok || !this.store) return;
      if (this._draft?.id === id) this._draft = null;
      const i = store.indexOf(id);
      await guarded(() => this.store.removeShot(id));
      if (this.selectedId === id) this.selectedId = this.store?.shots[Math.max(0, i - 1)]?.id ?? null;
      this.render();
    }

    static async #onBrowseSrc() {
      const form = this.element.querySelector("form[data-shot-form]");
      const input = form?.elements.src;
      if (!input) return;
      const path = await pickFile(input.value);
      if (!path) return;
      input.value = path;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    static async #onSave() { await this.#save(); }

    static #onRevert() {
      this._draft = null;
      this.render();
    }

    static async #onCue() {
      const store = this.store;
      const id = this.selectedId;
      if (!store || !id) return;
      await this.#flushDraft();
      await guarded(() => store.cue({ kind: "shot", shotId: id }));
    }

    static #onResetFocus() {
      const form = this.element.querySelector("form[data-shot-form]");
      if (!form) return;
      form.elements["focus.x"].value = "0.5";
      form.elements["focus.y"].value = "0.5";
      this._paintFocus?.();
      form.elements["focus.x"].dispatchEvent(new Event("change", { bubbles: true }));
    }

    /** Back to the identity look: every dial at its neutral, letterbox following the scene. */
    static #onResetTreatment() {
      const form = this.element.querySelector("form[data-shot-form]");
      if (!form) return;
      const set = (name, v) => { const el = form.elements[name]; if (!el) return; if (el.type === "checkbox") el.checked = !!v; else el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("treatment.exposure", 0);
      set("treatment.saturation", 1);
      set("treatment.tintAmount", 0);
      set("treatment.vignette", 0);
      set("treatment.blur", 0);
      set("treatment.letterboxOn", false);
      form.elements["treatment.letterboxOn"]?.dispatchEvent(new Event("change", { bubbles: true }));
    }

    static async #onAddFolder() {
      const store = this.store;
      if (!store) return;
      const data = await promptFolder();
      if (!data || !this.store) return;
      await guarded(() => this.store.addFolder(data));
    }

    static async #onEditFolder(event, target) {
      const id = target.closest("[data-group]")?.dataset.folder;
      const folder = id ? this.store?.folder(id) : null;
      if (!folder) return;
      const data = await promptFolder(folder);
      if (!data || !this.store) return;
      await guarded(() => this.store.updateFolder(id, data));
    }

    static async #onRemoveFolder(event, target) {
      const id = target.closest("[data-group]")?.dataset.folder;
      const store = this.store;
      const folder = id ? store?.folder(id) : null;
      if (!folder) return;
      const n = store.shots.filter((s) => s.folder === id).length;
      const name = escapeHTML(folder.name || L("GLTH.folders.untitled"));
      const ok = await confirmDialog(L("GLTH.folders.removeTitle"), L("GLTH.folders.removeBody", { name, n }));
      if (!ok || !this.store) return;
      collapsedSet(this.sceneId).delete(id);
      await guarded(() => this.store.removeFolder(id));
    }

    static #onToggleFolder(event, target) {
      if (event.target.closest("button")) return;
      const id = target.closest("[data-group]")?.dataset.folder;
      if (id === undefined || query) return;
      const set = collapsedSet(this.sceneId);
      if (set.has(id)) set.delete(id); else set.add(id);
      this.#applyFilter();
    }

    static async #onCaptureGrade() {
      const store = this.store;
      if (!store || !this.selectedId || !stageEnabled()) return;
      await guarded(() => store.captureStageGrade(this.selectedId));
      ui.notifications.info(L("GLTH.editor.gradeCaptured"));
    }

    static async #onResampleGrade() {
      const store = this.store;
      if (!store || !this.selectedId || !stageEnabled()) return;
      await guarded(() => store.resampleStageGrade(this.selectedId));
      ui.notifications.info(L("GLTH.editor.gradeResampled"));
    }

    static async #onClearGrade() {
      const store = this.store;
      if (!store || !this.selectedId) return;
      await guarded(() => store.updateShot(this.selectedId, { grade: null }));
    }
  };

  return _Editor;
}

const instance = () => foundry.applications.instances.get(EDITOR_ID) ?? null;

/** Open the editor for the viewed Theatre scene, optionally on one shot (GM only). */
export async function openEditor(shotId = null) {
  if (!game.user?.isGM) return null;
  await loadStore();
  const store = currentStore();
  if (!store) { ui.notifications.warn(L("GLTH.app.noScene")); return null; }
  const existing = instance();
  if (existing) {
    if (existing.sceneId === store.scene.id) { await existing.focusShot(shotId); return existing; }
    await existing.close();
  }
  const Cls = EditorApp();
  const app = new Cls({ sceneId: store.scene.id, shotId });
  await app.render({ force: true });
  return app;
}

export function closeEditor() {
  return instance()?.close() ?? null;
}

export function toggleEditor(shotId = null) {
  return instance() ? closeEditor() : openEditor(shotId);
}
