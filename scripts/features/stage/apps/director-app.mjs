/**
 * Stage — the Director: the GM's control panel.
 *
 * Four tabs over one window:
 *
 *   Stage   show/hide; a stage strip with every character on their mark (drag
 *           across for x, up and down for depth; written on drop); per-character
 *           focus, close-up (push or cut), flip, exit and the five reactions;
 *           Spread / Clear / Wide shot; the world's layout dials.
 *   Cast    the character library: add, import from tokens or a dropped Actor,
 *           edit, delete; a face point for the close-up; a lineup that draws
 *           everyone side by side at their relative heights.
 *   Light   the viewed scene's light flag: mood, dials, angle, toggles and an
 *           optional picture override.
 *   Comms   the call-in stack and its layout.
 *
 * The Stage, Cast and Comms rosters each carry a search box. It narrows the
 * roster by name and title and, below it, offers the world's Actors that are
 * not cast yet, one press from the stage (or the comms). Enter acts on the
 * first match (Shift+Enter brings them on masked), Esc clears. Filtering is done
 * on the rendered rows, never by re-rendering, so typing keeps its caret.
 *
 * GM only. Every read and write goes through `../store.mjs`; reactions through
 * `../channel.mjs`. The ApplicationV2 class is built in a memoised factory, never
 * at module scope: this folder is imported under plain Node by check tools, where
 * `foundry` does not exist.
 *
 * Writes from sliders are debounced and serialised: a range input previews its
 * value at once, the write lands ~200 ms after the last movement (and at once on
 * release), and writes run one after another so each reads the one before it.
 * A re-render is held back while the GM is holding a pointer down, typing in a
 * text field, or has a write still pending — re-rendering under a drag destroys
 * the control being dragged.
 */

import { warn } from "../../../core/const.mjs";
import { escapeHTML, matchesQuery } from "../../../core/util.mjs";
import { DEFAULT_IMAGE } from "../model.mjs";
import { DEFAULT_LIGHT } from "../light/rig.mjs";
import { NEUTRAL_PICTURE } from "../light/picture.mjs";
import { onStageSetting } from "../settings.mjs";
import * as store from "../store.mjs";
import { sendReaction } from "../channel.mjs";
import { bringOn, callIn, castActor, memberFromActor, searchWorldActors } from "../search.mjs";
import {
  DEFAULT_FACE_H, LINEUP_UNIT, SEARCH_PANES, STRIP, TABS, directorModel, figureBox, fillOf, fmt, r3, renderDirector, worldRowHTML,
} from "./director-view.mjs";

export const DIRECTOR_ID = "glstage-director";

/** How long after the last slider movement a write lands (ms). */
const DEBOUNCE_MS = 200;
/** The relight a light edit plays on every client. */
const LIGHT_TIMING = Object.freeze({ delayMs: 0, durationMs: 600 });
/** A pointer that moved less than this (px) was a click, not a drag. */
const DRAG_SLOP = 4;

/** Session-local view state, kept across close/reopen. */
const view = { tab: "stage", sel: null, castSel: null, castView: "edit", q: { stage: "", cast: "", comms: "" } };

/* ── helpers (Foundry reached only when called) ─────────────────────── */

function L(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const FilePickerClass = () => globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/** Foundry's FilePicker for one image. Resolves the path, or null on cancel. */
function pickImage(current = "") {
  const Picker = FilePickerClass();
  if (!Picker) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const picker = new Picker({ type: "image", current, callback: (path) => { done = true; resolve(path || null); } });
    const close = picker.close?.bind(picker);
    if (close) picker.close = async (...a) => { const r = await close(...a); if (!done) resolve(null); return r; };
    picker.render(true);
  });
}

async function confirmDialog(title, content) {
  const { DialogV2 } = foundry.applications.api;
  try {
    return !!(await DialogV2.confirm({ window: { title }, content: `<p>${content}</p>`, rejectClose: false, modal: true }));
  } catch {
    return false;
  }
}

function dragData(event) {
  const TE = globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  try {
    const d = TE?.getDragEventData?.(event);
    if (d && typeof d === "object" && Object.keys(d).length) return d;
  } catch { /* not JSON */ }
  try { return JSON.parse(event.dataTransfer?.getData("text/plain") || "null"); } catch { return null; }
}

