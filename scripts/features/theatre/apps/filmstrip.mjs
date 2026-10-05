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
 * Organisation: when the scene has folders, a row of chips filters the reel to
 * one folder (or Unfiled), and in the full reel each folder opens with a slate.
 * The search box narrows the reel by title, eyebrow, subtitle, notes, file name
 * and folder. Both are a view only: Next and Previous still walk the whole play
 * order. Filtering is done on the rendered frames, never by re-rendering, so
 * typing keeps its caret; a re-render (someone else's write) restores focus.
 * Dropping a frame on a chip or a slate refiles it.
 *
 * It follows the viewed scene rather than closing on a switch, and closes only
 * when the viewed scene is not a Theatre scene. Every write goes through the
 * store; free pan is the local camera host's, not world data.
 */

import { FACES } from "../constants.mjs";
import { groupShots, matchesQuery, resolveFace, resolveStyle, searchText } from "../model.mjs";
import { TheatreAppBase } from "./base.mjs";
import {
  L, SHOT_MIME, cameraHost, currentStore, dragLooksUseful, dropSlot, faceSecondaryStyle, faceSpecimenStyle, folderOf, folderStyle, gmFace,
  guarded, isVideoSrc, loadHost, loadStore, partialFromSrc, pathsFromDrop, promptCardText, styleKeys, styleLabel, tpl,
} from "./shared.mjs";

export const FILMSTRIP_ID = "glth-filmstrip";

/** Selection per scene, kept across close/reopen within the session. */
const selection = new Map();
let collapsed = false;
let goStyle = "";
/** The search text, kept across re-renders and reopenings within the session. */
let query = "";
/** Folder filter per scene: ALL, UNFILED ("") or a folder id. */
const filters = new Map();
const ALL = "*";

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
        filter: TheatreFilmstrip.#onFilter,
        close: function () { this.close(); },
      },
    };

    static PARTS = { main: { template: tpl("filmstrip"), scrollable: [".glth-strip-reel"] } };

    _onAir = null;
    _onResize = null;
    /** Caret of a focused search box, carried across a re-render. */
    _refocus = null;

    get filter() {
      const f = filters.get(this.sceneId);
      const store = this.store;
      if (f === undefined || f === ALL) return ALL;
      if (f === "" || store?.folder(f)) return f;
      return ALL;
    }

    set filter(v) { filters.set(this.sceneId, v); }

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
      const { shots, folders, config, state } = store;
      const selectedId = this.selectedId;
      this._onAir = state.shotId;
      const hasFolders = folders.length > 0;
      const filter = this.filter;

      const frame = (s, i, folderName) => ({
        id: s.id,
        index: i + 1,
        pos: i,
        folder: s.folder ?? "",
        search: searchText(s, folderName),
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
      });

      // The reel in play order; with folders, each group opens with a slate.
      const groups = groupShots(shots, folders);
      const frames = [];
      const reel = [];
      const chips = [{ value: ALL, label: L("GLTH.folders.all"), count: shots.length, all: true, active: filter === ALL }];
      for (const g of groups) {
        const name = g.folder ? (g.folder.name || L("GLTH.folders.untitled")) : L("GLTH.folders.unfiled");
        const style = g.folder ? folderStyle(g.folder.color) : "";
        const value = g.folder?.id ?? "";
        if (hasFolders) {
          chips.push({ value, label: name, count: g.shots.length, style, unfiled: !g.folder, droppable: true, active: filter === value });
          if (g.shots.length) {
            reel.push({ slate: true, folder: value, name, style, unfiled: !g.folder, count: g.shots.length, countLabel: L("GLTH.filmstrip.count", { n: g.shots.length }) });
          }
        }
        for (const { shot, index } of g.shots) {
          const f = frame(shot, index, g.folder?.name ?? "");
          frames.push(f);
          reel.push(f);
        }
      }

      const sel = selectedId ? store.shot(selectedId) : null;
      const face = resolveFace(sel, config, gmFace());
      const onAirShot = state.shotId ? store.shot(state.shotId) : null;
      const cue = state.cue;
      const host = cameraHost();

      return {
        ...context,
        empty: false,
        collapsed,
        frames,
        reel,
        chips,
        hasFolders,
        query,
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

      this.#bindSearch(root.querySelector("[data-search]"));
      this.#bindChips(root);
      this.#applyFilter();

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

    async _preRender(context, options) {
      await super._preRender?.(context, options);
      const a = document.activeElement;
      this._refocus = a?.matches?.(".glth-filmstrip [data-search]") ? { start: a.selectionStart, end: a.selectionEnd } : null;
    }

    /* ── search + folder filter ──────────────────────────────────────── */

    #bindSearch(input) {
      if (!input) return;
      if (this._refocus) {
        input.focus({ preventScroll: true });
        try { input.setSelectionRange(this._refocus.start, this._refocus.end); } catch { /* not a text input */ }
        this._refocus = null;
      }
      input.addEventListener("input", () => { query = input.value; this.#applyFilter(); });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          // Cue up the first match; Go stays a deliberate second press.
          ev.preventDefault();
          const first = this.element?.querySelector(".glth-frame[data-id]:not([hidden])");
          if (first && first.dataset.id !== this.selectedId) { this.selectedId = first.dataset.id; this._revealSelected = true; this.render(); }
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          if (input.value) { input.value = ""; query = ""; this.#applyFilter(); } else input.blur();
        }
      });
    }

    /** Show the frames the folder filter and the search allow; slates and counts follow. */
    #applyFilter() {
      const root = this.element;
      if (!root) return;
      const filter = this.filter;
      const frames = [...root.querySelectorAll(".glth-frame[data-id]")];
      const shown = new Set();
      let n = 0;
      for (const f of frames) {
        const ok = (filter === ALL || f.dataset.folder === filter) && matchesQuery(f.dataset.haystack ?? "", query);
        f.hidden = !ok;
        if (ok) { n++; shown.add(f.dataset.folder); }
      }
      // A slate only heads the full reel, and only over frames still showing.
      for (const sl of root.querySelectorAll("[data-slate]")) sl.hidden = filter !== ALL || !shown.has(sl.dataset.folder);
      for (const c of root.querySelectorAll(".glth-chip[data-folder-filter]")) {
        const on = c.dataset.folderFilter === filter;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      }
      const none = root.querySelector("[data-no-match]");
      if (none) none.hidden = !(frames.length && !n);
      const count = root.querySelector("[data-count]");
      if (count) {
        const total = frames.length;
        count.textContent = n === total ? L("GLTH.filmstrip.count", { n: total }) : L("GLTH.filmstrip.countOf", { n, total });
      }
      root.querySelector(".glth-search")?.classList.toggle("is-active", !!query);
    }

    /** Folder chips take a dropped frame: it is refiled at the end of that folder. */
    #bindChips(root) {
      for (const chip of root.querySelectorAll("[data-drop-folder]")) {
        chip.addEventListener("dragover", (ev) => {
          if (!ev.dataTransfer?.types?.includes(SHOT_MIME)) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
          chip.classList.add("is-drop");
        });
        chip.addEventListener("dragleave", () => chip.classList.remove("is-drop"));
        chip.addEventListener("drop", async (ev) => {
          chip.classList.remove("is-drop");
          const id = ev.dataTransfer?.getData(SHOT_MIME);
          if (!id) return;
          ev.preventDefault();
          const store = this.store;
          if (store) await guarded(() => store.moveShot(id, null, { folder: chip.dataset.dropFolder || null }));
        });
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
      const frames = () => [...reel.querySelectorAll(".glth-frame[data-id]:not([hidden])")];
      const clearMarks = () => {
        for (const f of reel.querySelectorAll(".glth-frame, [data-slate]")) f.classList.remove("is-drop-before", "is-drop-after", "is-dragging", "is-drop");
        reel.classList.remove("is-drop");
      };
      /**
       * Where a drop at pointer x lands: the play index (0..n) and the folder.
       * A slate takes the shot to the end of its folder; between frames, the
       * nearest frame decides both (so the last slot of a folder is reachable).
       */
      const slot = (ev) => {
        const slate = ev.target?.closest?.("[data-slate]");
        if (slate) return { el: slate, slate: true, index: null, folder: folderOf(slate) };
        const s = dropSlot(frames(), ev.clientX, "x");
        if (!s.el) {
          const f = this.filter;
          return { el: null, index: null, folder: f === ALL ? undefined : (f || null) };
        }
        const i = Number(s.el.dataset.index);
        return { el: s.el, side: s.side, index: s.side === "before" ? i : i + 1, folder: folderOf(s.el) };
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
        for (const fr of reel.querySelectorAll(".glth-frame, [data-slate]")) fr.classList.remove("is-drop-before", "is-drop-after", "is-drop");
        const s = slot(ev);
        s.el?.classList.add(s.slate ? "is-drop" : s.side === "before" ? "is-drop-before" : "is-drop-after");
        reel.classList.toggle("is-drop", !internal);
      });
      reel.addEventListener("dragleave", (ev) => { if (!reel.contains(ev.relatedTarget)) clearMarks(); });
      reel.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        const s = slot(ev);
        clearMarks();
        const store = this.store;
        if (!store) return;
        const id = ev.dataTransfer?.getData(SHOT_MIME);
        if (id) {
          const from = store.indexOf(id);
          if (from < 0) return;
          const to = s.index == null ? null : s.index > from ? s.index - 1 : s.index;
          await guarded(() => store.moveShot(id, to, { folder: s.folder }));
          return;
        }
        const paths = await pathsFromDrop(ev);
        if (!paths.length) { ui.notifications.warn(L("GLTH.editor.dropNothing")); return; }
        const ids = await guarded(() => store.addShots(paths.map(partialFromSrc), { at: s.index, folder: s.folder }));
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

    static #onFilter(event, target) {
      const v = target.closest("[data-folder-filter]")?.dataset.folderFilter;
      if (v === undefined) return;
      // A second click on the active folder goes back to the whole reel.
      this.filter = v === this.filter && v !== ALL ? ALL : v;
      this.#applyFilter();
      this.element?.querySelector(".glth-strip-reel")?.scrollTo({ left: 0 });
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
