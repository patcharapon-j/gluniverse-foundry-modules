import { ThemeManager } from './ThemeManager.js';
import { Surfaces } from '../../core/gl-surfaces.mjs';
import { Budget } from '../../core/budget.mjs';

/**
 * Stylised WebGL fire for the Campfire bottom bar.
 *
 * Cel-shaded, not simulated: discrete flame tongues with hard edges, each one
 * three flat bands (ember orange, amber, pale core) over a darker, taller back
 * row, with crisp diamond embers rising off it. Everything is laid out in CSS
 * pixels at a fixed pitch, so a tongue is the same shape on a 1280px screen and
 * on a 3440px one; the old noise field was scaled by the canvas aspect and
 * smeared sideways on anything wide. Edges are antialiased over one device
 * pixel and nothing is blurred: it should read as a clean graphic, like the
 * panels around it, not as smoke.
 *
 * Runs as a calm, sustained loop for the whole scene. The single canvas + GL
 * context is created lazily and re-parented into each freshly rendered bar, so
 * the context survives the overlay's innerHTML swaps. Colours come from the
 * suite palette via ThemeManager. Degrades to a no-op (leaving the CSS
 * fallback flames) when WebGL is unavailable.
 *
 * The context is a suite Surface (core/gl-surfaces.mjs): the registry pauses
 * the loop while the canvas is off screen (slid out, or its host detached by an
 * innerHTML swap) and, under a Performance policy, frees the context once the
 * fire has sat unused. A released fire keeps its canvas in the bar — blank, as a
 * lost context draws nothing — so the observer still has something to watch;
 * the next frame builds a fresh canvas and swaps it into the same spot.
 */

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform float u_time;
uniform vec2  u_res;       // drawing-buffer size (device px)
uniform float u_dpr;       // device px per CSS px
uniform float u_base;      // flame baseline as a 0..1 fraction from the bottom
uniform float u_intensity; // 0..1 — taller and livelier in the final stretch
uniform vec3  u_deep;      // back row
uniform vec3  u_mid;       // outer band
uniform vec3  u_amber;     // middle band
uniform vec3  u_hot;       // core + embers

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// A row of tongues at a fixed pitch. Returns, for the outer, middle and core
// bands, how far (CSS px) this point sits inside the nearest tongue: positive
// inside, negative outside, so coverage is one clamp away.
vec3 tongues(vec2 p, float pitch, float hMin, float hMax, float seed, float t) {
  vec3 v = vec3(-1000.0);
  float cell = floor(p.x / pitch);
  for (int k = -1; k <= 1; k++) {
    float i = cell + float(k);
    float r1 = hash1(i * 1.37 + seed);
    float r2 = hash1(i * 2.71 + seed * 3.1);
    float cx = (i + 0.5) * pitch + (r1 - 0.5) * pitch * 0.4;
    // Height breathes slowly per tongue, with a quicker flick on the tip.
    float h = mix(hMin, hMax, vnoise(i * 0.73 + t * (0.45 + 0.3 * r2) + seed));
    h *= 0.9 + 0.2 * vnoise(t * 2.6 + i * 5.3 + seed);
    // A fixed build per tongue, so the row has a few tall ones and some stubs
    // instead of an even picket.
    h *= 0.6 + 0.7 * hash1(i * 3.97 + seed * 1.7);
    float halfW = pitch * (0.5 + 0.18 * r2);
    float yn = clamp(p.y / h, 0.0, 1.0);
    // The tip leans; the root stays put.
    float lean = sin(t * 1.15 + r1 * 6.2831) * pitch * 0.24 * yn * yn;
    float d = abs(p.x - cx - lean);
    for (int b = 0; b < 3; b++) {
      float sh = b == 0 ? 1.0 : (b == 1 ? 0.64 : 0.34);   // band height
      float sw = b == 0 ? 1.0 : (b == 1 ? 0.6 : 0.3);     // band width
      float y = p.y / (h * sh);
      float w = halfW * sw * pow(max(1.0 - y, 0.0), 0.72);
      float inside = (y < 1.0 && p.y >= 0.0) ? w - d : -1000.0;
      if (b == 0) v.x = max(v.x, inside);
      else if (b == 1) v.y = max(v.y, inside);
      else v.z = max(v.z, inside);
    }
  }
  return v;
}

