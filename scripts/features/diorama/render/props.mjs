/**
 * Diorama — props: primitive objects placed on the board. See
 * docs/DIORAMA_PROPS.md.
 *
 * Contract with renderer.mjs:
 *   new PropsLayer(shared, onChange)  shared = createShared() uniforms;
 *                                 onChange() asks for a frame (card art landed)
 *   .group                        THREE.Group added to the scene
 *   .casters                      THREE.Scene the shadow pass draws with its
 *                                 own materials (the depth override cannot
 *                                 instance), so props cast shadows
 *   .castersDirty                 the renderer re-renders the shadow map
 *   .rules                        the ground with blocking props stamped in
 *                                 (overlays and picks stand on it), or null
 *   .maxY                         highest prop top, cells (shadow bounds)
 *   .setGridSize(px)
 *   .setTerrain(terrain|null)     the GROUND the props stand on
 *   .setEnvironment(env|null)     wind for sway (environment.mjs's resolved env)
 *   .set(PropState[], now, animate)
 *   .animated(fx) → bool          true only while foliage sways (fx.detail high,
 *                                 wind blowing, a foliage part on the board)
 *   .frame(t, dt, camera, fx) → bool
 *   .pick(raycaster) → {id, point}|null   blocking props only
 *   .dispose()
 *
 * Drawing: every prop is instanced. A shape is one or more parts (a tree is a
 * trunk and a crown); each (part geometry × material) is one InstancedMesh, so
 * a forest of a hundred trees is two draw calls. Geometries are unit-sized
 * (footprint [-0.5, 0.5]², height [0, 1]) and shared; the instance matrix
 * stands, turns and scales them. Nothing allocates per frame: set() writes the
 * instance buffers once, and an idle board asks for no frames.
 *
 * PURE: never reads the world (the preview page and the check tool drive it).
 */

import * as THREE from "./three.mjs";
import { PALETTE, hexToRgbFloat } from "../../../core/theme.mjs";
import { PROPS_PROGRAMS, PROP_MAT_ID, PROP_PART_ID } from "./props-glsl.mjs";
import { loadDrawable } from "./art.mjs";
import { stampStates } from "../terrain/props.mjs";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* ================================================================ geometry */

/** Merge geometries (position + normal) into one non-indexed geometry. */
function merge(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

/** Scale and move a geometry so its bounds are exactly the given box. */
function fit(g, [x0, x1], [y0, y1], [z0, z1]) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  const sx = (x1 - x0) / Math.max(1e-6, b.max.x - b.min.x);
  const sy = (y1 - y0) / Math.max(1e-6, b.max.y - b.min.y);
  const sz = (z1 - z0) / Math.max(1e-6, b.max.z - b.min.z);
  g.translate(-b.min.x, -b.min.y, -b.min.z);
  g.scale(sx, sy, sz);
  g.translate(x0, y0, z0);
  return g;
}

/** Faceted: one normal per face (the low-poly look of rocks and leaves). */
function facet(g) {
  const f = g.index ? g.toNonIndexed() : g;
  f.deleteAttribute("uv");
  f.computeVertexNormals();
  return f;
}

/** A lump: an icosphere pushed out by a deterministic noise (watertight). */
function lump(radius, detail, amp, seed, [cx, cy, cz] = [0, 0, 0], squash = 1) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    const ux = x / l, uy = y / l, uz = z / l;
    const k = 1 + amp * (Math.sin(ux * 4.7 + seed * 11.3) * Math.sin(uy * 3.9 + seed * 5.1) * Math.sin(uz * 5.3 + seed * 7.7)
      + 0.5 * Math.sin(ux * 9.1 - seed * 3.7) * Math.sin(uz * 8.3 + seed * 2.9));
    p.setXYZ(i, cx + x * k, cy + y * k * squash, cz + z * k);
  }
  return g;
}

/** A rock: a lump with its underside cut flat. */
function rock(seed) {
  const g = lump(0.5, 1, 0.28, seed, [0, 0, 0], 0.8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.18) p.setY(i, -0.18);
  return fit(facet(g), [-0.5, 0.5], [0, 1], [-0.5, 0.5]);
}

function wedge() {
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [-0.5, 1, -0.5], D = [0.5, 1, -0.5], E = [-0.5, 0, 0.5], F = [0.5, 0, 0.5];
  const centre = [0, 0.33, -0.17];
  const pos = [];
  const tri = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const m = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    const out = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0;
    pos.push(...a, ...(out ? b : c), ...(out ? c : b));
  };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  quad(A, B, D, C);   // back
  quad(C, D, F, E);   // slope
  quad(A, B, F, E);   // bottom
  tri(A, C, E);       // left
  tri(B, D, F);       // right
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

