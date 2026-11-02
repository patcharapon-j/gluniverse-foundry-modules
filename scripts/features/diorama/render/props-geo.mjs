/**
 * Diorama — the geometry of props. See docs/DIORAMA_PROPS.md.
 *
 * Two kinds:
 *
 *   UNIT geometries (buildPropGeometries): footprint [-0.5, 0.5]², height
 *   [0, 1], shared by every prop of a shape and stood, turned and sized by the
 *   instance matrix. A few shapes come in VARIANTS of the same unit box, keyed
 *   by what scaling cannot do (a flight of stairs keeps its steps a step high,
 *   a fence its posts a post wide, a hip its pitch), built once per key.
 *
 *   OWN geometries: a shape whose outline is data (an extrusion's points, a
 *   pipe's path) is built at its own size in cells, centred on the prop, and
 *   drawn with no scale. Built once per outline, kept while some prop uses it.
 *
 * Every builder here is deterministic: the same prop always draws the same
 * mesh, on every client.
 *
 * PURE: no world reads (the preview page and the check tool drive it).
 */

import * as THREE from "./three.mjs";
import { DEFAULT_PROFILE } from "../terrain/props.mjs";

const TAU = Math.PI * 2;

/* ================================================================ helpers */

/** Merge geometries (position + normal) into one non-indexed geometry. */
export function merge(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
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
export function fit(g, [x0, x1], [y0, y1], [z0, z1]) {
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
export function facet(g) {
  const f = g.index ? g.toNonIndexed() : g;
  if (f.attributes.uv) f.deleteAttribute("uv");
  f.computeVertexNormals();
  return f;
}

/** A box spanning [x0, x1] × [y0, y1] × [z0, z1]. */
function block(x0, x1, y0, y1, z0, z1) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/**
 * A closed convex solid from faces (each a list of 3 or 4 points), every face
 * turned to point away from `centre`. Flat normals.
 */
function hull(faces, centre) {
  const pos = [];
  const tri = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (Math.hypot(n[0], n[1], n[2]) < 1e-9) return;
    const m = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    const out = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0;
    pos.push(...a, ...(out ? b : c), ...(out ? c : b));
  };
  for (const f of faces) {
    tri(f[0], f[1], f[2]);
    if (f.length === 4) tri(f[0], f[2], f[3]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/** A lump: an icosphere pushed out by a deterministic noise (watertight). */
export function lump(radius, detail, amp, seed, [cx, cy, cz] = [0, 0, 0], squash = 1) {
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

/** A thin bar from point a to point b (a leg, a strut), `t` thick. */
function strut(a, b, t) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/** A solid turned about the y axis from [r, y] pairs (cells of the unit box). */
function turned(points, segments = 28) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments);
  if (g.attributes.uv) g.deleteAttribute("uv");
  return g;
}

/* ================================================================ the original shapes */

function rock(seed) {
  const g = lump(0.5, 1, 0.28, seed, [0, 0, 0], 0.8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.18) p.setY(i, -0.18);
  return fit(facet(g), [-0.5, 0.5], [0, 1], [-0.5, 0.5]);
}

function wedge() {
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [-0.5, 1, -0.5], D = [0.5, 1, -0.5], E = [-0.5, 0, 0.5], F = [0.5, 0, 0.5];
  return hull([[A, B, D, C], [C, D, F, E], [A, B, F, E], [A, C, E], [B, D, F]], [0, 0.33, -0.17]);
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

/* ================================================================ the new shapes */

/** A prism of n sides filling the unit box (hex: vertices on ±x; octagon: flats on the axes). */
function prism(n, turn) {
  const g = facet(new THREE.CylinderGeometry(0.5, 0.5, 1, n, 1).rotateY(turn).translate(0, 0.5, 0));
  return fit(g, [-0.5, 0.5], [0, 1], [-0.5, 0.5]);
}

/** A straight pipe: a cylinder along x. */
function pipeStraight() {
  return new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1).rotateZ(Math.PI / 2).translate(0, 0.5, 0);
}

/** Steps for a flight of `n`: highest at the back (z = -0.5), down to the front. */
export function stairs(n) {
  const k = Math.max(2, Math.min(16, Math.round(n)));
  const list = [];
  for (let i = 0; i < k; i++) list.push(block(-0.5, 0.5, i / k, (i + 1) / k, -0.5, 0.5 - i / k));
  return merge(list);
}

/** A table: a top and four legs. */
function platform() {
  const t = 0.07, m = 0.06;
  return merge([
    block(-0.5, 0.5, 0.86, 1, -0.5, 0.5),
    block(-0.5 + m, -0.5 + m + t, 0, 0.86, -0.5 + m, -0.5 + m + t),
    block(0.5 - m - t, 0.5 - m, 0, 0.86, -0.5 + m, -0.5 + m + t),
    block(-0.5 + m, -0.5 + m + t, 0, 0.86, 0.5 - m - t, 0.5 - m),
    block(0.5 - m - t, 0.5 - m, 0, 0.86, 0.5 - m - t, 0.5 - m),
  ]);
}

/** A fence of `posts` posts and two rails along x. */
export function fence(posts) {
  const p = Math.max(2, Math.min(24, Math.round(posts)));
  const pw = Math.min(0.2, 0.15 / (p - 1));
  const list = [];
  for (let i = 0; i < p; i++) {
    const x = -0.5 + pw / 2 + (i * (1 - pw)) / (p - 1);
    list.push(block(x - pw / 2, x + pw / 2, 0, 1, -0.5, 0.5));
  }
  list.push(block(-0.5, 0.5, 0.3, 0.42, -0.3, 0.3));
  list.push(block(-0.5, 0.5, 0.74, 0.86, -0.3, 0.3));
  return merge(list);
}

/** A low wall: a body and an overhanging cap. */
function parapet() {
  return merge([block(-0.5, 0.5, 0, 0.86, -0.4, 0.4), block(-0.5, 0.5, 0.86, 1, -0.5, 0.5)]);
}

/** A sign: a post and a board. */
function sign() {
  return merge([block(-0.07, 0.07, 0, 0.96, -0.5, 0.5), block(-0.5, 0.5, 0.5, 0.92, -0.35, 0.35)]);
}

function cross() {
  return merge([block(-0.15, 0.15, 0, 1, -0.5, 0.5), block(-0.5, 0.5, 0.6, 0.78, -0.5, 0.5)]);
}

function bowl() {
  return turned([[0, 0], [0.28, 0], [0.4, 0.22], [0.5, 0.86], [0.5, 1], [0.44, 1], [0.38, 0.6], [0.24, 0.34], [0, 0.32]]);
}

/** A brazier's iron: three splayed legs under a bowl whose rim is the prop's top. */
function brazierIron() {
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 6;
    const c = Math.cos(a), s = Math.sin(a);
    legs.push(strut([c * 0.2, 0.66, s * 0.2], [c * 0.44, 0, s * 0.44], 0.07));
  }
  const ring = new THREE.TorusGeometry(0.33, 0.025, 6, 24).rotateX(Math.PI / 2).translate(0, 0.3, 0);
  const cup = turned([[0, 0.56], [0.14, 0.56], [0.36, 0.66], [0.5, 0.9], [0.5, 1], [0.44, 1], [0.36, 0.8], [0.12, 0.72], [0, 0.72]], 24);
  // a splayed leg's corner dips a hair under the ground: stand it back on y = 0
  return fit(merge([...legs, ring, cup]), [-0.5, 0.5], [0, 1], [-0.5, 0.5]);
}

/** The coals heaped in a brazier's bowl, just under the rim. */
function brazierCoals() {
  const g = facet(merge([
    facet(lump(0.3, 1, 0.22, 2.2, [0, 0, 0], 0.5)),
    facet(lump(0.14, 0, 0.2, 4.4, [0.12, 0.08, 0.06])),
    facet(lump(0.12, 0, 0.2, 6.6, [-0.1, 0.07, -0.1])),
  ]));
  return fit(g, [-0.38, 0.38], [0.7, 0.93], [-0.38, 0.38]);
}

/** A lamp post: a base, a post and a cap; the lantern is its own (glowing) part. */
function lampPost() {
  return merge([
    new THREE.CylinderGeometry(0.3, 0.38, 0.06, 10).translate(0, 0.03, 0),
    new THREE.CylinderGeometry(0.1, 0.14, 0.78, 10).translate(0, 0.45, 0),
    new THREE.CylinderGeometry(0.22, 0.12, 0.03, 8).translate(0, 0.835, 0),
    new THREE.ConeGeometry(0.5, 0.06, 8).translate(0, 0.97, 0),
  ]);
}

function lampLantern() {
  return facet(new THREE.CylinderGeometry(0.34, 0.27, 0.12, 8).translate(0, 0.9, 0));
}

/** A gable roof: a ridge along x at the top, eaves on both long sides. */
function gable() {
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5], r0 = [-0.5, 1, 0], r1 = [0.5, 1, 0];
  return hull([[a, b, r1, r0], [d, c, r1, r0], [a, d, r0], [b, c, r1], [a, b, c, d]], [0, 0.3, 0]);
}

/**
 * A hip roof with the same pitch on all four sides: a ridge along the longer
 * axis (`axis` "x" or "z"), `ratio` = shorter side / longer side.
 */
export function hip(axis = "x", ratio = 2 / 3) {
  const k = Math.max(0, Math.min(1, ratio));
  const half = 0.5 - 0.5 * k;   // the ridge's half length, in the unit box along its axis
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5];
  if (half < 0.01) {
    const t = [0, 1, 0];
    return hull([[a, b, t], [b, c, t], [c, d, t], [d, a, t], [a, b, c, d]], [0, 0.3, 0]);
  }
  const r0 = axis === "x" ? [-half, 1, 0] : [0, 1, -half];
  const r1 = axis === "x" ? [half, 1, 0] : [0, 1, half];
  const faces = axis === "x"
    ? [[a, b, r1, r0], [d, c, r1, r0], [a, d, r0], [b, c, r1], [a, b, c, d]]
    : [[a, d, r1, r0], [b, c, r1, r0], [a, b, r0], [d, c, r1], [a, b, c, d]];
  return hull(faces, [0, 0.3, 0]);
}

