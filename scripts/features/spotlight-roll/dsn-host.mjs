/**
 * The Dice So Nice die host: the roller's OWN dice, drawn by DSN, posed by us.
 *
 * Same interface as the preview's stand-in (tools/spotlight-roll/die.mjs), so
 * the director cannot tell them apart. The dice are never thrown:
 * DSN builds the mesh and the material, the tumble model poses it.
 *
 * Seams that do not show in a diff:
 *
 * • DiceScene, not DiceBox. DSN 6 does not export its classes; the scene class
 *   is reached as `game.dice3d.box.diceScene.constructor`. DiceBox is the wrong
 *   one to mount: its initialize() calls `dicefactory.setQualitySettings()` on
 *   the factory DSN's own board shares, and its physics only exists for
 *   boxType "board". DiceScene is what DSN's own die editor mounts.
 *
 * • The renderer cache key. DiceScene keeps one WebGLRenderer per
 *   `rendererCacheKey` in `game.dice3d.dice3dRenderers`, and the key doubles as
 *   `scopedTextureCache.type`, which prefixes every cached material. "glSpotlight"
 *   is not a prefix of board/showcase/editor/persistent, so this is our own
 *   context, our own HDR environment, and `disposeCachedMaterials(KEY)` frees only
 *   ours. "board" or "persistent" would also register physics shapes and switch
 *   to the board's scale.
 *
 * • Geometry is never disposed. `DiceFactory.geometries` is one cache shared with
 *   DSN's board. Materials from `create()` are DSN's cache too; anything we
 *   mutate (relabel, shatter) is a clone this file owns and frees.
 *
 * • The factory is rebuilt on every window resize (`resizeAndRebuild`), so it is
 *   always read fresh from `game.dice3d.DiceFactory`, never held.
 *
 * • Faces come from the label atlas, not a shape table (DSN exports none). Every
 *   label is a 256px tile in row-major order, `tpl = ceil(sqrt(labelCount))`
 *   tiles per row, on a power-of-two canvas `ceil2(sqrt(labelCount) · 256)`.
 *   Tile t holds shape face `t − edgeOffset + 1`, where edgeOffset is the edge
 *   tiles in front (2; 1 on d2/d10; d4 is 6 tiles with 2 edge). The triangles
 *   whose UV centroid falls in a tile ARE that face: their normal is the face
 *   normal and −∂P/∂v (canvas y runs down, flipY is false) is the way its number
 *   reads up. On a d4 the tile holds the down face, whose value DSN reads at the
 *   top vertex. tools check: see faceFrames() below, which is pure.
 *
 * • Relabel never rebuilds the material. A rebuild re-runs the Sobel normal bake
 *   on the whole atlas (2048² on a d20, ~0.4 s on the main thread). Instead one
 *   tile is redrawn with DSN's own `createTextMaterial` on 256² canvases, Sobel'd
 *   alone, and patched into CLONED canvases with `copyTextureToTexture`.
 *
 * The camera is DSN's own: looking straight down −Y with screen-up −Z. So the
 * face shown to the viewer is turned to +Y, and its reading-up to −Z.
 */
import { faceQuaternion, tiltedView, qaxis, qmul } from "./tumble.mjs";
import { DSN_ID, DSN_MIN_MAJOR } from "./constants.mjs";
import { warn } from "../../core/const.mjs";

export const KEY = "glSpotlight";
const TILE = 256;
const SCREEN_UP = [0, 0, -1];
// Towards the camera (+Y), leaned a little towards screen-down so the die keeps its depth.
const VIEW = tiltedView([0, 1, 0], SCREEN_UP);
/** World height per unit of `lift`, as a fraction of the camera's height
 *  (the stand-in lifts 2.2 units with its camera 14 units away). */
const LIFT_K = 2.2 / 14;
/** On-screen span of a die as a fraction of its bounding-sphere diameter. */
const SPAN = { d4: 0.8, d6: 0.82, d8: 0.9, d10: 0.9, d12: 0.93, d20: 0.95 };
/** DSN's DICE_SCALE (not exported), the label font scale fallback. */
const FONT_SCALE = { d4: 1, d6: 1.3, d8: 1.1, d10: 1, d12: 1.1, d20: 1, d100: 0.75 };
const INIT_TIMEOUT_MS = 20000;

/* ── pure face maths (importable under Node) ─────────────────────────── */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Number of faces of a DSN shape name ("d20" → 20). */
export const shapeFaces = (shape) => parseInt(String(shape).slice(1), 10) || 0;

