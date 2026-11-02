/**
 * Diorama — tactical lines: the line of sight between two creatures and the
 * drop off a ledge. Drawn over everything (depth test off), because a line
 * that disappears into the hill it runs through is exactly the information
 * the reader needs to see.
 *
 * Every width is DEVICE pixels, read from the drawing buffer as the mesh
 * draws (onBeforeRender), so a line is the same hairline at every zoom and on
 * every display. Dashes are measured along the line on screen, not in cells,
 * so they keep their rhythm on a foreshortened vertical drop.
 *
 * Shape (px / q, the contract's units), via setOverlays({ los, falls }):
 *   { id, a:{x,y,zQ}, b:{x,y,zQ}, color, strength?:0..1, cap?:boolean,
 *     pieces:[{t0, t1, style:"clear"|"blocked"|"beyond"|"drop"}] }
 *   clear    solid, the line's colour
 *   blocked  dashed: the stretch inside ground or a wall
 *   beyond   faint: clear again, but the sight never gets there
 *   drop     dashed, a fall from a lip to the ground below
 * Ends get a dot (the eye, the aim point); the first blocked stretch gets a
 * ring where it starts, so "this is where it stops" reads at a glance.
 *
 * PURE: plain state in, meshes out.
 */

import * as THREE from "./three.mjs";
import { PALETTE } from "../../../core/theme.mjs";
import { cssRgb } from "./materials.mjs";

/** Device px: the stroke's half width, the ink halo beyond it, and the dash. */
export const LINE_PX = Object.freeze({ half: 1.8, halo: 1.5, dash: 8, gap: 6, dot: 9, ring: 14 });
/** Piece styles, as the shader's aStyle. */
export const STYLE = Object.freeze({ clear: 0, blocked: 1, beyond: 2, drop: 3 });

export const TACTICS_VERT = /* glsl */ `
uniform vec2 uViewport;
uniform float uHalf;
uniform float uHalo;
attribute vec3 aA;
attribute vec3 aB;
attribute float aEnd;
attribute float aSide;
attribute vec4 aColor;
attribute float aStyle;
varying vec4 vColor;
varying float vStyle;
varying float vAlongPx;
varying float vSidePx;
void main() {
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
  vec2 sa = ca.xy / ca.w * uViewport, sb = cb.xy / cb.w * uViewport;
  vec2 d = sb - sa;
  float l = length(d);
  vec2 dir = l > 1e-4 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float w = uHalf + uHalo + 1.0;
  vec4 c = aEnd < 0.5 ? ca : cb;
  c.xy += n * aSide * w / uViewport * c.w;
  gl_Position = c;
  vColor = aColor;
  vStyle = aStyle;
  vAlongPx = aEnd * l;
  vSidePx = aSide * w;
}
`;

export const TACTICS_FRAG = /* glsl */ `
uniform float uHalf;
uniform float uHalo;
uniform float uDash;
uniform float uGap;
uniform vec3 uInk;
varying vec4 vColor;
varying float vStyle;
varying float vAlongPx;
varying float vSidePx;
void main() {
  float d = abs(vSidePx);
  float core = 1.0 - smoothstep(uHalf - 0.5, uHalf + 0.5, d);
  float halo = 1.0 - smoothstep(uHalf + uHalo - 0.5, uHalf + uHalo + 0.5, d);
  float a = vColor.a;
  bool dashed = vStyle > 0.5 && vStyle < 1.5 || vStyle > 2.5;
  if (dashed) {
    float p = mod(vAlongPx, uDash + uGap);
    float on = smoothstep(0.0, 1.0, p) * (1.0 - smoothstep(uDash - 1.0, uDash, p));
    core *= on;
    halo *= on;
  }
  if (vStyle > 1.5 && vStyle < 2.5) { a *= 0.42; halo *= 0.5; }
  vec3 col = mix(uInk, vColor.rgb, core);
  float alpha = max(core, halo * 0.6) * a;
  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export const MARK_VERT = /* glsl */ `