/** A lathe from a stored profile ([r 0..1 of the half-width, y 0..1]). */
export function latheOf(profile) {
  return turned(profile.map(([r, y]) => [r * 0.5, y]), 28);
}

/* ================================================================ unit set */

const ROCK_VARIANTS = 4;
export { ROCK_VARIANTS };

/** Every unit geometry a prop part uses (the variants' defaults included), built once per layer. */
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
    hex: prism(6, Math.PI / 2),
    octagon: prism(8, Math.PI / 8),
    pipe: pipeStraight(),
    stairs: stairs(5),
    platform: platform(),
    fence: fence(3),
    parapet: parapet(),
    sign: sign(),
    cross: cross(),
    bowl: bowl(),
    brazierIron: brazierIron(),
    coals: brazierCoals(),
    lampPost: lampPost(),
    lantern: lampLantern(),
    gable: gable(),
    hip: hip("x", 2 / 3),
    spire: facet(new THREE.ConeGeometry(0.5, 1, 10).translate(0, 0.5, 0)),
    lathe: latheOf(DEFAULT_PROFILE),
    card: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
    contact: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
  for (let i = 0; i < ROCK_VARIANTS; i++) G[`rock${i}`] = rock(1.7 + i * 2.3);
  for (const g of Object.values(G)) finish(g, g === G.card || g === G.contact);
  return G;
}