function arch() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(-0.3, 0);
  s.lineTo(-0.3, 0.55);
  s.absarc(0, 0.55, 0.3, Math.PI, 0, true);
  s.lineTo(0.3, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0.5, 1);
  s.lineTo(-0.5, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 14 });
  g.clearGroups();
  g.translate(0, 0, -0.5);
  g.deleteAttribute("uv");
  return g;
}

function barrel() {
  const g = new THREE.CylinderGeometry(0.42, 0.42, 1, 22, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);            // -0.5..0.5
    const k = 1 + 0.19 * (1 - (2 * y) * (2 * y));
    p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  g.translate(0, 0.5, 0);
  return g;
}

function pillar() {
  const base = new THREE.BoxGeometry(1, 0.08, 1).translate(0, 0.04, 0);
  const shaft = new THREE.CylinderGeometry(0.34, 0.38, 0.84, 24).translate(0, 0.5, 0);
  const cap = new THREE.BoxGeometry(0.94, 0.08, 0.94).translate(0, 0.96, 0);
  return merge([base, shaft, cap]);
}

function crown() {
  const g = merge([
    facet(lump(0.42, 1, 0.12, 1.3, [0, 0, 0], 0.85)),
    facet(lump(0.28, 1, 0.14, 2.7, [0.22, 0.14, 0.08])),
    facet(lump(0.26, 1, 0.14, 4.1, [-0.2, 0.08, -0.14])),
    facet(lump(0.22, 1, 0.14, 5.9, [0.02, 0.2, -0.22])),
  ]);
  return fit(g, [-0.5, 0.5], [0.36, 1], [-0.5, 0.5]);
}

function pineCones() {
  const g = merge([
    facet(new THREE.ConeGeometry(0.5, 0.46, 9).translate(0, 0.23, 0)),
    facet(new THREE.ConeGeometry(0.38, 0.42, 9).rotateY(0.35).translate(0, 0.46, 0)),
    facet(new THREE.ConeGeometry(0.26, 0.4, 9).rotateY(0.7).translate(0, 0.68, 0)),
  ]);
  return fit(g, [-0.5, 0.5], [0.16, 1], [-0.5, 0.5]);
}

function bush() {
  const g = merge([
    facet(lump(0.45, 1, 0.14, 3.3, [0, 0, 0], 0.8)),
    facet(lump(0.3, 1, 0.16, 6.1, [0.3, -0.06, 0.12])),
    facet(lump(0.28, 1, 0.16, 7.7, [-0.26, -0.08, -0.16])),
  ]);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.22) p.setY(i, -0.22);
  return fit(g, [-0.5, 0.5], [0, 1], [-0.5, 0.5]);
}

const ROCK_VARIANTS = 4;

/** Every geometry a prop part uses, built once per layer. */
export function buildPropGeometries() {
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 26).translate(0, 0.5, 0),
    cone: new THREE.ConeGeometry(0.5, 1, 26).translate(0, 0.5, 0),
    sphere: new THREE.SphereGeometry(0.5, 26, 16).translate(0, 0.5, 0),
    dome: new THREE.SphereGeometry(0.5, 26, 10, 0, TAU, 0, Math.PI / 2).scale(1, 2, 1),
    pyramid: facet(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0)),
    wedge: wedge(),
    torus: new THREE.TorusGeometry(0.375, 0.125, 12, 32).rotateX(Math.PI / 2).translate(0, 0.125, 0).scale(1, 4, 1),
    capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 18).translate(0, 1, 0).scale(1, 0.5, 1),
    arch: arch(),
    pillar: pillar(),
    barrel: barrel(),
    trunk: new THREE.CylinderGeometry(0.065, 0.095, 0.56, 9).translate(0, 0.28, 0),
    crown: crown(),
    pineTrunk: new THREE.CylinderGeometry(0.06, 0.08, 0.28, 8).translate(0, 0.14, 0),
    pine: pineCones(),
    bush: bush(),
    card: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
    contact: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
  for (let i = 0; i < ROCK_VARIANTS; i++) G[`rock${i}`] = rock(1.7 + i * 2.3);
  for (const g of Object.values(G)) {
    if (g.attributes.uv && g !== G.card && g !== G.contact) g.deleteAttribute("uv");
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }
  return G;
}

