/**
 * PF2e HUD — the rail's one light: the turn ignition and the lights going out.
 *
 * When the turn comes round a paper spark leaves the portrait and runs the
 * top edge of every plate, left to right; the rim it passes stays lit a
 * moment, sparks lift off it and ink smoke rises behind it, lit from below,
 * and the whole thing has gone within the cinematic beat and a half. When the
 * character goes down the same pass runs in red, heavier with smoke, and the
 * plates dim behind it (the CSS half, `is-going-down`); when they come back,
 * the ignition plays again. It is a moment, never a state: at rest the canvas
 * is clear, so it never tints a portrait (ADR 0013).
 *
 * One WebGL2 canvas, prepended to the `.gph` root after every render and kept
 * BEHIND `.gph-rail`: the plates are opaque, so the light shows only on and
 * above their edges, and the figure and the held cards, which stand up out of
 * the rail, stay in front of the smoke without any masking. The plate edges
 * are measured at the start of each play and handed to the shader as spans.
 *
 * Registered with `Surfaces` (paused off-screen, releasable), compiled in
 * idle time after the first attach so the turn never pays for it, shed first
 * through the shared budget (`SHED_ORDER`), and it claims motion only while
 * it plays. Hairlines are device pixels. Pure DOM and core: no `game`, so the
 * preview plays the shipped light.
 */
import { Surfaces } from "../../core/gl-surfaces.mjs";
import { Budget } from "../../core/budget.mjs";
import { INK_SIGNAL, cssVar, hexToRgbFloat, scaledMs } from "../../core/theme.mjs";
import { FEATURE_ID, SHED_ORDER } from "./const.mjs";

/** The pass lasts this many cinematic beats (`--gl-d-cinematic`, tier-scaled). */
export const LIGHT_SPAN = 1.6;
/** …of which the spark spends this fraction running the edge; the rest is afterglow. */
export const LIGHT_RUN = 0.45;
/** Plate edges the shader reads; the rail draws at most six. */
export const MAX_SEGS = 8;
/** The canvas never renders above this device-pixel ratio. */
const MAX_DPR = 2;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/* Everything is measured in device pixels from the canvas's own corner
   (gl_FragCoord), so a 1px rim is 1px on every display. */
const FRAG = `#version 300 es
precision highp float;
uniform float uDpr;
uniform float uT;      // 0..1 through the pass
uniform float uTime;   // seconds, for the smoke's drift
uniform float uOut;    // 0 ignition, 1 lights out
uniform float uX0;
uniform float uX1;
uniform vec4 uSeg[${MAX_SEGS}]; // x0, x1, rim y (gl coords), unused
uniform int uN;
uniform vec3 uLight;
uniform vec3 uInk;
out vec4 oColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }

void main() {
  vec2 px = gl_FragCoord.xy;
  float d = uDpr;
  float run = clamp(uT / ${LIGHT_RUN.toFixed(3)}, 0.0, 1.0);
  /* the spark leaves the portrait fast and slows as it reaches the far end */
  float front = mix(uX0, uX1, 1.0 - (1.0 - run) * (1.0 - run));
  float moving = 1.0 - smoothstep(0.85, 1.0, run);
  float fade = 1.0 - smoothstep(0.4, 1.0, uT);
  float behind = front - px.x;
  float passed = smoothstep(-2.0 * d, 2.0 * d, behind);
  float dx = px.x - front;
  float trail = passed * exp(-max(behind, 0.0) / (420.0 * d));
  float rimK = (passed * 0.12 + 0.9 * trail) * fade;
  float headK = moving * fade;

  /* the drifting fields, in screen space so they run on across the plates */
  vec2 q = vec2(px.x / (42.0 * d), px.y / (34.0 * d));
  q.y -= uTime * 0.75;
  q.x += 0.45 * sin(q.y * 1.5 + uTime * 0.8);
  float wisp = smoothstep(mix(0.5, 0.44, uOut), 0.78, fbm(q));
  float flick = 0.55 + 0.45 * noise(vec2(px.x / (18.0 * d), uTime * 2.0));
  vec2 g = vec2(px.x / (8.0 * d), (px.y - uTime * 52.0 * d) / (8.0 * d));
  vec2 id = floor(g);
  vec2 c = fract(g) - 0.5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
  float dot_ = (1.0 - smoothstep(0.08, 0.22, length(c))) * step(0.94, hash(id));
  float rise = clamp(behind / (240.0 * d), 0.0, 1.0);

  /* every plate edge lights what stands above it and falls off past its
     ends; the brightest edge wins, so there is no wall where two meet */
  float light = 0.0, smoke = 0.0, mote = 0.0, lit = 0.0;
  for (int i = 0; i < ${MAX_SEGS}; i++) {
    if (i >= uN) break;
    vec4 s = uSeg[i];
    float dy = px.y - s.z;
    if (dy < -d) continue;
    float up = max(dy, 0.0);
    float o = max(max(s.x - px.x, px.x - s.y), 0.0);
    float core = exp(-pow((dy - 0.5 * d) / (1.1 * d), 2.0));
    float bloom = exp(-up / (7.0 * d)) * 0.5 + exp(-up / (30.0 * d)) * 0.22;
    float head = exp(-pow(dx / (26.0 * d), 2.0)) + 0.55 * exp(-abs(dx) / (150.0 * d)) * exp(-pow(dy / (2.5 * d), 2.0));
    float flare = exp(-length(vec2(dx, dy - 2.0 * d)) / (11.0 * d)) * 0.9;
    float rimL = (max(head * 1.2 * headK, rimK) * (core + bloom) + flare * headK) * exp(-o / (9.0 * d));
    float curtain = trail * fade * exp(-up / (46.0 * d)) * flick * 0.32 * exp(-o / (36.0 * d + up * 0.6));
    light = max(light, rimL + curtain);
    float tall = (20.0 + 84.0 * rise) * d;
    smoke = max(smoke, passed * exp(-up / tall) * fade * exp(-o / (24.0 * d + up * 0.8)));
    mote = max(mote, passed * exp(-max(behind, 0.0) / (220.0 * d)) * exp(-up / (70.0 * d)) * fade * exp(-o / (20.0 * d + up)));
    lit = max(lit, exp(-up / (34.0 * d)) * (0.45 + 0.55 * trail) * exp(-o / (12.0 * d + up * 0.5)));
  }
  light *= mix(1.0, 0.85, uOut);
  mote *= dot_;
  float smokeA = wisp * smoke * mix(0.42, 0.62, uOut);
  vec3 smokeC = mix(uInk, uLight, mix(0.25, 0.85, lit) * mix(1.0, 0.6, uOut));
  vec3 col = uLight * (light + mote * 1.3) + smokeC * smokeA;
  float a = clamp(light + mote + smokeA, 0.0, 1.0);
  oColor = vec4(min(col, vec3(a)), a);
}`;