/* ── the app ─────────────────────────────────────────────────────────── */

let _Director = null;

function DirectorApp() {
  if (_Director) return _Director;
  const { ApplicationV2 } = foundry.applications.api;

  _Director = class StageDirector extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: DIRECTOR_ID,
      classes: ["glstage-dir-app"],
      tag: "section",
      window: { title: "GLSTAGE.director.title", icon: "fa-solid fa-theater-masks", resizable: true, minimizable: true },
      position: { width: 900, height: 700 },
      actions: {
        stageTab: function (_e, t) { this._setTab(t.dataset.tab); },
        // stage
        toggleStage: function () { return this._write(() => store.showStage(!store.readState().visible)); },
        spread: function () { return this._write(() => store.spread()); },
        clearStage: function () { return this._write(() => store.clearStage()); },
        wide: function () { return this._write(() => store.closeUp(null)); },
        enter: function (_e, t) { return this._enter(t.dataset.id); },
        enterMasked: function (_e, t) { return this._enter(t.dataset.id, { masked: true }); },
        mask: function (_e, t) {
          const mark = store.readState().on.find((m) => m.id === t.dataset.id);
          if (mark) return this._write(() => store.setMasked(mark.id, !mark.masked));
        },
        exit: function (_e, t) { return this._write(() => store.exit(t.dataset.id)); },
        flip: function (_e, t) {
          const mark = store.readState().on.find((m) => m.id === t.dataset.id);
          if (mark) return this._write(() => store.moveMark(mark.id, { flip: !mark.flip }));
        },
        focus: function (_e, t) {
          const id = t.dataset.id;
          return this._write(() => store.setFocus(store.readState().focus === id ? null : id));
        },
        closeUp: function (_e, t) {
          const { id, cut } = t.dataset;
          const s = store.readState();
          const live = s.shot === "close" && s.close === id && s.cut === cut;
          return this._write(() => store.closeUp(live ? null : id, cut));
        },
        react: function (_e, t) {
          if (!sendReaction(t.dataset.id, t.dataset.kind)) ui.notifications?.warn(L("GLSTAGE.director.stage.reactFailed"));
        },
        pickMark: function (_e, t) { this._selectMark(t.dataset.id); },
        nameplates: function (_e, t) { return this._write(() => store.patchLayout({ nameplates: t.dataset.value })); },
        // cast
        castAdd: function () { return this._addMembers([{ name: L("GLSTAGE.director.cast.newName") }]); },
        castFromTokens: function () { return this._fromTokens(); },
        castSelect: function (_e, t) { this._castSelect(t.dataset.id); },
        castView: function (_e, t) {
          view.castView = t.dataset.value === "lineup" ? "lineup" : "edit";
          this._requestRender(true);
        },
        castDelete: function (_e, t) { return this._deleteMember(t.dataset.id); },
        browseImage: function (_e, t) { return this._browseImage(t.dataset.id); },
        faceAuto: function (_e, t) { return this._write(() => store.upsertMember({ id: t.dataset.id, face: null })); },
        // light
        mood: function (_e, t) { return this._lightPatch({ mood: t.dataset.mood }, true); },
        lightReset: function () { return this._lightReset(); },
        browseSrc: function () { return this._browseSrc(); },
        // A picture's framing and grade belong to that picture, so they go with it.
        clearSrc: function () { return this._lightPatch({ src: null, picture: NEUTRAL_PICTURE }, true); },
        // comms
        toggleComms: function () { return this._write(() => store.showComms(!store.readComms().visible)); },
        clearComms: function () { return this._write(() => store.clearComms()); },
        call: function (_e, t) { return this._call(t.dataset.id); },
        hangUp: function (_e, t) { return this._write(() => store.hangUp(t.dataset.call)); },
        speak: function (_e, t) {
          const id = t.dataset.call;
          return this._write(() => store.speak(store.readComms().speaking === id ? null : id));
        },
        commsSet: function (_e, t) { return this._write(() => store.patchCommsLayout({ [t.dataset.key]: t.dataset.value })); },
        // search: a world Actor not cast yet
        worldEnter: function (_e, t) { return this._fromWorld(t.dataset.uuid, "enter"); },
        worldEnterMasked: function (_e, t) { return this._fromWorld(t.dataset.uuid, "masked"); },
        worldCall: function (_e, t) { return this._fromWorld(t.dataset.uuid, "call"); },
        worldCast: function (_e, t) { return this._fromWorld(t.dataset.uuid, "cast"); },
      },
    };

    _unsubs = [];
    _hooks = [];
    _raf = 0;
    _holding = false;
    _renderPending = false;
    /** key → { ns, id, patch, timer, sceneId } */
    _pending = new Map();
    _chain = Promise.resolve();
    _onWindowUp = null;

    /* ── render: the pure view, no template ── */

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const scene = globalThis.canvas?.scene ?? null;
      const light = scene ? store.readLight(scene) : null;
      const model = directorModel({
        cast: store.readCast(),
        state: store.readState(),
        layout: store.readLayout(),
        comms: store.readComms(),
        commsLayout: store.readCommsLayout(),
        scene: scene ? { id: scene.id, name: scene.name } : null,
        light,
        backdrop: light?.src || store.sceneBackground(scene) || "",
        view,
      }, L);
      view.tab = model.tab;
      view.sel = model.sel;
      view.castSel = model.castSel;
      return { ...context, model };
    }

    async _renderHTML(context) {
      return renderDirector(context.model, L);
    }

    /** Swap the markup in, keeping every scrolled column where the GM left it. */
    _replaceHTML(result, content) {
      const keep = new Map();
      content.querySelectorAll("[data-keep-scroll]").forEach((n) => keep.set(n.dataset.keepScroll, n.scrollTop));
      // A named field keeps focus across the swap, as HandlebarsApplicationMixin did.
      const focus = content.querySelector(":focus");
      content.innerHTML = result;
      content.querySelectorAll("[data-keep-scroll]").forEach((n) => {
        const top = keep.get(n.dataset.keepScroll);
        if (top) n.scrollTop = top;
      });
      if (focus?.name) content.querySelector(`${focus.tagName}[name="${CSS.escape(focus.name)}"]`)?.focus();
    }

    /* ── lifecycle ── */

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      this._unsubs.push(onStageSetting((kind) => { if (kind !== "quality") this._requestRender(); }));
      const on = (name, fn) => this._hooks.push([name, Hooks.on(name, fn)]);
      on("updateScene", (scene, changes) => {
        if (scene?.id !== globalThis.canvas?.scene?.id) return;
        if (changes?.flags !== undefined || changes?.background !== undefined || changes?.name !== undefined) this._requestRender();
      });
      on("updateLevel", (level, changes) => {
        if (level?.parent?.id === globalThis.canvas?.scene?.id && changes?.background !== undefined) this._requestRender();
      });
      on("canvasReady", () => this._requestRender());

      // Delegated listeners on the frame, which survives re-renders.
      const el = this.element;
      el.addEventListener("pointerdown", (ev) => this._onPointerDown(ev));
      el.addEventListener("input", (ev) => this._onInput(ev));
      el.addEventListener("keydown", (ev) => this._onSearchKey(ev));
      el.addEventListener("change", (ev) => this._onChange(ev));
      el.addEventListener("focusout", () => queueMicrotask(() => this._maybeFlushRender()));
      el.addEventListener("dragover", (ev) => this._onDragOver(ev));
      el.addEventListener("dragleave", (ev) => { if (!el.contains(ev.relatedTarget)) el.classList.remove("is-drop"); });
      el.addEventListener("drop", (ev) => this._onDrop(ev));
      el.addEventListener("submit", (ev) => ev.preventDefault());
      this._onWindowUp = () => {
        if (!this._holding) return;
        this._holding = false;
        this._maybeFlushRender();
      };
      window.addEventListener("pointerup", this._onWindowUp, true);
      window.addEventListener("pointercancel", this._onWindowUp, true);
    }

    async _preRender(context, options) {
      await super._preRender?.(context, options);
      const a = document.activeElement;
      this._refocus = a?.dataset?.dirSearch && this.element?.contains(a)
        ? { pane: a.dataset.dirSearch, start: a.selectionStart, end: a.selectionEnd } : null;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._renderPending = false;
      for (const pane of SEARCH_PANES) this._applySearch(pane);
      if (this._refocus) {
        const input = this.element.querySelector(`[data-dir-search="${this._refocus.pane}"]`);
        input?.focus({ preventScroll: true });
        try { input?.setSelectionRange(this._refocus.start, this._refocus.end); } catch { /* not a text input */ }
        this._refocus = null;
      }
      // Auto-frame thumbnails that have no manual face point. Lazy: the locator is
      // a browser-only module and nothing here should load it until it is drawn.
      const imgs = this.element.querySelectorAll("img[data-auto-face]");
      if (imgs.length) {
        import("../../../core/face-frame.mjs")
          .then(({ frameImage }) => imgs.forEach((img) => frameImage(img, "token-square")))
          .catch(() => {});
      }
    }

    _onClose(options) {
      for (const key of [...this._pending.keys()]) this._flush(key);
      super._onClose(options);
      for (const off of this._unsubs) off();
      this._unsubs = [];
      for (const [name, id] of this._hooks) Hooks.off(name, id);
      this._hooks = [];
      if (this._onWindowUp) {
        window.removeEventListener("pointerup", this._onWindowUp, true);
        window.removeEventListener("pointercancel", this._onWindowUp, true);
      }
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    /* ── rendering ── */

    /** True while re-rendering would destroy something the GM is holding or typing in. */
    _busy() {
      if (this._holding || this._pending.size) return true;
      const a = document.activeElement;
      return !!(a && this.element?.contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && /^(text|search|url|number)$/i.test(a.type))));
    }

    /** Re-render next frame, or once the GM lets go. `force` skips the hold. */
    _requestRender(force = false) {
      if (!force && this._busy()) { this._renderPending = true; return; }
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (!this.rendered) return;
        if (!force && this._busy()) { this._renderPending = true; return; }
        this.render();
      });
    }

    _maybeFlushRender() {
      if (this._renderPending && !this._busy()) this._requestRender();
    }

    _setTab(tab) {
      if (!TABS.includes(tab)) return;
      view.tab = tab;
      const root = this.element;
      root.querySelector(".glstage-dir")?.setAttribute("data-tab", tab);
      root.querySelectorAll(".glstage-dir-tab").forEach((b) => {
        const on = b.dataset.tab === tab;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      root.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    }

    /* ── writes ── */

    /** Run a write after every write queued before it. Errors are reported, never thrown. */
    _write(fn) {
      this._chain = this._chain.then(fn).catch((e) => {
        warn("stage | director write failed", e);
        ui.notifications?.error(L("GLSTAGE.director.writeFailed"));
      });
      return this._chain;
    }

    /** Merge a patch into a pending debounced write; `now` writes at once. */
    _queuePatch(ns, id, patch, now = false) {
      const key = `${ns}|${id ?? ""}`;
      const entry = this._pending.get(key) ?? { ns, id, patch: {}, timer: 0, sceneId: ns === "light" ? id : null };
      Object.assign(entry.patch, patch);
      clearTimeout(entry.timer);
      this._pending.set(key, entry);
      if (now) this._flush(key);
      else entry.timer = setTimeout(() => this._flush(key), DEBOUNCE_MS);
    }

    _flush(key) {
      const entry = this._pending.get(key);
      if (!entry) return this._chain;
      clearTimeout(entry.timer);
      this._pending.delete(key);
      const { ns, id, patch, sceneId } = entry;
      const run = () => {
        switch (ns) {
          case "layout": return store.patchLayout(patch);
          case "commsLayout": return store.patchCommsLayout(patch);
          case "member": return id ? store.upsertMember({ id, ...patch }) : null;
          case "light": {
            const scene = sceneId ? game.scenes?.get(sceneId) : null;
            return scene ? store.patchLight(scene, patch, LIGHT_TIMING) : null;
          }
          default: return null;
        }
      };
      return this._write(run).then(() => this._maybeFlushRender());
    }

    /** A light edit, pinned to the scene it was made on (pending per scene). */
    _lightPatch(patch, now = false, sceneId = globalThis.canvas?.scene?.id ?? null) {
      if (!sceneId) return null;
      this._queuePatch("light", sceneId, patch, now);
      return null;
    }

    async _lightReset() {
      const scene = globalThis.canvas?.scene;
      if (!scene) return;
      const key = `light|${scene.id}`;
      if (this._pending.has(key)) { clearTimeout(this._pending.get(key).timer); this._pending.delete(key); }
      // Reset is the light's dials. The picture stays: on a Theatre scene it is
      // the shot on screen, and the scene's own background there is black.
      const { src, picture } = store.readLight(scene);
      await this._write(() => store.writeLight(scene, { ...DEFAULT_LIGHT, src, picture }, LIGHT_TIMING));
    }

    /* ── input routing: data-bind="ns:key" (+ data-member) ── */

    _readInput(input) {
      if (input.type === "checkbox") return input.checked;
      if (input.type === "range" || input.type === "number") {
        const n = Number(input.value);
        return Number.isFinite(n) ? n : null;
      }
      return input.value;
    }

    _onInput(ev) {
      const input = ev.target;
      const pane = input?.dataset?.dirSearch;
      if (pane) {
        view.q[pane] = input.value;
        this._applySearch(pane);
        return;
      }
      const bind = input?.dataset?.bind;
      if (!bind) return;
      if (input.type === "range") this._preview(input);
      // Only sliders and colour wells write while moving; text commits on change.
      if (input.type === "range" || input.type === "color") this._route(input, false);
    }

    _onChange(ev) {
      const input = ev.target;
      if (!input?.dataset?.bind) return;
      if (input.type === "range") this._preview(input);
      this._route(input, true);
    }

    /** Update a slider's readout (and any live figure it drives) without a render. */
    _preview(input) {
      const row = input.closest("[data-dial]");
      const out = row?.querySelector("output");
      if (out) out.textContent = fmt(input.dataset.fmt, input.value);
      input.style.setProperty("--fill", `${fillOf(input.value, input.min, input.max)}%`);
      const [ns, key] = input.dataset.bind.split(":");
      if (ns === "face" && key === "h") {
        const ring = this.element.querySelector("[data-face-ring]");
        if (ring) ring.style.height = `${r3(Number(input.value) * 100)}%`;
      }
      if (ns === "member" && key === "height") {
        // Keep every slider for this character in step (the editor and the lineup).
        const id = input.dataset.member;
        this.element.querySelectorAll(`input[data-bind="member:height"][data-member="${CSS.escape(id)}"]`).forEach((other) => {
          if (other === input) return;
          other.value = input.value;
          const o = other.closest("[data-dial]")?.querySelector("output");
          if (o) o.textContent = fmt(other.dataset.fmt, other.value);
          other.style.setProperty("--fill", `${fillOf(other.value, other.min, other.max)}%`);
        });
        const box = this.element.querySelector(`[data-lineup-box="${CSS.escape(id)}"]`);
        const unit = Number(this.element.querySelector("[data-lineup]")?.dataset.unit) || LINEUP_UNIT;
        if (box) box.style.height = `${r3(Number(input.value) * unit * 100)}%`;
      }
      if (ns === "member" && (key === "offsetX" || key === "offsetY")) {
        const id = input.dataset.member;
        const img = this.element.querySelector(`[data-lineup-box="${CSS.escape(id)}"] img`);
        const form = input.closest("form");
        if (img && form) {
          const x = Number(form.querySelector("[data-bind='member:offsetX']")?.value) || 0;
          const y = Number(form.querySelector("[data-bind='member:offsetY']")?.value) || 0;
          img.style.translate = `${r3(x * 100)}% ${r3(-y * 100)}%`;
        }
      }
    }

    _route(input, now) {
      const [ns, key] = input.dataset.bind.split(":");
      const value = this._readInput(input);
      if (value === null) return;
      switch (ns) {
        case "layout":
        case "commsLayout":
          this._queuePatch(ns, null, { [key]: value }, now);
          break;
        case "member": {
          const id = input.dataset.member;
          if (!id) return;
          this._queuePatch("member", id, { [key]: value }, now);
          break;
        }
        case "face": {
          const id = input.dataset.member;
          const m = id ? store.readMember(id) : null;
          if (!m?.face) return;
          this._queuePatch("member", id, { face: { ...m.face, h: value } }, now);
          break;
        }
        case "light": {
          if (key === "angleAuto") {
            const slider = this.element.querySelector("[data-bind='light:angle']");
            if (slider) slider.disabled = !!value;
            this._lightPatch({ angle: value ? null : Number(slider?.value ?? 0) }, true);
            break;
          }
          this._lightPatch({ [key]: value }, now);
          break;
        }
        default:
          break;
      }
    }

    /* ── pointer: the stage strip and the face point ── */

    _onPointerDown(ev) {
      if (ev.button !== 0) return;
      this._holding = true;
      const fig = ev.target.closest?.("[data-fig]");
      if (fig && !ev.target.closest("button")) return this._dragFigure(ev, fig);
      const pick = ev.target.closest?.("[data-face-pick]");
      if (pick) return this._pickFace(ev, pick);
      return null;
    }

    _dragFigure(ev, fig) {
      const track = fig.closest("[data-track]");
      if (!track) return;
      ev.preventDefault();
      const id = fig.dataset.fig;
      const x0 = Number(fig.dataset.x) || 0;
      const d0 = Number(fig.dataset.depth) || 0;
      const h = Number(fig.dataset.height) || 1;
      const figure = Number(track.dataset.figure) || 1;
      const sx = ev.clientX;
      const sy = ev.clientY;
      let moved = false;
      let x = x0;
      let depth = d0;
      fig.setPointerCapture?.(ev.pointerId);
      fig.classList.add("is-dragging");
      // The same box the view draws, so a figure lands where it was dropped.
      const place = () => {
        const b = figureBox(x, depth, h, figure);
        fig.style.left = `${b.left}%`;
        fig.style.bottom = `${b.bottom}%`;
        fig.style.height = `${b.height}%`;
        fig.style.zIndex = String(b.z);
      };
      const move = (e) => {
        const r = track.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
        moved = true;
        x = clamp(x0 + dx / r.width, 0, 1);
        depth = clamp(d0 - dy / (r.height * STRIP.rise), 0, 1);
        place();
      };
      const up = () => {
        fig.removeEventListener("pointermove", move);
        fig.removeEventListener("pointerup", up);
        fig.removeEventListener("pointercancel", up);
        fig.classList.remove("is-dragging");
        if (moved) this._write(() => store.moveMark(id, { x: r3(x), depth: r3(depth) }));
        else this._selectMark(id);
      };
      fig.addEventListener("pointermove", move);
      fig.addEventListener("pointerup", up);
      fig.addEventListener("pointercancel", up);
    }

    _selectMark(id) {
      view.sel = view.sel === id ? null : id;
      this.element.querySelectorAll("[data-fig], [data-mark-row]").forEach((n) => {
        n.classList.toggle("is-selected", (n.dataset.fig ?? n.dataset.markRow) === view.sel);
      });
      if (view.sel) this.element.querySelector(`[data-mark-row="${CSS.escape(view.sel)}"]`)?.scrollIntoView({ block: "nearest" });
    }

    _pickFace(ev, box) {
      const img = box.querySelector("img");
      const id = box.dataset.facePick;
      if (!img || !id) return;
      ev.preventDefault();
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = clamp((ev.clientX - r.left) / r.width, 0, 1);
      const y = clamp((ev.clientY - r.top) / r.height, 0, 1);
      const m = store.readMember(id);
      const h = m?.face?.h ?? (Number(this.element.querySelector("[data-bind='face:h']")?.value) || DEFAULT_FACE_H);
      const ring = box.querySelector("[data-face-ring]");
      if (ring) {
        ring.hidden = false;
        ring.style.left = `${r3(x * 100)}%`;
        ring.style.top = `${r3(y * 100)}%`;
        ring.style.height = `${r3(h * 100)}%`;
      }
      this._write(() => store.upsertMember({ id, face: { x: r3(x), y: r3(y), h } }));
    }

    /* ── cast ── */

    _castSelect(id) {
      view.castSel = id;
      if (view.castView === "lineup") view.castView = "edit";
      this._requestRender(true);
    }

    /** Add characters one write at a time, then select the first one added. */
    async _addMembers(list) {
      let first = null;
      let added = 0;
      for (const raw of list) {
        const id = await this._write(() => store.upsertMember(raw));
        if (!id) continue;
        first ??= id;
        added++;
      }
      if (first) {
        view.castSel = first;
        view.castView = "edit";
        view.tab = "cast";
      }
      this._requestRender(true);
      return added;
    }

    async _fromTokens() {
      const tokens = globalThis.canvas?.tokens?.controlled ?? [];
      if (!tokens.length) return ui.notifications?.warn(L("GLSTAGE.director.cast.noTokens"));
      const known = new Set(store.readCast().map((m) => m.actorUuid).filter(Boolean));
      const list = [];
      let skipped = 0;
      for (const t of tokens) {
        const raw = memberFromActor(t.actor, t);
        if (raw.actorUuid && known.has(raw.actorUuid)) { skipped++; continue; }
        if (raw.actorUuid) known.add(raw.actorUuid);
        list.push(raw);
      }
      if (list.length) await this._addMembers(list);
      ui.notifications?.info(L("GLSTAGE.director.cast.imported", { n: list.length, skipped }));
      return list.length;
    }

    _onDragOver(ev) {
      if (!Array.from(ev.dataTransfer?.types ?? []).includes("text/plain")) return;
      ev.preventDefault();
      this.element.classList.add("is-drop");
    }

    async _onDrop(ev) {
      this.element.classList.remove("is-drop");
      const data = dragData(ev);
      if (!data || data.type !== "Actor" || !data.uuid) return;
      ev.preventDefault();
      ev.stopPropagation();
      const actor = await fromUuid(data.uuid).catch(() => null);
      if (!actor) return ui.notifications?.warn(L("GLSTAGE.director.cast.dropFailed"));
      const existing = store.readCast().find((m) => m.actorUuid && m.actorUuid === actor.uuid);
      if (existing) {
        ui.notifications?.info(L("GLSTAGE.director.cast.alreadyCast", { name: existing.name }));
        view.castSel = existing.id;
        view.tab = "cast";
        view.castView = "edit";
        return this._requestRender(true);
      }
      return this._addMembers([memberFromActor(actor)]);
    }

    async _deleteMember(id) {
      const m = store.readMember(id);
      if (!m) return;
      const ok = await confirmDialog(L("GLSTAGE.director.cast.deleteTitle"), L("GLSTAGE.director.cast.deleteBody", { name: escapeHTML(m.name) }));
      if (!ok) return;
      await this._write(() => store.removeMember(id));
      if (view.castSel === id) view.castSel = null;
      this._requestRender(true);
    }

    async _browseImage(id) {
      const m = store.readMember(id);
      if (!m) return;
      const path = await pickImage(m.image === DEFAULT_IMAGE ? "" : m.image);
      if (path) await this._write(() => store.upsertMember({ id, image: path }));
    }

    async _browseSrc() {
      const scene = globalThis.canvas?.scene;
      if (!scene) return;
      const path = await pickImage(store.readLight(scene).src ?? "");
      // The scene the picker was opened for, not whichever is viewed now.
      if (path) this._lightPatch({ src: path, picture: NEUTRAL_PICTURE }, true, scene.id);
    }

    /* ── search ── */

    /** The roster a search box filters. */
    _searchRoot(pane) {
      return this.element?.querySelector(`[data-dir-search="${pane}"]`)?.closest(".glstage-dir-side") ?? null;
    }

    /** Show the rows the search allows, and the world's Actors that match. */
    _applySearch(pane) {
      const root = this._searchRoot(pane);
      if (!root) return;
      const q = view.q[pane] ?? "";
      const active = !!q.trim();
      let n = 0;
      for (const r of root.querySelectorAll("[data-search-row]")) {
        const ok = matchesQuery(r.dataset.haystack ?? "", q);
        r.hidden = !ok;
        if (ok) n++;
      }
      root.querySelector(".glstage-dir-search")?.classList.toggle("is-active", active);
      root.querySelectorAll("[data-search-empty]").forEach((e) => { e.hidden = active; });
      const world = this._renderWorld(root, pane, q);
      const none = root.querySelector("[data-no-match]");
      if (none) none.hidden = !(active && !n && !world);
    }

    /** Fill the pane's "from the world" list. Returns how many Actors it offers. */
    _renderWorld(root, pane, q) {
      const box = root.querySelector(`[data-world="${pane}"]`);
      const list = box?.querySelector("[data-world-list]");
      if (!list) return 0;
      const actors = searchWorldActors(q);
      list.replaceChildren(...actors.map((a) => this._worldRow(a, pane)));
      box.hidden = !actors.length;
      return actors.length;
    }

    /** One world Actor's row. The view escapes the name; an actor's name is never markup. */
    _worldRow(actor, pane) {
      const m = memberFromActor(actor);
      const typeLabel = globalThis.CONFIG?.Actor?.typeLabels?.[actor.type];
      const tpl = document.createElement("template");
      tpl.innerHTML = worldRowHTML({ uuid: actor.uuid, name: m.name, image: m.image, type: typeLabel ? L(typeLabel) : actor.type ?? "" }, pane, L);
      return tpl.content.firstElementChild;
    }

    /** Enter acts on the first match (Shift+Enter: masked); Esc clears, then lets go. */
    _onSearchKey(ev) {
      const input = ev.target;
      const pane = input?.dataset?.dirSearch;
      if (!pane) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        if (input.value) {
          input.value = "";
          view.q[pane] = "";
          this._applySearch(pane);
        } else input.blur();
        return;
      }
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const root = this._searchRoot(pane);
      if (!root) return;
      // The first cast row that can act (not already on stage / on a call), else the first world Actor.
      const row = root.querySelector("[data-search-row][data-ready]:not([hidden])");
      const world = root.querySelector("[data-world-row]");
      const masked = ev.shiftKey;
      if (pane === "cast") {
        if (row) this._castSelect(row.dataset.searchRow);
        else if (world) this._fromWorld(world.dataset.worldRow, "cast");
        return;
      }
      if (row) {
        const id = row.dataset.searchRow;
        this._write(() => (pane === "comms" ? callIn(id) : bringOn(id, { masked }))).then(() => this._requestRender(true));
      } else if (world) {
        this._fromWorld(world.dataset.worldRow, pane === "comms" ? "call" : masked ? "masked" : "enter");
      }
    }

    /** Cast a world Actor (once), then bring them on, call them in, or open them in the Cast tab. */
    async _fromWorld(uuid, how) {
      const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
      if (!actor) return ui.notifications?.warn(L("GLSTAGE.director.cast.dropFailed"));
      const id = await this._write(() => castActor(actor));
      if (id && (how === "enter" || how === "masked")) await this._write(() => bringOn(id, { masked: how === "masked" }));
      else if (id && how === "call") await this._write(() => callIn(id));
      else if (id) {
        view.castSel = id;
        view.castView = "edit";
      }
      return this._requestRender(true);
    }

    /* ── stage / comms ── */

    _enter(id, { masked = false } = {}) {
      return this._write(() => bringOn(id, { masked }));
    }

    _call(id) {
      return this._write(() => callIn(id));
    }
  };

  return _Director;
}

/* ── openers ─────────────────────────────────────────────────────────── */

const instance = () => globalThis.foundry?.applications?.instances?.get(DIRECTOR_ID) ?? null;

/** Open the Director (GM only), optionally on a tab. Singleton: re-focuses an open one. */
export async function openDirector(tab = null) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(L("GLSTAGE.director.gmOnly"));
    return null;
  }
  if (tab && TABS.includes(tab)) view.tab = tab;
  const existing = instance();
  if (existing) {
    if (tab) existing._setTab(tab);
    existing.bringToFront?.();
    if (existing.minimized) await existing.maximize?.();
    return existing;
  }
  const Cls = DirectorApp();
  const app = new Cls();
  await app.render({ force: true });
  return app;
}

export function closeDirector() {
  return instance()?.close() ?? null;
}

export function toggleDirector(tab = null) {
  return instance() ? closeDirector() : openDirector(tab);
}

export const isDirectorOpen = () => !!instance();
