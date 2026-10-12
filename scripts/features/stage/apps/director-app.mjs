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

import { featurePath, warn } from "../../../core/const.mjs";
import { escapeHTML } from "../../../core/util.mjs";
import {
  COMMS_ALIGN, COMMS_EDGES, COMMS_STYLES, DEFAULT_IMAGE, FEATURE_ID, MAX_CALLS, MAX_ON_STAGE, NAMEPLATES, REACTIONS,
} from "../model.mjs";
import { DEFAULT_LIGHT, LIGHT_DIALS, MOODS } from "../light/rig.mjs";
import { onStageSetting } from "../settings.mjs";
import * as store from "../store.mjs";
import { sendReaction } from "../channel.mjs";

export const DIRECTOR_ID = "glstage-director";

const TEMPLATE = featurePath(FEATURE_ID, "templates/director.hbs");
const TABS = Object.freeze(["stage", "cast", "light", "comms"]);

/** How long after the last slider movement a write lands (ms). */
const DEBOUNCE_MS = 200;
/** The relight a light edit plays on every client. */
const LIGHT_TIMING = Object.freeze({ delayMs: 0, durationMs: 600 });
/** A pointer that moved less than this (px) was a click, not a drag. */
const DRAG_SLOP = 4;
/** A face point placed without a size gets this head height (image fraction). */
const DEFAULT_FACE_H = 0.16;

/* Stage strip geometry, in fractions of the strip: where the front row's feet
   stand, how far up the upstage row is, how tall a height-1 figure draws at
   figure 1, and how much smaller the back row is. */
const STRIP = Object.freeze({ foot: 0.06, rise: 0.42, figure: 0.62, shrink: 0.38 });
/** The lineup: a height-1 character's box, as a fraction of the lineup's height. */
const LINEUP_UNIT = 0.44;

const REACTION_ICONS = Object.freeze({
  nod: "fa-solid fa-angles-down",
  shake: "fa-solid fa-arrows-left-right",
  hop: "fa-solid fa-arrow-up",
  tremble: "fa-solid fa-wave-square",
  lean: "fa-solid fa-person-walking-arrow-right",
});
const MOOD_ICONS = Object.freeze({
  auto: "fa-solid fa-wand-magic-sparkles",
  day: "fa-solid fa-sun",
  golden: "fa-solid fa-cloud-sun",
  dusk: "fa-solid fa-mountain-sun",
  night: "fa-solid fa-moon",
  fire: "fa-solid fa-fire",
  neon: "fa-solid fa-bolt",
  storm: "fa-solid fa-cloud-bolt",
  off: "fa-solid fa-power-off",
});
const EDGE_ICONS = Object.freeze({ left: "fa-solid fa-arrow-left", right: "fa-solid fa-arrow-right" });
const ALIGN_ICONS = Object.freeze({ top: "fa-solid fa-arrow-up", center: "fa-solid fa-grip-lines", bottom: "fa-solid fa-arrow-down" });

/** Session-local view state, kept across close/reopen. */
const view = { tab: "stage", sel: null, castSel: null, castView: "edit" };

/* ── helpers (Foundry reached only when called) ─────────────────────── */

