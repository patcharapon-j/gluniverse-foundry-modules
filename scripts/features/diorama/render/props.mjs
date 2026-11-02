/**
 * Diorama — props: objects placed on the board. See docs/DIORAMA_PROPS.md.
 *
 * Contract with renderer.mjs:
 *   new PropsLayer(shared, onChange)  shared = createShared() uniforms;
 *                                 onChange() asks for a frame (card art or a
 *                                 model landed)
 *   .group                        THREE.Group added to the scene
 *   .casters                      THREE.Scene the shadow pass draws with its
 *                                 own materials (the depth override cannot
 *                                 instance), so props cast shadows
 *   .castersDirty                 the renderer re-renders the shadow map
 *   .rules                        the ground with blocking props stamped in
 *                                 (overlays and picks stand on it), or null
 *   .maxY                         highest prop top, cells (shadow bounds)
 *   .pxWorld                      world units per device px, written by the
 *                                 renderer each frame (the level of detail)
 *   .setGridSize(px)
 *   .setTerrain(terrain|null)     the GROUND the props stand on
 *   .setEnvironment(env|null)     wind for sway (environment.mjs's resolved env)
 *   .set(PropState[], now, animate)
 *   .setRoofFade(Map<propId, 0..1>)  how much of each roof shows (1 = all). A
 *                                 roof under 0.5 casts no shadow and cannot be
 *                                 picked; at 0 it is gone. Who fades is the
 *                                 view's business (render/roofs.mjs).
 *   .animated(fx) → bool          true only while foliage sways (fx.detail high,
 *                                 wind blowing, a foliage part on the board)
 *   .frame(t, dt, camera, fx) → bool   true while it wants another frame
 *   .pick(raycaster) → {id, point}|null   blocking props only
 *   .dispose()
 *
 * Drawing: every prop but a slab and a card is instanced. A shape is one or
 * more parts (a tree is a trunk and a crown); each (part geometry × material)
 * is one InstancedMesh, so a forest of a hundred trees is two draw calls. Unit
 * geometries are shared and sized by the instance matrix; a shape whose
 * outline is data (an extrusion, a path pipe) has its own geometry, drawn at
 * scale 1. A kit is drawn as its parts; a model as the meshes of its file
 * (render/props-models.mjs); slabs are merged meshes drawn with the terrain's
 * own programs (render/props-slabs.mjs).
 *
 * Level of detail: relief and sway fade with the zoom (uPropLod, damped), so
 * nothing switches off at a line. Nothing allocates per frame: set() writes
 * the instance buffers once, and an idle board asks for no frames.
 *
 * PURE: never reads the world (the preview page and the check tool drive it).
 */

import * as THREE from "./three.mjs";
import { PALETTE, hexToRgbFloat } from "../../../core/theme.mjs";
import { Q_PER_CELL } from "../constants.mjs";
import { PROPS_PROGRAMS, PROP_MAT_ID, PROP_PART_ID } from "./props-glsl.mjs";
import { MATERIALS } from "./materials.mjs";
import { loadDrawable } from "./art.mjs";
import { stampStates, kitParts, footprintCells, hashString, ROOF_SHAPES } from "../terrain/props.mjs";
import { buildPropGeometries, ROCK_VARIANTS, stairs, fence, hip, latheOf, extrusion, pipeAlong, finish } from "./props-geo.mjs";
import { loadModel, modelScale } from "./props-models.mjs";
import { SlabSet } from "./props-slabs.mjs";

export { buildPropGeometries };

const DEG = Math.PI / 180;

/**
 * The parts every shape is drawn with. `mat` fixes a part's material (a trunk
 * is bark whatever the crown is); otherwise it takes the prop's. `foliage`
 * parts sway when made of foliage. `variant` names a builder keyed by the
 * prop's own numbers (geoKey). Shapes with no parts are drawn another way: a
 * card by its image, a slab as terrain, a kit by its parts, a model from its
 * file.
 */
