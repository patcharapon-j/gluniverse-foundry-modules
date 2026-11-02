/**
 * Diorama — Foundry tiles on the board: ground tiles as decals lying on the
 * terrain, roof tiles as planes over it. See docs/DIORAMA_BUILDINGS.md.
 *
 * Contract with renderer.mjs:
 *   new TilesLayer(shared, onChange, { maxTexture })   onChange(): art landed, draw again
 *   .group          THREE.Group in the scene
 *   .casters        THREE.Scene the shadow pass draws with its own materials (roofs cast)
 *   .castersDirty   the renderer re-renders the shadow map
 *   .maxY           highest tile, cells (shadow bounds)
 *   .setGridSize(px)
 *   .setTerrain(terrain|null)    the drawn ground the decals lie on
 *   .set(TileState[])            integrations/tiles.mjs readTiles
 *   .applyRoofs(fader)           render/roofs.mjs RoofFader: what each roof shows now
 *   .animated(fx) → bool         a video tile is playing (and tileVideo is not shed)
 *   .frame(t, dt, fx) → bool
 *   .dispose()
 *
 * Placement follows Foundry's own sprite exactly (tileQuad): the document's
 * (x, y) is the anchor, the art is fitted to the box by `fit`, scaled by
 * scaleX / scaleY (negative mirrors), and turned about the anchor. A decal is
 * draped over the ground on a fine grid, so a rug on a terrace lies on the
 * terrace; where it crosses a step it takes the lower side, so it never hangs a
 * sheet in front of a cliff. A roof is one plane at the height the view gave it.
 *
 * Both are lit like the ground (shade, the shared weather and shadows) and go
 * through dioFinish, and both follow sight: a decal over ground nobody has seen
 * discards per pixel, exactly like the ground; a roof shows where its own
 * ground has been seen or once its outline has (the view's `seen`). A GM-only
 * tile is the hatched violet ghost every GM-only thing is, and casts nothing.
 *
 * PURE: never reads the world.
 */

import * as THREE from "./three.mjs";
import { PALETTE, hexToRgbFloat } from "../../../core/theme.mjs";
import { HEAD } from "./glsl.mjs";
import { SUB } from "../constants.mjs";

/** Decal drape: vertices per cell along each side, and the most along one side. */
export const DRAPE_PER_CELL = 8;
export const DRAPE_MAX = 192;
/** A decal floats this far over the ground (cells); a roof this far over its walls' caps. */
export const DECAL_LIFT = 0.006;
export const ROOF_LIFT = 0.02;
/** Most radial holes a roof draws (view/roofs.mjs MAX_HOLES). */
export const ROOF_HOLES = 4;

/* ================================================================ GLSL */

