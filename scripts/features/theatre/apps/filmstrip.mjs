/**
 * Theatre — the GM filmstrip.
 *
 * A frameless panel docked at the bottom centre of the screen, just above the
 * hotbar: a transport bar (prev / Go / next, re-announce, text card, black,
 * clear, free pan, editor), the scene's shots as frames on a strip, and a
 * GM-only preview of the selected shot (image, eyebrow/title/subtitle in the
 * shot's own face, and the GM's notes). Players never see any of it: the app
 * refuses to open for a non-GM.
 *
 * The flow is a film editor's: click a frame to cue it up (only the GM sees
 * it), then Go. When the shot you had selected goes on air — by Go, Next or a
 * keybinding — the selection steps to the following frame, so the preview is
 * always "what is next".
 *
 * It follows the viewed scene rather than closing on a switch, and closes only
 * when the viewed scene is not a Theatre scene. Every write goes through the
 * store; free pan is the local camera host's, not world data.
 */

import { FACES } from "../constants.mjs";
import { resolveFace, resolveStyle } from "../model.mjs";
import { TheatreAppBase } from "./base.mjs";
import {
  L, SHOT_MIME, cameraHost, currentStore, dragLooksUseful, faceSecondaryStyle, faceSpecimenStyle, guarded, isVideoSrc,
  loadHost, loadStore, partialFromSrc, pathsFromDrop, promptCardText, styleKeys, styleLabel, tpl,
} from "./shared.mjs";

export const FILMSTRIP_ID = "glth-filmstrip";

/** Selection per scene, kept across close/reopen within the session. */
const selection = new Map();
let collapsed = false;
let goStyle = "";

let _Filmstrip = null;