/** Labels (tiles) on a standard shape's atlas, edge tiles included. */
export function labelCount(shape) {
  const n = shapeFaces(shape);
  if (shape === "d4") return 6;
  return n + (shape === "d2" || shape === "d10" ? 1 : 2);
}

/** The atlas layout DSN's createMaterial uses for `count` labels. */
export function atlasLayout(count) {
  const tpl = Math.ceil(Math.sqrt(count));
  const size = 2 ** Math.ceil(Math.log2(Math.sqrt(count) * TILE));
  return { tpl, size };
}

/** Pixel origin of label tile `index` on the atlas. */
export function tileOrigin(index, count) {
  const { tpl } = atlasLayout(count);
  return { x: (index % tpl) * TILE, y: Math.floor(index / tpl) * TILE };
}

/**
 * Shape face (1-based, the "sfv" DSN's shape tables use) that shows `value` on a
 * die rolled as `faces` (4/6/8/10/12/20, or 100 = the TENS d10).
 *   d10: 10 shows "0" (and 0 is accepted for it).
 *   tens: 10..100 → digit (v/10)%10, 100 → "00"; a bare digit 0..9 is accepted too.
 *   d4: the face whose value reads at the top vertex (DSN: the face pointing down).
 */
export function shapeFaceFor(faces, value) {
  let v = Math.round(Number(value) || 0);
  if (faces === 100) {
    const digit = v >= 10 ? Math.floor(v / 10) % 10 : v;
    return digit === 0 ? 10 : Math.min(9, Math.max(1, digit));
  }
  if (faces === 10 && v === 0) v = 10;
  return Math.min(faces, Math.max(1, v));
}

/**
 * Face frames from a standard DSN geometry: Map<sfv, { normal, up }> in the
 * mesh's own space. `position`/`uv` are flat arrays, `index` may be null.
 */
export function faceFrames(position, uv, index, shape) {
  const faces = shapeFaces(shape);
  const count = labelCount(shape);
  const edge = count - faces;
  const { tpl, size } = atlasLayout(count);
  const tiles = size / TILE;
  const triCount = index ? index.length / 3 : position.length / 9;
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const ids = index ? [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]] : [t * 3, t * 3 + 1, t * 3 + 2];
    const P = ids.map((i) => [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]]);
    const U = ids.map((i) => [uv[i * 2], uv[i * 2 + 1]]);
    const e1 = sub(P[1], P[0]), e2 = sub(P[2], P[0]);
    const c = cross(e1, e2);
    const area = len(c) / 2;
    if (!(area > 0)) continue;
    const uc = (U[0][0] + U[1][0] + U[2][0]) / 3, vc = (U[0][1] + U[1][1] + U[2][1]) / 3;
    const col = Math.floor(uc * tiles), row = Math.floor(vc * tiles);
    if (col < 0 || col >= tpl || row < 0) continue;
    const sfv = row * tpl + col - edge + 1;
    if (sfv < 1 || sfv > faces) continue;
    const du1 = U[1][0] - U[0][0], dv1 = U[1][1] - U[0][1], du2 = U[2][0] - U[0][0], dv2 = U[2][1] - U[0][1];
    const det = du1 * dv2 - du2 * dv1;
    if (!det) continue;
    // ∂P/∂v; the number reads up along −∂P/∂v.
    const dPdv = scale3(sub(scale3(e2, du1), scale3(e1, du2)), 1 / det);
    if (!groups.has(sfv)) groups.set(sfv, []);
    groups.get(sfv).push({ area, n: unit(c), up: unit(scale3(dPdv, -1)) });
  }
  const out = new Map();
  for (const [sfv, tris] of groups) {
    const ref = tris.reduce((a, b) => (b.area > a.area ? b : a)).n;
    let n = [0, 0, 0], up = [0, 0, 0];
    for (const t of tris) {
      if (dot(t.n, ref) < 0.995) continue; // bevel strips sampling the same tile
      n = [n[0] + t.n[0] * t.area, n[1] + t.n[1] * t.area, n[2] + t.n[2] * t.area];
      up = [up[0] + t.up[0] * t.area, up[1] + t.up[1] * t.area, up[2] + t.up[2] * t.area];
    }
    n = unit(n);
    out.set(sfv, { normal: n, up: unit(sub(up, scale3(n, dot(up, n)))) });
  }
  return out;
}

