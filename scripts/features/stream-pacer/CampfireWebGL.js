import { ThemeManager } from './ThemeManager.js';

/**
 * Premium WebGL fire for the Campfire bottom bar.
 *
 * Replaces the old masked-gradient "flame tongues" with a procedural fragment
 * shader: a domain-warped rising flame field anchored to the bar's top edge,
 * a hot glowing rim, drifting embers/sparks, and a warm under-glow that seeps
 * up behind the bar's text. Colors come from the campfire palette via
 * ThemeManager so the WebGL and CSS stay in sync.
 *
 * Unlike PerilWebGL (a timed cinematic burst) this runs as a calm, sustained
 * loop for the whole scene. The single canvas + GL context is created lazily
 * and re-parented into each freshly rendered bar, so the context survives the
 * overlay's innerHTML swaps instead of being rebuilt every reveal.
 *
 * Self-contained: owns its canvas, RAF loop, and resize wiring; degrades to a
 * no-op (leaving the CSS fallback flames) when WebGL is unavailable.
 */

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
uniform vec2  u_res;       // drawing-buffer size (px)
uniform float u_base;      // flame baseline as a 0..1 fraction from the bottom
uniform float u_intensity; // 0..1 warmth/height boost (lifts in the final stretch)
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
    p = p * 2.02 + vec2(7.1, 3.7);
    a *= 0.5;
  }
  return v;
}

// Ridged turbulence — stacked abs(noise) gives the sharp, wispy filaments that
// read as licking flame tongues rather than soft blobs.
float turb(vec2 p){
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 6; i++) {
    v += a * abs(noise(p) * 2.0 - 1.0);
    p = p * 2.0 + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return v;
}

// Blackbody-style ramp through the themed palette: dim ember -> deep -> mid ->
// hot -> a white-hot core at the densest, hottest part of the flame.
vec3 fireColor(float h, vec3 deep, vec3 mid, vec3 hot){
  vec3 c = mix(deep * 0.22, deep, smoothstep(0.0, 0.2, h));
  c = mix(c, mid, smoothstep(0.18, 0.5, h));
  c = mix(c, hot, smoothstep(0.48, 0.82, h));
  c = mix(c, vec3(1.0, 0.96, 0.86), smoothstep(0.85, 1.0, h));
  return c;
}

void main(){
  vec2 uv = v_uv;
  float t = u_time;
  float aspect = u_res.x / u_res.y;

  // Local flame coordinate: 0 at the baseline (bar top edge), 1 at canvas top.
  float span = max(1.0 - u_base, 0.001);
  float fy = (uv.y - u_base) / span;   // negative inside the bar
  float fx = uv.x;

  float boost = 0.4 + 0.35 * u_intensity;
  float h = clamp(fy, 0.0, 1.0);

  // --- Rising flame field ---
  // Slow, gently advected turbulence with balanced vertical detail so the
  // tongues read as flame rather than smearing into tall vertical streaks.
  // A soft, height-scaled sway lets them lean a touch without sliding sideways.
  float rise = t * (0.26 + 0.1 * boost);
  float sway = (fbm(vec2(uv.x * aspect * 1.6, fy * 2.0 - rise * 0.7)) - 0.5) * (0.05 + 0.16 * h);
  vec2 fp = vec2((uv.x * aspect + sway) * 3.2, fy * 3.0 - rise);
  float detail = turb(fp);

  // Flame body: turbulent detail eaten away with height; kept short and sparse
  // so the effect stays a calm hearth glow rather than a bonfire.
  float body = detail * (0.85 + 0.35 * boost) - fy * 1.5 + 0.04;
  float flame = smoothstep(0.0, 0.5, body) * step(0.0, fy);

  // Mostly warm amber, with only a soft highlight at the hottest base.
  float heat = clamp(flame * (0.55 + 0.4 * boost) * (1.0 - 0.4 * h), 0.0, 1.0);
  vec3 col = fireColor(heat, u_deep, u_mid, u_hot) * smoothstep(0.0, 0.05, flame);
  float alpha = smoothstep(0.02, 0.22, flame) * 0.7;

  // Soft warm rim hugging the baseline edge — the gentle glow of the coals.
  float edge = exp(-abs(fy) * 9.0) * step(-0.08, fy);
  col += mix(u_mid, u_hot, 0.5) * edge * (0.45 + 0.3 * boost);
  alpha += edge * 0.4;

  // Warm under-glow inside the bar (fy < 0): low, fading downward so the
  // text stays readable while the bar feels lit from its own fire.
  float belowT = clamp(-fy / 0.85, 0.0, 1.0);
  float glow = (1.0 - belowT) * step(fy, 0.0);
  col += u_deep * glow * 0.2 * boost;
  alpha += glow * 0.1 * boost;

  // --- Drifting embers / sparks (few, slow, dim) ---
  float sparks = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float seed = hash(vec2(fi, 7.0));
    float speed = 0.04 + seed * 0.07;             // very slow drift
    float life = fract(t * speed + seed);
    float baseX = hash(vec2(fi, 3.0));
    float sx = baseX + sin(life * 5.0 + seed * 30.0) * 0.03;
    float sy = u_base + life * (1.0 - u_base) * 1.05;
    vec2 dpx = (uv - vec2(sx, sy)) * u_res;
    float r = length(dpx);
    float br = smoothstep(2.0, 0.0, r) + smoothstep(5.5, 0.0, r) * 0.25;
    br *= (1.0 - life);                   // burn out as it climbs
    br *= smoothstep(0.0, 0.12, life);    // fade in at birth
    br *= 0.65 + 0.35 * sin(t * 3.5 + seed * 50.0); // slow twinkle
    sparks += br;
  }
  sparks = clamp(sparks, 0.0, 1.0);
  col += mix(vec3(1.0, 0.93, 0.78), u_hot, 0.5) * sparks * 0.6;
  alpha += sparks * 0.6;

  // Subtle, slow whole-field flicker.
  col *= 0.96 + 0.04 * sin(t * 2.2 + uv.x * 5.0);

  alpha = clamp(alpha, 0.0, 1.0);
  // Premultiplied-alpha output for clean glow compositing.
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

