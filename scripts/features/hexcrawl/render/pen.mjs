/**
 * Hexcrawl renderer — MeshPen, a fast stand-in for PIXI.Graphics.
 *
 * The static layer draws ~7 shapes per hex over up to 2,400 hexes. PIXI's
 * Graphics allocates an object per sub-path, and round caps/joins multiply the
 * triangulated geometry ~20× (a glyph is 348 vertices with round joins, 18
 * without) — a full rebuild measured in the hundreds of milliseconds. MeshPen
 * implements exactly the Graphics subset the draw functions use (lineStyle,
 * beginFill/endFill, moveTo/lineTo/quadraticCurveTo, drawPolygon, drawCircle,
 * clear) and writes triangles straight into typed arrays, drawn as one
 * PIXI.Mesh with a four-line shader. The draw functions cannot tell the
 * difference, so one function still draws a hex at rest and in motion.
 *
 * Strokes are centred (PIXI's default alignment), joined with a clamped miter
 * (no overlap, so a translucent line never darkens at its corners), with round
 * caps where asked. Fills are fans: every filled shape here is convex.
 *
 * No filter, so no filter resolution. Pure: PIXI arrives by injection.
 */

const VERT = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec4 aColor;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec4 vColor;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vColor = aColor;
}`;
const FRAG = `
precision mediump float;
varying vec4 vColor;
uniform float uAlpha;
void main() { gl_FragColor = vColor * uAlpha; }`;

const MITER_LIMIT = 3;
const CAP_STEPS = 6;
const CIRCLE_STEPS = 18;
const CURVE_STEPS = 8;

class Grow {
  constructor(Type, n = 1024) { this.Type = Type; this.a = new Type(n); this.n = 0; }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new this.Type(len); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  view() { return this.a.subarray(0, this.n); }
}

export class MeshPen {
  /** `PIXI` null → a CPU-only pen (a stamp source), with no mesh behind it. */
  constructor(PIXI) {
    this.PIXI = PIXI;
    this.pos = new Grow(Float32Array);
    this.col = new Grow(Float32Array);
    this.idx = new Grow(Uint32Array);
    this.verts = 0;
    this._line = { width: 0, r: 0, g: 0, b: 0, a: 0, cap: "butt" };
    this._fill = null;
    this._path = null;
    this._dirty = true;
    this.mesh = null;
    if (!PIXI) return;
    const geometry = new PIXI.Geometry()
      .addAttribute("aVertexPosition", new PIXI.Buffer(new Float32Array(0), false, false), 2)
      .addAttribute("aColor", new PIXI.Buffer(new Float32Array(0), false, false), 4)
      .addIndex(new PIXI.Buffer(new Uint32Array(0), false, true));
    const shader = PIXI.Shader.from(VERT, FRAG, { uAlpha: 1 });
    shader.update = function update() { this.uniforms.uAlpha = this.alpha ?? 1; };
    this.mesh = new PIXI.Mesh(geometry, shader);
    this.mesh.visible = false;
  }

  /* ── Graphics subset ──────────────────────────────────────────────── */

  clear() {
    this.pos.n = 0; this.col.n = 0; this.idx.n = 0; this.verts = 0;
    this._path = null; this._fill = null;
    this._dirty = true;
    return this;
  }

  lineStyle(width = 0, color = 0, alpha = 1) {
    this._flushPath();
    let cap = "butt";
    if (typeof width === "object" && width) ({ width = 0, color = 0, alpha = 1, cap = "butt" } = width);
    const [r, g, b] = rgb(color);
    this._line = { width: Number(width) || 0, r, g, b, a: alpha ?? 1, cap };
    return this;
  }

  beginFill(color = 0, alpha = 1) {
    this._flushPath();
    const [r, g, b] = rgb(color);
    this._fill = { r, g, b, a: alpha ?? 1 };
    return this;
  }

  endFill() { this._flushPath(); this._fill = null; return this; }

  moveTo(x, y) { this._flushPath(); this._path = [x, y]; return this; }
  lineTo(x, y) { if (!this._path) this._path = [x, y]; else this._path.push(x, y); return this; }
  quadraticCurveTo(cx, cy, x, y) {
    const p = this._path; if (!p) return this.moveTo(x, y);
    const px = p[p.length - 2], py = p[p.length - 1];
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS, u = 1 - t;
      p.push(u * u * px + 2 * u * t * cx + t * t * x, u * u * py + 2 * u * t * cy + t * t * y);
    }
    return this;
  }

  drawPolygon(...args) {
    this._flushPath();
    const pts = Array.isArray(args[0]) ? args[0] : args[0]?.points ?? args;
    if (this._fill) this._fan(pts, this._fill);
    if (this._line.width > 0) this._stroke(pts, true);
    return this;
  }

  drawCircle(x, y, r) {
    this._flushPath();
    const pts = new Array(CIRCLE_STEPS * 2);
    for (let s = 0; s < CIRCLE_STEPS; s++) {
      const a = (s / CIRCLE_STEPS) * Math.PI * 2;
      pts[2 * s] = x + Math.cos(a) * r; pts[2 * s + 1] = y + Math.sin(a) * r;
    }
    if (this._fill) this._fan(pts, this._fill);
    if (this._line.width > 0) this._stroke(pts, true);
    return this;
  }

  /**
   * Append another pen's triangles translated by (dx, dy). A hex look drawn
   * once at the origin and stamped everywhere it recurs is a typed-array copy
   * instead of a tessellation.
   */
  stamp(src, dx, dy) {
    src._flushPath();
    const nv = src.verts;
    if (!nv) return this;
    this._flushPath();
    const base = this.verts;
    this.pos.reserve(nv * 2); this.col.reserve(nv * 4); this.idx.reserve(src.idx.n);
    const P = this.pos.a, SP = src.pos.a;
    let o = this.pos.n;
    for (let i = 0; i < nv * 2; i += 2) { P[o++] = SP[i] + dx; P[o++] = SP[i + 1] + dy; }
    this.pos.n = o;
    this.col.a.set(src.col.a.subarray(0, nv * 4), this.col.n);
    this.col.n += nv * 4;
    const I = this.idx.a, SI = src.idx.a;
    o = this.idx.n;
    for (let i = 0; i < src.idx.n; i++) I[o++] = SI[i] + base;
    this.idx.n = o;
    this.verts += nv;
    this._dirty = true;
    return this;
  }

  /** Push the accumulated triangles to the GPU buffers (called before render). */
  commit() {
    this._flushPath();
    if (!this._dirty) return this.mesh;
    this._dirty = false;
    const geo = this.mesh.geometry;
    geo.getBuffer("aVertexPosition").update(this.pos.view());
    geo.getBuffer("aColor").update(this.col.view());
    geo.getIndex().update(this.idx.view());
    this.mesh.visible = this.idx.n > 0;
    return this.mesh;
  }

  destroy() { this.mesh?.destroy(); }

  /* ── Tessellation ─────────────────────────────────────────────────── */

  _flushPath() {
    const p = this._path;
    this._path = null;
    if (!p || p.length < 4 || !(this._line.width > 0)) return;
    this._stroke(p, false);
  }

  _vert(x, y, c) {
    this.pos.reserve(2); this.col.reserve(4);
    const P = this.pos.a, C = this.col.a;
    P[this.pos.n++] = x; P[this.pos.n++] = y;
    // Premultiplied, as PIXI's normal blend expects.
    C[this.col.n++] = c.r * c.a; C[this.col.n++] = c.g * c.a; C[this.col.n++] = c.b * c.a; C[this.col.n++] = c.a;
    this._dirty = true;
    return this.verts++;
  }

  _tri(a, b, c) {
    this.idx.reserve(3);
    const I = this.idx.a;
    I[this.idx.n++] = a; I[this.idx.n++] = b; I[this.idx.n++] = c;
  }

  _fan(pts, c) {
    const n = pts.length >> 1;
    if (n < 3 || !(c.a > 0)) return;
    const base = this.verts;
    for (let i = 0; i < n; i++) this._vert(pts[2 * i], pts[2 * i + 1], c);
    for (let i = 1; i < n - 1; i++) this._tri(base, base + i, base + i + 1);
  }

  _stroke(raw, closed) {
    const L = this._line;
    if (!(L.a > 0)) return;
    // Drop zero-length steps (and a closing point equal to the first).
    const pts = [];
    for (let i = 0; i < raw.length; i += 2) {
      const x = raw[i], y = raw[i + 1], m = pts.length;
      if (m && Math.abs(pts[m - 2] - x) < 1e-6 && Math.abs(pts[m - 1] - y) < 1e-6) continue;
      pts.push(x, y);
    }
    let n = pts.length >> 1;
    if (closed && n > 2 && Math.abs(pts[0] - pts[2 * n - 2]) < 1e-6 && Math.abs(pts[1] - pts[2 * n - 1]) < 1e-6) { pts.length -= 2; n--; }
    if (n < 2) return;
    const hw = L.width / 2;
    const segN = (i) => { // unit normal of segment i → i+1
      const j = (i + 1) % n;
      const dx = pts[2 * j] - pts[2 * i], dy = pts[2 * j + 1] - pts[2 * i + 1];
      const l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    };
    const base = this.verts;
    for (let i = 0; i < n; i++) {
      let nx, ny, len = hw;
      const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
      if (hasPrev && hasNext) {
        const [ax, ay] = segN((i - 1 + n) % n), [bx, by] = segN(i);
        let mx = ax + bx, my = ay + by;
        const ml = Math.hypot(mx, my);
        if (ml < 1e-6) { mx = bx; my = by; } else { mx /= ml; my /= ml; }
        const cos = mx * bx + my * by;
        len = Math.min(hw * MITER_LIMIT, hw / Math.max(1e-3, cos));
        nx = mx; ny = my;
      } else {
        [nx, ny] = segN(hasNext ? i : i - 1);
      }
      const x = pts[2 * i], y = pts[2 * i + 1];
      this._vert(x + nx * len, y + ny * len, L);
      this._vert(x - nx * len, y - ny * len, L);
    }
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = base + 2 * i, b = base + 2 * ((i + 1) % n);
      this._tri(a, a + 1, b); this._tri(a + 1, b + 1, b);
    }
    if (!closed && L.cap === "round") {
      this._cap(pts[0], pts[1], ...segN(0), -1, hw, L);
      this._cap(pts[2 * n - 2], pts[2 * n - 1], ...segN(n - 2), 1, hw, L);
    }
  }

  /** Half-disc cap at (x,y); `dir` = +1 at the end, -1 at the start. */
  _cap(x, y, nx, ny, dir, hw, c) {
    const tx = ny * dir, ty = -nx * dir; // tangent pointing out of the line
    const centre = this._vert(x, y, c);
    let prev = this._vert(x + nx * hw, y + ny * hw, c);
    for (let s = 1; s <= CAP_STEPS; s++) {
      const a = (s / CAP_STEPS) * Math.PI;
      const cx = Math.cos(a), sx = Math.sin(a);
      const v = this._vert(x + (nx * cx + tx * sx) * hw, y + (ny * cx + ty * sx) * hw, c);
      this._tri(centre, prev, v);
      prev = v;
    }
  }
}

function rgb(c) {
  const n = Number(c) | 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
