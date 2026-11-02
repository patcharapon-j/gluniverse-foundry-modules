/**
 * Diorama editor — the GM's floating terrain panel.
 *
 *   openEditor(scene, { autoSetup })   open (or focus) the editor on a scene
 *   isEditing(scene?)                  is the editor open (on that scene)?
 *   closeEditor()
 *
 * The panel edits a DRAFT: an in-memory copy of the scene's saved terrain held
 * by an EditorSession (session.mjs). Painting happens on the 2D canvas through
 * the EditorLayer (layer.mjs); a docked 3D preview (preview.mjs) shows the
 * draft live. Players only ever see saved terrain: Save writes the terrain flag
 * once (TerrainStore.write, a forced replacement) and then the difficult
 * terrain Regions (difficult.mjs). Closing with unsaved changes asks first.
 *
 * Built in a memoised factory, never at module scope, so this folder imports
 * under plain Node (the check tool) where `foundry` does not exist. Nothing is
 * hooked until openEditor runs.
 */

import { SUITE_ID, featurePath, warn } from "../../../core/const.mjs";
import { PALETTE } from "../../../core/theme.mjs";
import { FEATURE_ID, SUB, KIND, KIND_KEYS, CLIFF_MATERIALS, WALL_MATERIALS } from "../constants.mjs";
import { Terrain, qToDist, distToQ } from "../terrain/model.mjs";
import { TerrainStore, gridOf, levelIdOf, supportsScene } from "../terrain/store.mjs";
import { EditorSession, TOOLS, BRUSHED } from "./session.mjs";
import { blankLike, BRUSH_MAX, H_MIN, H_MAX, PALETTE_MAX } from "./tools.mjs";
import { planDifficult, readDifficult, writeDifficult } from "./difficult.mjs";
import { autoSetupDetailed } from "./auto-setup.mjs";
import { backgroundSrc, sampleColours, wallSegments, sceneInsideFn } from "./sample.mjs";

export const EDITOR_ID = "gldio-editor";

/** Height slider span, q (the number field beside it takes anything in [H_MIN, H_MAX]). */
const SLIDER_MIN = -16, SLIDER_MAX = 64;
/** Raise / lower step choices, q. */
const STEPS = Object.freeze([1, 2, 4, 8]);

export const TOOL_ICONS = Object.freeze({
  brush: "fa-solid fa-paintbrush",
  rect: "fa-solid fa-vector-square",
  fill: "fa-solid fa-fill-drip",
  wand: "fa-solid fa-wand-magic-sparkles",
  raise: "fa-solid fa-angles-up",
  lower: "fa-solid fa-angles-down",
  stairs: "fa-solid fa-stairs",
  wall: "fa-solid fa-trowel-bricks",
  difficult: "fa-solid fa-shoe-prints",
});

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const tpl = (name) => featurePath(FEATURE_ID, `templates/${name}.hbs`);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

let _App = null;
let _current = null;
let _lastPosition = null;

