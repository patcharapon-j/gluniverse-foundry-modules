/**
 * Diorama editor — the docked live 3D preview of the DRAFT.
 *
 * A small resizable ApplicationV2 holding one <canvas> and a DioramaRenderer
 * (render/renderer.mjs, imported lazily: it pulls three.js, and an editor that
 * never opens the preview never pays for it). It shows the editor's draft
 * terrain, the scene's walls (with the draft's materials) and the map art, and
 * re-feeds the terrain at most once per PREVIEW_THROTTLE while the GM paints.
 * No tokens, no fog, no lighting: this is the shape of the ground, nothing
 * else.
 *
 * The WebGL context is the renderer's; it is registered with Surfaces so it is
 * paused off screen, and `use()` is called before every draw. A lost context
 * stays lost on its canvas, so a rebuild swaps in a fresh canvas.
 *
 * Built in a memoised factory so this module imports under plain Node.
 */

import { warn, SUITE_ID } from "../../../core/const.mjs";
import { Surfaces } from "../../../core/gl-surfaces.mjs";
import { CAMERA, SETTINGS, WALL_MATERIALS, yawStride } from "../constants.mjs";
import { backgroundSrc, loadBackground } from "./sample.mjs";
import { resolveProps, propStates } from "../terrain/props.mjs";
import { levelsOf, levelBaseQ, shiftTerrain, shiftPropStates, isMultiLevel } from "../terrain/levels.mjs";
import { stackPlan } from "../view/levels.mjs";
import { loadFloors, stackProps, wallsOnLevel } from "../view/level-view.mjs";
import { Q_PER_CELL } from "../constants.mjs";

export const PREVIEW_ID = "gldio-editor-preview";
/** Terrain re-feed coalescing while a stroke is in progress (ms). Not an animation. */
const PREVIEW_THROTTLE = 120;
const ZOOM_STEP = 1.25;

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/* ── walls → WallState (renderer contract) ───────────────────────────────── */

/** Foundry wall document → WallState type. */
export function wallType(w, C = globalThis.CONST) {
  const DT = C?.WALL_DOOR_TYPES ?? { NONE: 0, DOOR: 1, SECRET: 2 };
  const ST = C?.WALL_SENSE_TYPES ?? { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 };
  if (w.door === DT.DOOR) return "door";
  if (w.door === DT.SECRET) return "secret";
  if (w.sight === ST.NONE && w.light === ST.NONE) return "invisible";
  if (w.sight === ST.LIMITED) return "terrain";
  if (w.sight === ST.PROXIMITY || w.sight === ST.DISTANCE) return "window";
  return "wall";
}

export function doorState(w, C = globalThis.CONST) {
  const DT = C?.WALL_DOOR_TYPES ?? { NONE: 0 };
  const DS = C?.WALL_DOOR_STATES ?? { CLOSED: 0, OPEN: 1, LOCKED: 2 };
  if (!w.door || w.door === DT.NONE) return "none";
  if (w.ds === DS.OPEN) return "open";
  if (w.ds === DS.LOCKED) return "locked";
  return "closed";
}

/**
 * WallState[] for the draft: a wall stands on the lower of the two grounds it
 * separates and rises the terrain's wall height above the higher.
 */
export function wallStates(scene, terrain, gridSize, defaultMaterial = WALL_MATERIALS[0]) {
  const out = [];
  for (const w of scene?.walls ?? []) {
    const c = w.c ?? [];
    if (c.length < 4) continue;
    const [ax, ay, bx, by] = c;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len * 2, ny = (bx - ax) / len * 2;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const g1 = terrain.groundAt(mx + nx, my + ny, gridSize), g2 = terrain.groundAt(mx - nx, my - ny, gridSize);
    out.push({
      id: w.id, a: [ax, ay], b: [bx, by],
      type: wallType(w), door: doorState(w),
      material: terrain.walls[w.id] ?? defaultMaterial,
      baseQ: Math.min(g1, g2), topQ: Math.max(g1, g2) + terrain.wallHeight,
    });
  }
  return out;
}

/* ── the window ──────────────────────────────────────────────────────────── */

let _Cls = null;