function FilmstripApp() {
  if (_Filmstrip) return _Filmstrip;
  const Base = TheatreAppBase();

  _Filmstrip = class TheatreFilmstrip extends Base {
    static DEFAULT_OPTIONS = {
      id: FILMSTRIP_ID,
      classes: ["glth-app", "glth-filmstrip"],
      tag: "section",
      window: { frame: false, positioned: false, minimizable: false, resizable: false },
      actions: {
        select: TheatreFilmstrip.#onSelect,
        go: TheatreFilmstrip.#onGo,
        prev: TheatreFilmstrip.#onPrev,
        next: TheatreFilmstrip.#onNext,
        reannounce: TheatreFilmstrip.#onReannounce,
        card: TheatreFilmstrip.#onCard,
        black: TheatreFilmstrip.#onBlack,
        clear: TheatreFilmstrip.#onClear,
        freePan: TheatreFilmstrip.#onFreePan,
        edit: TheatreFilmstrip.#onEdit,
        collapse: TheatreFilmstrip.#onCollapse,
        close: function () { this.close(); },
      },
    };

    static PARTS = { main: { template: tpl("filmstrip"), scrollable: [".glth-strip-reel"] } };

    _onAir = null;
    _onResize = null;

    get selectedId() {
      const store = this.store;
      if (!store) return null;
      const id = selection.get(this.sceneId);
      if (id && store.shot(id)) return id;
      // Nothing (or a deleted shot) selected: the shot on air, else the first.
      const fallback = store.state?.shotId && store.shot(store.state.shotId) ? store.state.shotId : store.shots[0]?.id ?? null;
      if (fallback) selection.set(this.sceneId, fallback);
      return fallback;
    }

    set selectedId(id) {
      if (id) selection.set(this.sceneId, id);
      else selection.delete(this.sceneId);
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const store = this.store;
      if (!store) return { ...context, empty: true };
      const { shots, config, state } = store;
      const selectedId = this.selectedId;
      this._onAir = state.shotId;

      const frames = shots.map((s, i) => ({
        id: s.id,
        index: i + 1,
        src: s.src,
        hasSrc: !!s.src,
        video: isVideoSrc(s.src),
        label: s.title || s.eyebrow || s.subtitle || L("GLTH.app.untitled"),
        untitled: !(s.title || s.eyebrow || s.subtitle),
        style: styleLabel(resolveStyle(s, config)),
        styleOverride: s.style != null,
        onAir: s.id === state.shotId,
        selected: s.id === selectedId,
        hasNotes: !!s.notes.trim(),
        hasGrade: !!s.grade,
      }));

      const sel = selectedId ? store.shot(selectedId) : null;
      const face = sel ? resolveFace(sel, config) : config.face;
      const onAirShot = state.shotId ? store.shot(state.shotId) : null;
      const cue = state.cue;
      const host = cameraHost();

      return {
        ...context,
        empty: false,
        collapsed,
        frames,
        count: frames.length,
        countLabel: L("GLTH.filmstrip.count", { n: frames.length }),
        sel: sel ? {
          id: sel.id,
          src: sel.src,
          hasSrc: !!sel.src,
          video: isVideoSrc(sel.src),
          eyebrow: sel.eyebrow,
          title: sel.title,
          subtitle: sel.subtitle,
          hasTitle: !!(sel.eyebrow || sel.title || sel.subtitle),
          notes: sel.notes,
          onAir: sel.id === state.shotId,
          style: styleLabel(resolveStyle(sel, config)),
          titleStyle: faceSpecimenStyle(face),
          secondaryStyle: faceSecondaryStyle(face),
          faceKnown: !!FACES[face],
          focus: `${Math.round(sel.focus.x * 100)}% ${Math.round(sel.focus.y * 100)}%`,
        } : null,
        onAir: onAirShot ? (onAirShot.title || onAirShot.eyebrow || L("GLTH.app.untitled")) : null,
        isBlack: !state.shotId,
        lastCue: cue ? L(`GLTH.cue.${cue.kind}`) : null,
        goStyles: [
          { value: "", label: L("GLTH.filmstrip.goShotStyle"), selected: !goStyle },
          ...styleKeys().map((k) => ({ value: k, label: styleLabel(k), selected: goStyle === k })),
        ],
        freePan: !!host?.freePan,
        canFreePan: !!host?.setFreePan,
        canPrev: !!state.shotId && store.indexOf(state.shotId) > 0,
        canNext: frames.length > 0 && (!state.shotId || store.indexOf(state.shotId) < frames.length - 1),
      };
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      this.#dock();
      if (!this._onResize) {
        this._onResize = () => this.#dock();
        window.addEventListener("resize", this._onResize);
      }

      const goSel = root.querySelector("[data-go-style]");
      goSel?.addEventListener("change", () => { goStyle = goSel.value; });

      const reel = root.querySelector(".glth-strip-reel");
      if (reel) {
        this.#bindReel(reel);
        // Keep the selected frame in view without yanking a reel the GM is scrolling.
        if (options?.isFirstRender || this._revealSelected) {
          root.querySelector(".glth-frame.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
          this._revealSelected = false;
        }
      }
      for (const f of root.querySelectorAll(".glth-frame[data-id]")) {
        f.addEventListener("dblclick", (ev) => { ev.preventDefault(); this.#openEditor(f.dataset.id); });
      }
    }

    /** Sit just above the hotbar (or the bottom edge when there is none). */
    #dock() {
      const el = this.element;
      if (!el) return;
      const bar = document.getElementById("hotbar");
      const r = bar?.getBoundingClientRect?.();
      const gap = 10;
      const bottom = r && r.height > 0 ? Math.max(gap, window.innerHeight - r.top + gap) : gap * 2;
      el.style.setProperty("--glth-dock-bottom", `${Math.round(bottom)}px`);
    }

    /* ── reorder + drop ──────────────────────────────────────────────── */

    #bindReel(reel) {
      const frames = () => [...reel.querySelectorAll(".glth-frame[data-id]")];
      const clearMarks = () => {
        for (const f of frames()) f.classList.remove("is-drop-before", "is-drop-after", "is-dragging");
        reel.classList.remove("is-drop");
      };
      /** Insertion index (0..n) for a pointer x, and the frame to mark. */
      const slot = (x) => {
        const list = frames();
        for (let i = 0; i < list.length; i++) {
          const b = list[i].getBoundingClientRect();
          if (x < b.left + b.width / 2) return { index: i, el: list[i], side: "before" };
        }
        return { index: list.length, el: list.at(-1) ?? null, side: "after" };
      };

      for (const f of frames()) {
        f.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData(SHOT_MIME, f.dataset.id);
          ev.dataTransfer.effectAllowed = "move";
          f.classList.add("is-dragging");
        });
        f.addEventListener("dragend", clearMarks);
      }

      reel.addEventListener("dragover", (ev) => {
        const internal = ev.dataTransfer?.types?.includes(SHOT_MIME);
        if (!internal && !dragLooksUseful(ev)) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = internal ? "move" : "copy";
        for (const fr of frames()) fr.classList.remove("is-drop-before", "is-drop-after");
        const s = slot(ev.clientX);
        s.el?.classList.add(s.side === "before" ? "is-drop-before" : "is-drop-after");
        reel.classList.toggle("is-drop", !internal);
      });
      reel.addEventListener("dragleave", (ev) => { if (!reel.contains(ev.relatedTarget)) clearMarks(); });
      reel.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        const s = slot(ev.clientX);
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
        const paths = await pathsFromDrop(ev);
        if (!paths.length) { ui.notifications.warn(L("GLTH.editor.dropNothing")); return; }
        const ids = await guarded(() => store.addShots(paths.map(partialFromSrc), { at: s.index }));
        if (ids?.[0]) { this.selectedId = ids[0]; this._revealSelected = true; }
      });
    }

    /* ── store reactions ─────────────────────────────────────────────── */

    _onStoreChange(store) {
      // The shot the GM had cued up just went on air: cue up the one after it.
      const was = this._onAir;
      const now = store.state?.shotId ?? null;
      if (now && now !== was && selection.get(this.sceneId) === now) {
        const i = store.indexOf(now);
        const next = store.shots[i + 1];
        if (next) { this.selectedId = next.id; this._revealSelected = true; }
      }
      this._onAir = now;
      this._scheduleRender();
    }

    /** Follow the viewed scene; close only when it is not a Theatre scene. */
    _onSceneSwitch(store) {
      if (!store) { this.close(); return; }
      if (store.scene?.id !== this.sceneId) {
        this.sceneId = store.scene.id;
        this._onAir = null;
        this._revealSelected = true;
      }
      this._scheduleRender();
    }

    _onClose(options) {
      if (this._onResize) window.removeEventListener("resize", this._onResize);
      this._onResize = null;
      super._onClose(options);
    }

    #openEditor(shotId) {
      import("./editor.mjs").then((m) => m.openEditor(shotId)).catch((e) => console.error("GLUniverse Suite | theatre editor", e));
    }

    /* ── actions ─────────────────────────────────────────────────────── */

    static #onSelect(event, target) {
      const id = target.closest("[data-id]")?.dataset.id;
      if (!id || id === this.selectedId) return;
      this.selectedId = id;
      this.render();
    }

    static async #onGo() {
      const store = this.store;
      const id = this.selectedId;
      if (!store || !id) { ui.notifications.info(L("GLTH.filmstrip.nothingSelected")); return; }
      await guarded(() => store.cue({ kind: "shot", shotId: id, style: goStyle || undefined }));
    }

    static async #onPrev() { const s = this.store; if (s) await guarded(() => s.prev()); }
    static async #onNext() { const s = this.store; if (s) await guarded(() => s.next()); }
    static async #onReannounce() { const s = this.store; if (s) await guarded(() => s.reannounce()); }
    static async #onBlack() { const s = this.store; if (s) await guarded(() => s.black()); }
    static async #onClear() { const s = this.store; if (s) await guarded(() => s.clear()); }

    static async #onCard() {
      const store = this.store;
      if (!store) return;
      const last = store.state?.cue?.kind === "card" ? store.state.cue.text : "";
      const text = await promptCardText(last);
      if (text && this.store) await guarded(() => this.store.card(text));
    }

    static async #onFreePan() {
      const host = await loadHost();
      if (!host?.setFreePan) return;
      host.setFreePan(!host.freePan);
      this.render();
    }

    static #onEdit() {
      this.#openEditor(this.selectedId);
    }

    static #onCollapse() {
      collapsed = !collapsed;
      this.render();
    }
  };

  return _Filmstrip;
}

const instance = () => foundry.applications.instances.get(FILMSTRIP_ID) ?? null;

/** Open the filmstrip for the viewed Theatre scene (GM only). */
export async function openFilmstrip() {
  if (!game.user?.isGM) return null;
  await loadStore();
  await loadHost();
  const store = currentStore();
  if (!store) { ui.notifications.warn(L("GLTH.app.noScene")); return null; }
  const existing = instance();
  if (existing) {
    existing._onSceneSwitch(store);
    existing.render({ force: true });
    return existing;
  }
  const Cls = FilmstripApp();
  const app = new Cls({ sceneId: store.scene.id });
  await app.render({ force: true });
  return app;
}

export function closeFilmstrip() {
  return instance()?.close() ?? null;
}

export function toggleFilmstrip() {
  return instance() ? closeFilmstrip() : openFilmstrip();
}

export const isFilmstripOpen = () => !!instance();

/** Re-render an open filmstrip (e.g. after the camera host's free pan changed elsewhere). */
export function refreshFilmstrip() {
  const app = instance();
  if (app?.rendered) app.render();
}
