// Stream Pacer — the Dire Peril field: the full-screen WebGL backdrop behind
// the splash.
//
// One procedural fragment shader paints the danger field: domain-warped crimson
// plasma laced with thin hot filaments, light rays from the core and drifting
// embers, a hexagonal lattice drawn one render pixel wide, a hairline shock on
// declare that lights the lattice as it passes, a second slam ring and an
// anamorphic streak on the title's impact, then a filmic shoulder, a deep
// vignette and fine grain. The element sits one layer below the splash so its
// wash and lettering composite on top.
//
// The context is a suite Surface (core/gl-surfaces.mjs). A burst lasts a few
// seconds and the context then sits idle until the next declare, so under a
// Performance policy the registry frees it between bursts and `play()` builds
// it again exactly as it does the first time. The loop is wall-clock driven, so
// a paused frame only skips a frame and the burst still ends on time. Under
// load the field is the first thing shed (SHED_ORDER): the splash then plays
// as CSS alone, which carries its own shockwave ring for exactly that case.
//
// Reads no `game`: the preview page drives this file as shipped.

import { Surfaces } from '../../core/gl-surfaces.mjs';
import { Budget } from '../../core/budget.mjs';
import { PALETTE, lighten, darken, mix, hexToRgbFloat } from '../../core/theme.mjs';
import { PERIL_FIELD, SHED_ORDER, TIMING } from './const.js';

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2  u_res;
uniform float u_intensity; // sustained envelope 0..1
uniform float u_burst;     // impact ring progress 0..1 (offscreen at >1)
uniform vec3  u_deep;
uniform vec3  u_mid;
uniform vec3  u_hot;

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}

// Hexagonal tiling distance.
float hexDist(vec2 p){
  p = abs(p);
  float c = dot(p, normalize(vec2(1.0, 1.7320508)));
  return max(c, p.x);
}

float hexEdge(vec2 uv){
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return 0.5 - hexDist(gv);
}

// A ring of radius R and width w, split across the channels for a lens fringe.
vec3 fringeRing(float d, float R, float w, float split){
  return vec3(
    exp(-pow((d - R - split) / w, 2.0)),
    exp(-pow((d - R) / w, 2.0)),
    exp(-pow((d - R + split) / w, 2.0)));
}

// Seconds into the burst: the slam ring, and the streak with the title's flash.
const float SLAM = 1.55;
const float STREAK = 1.6;

