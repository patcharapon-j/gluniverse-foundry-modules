/**
 * Diorama — custom models (.glb / .gltf) for the `model` prop. See
 * docs/DIORAMA_PROPS.md.
 *
 * A model is loaded once per src and cached for the session. What the props
 * layer draws is not the glTF scene but a MODEL: its meshes baked into the
 * model's own space (every node transform applied), grouped by base colour so
 * a model is a few draw calls however deep its scene graph, and stood on the
 * ground (its bounds' bottom at y = 0, centred on x and z):
 *
 *   { size: [x, y, z],                    native bounds, model units
 *     parts: [{ geometry,                 position, normal, uv (own units)
 *               color: [r, g, b],         base colour factor, display values
 *               map: THREE.Texture|null,  base colour map (NoColorSpace)
 *               emissive: [r, g, b],      emissive factor × strength, display values
 *               emissiveMap: THREE.Texture|null,  emissive map (NoColorSpace)
 *               alphaTest: number }] }    0, or the cutout threshold
 *
 * Every model is lit by the suite's own prop program (render/props-glsl.mjs
 * PROP_MODEL_*), never by its glTF material: one sun, the board's shadows,
 * fog and vision, the same as every other prop. Its emission (glTF
 * `emissiveFactor` × `emissiveTexture`) is added after the light, unshadowed,
 * so a glowing rune or screen reads in the dark.
 *
 * Pixel art stays crisp: a texture whose sampler magnifies with NEAREST (a Map
 * Maker Diorama Bundle's always do) also minifies with NEAREST and gets no
 * mipmaps, so its texels never blur into each other at any zoom.
 *
 * The loader is swappable (setModelLoader) so the check tool can drive this
 * under Node with a stub. The default imports the vendored GLTFLoader lazily,
 * so a board with no model never fetches it.
 *
 * PURE: no world reads.
 */

import * as THREE from "./three.mjs";

/** @typedef {{ size: number[], parts: { geometry: THREE.BufferGeometry, color: number[], map: THREE.Texture|null, emissive: number[], emissiveMap: THREE.Texture|null, alphaTest: number }[] }} Model */

/** src → { state: "loading"|"ready"|"failed", model, promise, waiters:Set } */
const cache = new Map();
/** srcs already warned about: a failure is reported once per session. */
const warned = new Set();

let custom = null;

/**
 * Replace the loader (tests, the preview). fn(src) → Promise<Model>; null puts
 * the glTF loader back. Clears the cache.
 */
export function setModelLoader(fn) {
  custom = typeof fn === "function" ? fn : null;
  for (const e of cache.values()) disposeModel(e.model);
  cache.clear();
  warned.clear();
}

/**
 * The cache entry for a src, loading it on first ask. `onReady` runs once when
 * it settles (loaded or failed), unless it already has.
 * @returns {{state:string, model:Model|null}}
 */
export function loadModel(src, onReady = null) {
  const key = String(src || "");
  let e = cache.get(key);
  if (!e) {
    e = { state: "loading", model: null, waiters: new Set() };
    cache.set(key, e);
    const run = key ? (custom ?? gltfModel)(key) : Promise.reject(new Error("no src"));
    e.promise = Promise.resolve(run).then((m) => {
      if (cache.get(key) !== e) return;
      if (!m?.parts?.length) throw new Error("the file holds no mesh");
      e.model = m;
      e.state = "ready";
    }).catch((err) => {
      if (cache.get(key) !== e) return;
      e.state = "failed";
      // a model with no file yet (just placed in the editor) is a placeholder, not a failure worth a warning
      if (key && !warned.has(key)) {
        warned.add(key);
        console.warn(`GLUniverse Suite | diorama: the model "${key}" could not be loaded; the GM sees a placeholder box.`, err?.message ?? err);
      }
    }).finally(() => {
      for (const f of e.waiters) { try { f(); } catch { /* a waiter's own failure is its own */ } }
      e.waiters.clear();
    });
  }
  if (onReady && e.state === "loading") e.waiters.add(onReady);
  return e;
}

/**
 * Let go of every cached model's GPU copies, keeping the models. A texture
 * holds a `dispose` listener from each renderer that uploaded it, and that
 * listener holds the renderer's GL context, so a cache that outlives a renderer
 * kept every closed view's context alive (issue #168). Disposing fires those
 * listeners, which unhook and free; the next renderer uploads again.
 */
export function releaseModelGpu() {
  for (const e of cache.values()) disposeModel(e.model);
}

function disposeModel(m) {
  for (const p of m?.parts ?? []) {
    p.geometry?.dispose();
    p.map?.dispose();
    p.emissiveMap?.dispose();
  }
}

/**
 * A texture as the props program samples it: display values (like the map
 * art and a card's image), and pixel art kept crisp. A sampler that magnifies
 * with NEAREST asks for hard texels, so it minifies with NEAREST too and gets
 * no mipmaps (a NEAREST_MIPMAP_* filter still blends whole levels together).
 * Exported for the check tool.
 */
export function prepareModelTexture(tex) {
  if (!tex) return tex;
  tex.colorSpace = THREE.NoColorSpace;
  if (tex.magFilter === THREE.NearestFilter) {
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 1;
  }
  tex.needsUpdate = true;
  return tex;
}

/* ================================================================ glTF */

let loaderModule = null;