export const SHAPE_PARTS = Object.freeze({
  box: [{ geo: "box", part: "box", bevel: true }],
  cylinder: [{ geo: "cylinder" }],
  cone: [{ geo: "cone" }],
  sphere: [{ geo: "sphere" }],
  dome: [{ geo: "dome" }],
  pyramid: [{ geo: "pyramid" }],
  wedge: [{ geo: "wedge" }],
  torus: [{ geo: "torus" }],
  capsule: [{ geo: "capsule" }],
  arch: [{ geo: "arch" }],
  pillar: [{ geo: "pillar", part: "pillar" }],
  crate: [{ geo: "box", part: "crate", bevel: true }],
  barrel: [{ geo: "barrel", part: "barrel" }],
  rock: [{ geo: "rock", part: "rock" }],
  tree: [{ geo: "trunk", part: "trunk", mat: "wood" }, { geo: "crown", foliage: true }],
  pine: [{ geo: "pineTrunk", part: "trunk", mat: "wood" }, { geo: "pine", foliage: true }],
  bush: [{ geo: "bush", foliage: true }],
  card: [],
  slab: [],
  hex: [{ geo: "hex" }],
  octagon: [{ geo: "octagon" }],
  pipe: [{ geo: "pipe", variant: "pipe" }],
  stairs: [{ geo: "stairs", part: "step", variant: "stairs" }],
  platform: [{ geo: "platform" }],
  fence: [{ geo: "fence", variant: "fence" }],
  parapet: [{ geo: "parapet" }],
  beam: [{ geo: "box", part: "box", bevel: true }],
  sign: [{ geo: "sign" }],
  cross: [{ geo: "cross" }],
  bowl: [{ geo: "bowl" }],
  brazier: [{ geo: "brazierIron", part: "iron" }, { geo: "coals", part: "coals", mat: "earth" }],
  lamp: [{ geo: "lampPost", part: "iron" }, { geo: "lantern", part: "lantern", mat: "plaster" }],
  gable: [{ geo: "gable", part: "roof" }],
  hip: [{ geo: "hip", part: "roof", variant: "hip" }],
  lean: [{ geo: "wedge", part: "roof" }],
  spire: [{ geo: "spire", part: "roof" }],
  lathe: [{ geo: "lathe", variant: "lathe" }],
  extrude: [{ geo: "box", variant: "extrude" }],
  kit: [],
  model: [],
});

/** Shapes drawn some way other than by SHAPE_PARTS. */
export const UNPARTED = Object.freeze(["card", "slab", "kit", "model"]);

/** Shapes whose contact shadow is a disc rather than a rounded box. */
const ROUND = new Set(["cylinder", "cone", "sphere", "dome", "torus", "capsule", "pillar", "barrel", "rock", "tree", "pine", "bush", "card",
  "hex", "octagon", "bowl", "brazier", "lamp", "lathe"]);
/** Long thin shapes, often hung in the air: a contact shadow only when standing on something. */
const HUNG = new Set(["beam", "pipe"]);

/** Level of detail: relief and sway in full from this many device px per cell, gone below the other. */
export const LOD_FULL_PX = 30;
export const LOD_NONE_PX = 12;
/** How fast the level of detail follows the zoom (1/s): a zoom never pops it. */
const LOD_RATE = 6;

/**
 * The geometry a part of a state draws with: { key, own } (own = built at
 * the state's own size, drawn at scale 1).
 */
export function geoKey(part, s) {
  switch (part.variant ?? (part.geo === "rock" ? "rock" : null)) {
    case "rock": return { key: `rock${Math.floor((Number(s.seed) || 0) * ROCK_VARIANTS) % ROCK_VARIANTS}`, own: false };
    case "stairs": return { key: `stairs:${Math.max(2, Math.min(16, Math.round((Number(s.h) || 1) / 0.2)))}`, own: false };
    case "fence": return { key: `fence:${Math.max(2, Math.min(24, Math.round((Number(s.w) || 1) / 0.9) + 1))}`, own: false };
    case "hip": {
      const w = Number(s.w) || 1, d = Number(s.d) || 1;
      return { key: `hip:${w >= d ? "x" : "z"}:${Math.round((Math.min(w, d) / Math.max(w, d)) * 20) / 20}`, own: false };
    }
    case "lathe":
      return { key: s.profile ? `lathe:${hashString(JSON.stringify(s.profile))}` : "lathe", own: false };
    case "extrude":
      return s.points ? { key: `extrude:${hashString(JSON.stringify([s.points, s.h, s.bevel ?? 0]))}`, own: true } : { key: "box", own: false };
    case "pipe":
      return s.path ? { key: `pipe:${hashString(JSON.stringify([s.path, s.thick]))}`, own: true } : { key: "pipe", own: false };
    default: return { key: part.geo, own: false };
  }
}

/** Build a variant geometry from its key and the state that asked for it. */
function buildVariant(key, s) {
  const [kind, a, b] = key.split(":");
  switch (kind) {
    case "stairs": return finish(stairs(Number(a)));
    case "fence": return finish(fence(Number(a)));
    case "hip": return finish(hip(a, Number(b)));
    case "lathe": return finish(latheOf(s.profile));
    case "extrude": return extrusion(s.points, s.h, s.bevel ?? 0.04);
    case "pipe": return pipeAlong(s.path, s.thick);
    default: return null;
  }
}

/* ================================================================ materials */

const vec3 = (hex) => new THREE.Vector3(...hexToRgbFloat(hex));