function PreviewApp() {
  if (_Cls) return _Cls;
  const { ApplicationV2 } = foundry.applications.api;

  _Cls = class DioramaEditorPreview extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: PREVIEW_ID,
      classes: ["gldio-app", "gldio-preview-app"],
      tag: "section",
      window: { title: "GLDIO.editor.preview.title", icon: "fa-solid fa-cube", resizable: true, minimizable: true },
      position: { width: 440, height: 360 },
      actions: { cam: DioramaEditorPreview.#onCam },
    };

    constructor(editor, options = {}) {
      super(options);
      this.editor = editor;
      this.r = null;
      this._root = null;
      this._cam = { yawStep: 1, pitchIndex: 1, zoom: 1 };
      this._timer = 0;
      this._off = null;
      this._ro = null;
      this._surface = null;
      this._img = null;
      this._Renderer = null;
    }

    get session() { return this.editor?.session ?? null; }

    async _renderHTML() {
      if (this._root) return this._root;
      const root = document.createElement("div");
      root.className = "gldio-pv gl-type";
      const btn = (op, icon, key) => `<button type="button" class="gldio-ed-ibtn" data-action="cam" data-op="${op}" data-tooltip="${L(key)}" aria-label="${L(key)}"><i class="fa-solid ${icon}"></i></button>`;
      root.innerHTML = `
        <div class="gldio-pv-stage"><canvas class="gldio-pv-canvas"></canvas><p class="gldio-pv-msg" hidden></p></div>
        <div class="gldio-pv-bar">
          ${btn("yawL", "fa-rotate-left", "GLDIO.editor.preview.yawLeft")}
          ${btn("yawR", "fa-rotate-right", "GLDIO.editor.preview.yawRight")}
          ${btn("pitch", "fa-arrows-up-down", "GLDIO.editor.preview.pitch")}
          <span class="gl-rule"></span>
          ${btn("zoomOut", "fa-magnifying-glass-minus", "GLDIO.editor.preview.zoomOut")}
          ${btn("zoomIn", "fa-magnifying-glass-plus", "GLDIO.editor.preview.zoomIn")}
          ${btn("reset", "fa-expand", "GLDIO.editor.preview.reset")}
        </div>`;
      this._root = root;
      return root;
    }

    _replaceHTML(result, content) {
      if (result.parentElement !== content) content.replaceChildren(result);
    }

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      this._stage = this._root.querySelector(".gldio-pv-stage");
      this._stage.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        this.#camera(ev.deltaY > 0 ? "zoomOut" : "zoomIn");
      }, { passive: false });
      await this.#boot();
    }

    #message(key) {
      const p = this._root?.querySelector(".gldio-pv-msg");
      if (!p) return;
      p.hidden = !key;
      p.textContent = key ? L(key) : "";
    }

    async #boot() {
      try {
        const mod = await import("../render/renderer.mjs");
        this._Renderer = mod?.DioramaRenderer ?? null;
      } catch (e) {
        warn("diorama | editor preview: renderer unavailable", e);
      }
      if (!this._Renderer) { this.#message("GLDIO.editor.preview.unavailable"); return; }
      if (!this.rendered) return;
      this.#message("GLDIO.editor.preview.loading");
      this._img = await loadBackground(backgroundSrc(this.editor.scene, this.editor.levelId)).catch(() => null);
      // A multi-Level scene: the floors below the edited one, as the view stacks them.
      this._plan = isMultiLevel(this.editor.scene) ? stackPlan(levelsOf(this.editor.scene), this.editor.levelId, { gm: true }) : null;
      this._floors = this._plan?.below.length
        ? await loadFloors(this._plan, this.editor.scene, this.editor.grid.sceneRect).catch(() => [])
        : [];
      if (!this.rendered) return;
      this.#message(null);
      try {
        this.#build();
      } catch (e) {
        warn("diorama | editor preview failed to start", e);
        this.#message("GLDIO.editor.preview.failed");
        return;
      }
      this._surface = Surfaces.register({
        id: "diorama-editor-preview",
        element: () => this._stage,
        pause: () => { this._paused = true; },
        resume: () => { this._paused = false; this.#draw(); },
        release: () => this.#teardown(),
        restore: () => { try { this.#build(); } catch (e) { warn("diorama | preview rebuild failed", e); } },
        holds: () => !!this.r,          // on demand: a release would wipe the still picture
      });
      this._ro = new ResizeObserver(() => this.#resize());
      this._ro.observe(this._stage);
      this._off = this.session.on((kind) => {
        if (kind === "terrain" || kind === "palette" || kind === "history" || kind === "props") this.#schedule();
        else if (kind === "walls") this.#syncWalls();
      });
    }

    #build() {
      this.#teardown();
      // A lost context stays lost on its canvas; always start from a fresh one.
      const old = this._root.querySelector(".gldio-pv-canvas");
      const cv = document.createElement("canvas");
      cv.className = "gldio-pv-canvas";
      old.replaceWith(cv);
      const g = this.editor.grid;
      const r = new this._Renderer({ canvas: cv, pixelRatio: globalThis.devicePixelRatio || 1 });
      r.setGrid({ size: g.size, distance: g.distance, cols: g.cols, rows: g.rows, sceneRect: g.sceneRect });
      r.setBackground(this._img ?? null, g.sceneRect);
      r.setTokens?.([]);
      r.setLighting?.({ darkness: 0, light: null, vision: null });
      r.setOverlays?.({});
      r.setOptions?.({ tiltShift: false, cutaway: true, ghosts: false });
      this.r = r;
      r.setLevels?.(this._floors ?? []);
      this.#syncTerrain();
      this.#syncWalls();
      // Look at the edited floor, not the table: its ground sits at its Level's base.
      const baseQ = this.#baseQ();
      if (baseQ && !this._cam.target) {
        const sr = g.sceneRect;
        this._cam = { ...this._cam, target: { x: sr.x + sr.width / 2, y: sr.y + sr.height / 2, zQ: baseQ } };
      }
      r.setCamera(this._cam, { animate: false });
      this.#resize();
    }

    #teardown() {
      try { this.r?.dispose(); } catch { /* context already gone */ }
      this.r = null;
    }

    #resize() {
      if (!this.r || !this._stage) return;
      const { width, height } = this._stage.getBoundingClientRect();
      if (width < 2 || height < 2) return;
      this.r.resize(Math.floor(width), Math.floor(height));
      this.#draw();
    }

    #draw() {
      if (this._paused) return;
      if (!this.r && this._Renderer && this.rendered) { try { this.#build(); } catch { return; } }
      if (!this.r) return;
      this._surface?.use();
      this.r.requestRender();
    }

    #schedule() {
      if (this._timer) return;
      this._timer = setTimeout(() => { this._timer = 0; this.#syncTerrain(); }, PREVIEW_THROTTLE);
    }

    #syncTerrain() {
      if (!this.r || !this.session) return;
      // A copy: the renderer may hold on to what it is handed, the draft keeps changing.
      const ground = this.session.terrain.clone();
      // The draft is in its Level's frame; the view draws it at the Level's base
      // (0 in a one-Level scene, where nothing below changes).
      const dq = this.#baseQ();
      this.r.setTerrain(shiftTerrain(ground, dq));
      // The draft's props, stood on the draft's ground; GM-only ones as ghosts.
      const own = shiftPropStates(propStates(resolveProps(ground, this.session.props).props, { isGM: true }), { dCells: dq / Q_PER_CELL });
      const below = this._plan?.below.length ? stackProps(this.editor.scene, this._plan, { isGM: true, viewed: false }) : [];
      this.r.setProps?.(below.length ? [...own, ...below] : own);
      this.#syncWalls();
    }

    /** The edited Level's base in whole q (the view's absolute frame). */
    #baseQ() {
      return Math.round(levelBaseQ(this.editor.scene, this.editor.levelId, this.editor.grid.distance) || 0);
    }

    #syncWalls() {
      if (!this.r || !this.session) return;
      const dq = this.#baseQ();
      const scene = this.editor.scene;
      let walls = wallStates(scene, this.session.terrain, this.editor.grid.size, this.editor.defaultWallMaterial);
      walls = wallsOnLevel(walls, (id) => scene.walls?.get?.(id) ?? null, isMultiLevel(scene) ? this.editor.levelId : null);
      if (dq) walls = walls.map((w) => ({ ...w, baseQ: w.baseQ + dq, topQ: w.topQ + dq }));
      this.r.setWalls(walls);
      this.#draw();
    }

    #camera(op) {
      if (!this.r) return;
      const c = { ...this._cam, ...(this.r.getCamera?.() ?? {}) };
      const n = CAMERA.yawSteps;
      // The GM's snap sets how far a turn goes (90° by default).
      const k = yawStride(game.settings.get(SUITE_ID, SETTINGS.yawSnap));
      switch (op) {
        case "yawL": c.yawStep = (((c.yawStep ?? 0) - k) % n + n) % n; break;
        case "yawR": c.yawStep = ((c.yawStep ?? 0) + k) % n; break;
        case "pitch": c.pitchIndex = ((c.pitchIndex ?? 0) + 1) % CAMERA.pitches.length; break;
        case "zoomIn": c.zoom = Math.min(CAMERA.maxZoom, (c.zoom ?? 1) * ZOOM_STEP); break;
        case "zoomOut": c.zoom = Math.max(CAMERA.minZoom, (c.zoom ?? 1) / ZOOM_STEP); break;
        case "reset": Object.assign(c, { yawStep: 1, pitchIndex: 1, zoom: 1 }); delete c.target; break;
        default: return;
      }
      this._cam = c;
      this.r.setCamera(c, { animate: true });
      this.#draw();
    }

    static #onCam(_ev, target) { this.#camera(target.dataset.op); }

    _onClose(options) {
      super._onClose(options);
      if (this._timer) clearTimeout(this._timer);
      this._timer = 0;
      this._off?.();
      this._off = null;
      this._ro?.disconnect();
      this._ro = null;
      this._surface?.dispose();
      this._surface = null;
      this.#teardown();
      if (this.editor?._preview === this) {
        this.editor._preview = null;
        if (this.editor.rendered) this.editor.render();
      }
    }
  };

  return _Cls;
}

/** Open the preview docked beside the editor. */
export function openPreview(editor) {
  const existing = foundry.applications.instances.get(PREVIEW_ID);
  if (existing) { existing.bringToFront?.(); return existing; }
  const Cls = PreviewApp();
  const ep = editor.position ?? {};
  const w = editor.element?.offsetWidth ?? 312;
  const left = Math.min(Math.max(0, (ep.left ?? 116) + w + 10), Math.max(0, window.innerWidth - 460));
  const app = new Cls(editor, { position: { left, top: ep.top ?? 72, width: 440, height: 360 } });
  app.render({ force: true });
  return app;
}
