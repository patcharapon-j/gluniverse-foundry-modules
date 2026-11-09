/**
 * Diorama — the renderer. See docs/DIORAMA.md, "Renderer contract".
 *
 * PURE: it never reads the world. The view, the editor's preview and the
 * preview page feed it plain state. 1 world unit = 1 cell; x = px / size,
 * z = py / size, y = q / 4.
 *
 *   const r = new DioramaRenderer({ canvas, pixelRatio });
 *   r.setGrid({ size, distance, cols, rows, sceneRect });
 *   r.setTerrain(terrain);                       // Terrain from terrain/model.mjs
 *   r.setBackground(image|null, rect);           // map art, placed over rect (px)
 *   r.setWalls(WallState[]);
 *   r.setTokens(TokenState[]);
 *   r.setHold(id, {x, y, footQ, groundQ, phase} | null);   // a miniature in a hand
 *   r.setLighting({ darkness, light, vision, sources });  // world-space canvases; sources: torches.mjs
 *   r.setOverlays({ path, cells, ruler, pings, hover, reach, los, falls });   // shapes: overlays.mjs
 *   r.setAreas(AreaState[]);                     // spell areas as volumes: areas.mjs
 *   r.setEffects(EffectState[]);
 *   r.setPixelSource({ frame(view) } | null);    // per-frame pixel effects (Spellsprite), see setPixelSource
 *   r.setLinks([{ sourceId, targetId, color:[r,g,b] }]);   // target lines, chest → base
 *   r.setCamera({ yawStep, pitchIndex, zoom, target }, { animate });
 *   r.getCamera();
 *   r.setOptions({ tiltShift, cutaway, ghosts, grid, graphics });  // grid: {on, color, alpha}
 *                                                // graphics: resolveGraphics() (options.mjs)
 *   r.setEnvironment(env);                       // resolved environment (environment.mjs)
 *   r.setProps(PropState[]);                     // render/props.mjs
 *   r.setPropsSeen(Set<propId>);                 // seen in 3D over hidden ground
 *   r.setLevels([{ id, terrain, image, rect, dim }]);  // floors below the viewed Level: render/level-stack.mjs
 *   r.setShed(ladderLike);                       // { allows(name) }
 *   r.requestRender();
 *   r.pick(clientX, clientY);   // {type:"token",id,part:"air"|"ground"} | {type:"door",id} | {type:"ground",x,y,zQ,i,j} | null
 *   r.pickPlane(clientX, clientY, zQ);   // {x, y} px on the level plane at zQ
 *   r.project(x, y, zQ);        // → {x, y} client px
 *   r.resize(width, height);
 *   r.dispose();
 *
 * Beyond the contract, for the view's Surfaces registration: `pause()`,
 * `resume()`, `webgl` (the THREE.WebGLRenderer) and `canvas`. For layers that
 * own shadow casters: `markShadowsDirty()`. For the readout (render/profile.mjs):
 * `setProfiling(on)`, `profile()` and the always-kept counts in `stats`.
 *
 * The loop renders ON DEMAND: one frame per requestRender, and frames for as
 * long as something animates (a tween, water, sway, a playing video, a ping),
 * holding Budget.claimMotion("diorama") only for that long. Living light is
 * the one thing that ticks instead: a flicker or a flame steps at its own low
 * cadence (TIMING.flickerTick, TIMING.fireTick): animation frames before the
 * tick is due return at once, and a tick whose lights did not visibly change
 * draws nothing. Without requestAnimationFrame
 * (Node) no loop ever starts.
 */

import * as THREE from "./three.mjs";
import { SHED_ORDER, FEATURE_ID, SUB } from "../constants.mjs";
import { Budget } from "../../../core/budget.mjs";
import { PALETTE } from "../../../core/theme.mjs";
import { createShared, cssRgb, MATERIALS } from "./materials.mjs";
import { SEE_MAX } from "./glsl.mjs";
import { TerrainLayer } from "./terrain.mjs";
import { WallsLayer } from "./walls.mjs";
import { StandeesLayer } from "./standees.mjs";
import { OverlaysLayer } from "./overlays.mjs";
import { AreasLayer } from "./areas.mjs";
import { EffectsLayer } from "./effects.mjs";
import { LinksLayer } from "./links.mjs";
import { CameraRig, VIEW_CELLS } from "./camera.mjs";
import { ShadowPass, TiltShift } from "./post.mjs";
import { PropsLayer } from "./props.mjs";
import { AtmosphereLayer } from "./atmosphere.mjs";
import { TorchesLayer } from "./torches.mjs";
import { FogLayer } from "./fog.mjs";
import { LevelStackLayer } from "./level-stack.mjs";
import { FrameProfile } from "./profile.mjs";
import { TilesLayer } from "./tiles.mjs";
import { RoofFader } from "./roofs.mjs";
import { DEFAULT_GRAPHICS } from "../options.mjs";

/** Under load (the fpsCap rung shed) the cap drops to this. */
const FPS_CAP_MS = 1000 / 30;
/** See-through: the cut's reach past a figure's half width, and the floor kept under its feet (cells). */
const SEE_MARGIN = 0.32;
const SEE_LIP = 0.22;
/** Which figures keep their cut when more than SEE_MAX stand on the board. */
const seeRank = (t) => (t?.targets?.length ? 8 : 0) + (t?.controlled ? 4 : 0) + (t?.hovered ? 2 : 0) + (t?.turn ? 1 : 0);

/** Under load (the renderScale rung shed) the chosen scale is multiplied by this. */
const RENDER_SCALE = 0.75;
const MAX_DT = 0.1;

const hasRaf = () => typeof globalThis.requestAnimationFrame === "function";
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const isVideo = (s) => typeof HTMLVideoElement !== "undefined" && s instanceof HTMLVideoElement;

/** True when the drawable can be uploaded to WebGL (not tainted). */
function uploadable(img) {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, 1, 1);
    g.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

function worldTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export class DioramaRenderer {
  /**
   * @param {{ canvas: HTMLCanvasElement, pixelRatio?: number }} o
   */
  constructor({ canvas, pixelRatio = 1 } = {}) {
    this.canvas = canvas;
    this.pixelRatio = Number(pixelRatio) > 0 ? Number(pixelRatio) : 1;
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.webgl.setPixelRatio(this.pixelRatio);
    this.webgl.setClearColor(new THREE.Color().setStyle(PALETTE.ink1, THREE.NoColorSpace), 1);
    this._appliedRatio = this.pixelRatio;
    this.maxAniso = this.webgl.capabilities.getMaxAnisotropy?.() ?? 1;

    this.shared = createShared();
    this._blank = { light: this.shared.uLightMap.value, vision: this.shared.uVisionMap.value };
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;

    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), MATERIALS.backdrop(this.shared));
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -1000;
    this.backdrop = backdrop;
    this.scene.add(backdrop);

    this.terrain = new TerrainLayer(this.shared);
    this.walls = new WallsLayer(this.shared);
    this.standees = new StandeesLayer(this.shared, () => this.requestRender());
    this.overlays = new OverlaysLayer(this.shared);
    this.areas = new AreasLayer(this.shared);
    this.effects = new EffectsLayer(this.shared);
    this.links = new LinksLayer(this.shared);
    this.props = new PropsLayer(this.shared, () => this.requestRender());
    this.atmosphere = new AtmosphereLayer(this.shared);
    this.torches = new TorchesLayer(this.shared);
    this.fog = new FogLayer(this.shared, { height: this.atmosphere.height, heightInfo: this.atmosphere.heightInfo });
    // flames sit on the rules ground (a brazier prop's top included)
    this.torches.setGround((x, z) => { const m = this.rulesModel(); return m ? m.groundAt(x * this.grid.size, z * this.grid.size, this.grid.size) / 4 : 0; });
    // the mist backdrop's box stands over the highest ground the party has seen (render/fog.mjs)
    this.fog.setGround((i, j) => { const m = this.terrainModel; try { return m ? m.cellTop(i, j) / 4 : NaN; } catch { return NaN; } });
    // Foundry tiles: decals on the ground and roofs over it, and the roofs' fades (docs/DIORAMA_BUILDINGS.md)
    this.tiles = new TilesLayer(this.shared, () => this.requestRender());
    this.roofs = new RoofFader();
    this._toCamera = new THREE.Vector3();
    for (const l of this.layers()) this.scene.add(l.group);
    // the Levels below the viewed one (render/level-stack.mjs): quieter floors, no shadows
    this.levelStack = new LevelStackLayer(this.shared, { maxAniso: this.maxAniso });
    this.scene.add(this.levelStack.group);
    /** The shadow pass's own-material casters: standee cards, then props. */
    this._casters = [this.standees.casters, this.props.casters, this.tiles.casters];
    /** Reused every frame: what the standees need from the view. */
    this._standeeFrame = { pxWorld: 0.01, cssPx: 1, markers: true, life: true, dust: true, hover: true };
    /** The per-frame pixel effects (setPixelSource), and the view it is handed (reused). */
    this.pixelSource = null;
    this._pixelView = { yaw: 0, pitch: 0, rx: 1, ry: 0, fx: 0, fy: -1, pxWorld: 0.01, size: 100, now: 0 };
    this._pixelWarned = false;

    this.rig = new CameraRig();
    this.shadow = new ShadowPass(this.shared);
    this.tilt = new TiltShift();
    this.raycaster = new THREE.Raycaster();

    this.grid = { size: 100, distance: 5, cols: 1, rows: 1, sceneRect: null };
    this.terrainModel = null;
    this.bg = { texture: null, source: null, rect: null };
    this.lightTex = null;
    this.visionTex = null;
    this.options = { tiltShift: false, cutaway: true, ghosts: true, grid: { on: false, color: "#000000", alpha: 0.35 } };
    /** What this machine's user chose (options.mjs resolveGraphics). */
    this.graphics = { ...DEFAULT_GRAPHICS };
    /** The resolved environment (environment.mjs); null = the neutral default. */
    this.env = null;
    /**
     * What this frame actually draws: the user's graphics capped by the shed
     * ladder (only while graphics.adaptive). Written at the top of frame();
     * layers read it. See effectiveFx().
     */
    this.fx = null;
    this._camSet = false;
    this._drawn = false;

    this._ownLadder = Budget.ladder(FEATURE_ID, SHED_ORDER);
    this.shed = this._ownLadder;
    this._unbudget = Budget.onChange(() => this.requestRender());

    this._raf = 0;
    this._last = 0;
    this._lastFrame = 0;
    this._motion = false;
    this._paused = false;
    this._disposed = false;
    this._waterClock = 0;
    /** Something asked for a frame (requestRender) since the last one drew. */
    this._wanted = false;
    /**
     * Clock ms of the next living-light tick (0: none). Until then an animation
     * frame that nobody asked for returns at once: no layer work, no draw.
     */
    this._tickAt = 0;
    /** The camera's frustum this frame: what a light's flicker must reach to be worth a frame. */
    this._frustum = new THREE.Frustum();
    this._viewProj = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this._inView = (x, y, z, r) => {
      this._sphere.center.set(x, y, z);
      this._sphere.radius = r;
      return this._frustum.intersectsSphere(this._sphere);
    };
    /**
     * Always kept, at the cost of an increment: frames drawn, ticks that drew
     * nothing, shadow-map renders. The readout and the preview's probe read them.
     */
    this.stats = { frames: 0, skipped: 0, shadowRenders: 0 };
    /** The readout (render/profile.mjs), only while someone looks: setProfiling. */
    this._profiling = false;
    this._profile = null;
    // Counts per frame, not per render() call: the shadow pass and the main pass add up.
    this.webgl.info.autoReset = false;

    // Overlays and picks stand on the RULES ground: the terrain with solid
    // props stamped in (props.rules), where a token actually stands.
    // A walk follows the same ground, so it climbs stairs and falls off ledges where they are.
    this.standees.setGround((x, z) => { const m = this.rulesModel(); return m ? m.groundAt(x * this.grid.size, z * this.grid.size, this.grid.size) / 4 : NaN; });
    this.overlays.setGround({
      ground: (x, z) => { const m = this.rulesModel(); return m ? m.groundAt(x * this.grid.size, z * this.grid.size, this.grid.size) / 4 : 0; },
      cellTopQ: (i, j) => { const m = this.rulesModel(); return m ? m.cellTop(i, j) : 0; },
    });
    // Spell areas stand on the same ground; a new ground under them rebuilds them.
    this.areas.setGround({
      cellTopQ: (i, j) => { const m = this.rulesModel(); return m ? m.cellTop(i, j) : 0; },
      model: () => this.rulesModel(),
    });

    const w = canvas?.clientWidth || canvas?.width || 1, h = canvas?.clientHeight || canvas?.height || 1;
    this.resize(w, h);
  }

  /** The terrain the rules see: the ground plus blocking props. */
  rulesModel() {
    return this.props.rules ?? this.terrainModel;
  }

  /** Every layer, in draw-group order. */
  layers() {
    return [this.terrain, this.props, this.walls, this.standees, this.overlays, this.areas, this.effects, this.links, this.atmosphere, this.torches, this.fog, this.tiles];
  }

  /* ------------------------------------------------------------ state in */

  setGrid({ size, distance, cols, rows, sceneRect } = {}) {
    const g = this.grid;
    if (Number(size) > 0) g.size = Number(size);
    if (Number(distance) > 0) g.distance = Number(distance);
    if (Number(cols) > 0) g.cols = Math.round(Number(cols));
    if (Number(rows) > 0) g.rows = Math.round(Number(rows));
    if (sceneRect) g.sceneRect = { ...sceneRect };
    this.shared.uWorldSize.value.set(g.cols, g.rows);
    for (const l of [this.walls, this.standees, this.overlays, this.areas, this.effects, this.props, this.atmosphere, this.torches, this.fog, this.tiles, this.rig]) l.setGridSize(g.size);
    this.torches.relayout();
    this.updateMapRect();
    this.updateShadowBounds();
    if (!this._camSet) {
      const r = g.sceneRect ?? { x: 0, y: 0, width: g.cols * g.size, height: g.rows * g.size };
      this.rig.set({ target: { x: r.x + r.width / 2, y: r.y + r.height / 2, zQ: 0 } }, clock(), false);
    }
    this.requestRender();
  }

  /** @param {import("../terrain/model.mjs").Terrain|null} terrain */
  setTerrain(terrain) {
    this.terrainModel = terrain ?? null;
    this.terrain.set(this.terrainModel);
    this.props.setTerrain(this.terrainModel);
    this.tiles.setTerrain(this.terrainModel);
    this.atmosphere.setTerrain(this.terrainModel, this.terrain.mesh);
    this.torches.relayout();
    this.fog.refreshTop();
    this.updateShadowBounds();
    this.requestRender();
  }

  /**
   * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement|ImageBitmap|null} image
   * @param {{x:number,y:number,width:number,height:number}} [rect]  px
   */
  setBackground(image, rect) {
    // An <img> still loading is applied when it lands; plain ground until then.
    if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement && !image.complete) {
      this._pendingBg = image;
      image.addEventListener("load", () => { if (this._pendingBg === image && !this._disposed) this.setBackground(image, rect); }, { once: true });
      image = null;
    } else {
      this._pendingBg = null;
    }
    if (image !== this.bg.source) {
      this.bg.texture?.dispose();
      this.bg.texture = null;
      this.bg.source = image ?? null;
      if (image) {
        if (!uploadable(image)) {
          console.warn("GLUniverse Suite | diorama: the map image cannot be used in WebGL (cross-origin without CORS); drawing plain ground.");
        } else {
          const t = isVideo(image) ? new THREE.VideoTexture(image) : new THREE.Texture(image);
          t.flipY = false;
          t.anisotropy = this.maxAniso;
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
          if (isVideo(image)) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
          else { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
          t.needsUpdate = true;
          this.bg.texture = t;
        }
      }
    }
    this.bg.rect = rect ? { ...rect } : null;
    this.shared.uMap.value = this.bg.texture;
    this.shared.uHasMap.value = this.bg.texture ? 1 : 0;
    this.updateMapRect();
    this.requestRender();
  }

  updateMapRect() {
    const g = this.grid;
    const r = this.bg.rect ?? { x: 0, y: 0, width: g.cols * g.size, height: g.rows * g.size };
    this.shared.uMapRect.value.set(r.x / g.size, r.y / g.size, Math.max(1e-3, r.width / g.size), Math.max(1e-3, r.height / g.size));
  }

  updateShadowBounds() {
    const m = this.terrain.mesh;
    this.shadow.setBounds({ x1: this.grid.cols, z1: this.grid.rows, y0: m ? m.baseY : -1, y1: Math.max((m ? m.maxY : 0) + 3, (this.props?.maxY ?? 0) + 0.5, (this.tiles?.maxY ?? 0) + 0.5) });
  }

  /**
   * Something that casts the sun's shadow changed (moved, appeared, changed
   * shape): the shadow map is drawn again on the next frame, once. The map is
   * fitted to the whole board, so the camera never dirties it. A layer that
   * owns casters calls this, or raises its own `castersDirty` that frame()
   * reads; an animated caster marks it only on the frames it moves.
   */
  markShadowsDirty() {
    this.shadow.dirty = true;
    this.requestRender();
  }

  /** @param {object[]} walls WallState[] */
  setWalls(walls) {
    this.walls.set(walls, clock(), this._drawn);
    // the soft fog map ends the mist on a sight-blocking wall's line (render/fog.mjs)
    this.fog.setWalls(walls);
    this.shadow.dirty = true;
    this.requestRender();
  }

  /** @param {object[]} tokens TokenState[] */
  setTokens(tokens) {
    this.standees.set(tokens, clock(), this._drawn);
    this.requestRender();
  }

  /**
   * A miniature in a hand (render/standees.mjs setHold): { x, y (px, foot
   * centre), footQ, groundQ, phase: "carry"|"drop" }, or null to let go.
   */
  setHold(id, hold) {
    this.standees.setHold(id, hold, clock());
    this.requestRender();
  }

  /**
   * The scene's light from the darker of Foundry's darkness and the hour's:
   * uAmbient, and uNight (0 by day, 1 at night, eased; the fog of war's
   * readability floors follow it, glsl.mjs dioNightness).
   */
  applyAmbient() {
    const d = Math.max(this._darkness ?? 0, this.env?.darkness ?? 0);
    this.shared.uAmbient.value = 1 - d * 0.85;
    const t = Math.max(0, Math.min(1, (d - 0.3) / 0.52));
    this.shared.uNight.value = t * t * (3 - 2 * t);
  }

  /**
   * `sources`: the lights in the bake, as plain data (view/bake.mjs
   * lightData): what flickers, burns and shades (render/torches.mjs).
   * @param {{darkness?:number, light?:HTMLCanvasElement|null, vision?:HTMLCanvasElement|null, sources?:object[]}} o
   */
  setLighting({ darkness = 0, light = null, vision = null, sources = null } = {}) {
    this.torches.setSources(sources, this.grid);
    this.fog.setVision(vision);
    const d = Math.max(0, Math.min(1, Number(darkness) || 0));
    this._darkness = d;
    this.applyAmbient();
    this.lightTex = this.swapWorldTexture(this.lightTex, light);
    this.shared.uLightMap.value = this.lightTex ?? this._blank.light;
    this.visionTex = this.swapWorldTexture(this.visionTex, vision);
    this.shared.uVisionMap.value = this.visionTex ?? this._blank.vision;
    this.shared.uUseVision.value = this.visionTex ? 1 : 0;
    this.requestRender();
  }

  swapWorldTexture(current, canvas) {
    if (!canvas) { current?.dispose(); return null; }
    if (current && current.image === canvas) { current.needsUpdate = true; return current; }
    current?.dispose();
    return worldTexture(canvas);
  }

  setOverlays(o = {}) {
    this.overlays.set(o ?? {}, clock());
    this.requestRender();
  }

  /**
   * Spell areas as volumes over their covered squares (render/areas.mjs).
   * An unchanged list rebuilds nothing.
   * @param {object[]} areas
   */
  setAreas(areas) {
    if (this.areas.set(areas ?? [])) this.requestRender();
  }

  /**
   * Target lines, drawn as raised arcs from a source's chest to a target's
   * base. Only these are drawn; a link whose ends are not on the board is
   * dropped. color: [r,g,b] 0..1 (a CSS colour also works).
   * @param {{sourceId:string, targetId:string, color:number[]|string}[]} links
   */
  setLinks(links) {
    this.links.set(links);
    this.requestRender();
  }

  /** @param {object[]} effects EffectState[] */
  setEffects(effects) {
    this.effects.set(effects);
    this.requestRender();
  }

  /**
   * Pixel effects painted per frame from the camera (integrations/spellsprite.mjs).
   * `src.frame(view)` is asked once per drawn frame with
   * `{ yaw, pitch, rx, ry, fx, fy, pxWorld, size, now }` (the eased camera: its
   * right and away vectors across the map, scene axes; world cells per device
   * px) and returns `{ live, effects: pixel EffectState[], react, shake }`:
   * `react(id, x, z)` per standee (render/standees.mjs setReactions), `shake`
   * {x, y} cells along the screen. While `live` the loop keeps drawing (and
   * holds the motion claim); an idle source costs one call per frame that some
   * other change asked for, and nothing at all otherwise.
   * @param {{frame:(view:object) => object}|null} src
   */
  setPixelSource(src) {
    this.pixelSource = src && typeof src.frame === "function" ? src : null;
    if (!this.pixelSource) {
      this.effects.setPixels([]);
      this.effects.pixelLive = false;
      this.standees.setReactions(null);
      this.rig.setShake(0, 0);
    }
    this.requestRender();
  }

  /** Ask the pixel source for this frame. @returns {boolean} live */
  pixelFrame(now, pxWorld) {
    const src = this.pixelSource;
    if (!src) return false;
    const v = this._pixelView, yaw = this.rig.view.yaw, pitch = this.rig.view.pitch;
    // camera at target + (sin yaw, ·, cos yaw): right across the map is (cos, −sin), away (−sin, −cos)
    v.yaw = yaw; v.pitch = pitch;
    v.rx = Math.cos(yaw); v.ry = -Math.sin(yaw);
    v.fx = -Math.sin(yaw); v.fy = -Math.cos(yaw);
    v.pxWorld = pxWorld; v.size = this.grid.size || 100; v.now = now;
    let out = null;
    try { out = src.frame(v); } catch (e) {
      if (!this._pixelWarned) { this._pixelWarned = true; console.error("GLUniverse Suite | diorama pixel effects failed", e); }
      out = null;
    }
    const live = !!out?.live;
    this.effects.setPixels(out?.effects ?? []);
    this.effects.pixelLive = live;
    this.standees.setReactions(out?.react ?? null);
    this.rig.setShake(Number(out?.shake?.x) || 0, Number(out?.shake?.y) || 0);
    return live;
  }

  /**
   * @param {{yawStep?:number, pitchIndex?:number, zoom?:number, target?:{x:number,y:number,zQ:number}}} state
   * @param {{animate?:boolean}} [o]
   */
  setCamera(state = {}, { animate = true } = {}) {
    if (state?.target) this._camSet = true;
    const now = clock();
    this.rig.set(state ?? {}, now, animate && this._drawn);
    this.walls.setCameraYaw(this.rig.targetYaw, now, animate && this._drawn);
    this.requestRender();
  }

  getCamera() {
    return this.rig.get();
  }

  /**
   * The scene's environment, already resolved (environment.mjs): time of day,
   * sun, sky, weather, atmosphere, wind. null = the neutral default.
   * @param {object|null} env
   */
  setEnvironment(env) {
    // the same environment again (a hook that changed nothing it reads) costs nothing
    if (!this.atmosphere.setEnvironment(env ?? null) && this._envSet) return;
    this._envSet = true;
    this.env = env ?? null;
    this.applyAmbient();
    this.props.setEnvironment?.(this.env);
    this.shadow.dirty = true;
    this.requestRender();
  }

  /** @param {object[]} props PropState[] (render/props.mjs) */
  setProps(props) {
    this.props.set(props ?? [], clock(), this._drawn);
    this.torches.setProps(props ?? []);
    this.shadow.dirty = true;
    this.updateShadowBounds();
    this.requestRender();
  }

  /** @param {Set<string>} ids props a viewer sees in 3D over hidden ground (view/props-seen.mjs) */
  setPropsSeen(ids) {
    this.props.setSeen(ids);
    this.requestRender();
  }

  /** @param {object[]} tiles TileState[] (integrations/tiles.mjs; render/tiles.mjs draws them) */
  setTiles(tiles) {
    this.tiles.set(tiles ?? []);
    this.shadow.dirty = true;
    this.updateShadowBounds();
    this.requestRender();
  }

  /**
   * What every roof should show, and the figures the camera keeps clear of
   * roofs (view/roofs.mjs readRoofs). The fades run in frame().
   * @param {{roofs?:object[], focus?:object[]}} o
   */
  setRoofs({ roofs = [], focus = [] } = {}) {
    this.roofs.set(roofs, focus);
    this.requestRender();
  }

  /**
   * The floors below the viewed Level, lowest first (render/level-stack.mjs):
   * each its terrain in the absolute frame, its own art and a dim. The table's
   * shadow moves under the lowest of them. [] in a one-Level scene.
   * @param {Array<{id:string, terrain:object, image?:any, rect?:object, dim?:number}>} levels
   */
  setLevels(levels) {
    this.levelStack.set(levels ?? [], this.grid);
    this.terrain.setTableFloor(this.levelStack.lowestY);
    this.requestRender();
  }

  setOptions({ tiltShift, cutaway, ghosts, grid, graphics } = {}) {
    const now = clock();
    // The map is depth only, the same for hard and soft; with shadows off it is
    // skipped and its dirty flag waits. Only prop detail reshapes a caster.
    if (graphics) {
      const detail = this.graphics.detail;
      this.graphics = { ...DEFAULT_GRAPHICS, ...graphics };
      if (this.graphics.detail !== detail) this.shadow.dirty = true;
    }
    if (grid !== undefined) this.setGridLines(grid);
    if (tiltShift !== undefined) this.options.tiltShift = !!tiltShift;
    if (cutaway !== undefined) { this.options.cutaway = !!cutaway; this.walls.setCutaway(this.options.cutaway, now, this._drawn); }
    if (ghosts !== undefined) { this.options.ghosts = !!ghosts; this.standees.setGhosts(this.options.ghosts); }
    this.requestRender();
  }

  /**
   * The grid drawn on walkable tops.
   * @param {{on?:boolean, color?:string, alpha?:number}|null} g
   */
  setGridLines(g) {
    const on = !!g?.on;
    const alpha = Math.max(0, Math.min(1, Number(g?.alpha ?? 0.35)));
    const [r, gr, b] = cssRgb(g?.color || "#000000", "#000000");
    this.options.grid = { on, color: g?.color || "#000000", alpha };
    this.shared.uGrid.value.set(r, gr, b, on ? alpha : 0);
    this.requestRender();
  }

  /** @param {{allows:(name:string)=>boolean}|null} ladder  null restores the renderer's own */
  setShed(ladder) {
    this.shed = ladder && typeof ladder.allows === "function" ? ladder : this._ownLadder;
    this.requestRender();
  }

  /* ------------------------------------------------------------ loop */

  /** Draw the next frame (something changed, or something animates). */
  requestRender() {
    this._wanted = true;
    this.schedule();
  }

  /** The next animation frame, without asking it to draw: a tick decides for itself. */
  schedule() {
    if (this._disposed || this._paused || this._raf || !hasRaf()) return;
    this._raf = globalThis.requestAnimationFrame((t) => this.frame(t));
  }

  pause() {
    this._paused = true;
    if (this._raf && typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._tickAt = 0;
    this.claim(false);
  }

  resume() {
    this._paused = false;
    this._last = 0;
    this.requestRender();
  }

  claim(on) {
    if (on === this._motion) return;
    this._motion = on;
    Budget.claimMotion(FEATURE_ID, on);
  }

  /** Every SHED_ORDER name, asked of the ladder in force. Without adaptive graphics, all allowed. */
  shedFlags() {
    const s = this.shed;
    const adaptive = this.graphics.adaptive !== false;
    const allows = (n) => { if (!adaptive) return true; try { return s.allows(n) !== false; } catch { return true; } };
    return {
      tiltShift: allows("tiltShift"),
      atmosphere: allows("atmosphere"),
      weatherParticles: allows("weatherParticles"),
      ambientOcclusion: allows("ambientOcclusion"),
      softShadows: allows("softShadows"),
      propDetail: allows("propDetail"),
      shadows: allows("shadows"),
      water: allows("water"),
      standeeDust: allows("standeeDust"),
      standeeSway: allows("standeeSway"),
      markerMotion: allows("markerMotion"),
      areaMotion: allows("areaMotion"),
      effectLights: allows("effectLights"),
      renderScale: allows("renderScale"),
      fpsCap: allows("fpsCap"),
      // living light and the fog of war's clouds (torches.mjs, fog.mjs)
      embers: allows("embers"),
      fogDrift: allows("fogDrift"),
      torchShadows: allows("torchShadows"),
      torchFlicker: allows("torchFlicker"),
      // Foundry tiles and roofs (tiles.mjs, roofs.mjs)
      tileVideo: allows("tileVideo"),
      roofFade: allows("roofFade"),
    };
  }

  /**
   * The user's graphics (this.graphics) capped by what the ladder still allows.
   * Every layer draws from this, never from the raw choice: a rung the budget
   * shed is gone however high the user set it.
   * @param {ReturnType<DioramaRenderer["shedFlags"]>} shed
   */
  effectiveFx(shed) {
    const g = this.graphics;
    return {
      shadows: shed.shadows ? Math.min(g.shadows, shed.softShadows ? 2 : 1) : 0,
      ao: g.ao && shed.ambientOcclusion,
      water: shed.water ? g.water : 0,
      waterMotion: shed.water,
      detail: shed.propDetail ? g.detail : 0,
      weather: shed.weatherParticles ? g.weather : 0,
      atmosphere: g.atmosphere && shed.atmosphere,
      dayNight: g.dayNight,
      grade: g.grade,
      tiltShift: this.options.tiltShift && shed.tiltShift,
      // token life (dio.tokenLife): walk bob, falls, landing dust, flyer hover, idle sway
      life: g.tokenLife !== false,
      dust: g.tokenLife !== false && shed.standeeDust,
      hover: g.tokenLife !== false && shed.standeeSway,
      sway: g.tokenLife !== false && shed.standeeSway,
      markers: shed.markerMotion,
      // spell areas (dio.areaVolumes): the volumes, and the glow rising through them
      areaVolumes: g.areaVolumes !== false,
      areaMotion: g.areaVolumes !== false && shed.areaMotion,
      effectLights: shed.effectLights,
      renderScale: Math.max(0.25, Math.min(1, g.renderScale)) * (shed.renderScale ? 1 : RENDER_SCALE),
      frameMs: !shed.fpsCap ? FPS_CAP_MS : g.fps > 0 ? 1000 / g.fps : 0,
      // living light (dio.lightFx): flicker and flames, embers, torch shading and figure shadows
      lightFx: g.lightFx !== false,
      flicker: g.lightFx !== false && shed.torchFlicker,
      embers: g.lightFx !== false && shed.embers,
      torchShadows: g.lightFx !== false && shed.torchShadows,
      // the fog of war (dio.fogStyle): 1 clouds, 0 flat; clouds hold still when fogDrift is shed
      fog: g.fog ?? 1,
      fogDrift: shed.fogDrift,
      // a video tile holds its frame; roofs snap open and shut
      tileVideo: shed.tileVideo,
      roofFade: shed.roofFade,
    };
  }

  frame(now) {
    this._raf = 0;
    if (this._disposed || this._paused) return;
    const shed = this.shedFlags();
    const fx = this.effectiveFx(shed);
    this.fx = fx;
    if (fx.frameMs && this._lastFrame && now - this._lastFrame < fx.frameMs - 2) {
      this.schedule();
      return;
    }
    // Asked to draw (requestRender), or only waiting for a living-light tick?
    if (!this._wanted && this._tickAt && clock() < this._tickAt - 1) {
      this.schedule();
      return;
    }
    const wanted = this._wanted;
    this._wanted = false;
    this._tickAt = 0;
    const dt = this._last ? Math.min(MAX_DT, (now - this._last) / 1000) : 0;
    this._last = now;
    this._lastFrame = now;
    const t = clock();

    let active = this.rig.update(t);
    const yaw = this.rig.view.yaw;
    if (this.walls.update(t)) { active = true; this.shadow.dirty = true; }
    const sway = fx.sway && this.standees.count > 0;
    // world units per device px: outlines and margins are sized in screen px
    const ratio0 = this.pixelRatio * fx.renderScale;
    this.links.viewport.value.set((this._w * ratio0) / 2, (this._h * ratio0) / 2);
    this.links.setPixelScale(ratio0);
    const sf = this._standeeFrame;
    sf.pxWorld = VIEW_CELLS / Math.max(1e-3, this.rig.view.zoom) / Math.max(1, this._h * ratio0);
    sf.cssPx = ratio0;
    this.atmosphere.pxWorld = sf.pxWorld;
    this.props.pxWorld = sf.pxWorld;
    sf.markers = fx.markers;
    sf.life = fx.life; sf.dust = fx.dust; sf.hover = fx.hover;
    // pixel effects paint from this camera, before the figures they strike take their pose
    if (this.pixelFrame(t, sf.pxWorld)) active = true;
    if (this.standees.frame(t, this.rig.camera, yaw, sway, sf)) active = true;
    if (this.standees.castersDirty) { this.standees.castersDirty = false; this.shadow.dirty = true; }
    this.writeSeeThrough(sf.pxWorld);
    if (sway) active = true;
    if (this.standees.targeted && fx.markers) active = true;
    if (this.links.frame(t, this.standees, fx.markers) && fx.markers) active = true;
    if (this.overlays.frame(t)) active = true;
    if (this.areas.frame(t, fx)) active = true;
    this.effects.frame(this.rig.camera);
    this.effects.writeLights(fx.effectLights);
    if (this.effects.animated) active = true;
    // The clock every animated surface reads (water, foliage, weather). It runs
    // only while something on the board animates with it.
    const clocked = (this.terrain.hasWater && fx.waterMotion) || this.props.animated(fx) || this.atmosphere.animated(fx);
    if (clocked) {
      this._waterClock += dt;
      active = true;
    }
    this.shared.uTime.value = this._waterClock;
    if (this.props.frame(t, dt, this.rig.camera, fx)) active = true;
    if (this.props.castersDirty) { this.props.castersDirty = false; this.shadow.dirty = true; }
    if (this.atmosphere.frame(t, dt, this.rig.camera, fx, this.rig.view)) active = true;
    // the camera's frustum: a light whose flicker cannot reach the screen asks for no ticks
    const cam = this.rig.camera;
    this._frustum.setFromProjectionMatrix(this._viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    if (this.torches.frame(t, dt, fx, this.rig.view, this.standees, sf.pxWorld, this._inView)) active = true;
    if (this.fog.frame(dt, fx)) active = true;
    // roofs: fade toward what the view decided, and away from the camera over a viewer's figure
    if (this.roofs.size) {
      const dir = this.rig.camera.getWorldDirection(this._toCamera).negate();
      if (this.roofs.frame(dt, dir, !fx.roofFade)) active = true;
      if (this.roofs.changed) {
        this.roofs.changed = false;
        this.tiles.applyRoofs(this.roofs);
        this.props.setRoofFade?.(this.roofs.propAlphas());
      }
    }
    if (this.tiles.frame(t, dt, fx)) active = true;
    if (this.tiles.castersDirty) { this.tiles.castersDirty = false; this.shadow.dirty = true; this.updateShadowBounds(); }
    if (isVideo(this.bg.source) && !this.bg.source.paused) active = true;

    const shadows = fx.shadows > 0;
    this.shared.uShadowMode.value = fx.shadows;
    this.shared.uAOOn.value = fx.ao ? 1 : 0;
    const ratio = this.pixelRatio * fx.renderScale;
    if (ratio !== this._appliedRatio) {
      this._appliedRatio = ratio;
      this.webgl.setPixelRatio(ratio);
      this.webgl.setSize(this._w, this._h, false);
    }

    // A frame woken only by a living-light tick draws only when a light visibly
    // changed; anything else that asked, or that animates, draws as before.
    const draw = wanted || active || this.torches.changed;
    const prof = this.profiling ? (this._profile ??= new FrameProfile(this.webgl.getContext?.() ?? null)) : null;
    if (draw) {
      try {
        this.webgl.info.reset();
        prof?.gpu.begin();
        if (shadows && this.shadow.render(this.webgl, this.scene, this._casters)) {
          this.stats.shadowRenders++;
          prof?.shadow(t);
        }
        if (fx.tiltShift) this.tilt.render(this.webgl, this.scene, this.rig.camera);
        else {
          this.webgl.setRenderTarget(null);
          this.webgl.render(this.scene, this.rig.camera);
        }
        prof?.gpu.end();
        this._drawn = true;
        // whatever hangs over the figures (the view's bars) follows this exact pose
        try { this.onDrawn?.(); } catch (e) { console.error("GLUniverse Suite | diorama onDrawn", e); }
        this.stats.frames++;
        prof?.frame({ at: t, cpuMs: clock() - t, calls: this.webgl.info.render.calls, triangles: this.webgl.info.render.triangles });
      } catch (e) {
        prof?.gpu.end();
        console.error("GLUniverse Suite | diorama render failed", e);
        active = false;
      }
    } else this.stats.skipped++;

    // The next living-light tick, unless something animates at the full rate anyway.
    const wake = active ? Infinity : this.torches.nextAt;
    this.claim(active || Number.isFinite(wake));
    if (active) this.requestRender();
    else if (Number.isFinite(wake)) { this._tickAt = wake; this.schedule(); }
  }

  /* ------------------------------------------------------------ readout */

  /** True while the readout is open here (setProfiling) or the shared budget is profiling (Budget.profiling). */
  get profiling() {
    return this._profiling || Budget.profiling;
  }

  /** The Graphics panel's readout: time frames only while it is open. */
  setProfiling(on) {
    const was = this._profiling;
    this._profiling = !!on;
    if (!this.profiling && this._profile) { this._profile.dispose(); this._profile = null; }
    if (this._profiling && !was) this.requestRender();
  }

  /**
   * What the view costs now (render/profile.mjs FrameProfile#read): GPU and CPU
   * ms per drawn frame, draw calls and triangles of the last one, frames and
   * shadow-map renders over the last second, and the shed rung in force.
   * null while nobody is profiling; a still board reads 0 frames per second.
   */
  profile() {
    if (!this.profiling || this._disposed) return null;
    this._profile ??= new FrameProfile(this.webgl.getContext?.() ?? null);
    const names = SHED_ORDER.filter((n) => { try { return this.graphics.adaptive !== false && this.shed.allows(n) === false; } catch { return false; } });
    return this._profile.read(clock(), { level: names.length, of: SHED_ORDER.length, name: names.at(-1) ?? null });
  }

  /* ------------------------------------------------------------ queries */

  ndc(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / (r.width || 1)) * 2 - 1, -((clientY - r.top) / (r.height || 1)) * 2 + 1);
  }

  /**
   * @returns {{type:"token",id:string}|{type:"door",id:string}|{type:"ground",x:number,y:number,zQ:number,i:number,j:number}|null}
   */
  pick(clientX, clientY, { exclude = null, doors = true } = {}) {
    if (this._disposed) return null;
    this.rig.camera.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.rig.camera);
    const token = this.standees.pickPart(this.raycaster, exclude);
    if (token) return { type: "token", id: token.id, part: token.part };
    const door = doors ? this.raycaster.intersectObjects(this.walls.pickables(), false)[0] : null;
    if (door) return { type: "door", id: door.object.userData.doorId };
    const prop = this.props.pick(this.raycaster);
    if (prop) return this.groundPick(prop.point, null);
    const hit = this.raycaster.intersectObjects(this.terrain.pickables(), false)[0];
    if (!hit) {
      // no terrain: the ground plane at 0
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
      return this.groundPick(p, null);
    }
    return this.groundPick(hit.point.clone(), hit);
  }

  /**
   * Where the pointer meets the level plane at height zQ, in px: what a flyer
   * carried at its altitude is over. null when the ray runs parallel or away.
   */
  pickPlane(clientX, clientY, zQ = 0) {
    if (this._disposed) return null;
    this.rig.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.rig.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(Number(zQ) || 0) / 4), p)) return null;
    const S = this.grid.size;
    return { x: p.x * S, y: p.z * S };
  }

  groundPick(p, hit) {
    if (hit && hit.object.userData.pick === "side" && hit.face) p.addScaledVector(hit.face.normal, -0.02);
    const S = this.grid.size;
    const t = this.rulesModel();
    const si = Math.floor(p.z * SUB), sj = Math.floor(p.x * SUB);
    const zQ = t ? t.topAt(si, sj) : Math.round(p.y * 4);
    return { type: "ground", x: p.x * S, y: p.z * S, zQ, i: Math.floor(p.z), j: Math.floor(p.x) };
  }

  /** px + q → client px. */
  /**
   * A shown standee's box on screen, client px: its middle (cx), the lowest
   * point of its base (footY), the top of its leaned head (headY), the base's
   * width (w) and the cells-to-px scale there (pxPerCell). Null when it is not
   * drawn. Read after a frame, it is that frame's pose.
   * @param {string} id
   */
  /**
   * See-through (glsl.mjs dioSeeThrough): every figure shown on the board, as a
   * capsule on screen from its base to its head in the render target's device
   * px, with its base's camera-side rim depth and its feet. Occluders in front
   * of a figure are cut around it. Off with the cutaway. Allocates nothing.
   * Over SEE_MAX figures, the ones a viewer is acting on (targeted, controlled,
   * hovered, on their turn) are kept first.
   */
  writeSeeThrough(pxWorld) {
    const u = this.shared;
    if (!this.options.cutaway || !this.standees.count) { u.uSeeCount.value = 0; return; }
    const cam = this.rig.camera;
    const buf = this.webgl.getDrawingBufferSize(this._seeBuf ??= new THREE.Vector2());
    const v = (this._seeV ??= new THREE.Vector3());
    const head = (this._seeHead ??= new THREE.Vector3());
    const list = (this._seeList ??= []);
    list.length = 0;
    for (const e of this.standees.entries.values()) if (e.root.visible && e.card?.visible !== false) list.push(e);
    if (list.length > SEE_MAX) list.sort((a, b) => seeRank(b.state) - seeRank(a.state));
    const yaw = this.rig.view.yaw;
    const tx = Math.sin(yaw), tz = Math.cos(yaw);
    const px = Math.max(1e-6, pxWorld);
    let n = 0;
    for (let i = 0; i < list.length && n < SEE_MAX; i++) {
      const e = list[i];
      const foot = this.standees.footOf(e.id);
      if (!foot || !this.standees.anchorOf(e.id, "head", head)) continue;
      v.set(foot.x, foot.y, foot.z).project(cam);
      const fx = (v.x + 1) * 0.5 * buf.x, fy = (v.y + 1) * 0.5 * buf.y;
      v.copy(head).project(cam);
      const hx = (v.x + 1) * 0.5 * buf.x, hy = (v.y + 1) * 0.5 * buf.y;
      // the base's rim nearest the camera: anything in front of it may hide the figure
      v.set(foot.x + tx * foot.r, foot.y, foot.z + tz * foot.r).project(cam);
      const rim = v.z * 0.5 + 0.5;
      if (![fx, fy, hx, hy, rim].every(Number.isFinite)) continue;
      const half = Math.max(foot.r, (e.cardW ?? 1) * 0.5);
      u.uSeeSeg.value[n].set(fx, fy, hx, hy);
      u.uSeeInfo.value[n].set((half + SEE_MARGIN) / px, rim, foot.y + SEE_LIP, 1);
      n++;
    }
    u.uSeeCount.value = n;
  }

  standeeBox(id) {
    const foot = this.standees.footOf?.(String(id));
    const head = foot ? this.standees.headOf(String(id)) : null;
    if (!foot || !head) return null;
    const cam = this.rig.camera;
    const r = this.canvas.getBoundingClientRect?.() ?? { left: 0, top: 0, width: this._w, height: this._h };
    const v = (this._boxV ??= new THREE.Vector3());
    const toClient = (x, y, z) => {
      v.set(x, y, z).project(cam);
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    const yaw = this.rig.view.yaw;
    // toward the camera along the ground: the base's nearest rim is its lowest point on screen
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const c = toClient(foot.x, foot.y, foot.z);
    const low = toClient(foot.x + fx * foot.r, foot.y, foot.z + fz * foot.r);
    const side = toClient(foot.x + fz * foot.r, foot.y, foot.z - fx * foot.r);
    const top = toClient(head.x, head.y, head.z);
    const half = Math.hypot(side.x - c.x, side.y - c.y);
    const pxPerCell = half / Math.max(1e-6, foot.r);
    if (![c.x, low.y, top.y, pxPerCell].every(Number.isFinite)) return null;
    return { cx: c.x, footY: low.y, headY: top.y, w: half * 2, pxPerCell };
  }

  project(x, y, zQ = 0) {
    const S = this.grid.size;
    const v = new THREE.Vector3(Number(x) / S, Number(zQ) / 4, Number(y) / S).project(this.rig.camera);
    const r = this.canvas.getBoundingClientRect?.() ?? { left: 0, top: 0, width: this._w, height: this._h };
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  resize(width, height) {
    const w = Math.max(1, Math.round(Number(width) || 1)), h = Math.max(1, Math.round(Number(height) || 1));
    this._w = w; this._h = h;
    this.webgl.setSize(w, h, true);
    this.rig.setAspect(w / h);
    this.requestRender();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._raf && typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._tickAt = 0;
    this.claim(false);
    this._profile?.dispose();
    this._profile = null;
    this._unbudget?.();
    this._ownLadder?.dispose();
    for (const l of this.layers()) l.dispose();
    this.levelStack.dispose();
    this.shadow.dispose();
    this.tilt.dispose();
    this.backdrop.geometry.dispose();
    this.backdrop.material.dispose();
    this.bg.texture?.dispose();
    this.lightTex?.dispose();
    this.visionTex?.dispose();
    this._blank.light.dispose();
    this._blank.vision.dispose();
    this.webgl.renderLists.dispose();
    this.webgl.dispose();
  }
}