/** The last pass every geometry gets: no uv (unless a card's), bounds computed. */
export function finish(g, keepUv = false) {
  if (g.attributes.uv && !keepUv) g.deleteAttribute("uv");
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/* ================================================================ own-size shapes */

/**
 * An extrusion at its own size: the outline `points` ([[x, y], …] cells from
 * the centre, y down the map) raised `h` cells, its edges rounded by `bevel`.
 */
export function extrusion(points, h, bevel = 0.04) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, -y)));
  const b = Math.max(0, Math.min(bevel, h / 2 - 0.005, 0.5));
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.01, h - 2 * b),
    bevelEnabled: b > 0.001,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 2,
    curveSegments: 1,
  });
  g.clearGroups();
  g.rotateX(-Math.PI / 2);
  g.translate(0, b > 0.001 ? b : 0, 0);
  return finish(g);
}

/**
 * A pipe at its own size along `path` ([[x, y, z], …] cells from the centre; z
 * is the centre line's height above the base), `thick` across. Corners are
 * rounded, the ends capped.
 */
export function pipeAlong(path, thick) {
  const r = Math.max(0.01, thick / 2);
  const P = path.map(([x, y, z]) => new THREE.Vector3(x, z, y));
  const curve = new THREE.CurvePath();
  let from = P[0].clone();
  let len = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    if (i < P.length - 1) {
      const c = P[i + 1];
      const lin = a.distanceTo(b), lout = b.distanceTo(c);
      const rc = Math.min(thick * 1.5, lin * 0.45, lout * 0.45);
      const p0 = b.clone().addScaledVector(a.clone().sub(b).normalize(), rc);
      const p1 = b.clone().addScaledVector(c.clone().sub(b).normalize(), rc);
      if (from.distanceTo(p0) > 1e-4) curve.add(new THREE.LineCurve3(from.clone(), p0));
      if (rc > 1e-4) curve.add(new THREE.QuadraticBezierCurve3(p0, b.clone(), p1));
      from = p1;
    } else if (from.distanceTo(b) > 1e-4) {
      curve.add(new THREE.LineCurve3(from.clone(), b.clone()));
    }
    len += a.distanceTo(b);
  }
  const segs = Math.max(4, Math.min(256, Math.round(len * 10 + P.length * 6)));
  const tube = new THREE.TubeGeometry(curve, segs, r, 10, false);
  const ends = [P[0], P[P.length - 1]].map((p) => new THREE.SphereGeometry(r, 10, 6).translate(p.x, p.y, p.z));
  return finish(merge([tube, ...ends]));
}
