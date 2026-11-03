#!/usr/bin/env node
/**
 * Writes the hand-made Diorama Bundle fixture the check and the preview use:
 *
 *   node tools/diorama-bundle-fixture.mjs [--out=tests/fixtures/diorama-bundle]
 *
 * A small bundle to the v1 contract (docs/DIORAMA_BUNDLE.md), built without
 * Map Maker so the import can be held to the contract before a real export
 * exists: an 8×6-square pixel-art ground at 32 px, a textured crate and a
 * rune pillar with an emissive texture (both boxes, NEAREST samplers), and a
 * layout placing them. PNG and GLB are written by hand (zlib only), so the
 * files are plain to read back.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));

export const FIXTURE = Object.freeze({ gridPx: 32, squares: [8, 6] });

/* ------------------------------------------------------------------ PNG */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** An RGBA8 PNG from fn(x, y) → [r, g, b, a]. */
export function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* ------------------------------------------------------------------ GLB */

const NEAREST = 9728, CLAMP = 33071;

/**
 * A box w × h × d (model units = squares), base at y = 0, centred on x and z.
 * One texture atlas: the top face samples its upper half, the four sides its
 * lower half (top of each side at the atlas middle).
 */
function boxGeometry(w, h, d) {
  const x = w / 2, z = d / 2;
  const pos = [], nor = [], uv = [], idx = [];
  const face = (corners, n, uvs) => {
    const b = pos.length / 3;
    corners.forEach((c, k) => { pos.push(...c); nor.push(...n); uv.push(...uvs[k]); });
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const top = [[0, 0], [0, 0.5], [1, 0.5], [1, 0]];
  const side = [[0, 0.5], [0, 1], [1, 1], [1, 0.5]];
  // corners counter-clockwise seen from outside
  face([[-x, h, -z], [-x, h, z], [x, h, z], [x, h, -z]], [0, 1, 0], top);       // top: north edge at v 0
  face([[-x, h, z], [-x, 0, z], [x, 0, z], [x, h, z]], [0, 0, 1], side);        // south (+z)
  face([[x, h, -z], [x, 0, -z], [-x, 0, -z], [-x, h, -z]], [0, 0, -1], side);   // north (-z)
  face([[x, h, z], [x, 0, z], [x, 0, -z], [x, h, -z]], [1, 0, 0], side);        // east (+x)
  face([[-x, h, -z], [-x, 0, -z], [-x, 0, z], [-x, h, z]], [-1, 0, 0], side);   // west (-x)
  face([[-x, 0, z], [-x, 0, -z], [x, 0, -z], [x, 0, z]], [0, -1, 0], [[0, 0.5], [0, 0.5], [0, 0.5], [0, 0.5]]); // bottom
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

const pad4 = (b, fill = 0) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);

/** A one-mesh GLB: a textured box, optionally with an emissive texture. */
export function boxGlb({ w, h, d, albedo, emissive = null, name = "box" }) {
  const g = boxGeometry(w, h, d);
  const parts = [];
  const views = [];
  let offset = 0;
  const add = (buf, target) => {
    const b = pad4(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.byteLength, ...(target ? { target } : {}) });
    parts.push(b);
    offset += b.length;
    return views.length - 1;
  };
  const vPos = add(g.pos, 34962), vNor = add(g.nor, 34962), vUv = add(g.uv, 34962), vIdx = add(g.idx, 34963);
  const vAlb = add(albedo);
  const vEmi = emissive ? add(emissive) : null;
  const count = g.pos.length / 3;
  const min = [-w / 2, 0, -d / 2], max = [w / 2, h, d / 2];
  const images = [{ bufferView: vAlb, mimeType: "image/png" }];
  const textures = [{ sampler: 0, source: 0 }];
  if (vEmi !== null) { images.push({ bufferView: vEmi, mimeType: "image/png" }); textures.push({ sampler: 0, source: 1 }); }
  const material = {
    name: `${name}-mat`,
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
    ...(vEmi !== null ? { emissiveTexture: { index: 1 }, emissiveFactor: [1, 1, 1] } : {}),
  };
  const json = {
    asset: { version: "2.0", generator: "gluniverse diorama-bundle-fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [material],
    samplers: [{ magFilter: NEAREST, minFilter: NEAREST, wrapS: CLAMP, wrapT: CLAMP }],
    images, textures,
    accessors: [
      { bufferView: vPos, componentType: 5126, count, type: "VEC3", min, max },
      { bufferView: vNor, componentType: 5126, count, type: "VEC3" },
      { bufferView: vUv, componentType: 5126, count, type: "VEC2" },
      { bufferView: vIdx, componentType: 5123, count: g.idx.length, type: "SCALAR" },
    ],
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const bin = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  header.write("glTF", 0, "ascii"); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const ch = (type, data) => { const b = Buffer.alloc(8); b.writeUInt32LE(data.length, 0); b.writeUInt32LE(type, 4); return Buffer.concat([b, data]); };
  return Buffer.concat([header, ch(0x4e4f534a, jsonBuf), ch(0x004e4942, bin)]);
}

/* ------------------------------------------------------------------ the bundle */

const hash = (x, y, s = 0) => { let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };

/** Every file of the fixture bundle, path → bytes. */
export function fixtureFiles() {
  const { gridPx: G, squares: [C, R] } = FIXTURE;
  const W = C * G, H = R * G;
  // the ground: stone flags, a worn path along row 3, no props painted on it
  const ground = png(W, H, (x, y) => {
    const i = Math.floor(y / G), j = Math.floor(x / G);
    const px = x % 8, py = y % 8;
    const flag = (px === 0 || py === 0) ? 0.72 : 1;
    const tone = 0.9 + 0.1 * hash(Math.floor(x / 8), Math.floor(y / 8));
    const path = i === 3 ? [146, 120, 84] : [104, 110, 118];
    const k = flag * tone;
    const edge = (x % G === 0 || y % G === 0) ? 0.85 : 1;
    return path.map((v) => Math.round(v * k * edge));
  });
  // a crate: planks on top, slats on the sides (16 × 32 atlas)
  const crate = png(16, 32, (x, y) => {
    const top = y < 16;
    const ly = top ? y : y - 16;
    const rim = x === 0 || x === 15 || ly === 0 || ly === 15;
    if (rim) return [74, 46, 24];
    const plank = top ? (x % 5 === 0) : (ly % 5 === 0);
    const base = top ? [176, 128, 72] : [150, 104, 56];
    return plank ? base.map((v) => Math.round(v * 0.7)) : base;
  });
  // a rune pillar: grey stone, a glowing rune band on the sides
  const rune = (x, ly) => ly >= 4 && ly <= 9 && ((x + ly) % 4 === 0 || x === 7 || x === 8);
  const pillar = png(16, 32, (x, y) => {
    const top = y < 16, ly = top ? y : y - 16;
    const course = !top && ly % 4 === 0;
    const v = 120 + Math.round(24 * hash(x, y, 3));
    if (!top && rune(x, ly)) return [60, 90, 120];
    return course ? [v * 0.75, v * 0.75, v * 0.8].map(Math.round) : [v, v, v + 6];
  });
  const glow = png(16, 32, (x, y) => (y >= 16 && rune(x, y - 16) ? [90, 220, 255] : [0, 0, 0]));
  const manifest = { version: 1, name: "Fixture yard", gridPx: G, squares: [C, R], image: [W, H], ground: "ground.png", layout: "layout.json" };
  const layout = {
    format: "gluniverse-diorama-layout", version: 1, name: "Fixture yard",
    map: { cols: C, rows: R },
    palette: [{ name: "Floor", h: 0, kind: "floor", material: "stone", color: "#6e7680" }],
    ops: [],
    props: [
      { shape: "model", src: "props/crate.glb", x: 2.5, y: 1.5, rot: 0, w: 1, d: 1, h: 5, solid: true, label: "Crate" },
      { shape: "model", src: "props/rune-pillar.glb", x: 5.5, y: 4.5, rot: 30, w: 1, d: 1, h: 10, solid: true, label: "Rune pillar" },
    ],
  };
  return {
    "manifest.json": Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
    "layout.json": Buffer.from(JSON.stringify(layout, null, 2) + "\n"),
    "ground.png": ground,
    "props/crate.glb": boxGlb({ w: 1, h: 1, d: 1, albedo: crate, name: "crate" }),
    "props/rune-pillar.glb": boxGlb({ w: 1, h: 2, d: 1, albedo: pillar, emissive: glow, name: "rune-pillar" }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = outArg ? outArg.slice(6) : join(ROOT, "tests/fixtures/diorama-bundle");
  for (const [rel, bytes] of Object.entries(fixtureFiles())) {
    const file = join(out, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  console.log("wrote " + relative(ROOT, out).replaceAll("\\", "/"));
}