function EditorApp() {
  if (_App) return _App;
  const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

  _App = class DioramaEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: EDITOR_ID,
      classes: ["gldio-app", "gldio-editor-app"],
      tag: "section",
      window: { title: "GLDIO.editor.title", icon: "fa-solid fa-mountain", minimizable: true, resizable: false },
      position: { width: 312, height: "auto", left: 116, top: 72 },
      actions: {
        tool: DioramaEditor.#onTool,
        undo: DioramaEditor.#onUndo,
        redo: DioramaEditor.#onRedo,
        view: DioramaEditor.#onView,
        shape: DioramaEditor.#onShape,
        wandMode: DioramaEditor.#onWandMode,
        selection: DioramaEditor.#onSelection,
        stairKind: DioramaEditor.#onStairKind,
        material: DioramaEditor.#onMaterial,
        allWalls: DioramaEditor.#onAllWalls,
        difficulty: DioramaEditor.#onDifficulty,
        layer: DioramaEditor.#onLayer,
        addLayer: DioramaEditor.#onAddLayer,
        removeLayer: DioramaEditor.#onRemoveLayer,
        autoSetup: DioramaEditor.#onAutoSetup,
        importLayout: DioramaEditor.#onImportLayout,
        copyFrom: DioramaEditor.#onCopyFrom,
        clearAll: DioramaEditor.#onClearAll,
        toggleOff: DioramaEditor.#onToggleOff,
        preview: DioramaEditor.#onPreview,
        save: DioramaEditor.#onSave,
        discard: DioramaEditor.#onDiscard,
        sampleMap: DioramaEditor.#onSampleMap,
      },
    };

    static PARTS = { main: { template: tpl("editor") } };

    /** @param {Scene} scene */
    constructor(scene, options = {}) {
      if (_lastPosition) options.position = { ...(options.position ?? {}), ..._lastPosition };
      super(options);
      this.scene = scene;
      const g = gridOf(scene);
      this.grid = g;
      this.session = new EditorSession({
        terrain: TerrainStore.read(scene).clone(),
        grid: g,
        walls: wallSegments(scene),
        difficult: readDifficult(scene),
      });
      /** The world's default wall material (walls with no entry in terrain.walls). */
      this.defaultWallMaterial = this.#defaultWallMaterial();
      this.session.material = this.defaultWallMaterial;
      this.session.onNeedColours = () => this.#ensureColours({ notify: true });
      this.layer = null;
      this._raf = 0;
      this._hooks = [];
      this._saving = false;
      this._busy = null;
      this._copyId = "";
      this._preview = null;
      this._off = this.session.on((kind, d) => this.#onSession(kind, d));
      this._onKey = (ev) => this.#key(ev);
      this._onKeyUp = (ev) => this.layer?.setModifiers?.({ shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey });
    }

    get title() { return L("GLDIO.editor.titleScene", { scene: this.scene?.name ?? "" }); }

    #defaultWallMaterial() {
      try { const m = game.settings.get(SUITE_ID, "dio.wallMaterial"); if (WALL_MATERIALS.includes(m)) return m; } catch { /* unregistered */ }
      return WALL_MATERIALS[0];
    }

    /* ── lifecycle ──────────────────────────────────────────────────── */

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      this.#attachLayer();
      const on = (name, fn) => this._hooks.push([name, Hooks.on(name, fn)]);
      on("canvasTearDown", () => { this.layer?.detach(); this.layer = null; this.#render(); });
      on("canvasReady", () => { this.#attachLayer(); this.#render(); });
      const wallsChanged = (doc) => { if (doc?.parent === this.scene) this.session.setWalls(wallSegments(this.scene)); };
      on("createWall", wallsChanged);
      on("updateWall", wallsChanged);
      on("deleteWall", wallsChanged);
      on("updateScene", (scene) => { if (scene === this.scene) this.#render(); });
      on("deleteScene", (scene) => { if (scene === this.scene) this.close({ force: true }); });
      window.addEventListener("keydown", this._onKey, true);
      window.addEventListener("keyup", this._onKeyUp, true);
    }

    #attachLayer() {
      this.layer?.detach();
      this.layer = null;
      if (globalThis.canvas?.scene !== this.scene || !canvas.ready) return;
      // Lazy import keeps PIXI out of this module's import graph for Node.
      import("./layer.mjs").then(({ EditorLayer }) => {
        if (!this.rendered || canvas.scene !== this.scene) return;
        this.layer?.detach();
        this.layer = new EditorLayer(this.session);
        if (!this.layer.attach()) this.layer = null;
      }).catch((e) => warn("diorama | editor layer failed", e));
    }

    get viewing() { return globalThis.canvas?.scene === this.scene && canvas.ready; }

    async close(options = {}) {
      if (!options.force && this.session?.dirty && this.rendered) {
        const choice = await DialogV2.wait({
          window: { title: L("GLDIO.editor.unsaved.title"), icon: "fa-solid fa-triangle-exclamation" },
          classes: ["gldio-app", "gldio-dialog"],
          content: `<p class="gldio-dialog-text">${L("GLDIO.editor.unsaved.body")}</p>`,
          buttons: [
            { action: "save", label: L("GLDIO.editor.unsaved.save"), icon: "fa-solid fa-floppy-disk", default: true },
            { action: "discard", label: L("GLDIO.editor.unsaved.discard"), icon: "fa-solid fa-trash" },
            { action: "keep", label: L("GLDIO.editor.unsaved.keep"), icon: "fa-solid fa-pen" },
          ],
          rejectClose: false,
        }).catch(() => null);
        if (choice === "save") { if (!(await this.save())) return this; }
        else if (choice !== "discard") return this;
      }
      return super.close(options);
    }

    _onClose(options) {
      const { left, top } = this.position ?? {};
      if (Number.isFinite(left) && Number.isFinite(top)) _lastPosition = { left, top };
      super._onClose(options);
      for (const [name, id] of this._hooks) Hooks.off(name, id);
      this._hooks = [];
      window.removeEventListener("keydown", this._onKey, true);
      window.removeEventListener("keyup", this._onKeyUp, true);
      this._off?.();
      this.layer?.detach();
      this.layer = null;
      this._preview?.close?.({ force: true });
      this._preview = null;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      if (_current === this) _current = null;
    }

    /* ── session → panel ────────────────────────────────────────────── */

    #onSession(kind, d = {}) {
      if (d.live) return;     // a slider is being dragged; re-rendering would drop it
      if (["tool", "palette", "history", "colours", "difficult"].includes(kind)) this.#render();
    }

    #render() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (this.rendered) this.render();
      });
    }

    /* ── context ────────────────────────────────────────────────────── */

    #dist(q) { return round(qToDist(q, this.grid.distance)); }
    #distLabel(q) { return `${this.#dist(q)} ${this.grid.units ?? ""}`.trim(); }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const s = this.session, t = s.terrain;
      const tool = s.tool;
      const entry = t.palette[s.layer] ?? t.palette[0];
      const src = backgroundSrc(this.scene);
      const copyScenes = game.scenes.filter((sc) => sc !== this.scene && src && backgroundSrc(sc) === src && TerrainStore.has(sc))
        .map((sc) => ({ id: sc.id, name: sc.name, selected: sc.id === this._copyId }));
      if (!copyScenes.some((c) => c.selected) && copyScenes[0]) { copyScenes[0].selected = true; this._copyId = copyScenes[0].id; }
      const pendingCells = s.pending.reduce((n, p) => n + p.cells.length, 0);
      const step = this.grid.distance / 4;
      return {
        ...context,
        viewing: this.viewing,
        busy: this._busy,
        dirty: s.dirty,
        canUndo: s.canUndo,
        canRedo: s.canRedo,
        off: TerrainStore.isOff(this.scene),
        saved: TerrainStore.has(this.scene),
        previewOpen: !!this._preview?.rendered,
        view: s.view,
        opacityPct: Math.round(s.view.opacity * 100),
        tool,
        is: Object.fromEntries(TOOLS.map((k) => [k, k === tool])),
        tools: TOOLS.map((id) => ({ id, icon: TOOL_ICONS[id], label: L(`GLDIO.editor.tool.${id}`), active: id === tool })),
        toolLabel: L(`GLDIO.editor.tool.${tool}`),
        hint: L(`GLDIO.editor.hint.${tool}`),
        showBrush: BRUSHED.has(tool),
        stepTool: tool === "raise" || tool === "lower" || tool === "wand",
        brush: {
          radius: s.brush.radius, max: BRUSH_MAX,
          circle: s.brush.shape !== "square", square: s.brush.shape === "square",
          label: tool === "difficult"
            ? L("GLDIO.editor.brush.cells", { n: 2 * Math.floor(s.brush.radius / SUB) + 1 })
            : L("GLDIO.editor.brush.subcells", { n: 2 * s.brush.radius + 1 }),
        },
        wand: {
          tolerance: s.wand.tolerance,
          contiguous: s.wand.contiguous,
          replace: s.wand.mode === "replace", add: s.wand.mode === "add", subtract: s.wand.mode === "subtract",
          count: s.selectionCount,
          has: !!s.mask,
          loading: s.coloursState === "loading",
          failed: s.coloursState === "failed",
          ready: s.coloursState === "ready",
        },
        steps: STEPS.map((q) => ({ q, label: this.#distLabel(q), selected: q === s.step })),
        stairKinds: [
          { kind: KIND.STAIRS, label: L("GLDIO.kind.stairs"), active: s.stairKind === KIND.STAIRS },
          { kind: KIND.RAMP, label: L("GLDIO.kind.ramp"), active: s.stairKind === KIND.RAMP },
        ],
        materials: WALL_MATERIALS.map((key) => ({ key, label: L(`GLDIO.material.wall.${key}`), active: key === s.material })),
        wallCount: s.walls.length,
        assigned: Object.keys(t.walls).filter((id) => s.walls.some((w) => w.id === id)).length,
        difficulty: { two: s.difficulty === 2, three: s.difficulty === 3, erase: s.difficulty === 0, pending: pendingCells },
        palette: t.palette.map((p, index) => ({
          index, name: p.name, color: p.color, active: index === s.layer,
          height: this.#distLabel(p.h),
          kind: L(`GLDIO.kind.${KIND_KEYS[p.kind] ?? "floor"}`),
          special: p.kind !== KIND.FLOOR,
          icon: { [KIND.WATER]: "fa-water", [KIND.PIT]: "fa-circle-down", [KIND.STAIRS]: "fa-stairs", [KIND.RAMP]: "fa-arrow-trend-up", [KIND.VOID]: "fa-ban" }[p.kind] ?? null,
        })),
        canAdd: t.palette.length < PALETTE_MAX,
        entry: entry && {
          index: s.layer,
          name: entry.name,
          color: entry.color,
          h: entry.h,
          sliderMin: Math.min(SLIDER_MIN, entry.h), sliderMax: Math.max(SLIDER_MAX, entry.h),
          dist: this.#dist(entry.h), distStep: step, distMin: this.#dist(H_MIN), distMax: this.#dist(H_MAX),
          heightLabel: this.#distLabel(entry.h),
          units: this.grid.units,
          kinds: KIND_KEYS.map((k, v) => ({ v, label: L(`GLDIO.kind.${k}`), selected: v === entry.kind })),
          cliffs: CLIFF_MATERIALS.map((k) => ({ key: k, label: L(`GLDIO.material.cliff.${k}`), selected: k === entry.material })),
          canRemove: t.palette.length > 1,
        },
        copyScenes,
        canCopy: copyScenes.length > 0,
        hasArt: !!src,
      };
    }

    /* ── DOM wiring ─────────────────────────────────────────────────── */

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      const el = this.window?.title;
      if (el && el.textContent !== this.title) el.textContent = this.title;
      for (const input of root.querySelectorAll("[data-field]")) {
        const live = input.type === "range" || input.type === "color";
        if (live) input.addEventListener("input", (ev) => this.#field(ev.currentTarget, true));
        input.addEventListener("change", (ev) => this.#field(ev.currentTarget, false));
      }
      for (const chip of root.querySelectorAll(".gldio-ed-chip[data-index]")) {
        chip.addEventListener("dblclick", () => root.querySelector("[data-field='entry.name']")?.select());
      }
    }

    #field(input, live) {
      const s = this.session, f = input.dataset.field;
      const num = () => Number(input.value);
      const readout = (text) => {
        const out = this.element.querySelector(`[data-readout="${f}"]`);
        if (out) out.textContent = text;
      };
      switch (f) {
        case "brush.radius":
          s.setOption("brush", { radius: num() }, { live });
          readout(s.tool === "difficult"
            ? L("GLDIO.editor.brush.cells", { n: 2 * Math.floor(s.brush.radius / SUB) + 1 })
            : L("GLDIO.editor.brush.subcells", { n: 2 * s.brush.radius + 1 }));
          break;
        case "wand.tolerance": s.setOption("wand", { tolerance: num() }, { live }); readout(String(s.wand.tolerance)); break;
        case "wand.contiguous": s.setOption("wand", { contiguous: input.checked }); break;
        case "view.opacity": s.setOption("view", { opacity: num() / 100 }, { live }); readout(`${Math.round(s.view.opacity * 100)}%`); break;
        case "step": s.set("step", num()); break;
        case "copyFrom": this._copyId = input.value; break;
        case "entry.name": if (!live) s.updateEntry(s.layer, { name: input.value.trim() || s.terrain.palette[s.layer].name }); break;
        case "entry.color": s.updateEntry(s.layer, { color: input.value }, { commit: !live }); break;
        case "entry.h": {
          const q = Math.round(num());
          s.updateEntry(s.layer, { h: q }, { commit: !live });
          readout(this.#distLabel(q));
          break;
        }
        case "entry.dist": {
          const q = Math.max(H_MIN, Math.min(H_MAX, Math.round(distToQ(num(), this.grid.distance))));
          s.updateEntry(s.layer, { h: q });
          break;
        }
        case "entry.kind": s.updateEntry(s.layer, { kind: num() }); break;
        case "entry.material": s.updateEntry(s.layer, { material: input.value }); break;
      }
    }

    #key(ev) {
      this.layer?.setModifiers?.({ shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey });
      if (!this.rendered || !this.layer) return;
      const tag = ev.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || ev.target?.isContentEditable) return;
      const mod = ev.ctrlKey || ev.metaKey;
      const k = ev.key?.toLowerCase();
      let handled = true;
      if (mod && k === "z" && !ev.shiftKey) this.session.undo();
      else if (mod && (k === "y" || (k === "z" && ev.shiftKey))) this.session.redo();
      else if (!mod && ev.key === "[") this.session.setOption("brush", { radius: this.session.brush.radius - 1 });
      else if (!mod && ev.key === "]") this.session.setOption("brush", { radius: this.session.brush.radius + 1 });
      else handled = false;
      if (handled) { ev.preventDefault(); ev.stopPropagation(); }
    }

    /* ── colours (wand + auto setup) ────────────────────────────────── */

    async #ensureColours({ notify = false } = {}) {
      const s = this.session;
      if (s.colours) return true;
      if (s.coloursState === "loading") return false;
      s.setColours(null, "loading");
      const res = await sampleColours(this.scene).catch(() => ({ error: "load" }));
      if (res?.colours) { s.setColours(res.colours, "ready"); return true; }
      s.setColours(null, "failed");
      if (notify) ui.notifications.warn(L(`GLDIO.editor.colours.${res?.error ?? "load"}`));
      return false;
    }

    /* ── saving ─────────────────────────────────────────────────────── */

    /** Write the draft and the pending difficult terrain. @returns {Promise<boolean>} */
    async save() {
      if (this._saving) return false;
      if (!game.user.isGM) return false;
      this._saving = true;
      this._busy = "save";
      this.#render();
      const s = this.session;
      try {
        await TerrainStore.write(this.scene, s.terrain);
        if (s.pending.length) {
          const plan = planDifficult(s.existingDifficult, s.pending);
          await writeDifficult(this.scene, plan, {
            name: (d) => L("GLDIO.editor.difficult.regionName", { x: d }),
            color: PALETTE.warn,
            levelId: levelIdOf(this.scene),
          });
        }
        s.saved({ difficult: readDifficult(this.scene) });
        ui.notifications.info(L("GLDIO.editor.saved", { scene: this.scene.name }));
        // An imported layout's tokens move once its terrain is saved, onto the saved ground.
        if (this._layoutTokens?.length) {
          const { placeTokens } = await import("./layout-import.mjs");
          const { moved, missing } = await placeTokens(this.scene, s.terrain, this._layoutTokens);
          this._layoutTokens = null;
          if (moved) ui.notifications.info(L("GLDIO.editor.layout.tokensMoved", { n: moved }));
          if (missing.length) ui.notifications.warn(L("GLDIO.editor.layout.tokensMissing", { names: missing.join(", ") }));
        }
        return true;
      } catch (e) {
        console.error("GLUniverse Suite | diorama editor save failed", e);
        ui.notifications.error(L("GLDIO.editor.saveFailed"));
        return false;
      } finally {
        this._saving = false;
        this._busy = null;
        this.#render();
      }
    }

    /** Run Auto setup (sample → autoSetup → replace the draft; one undoable step). */
    runAutoSetup() { return DioramaEditor.#onAutoSetup.call(this); }

    /* ── actions ────────────────────────────────────────────────────── */

    static #onTool(_ev, target) { this.session.setTool(target.dataset.tool); }
    static #onUndo() { this.session.undo(); }
    static #onRedo() { this.session.redo(); }

    static #onView(_ev, target) {
      const key = target.dataset.key;
      if (!["dim", "outlines", "overlay", "paused"].includes(key)) return;
      this.session.setOption("view", { [key]: !this.session.view[key] });
      this.#render();
    }

    static #onShape(_ev, target) { this.session.setOption("brush", { shape: target.dataset.shape === "square" ? "square" : "circle" }); }
    static #onWandMode(_ev, target) { this.session.setOption("wand", { mode: target.dataset.mode }); }

    static async #onSelection(_ev, target) {
      const what = target.dataset.what;
      if (what === "clear") this.session.clearMask();
      else if (what === "invert") this.session.invertMask();
      else this.session.applySelection(what);
    }

    static async #onSampleMap() { await this.#ensureColours({ notify: true }); }

    static #onStairKind(_ev, target) { this.session.set("stairKind", Number(target.dataset.kind) === KIND.RAMP ? KIND.RAMP : KIND.STAIRS); }
    static #onMaterial(_ev, target) { if (WALL_MATERIALS.includes(target.dataset.key)) this.session.set("material", target.dataset.key); }

    static #onAllWalls(_ev, target) {
      const s = this.session;
      const clear = target.dataset.clear === "1";
      for (const w of s.walls) {
        if (clear) delete s.terrain.walls[w.id];
        else s.terrain.walls[w.id] = s.material;
      }
      s.emit("walls");
      s.commit("walls");
      this.#render();
    }

    static #onDifficulty(_ev, target) { this.session.set("difficulty", Number(target.dataset.value) || 0); }

    static #onLayer(_ev, target) {
      const i = Number(target.closest("[data-index]")?.dataset.index);
      if (!Number.isInteger(i)) return;
      this.session.setLayer(i);
      if (!["brush", "rect", "fill", "wand"].includes(this.session.tool)) this.session.setTool("brush");
    }

    static #onAddLayer() {
      const i = this.session.addEntry({ name: L("GLDIO.editor.palette.newName", { n: this.session.terrain.palette.length }) });
      if (i < 0) ui.notifications.warn(L("GLDIO.editor.palette.full"));
    }

    static async #onRemoveLayer() {
      const s = this.session, entry = s.terrain.palette[s.layer];
      if (!entry || s.terrain.palette.length <= 1) return;
      const ok = await DialogV2.confirm({
        window: { title: L("GLDIO.editor.palette.removeTitle") },
        classes: ["gldio-app", "gldio-dialog"],
        content: `<p class="gldio-dialog-text">${L("GLDIO.editor.palette.removeBody", { name: foundry.utils.escapeHTML?.(entry.name) ?? entry.name })}</p>`,
        rejectClose: false,
      }).catch(() => false);
      if (ok) s.removeEntry(s.layer);
    }

    static async #onAutoSetup() {
      if (this._busy) return;
      this._busy = "auto";
      this.#render();
      try {
        const have = await this.#ensureColours();
        const s = this.session, g = this.grid;
        const res = autoSetupDetailed({
          colours: have ? s.colours : null,
          cols: g.cols, rows: g.rows, gridSize: g.size,
          walls: s.walls,
          sceneInside: sceneInsideFn(this.scene),
          palette: s.terrain.palette,
          wallHeight: s.terrain.wallHeight, stepHeight: s.terrain.stepHeight,
        });
        res.terrain.walls = { ...s.terrain.walls };
        s.replace(res.terrain, "auto");
        const st = res.stats;
        ui.notifications.info(L(have ? "GLDIO.editor.auto.done" : "GLDIO.editor.auto.doneNoArt", {
          rooms: st.roomCells, water: Math.round(st.water / (SUB * SUB)), void: Math.round(st.void / (SUB * SUB)),
        }));
      } catch (e) {
        console.error("GLUniverse Suite | diorama auto setup failed", e);
        ui.notifications.error(L("GLDIO.editor.auto.failed"));
      } finally {
        this._busy = null;
        this.#render();
      }
    }

    /** Paste or load a layout (docs/DIORAMA_LAYOUT.md) and replace the draft with it; one undoable step. */
    static async #onImportLayout() {
      const esc = (v) => foundry.utils.escapeHTML?.(v) ?? v;
      const text = await DialogV2.prompt({
        window: { title: L("GLDIO.editor.layout.title"), icon: "fa-solid fa-file-import" },
        classes: ["gldio-app", "gldio-dialog"],
        position: { width: 520 },
        content: `<p class="gldio-dialog-text">${esc(L("GLDIO.editor.layout.body"))}</p>
          <textarea name="layout" class="gldio-ed-layout" rows="14" spellcheck="false" placeholder='{ "format": "gluniverse-diorama-layout", … }'></textarea>
          <input type="file" name="file" accept=".json,application/json">`,
        ok: { label: L("GLDIO.editor.layout.apply"), icon: "fa-solid fa-file-import", callback: (_ev, button) => button.form.elements.layout.value },
        render: (_ev, dialog) => {
          const form = dialog.element.querySelector("form");
          form?.elements.file?.addEventListener("change", async (ev) => {
            const f = ev.target.files?.[0];
            if (f) form.elements.layout.value = await f.text();
          });
        },
        rejectClose: false,
      }).catch(() => null);
      if (!text?.trim()) return;
      const { parseLayout, compileForScene } = await import("./layout-import.mjs");
      let data;
      try { data = parseLayout(text); } catch (e) {
        ui.notifications.error(L("GLDIO.editor.layout.badJson", { error: e.message }));
        return;
      }
      const s = this.session;
      const res = compileForScene(this.scene, data, s.terrain);
      if (!res.terrain) {
        console.warn("GLUniverse Suite | diorama layout problems:", res.errors);
        ui.notifications.error(L("GLDIO.editor.layout.errors", { n: res.errors.length, error: res.errors[0] }));
        return;
      }
      if (res.warnings.length) console.warn("GLUniverse Suite | diorama layout warnings:", res.warnings);
      s.replace(res.terrain, "layout");
      this._layoutTokens = res.tokens;
      ui.notifications.info(L(res.tokens.length ? "GLDIO.editor.layout.doneTokens" : "GLDIO.editor.layout.done", {
        ops: Array.isArray(data.ops) ? data.ops.length : 0, tokens: res.tokens.length,
      }));
      if (res.warnings.length) ui.notifications.warn(L("GLDIO.editor.layout.warnings", { n: res.warnings.length, warning: res.warnings[0] }));
    }

    static #onCopyFrom() {
      const other = game.scenes.get(this._copyId);
      if (!other) return;
      const g = this.grid;
      const src = TerrainStore.read(other);
      const relaid = Terrain.fromJSON(src.toJSON(), { cols: g.cols, rows: g.rows });
      const ids = new Set(this.session.walls.map((w) => w.id));
      relaid.walls = Object.fromEntries(Object.entries(relaid.walls).filter(([id]) => ids.has(id)));
      // Keep this scene's own wall materials where the source had none for a wall.
      relaid.walls = { ...this.session.terrain.walls, ...relaid.walls };
      this.session.replace(relaid, "copy");
      ui.notifications.info(L("GLDIO.editor.copy.done", { scene: other.name }));
    }

    static async #onClearAll() {
      const ok = await DialogV2.confirm({
        window: { title: L("GLDIO.editor.clear.title") },
        classes: ["gldio-app", "gldio-dialog"],
        content: `<p class="gldio-dialog-text">${L("GLDIO.editor.clear.body")}</p>`,
        rejectClose: false,
      }).catch(() => false);
      if (!ok) return;
      this.session.replace(blankLike(this.session.terrain, sceneInsideFn(this.scene)), "clear");
    }

    static async #onToggleOff() {
      await TerrainStore.setOff(this.scene, !TerrainStore.isOff(this.scene));
      this.#render();
    }

    static async #onPreview() {
      if (this._preview?.rendered) { await this._preview.close(); this._preview = null; this.#render(); return; }
      const { openPreview } = await import("./preview.mjs");
      this._preview = openPreview(this);      // it clears this._preview itself on close
      this.#render();
    }

    static async #onSave() { await this.save(); }

    static async #onDiscard() {
      if (this.session.dirty) {
        const ok = await DialogV2.confirm({
          window: { title: L("GLDIO.editor.discard.title") },
          classes: ["gldio-app", "gldio-dialog"],
          content: `<p class="gldio-dialog-text">${L("GLDIO.editor.discard.body")}</p>`,
          rejectClose: false,
        }).catch(() => false);
        if (!ok) return;
      }
      await this.close({ force: true });
    }
  };

  return _App;
}