export const TILE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TILE_FRAG = HEAD + /* glsl */ `
uniform sampler2D uTileTex;
uniform vec3 uTileTint;
uniform float uTileAlpha;
uniform float uTileRoof;      // 0 a decal on the ground, 1 a roof
uniform float uTileGhost;     // GM only
uniform vec3 uGhostColor;
uniform float uRoofSeen;      // 0..1: how much of the roof the viewer has seen (its outline)
uniform float uRoofFade;      // the whole roof's alpha now (cutaway, FADE, the camera rule)
uniform float uRoofOpen;      // the tile's occluded alpha: what an opened part shows
uniform vec4 uRoofHoles[4];   // RADIAL: x, z, radius (cells); radius 0 = none
uniform vec2 uRoofHoleEnds[4]; // the capsule's other end, x, z: the head as the camera sees it
uniform float uRoofHoleK;     // 0..1 the holes fading in
uniform float uRoofVisionK;   // 0..1 VISION: open where the viewer sees right now
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  float vis = visionAt(vWorld.xz);
  if (uTileRoof > 0.5) vis = max(vis, uRoofSeen);
  if (vis <= 0.0) discard;
  vec4 tex = texture2D(uTileTex, vUv);
  float a = tex.a * uTileAlpha;
  if (uTileRoof > 0.5) {
    float f = uRoofFade;
    // RADIAL: a soft capsule over each of the viewer's figures under it, from
    // its feet to its head as the camera sees them (render/roofs.mjs projectHole);
    // the edge is a couple of device px (fwidth taken outside the loop's branches)
    float soft = max(length(fwidth(vWorld.xz)) * 1.5, 0.04);
    float hole = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 h = uRoofHoles[i];
      if (h.z <= 0.0) continue;
      vec2 ab = uRoofHoleEnds[i] - h.xy;
      float s = clamp(dot(vWorld.xz - h.xy, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
      float d = length(vWorld.xz - (h.xy + ab * s));
      hole = max(hole, 1.0 - smoothstep(h.z - soft, h.z, d));
    }
    f = mix(f, min(f, uRoofOpen), hole * uRoofHoleK);
    // VISION: where the viewer sees right now (an interior through its door)
    float now = uUseVision > 0.5 && visionAt(vWorld.xz) > 0.75 ? 1.0 : 0.0;
    f = mix(f, min(f, uRoofOpen), now * uRoofVisionK);
    a *= f;
  }
  if (a < 0.004) discard;
  if (uTileGhost > 0.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 4.0) > 1.5) discard;
  vec3 albedo = tex.rgb * uTileTint;
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 c;
  if (uTileRoof > 0.5) {
    // a roof is lit by the sky, never by the lights burning in the room under it
    c = shade(albedo, vWorld, n, 1.0, vec2(-1.0e4));
  } else {
    c = shade(albedo, vWorld, n, fieldAt(vWorld.xz).r, vWorld.xz);
  }
  c = heightGrade(c, vWorld.y);
  vec3 outc = dioFinish(c, vis, vWorld);
  if (uTileGhost > 0.5) outc = mix(outc, uGhostColor, 0.45);
  gl_FragColor = vec4(outc, a);
}
`;

/** Every tile program, for the check tool: name → { vertex, fragment }. */
export const TILES_PROGRAMS = Object.freeze({ tile: { vertex: TILE_VERT, fragment: TILE_FRAG } });

/* ================================================================ placement (pure) */

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * The scale Foundry's PrimarySpriteMesh#resize gives a texture of tw × th in a
 * box of w × h, before scaleX / scaleY.
 */
export function fitScale(fit, w, h, tw, th) {
  const fx = w / Math.max(1e-6, tw), fy = h / Math.max(1e-6, th);
  switch (fit) {
    case "cover": { const k = Math.max(fx, fy); return [k, k]; }
    case "contain": { const k = Math.min(fx, fy); return [k, k]; }
    case "width": return [fx, fx];
    case "height": return [fy, fy];
    default: return [fx, fy];
  }
}

/**
 * The four corners (px) where a tile's art lands, at texture corners
 * (u, v) = (0,0) (1,0) (1,1) (0,1), v = 0 the image's top. As PIXI draws the
 * sprite: (u − anchor) × texture size, scaled (fit × scaleX/Y; negative
 * mirrors), turned by `rotation` degrees (clockwise on the canvas), moved to
 * the anchor (x, y).
 */
export function tileQuad(s, tw = 1, th = 1) {
  const [fx, fy] = fitScale(s.fit, num(s.width), num(s.height), tw, th);
  const sx = fx * num(s.scaleX, 1), sy = fy * num(s.scaleY, 1);
  const a = (num(s.rotation) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const ax = num(s.anchorX, 0.5), ay = num(s.anchorY, 0.5);
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const lx = (u - ax) * tw * sx, ly = (v - ay) * th * sy;
    return [num(s.x) + lx * c - ly * sn, num(s.y) + lx * sn + ly * c];
  });
}

/**
 * The ground top (cells) under a point, taking the LOWER side where the point
 * sits on a sub-cell edge, so a draped decal sinks into a step rather than
 * hanging in front of it.
 */