/** "dying" / "dead" while a player's own rail is down, else "". */
export const downOf = (m) => (m && m.role !== "gm" && (m.plinth?.dead || m.plinth?.dying) ? (m.plinth.dead ? "dead" : "dying") : "");

/** What a change of state plays: going down puts the lights out, coming
 *  back lights them again; dying to dead is still down and plays nothing. */
export const relight = (was, now) => (!was && now ? "out" : was && !now ? "in" : null);

const rgb = (el, name, fallback) => {
  const v = cssVar(name, "", el);
  return /^#[0-9a-f]{6}$/i.test(v) ? hexToRgbFloat(v) : hexToRgbFloat(fallback);
};

function loseContext(gl) {
  try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* already gone */ }
}

export class RailLight {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.u = null;
    this.raf = 0;
    this.playing = null;
    this.failed = false;
    this.ladder = Budget.ladder(FEATURE_ID, SHED_ORDER);
    this.surface = null;
  }

  /** Put the canvas back under a freshly drawn `.gph` root (a render replaces
   *  the rail's markup; the canvas node, and its context, survive the move). */
  attach(root) {
    if (!root || this.failed) return;
    if (!this.canvas) {
      const c = document.createElement("canvas");
      c.className = "gph-light";
      c.setAttribute("aria-hidden", "true");
      this.canvas = c;
      this.surface = Surfaces.register({
        id: `${FEATURE_ID}.light`,
        element: () => this.canvas,
        /* a render detaches the canvas for a moment and the observer reports it
           gone after it is back; only a canvas with no box now is hidden */
        pause: () => { const r = this.canvas?.isConnected ? this.canvas.getBoundingClientRect() : null; if (!r?.width) this.stop(); },
        release: () => this.drop(),
        holds: () => false,
      });
      const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
      idle(() => this.ensure());
    }
    if (this.canvas.parentNode !== root) root.prepend(this.canvas);
  }

  /** Build the context and the program; false where WebGL2 is unavailable. */
  ensure() {
    if (this.gl) return true;
    if (this.failed || !this.canvas) return false;
    const gl = this.canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) { this.failed = true; return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn("PF2e HUD | the rail light did not compile:", gl.getProgramInfoLog(p));
      loseContext(gl); this.failed = true; return false;
    }
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {};
    for (const n of ["uDpr", "uT", "uTime", "uOut", "uX0", "uX1", "uSeg", "uN", "uLight", "uInk"]) u[n] = gl.getUniformLocation(p, n);
    this.gl = gl; this.u = u;
    return true;
  }

  /** Play a pass over the rail under `root`: "in" (the ignition) or "out". */
  play(root, kind = "in") {
    if (!root || !this.canvas || document.hidden || root.hasAttribute("data-folded")) return false;
    if (!this.ladder.allows("light")) return false;
    this.surface?.use();
    if (!this.ensure()) return false;
    const c = this.canvas, box = c.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const dpr = Math.min(MAX_DPR, globalThis.devicePixelRatio || 1);
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }

    /* the plate edges, in canvas device pixels with y up */
    const segs = [], els = [];
    for (const el of root.querySelectorAll(".gph-plinth, .gph-turnbar, .gph-body > .gph-pl")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      segs.push([(r.left - box.left) * dpr, (r.right - box.left) * dpr, H - (r.top - box.top) * dpr, 0]);
      els.push(el);
      if (segs.length === MAX_SEGS) break;
    }
    if (!segs.length) return false;
    const x0 = Math.min(...segs.map((s) => s[0])), x1 = Math.max(...segs.map((s) => s[1]));
    const span = Math.max(1, scaledMs(1200, root) * LIGHT_SPAN);
    /* each plate's edge takes the light (and, going down, dims) the moment
       the spark reaches it: the inverse of the shader's ease-out */
    const X0 = x0 - 12 * dpr, X1 = x1 + 12 * dpr;
    els.forEach((el, i) => {
      const f = Math.max(0, Math.min(1, (segs[i][0] - X0) / (X1 - X0)));
      el.style.setProperty("--gph-lit-d", `${Math.round((1 - Math.sqrt(1 - f)) * LIGHT_RUN * span)}ms`);
    });

    const gl = this.gl, u = this.u;
    gl.viewport(0, 0, W, H);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uOut, kind === "out" ? 1 : 0);
    gl.uniform1f(u.uX0, X0);
    gl.uniform1f(u.uX1, X1);
    gl.uniform4fv(u.uSeg, new Float32Array(Array.from({ length: MAX_SEGS }, (_, i) => segs[i] ?? [0, 0, 0, 0]).flat()));
    gl.uniform1i(u.uN, segs.length);
    gl.uniform3fv(u.uLight, rgb(root, kind === "out" ? "--gph-red" : "--gph-paper", kind === "out" ? INK_SIGNAL.red : INK_SIGNAL.paper));
    gl.uniform3fv(u.uInk, rgb(root, "--gl-is-ink-0", INK_SIGNAL.ink0));

    this.stop();
    root.removeAttribute("data-light"); root.classList.remove("is-going-down"); void root.offsetWidth;
    root.dataset.light = kind;
    if (kind === "out") root.classList.add("is-going-down");
    this.span = span;
    const t0 = performance.now();
    this.playing = kind;
    Budget.claimMotion(`${FEATURE_ID}.light`, true);
    const frame = (now) => {
      const k = Math.min(1, (now - t0) / span);
      this.draw(k, (now - t0) / 1000);
      if (k < 1) this.raf = requestAnimationFrame(frame);
      else this.stop();
    };
    this.raf = requestAnimationFrame(frame);
    return true;
  }

  draw(k, seconds) {
    const gl = this.gl, u = this.u;
    if (!gl) return;
    this.surface?.use();
    gl.uniform1f(u.uT, k);
    gl.uniform1f(u.uTime, seconds);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Hold the pass at `k` (0..1) and keep the picture: for the preview's stills. */
  seek(k) {
    if (!this.playing) return;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.draw(Math.max(0, Math.min(1, k)), (k * (this.span ?? 1800)) / 1000);
  }

  /** End a pass and leave the canvas clear. */
  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.playing) {
      this.playing = null;
      Budget.claimMotion(`${FEATURE_ID}.light`, false);
      const gl = this.gl;
      if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      const root = this.canvas?.closest(".gph");
      root?.classList.remove("is-going-down");
      root?.removeAttribute("data-light");
    }
  }

  /** Free the context; the next play rebuilds it on a fresh canvas. */
  drop() {
    this.stop();
    loseContext(this.gl);
    this.gl = null; this.u = null;
    const old = this.canvas;
    if (old) {
      const c = document.createElement("canvas");
      c.className = old.className;
      c.setAttribute("aria-hidden", "true");
      old.replaceWith(c);
      this.canvas = c;
    }
  }

  dispose() {
    this.stop();
    loseContext(this.gl);
    this.gl = null; this.u = null;
    this.surface?.dispose();
    this.surface = null;
    this.canvas?.remove();
    this.canvas = null;
  }
}