/**
 * Prop material factories. The check tool builds each one and requires every
 * uniform its GLSL declares to be present (PROP_MATERIAL_PROGRAM).
 */
export const PROP_MATERIAL_FACTORIES = {
  /** @param {{mat?:string, part?:string, bevel?:boolean, foliage?:boolean, common?:object}} [o] */
  prop(shared, { mat = "stone", part = "plain", bevel = false, foliage = false, common = null } = {}) {
    const c = common ?? propCommon();
    return new THREE.ShaderMaterial({
      name: `dio.prop.${mat}.${part}`,
      vertexShader: PROPS_PROGRAMS.prop.vertex,
      fragmentShader: PROPS_PROGRAMS.prop.fragment,
      uniforms: {
        ...shared,
        uPropMat: { value: PROP_MAT_ID[mat] ?? 0 },
        uPart: { value: PROP_PART_ID[part] ?? 0 },
        uBevel: { value: bevel ? 1 : 0 },
        uFoliage: { value: foliage && mat === "foliage" ? 1 : 0 },
        uPropDetail: c.uPropDetail,
        uPropLod: c.uPropLod,
        uPropSway: c.uPropSway,
        uPropWind: c.uPropWind,
        uGhostColor: c.uGhostColor,
      },
    });
  },

  /** A model's part: its own base colour (map × factor), the suite's light. */
  model(shared, { color = [1, 1, 1], map = null, alphaTest = 0, common = null } = {}) {
    const c = common ?? propCommon();
    return new THREE.ShaderMaterial({
      name: "dio.prop.model",
      vertexShader: PROPS_PROGRAMS.propModel.vertex,
      fragmentShader: PROPS_PROGRAMS.propModel.fragment,
      uniforms: {
        ...shared,
        uModelMap: { value: map },
        uModelHasMap: { value: map ? 1 : 0 },
        uModelColor: { value: new THREE.Vector3(color[0], color[1], color[2]) },
        uModelAlphaTest: { value: alphaTest },
        uGhostColor: c.uGhostColor,
      },
      side: THREE.DoubleSide,
    });
  },

  card(shared, { common = null } = {}) {
    const c = common ?? propCommon();
    const m = new THREE.ShaderMaterial({
      name: "dio.prop.card",
      vertexShader: PROPS_PROGRAMS.propCard.vertex,
      fragmentShader: PROPS_PROGRAMS.propCard.fragment,
      uniforms: {
        ...shared,
        uCardSize: { value: new THREE.Vector2(1, 1) },
        uCardTex: { value: null },
        uHasTex: { value: 0 },
        uCardTint: { value: new THREE.Vector3(1, 1, 1) },
        uCardGhost: { value: 0 },
        uCardFade: { value: 1 },
        uGhostColor: c.uGhostColor,
      },
      side: THREE.DoubleSide,
    });
    m.alphaToCoverage = true;
    return m;
  },

  contact(shared) {
    return new THREE.ShaderMaterial({
      name: "dio.prop.contact",
      vertexShader: PROPS_PROGRAMS.propContact.vertex,
      fragmentShader: PROPS_PROGRAMS.propContact.fragment,
      uniforms: {
        uColor: { value: vec3(PALETTE.ink0) },
        uOpacity: { value: 1 },
        uVisionMap: shared.uVisionMap,
        uUseVision: shared.uUseVision,
        uWorldSize: shared.uWorldSize,
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  },

  /** A slab's top: the terrain top's look over a free outline. */
  slabTop(shared, { common = null } = {}) {
    const c = common ?? propCommon();
    return new THREE.ShaderMaterial({
      name: "dio.prop.slab.top",
      vertexShader: PROPS_PROGRAMS.slabTop.vertex,
      fragmentShader: PROPS_PROGRAMS.slabTop.fragment,
      uniforms: { ...shared, uGhostColor: c.uGhostColor },
    });
  },

  /** A slab's sides: the terrain's own cliff material, with a ghost and a fade. */
  slabSide(shared, { common = null } = {}) {
    const c = common ?? propCommon();
    const m = MATERIALS.side(shared);
    m.name = "dio.prop.slab.side";
    m.vertexShader = PROPS_PROGRAMS.slabSide.vertex;
    m.fragmentShader = PROPS_PROGRAMS.slabSide.fragment;
    m.uniforms.uGhostColor = c.uGhostColor;
    return m;
  },
};

export const PROP_MATERIAL_PROGRAM = Object.freeze({
  prop: "prop", model: "propModel", card: "propCard", contact: "propContact", slabTop: "slabTop", slabSide: "slabSide",
});

/** Uniforms every prop material shares by reference: one write serves all. */
export function propCommon() {
  return {
    uPropDetail: { value: 0 },
    uPropLod: { value: 1 },
    uPropSway: { value: 0 },
    uPropWind: { value: new THREE.Vector3(1, 0, 0) },
    uGhostColor: { value: vec3(PALETTE.violet) },
  };
}

/* ================================================================ the layer */

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * What a board's props expand to before drawing: a kit becomes its parts
 * (each standing on the kit's base plus its own offset, keeping the kit's id),
 * everything else is itself.
 */
export function expandStates(states) {
  const out = [];
  for (const s of states) {
    if (s.shape !== "kit") { out.push(s); continue; }
    for (const q of kitParts(s)) {
      out.push({ ...q, base: num(s.base) + num(q.elev), ghost: !!s.ghost, seed: s.seed, roof: !!s.roof, blocks: !!s.blocks,
        floats: true, gm: s.gm, label: s.label, kitOf: s.id });
    }
  }
  return out;
}

export class PropsLayer {
  constructor(shared, onChange = null) {
    this.shared = shared;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.group = new THREE.Group();
    this.group.name = "dio.props";
    this.casters = new THREE.Scene();
    this.casters.name = "dio.props.casters";
    this.castersDirty = false;
    this.common = propCommon();
    this.ground = null;
    this.rules = null;
    this.maxY = 0;
    this.pxWorld = 0;
    this.states = [];
    this.geos = null;
    /** variant / own geometry key → BufferGeometry (built on demand, dropped when unused) */
    this.dyn = new Map();
    /** bucket key → { mesh, caster, tint, info, fade, capacity, states, geo, material, entries } */
    this.buckets = new Map();
    this.contact = null;
    /** card prop id → { mesh, caster, material, url, texture, aspect } */
    this.cards = new Map();
    this.casterMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.slabs = new SlabSet({
      top: () => PROP_MATERIAL_FACTORIES.slabTop(this.shared, { common: this.common }),
      side: () => PROP_MATERIAL_FACTORIES.slabSide(this.shared, { common: this.common }),
    }, this.group, this.casters, this.casterMat);
    /** prop id → fade 0..1 (roofs) */
    this.fades = new Map();
    /** model src → the materials of its parts */
    this.modelMats = new Map();
    this.wind = 0;
    this.hasFoliage = false;
    this._lod = 1;
    this._sunYaw = NaN;
    this._landed = false;
    this._disposed = false;
    // reused by set(): no allocation per prop
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
  }

  setGridSize() {}

  /** @param {import("../terrain/model.mjs").Terrain|null} terrain  the ground */
  setTerrain(terrain) {
    this.ground = terrain ?? null;
    this.rules = this.ground ? stampStates(this.ground, this.states) : null;
    if (this.rules === this.ground) this.rules = null;
    if (this.slabs.count || this.states.some((s) => s.shape === "slab")) {
      this.slabs.set(this.states.filter((s) => s.shape === "slab"), (s) => this.groundMin(s));
      this.castersDirty = true;
    }
  }

  /** Wind from the resolved environment ({ wind: { x, z, speed } }). */
  setEnvironment(env) {
    const w = env?.wind ?? null;
    const speed = Math.max(0, Math.min(1, num(w?.speed ?? w?.strength, 0)));
    this.wind = speed;
    this.common.uPropWind.value.set(num(w?.x, 1), num(w?.z, 0), speed);
  }

  ensureGeometries() {
    this.geos ??= buildPropGeometries();
    return this.geos;
  }

  /** The lowest ground under a slab's footprint (cells): where its sides reach down to. */
  groundMin(s) {
    const t = this.ground;
    if (!t) return num(s.base);
    let lo = Infinity;
    for (const c of footprintCells(s)) {
      if (!t.inBounds(c.si, c.sj) || t.isVoid(c.si, c.sj)) continue;
      lo = Math.min(lo, t.topAt(c.si, c.sj) / Q_PER_CELL);
    }
    return Number.isFinite(lo) ? Math.min(lo, num(s.base)) : num(s.base);
  }

  /** @param {object[]} states PropState[] (terrain/props.mjs propStates) */
  set(states) {
    if (this._disposed) return;
    this.states = Array.isArray(states) ? states.filter((s) => s && SHAPE_PARTS[s.shape]) : [];
    this.rules = this.ground ? stampStates(this.ground, this.states) : null;
    if (this.rules === this.ground) this.rules = null;
    if (!this.states.length && !this.geos) return;
    this.rebuild();
  }

  /** Redraw from this.states (a model that landed, a terrain change). */
  rebuild() {
    if (this._disposed) return;
    const G = this.ensureGeometries();
    const drawn = expandStates(this.states);

    // group the parts by bucket; each entry is a state and the scale it is drawn at
    const groups = new Map();
    const usedDyn = new Set();
    let foliage = false, maxY = 0;
    const add = (key, make, s, sx, sy, sz) => {
      let g = groups.get(key);
      if (!g) { g = { ...make, list: [] }; groups.set(key, g); }
      g.list.push({ s, sx, sy, sz });
    };
    for (const s of drawn) {
      maxY = Math.max(maxY, num(s.base) + num(s.h, 1));
      if (s.shape === "model") { this.addModel(s, add); continue; }
      for (const part of SHAPE_PARTS[s.shape] ?? []) {
        const mat = part.mat ?? s.mat ?? "stone";
        const { key: gk, own } = geoKey(part, s);
        let src = G[gk];
        if (!src) {
          src = this.dyn.get(gk);
          if (!src) {
            src = buildVariant(gk, s);
            if (!src) continue;
            this.dyn.set(gk, src);
          }
          usedDyn.add(gk);
        }
        const key = `${gk}|${mat}|${part.part ?? "plain"}|${part.bevel ? 1 : 0}|${part.foliage ? 1 : 0}`;
        if (part.foliage && mat === "foliage") foliage = true;
        const w = Math.max(0.01, num(s.w, 1)), h = Math.max(0.01, num(s.h, 1)), d = Math.max(0.01, num(s.d, 1));
        add(key, { src, factory: "prop", opts: { mat, part: part.part ?? "plain", bevel: !!part.bevel, foliage: !!part.foliage } },
          s, own ? 1 : w, own ? 1 : h, own ? 1 : d);
      }
    }
    this.hasFoliage = foliage;
    this.maxY = maxY;

    for (const [key, b] of this.buckets) {
      if (!groups.has(key)) {
        // a bucket whose geometry is gone goes with it; the rest wait, empty, for reuse
        if (b.dyn && !usedDyn.has(b.dyn)) { this.dropBucket(key); continue; }
        b.mesh.count = 0; b.mesh.visible = false; b.caster.count = 0; b.caster.visible = false; b.states = []; b.entries = [];
      }
    }
    for (const [k, g] of [...this.dyn]) if (!usedDyn.has(k)) { g.dispose(); this.dyn.delete(k); }
    for (const [key, g] of groups) this.fill(key, g);
    this.fillContact(drawn, G);
    this.syncCards(G);
    this.slabs.set(this.states.filter((s) => s.shape === "slab"), (s) => this.groundMin(s));
    this.slabs.setFade(this.fades);
    this.castersDirty = true;
  }

  /** A model state: its loaded meshes, or (GM only) a placeholder while it cannot load. */
  addModel(s, add) {
    const e = loadModel(s.src, () => {
      if (this._disposed) return;
      this._landed = true;
      this.rebuild();
      this.onChange?.();
    });
    if (e.state === "ready") {
      const k = modelScale(e.model.size, s);
      e.model.parts.forEach((p, i) => {
        add(`model|${s.src}|${i}`, { src: p.geometry, factory: "model", opts: { color: p.color, map: p.map, alphaTest: p.alphaTest }, model: s.src }, s, k, k, k);
      });
      return;
    }
    if (e.state === "failed" && s.gm) {
      // the GM sees where a model should be: a hatched box, never a player
      add("box|stone|box|1|0", { src: this.geos.box, factory: "prop", opts: { mat: "stone", part: "box", bevel: true, foliage: false } },
        { ...s, ghost: true }, Math.max(0.01, num(s.w, 1)), Math.max(0.01, num(s.h, 1)), Math.max(0.01, num(s.d, 1)));
    }
  }

  fill(key, g) {
    let b = this.buckets.get(key);
    const n = g.list.length;
    if (!b || b.capacity < n || b.src !== g.src) {
      if (b) this.dropBucket(key);
      const capacity = Math.max(8, 1 << Math.ceil(Math.log2(n)));
      const src = g.src;
      const geo = new THREE.BufferGeometry();
      for (const name of Object.keys(src.attributes)) geo.setAttribute(name, src.attributes[name]);
      if (src.index) geo.setIndex(src.index);
      geo.boundingSphere = src.boundingSphere;
      geo.boundingBox = src.boundingBox;
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      const info = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
      geo.setAttribute("iTint", tint);
      geo.setAttribute("iInfo", info);
      geo.setAttribute("iFade", fade);
      const material = g.factory === "model"
        ? this.modelMaterial(g.model, key, g.opts)
        : PROP_MATERIAL_FACTORIES.prop(this.shared, { ...g.opts, common: this.common });
      const mesh = new THREE.InstancedMesh(geo, material, capacity);
      mesh.name = `dio.prop.${key}`;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // the casters keep their own matrices: a ghost or a faded roof casts nothing
      const caster = new THREE.InstancedMesh(geo, this.casterMat, capacity);
      caster.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      caster.frustumCulled = false;
      this.group.add(mesh);
      this.casters.add(caster);
      const dyn = this.dyn.has(key.split("|")[0]) ? key.split("|")[0] : null;
      b = { mesh, caster, tint, info, fade, capacity, states: [], entries: [], geo, src, material, dyn, ownMaterial: g.factory !== "model" };
      this.buckets.set(key, b);
    }
    for (let i = 0; i < n; i++) {
      const { s, sx, sy, sz } = g.list[i];
      this.matrixOf(s, this._m, sx, sy, sz);
      b.mesh.setMatrixAt(i, this._m);
      const t = s.tint ? this._c.setStyle(s.tint, THREE.NoColorSpace) : null;
      b.tint.setXYZ(i, t ? t.r : 1, t ? t.g : 1, t ? t.b : 1);
      b.info.setXYZW(i, num(s.seed), s.ghost ? 1 : 0, num(s.base), t ? 1 : 0);
    }
    b.mesh.count = n;
    b.mesh.visible = n > 0;
    b.caster.count = n;
    b.caster.visible = n > 0;
    b.entries = g.list;
    b.states = g.list.map((e) => e.s);
    b.mesh.instanceMatrix.needsUpdate = true;
    b.tint.needsUpdate = true;
    b.info.needsUpdate = true;
    b.restaged = true;
    this.writeFades(b);
  }

  /** One material per model part, shared by every prop drawing that model. */
  modelMaterial(src, key, opts) {
    let list = this.modelMats.get(src);
    if (!list) { list = new Map(); this.modelMats.set(src, list); }
    let m = list.get(key);
    if (!m) { m = PROP_MATERIAL_FACTORIES.model(this.shared, { ...opts, common: this.common }); list.set(key, m); }
    return m;
  }

  /** A bucket's fades and caster matrices from this.fades. → true when a caster changed. */
  writeFades(b) {
    let cast = false;
    if (!b.casting || b.casting.length < b.capacity) { b.casting = new Uint8Array(b.capacity).fill(2); }
    for (let i = 0; i < b.entries.length; i++) {
      const { s, sx, sy, sz } = b.entries[i];
      const a = Math.max(0, Math.min(1, this.fades.get(s.id) ?? 1));
      b.fade.setX(i, a);
      const on = s.ghost || a < 0.5 ? 0 : 1;
      if (b.casting[i] === on && !b.restaged) continue;
      b.casting[i] = on;
      b.caster.setMatrixAt(i, on ? this.matrixOf(s, this._m, sx, sy, sz) : ZERO);
      cast = true;
    }
    b.restaged = false;
    b.fade.needsUpdate = true;
    if (cast) b.caster.instanceMatrix.needsUpdate = true;
    return cast;
  }

  /** Stand, turn and size a state's geometry. */
  matrixOf(s, m, sx = Math.max(0.01, num(s.w, 1)), sy = Math.max(0.01, num(s.h, 1)), sz = Math.max(0.01, num(s.d, 1))) {
    this._p.set(num(s.x), num(s.base), num(s.y));
    this._e.set(0, -num(s.rot) * DEG, 0);
    this._q.setFromEuler(this._e);
    this._s.set(sx, sy, sz);
    return m.compose(this._p, this._q, this._s);
  }

  /** Does this prop get a contact shadow? Not a slab (it is ground), not a roof, not a beam in the air. */
  static grounded(s) {
    if (s.ghost || s.shape === "slab" || s.shape === "kit" || s.roof || ROOF_SHAPES.includes(s.shape)) return false;
    if (HUNG.has(s.shape) && s.floats) return false;
    // a model is grounded once it is there to ground: never a shadow under nothing
    if (s.shape === "model") return loadModel(s.src).state === "ready";
    return true;
  }

  fillContact(drawn, G) {
    const list = drawn.filter((s) => PropsLayer.grounded(s) && (!s.kitOf || num(s.elev) <= 0.01));
    const n = list.length;
    if (!this.contact || this.contact.userData.capacity < n) {
      if (this.contact) { this.group.remove(this.contact); this.contact.geometry.dispose(); this.contact.material.dispose(); }
      const capacity = Math.max(8, 1 << Math.ceil(Math.log2(Math.max(1, n))));
      const src = G.contact;
      const geo = new THREE.BufferGeometry();
      for (const name of Object.keys(src.attributes)) geo.setAttribute(name, src.attributes[name]);
      geo.setIndex(src.index);
      geo.setAttribute("iInfo", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
      this.contact = new THREE.InstancedMesh(geo, PROP_MATERIAL_FACTORIES.contact(this.shared), capacity);
      this.contact.name = "dio.prop.contact";
      this.contact.frustumCulled = false;
      this.contact.renderOrder = 1;
      this.contact.userData.capacity = capacity;
      this.group.add(this.contact);
    }
    const info = this.contact.geometry.getAttribute("iInfo");
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const card = s.shape === "card";
      const w = card ? Math.max(0.3, num(s.w, 1) * 0.8) : num(s.w, 1) * 1.3 + 0.18;
      const d = card ? 0.4 : num(s.d, 1) * 1.3 + 0.18;
      this._p.set(num(s.x), num(s.base) + 0.006, num(s.y));
      this._e.set(0, -num(s.rot) * DEG, 0);
      this._q.setFromEuler(this._e);
      this._s.set(w, 1, d);
      this.contact.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
      const thin = s.shape === "fence" || s.shape === "sign" || s.shape === "cross" || s.shape === "lamp";
      const strength = s.shape === "torus" || card || thin ? 0.32 : s.shape === "tree" || s.shape === "pine" || s.shape === "platform" ? 0.42 : 0.5;
      info.setXYZW(i, num(s.seed), 0, ROUND.has(s.shape) ? 1 : 0, strength);
    }
    this.contact.count = n;
    this.contact.visible = n > 0;
    this.contact.instanceMatrix.needsUpdate = true;
    info.needsUpdate = true;
  }

  syncCards(G) {
    const want = new Map(this.states.filter((s) => s.shape === "card").map((s) => [s.id, s]));
    for (const [id, c] of this.cards) if (!want.has(id)) this.dropCard(id, c);
    for (const [id, s] of want) {
      let c = this.cards.get(id);
      if (!c) {
        const material = PROP_MATERIAL_FACTORIES.card(this.shared, { common: this.common });
        const mesh = new THREE.Mesh(G.card, material);
        mesh.frustumCulled = false;
        mesh.name = `dio.prop.card.${id}`;
        const casterMaterial = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false, transparent: false });
        const caster = new THREE.Mesh(G.card, casterMaterial);
        caster.frustumCulled = false;
        c = { mesh, caster, material, casterMaterial, url: null, texture: null, aspect: 0 };
        this.cards.set(id, c);
        this.group.add(mesh);
      }
      c.state = s;
      if (c.url !== (s.img || "")) this.loadCard(c, s.img || "");
      this.placeCard(c);
    }
  }

  loadCard(c, url) {
    c.url = url;
    c.texture?.dispose();
    c.texture = null;
    c.aspect = 0;
    c.material.uniforms.uCardTex.value = null;
    c.material.uniforms.uHasTex.value = 0;
    c.casterMaterial.map = null;
    if (!url) return;
    loadDrawable(url).then((img) => {
      if (this._disposed || c.url !== url || !img) return;
      const t = new THREE.CanvasTexture(img);
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      c.texture = t;
      c.aspect = (img.width || 1) / (img.height || 1);
      c.material.uniforms.uCardTex.value = t;
      c.material.uniforms.uHasTex.value = 1;
      c.casterMaterial.map = t;
      c.casterMaterial.needsUpdate = true;
      this.placeCard(c);
      this.castersDirty = true;
      this._landed = true;
      this.onChange?.();
    });
  }

  /** A card's width follows its art: height × aspect (the stored w until it loads). */
  placeCard(c) {
    const s = c.state;
    const h = Math.max(0.05, num(s.h, 1));
    const w = c.aspect > 0 ? h * c.aspect : Math.max(0.05, num(s.w, 1));
    const u = c.material.uniforms;
    const fade = Math.max(0, Math.min(1, this.fades.get(s.id) ?? 1));
    u.uCardSize.value.set(w, h);
    u.uCardGhost.value = s.ghost ? 1 : 0;
    u.uCardFade.value = fade;
    if (s.tint) { this._c.setStyle(s.tint, THREE.NoColorSpace); u.uCardTint.value.set(this._c.r, this._c.g, this._c.b); }
    else u.uCardTint.value.set(1, 1, 1);
    c.mesh.position.set(num(s.x), num(s.base), num(s.y));
    c.caster.position.copy(c.mesh.position);
    c.caster.scale.set(w, h, 1);
    c.caster.rotation.set(0, Number.isFinite(this._sunYaw) ? this._sunYaw : 0, 0);
    // a ghost, a faded or an art-less card casts nothing
    const casts = !s.ghost && !!c.texture && fade >= 0.5;
    if (casts && !c.caster.parent) this.casters.add(c.caster);
    if (!casts && c.caster.parent) this.casters.remove(c.caster);
  }

  /**
   * How much of each roof shows (1 = all, 0 = gone): Map<propId, 0..1>. A prop
   * not in the map shows in full. Under half, it casts no shadow and cannot be
   * picked. Pure bookkeeping: nothing is rebuilt, a fade is one attribute.
   */
  setRoofFade(map) {
    this.fades = map instanceof Map ? map : new Map();
    let cast = false;
    for (const b of this.buckets.values()) if (b.entries.length && this.writeFades(b)) cast = true;
    for (const c of this.cards.values()) {
      const before = !!c.caster.parent;
      this.placeCard(c);
      if (before !== !!c.caster.parent) cast = true;
    }
    if (this.slabs.setFade(this.fades)) cast = true;
    if (cast) {
      // the renderer reads castersDirty before the roofs fade: ask for the frame that redraws the shadows
      this.castersDirty = true;
      this.onChange?.();
    }
  }

  dropCard(id, c) {
    this.group.remove(c.mesh);
    this.casters.remove(c.caster);
    c.material.dispose();
    c.casterMaterial.dispose();
    c.texture?.dispose();
    this.cards.delete(id);
  }

  dropBucket(key) {
    const b = this.buckets.get(key);
    if (!b) return;
    this.group.remove(b.mesh);
    this.casters.remove(b.caster);
    if (b.ownMaterial) b.material.dispose();
    b.geo.dispose();
    b.mesh.dispose?.();
    b.caster.dispose?.();
    this.buckets.delete(key);
  }

  /** Foliage sways only at high detail, in wind, with foliage on the board, close enough to see it. */
  animated(fx) {
    return !!fx && fx.detail > 0 && this.hasFoliage && this.wind > 0.001 && this._lod > 0.01;
  }

  frame(_t, dt, _camera, fx) {
    // the level of detail follows the zoom, damped: zooming out fades relief, never pops it
    const ppc = this.pxWorld > 0 ? 1 / this.pxWorld : LOD_FULL_PX;
    const k = Math.min(1, Math.max(0, (ppc - LOD_NONE_PX) / (LOD_FULL_PX - LOD_NONE_PX)));
    const target = k * k * (3 - 2 * k);
    let moving = false;
    if (Math.abs(target - this._lod) < 0.002) this._lod = target;
    else {
      this._lod += (target - this._lod) * (1 - Math.exp(-LOD_RATE * Math.max(0, Number(dt) || 0)));
      moving = true;
    }
    const detail = fx?.detail > 0 ? 1 : 0;
    this.common.uPropDetail.value = detail;
    this.common.uPropLod.value = this._lod;
    this.common.uPropSway.value = this.animated(fx) ? this._lod : 0;
    if (this.cards.size) {
      const kd = this.shared.uKeyDir.value;
      const yaw = Math.atan2(kd.x, kd.z);
      if (Math.abs(yaw - this._sunYaw) > 1e-4 || !Number.isFinite(this._sunYaw)) {
        this._sunYaw = yaw;
        for (const c of this.cards.values()) c.caster.rotation.set(0, yaw, 0);
        this.castersDirty = true;
      }
    }
    const landed = this._landed;
    this._landed = false;
    // relief that is still fading asks for frames; with detail shed there is nothing to fade
    return landed || (moving && detail > 0);
  }

  /** The nearest BLOCKING prop under a ray (what a token could stand on). */
  pick(raycaster) {
    const meshes = [];
    for (const b of this.buckets.values()) if (b.mesh.visible) meshes.push(b.mesh);
    let best = null;
    if (meshes.length) {
      const hits = raycaster.intersectObjects(meshes, false);
      for (const h of hits) {
        let b = null;
        for (const x of this.buckets.values()) if (x.mesh === h.object) { b = x; break; }
        const s = b?.states[h.instanceId];
        if (s && s.blocks && !s.ghost && (this.fades.get(s.id) ?? 1) >= 0.5) { best = { id: s.id, point: h.point.clone(), distance: h.distance }; break; }
      }
    }
    const slab = this.slabs.pick(raycaster);
    if (slab?.blocks && (!best || slab.distance < best.distance)) best = slab;
    return best ? { id: best.id, point: best.point } : null;
  }

  dispose() {
    this._disposed = true;
    for (const key of [...this.buckets.keys()]) this.dropBucket(key);
    for (const [id, c] of [...this.cards]) this.dropCard(id, c);
    if (this.contact) { this.contact.geometry.dispose(); this.contact.material.dispose(); this.contact = null; }
    this.slabs.dispose();
    for (const list of this.modelMats.values()) for (const m of list.values()) m.dispose();
    this.modelMats.clear();
    this.casterMat.dispose();
    for (const g of Object.values(this.geos ?? {})) g.dispose();
    for (const g of this.dyn.values()) g.dispose();
    this.dyn.clear();
    this.geos = null;
    this.group.clear();
    this.casters.clear();
  }
}