uniform float uScale;
attribute vec4 aColor;
attribute float aSize;
attribute float aRing;
varying vec4 vColor;
varying float vRing;
varying float vSize;
void main() {
  vColor = aColor;
  vRing = aRing;
  vSize = aSize * uScale;
  gl_PointSize = vSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const MARK_FRAG = /* glsl */ `
uniform vec3 uInk;
varying vec4 vColor;
varying float vRing;
varying float vSize;
void main() {
  float r = length(gl_PointCoord - 0.5) * vSize;
  float R = vSize * 0.5 - 1.0;
  float fill;
  if (vRing > 0.5) fill = (1.0 - smoothstep(R - 0.5, R + 0.5, r)) * smoothstep(R - 2.5, R - 1.5, r);
  else fill = 1.0 - smoothstep(R - 2.0, R - 1.0, r);
  float halo = 1.0 - smoothstep(R - 0.5, R + 0.5, r);
  vec3 col = mix(uInk, vColor.rgb, fill);
  float a = max(fill, halo * (vRing > 0.5 ? 0.0 : 0.65)) * vColor.a;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

/** Uniform names each program declares (the check holds them to the material). */
export function lineUniforms() {
  return {
    uViewport: { value: new THREE.Vector2(1, 1) },
    uHalf: { value: LINE_PX.half },
    uHalo: { value: LINE_PX.halo },
    uDash: { value: LINE_PX.dash },
    uGap: { value: LINE_PX.gap },
    uInk: { value: new THREE.Vector3(...cssRgb(PALETTE.ink0, "#02070b")) },
  };
}
export function markUniforms() {
  return {
    uScale: { value: 1 },
    uInk: { value: new THREE.Vector3(...cssRgb(PALETTE.ink0, "#02070b")) },
  };
}

const _buf = new THREE.Vector2();

/**
 * Line geometry, pure: one quad per piece.
 * @param {Array<object>} lines  the shape above
 * @param {number} size  grid size px
 * @returns {{aA:number[], aB:number[], aEnd:number[], aSide:number[], aColor:number[], aStyle:number[], index:number[],
 *   marks:Array<{x:number,y:number,z:number,color:number[],alpha:number,size:number,ring:boolean}>}}  cells (world units)
 */
export function buildLines(lines, size) {
  const out = { aA: [], aB: [], aEnd: [], aSide: [], aColor: [], aStyle: [], index: [], marks: [] };
  const S = size || 100;
  for (const l of lines ?? []) {
    if (!l?.a || !l?.b) continue;
    const A = [Number(l.a.x) / S, Number(l.a.zQ) / 4, Number(l.a.y) / S];
    const B = [Number(l.b.x) / S, Number(l.b.zQ) / 4, Number(l.b.y) / S];
    if (![...A, ...B].every(Number.isFinite)) continue;
    const at = (t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    const rgb = cssRgb(l.color ?? PALETTE.info, PALETTE.info);
    const alpha = Math.max(0, Math.min(1, Number(l.strength ?? 1)));
    const pieces = Array.isArray(l.pieces) && l.pieces.length ? l.pieces : [{ t0: 0, t1: 1, style: "clear" }];
    let firstBlock = null;
    for (const p of pieces) {
      const t0 = Math.max(0, Math.min(1, Number(p.t0))), t1 = Math.max(0, Math.min(1, Number(p.t1)));
      if (!(t1 > t0)) continue;
      const style = STYLE[p.style] ?? STYLE.clear;
      if (style === STYLE.blocked && firstBlock === null) firstBlock = t0;
      const P0 = at(t0), P1 = at(t1);
      const base = out.aEnd.length;
      for (const [end, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
        out.aA.push(...P0); out.aB.push(...P1);
        out.aEnd.push(end); out.aSide.push(side);
        out.aColor.push(rgb[0], rgb[1], rgb[2], alpha);
        out.aStyle.push(style);
      }
      out.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const dot = { color: rgb, alpha, size: LINE_PX.dot, ring: false };
    out.marks.push({ x: A[0], y: A[1], z: A[2], ...dot });
    if (!l.cap) out.marks.push({ x: B[0], y: B[1], z: B[2], ...dot });
    else out.marks.push({ x: B[0], y: B[1], z: B[2], ...dot, size: LINE_PX.ring, ring: true });
    if (firstBlock !== null) {
      const F = at(firstBlock);
      out.marks.push({ x: F[0], y: F[1], z: F[2], color: rgb, alpha, size: LINE_PX.ring, ring: true });
    }
  }
  return out;
}

/** The line meshes of one setOverlays call; the overlays layer owns and disposes them. */
export function tacticsMeshes(lines, size) {
  const b = buildLines(lines, size);
  const out = [];
  if (b.index.length) {
    const g = new THREE.BufferGeometry();
    const n = b.aEnd.length;
    // position is unused by the shader (aA/aB/aEnd place the vertex) but three wants one
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aA", new THREE.Float32BufferAttribute(b.aA, 3));
    g.setAttribute("aB", new THREE.Float32BufferAttribute(b.aB, 3));
    g.setAttribute("aEnd", new THREE.Float32BufferAttribute(b.aEnd, 1));
    g.setAttribute("aSide", new THREE.Float32BufferAttribute(b.aSide, 1));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(b.aColor, 4));
    g.setAttribute("aStyle", new THREE.Float32BufferAttribute(b.aStyle, 1));
    g.setIndex(b.index);
    const m = new THREE.ShaderMaterial({
      name: "dio.tactics.line",
      vertexShader: TACTICS_VERT,
      fragmentShader: TACTICS_FRAG,
      uniforms: lineUniforms(),
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    // the drawing buffer as it is when this draws (resize, render scale)
    mesh.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(_buf);
      m.uniforms.uViewport.value.set(_buf.x / 2, _buf.y / 2);
    };
    out.push(mesh);
  }
  if (b.marks.length) {
    const pos = [], col = [], sz = [], ring = [];
    for (const k of b.marks) { pos.push(k.x, k.y, k.z); col.push(...k.color, k.alpha); sz.push(k.size); ring.push(k.ring ? 1 : 0); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute("aSize", new THREE.Float32BufferAttribute(sz, 1));
    g.setAttribute("aRing", new THREE.Float32BufferAttribute(ring, 1));
    const m = new THREE.ShaderMaterial({
      name: "dio.tactics.mark",
      vertexShader: MARK_VERT,
      fragmentShader: MARK_FRAG,
      uniforms: markUniforms(),
      transparent: true, depthWrite: false, depthTest: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 41;
    out.push(pts);
  }
  return out;
}