/**
 * The parts every shape is drawn with. `mat` fixes a part's material (a trunk
 * is bark whatever the crown is); otherwise it takes the prop's. `foliage`
 * parts sway when made of foliage.
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
});

/** Shapes whose contact shadow is a disc rather than a rounded box. */
const ROUND = new Set(["cylinder", "cone", "sphere", "dome", "torus", "capsule", "pillar", "barrel", "rock", "tree", "pine", "bush", "card"]);

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
        uPropSway: c.uPropSway,
        uPropWind: c.uPropWind,
        uGhostColor: c.uGhostColor,
      },
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
};

export const PROP_MATERIAL_PROGRAM = Object.freeze({ prop: "prop", card: "propCard", contact: "propContact" });

/** Uniforms every prop material shares by reference: one write serves all. */
export function propCommon() {
  return {
    uPropDetail: { value: 0 },
    uPropSway: { value: 0 },
    uPropWind: { value: new THREE.Vector3(1, 0, 0) },
    uGhostColor: { value: vec3(PALETTE.violet) },
  };
}

/* ================================================================ the layer */

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

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
    this.states = [];
    this.geos = null;
    /** bucket key → { mesh, caster, tint, info, capacity, states } */
    this.buckets = new Map();
    this.contact = null;
    /** card prop id → { mesh, caster, material, url, texture, aspect } */
    this.cards = new Map();
    this.casterMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.wind = 0;
    this.hasFoliage = false;
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

  /** @param {object[]} states PropState[] (terrain/props.mjs propStates) */
  set(states) {
    if (this._disposed) return;
    this.states = Array.isArray(states) ? states.filter((s) => s && SHAPE_PARTS[s.shape]) : [];
    this.rules = this.ground ? stampStates(this.ground, this.states) : null;
    if (this.rules === this.ground) this.rules = null;
    if (!this.states.length && !this.geos) return;
    const G = this.ensureGeometries();

    // group the parts by bucket; ghosts last so the casters can stop short
    const groups = new Map();
    let foliage = false, maxY = 0;
    const ordered = [...this.states.filter((s) => !s.ghost), ...this.states.filter((s) => s.ghost)];
    for (const s of ordered) {
      maxY = Math.max(maxY, num(s.base) + num(s.h, 1));
      for (const part of SHAPE_PARTS[s.shape]) {
        const mat = part.mat ?? s.mat ?? "stone";
        const geo = part.geo === "rock" ? `rock${Math.floor(num(s.seed) * ROCK_VARIANTS) % ROCK_VARIANTS}` : part.geo;
        const key = `${geo}|${mat}|${part.part ?? "plain"}|${part.bevel ? 1 : 0}|${part.foliage ? 1 : 0}`;
        if (part.foliage && mat === "foliage") foliage = true;
        let g = groups.get(key);
        if (!g) { g = { geo, mat, part, list: [] }; groups.set(key, g); }
        g.list.push(s);
      }
    }
    this.hasFoliage = foliage;
    this.maxY = maxY;

    for (const [key, b] of this.buckets) {
      if (!groups.has(key)) { b.mesh.count = 0; b.mesh.visible = false; b.caster.count = 0; b.caster.visible = false; b.states = []; }
    }
    for (const [key, g] of groups) this.fill(key, g, G);
    this.fillContact(ordered, G);
    this.syncCards(G);
    this.castersDirty = true;
  }

  fill(key, g, G) {
    let b = this.buckets.get(key);
    const n = g.list.length;
    if (!b || b.capacity < n) {
      if (b) this.dropBucket(key);
      const capacity = Math.max(8, 1 << Math.ceil(Math.log2(n)));
      const src = G[g.geo];
      const geo = new THREE.BufferGeometry();
      for (const name of Object.keys(src.attributes)) geo.setAttribute(name, src.attributes[name]);
      if (src.index) geo.setIndex(src.index);
      geo.boundingSphere = src.boundingSphere;
      geo.boundingBox = src.boundingBox;
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      const info = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      geo.setAttribute("iTint", tint);
      geo.setAttribute("iInfo", info);
      const material = PROP_MATERIAL_FACTORIES.prop(this.shared, {
        mat: g.mat, part: g.part.part ?? "plain", bevel: !!g.part.bevel, foliage: !!g.part.foliage, common: this.common,
      });
      const mesh = new THREE.InstancedMesh(geo, material, capacity);
      mesh.name = `dio.prop.${key}`;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const caster = new THREE.InstancedMesh(geo, this.casterMat, capacity);
      caster.instanceMatrix = mesh.instanceMatrix;
      caster.frustumCulled = false;
      this.group.add(mesh);
      this.casters.add(caster);
      b = { mesh, caster, tint, info, capacity, states: [], geo, material };
      this.buckets.set(key, b);
    }
    let solid = 0;
    for (let i = 0; i < n; i++) {
      const s = g.list[i];
      this.matrixOf(s, this._m);
      b.mesh.setMatrixAt(i, this._m);
      const t = s.tint ? this._c.setStyle(s.tint, THREE.NoColorSpace) : null;
      b.tint.setXYZ(i, t ? t.r : 1, t ? t.g : 1, t ? t.b : 1);
      b.info.setXYZW(i, num(s.seed), s.ghost ? 1 : 0, num(s.base), t ? 1 : 0);
      if (!s.ghost) solid++;
    }
    b.mesh.count = n;
    b.mesh.visible = n > 0;
    b.caster.count = solid;
    b.caster.visible = solid > 0;
    b.states = g.list;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.tint.needsUpdate = true;
    b.info.needsUpdate = true;
    b.mesh.computeBoundingSphere?.();
  }

  /** Stand, turn and size a state's unit geometry. */
  matrixOf(s, m) {
    this._p.set(num(s.x), num(s.base), num(s.y));
    this._e.set(0, -num(s.rot) * DEG, 0);
    this._q.setFromEuler(this._e);
    this._s.set(Math.max(0.01, num(s.w, 1)), Math.max(0.01, num(s.h, 1)), Math.max(0.01, num(s.d, 1)));
    return m.compose(this._p, this._q, this._s);
  }

  fillContact(ordered, G) {
    const list = ordered.filter((s) => !s.ghost);
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
      const strength = s.shape === "torus" || card ? 0.32 : s.shape === "tree" || s.shape === "pine" ? 0.42 : 0.5;
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
    u.uCardSize.value.set(w, h);
    u.uCardGhost.value = s.ghost ? 1 : 0;
    if (s.tint) { this._c.setStyle(s.tint, THREE.NoColorSpace); u.uCardTint.value.set(this._c.r, this._c.g, this._c.b); }
    else u.uCardTint.value.set(1, 1, 1);
    c.mesh.position.set(num(s.x), num(s.base), num(s.y));
    c.caster.position.copy(c.mesh.position);
    c.caster.scale.set(w, h, 1);
    c.caster.rotation.set(0, Number.isFinite(this._sunYaw) ? this._sunYaw : 0, 0);
    // a ghost or an art-less card casts nothing
    const casts = !s.ghost && !!c.texture;
    if (casts && !c.caster.parent) this.casters.add(c.caster);
    if (!casts && c.caster.parent) this.casters.remove(c.caster);
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
    b.material.dispose();
    b.geo.dispose();
    b.mesh.dispose?.();
    this.buckets.delete(key);
  }

  /** Foliage sways only at high detail, in wind, with foliage on the board. */
  animated(fx) {
    return !!fx && fx.detail > 0 && this.hasFoliage && this.wind > 0.001;
  }

  frame(_t, _dt, _camera, fx) {
    this.common.uPropDetail.value = fx?.detail > 0 ? 1 : 0;
    this.common.uPropSway.value = this.animated(fx) ? 1 : 0;
    if (this.cards.size) {
      const k = this.shared.uKeyDir.value;
      const yaw = Math.atan2(k.x, k.z);
      if (Math.abs(yaw - this._sunYaw) > 1e-4 || !Number.isFinite(this._sunYaw)) {
        this._sunYaw = yaw;
        for (const c of this.cards.values()) c.caster.rotation.set(0, yaw, 0);
        this.castersDirty = true;
      }
    }
    const landed = this._landed;
    this._landed = false;
    return landed;
  }

  /** The nearest BLOCKING prop under a ray (what a token could stand on). */
  pick(raycaster) {
    const meshes = [];
    for (const b of this.buckets.values()) if (b.mesh.visible) meshes.push(b.mesh);
    if (!meshes.length) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      const b = [...this.buckets.values()].find((x) => x.mesh === h.object);
      const s = b?.states[h.instanceId];
      if (s && s.blocks && !s.ghost) return { id: s.id, point: h.point.clone() };
    }
    return null;
  }

  dispose() {
    this._disposed = true;
    for (const key of [...this.buckets.keys()]) this.dropBucket(key);
    for (const [id, c] of [...this.cards]) this.dropCard(id, c);
    if (this.contact) { this.contact.geometry.dispose(); this.contact.material.dispose(); this.contact = null; }
    this.casterMat.dispose();
    for (const g of Object.values(this.geos ?? {})) g.dispose();
    this.geos = null;
    this.group.clear();
    this.casters.clear();
  }
}