/** The pose showing `value` upright to DSN's camera, given a shape's frames. */
export function targetFrom(frames, shape, faces, value) {
  const sfv = shapeFaceFor(faces, value);
  const f = frames.get(sfv) ?? frames.values().next().value;
  if (!f) return [0, 0, 0, 1];
  if (shape === "d4") {
    // The value sits at the apex, opposite its face: point the apex at the camera
    // and stand one neighbouring face below it, so its corner label reads upright.
    const other = [...frames.entries()].filter(([k]) => k !== sfv).sort((a, b) => a[0] - b[0])[0]?.[1];
    return faceQuaternion(scale3(f.normal, -1), other ? scale3(other.normal, -1) : f.up, VIEW, SCREEN_UP);
  }
  return faceQuaternion(f.normal, f.up, VIEW, SCREEN_UP);
}

/* ── runtime helpers (only ever called inside methods) ──────────────── */

const dsn = () => globalThis.game?.dice3d ?? null;
const factory = () => dsn()?.DiceFactory ?? null;

function dsnUsable() {
  const mod = game.modules?.get?.(DSN_ID);
  if (!mod?.active) return false;
  if ((parseInt(String(mod.version ?? "0"), 10) || 0) < DSN_MIN_MAJOR) return false;
  const d3 = dsn();
  if (!d3?.DiceFactory || !d3.box) return false;
  const vis = game.user?.getFlag?.(DSN_ID, "settings")?.visibility ?? "all";
  return vis !== "none";
}

/** Mirror of DSN 6's DsnSettings.APPEARANCE(user, actor), which is not exported. */
function appearanceOf(user, actor) {
  const F = factory(), U = dsn()?.exports?.Utils;
  const { mergeObject, duplicate, isEmpty } = foundry.utils;
  const sanitize = (a) => (U?.sanitizeAppearance ? U.sanitizeAppearance(a, user) : a);
  const color = user?.color?.toString?.() ?? "#ffffff";
  let app = {
    global: {
      labelColor: U?.contrastOf ? U.contrastOf(color) : "#ffffff",
      diceColor: color, outlineColor: color, edgeColor: color,
      texture: "none", material: "auto", font: "auto", colorset: "custom", system: "standard",
    },
  };
  if (!user?.getFlag(DSN_ID, "saved")?.appearance) {
    const defaults = F?.getRole?.("basic")?.defaults;
    if (defaults && !isEmpty(defaults)) app = mergeObject(app, sanitize(duplicate(defaults)), { applyOperators: true });
  }
  const own = user?.getFlag(DSN_ID, "appearance");
  if (own) app = mergeObject(app, duplicate(own), { applyOperators: true });
  delete app.dimensions;
  const forActor = actor?.getFlag?.(DSN_ID, "appearance");
  if (forActor) app = mergeObject(app, duplicate(forActor), { applyOperators: true });
  return sanitize(app);
}

function libraryOf(user) {
  const data = user?.getFlag?.(DSN_ID, "diceLibrary");
  return Array.isArray(data) ? data : [];
}

function typeOf(faces) { return faces === 100 ? "d100" : `d${faces}`; }