void main(){
  // Aspect-corrected centred coords; one render pixel in those units.
  vec2 uv = v_uv;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float dist = length(p);
  float t = u_time;
  float px = 1.0 / u_res.y;

  // --- Plasma (domain warped) with thin hot filaments through it ---
  vec2 q = p * 1.7;
  q += 0.5 * vec2(fbm(q + t * 0.11), fbm(q.yx - t * 0.09));
  float energy = fbm(q + vec2(t * 0.07, -t * 0.05));
  float fil = 1.0 - abs(2.0 * fbm(q * 1.9 + vec2(-t * 0.06, t * 0.04)) - 1.0);
  fil = pow(fil, 7.0);

  // Colour bed: near black -> deep -> crimson, the filaments and core on top.
  vec3 col = mix(vec3(0.010, 0.002, 0.004), u_deep, smoothstep(0.12, 0.6, energy));
  col = mix(col, u_mid, smoothstep(0.58, 0.92, energy) * 0.9);
  col += u_hot * fil * 0.26 * (0.35 + 0.65 * u_intensity);
  col += u_mid * exp(-dist * dist * 3.2) * 0.85 * (0.35 + 0.65 * u_intensity);

  // --- Light rays from the core, and embers drifting up through them ---
  vec2 dir = p / max(dist, 1e-4);
  float rays = noise(dir * 4.0 + vec2(t * 0.25, 0.0)) * noise(dir * 11.0 - vec2(0.0, t * 0.18));
  rays = pow(rays, 1.6) * smoothstep(0.04, 0.45, dist) * exp(-dist * 1.5);
  col += u_hot * rays * 0.55 * (0.3 + 0.7 * u_intensity);

  vec2 g = p * 20.0 + vec2(t * 0.15, -t * 0.55);
  vec2 id = floor(g);
  vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float r = hash(id);
  float mote = (1.0 - smoothstep(0.0, 0.07, length(fract(g) - 0.5 - o * 0.7)))
    * step(0.88, r) * (0.45 + 0.55 * sin(t * 2.3 + r * 40.0));
  col += u_hot * vec3(1.0, 1.4, 1.2) * mote * 0.4 * smoothstep(0.1, 0.6, dist);

  // --- Hexagonal lattice, one render pixel wide at any size ---
  float sc = 13.0;
  float lattice = 1.0 - smoothstep(0.0, px * sc * 1.3, hexEdge(p * sc + vec2(0.0, t * 0.3)));
  float band = 0.5 + 0.5 * sin(p.y * 4.0 - t * 1.4);
  col += u_hot * lattice * 0.11 * smoothstep(1.2, 0.15, dist) * (0.45 + 0.55 * band) * (0.5 + 0.5 * u_intensity);

  // --- The declare: a hairline wavefront, a soft halo, the cells it lights ---
  float R = u_burst * 1.55;
  float fade = 1.0 - clamp(u_burst, 0.0, 1.0);
  col += fringeRing(dist, R, 0.006, 0.004) * vec3(1.0, 0.72, 0.74) * 1.5 * fade;
  col += u_hot * exp(-pow((dist - R) / 0.14, 2.0)) * 0.4 * fade;
  col += u_hot * lattice * smoothstep(R - 0.3, R, dist) * step(dist, R) * fade * 0.9;

  // --- The title's slam: a second ring ---
  float t2 = clamp((t - SLAM) / 0.55, 0.0, 1.5);
  float f2 = (1.0 - clamp(t2, 0.0, 1.0)) * step(0.001, t2);
  col += fringeRing(dist, t2 * 1.3, 0.005, 0.0035) * vec3(1.0, 0.7, 0.72) * 1.2 * f2;
  col += u_hot * exp(-pow((dist - t2 * 1.3) / 0.1, 2.0)) * 0.3 * f2;

  // --- An anamorphic streak across the centre on both hits ---
  float imp = exp(-max(t - 0.02, 0.0) * 3.2) + step(STREAK, t) * exp(-max(t - STREAK, 0.0) * 3.6);
  col += vec3(1.0, 0.62, 0.66) * exp(-abs(p.y) * 160.0) * exp(-abs(p.x) * 0.9) * imp * 1.1;
  col += u_hot * exp(-abs(p.y) * 22.0) * exp(-abs(p.x) * 1.4) * imp * 0.35;

  // --- Grade: lift with the envelope, roll the highlights off, vignette ---
  col *= 0.8 + 0.7 * u_intensity;
  col = col / (1.0 + col * 0.35);
  col *= smoothstep(1.5, 0.2, dist);
  col *= 0.95 + 0.05 * sin(uv.y * u_res.y * 3.14159);

  // --- Fine grain ---
  col += (hash(uv * u_res + fract(t) * 91.7) - 0.5) * 0.022;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

// Internal resolution. The plasma is soft, but the lattice and the rings are
// hairlines, so the field renders at three quarters of the device resolution
// and never more than MAX_EDGE_PX on its long edge, then the browser scales it
// up. A 4K display at full DPR would otherwise shade ~8M pixels a frame for a
// burst.
const RENDER_SCALE = 0.75;
const MAX_EDGE_PX = 1600;

/** The alert red the hot end of the bed leans toward. */
const ALERT_RED = '#ff1e30';

/**
 * The field's colour bed, derived from the suite's peril crimson: a deep bed,
 * a blood crimson pulled from the peril toward the alert red, and a hot red
 * almost at the alert red. 0..1 rgb arrays for the shader.
 */
export function perilFieldColors(peril = PALETTE.peril) {
  return {
    deep: hexToRgbFloat(darken(peril, 0.75)),
    mid: hexToRgbFloat(darken(mix(peril, ALERT_RED, 0.5), 0.22)),
    hot: hexToRgbFloat(lighten(mix(peril, ALERT_RED, 0.85), 0.12))
  };
}

/** Release a context now rather than whenever the GC gets to it. */
function loseContext(gl) {
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
}

export class PerilField {
  /** @param {{ parent?: HTMLElement }} [o] */
  constructor({ parent = document.body } = {}) {
    this.parent = parent;
    this.el = null;
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this._raf = null;
    this._start = 0;
    this._duration = 0;
    this._running = false;
    this._supported = null;
    this._surface = null;
    this._ladder = Budget.ladder('stream-pacer', SHED_ORDER);
    this._onResize = () => this._resize();
    this._frame = Budget.measure('stream-pacer.peril', () => this._loop());
  }

  isSupported() {
    if (this._supported !== null) return this._supported;
    try {
      const probe = document.createElement('canvas').getContext('webgl');
      this._supported = !!probe;
      // the probe is a real context; free it instead of leaving it to the GC
      loseContext(probe);
    } catch {
      this._supported = false;
    }
    return this._supported;
  }

  /** May the field draw now? It is the first thing the frame budget sheds. */
  get allowed() {
    return this._ladder.allows('perilField');
  }

  _ensureContext() {
    if (this.gl) return true;
    const el = document.createElement('canvas');
    el.className = 'sp-root sp-peril-gl';
    el.setAttribute('aria-hidden', 'true');
    this.parent.appendChild(el);
    this.el = el;

    const gl = el.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false });
    if (!gl) {
      el.remove();
      this.el = null;
      return false;
    }
    this.gl = gl;

    const program = this._buildProgram(gl, VERT, FRAG);
    if (!program) {
      this._dropContext();
      return false;
    }
    this.program = program;
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      time: gl.getUniformLocation(program, 'u_time'),
      res: gl.getUniformLocation(program, 'u_res'),
      intensity: gl.getUniformLocation(program, 'u_intensity'),
      burst: gl.getUniformLocation(program, 'u_burst'),
      deep: gl.getUniformLocation(program, 'u_deep'),
      mid: gl.getUniformLocation(program, 'u_mid'),
      hot: gl.getUniformLocation(program, 'u_hot')
    };
    const colors = perilFieldColors();
    gl.uniform3fv(this.uniforms.deep, colors.deep);
    gl.uniform3fv(this.uniforms.mid, colors.mid);
    gl.uniform3fv(this.uniforms.hot, colors.hot);

    this._resize();
    window.addEventListener('resize', this._onResize);

    if (!this._surface) {
      this._surface = Surfaces.register({
        id: 'stream-pacer.peril',
        element: () => this.el,
        pause: () => {
          if (this._raf) cancelAnimationFrame(this._raf);
          this._raf = null;
        },
        resume: () => {
          if (this._running && !this._raf) this._loop();
        },
        release: () => this._releaseContext(),
        // nothing to do eagerly: play() rebuilds through _ensureContext
        restore: () => {}
      });
    } else {
      this._surface.observe();
    }
    return true;
  }

  /** Free the context between bursts. Never mid-burst: the loop marks the
   *  surface used every frame, so an idle release cannot land on one. */
  _releaseContext() {
    if (this._running || !this.gl) return;
    this._dropContext();
  }

  _dropContext() {
    window.removeEventListener('resize', this._onResize);
    loseContext(this.gl);
    this.el?.remove();
    this.el = null;
    this.gl = null;
    this.program = null;
  }

  _buildProgram(gl, vsrc, fsrc) {
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('stream-pacer | peril field shader failed:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, vsrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('stream-pacer | peril field link failed:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  _resize() {
    if (!this.gl || !this.el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const scale = Math.min(dpr * RENDER_SCALE, MAX_EDGE_PX / Math.max(cssW, cssH, 1));
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    if (this.el.width !== w || this.el.height !== h) {
      this.el.width = w;
      this.el.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  /**
   * Run the field for `durationMs` (the splash's own, already tier-scaled).
   * Returns false when it will not draw: no WebGL, or shed under load.
   */
  play(durationMs) {
    if (!this.allowed || !this.isSupported()) return false;
    this._surface?.use();
    if (!this._ensureContext()) return false;
    this._duration = durationMs;
    this._start = performance.now();
    this.el.classList.add('is-visible');
    if (!this._running) {
      this._running = true;
      this._loop();
    }
    return true;
  }

  /**
   * Compile and draw the field once at idle, so the first Dire Peril of a
   * session does not pay the driver's deferred compile mid-reveal. The element
   * sits at opacity 0 until play() marks it visible. No-op once a context exists.
   */
  warm() {
    if (this.gl || !this.isSupported() || !this._ensureContext()) return;
    const gl = this.gl;
    gl.uniform1f(this.uniforms.time, 0);
    gl.uniform2f(this.uniforms.res, this.el.width, this.el.height);
    gl.uniform1f(this.uniforms.intensity, 1);
    gl.uniform1f(this.uniforms.burst, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
  }

  _loop() {
    if (!this._running || !this.gl) return;
    this._surface?.touch();
    const gl = this.gl;
    const ms = performance.now() - this._start;
    const elapsed = ms / 1000;

    // sustained envelope: a sharp spike at impact decaying to a steady plateau
    const intensity = Math.min(1, PERIL_FIELD.intensityFloor + (1 - PERIL_FIELD.intensityFloor) * Math.exp(-elapsed * PERIL_FIELD.intensityDecay));
    // the impact ring crosses the screen, then is pushed off it
    const burst = Math.min(elapsed / PERIL_FIELD.burst, PERIL_FIELD.burstMax);

    gl.uniform1f(this.uniforms.time, elapsed);
    gl.uniform2f(this.uniforms.res, this.el.width, this.el.height);
    gl.uniform1f(this.uniforms.intensity, intensity);
    gl.uniform1f(this.uniforms.burst, burst);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // the tail fade is the element's CSS opacity; the loop stops just past the stage
    if (ms >= this._duration - TIMING.perilFieldFade) this.el.classList.remove('is-visible');
    if (ms >= this._duration + TIMING.perilFieldTail) {
      this._running = false;
      this._raf = null;
      return;
    }
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this.el?.classList.remove('is-visible');
  }

  destroy() {
    this.stop();
    this._surface?.dispose();
    this._surface = null;
    this._ladder.dispose();
    this._dropContext();
  }
}