export function groundUnder(terrain, x, z) {
  if (!terrain) return 0;
  const fx = x * SUB, fz = z * SUB, e = 1e-4;
  const sj = Math.floor(fx), si = Math.floor(fz);
  const js = Math.abs(fx - Math.round(fx)) < e ? [Math.round(fx) - 1, Math.round(fx)] : [sj];
  const is = Math.abs(fz - Math.round(fz)) < e ? [Math.round(fz) - 1, Math.round(fz)] : [si];
  let low = Infinity;
  for (const i of is) for (const j of js) if (terrain.inBounds(i, j)) low = Math.min(low, terrain.topAt(i, j));
  return Number.isFinite(low) ? low / 4 : 0;
}

/**
 * A decal's draped grid: positions (cells), uvs and indices over the quad
 * (px corners), every vertex at max(ground, elevation) + DECAL_LIFT. A quad over
 * flat ground collapses to one cell of grid.
 * @param {number[][]} quad   px, tileQuad order
 * @param {{size:number, elevY:number, terrain:object|null}} o
 */
export function drapeGrid(quad, { size, elevY = 0, terrain = null }) {
  const S = size || 100;
  const P = quad.map(([x, y]) => [x / S, y / S]);
  const lenU = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
  const lenV = Math.hypot(P[3][0] - P[0][0], P[3][1] - P[0][1]);
  let nu = Math.max(1, Math.min(DRAPE_MAX, Math.ceil(lenU * DRAPE_PER_CELL)));
  let nv = Math.max(1, Math.min(DRAPE_MAX, Math.ceil(lenV * DRAPE_PER_CELL)));
  const at = (u, v) => [
    P[0][0] + (P[1][0] - P[0][0]) * u + (P[3][0] - P[0][0]) * v,
    P[0][1] + (P[1][1] - P[0][1]) * u + (P[3][1] - P[0][1]) * v,
  ];
  const heightAt = (x, z) => Math.max(groundUnder(terrain, x, z), elevY) + DECAL_LIFT;
  // flat under the whole decal: two triangles do
  let flat = true, h0 = null;
  for (let j = 0; j <= nv && flat; j++) for (let i = 0; i <= nu; i++) {
    const [x, z] = at(i / nu, j / nv);
    const h = heightAt(x, z);
    if (h0 === null) h0 = h; else if (Math.abs(h - h0) > 1e-6) { flat = false; break; }
  }
  if (flat) { nu = 1; nv = 1; }
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3), uv = new Float32Array((nu + 1) * (nv + 1) * 2);
  let k = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const [x, z] = at(u, v);
    pos[k * 3] = x; pos[k * 3 + 1] = flat ? h0 : heightAt(x, z); pos[k * 3 + 2] = z;
    uv[k * 2] = u; uv[k * 2 + 1] = v;
    k++;
  }
  const idx = new (nu * nv * 6 > 65535 ? Uint32Array : Uint16Array)(nu * nv * 6);
  let n = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx[n++] = a; idx[n++] = c; idx[n++] = b;
    idx[n++] = b; idx[n++] = c; idx[n++] = d;
  }
  return { pos, uv, idx, nu, nv };
}

/** A roof plane over the quad at height y (cells). */
export function roofPlane(quad, { size, y }) {
  const S = size || 100;
  const pos = new Float32Array(12), uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  quad.forEach(([x, z], i) => { pos[i * 3] = x / S; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z / S; });
  return { pos, uv, idx: new Uint16Array([0, 3, 1, 1, 3, 2]) };
}

/* ================================================================ art */

const hasDom = () => typeof document !== "undefined" && typeof Image !== "undefined";

/** Can this drawable be uploaded to WebGL (not tainted)? */
function readableArt(img) {
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0, 1, 1);
    g.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