/* ── public API ──────────────────────────────────────────────────────────── */

/**
 * Open the terrain editor on a scene (GM only). Views the scene first if it is
 * not the one on the canvas, since painting happens on the 2D canvas.
 * @param {Scene} [scene]  defaults to the viewed scene
 * @param {{autoSetup?: boolean}} [o]  run Auto setup on open (the view's "Not set up" chip)
 */
export async function openEditor(scene = globalThis.canvas?.scene, { autoSetup = false } = {}) {
  if (!game.user?.isGM || !scene) return null;
  if (!supportsScene(scene)) { ui.notifications.warn(L("GLDIO.editor.unsupported")); return null; }
  if (_current?.rendered && _current.scene !== scene) {
    const closed = await _current.close();
    if (closed?.rendered) return _current;       // the GM chose to keep editing
  }
  if (canvas?.scene !== scene) await scene.view();
  if (_current?.rendered && _current.scene === scene) {
    _current.bringToFront?.();
    if (autoSetup) await _current.runAutoSetup();
    return _current;
  }
  const Cls = EditorApp();
  const app = new Cls(scene);
  _current = app;
  await app.render({ force: true });
  if (autoSetup) await app.runAutoSetup();
  return app;
}

/** Is the editor open (on `scene`, when given)? */
export function isEditing(scene = null) {
  if (!_current?.rendered) return false;
  return !scene || _current.scene === scene;
}

export function closeEditor(options = {}) {
  return _current?.close(options) ?? null;
}

/** The open editor, for the preview window. */
export const currentEditor = () => (_current?.rendered ? _current : null);