void main() {
  float t = u_time;
  vec2 px = gl_FragCoord.xy / u_dpr;               // CSS px
  float basePx = u_base * u_res.y / u_dpr;
  vec2 p = vec2(px.x, px.y - basePx);              // height above the bar

  if (p.y < 0.0) { gl_FragColor = vec4(0.0); return; }

  // Tallest possible back tongue: 64 × 1.1 × 1.3 × 1.15 ≈ 105px, inside OVERHANG_PX.
  float lift = 1.0 + 0.15 * u_intensity;
  float pace = t * (1.0 + 0.4 * u_intensity);
  // One device pixel of antialiasing on every edge.
  vec3 back = clamp(tongues(p, 62.0, 26.0 * lift, 64.0 * lift, 11.0, pace * 0.8) * u_dpr + 0.5, 0.0, 1.0);
  vec3 front = clamp(tongues(p + vec2(17.0, 0.0), 34.0, 14.0 * lift, 50.0 * lift, 3.0, pace) * u_dpr + 0.5, 0.0, 1.0);

  // Back row: one dark band cut by a fine scanline, so it reads as a panel
  // texture behind the bright row rather than as a second fire.
  float scan = mod(floor(px.y), 3.0) < 1.0 ? 0.72 : 1.0;
  vec3 col = u_deep * scan;
  float alpha = back.x;
  col = mix(col, mix(u_deep, u_mid, 0.45) * scan, back.y);

  // Front row: three flat bands.
  col = mix(col, u_mid, front.x);
  alpha = max(alpha, front.x);
  col = mix(col, u_amber, front.y);
  col = mix(col, u_hot, front.z);

  // Diamond embers: hard-edged, rising and drifting, one chance per cell.
  float ember = 0.0;
  float cell = floor(px.x / 46.0);
  for (int k = -1; k <= 1; k++) {
    float i = cell + float(k);
    float r = hash1(i * 4.13 + 1.7);
    float life = fract(t * (0.12 + 0.1 * r) + r * 7.0);
    vec2 e = vec2((i + 0.5) * 46.0 + sin(life * 6.0 + r * 20.0) * 7.0, life * 80.0 * lift);
    float size = 2.6 * (1.0 - 0.6 * life);
    vec2 q = abs(p - e);
    float c = clamp((size - (q.x + q.y)) * u_dpr + 0.5, 0.0, 1.0);
    ember = max(ember, c * step(0.45, r) * (1.0 - life) * smoothstep(0.0, 0.08, life));
  }
  col = mix(col, u_hot, ember);
  alpha = max(alpha, ember);

  // Premultiplied output.
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

// Pixels of flame allowed to rise above the bar's top edge (CSS px). Kept low
// so the fire stays a calm strip rather than towering over the bar. Must match
// the canvas `top` offset in stream-pacer.css.
const OVERHANG_PX = 110;

// A calm hearth does not need the display's refresh rate. 30fps is the ceiling;
// the rAF still fires every frame but returns before touching GL.
const FRAME_MS = 1000 / 30;

/** Release a context now rather than whenever the GC gets to it. */
function loseContext(gl) {
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* already gone */ }
}