function L(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Format a dial's value for its readout. */
function fmt(kind, v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  switch (kind) {
    case "pct": return `${Math.round(n * 100)}%`;
    case "spct": return `${n > 0 ? "+" : ""}${Math.round(n * 100)}%`;
    case "x": return `×${n.toFixed(2)}`;
    case "px": return `${Math.round(n)}px`;
    case "vh": return `${n > 0 ? "+" : ""}${Math.round(n)}vh`;
    case "deg": return `${Math.round(n)}°`;
    default: return n.toFixed(2);
  }
}

/** A dial row for the template. */
function dial(ns, key, value, { min, max, step = 0.01, kind = "num", label, hint = "", member = null, disabled = false }) {
  return { ns, key, value, min, max, step, kind, label, hint, member, disabled, out: fmt(kind, value) };
}

/** `object-position` for a manual face point; empty when the locator frames it. */
const facePosition = (m) => (m.face ? `object-position: ${r3(m.face.x * 100)}% ${r3(m.face.y * 100)}%` : "");

function thumb(m) {
  return { src: m.image || DEFAULT_IMAGE, style: facePosition(m), auto: !m.face };
}

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

const DEFAULT_ARTS = () => new Set([DEFAULT_IMAGE, globalThis.CONST?.DEFAULT_TOKEN, "icons/svg/mystery-man.svg"].filter(Boolean));

/** The art to stand on stage: the actor's portrait, unless it is a placeholder. */
function pickArt(actorImg, tokenImg) {
  const defaults = DEFAULT_ARTS();
  if (actorImg && !defaults.has(actorImg)) return actorImg;
  if (tokenImg && !defaults.has(tokenImg)) return tokenImg;
  return actorImg || tokenImg || DEFAULT_IMAGE;
}

/** The cast entry for an actor (and optionally the token it stood on). */
function memberFromActor(actor, token = null) {
  const doc = token?.document ?? token ?? null;
  const uuid = doc && !doc.actorLink ? (doc.baseActor?.uuid ?? actor?.uuid) : actor?.uuid;
  return {
    name: doc?.name || actor?.name || L("GLSTAGE.director.cast.newName"),
    image: pickArt(actor?.img, doc?.texture?.src),
    actorUuid: uuid ?? null,
  };
}

/* ── the app ─────────────────────────────────────────────────────────── */

let _Director = null;

function DirectorApp() {
  if (_Director) return _Director;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _Director = class StageDirector extends HandlebarsApplicationMixin(ApplicationV2) {
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
          view.castView = t.dataset.view === "lineup" ? "lineup" : "edit";
          this._requestRender(true);
        },
        castDelete: function (_e, t) { return this._deleteMember(t.dataset.id); },
        browseImage: function (_e, t) { return this._browseImage(t.dataset.id); },
        faceAuto: function (_e, t) { return this._write(() => store.upsertMember({ id: t.dataset.id, face: null })); },
        // light
        mood: function (_e, t) { return this._lightPatch({ mood: t.dataset.mood }, true); },
        lightReset: function () { return this._lightReset(); },
        browseSrc: function () { return this._browseSrc(); },
        clearSrc: function () { return this._lightPatch({ src: null }, true); },
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
      },
    };

    static PARTS = {
      main: {
        template: TEMPLATE,
        scrollable: [".glstage-dir-pane--stage", ".glstage-dir-cast-list", ".glstage-dir-cast-detail", ".glstage-dir-pane--light", ".glstage-dir-pane--comms"],
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

    /* ── context ── */

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const cast = store.readCast();
      const state = store.readState();
      const layout = store.readLayout();
      const comms = store.readComms();
      const commsLayout = store.readCommsLayout();
      const byId = new Map(cast.map((m) => [m.id, m]));
      const onIds = new Set(state.on.map((m) => m.id));
      const full = state.on.length >= MAX_ON_STAGE;

      if (view.sel && !onIds.has(view.sel)) view.sel = null;
      if (!view.castSel || !byId.has(view.castSel)) view.castSel = cast[0]?.id ?? null;
      if (!TABS.includes(view.tab)) view.tab = "stage";

      const scene = globalThis.canvas?.scene ?? null;
      const light = scene ? store.readLight(scene) : null;
      const backdrop = light?.src || store.sceneBackground(scene);

      /* stage */
      const marks = state.on.map((mark) => {
        const m = byId.get(mark.id);
        const scale = 1 - STRIP.shrink * mark.depth;
        return {
          id: mark.id,
          name: m?.name ?? mark.id,
          title: m?.title ?? "",
          thumb: thumb(m ?? {}),
          src: m?.image || DEFAULT_IMAGE,
          flip: mark.flip,
          focus: state.focus === mark.id,
          closePush: state.shot === "close" && state.close === mark.id && state.cut === "push",
          closeCut: state.shot === "close" && state.close === mark.id && state.cut === "cut",
          selected: view.sel === mark.id,
          figStyle: [
            `left: ${r3(mark.x * 100)}%`,
            `bottom: ${r3((STRIP.foot + STRIP.rise * mark.depth) * 100)}%`,
            `height: ${r3(clamp((m?.height ?? 1) * layout.figure * STRIP.figure * scale, 0.05, 1.2) * 100)}%`,
            `z-index: ${Math.round((1 - mark.depth) * 100) + 1}`,
          ].join("; "),
          x: mark.x,
          depth: mark.depth,
          height: m?.height ?? 1,
          tint: m?.tint ?? "",
        };
      });
      const closeName = state.shot === "close" ? byId.get(state.close)?.name ?? null : null;
      const focusName = state.focus ? byId.get(state.focus)?.name ?? null : null;

      const stage = {
        visible: state.visible,
        marks,
        any: marks.length > 0,
        full,
        count: L("GLSTAGE.director.stage.count", { n: state.on.length, max: MAX_ON_STAGE }),
        shotLabel: closeName ? L("GLSTAGE.director.stage.shotClose", { name: closeName }) : L("GLSTAGE.director.stage.shotWide"),
        focusLabel: focusName ? L("GLSTAGE.director.stage.focusOn", { name: focusName }) : null,
        isClose: !!closeName,
        figure: layout.figure,
        trackStyle: `left: ${r3(((1 - layout.width) / 2) * 100)}%; right: ${r3(((1 - layout.width) / 2) * 100)}%`,
        backdrop,
        roster: cast.map((m) => ({ id: m.id, name: m.name, title: m.title, thumb: thumb(m), on: onIds.has(m.id), canEnter: !onIds.has(m.id) && !full })),
        layout: [
          dial("layout", "figure", layout.figure, { min: 0.4, max: 1.4, kind: "pct", label: L("GLSTAGE.director.layout.figure"), hint: L("GLSTAGE.director.layout.figureHint") }),
          dial("layout", "floor", layout.floor, { min: -0.5, max: 0.4, kind: "spct", label: L("GLSTAGE.director.layout.floor"), hint: L("GLSTAGE.director.layout.floorHint") }),
          dial("layout", "width", layout.width, { min: 0.4, max: 1, kind: "pct", label: L("GLSTAGE.director.layout.width"), hint: L("GLSTAGE.director.layout.widthHint") }),
        ],
        nameplates: NAMEPLATES.map((v) => ({ value: v, label: L(`GLSTAGE.nameplates.${v}`), active: layout.nameplates === v })),
      };
      const reactions = REACTIONS.map((kind) => ({ kind, label: L(`GLSTAGE.reaction.${kind}`), icon: REACTION_ICONS[kind] ?? "fa-solid fa-circle" }));

      /* cast */
      const sel = view.castSel ? byId.get(view.castSel) : null;
      const maxH = Math.max(1, ...cast.map((m) => m.height));
      const unit = Math.min(LINEUP_UNIT, 0.94 / maxH);
      const castCtx = {
        any: cast.length > 0,
        view: view.castView,
        lineup: view.castView === "lineup",
        unit,
        list: cast.map((m) => ({ id: m.id, name: m.name, title: m.title, thumb: thumb(m), active: m.id === view.castSel, on: onIds.has(m.id), linked: !!m.actorUuid })),
        sel: sel ? {
          ...sel,
          src: sel.image || DEFAULT_IMAGE,
          faces: ["left", "right", "front"].map((f) => ({ value: f, label: L(`GLSTAGE.director.cast.faces.${f}`), selected: sel.faces === f })),
          dials: [
            dial("member", "height", sel.height, { min: 0.3, max: 2, kind: "x", label: L("GLSTAGE.director.cast.height"), hint: L("GLSTAGE.director.cast.heightHint"), member: sel.id }),
            dial("member", "offsetX", sel.offsetX, { min: -1, max: 1, kind: "spct", label: L("GLSTAGE.director.cast.offsetX"), hint: L("GLSTAGE.director.cast.offsetXHint"), member: sel.id }),
            dial("member", "offsetY", sel.offsetY, { min: -1, max: 1, kind: "spct", label: L("GLSTAGE.director.cast.offsetY"), hint: L("GLSTAGE.director.cast.offsetYHint"), member: sel.id }),
          ],
          hasFace: !!sel.face,
          faceStyle: sel.face ? `left: ${r3(sel.face.x * 100)}%; top: ${r3(sel.face.y * 100)}%; height: ${r3(sel.face.h * 100)}%` : "",
          faceH: dial("face", "h", sel.face?.h ?? DEFAULT_FACE_H, { min: 0.03, max: 0.8, kind: "pct", label: L("GLSTAGE.director.cast.faceSize"), member: sel.id, disabled: !sel.face }),
          onStage: onIds.has(sel.id),
        } : null,
        lineupGuides: [0.5, 1, 1.5, 2].filter((h) => h * unit <= 0.97).map((h) => ({ label: `×${h}`, style: `bottom: ${r3(h * unit * 100)}%` })),
        lineupItems: cast.map((m) => ({
          id: m.id,
          name: m.name,
          src: m.image || DEFAULT_IMAGE,
          active: m.id === view.castSel,
          boxStyle: `height: ${r3(m.height * unit * 100)}%`,
          imgStyle: `translate: ${r3(m.offsetX * 100)}% ${r3(-m.offsetY * 100)}%`,
          height: dial("member", "height", m.height, { min: 0.3, max: 2, kind: "x", label: L("GLSTAGE.director.cast.height"), member: m.id }),
        })),
      };

      /* light */
      const lightCtx = scene ? {
        scene: scene.name || scene.id,
        moods: MOODS.map((mood) => ({ mood, label: L(`GLSTAGE.mood.${mood}`), icon: MOOD_ICONS[mood] ?? "fa-solid fa-lightbulb", active: light.mood === mood })),
        dials: Object.entries(LIGHT_DIALS).map(([key, [min, max]]) => dial("light", key, light[key], {
          min, max, kind: max > 1 ? "num" : "pct", label: L(`GLSTAGE.light.${key}.name`), hint: L(`GLSTAGE.light.${key}.hint`),
        })),
        angleAuto: light.angle === null,
        angle: dial("light", "angle", light.angle ?? 0, { min: -180, max: 180, step: 1, kind: "deg", label: L("GLSTAGE.director.light.angle"), hint: L("GLSTAGE.director.light.angleHint"), disabled: light.angle === null }),
        darkness: light.darkness,
        flicker: light.flicker,
        src: light.src ?? "",
        hasSrc: !!light.src,
        off: light.mood === "off",
      } : null;

      /* comms */
      const callCast = new Set(comms.calls.map((c) => c.castId));
      const commsCtx = {
        visible: comms.visible,
        any: comms.calls.length > 0,
        count: L("GLSTAGE.director.comms.count", { n: comms.calls.length, max: MAX_CALLS }),
        calls: comms.calls.map((c) => {
          const m = byId.get(c.castId);
          return { callId: c.callId, castId: c.castId, name: m?.name ?? c.castId, title: m?.title ?? "", thumb: thumb(m ?? {}), speaking: comms.speaking === c.callId };
        }),
        roster: cast.map((m) => ({ id: m.id, name: m.name, thumb: thumb(m), calling: callCast.has(m.id), canCall: !callCast.has(m.id) && comms.calls.length < MAX_CALLS })),
        edges: COMMS_EDGES.map((v) => ({ key: "edge", value: v, label: L(`GLSTAGE.comms.edge.${v}`), icon: EDGE_ICONS[v], active: commsLayout.edge === v })),
        aligns: COMMS_ALIGN.map((v) => ({ key: "align", value: v, label: L(`GLSTAGE.comms.align.${v}`), icon: ALIGN_ICONS[v], active: commsLayout.align === v })),
        styles: COMMS_STYLES.map((v) => ({ key: "style", value: v, label: L(`GLSTAGE.comms.style.${v}`), active: commsLayout.style === v })),
        dials: [
          dial("commsLayout", "width", commsLayout.width, { min: 120, max: 320, step: 1, kind: "px", label: L("GLSTAGE.director.comms.width") }),
          dial("commsLayout", "inset", commsLayout.inset, { min: 0, max: 240, step: 1, kind: "px", label: L("GLSTAGE.director.comms.inset"), hint: L("GLSTAGE.director.comms.insetHint") }),
          dial("commsLayout", "shift", commsLayout.shift, { min: -40, max: 40, step: 1, kind: "vh", label: L("GLSTAGE.director.comms.shift"), hint: L("GLSTAGE.director.comms.shiftHint") }),
        ],
      };

      return {
        ...context,
        tab: view.tab,
        tabs: TABS.map((t) => ({ id: t, label: L(`GLSTAGE.director.tab.${t}`), active: view.tab === t, icon: { stage: "fa-solid fa-masks-theater", cast: "fa-solid fa-users", light: "fa-solid fa-lightbulb", comms: "fa-solid fa-tower-broadcast" }[t] })),
        is: Object.fromEntries(TABS.map((t) => [t, view.tab === t])),
        stage,
        reactions,
        cast: castCtx,
        light: lightCtx,
        comms: commsCtx,
      };
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

    async _onRender(context, options) {
      await super._onRender(context, options);
      this._renderPending = false;
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
      const entry = this._pending.get(key) ?? { ns, id, patch: {}, timer: 0, sceneId: globalThis.canvas?.scene?.id ?? null };
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

    _lightPatch(patch, now = false) {
      if (!globalThis.canvas?.scene) return null;
      this._queuePatch("light", null, patch, now);
      return null;
    }

    async _lightReset() {
      const scene = globalThis.canvas?.scene;
      if (!scene) return;
      const key = "light|";
      if (this._pending.has(key)) { clearTimeout(this._pending.get(key).timer); this._pending.delete(key); }
      await this._write(() => store.writeLight(scene, { ...DEFAULT_LIGHT }, LIGHT_TIMING));
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
      const place = () => {
        fig.style.left = `${r3(x * 100)}%`;
        fig.style.bottom = `${r3((STRIP.foot + STRIP.rise * depth) * 100)}%`;
        fig.style.height = `${r3(clamp(h * figure * STRIP.figure * (1 - STRIP.shrink * depth), 0.05, 1.2) * 100)}%`;
        fig.style.zIndex = String(Math.round((1 - depth) * 100) + 1);
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
      if (path) this._lightPatch({ src: path }, true);
    }

    /* ── stage / comms ── */

    async _enter(id) {
      const s = store.readState();
      if (s.on.length >= MAX_ON_STAGE && !s.on.some((m) => m.id === id)) {
        return ui.notifications?.warn(L("GLSTAGE.director.stage.full", { max: MAX_ON_STAGE }));
      }
      return this._write(() => store.enter(id));
    }

    async _call(id) {
      const c = store.readComms();
      if (c.calls.length >= MAX_CALLS && !c.calls.some((x) => x.castId === id)) {
        return ui.notifications?.warn(L("GLSTAGE.director.comms.full", { max: MAX_CALLS }));
      }
      return this._write(() => store.call(id));
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

/** The template the Director renders, for optional preloading. */
export const DIRECTOR_TEMPLATES = Object.freeze([TEMPLATE]);