// Pixels of flame allowed to rise above the bar's top edge (CSS px). Kept low
// so the fire stays a calm strip rather than towering over the bar. Must match
// the canvas `top` offset in stream-pacer.css.
const OVERHANG_PX = 85;

export class CampfireWebGL {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this._raf = null;
    this._start = 0;
    this._running = false;
    this._supported = null;
    this._base = 0.3;
    this._intensity = 0;       // eased toward target
    this._intensityTarget = 0; // 0 normal, 1 ending stretch
    this._onResize = () => this._resize();
  }

  isSupported() {
    if (this._supported !== null) return this._supported;
    try {
      const c = document.createElement('canvas');
      this._supported = !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) {
      this._supported = false;
    }
    return this._supported;
  }

  _ensureContext() {
    if (this.gl) return true;

    const canvas = document.createElement('canvas');
    canvas.className = 'stream-pacer-campfire-webgl';
    this.canvas = canvas;

    const opts = { alpha: true, premultipliedAlpha: true, antialias: true };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) {
      this.canvas = null;
      return false;
    }
    this.gl = gl;

    const program = this._buildProgram(gl, VERT, FRAG);
    if (!program) {
      this.destroy();
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

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    gl.clearColor(0, 0, 0, 0);

    this.uniforms = {
      time: gl.getUniformLocation(program, 'u_time'),
      res: gl.getUniformLocation(program, 'u_res'),
      base: gl.getUniformLocation(program, 'u_base'),
      intensity: gl.getUniformLocation(program, 'u_intensity'),
      deep: gl.getUniformLocation(program, 'u_deep'),
      mid: gl.getUniformLocation(program, 'u_mid'),
      hot: gl.getUniformLocation(program, 'u_hot')
    };

    const colors = ThemeManager.getCampfireWebGLColors();
    gl.uniform3fv(this.uniforms.deep, colors.deep);
    gl.uniform3fv(this.uniforms.mid, colors.mid);
    gl.uniform3fv(this.uniforms.hot, colors.hot);

    window.addEventListener('resize', this._onResize);
    return true;
  }

  _buildProgram(gl, vsrc, fsrc) {
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('stream-pacer | campfire shader compile failed:', gl.getShaderInfoLog(s));
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
      console.error('stream-pacer | campfire program link failed:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  _resize() {
    if (!this.gl || !this.canvas) return;
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || OVERHANG_PX;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    // Flames originate at the bar's top edge; the overhang is the strip above it.
    this._base = Math.max(0, Math.min(0.95, 1 - OVERHANG_PX / cssH));
    this.gl.viewport(0, 0, w, h);
  }

  /**
   * Mount the fire inside the (freshly rendered) bar element and start the loop.
   * Re-parents the persistent canvas so the GL context survives bar re-renders.
   */
  mount(hostEl) {
    if (!this.isSupported() || !hostEl) return false;
    if (!this._ensureContext()) return false;

    if (this.canvas.parentElement !== hostEl) hostEl.appendChild(this.canvas);
    this.canvas.classList.add('visible');
    // Defer the size read a frame so the canvas has been laid out in the bar.
    requestAnimationFrame(() => this._resize());

    if (!this._running) {
      this._running = true;
      this._start = performance.now();
      this._loop();
    }
    return true;
  }

  /** Toggle the hotter, taller "final stretch" flames. */
  setEnding(ending) {
    this._intensityTarget = ending ? 1 : 0;
  }

  _loop() {
    if (!this._running || !this.gl) return;
    const gl = this.gl;
    const elapsed = (performance.now() - this._start) / 1000;

    // Ease intensity toward its target so the ending boost ramps smoothly.
    this._intensity += (this._intensityTarget - this._intensity) * 0.04;

    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.time, elapsed);
    gl.uniform2f(this.uniforms.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.base, this._base);
    gl.uniform1f(this.uniforms.intensity, this._intensity);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._raf = requestAnimationFrame(() => this._loop());
  }

  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this.canvas) this.canvas.classList.remove('visible');
    this._intensity = 0;
    this._intensityTarget = 0;
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.gl = null;
    this.program = null;
  }
}