function newCanvas(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function copyCanvas(src) {
  const c = newCanvas(src.width, src.height);
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

/** A texture of the same class over a private copy of `tex`'s canvas. */
function cloneCanvasTexture(tex) {
  const t = new tex.constructor(copyCanvas(tex.image));
  for (const k of ["colorSpace", "flipY", "anisotropy", "wrapS", "wrapT", "magFilter", "minFilter", "generateMipmaps", "premultiplyAlpha"]) t[k] = tex[k];
  t.offset.copy(tex.offset); t.repeat.copy(tex.repeat);
  t.needsUpdate = true;
  return t;
}

/** Clone a DSN material without letting three JSON-serialise its userData
 *  (which holds CanvasTextures — that would PNG-encode a 2048² atlas). */
function cloneMaterial(src) {
  const ud = src.userData;
  src.userData = {};
  let m;
  try { m = src.clone(); } finally { src.userData = ud; }
  m.userData = { ...ud };
  m.onBeforeCompile = src.onBeforeCompile;
  if (src.customProgramCacheKey) m.customProgramCacheKey = src.customProgramCacheKey;
  return m;
}

const isCanvasTex = (t) => !!t?.isTexture && typeof HTMLCanvasElement !== "undefined" && t.image instanceof HTMLCanvasElement;

/* ── the host ────────────────────────────────────────────────────────── */

export class DsnDiceHost {
  /**
   * @param {{ container: HTMLElement, key?: string }} o  `key` is the DSN renderer cache key.
   * Each host that can be on screen at the same time as another needs its own
   * (combat-intro passes "glCombatIntro"); it must not be a prefix of DSN's
   * board/showcase/editor/persistent keys or of another host's.
   */
  constructor({ container, key = KEY }) {
    this.container = container;
    this.key = key;
    this.scene = null;
    this.dice = new Set();
    this.lights = null;
    this._frames = new Map();   // shape → { frames, radius }
    this._w = 0; this._h = 0;
    this.ok = false;
  }

  get renderer() { return this.scene?.renderer ?? null; }

  async init() {
    try {
      if (!dsnUsable()) return false;
      const d3 = dsn();
      if (d3.box.ready) await Promise.race([d3.box.ready, new Promise((r) => setTimeout(r, INIT_TIMEOUT_MS))]);
      const DiceScene = d3.box.diceScene?.constructor;
      if (!DiceScene || !d3.dice3dRenderers) return false;
      const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
      this.scene = new DiceScene(this.container, factory(), {
        rendererCacheKey: this.key, dimensions: { width: w, height: h }, scale: 100, autoscale: false,
      });
      // initialize() wraps an async executor: a throw inside it, or an HDR that
      // never loads, leaves the promise pending forever rather than rejecting.
      const ready = await Promise.race([
        this.scene.initialize().then(() => true),
        new Promise((r) => setTimeout(() => r(false), INIT_TIMEOUT_MS)),
      ]);
      if (!ready || !this.scene.renderer) { this._abandon(); return false; }
      this._w = w; this._h = h;
      this._afterScene();
      this._buildLights();
      this.ok = true;
      return true;
    } catch (e) {
      warn("spotlight: Dice So Nice host unavailable", e);
      this._abandon();
      return false;
    }
  }

  /** Everything setScene() resets, re-applied: desk off, camera, bloom, canvas. */
  _afterScene() {
    const s = this.scene;
    if (s.desk) s.desk.visible = false;     // a shadow plane under a floating die reads as a stain
    const cam = s.camera;
    const height = cam.position.y || 1;
    cam.up.set(0, 0, -1);
    cam.position.set(0, height, 0);
    cam.lookAt(0, 0, 0);
    cam.near = height * 0.02;
    cam.far = height * 2;
    cam.aspect = this._w / Math.max(1, this._h);
    cam.updateProjectionMatrix();
    this._camH = height;
    this._unit = (2 * height * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, this._h);
    try { s.setupBloomPipeline(); } catch (e) {
      // It reads the Foundry canvas's GL extensions; without one, draw directly.
      try { s._disposeBloomPipeline?.(); } catch { /* nothing built */ }
      s.compositorRender = null;
    }
    const el = s.renderer.domElement;
    Object.assign(el.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  }

  _buildLights() {
    const s = this.scene;
    const Dir = s.light?.constructor;
    if (!Dir) return;
    const mk = (pos) => { const l = new Dir(0xffffff, 0); l.position.set(...pos); s.scene.add(l); return l; };
    // Stand-in positions turned into DSN's frame: x right, screen-up −Z, toward camera +Y.
    this.lights = { key: mk([-3, 6, -5]), rim: mk([0, -2.5, 1.5]), fill: mk([0, 4, 0]) };
  }

  setLights({ rim, rimI = 0, fillI = 0, keyI = 1.6 } = {}) {
    if (!this.lights) return;
    // The stand-in's rim and fill are physically-based point lights (candela with
    // falloff); these are directional, so the numbers are scaled down to match.
    // DSN's own hemisphere + environment already carry most of the light.
    const k = factory()?.realisticLighting === false ? 0.5 : 1;
    if (rim) this.lights.rim.color.set(rim);
    this.lights.rim.intensity = rimI * 0.06 * k;
    this.lights.fill.intensity = fillI * 0.45 * k;
    this.lights.key.intensity = keyI * 0.35 * k;
  }

  resize(width, height) {
    if (!this.scene || (width === this._w && height === this._h) || !width || !height) return;
    this._w = width; this._h = height;
    try { this.scene._disposeBloomPipeline?.(); } catch { /* nothing built */ }
    this.scene.setScene({ width, height });
    this._afterScene();
  }

  render() {
    if (!this.scene?.renderer) return;
    try { this.scene.renderScene(); } catch (e) { warn("spotlight: DSN render failed", e); }
  }

  /* ── dice ── */

  async _shape(shape) {
    if (this._frames.has(shape)) return this._frames.get(shape);
    const F = factory();
    // Our own parse of DSN's standard geometry: read, measured, disposed. The
    // cached one in F.geometries is DSN's and is never touched.
    const geo = await F.createGeometry(shape, 1, F.showcaseScale);
    const a = geo.attributes;
    const info = {
      frames: faceFrames(a.position.array, a.uv.array, geo.index?.array ?? null, shape),
      radius: (geo.boundingSphere ?? (geo.computeBoundingSphere(), geo.boundingSphere)).radius,
    };
    geo.dispose();
    this._frames.set(shape, info);
    return info;
  }

  async _build(entry, cache) {
    const spec = typeof entry === "number" ? { faces: entry } : entry ?? {};
    const faces = Number(spec.faces) || 20;
    const type = typeOf(faces);
    const F = factory();
    const user = game.users?.get(spec.userId) ?? game.user;
    const ck = `${user?.id}|${spec.actorUuid ?? ""}`;
    let appearances = cache.get(ck);
    if (!appearances) {
      let actor = null;
      try { actor = spec.actorUuid ? foundry.utils.fromUuidSync(spec.actorUuid) : null; } catch { actor = null; }
      appearances = appearanceOf(user, actor);
      cache.set(ck, appearances);
    }
    let appearance = F.getAppearanceForDice(appearances, type);
    let mesh = await F.create(this.scene.renderer.scopedTextureCache, type, appearance, libraryOf(user));
    if (!mesh) {
      appearance = F.getAppearanceForDice({ global: { ...appearances.global, system: "standard" } }, type);
      mesh = await F.create(this.scene.renderer.scopedTextureCache, type, appearance, null);
    }
    const preset = F.resolvePreset(type, appearance);
    const shape = preset?.shape ?? (faces === 100 ? "d10" : type);
    const info = await this._shape(shape);
    return new DsnDie(this, { mesh, faces, type, shape, preset, info });
  }

  async createDice(specs = []) {
    if (!this.ok) return specs.map((roll) => (roll ?? []).map(() => null));
    const cache = new Map();
    const out = [];
    for (const roll of specs) {
      const row = [];
      for (const entry of roll ?? []) {
        let die = null;
        try { die = await this._build(entry, cache); } catch (e) { warn("spotlight: DSN die failed", e); }
        if (die) { this.dice.add(die); this.scene.scene.add(die.outer); }
        row.push(die ?? inertDie(entry));
      }
      out.push(row);
    }
    return out;
  }

  /** Bake every material a request will need, compile its programs, then drop it. */
  async warm(specs = []) {
    if (!this.ok) return;
    const cache = new Map();
    const built = [];
    for (const roll of specs) for (const entry of roll ?? []) {
      try { built.push(await this._build(entry, cache)); } catch { /* the live build will say so */ }
    }
    const r = this.scene.renderer;
    for (const d of built) {
      this.scene.scene.add(d.outer);
      d.mesh?.traverse((o) => {
        for (const m of [o.material].flat().filter(Boolean)) {
          for (const k of ["map", "normalMap", "emissiveMap", "roughnessMap", "metalnessMap", "transmissionMap"]) if (m[k]?.isTexture) r.initTexture?.(m[k]);
        }
      });
    }
    try {
      if (this.dice.size === 0) {
        // Nothing on screen: a real hidden frame also compiles the bloom passes.
        const el = r.domElement, vis = el.style.visibility;
        el.style.visibility = "hidden";
        for (const d of built) this.place(d, { x: this._w / 2, y: this._h / 2, size: 120 });
        this.render();
        el.style.visibility = vis;
      } else r.compile?.(this.scene.scene, this.scene.camera);
    } catch { /* warming is best effort */ }
    for (const d of built) d.dispose();
  }

  place(die, { x, y, size }, lift = 0, scale = 1) {
    if (!die?.outer) return;
    die._slot = { x, y, size, lift, scale };
    die._apply();
  }

  clear() {
    for (const d of this.dice) d.dispose();
    this.dice.clear();
  }

  _abandon() {
    try { this.scene?.renderer?.domElement?.remove(); } catch { /* gone */ }
    this.scene = null;
    this.ok = false;
  }

  dispose() {
    this.clear();
    const s = this.scene;
    if (!s) return;
    const r = s.renderer;
    try { s.clearScene(); } catch { /* half-built: clearScene throws on a shadow map never drawn */ }
    try { s._disposeBloomPipeline?.(); } catch { /* already gone */ }
    r?.domElement?.remove();
    const cache = r?.scopedTextureCache;
    if (cache) for (const v of Object.values(cache)) if (v?.isTexture) v.dispose();
    try { r?.dispose(); r?.forceContextLoss(); } catch { /* already lost */ }
    const d3 = dsn();
    if (d3?.dice3dRenderers?.[this.key] === r) delete d3.dice3dRenderers[this.key];
    try { factory()?.disposeCachedMaterials(this.key); } catch { /* factory rebuilt */ }
    this.scene = null;
    this.lights = null;
    this.ok = false;
  }
}

/** A stand-in handle when DSN could not build a die: keeps the director's loop simple. */
function inertDie(entry) {
  const faces = Number(typeof entry === "number" ? entry : entry?.faces) || 20;
  return { faceCount: faces === 100 ? 10 : faces, targetFor: () => [0, 0, 0, 1], setPose() {}, relabel() {}, shatter() {}, outer: null };
}

class DsnDie {
  constructor(host, { mesh, faces, type, shape, preset, info }) {
    this.host = host;
    this.mesh = mesh;
    this.faces = faces;
    this.type = type;
    this.shape = shape;
    this.preset = preset;
    this.info = info;
    this.faceCount = faces === 100 ? 10 : faces;
    const Object3D = Object.getPrototypeOf(host.scene.scene.constructor.prototype).constructor;
    this.outer = new Object3D();
    let inner = mesh;
    if (mesh.userData?.modelScale) {
      // glTF presets are authored ~100 units an edge; DSN scales a wrapper, not the model.
      inner = new Object3D();
      inner.scale.setScalar(mesh.userData.modelScale);
      inner.add(mesh);
    }
    this.outer.add(inner);
    mesh.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    this._q = [0, 0, 0, 1];
    this._slot = null;
    this._shatter = 0;
    this._own = { materials: [], textures: [] };
    this._label = null;
    this._hot = null;
    this._spin = [0.48, 0.62, -0.62];
  }

  targetFor(value) { return targetFrom(this.info.frames, this.shape, this.faces, value); }

  setPose(q) { this._q = q; this._apply(); }

  _apply() {
    const s = this._slot, h = this.host;
    const p = this._shatter;
    const e = 1 - Math.pow(1 - p, 2.2);
    const q = p > 0 ? qmul(this._q, qaxis(this._spin, e * 5.5)) : this._q;
    this.mesh.quaternion.set(q[0], q[1], q[2], q[3]);
    if (!s || !h._unit) return;
    const u = h._unit;
    const base = (s.size * u) / (2 * this.info.radius * (SPAN[this.shape] ?? 0.9));
    const k = (base * (s.scale ?? 1) * (1 - 0.6 * e)) / (this.preset?.scaleModifier || 1);
    this.outer.scale.setScalar(Math.max(1e-6, k));
    this.outer.position.set(
      (s.x - h._w / 2) * u + e * 0.45 * s.size * u,
      (s.lift ?? 0) * LIFT_K * h._camH,
      (s.y - h._h / 2) * u + e * e * 0.7 * s.size * u,
    );
    this.outer.visible = p < 1;
  }

  /** Fade, shrink and spin away; p in 0..1. On cloned materials only. */
  shatter(p) {
    p = Math.max(0, Math.min(1, Number(p) || 0));
    if (p === this._shatter) return;
    if (p > 0) this._ownAll();
    this._shatter = p;
    for (const m of this._own.materials) {
      m.transparent = true;
      m.opacity = 1 - p;
      m.depthWrite = p < 0.05;
    }
    this._apply();
  }

  /** Swap every material on the die for a clone we may mutate (shares DSN's textures). */
  _ownAll() {
    this.mesh.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const own = (m) => {
        if (this._own.materials.includes(m)) return m;
        const c = cloneMaterial(m);
        this._own.materials.push(c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    });
  }

  /**
   * Rewrite the number on the face showing `value`. Only the text is redrawn;
   * `hot` only swaps the emissive. Standard (atlas) dice only: a glTF preset
   * has no label tiles, and is left as it is.
   */
  relabel(value, text, hot) {
    text = String(text ?? "");
    hot = !!hot;
    const md0 = this.mesh.material?.userData?.materialData;
    if (!md0 || Array.isArray(this.mesh.material) || this.mesh.userData?.modelScale) return;
    try {
      const sfv = shapeFaceFor(this.faces, value);
      const key = `${sfv}:${text}`;
      if (this._label !== key) {
        this._label = key;
        this._ensureLabelClone();
        this._drawLabel(sfv, text);
      }
      if (this._hot !== hot) { this._hot = hot; this._applyHot(); }
    } catch (e) {
      warn("spotlight: relabel failed", e);
    }
  }

  _ensureLabelClone() {
    if (this._lc) return;
    this._ownAll();
    const m = this.mesh.material;
    const lc = { tiles: [] };
    const take = (tex) => {
      if (!isCanvasTex(tex)) return tex;
      const t = cloneCanvasTexture(tex);
      this._own.textures.push(t);
      try { this.host.renderer.initTexture?.(t); } catch { /* uploads on first draw */ }
      return t;
    };
    if (isCanvasTex(m.map)) m.map = take(m.map);
    if (m.userData.detailNormalMap) m.userData.detailNormalMap = take(m.userData.detailNormalMap);
    else if (isCanvasTex(m.normalMap)) m.normalMap = take(m.normalMap);
    if (isCanvasTex(m.emissiveMap)) m.emissiveMap = take(m.emissiveMap);
    if (isCanvasTex(m.transmissionMap)) m.transmissionMap = take(m.transmissionMap);
    if (isCanvasTex(m.metalnessMap) && m.userData.heightMap) m.metalnessMap = m.userData.heightMap = take(m.metalnessMap);
    lc.emissive = m.emissive?.clone?.() ?? null;
    lc.emissiveIntensity = m.emissiveIntensity;
    lc.emissiveMap = m.emissiveMap ?? null;
    // The hot map: black except the relabelled tile's glyph. A non-realistic
    // material gets it permanently (at black emission) so toggling hot never
    // changes the shader's defines.
    const size = (m.map?.image?.width) || atlasLayout(labelCount(this.shape)).size;
    lc.hotCanvas = newCanvas(size);
    const g = lc.hotCanvas.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, size, size);
    const proto = m.map ?? lc.emissiveMap;
    lc.hotTex = new proto.constructor(lc.hotCanvas);
    for (const k of ["colorSpace", "flipY", "anisotropy"]) lc.hotTex[k] = proto[k];
    this._own.textures.push(lc.hotTex);
    try { this.host.renderer.initTexture?.(lc.hotTex); } catch { /* uploads on first use */ }
    if (!m.emissiveMap) {
      m.emissiveMap = lc.hotTex;
      lc.emissiveMap = lc.hotTex;
      m.emissive?.setRGB?.(0, 0, 0);
      lc.emissive = m.emissive?.clone?.() ?? null;
      m.needsUpdate = true;
    }
    this._lc = lc;
  }

  _drawLabel(sfv, text) {
    const F = factory();
    const m = this.mesh.material, lc = this._lc;
    const preset = this.preset;
    const md0 = m.userData.materialData;
    const d4 = this.shape === "d4";
    const labels = d4 ? preset.labels[0] : preset.labels;
    const edge = labels.length - preset.values.length;
    const count = labels.length;
    let draws;
    if (d4) {
      // A d4 tile carries three corner labels; the value is printed on the three
      // faces that meet at its vertex, so swap its source in every triplet.
      const src = preset._d4Sources?.labels?.[sfv - 1] ?? String(sfv);
      const swapped = labels.map((e, i) => (i >= edge && Array.isArray(e) ? e.map((t) => (t === src ? text : t)) : e));
      draws = [];
      for (let i = edge; i < count; i++) if (Array.isArray(labels[i]) && labels[i].includes(src)) draws.push({ index: i, labels: swapped });
    } else {
      const index = edge + sfv - 1;
      const swapped = labels.slice();
      swapped[index] = text;
      draws = [{ index, labels: swapped }];
    }
    const ov = d4 ? null : md0.perFaceOverrides?.[String(sfv)];
    const md = ov ? { ...md0, ...ov, perFaceOverrides: md0.perFaceOverrides } : md0;
    let fscale = preset.fontScale || md0.fontScale?.[preset.type] || FONT_SCALE[preset.type] || FONT_SCALE[this.shape] || 1;
    if (!d4 && text.length > 2) fscale *= 0.72;
    if (!d4 && ov?.fontScale) fscale *= ov.fontScale / 100;
    const font = { type: ov?.font || preset.font || md0.font, scale: fscale };
    const texture = md.texture || md0.texture;
    const strength = F.normalMapStrength;
    for (const { index, labels: lb } of draws) {
      const at = tileOrigin(index, count);
      const col = newCanvas(TILE), bump = newCanvas(TILE), em = newCanvas(TILE);
      F.createTextMaterial(col.getContext("2d"), bump.getContext("2d"), em.getContext("2d"), 0, 0, TILE, preset, lb, font, index, texture, md);
      this._patch(m.map, col, at);
      const normal = m.userData.detailNormalMap ?? m.normalMap;
      if (isCanvasTex(normal) && this._own.textures.includes(normal)) this._patch(normal, F.heightCanvasToNormalCanvas(bump, strength), at);
      if (lc.emissiveMap !== lc.hotTex && this._own.textures.includes(lc.emissiveMap)) this._patch(lc.emissiveMap, em, at);
      if (this._own.textures.includes(m.transmissionMap)) this._patch(m.transmissionMap, bump, at);
      if (m.userData.heightMap && this._own.textures.includes(m.userData.heightMap)) this._patchMetal(m.userData.heightMap, bump, at, md);
      // The hot glyph: the emissive tile as is. Doubling it towards white
      // blew the face out under DSN's bloom.
      const hot = newCanvas(TILE), g = hot.getContext("2d");
      g.drawImage(em, 0, 0);
      this._patch(lc.hotTex, hot, at);
    }
  }

  /** chrome/iridescent: metalness = the material's packed map × the bump. */
  _patchMetal(tex, bump, at, md) {
    const F = factory();
    const W = tex.image.width, H = tex.image.height;
    const key = F.material_options?.[md.material]?.scopedOptions?.metalnessMap;
    const cache = this.host.renderer.scopedTextureCache;
    const packed = key ? cache?.[key] : null;
    const frame = key ? cache?._atlasFrames?.[key] : null;
    const c = newCanvas(TILE), g = c.getContext("2d");
    if (packed?.image) {
      const fx = frame?.x ?? 0, fy = frame?.y ?? 0, fw = frame?.w ?? packed.image.width, fh = frame?.h ?? packed.image.height;
      g.drawImage(packed.image, fx + (at.x * fw) / W, fy + (at.y * fh) / H, (TILE * fw) / W, (TILE * fh) / H, 0, 0, TILE, TILE);
    } else { g.fillStyle = "#0000ff"; g.fillRect(0, 0, TILE, TILE); }
    g.globalCompositeOperation = "multiply";
    g.drawImage(bump, 0, 0);
    this._patch(tex, c, at);
  }

  /** Write a tile into a texture's canvas and push just that tile to the GPU. */
  _patch(tex, tile, at) {
    if (!tex?.image?.getContext) return;
    tex.image.getContext("2d").drawImage(tile, at.x, at.y);
    const r = this.host.renderer;
    try {
      if (r?.copyTextureToTexture && r.properties?.get(tex)?.__webglInit) {
        const src = new tex.constructor(tile);
        src.flipY = tex.flipY;
        r.copyTextureToTexture(src, tex, null, { x: at.x, y: at.y, z: 0 });
        src.dispose();
        return;
      }
    } catch { /* fall through to a full upload */ }
    tex.needsUpdate = true;
  }

  _applyHot() {
    const m = this.mesh.material, lc = this._lc;
    if (!lc || !m.emissive) return;
    if (this._hot) {
      m.emissiveMap = lc.hotTex;
      m.emissive.set(m.userData.materialData?.foreground || "#ffffff");
      if (factory()?.realisticLighting) m.emissive.convertLinearToSRGB?.();
      m.emissiveIntensity = 0.85;
    } else {
      m.emissiveMap = lc.emissiveMap;
      if (lc.emissive) m.emissive.copy(lc.emissive);
      m.emissiveIntensity = lc.emissiveIntensity;
    }
  }

  dispose() {
    this.outer?.parent?.remove(this.outer);
    for (const t of this._own.textures) t.dispose();
    for (const m of this._own.materials) m.dispose();
    this._own = { materials: [], textures: [] };
    this._lc = null;
    this.host.dice.delete(this);
  }
}
