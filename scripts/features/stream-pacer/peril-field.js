// Stream Pacer — the Dire Peril field: the full-screen WebGL backdrop behind
// the splash.
//
// One procedural fragment shader paints the danger field: domain-warped plasma
// in the peril colours, a drifting hexagonal lattice, an impact shockwave on
// declare and a second slam ring on the title's impact, then scanlines,
// chromatic fringing, vignette and grain. The element sits one layer below the
// splash so its wash and lettering composite on top.
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
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.03;
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

void main(){
  // Aspect-corrected centred coords.
  vec2 uv = v_uv;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float dist = length(p);
  float t = u_time;

  // --- Plasma energy field (domain warped) ---
  vec2 q = p * 2.4;
  q += 0.35 * vec2(fbm(q + t * 0.18), fbm(q - t * 0.14));
  float energy = fbm(q + vec2(t * 0.12, -t * 0.09));
  energy = pow(energy, 1.4);

  // Colour bed: deep -> mid -> hot driven by energy + radial falloff.
  vec3 col = mix(u_deep, u_mid, smoothstep(0.25, 0.75, energy));
  col = mix(col, u_hot, smoothstep(0.62, 0.95, energy) * (0.5 + 0.5 * u_intensity));

  // Centre hot core.
  col += u_hot * smoothstep(0.55, 0.0, dist) * 0.35 * u_intensity;

  // --- Hexagonal tech lattice ---
  float scale = 11.0;
  vec2 huv = p * scale + vec2(0.0, t * 0.6);
  float edge = hexEdge(huv);
  float lattice = smoothstep(0.06, 0.0, edge);
  float scan = 0.5 + 0.5 * sin(p.y * 6.0 - t * 2.2);
  col += u_hot * lattice * (0.10 + 0.18 * scan) * (0.4 + 0.6 * u_intensity);

  // --- Impact shockwave ---
  float ringR = u_burst * 1.4;
  float ring = smoothstep(0.10, 0.0, abs(dist - ringR));
  col += (u_hot + u_mid) * ring * (1.0 - clamp(u_burst, 0.0, 1.0)) * 1.6;

  // Secondary slam ring synced to the title impact (~1.55s in).
  float t2 = clamp((t - 1.55) / 0.6, 0.0, 1.5);
  float ring2R = t2 * 1.25;
  float ring2 = smoothstep(0.08, 0.0, abs(dist - ring2R));
  col += (u_hot + u_mid) * ring2 * (1.0 - clamp(t2, 0.0, 1.0)) * 1.3;

  // --- Ambient pulse rings ---
  float pulse = sin(dist * 26.0 - t * 5.0);
  col += u_mid * smoothstep(0.6, 1.0, pulse) * 0.05 * u_intensity;

  // --- Chromatic fringe at the edges ---
  float fr = fbm(p * 3.0 + t * 0.5);
  col.r += fr * 0.06 * smoothstep(0.3, 0.9, dist);
  col.b += (1.0 - fr) * 0.05 * smoothstep(0.3, 0.9, dist);

  // --- Scanlines ---
  float sl = 0.92 + 0.08 * sin(uv.y * u_res.y * 1.6);
  col *= sl;

  // --- Vignette ---
  col *= smoothstep(1.25, 0.25, dist);

  // --- Film grain ---
  float grain = hash(uv * u_res + fract(t) * 91.7) - 0.5;
  col += grain * 0.05;

  // Overall energy lift from the envelope.
  col *= (0.55 + 0.65 * u_intensity);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

// Internal resolution. The field is soft noise under a translucent wash and
// the lettering, so it renders at half the device resolution and never more
// than MAX_EDGE_PX on its long edge, then the browser scales it up. A 4K
// display at full DPR would otherwise shade ~8M pixels a frame for a burst.
const RENDER_SCALE = 0.5;
const MAX_EDGE_PX = 1280;

/**
 * The field's colour bed, derived from the suite's peril crimson exactly as the
 * splash's `--sp-peril-*` tokens are: a deep bed, the crimson itself, and a hot
 * alert red pushed toward red-orange. 0..1 rgb arrays for the shader.
 */
export function perilFieldColors(peril = PALETTE.peril) {
  return {
    deep: hexToRgbFloat(darken(peril, 0.6)),
    mid: hexToRgbFloat(peril),
    hot: hexToRgbFloat(lighten(mix(peril, '#ff1e30', 0.5), 0.25))
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
