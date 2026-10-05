/**
 * Theatre — the shot editor.
 *
 * Left: the scene's shots (drag to reorder, duplicate, delete; drop images,
 * tiles or OS files onto it; Add shot; Import folder). Right: two tabs — the
 * selected shot's detail form, and the scene's defaults.
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
import { coverRect, normalizeShot, resolveFace, resolveHold, resolveStyle } from "../model.mjs";
import { escapeHTML } from "../../../core/util.mjs";
import { TheatreAppBase } from "./base.mjs";
import {
  L, SHOT_MIME, browseMedia, confirmDialog, currentStore, dragLooksUseful, faceKeys, faceLabel,
  faceSecondaryStyle, faceSpecimenStyle, gmFace, gmShake, guarded, isVideoSrc, loadStore, overrideOptions, partialFromSrc, pathsFromDrop,
  pickFile, pickFolder, plainOptions, stageEnabled, styleKeys, styleLabel, tpl,
} from "./shared.mjs";

export const EDITOR_ID = "glth-editor";

let lastTab = "shot";
let lastPosition = null;

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
      const { shots, config, state } = store;
      if (!this.selectedId || !store.shot(this.selectedId)) this.selectedId = shots[0]?.id ?? null;
      if (this._draft && !store.shot(this._draft.id)) this._draft = null;

      const rows = shots.map((s) => ({
        id: s.id,
        src: s.src,
        hasSrc: !!s.src,
        video: isVideoSrc(s.src),
        label: s.title || s.eyebrow || s.subtitle || L("GLTH.app.untitled"),
        untitled: !(s.title || s.eyebrow || s.subtitle),
        sub: styleLabel(resolveStyle(s, config)),
        selected: s.id === this.selectedId,
        onAir: s.id === state.shotId,
        dirty: this._draft?.id === s.id,
      }));

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
        };
      }

      return {
        ...context,
        empty: false,
        tab: lastTab,
        isShotTab: lastTab === "shot",
        isSceneTab: lastTab === "scene",
        rows,
        count: rows.length,
        detail,
        dirty: this.dirty,
        stage,
        holdMin: sec(TIMING.holdMin),
        holdMax: sec(TIMING.holdMax),
        config: {
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
      this.#bindList(root.querySelector(".glth-ed-list"));
      this.#bindDetail(root.querySelector("form[data-shot-form]"));
      this.#bindConfig(root.querySelector("form[data-config-form]"));
    }

    /* ── list: select, reorder, drop ─────────────────────────────────── */

    #bindList(list) {
      if (!list) return;
      const rows = () => [...list.querySelectorAll(".glth-row[data-id]")];
      const clearMarks = () => {
        for (const r of rows()) r.classList.remove("is-drop-before", "is-drop-after", "is-dragging");
        list.classList.remove("is-drop");
      };
      const slot = (y) => {
        const all = rows();
        for (let i = 0; i < all.length; i++) {
          const b = all[i].getBoundingClientRect();
          if (y < b.top + b.height / 2) return { index: i, el: all[i], side: "before" };
        }
        return { index: all.length, el: all.at(-1) ?? null, side: "after" };
      };
      for (const r of rows()) {
        r.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData(SHOT_MIME, r.dataset.id);
          ev.dataTransfer.effectAllowed = "move";
          r.classList.add("is-dragging");
        });
        r.addEventListener("dragend", clearMarks);
      }
      list.addEventListener("dragover", (ev) => {
        const internal = ev.dataTransfer?.types?.includes(SHOT_MIME);
        if (!internal && !dragLooksUseful(ev)) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = internal ? "move" : "copy";
        for (const r of rows()) r.classList.remove("is-drop-before", "is-drop-after");
        const s = slot(ev.clientY);
        s.el?.classList.add(s.side === "before" ? "is-drop-before" : "is-drop-after");
        list.classList.toggle("is-drop", !internal);
      });
      list.addEventListener("dragleave", (ev) => { if (!list.contains(ev.relatedTarget)) clearMarks(); });
      list.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        const s = slot(ev.clientY);
        clearMarks();
        const store = this.store;
        if (!store) return;
        const id = ev.dataTransfer?.getData(SHOT_MIME);
        if (id) {
          const from = store.indexOf(id);
          if (from < 0) return;
          const to = s.index > from ? s.index - 1 : s.index;
          if (to !== from) await guarded(() => store.moveShot(id, to));
          return;
        }
        await this.#addPaths(await pathsFromDrop(ev), s.index);
      });
    }

    async #addPaths(paths, at) {
      const store = this.store;
      if (!store) return;
      if (!paths?.length) { ui.notifications.warn(L("GLTH.editor.dropNothing")); return; }
      await this.#flushDraft();
      const ids = await guarded(() => store.addShots(paths.map(partialFromSrc), at == null ? {} : { at }));
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
      form.addEventListener("input", (ev) => { this.#liveOutputs(form, ev.target); capture(); });
      form.addEventListener("change", (ev) => {
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
      const at = this.store && this.selectedId ? this.store.indexOf(this.selectedId) + 1 : undefined;
      await this.#addPaths([path], at);
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
      await this.#addPaths(paths);
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