/** Load tile art once per URL, no larger than `max` on its long side. null when it cannot be used. */
function loadTileArt(url, max) {
  if (!url || !hasDom()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    if (!/^(data|blob):/i.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h || !readableArt(img)) { resolve(null); return; }
      if (Math.max(w, h) <= max) { resolve(img); return; }
      const k = max / Math.max(w, h);
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      try { cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); resolve(cv); } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const isVideoEl = (v) => typeof HTMLVideoElement !== "undefined" && v instanceof HTMLVideoElement;

/* ================================================================ the layer */

/** Material factory, for the check tool (every declared uniform present). */
export function tileMaterial(shared, { roof = false, ghostColor = null } = {}) {
  const m = new THREE.ShaderMaterial({
    name: roof ? "dio.tile.roof" : "dio.tile.ground",
    vertexShader: TILE_VERT,
    fragmentShader: TILE_FRAG,
    uniforms: {
      ...shared,
      uTileTex: { value: null },
      uTileTint: { value: new THREE.Vector3(1, 1, 1) },
      uTileAlpha: { value: 1 },
      uTileRoof: { value: roof ? 1 : 0 },
      uTileGhost: { value: 0 },
      uGhostColor: ghostColor ?? { value: new THREE.Vector3(...hexToRgbFloat(PALETTE.violet)) },
      uRoofSeen: { value: 0 },
      uRoofFade: { value: 1 },
      uRoofOpen: { value: 0 },
      uRoofHoles: { value: Array.from({ length: ROOF_HOLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uRoofHoleEnds: { value: Array.from({ length: ROOF_HOLES }, () => new THREE.Vector2(0, 0)) },
      uRoofHoleK: { value: 0 },
      uRoofVisionK: { value: 0 },
    },
    transparent: true,
    depthWrite: roof,
    side: THREE.DoubleSide,
  });
  if (!roof) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
  }
  return m;
}

export class TilesLayer {
  constructor(shared, onChange = null, { maxTexture = 4096 } = {}) {
    this.shared = shared;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.maxTexture = Math.max(256, Number(maxTexture) || 4096);
    this.group = new THREE.Group();
    this.group.name = "dio.tiles";
    this.casters = new THREE.Scene();
    this.casters.name = "dio.tiles.casters";
    this.castersDirty = false;
    this.maxY = 0;
    this.size = 100;
    this.terrain = null;
    /** id → entry */
    this.entries = new Map();
    /** url → { promise, texture, w, h, refs } */
    this.art = new Map();
    this.ghostColor = { value: new THREE.Vector3(...hexToRgbFloat(PALETTE.violet)) };
    this._c = new THREE.Color();
    this._landed = false;
    this._disposed = false;
    this._fader = null;
  }

  setGridSize(px) {
    const s = Number(px) > 0 ? Number(px) : 100;
    if (s === this.size) return;
    this.size = s;
    for (const e of this.entries.values()) this.place(e, true);
  }

  /** The drawn ground the decals lie on. */
  setTerrain(terrain) {
    this.terrain = terrain ?? null;
    for (const e of this.entries.values()) if (e.state.kind !== "roof") this.place(e, true);
    this.updateMaxY();
  }

  /** @param {object[]} states TileState[] */
  set(states) {
    if (this._disposed) return;
    const list = Array.isArray(states) ? states.filter((s) => s && s.id) : [];
    const want = new Map(list.map((s, i) => [s.id, { s, i }]));
    for (const [id, e] of this.entries) if (!want.has(id)) this.drop(id, e);
    for (const [id, { s, i }] of want) {
      let e = this.entries.get(id);
      if (!e || (e.state.kind === "roof") !== (s.kind === "roof")) {
        if (e) this.drop(id, e);
        e = this.create(s);
      }
      const art = (s.video ? "video" : s.src) || "";
      const prevArt = (e.state.video ? "video" : e.state.src) || "";
      e.state = s;
      e.order = i;
      if (e.artKey !== art || (s.video && e.videoEl !== s.video) || prevArt !== art) this.bindArt(e);
      this.look(e);
      this.place(e, false);
    }
    this.updateMaxY();
    if (this._fader) this.applyRoofs(this._fader);
    this.castersDirty = true;
  }

  create(s) {
    const roof = s.kind === "roof";
    const material = tileMaterial(this.shared, { roof, ghostColor: this.ghostColor });
    const geometry = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `dio.tile.${s.id}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = roof ? 15 : 0;
    this.group.add(mesh);
    const casterMat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false, transparent: false });
    const caster = new THREE.Mesh(geometry, casterMat);
    caster.frustumCulled = false;
    const e = { state: s, mesh, material, geometry, caster, casterMat, artKey: null, ref: null, video: null, videoEl: null, w: 0, h: 0, sig: "", order: 0, casting: false };
    this.entries.set(s.id, e);
    return e;
  }

  /** Point the entry at its art: a shared image texture by URL, or its own video texture. */
  bindArt(e) {
    this.releaseArt(e);
    const s = e.state;
    if (s.video && isVideoEl(s.video)) {
      e.artKey = "video";
      e.videoEl = s.video;
      if (!readableArt(s.video)) {
        console.warn("GLUniverse Suite | diorama: a video tile cannot be used in WebGL (cross-origin without CORS); it is left out.");
        return;
      }
      const t = new THREE.VideoTexture(s.video);
      t.flipY = false;
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      e.video = t;
      e.w = s.video.videoWidth || 1;
      e.h = s.video.videoHeight || 1;
      this.useTexture(e, t);
      return;
    }
    const url = s.src || "";
    e.artKey = url;
    if (!url) return;
    let a = this.art.get(url);
    if (!a) {
      a = { promise: null, texture: null, w: 0, h: 0, refs: 0 };
      a.promise = loadTileArt(url, this.maxTexture).then((img) => {
        if (this._disposed || !img) return a;
        const t = new THREE.Texture(img);
        t.flipY = false;
        t.colorSpace = THREE.NoColorSpace;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 4;
        t.needsUpdate = true;
        a.texture = t;
        a.w = img.naturalWidth || img.width || 1;
        a.h = img.naturalHeight || img.height || 1;
        return a;
      });
      this.art.set(url, a);
    }
    a.refs++;
    e.ref = a;
    if (a.texture) { e.w = a.w; e.h = a.h; this.useTexture(e, a.texture); return; }
    a.promise.then(() => {
      if (this._disposed || e.ref !== a || !a.texture) return;
      e.w = a.w; e.h = a.h;
      this.useTexture(e, a.texture);
      this.place(e, true);
      this.applyRoof(e);
      this.updateMaxY();
      this.castersDirty = true;
      this._landed = true;
      this.onChange?.();
    });
  }

  useTexture(e, t) {
    e.material.uniforms.uTileTex.value = t;
    e.casterMat.map = t;
    e.casterMat.needsUpdate = true;
  }

  releaseArt(e) {
    if (e.video) { e.video.dispose(); e.video = null; }
    e.videoEl = null;
    if (e.ref) {
      const a = e.ref;
      a.refs--;
      if (a.refs <= 0) {
        a.texture?.dispose();
        for (const [k, v] of this.art) if (v === a) this.art.delete(k);
      }
      e.ref = null;
    }
    e.material.uniforms.uTileTex.value = null;
    e.casterMat.map = null;
    e.w = e.h = 0;
  }

  /** Tint, alpha, ghost. */
  look(e) {
    const s = e.state, u = e.material.uniforms;
    this._c.setStyle(s.tint || "#ffffff", THREE.NoColorSpace);
    u.uTileTint.value.set(this._c.r, this._c.g, this._c.b);
    u.uTileAlpha.value = Math.max(0, Math.min(1, num(s.alpha, 1)));
    u.uTileGhost.value = s.ghost ? 1 : 0;
  }

  /** Build the entry's geometry, when what it depends on changed (or `force`). */
  place(e, force) {
    const s = e.state;
    const ready = !!e.material.uniforms.uTileTex.value;
    e.mesh.visible = ready;
    if (!ready) { this.setCasting(e, false); return; }
    const sig = [s.kind, s.x, s.y, s.width, s.height, s.anchorX, s.anchorY, s.rotation, s.scaleX, s.scaleY, s.fit, s.elevQ, s.roofQ, e.w, e.h, this.size].join("|");
    if (!force && sig === e.sig) return;
    e.sig = sig;
    const quad = tileQuad(s, e.w || 1, e.h || 1);
    const g = s.kind === "roof"
      ? roofPlane(quad, { size: this.size, y: num(s.roofQ) / 4 + ROOF_LIFT })
      : drapeGrid(quad, { size: this.size, elevY: num(s.elevQ) / 4, terrain: this.terrain });
    const geo = e.geometry;
    geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(g.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    e.topY = geo.boundingBox ? geo.boundingBox.max.y : 0;
    // within a kind, Foundry's order: a later tile draws over an earlier one
    e.mesh.renderOrder = (s.kind === "roof" ? 15 : 0) + Math.min(0.9, e.order * 1e-3);
    this.castersDirty = true;
  }

  updateMaxY() {
    let y = 0;
    for (const e of this.entries.values()) if (e.mesh.visible) y = Math.max(y, e.topY ?? 0);
    this.maxY = y;
  }

  setCasting(e, on) {
    if (on === e.casting) return;
    e.casting = on;
    if (on) this.casters.add(e.caster); else this.casters.remove(e.caster);
    this.castersDirty = true;
  }

  /** Every roof to what the fader shows now. */
  applyRoofs(fader) {
    this._fader = fader ?? null;
    for (const e of this.entries.values()) if (e.state.kind === "roof") this.applyRoof(e);
  }

  applyRoof(e) {
    const s = e.state, u = e.material.uniforms;
    if (s.kind !== "roof") return;
    const sh = this._fader?.shown?.(s.id) ?? null;
    // no word from the view yet: shut, and shown only where the ground itself is seen
    u.uRoofSeen.value = sh ? Math.max(0, Math.min(1, sh.seen)) : 0;
    u.uRoofFade.value = sh ? sh.alpha : 1;
    u.uRoofOpen.value = sh ? sh.open : num(s.occludedAlpha, 0);
    u.uRoofHoleK.value = sh ? sh.holeK : 0;
    u.uRoofVisionK.value = sh ? sh.visionK : 0;
    const holes = sh?.holes ?? [];
    for (let i = 0; i < ROOF_HOLES; i++) {
      const h = holes[i];
      u.uRoofHoles.value[i].set(h ? h.x : 0, h ? h.z : 0, h ? h.r : 0, 0);
      u.uRoofHoleEnds.value[i].set(h ? num(h.x2, h.x) : 0, h ? num(h.z2, h.z) : 0);
    }
    const opaque = sh ? sh.opaque : true;
    e.material.depthWrite = opaque;
    const casts = opaque && !s.ghost && e.mesh.visible && num(s.alpha, 1) >= 0.5;
    this.setCasting(e, casts);
  }

  /** A playing video tile asks for frames, unless tileVideo is shed. */
  animated(fx) {
    if (fx && fx.tileVideo === false) return false;
    for (const e of this.entries.values()) if (e.video && e.videoEl && !e.videoEl.paused) return true;
    return false;
  }

  frame(_t, _dt, fx) {
    const landed = this._landed;
    this._landed = false;
    return landed || this.animated(fx);
  }

  drop(id, e) {
    this.releaseArt(e);
    this.group.remove(e.mesh);
    if (e.casting) { this.casters.remove(e.caster); this.castersDirty = true; }
    e.geometry.dispose();
    e.material.dispose();
    e.casterMat.dispose();
    this.entries.delete(id);
  }

  dispose() {
    this._disposed = true;
    for (const [id, e] of [...this.entries]) this.drop(id, e);
    for (const a of this.art.values()) a.texture?.dispose();
    this.art.clear();
    this.group.clear();
    this.casters.clear();
  }
}