/** Load a .glb / .gltf with the vendored GLTFLoader and bake it into a Model. */
async function gltfModel(src) {
  loaderModule ??= import("../../../vendor/three/addons/loaders/GLTFLoader.js");
  const { GLTFLoader } = await loaderModule;
  const gltf = await new GLTFLoader().loadAsync(src);
  return bakeScene(gltf.scene ?? gltf.scenes?.[0]);
}

/**
 * Bake a three scene (glTF or built in code) into a Model: every visible mesh
 * in the scene's own space, grouped by base colour, stood on y = 0.
 * Exported for the preview, which builds its sample model in code.
 */
export function bakeScene(root) {
  if (!root) return { size: [1, 1, 1], parts: [] };
  root.updateMatrixWorld(true);
  const groups = new Map();
  const col = new THREE.Color();
  const emi = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.visible === false) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const geos = Array.isArray(o.material) && o.geometry.groups.length ? splitGroups(o.geometry) : [o.geometry];
    geos.forEach((g, i) => {
      const m = mats[Array.isArray(o.material) ? (o.geometry.groups[i]?.materialIndex ?? i) : 0] ?? mats[0];
      const baked = bakeGeometry(g, o.matrixWorld);
      if (!baked) return;
      // glTF colour factors are linear; the props program works in display values
      col.copy(m?.color ?? col.set(1, 1, 1)).convertLinearToSRGB();
      const map = m?.map ?? null;
      const alphaTest = m?.alphaTest > 0 ? m.alphaTest : m?.transparent && map ? 0.5 : 0;
      // emission: factor × strength (KHR_materials_emissive_strength), display values like the colour
      const k = Number.isFinite(m?.emissiveIntensity) ? Math.max(0, m.emissiveIntensity) : 1;
      if (m?.emissive?.isColor) emi.copy(m.emissive).multiplyScalar(k).convertLinearToSRGB();
      else emi.setRGB(0, 0, 0);
      const glows = emi.r > 0 || emi.g > 0 || emi.b > 0;
      const emissive = glows ? [emi.r, emi.g, emi.b] : [0, 0, 0];
      const emissiveMap = glows ? (m?.emissiveMap ?? null) : null;
      const key = `${map?.uuid ?? "-"}|${col.getHexString()}|${alphaTest}|${emissiveMap?.uuid ?? "-"}|${emissive.map((v) => v.toFixed(4)).join(",")}`;
      let grp = groups.get(key);
      if (!grp) { grp = { color: [col.r, col.g, col.b], map, emissive, emissiveMap, alphaTest, list: [] }; groups.set(key, grp); }
      grp.list.push(baked);
    });
  });
  const parts = [];
  const box = new THREE.Box3();
  for (const g of groups.values()) {
    const geometry = joinBaked(g.list);
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
    prepareModelTexture(g.map);
    prepareModelTexture(g.emissiveMap);
    parts.push({ geometry, color: g.color, map: g.map, emissive: g.emissive, emissiveMap: g.emissiveMap, alphaTest: g.alphaTest });
  }
  if (box.isEmpty()) return { size: [1, 1, 1], parts: [] };
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geometry.translate(-cx, -box.min.y, -cz);
    p.geometry.computeBoundingSphere();
    p.geometry.computeBoundingBox();
  }
  const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map((v) => Math.max(v, 1e-4));
  return { size, parts };
}

function splitGroups(g) {
  const src = g.index ? g.toNonIndexed() : g;
  return g.groups.map((gr) => {
    const out = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes)) {
      const n = a.itemSize;
      out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gr.start * n, (gr.start + gr.count) * n), n));
    }
    return out;
  });
}

/** One mesh's geometry, non-indexed, in the scene's space: position, normal, uv. */
function bakeGeometry(g, matrix) {
  const f = g.index ? g.toNonIndexed() : g.clone();
  const pos = f.attributes.position;
  if (!pos || pos.count < 3) return null;
  if (!f.attributes.normal) f.computeVertexNormals();
  f.applyMatrix4(matrix);
  // a mirroring transform turns the faces inside out: wind them back
  if (matrix.determinant() < 0) {
    for (const a of Object.values(f.attributes)) {
      const n = a.itemSize, arr = a.array;
      for (let i = 0; i + 2 < a.count; i += 3) {
        for (let k = 0; k < n; k++) {
          const t = arr[(i + 1) * n + k];
          arr[(i + 1) * n + k] = arr[(i + 2) * n + k];
          arr[(i + 2) * n + k] = t;
        }
      }
    }
  }
  const count = f.attributes.position.count;
  const uv = f.attributes.uv ? toFloat(f.attributes.uv, 2) : new Float32Array(count * 2);
  return { pos: toFloat(f.attributes.position, 3), nor: toFloat(f.attributes.normal, 3), uv, count };
}

function toFloat(a, n) {
  if (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute) return a.array;
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = a.getComponent(i, k);
  return out;
}

function joinBaked(list) {
  let n = 0;
  for (const b of list) n += b.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const b of list) {
    pos.set(b.pos.subarray(0, b.count * 3), o * 3);
    nor.set(b.nor.subarray(0, b.count * 3), o * 3);
    uv.set(b.uv.subarray(0, b.count * 2), o * 2);
    o += b.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * The uniform scale a model is drawn at: `scale` cells per model unit when the
 * prop sets one, else the largest that fits the model inside w × d × h.
 */
export function modelScale(size, s) {
  if (s.scale > 0) return s.scale;
  const [x, y, z] = size;
  return Math.max(1e-4, Math.min(Math.max(0.01, s.w) / x, Math.max(0.01, s.h) / y, Math.max(0.01, s.d) / z));
}