export class CampfireWebGL {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this._raf = null;
    this._start = 0;
    this._lastDraw = 0;
    this._running = false;   // the scene wants fire
    this._paused = false;    // the surface registry's verdict (off screen, hidden)
    this._surface = null;
    this._released = false;  // context freed by the registry; rebuilt on next use
    this._supported = null;
    this._base = 0.3;
    this._dpr = 1;
    this._intensity = 0;       // eased toward target
    this._intensityTarget = 0; // 0 normal, 1 ending stretch
    this._onResize = () => this._resize();
    this._onVisibility = () => this._syncLoop();
    this._frame = Budget.measure('stream-pacer.campfire', now => this._loop(now));
  }

  isSupported() {
    if (this._supported !== null) return this._supported;
    try {
      const c = document.createElement('canvas');
      const probe = c.getContext('webgl') || c.getContext('experimental-webgl');
      this._supported = !!probe;
      // The probe is a real context; free it instead of leaving it for the GC.
      loseContext(probe);
    } catch (e) {
      this._supported = false;
    }
    return this._supported;
  }

  _ensureContext() {
    if (this.gl) return true;

    // After a release the old canvas still sits in the bar holding its lost
    // context (one canvas never yields a second context); take its place.
    const stale = this.canvas;
    const canvas = document.createElement('canvas');
    canvas.className = stale?.className || 'stream-pacer-campfire-webgl';
    this.canvas = canvas;

    const opts = { alpha: true, premultipliedAlpha: true, antialias: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) {
      this.canvas = stale;
      return false;
    }
    if (stale?.parentElement) stale.replaceWith(canvas);
    this._released = false;
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
      dpr: gl.getUniformLocation(program, 'u_dpr'),
      intensity: gl.getUniformLocation(program, 'u_intensity'),
      deep: gl.getUniformLocation(program, 'u_deep'),
      mid: gl.getUniformLocation(program, 'u_mid'),
      amber: gl.getUniformLocation(program, 'u_amber'),
      hot: gl.getUniformLocation(program, 'u_hot')
    };

    const colors = ThemeManager.getCampfireWebGLColors();
    gl.uniform3fv(this.uniforms.deep, colors.deep);
    gl.uniform3fv(this.uniforms.mid, colors.mid);
    gl.uniform3fv(this.uniforms.amber, colors.amber);
    gl.uniform3fv(this.uniforms.hot, colors.hot);

    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);

    // Pause while the bar is off screen (slid out, or its host detached by an
    // innerHTML swap) and resume the moment it is back. The registry owns that
    // observer, so it follows the canvas across a release and rebuild too.
    if (!this._surface) {
      this._surface = Surfaces.register({
        id: 'stream-pacer.campfire',
        element: () => this.canvas,
        pause: () => { this._paused = true; this._syncLoop(); },
        resume: () => { this._paused = false; this._resize(); this._syncLoop(); },
        release: () => this._releaseContext(),
        restore: () => this._restoreContext()
      });
    } else {
      this._surface.observe();
    }
    return true;
  }

  /** Free the GL context, keeping the scene state, the listeners (the loop
   *  still has to wake on a tab switch to rebuild) and the canvas slot in the
   *  bar, so the fire comes back exactly where it was. */
  _releaseContext() {
    if (!this.gl) return;
    loseContext(this.gl);
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this._released = true;
    this._syncLoop();
  }

  /** Rebuild after a release, called from the surface's `use()`. */
  _restoreContext() {
    if (this.gl || !this._released) return;
    if (!this._ensureContext()) return;
    this._resize();
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
    this._dpr = dpr;
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
    this._surface?.touch();
    if (!this._ensureContext()) return false;

    if (this.canvas.parentElement !== hostEl) hostEl.appendChild(this.canvas);
    this.canvas.classList.add('visible');
    // Defer the size read a frame so the canvas has been laid out in the bar.
    requestAnimationFrame(() => this._resize());

    if (!this._running) {
      this._running = true;
      this._start = performance.now();
      this._lastDraw = 0;
    }
    this._syncLoop();
    return true;
  }

  /** Toggle the hotter, taller "final stretch" flames. */
  setEnding(ending) {
    this._intensityTarget = ending ? 1 : 0;
  }

  /** Run the frame loop only while the fire is wanted AND can be seen. A
   *  released context still runs the loop: its first frame rebuilds it. */
  _syncLoop() {
    const live = this._running && !this._paused && !document.hidden && (!!this.gl || this._released);
    if (live && this._raf === null) {
      this._raf = requestAnimationFrame(this._frame);
    } else if (!live && this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  _loop(now) {
    this._raf = null;
    if (!this._running || (!this.gl && !this._released)) return;
    this._raf = requestAnimationFrame(this._frame);

    // 30fps ceiling. The 2ms slack keeps a 60Hz display on every other frame
    // rather than letting timer jitter push some draws a whole frame late.
    const since = now - this._lastDraw;
    if (since < FRAME_MS - 2) return;
    // Rebuilds a released context; false while nobody can see the fire.
    if (this._surface && !this._surface.use()) return;
    if (!this.gl) return;
    // Clamp so a resume after a pause does not snap the intensity ease.
    const dt = Math.min(since, 100) / 1000;
    this._lastDraw = now;

    const gl = this.gl;
    const elapsed = (now - this._start) / 1000;

    // Ease intensity toward its target so the ending boost ramps smoothly —
    // time-based, so the ramp takes as long at 30fps as it did at 60.
    const ease = 1 - Math.pow(1 - 0.04, dt * 60);
    this._intensity += (this._intensityTarget - this._intensity) * ease;

    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.time, elapsed);
    gl.uniform2f(this.uniforms.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.dpr, this._dpr);
    gl.uniform1f(this.uniforms.base, this._base);
    gl.uniform1f(this.uniforms.intensity, this._intensity);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  stop() {
    this._running = false;
    this._syncLoop();
    if (this.canvas) this.canvas.classList.remove('visible');
    this._intensity = 0;
    this._intensityTarget = 0;
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._surface?.dispose();
    this._surface = null;
    this._paused = false;
    this._released = false;
    loseContext(this.gl);
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.gl = null;
    this.program = null;
  }
}
