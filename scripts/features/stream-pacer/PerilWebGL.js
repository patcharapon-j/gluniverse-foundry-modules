import { ThemeManager } from './ThemeManager.js';

/**
 * Full-screen WebGL backdrop for the Dire Peril reveal.
 *
 * A single procedural fragment shader paints a cinematic danger field —
 * domain-warped plasma in the themed peril colors, a drifting hexagonal tech
 * lattice (Endfield / Arknights flavor), an expanding impact shockwave on
 * declare, plus scanlines, chromatic fringing, vignette and film grain.
 *
 * The canvas sits just below the kinetic-typography stage (z 9998 vs 9999) so
 * the existing translucent wash and lettering composite on top of it. The
 * class is self-contained: it owns its canvas, manages its own RAF loop, and
 * degrades to a no-op (leaving the CSS fallback) when WebGL is unavailable.
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

// Hexagonal tiling distance (Martijn Steinrucken style).
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
  // Aspect-corrected centered coords.
  vec2 uv = v_uv;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float dist = length(p);
  float t = u_time;

  // --- Plasma energy field (domain warped) ---
  vec2 q = p * 2.4;
  q += 0.35 * vec2(fbm(q + t * 0.18), fbm(q - t * 0.14));
  float energy = fbm(q + vec2(t * 0.12, -t * 0.09));
  energy = pow(energy, 1.4);

  // Color bed: deep -> mid -> hot driven by energy + radial falloff.
  vec3 col = mix(u_deep, u_mid, smoothstep(0.25, 0.75, energy));
  col = mix(col, u_hot, smoothstep(0.62, 0.95, energy) * (0.5 + 0.5 * u_intensity));

  // Center hot core.
  col += u_hot * smoothstep(0.55, 0.0, dist) * 0.35 * u_intensity;

  // --- Hexagonal tech lattice ---
  float scale = 11.0;
  vec2 huv = p * scale + vec2(0.0, t * 0.6);
  float edge = hexEdge(huv);
  float lattice = smoothstep(0.06, 0.0, edge);          // thin glowing edges
  float scan = 0.5 + 0.5 * sin(p.y * 6.0 - t * 2.2);     // vertical sweep
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

export class PerilWebGL {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this._raf = null;
    this._start = 0;
    this._duration = 0;
    this._running = false;
    this._supported = null;
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
    canvas.className = 'stream-pacer-peril-webgl';
    document.body.appendChild(canvas);
    this.canvas = canvas;

    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl');
    if (!gl) {
      canvas.remove();
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

    this.uniforms = {
      time: gl.getUniformLocation(program, 'u_time'),
      res: gl.getUniformLocation(program, 'u_res'),
      intensity: gl.getUniformLocation(program, 'u_intensity'),
      burst: gl.getUniformLocation(program, 'u_burst'),
      deep: gl.getUniformLocation(program, 'u_deep'),
      mid: gl.getUniformLocation(program, 'u_mid'),
      hot: gl.getUniformLocation(program, 'u_hot')
    };

    this._resize();
    window.addEventListener('resize', this._onResize);
    return true;
  }

  _buildProgram(gl, vsrc, fsrc) {
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('stream-pacer | shader compile failed:', gl.getShaderInfoLog(s));
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
      console.error('stream-pacer | program link failed:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  _resize() {
    if (!this.gl || !this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  /**
   * Run the reveal effect for `durationMs`, fading in then out with the stage.
   */
  play(durationMs = 4200) {
    if (!this.isSupported()) return;
    if (!this._ensureContext()) return;

    this._duration = durationMs;
    this._start = performance.now();
    this.canvas.classList.add('visible');

    const colors = ThemeManager.getPerilWebGLColors();
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform3fv(this.uniforms.deep, colors.deep);
    gl.uniform3fv(this.uniforms.mid, colors.mid);
    gl.uniform3fv(this.uniforms.hot, colors.hot);

    if (!this._running) {
      this._running = true;
      this._loop();
    }
  }

  _loop() {
    if (!this._running || !this.gl) return;
    const gl = this.gl;
    const elapsed = (performance.now() - this._start) / 1000;
    const dur = this._duration / 1000;

    // Sustained envelope: sharp spike at impact decaying to a steady plateau.
    const intensity = Math.min(1, 0.45 + 0.55 * Math.exp(-elapsed * 2.2));
    // Expanding impact ring over the first ~0.9s.
    const burst = Math.min(elapsed / 0.9, 1.2);

    gl.uniform1f(this.uniforms.time, elapsed);
    gl.uniform2f(this.uniforms.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.intensity, intensity);
    gl.uniform1f(this.uniforms.burst, burst);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Tail fade handled by CSS opacity; auto-stop just past the stage end.
    if (elapsed * 1000 >= this._duration - 600) {
      this.canvas.classList.remove('visible');
    }
    if (elapsed * 1000 >= this._duration + 50) {
      this._running = false;
      this._raf = null;
      return;
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this.canvas) this.canvas.classList.remove('visible');
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
