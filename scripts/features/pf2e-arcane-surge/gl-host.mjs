/**
 * GLUniverse Suite — Arcane Surge WebGL scaffolding.
 *
 * The ambient veil and the surge burst have completely different budgets and
 * lifetimes, but they stand up a context the same way: a full-viewport canvas on
 * `<body>`, one full-screen triangle, programs compiled with BOTH statuses
 * checked, and a DPR-capped resize. That part was duplicated near-verbatim
 * between them; it lives here now so a fix to the context handling cannot land
 * in one and miss the other.
 *
 * What is NOT here is anything either host does differently — the render loops,
 * the fade model, the baking, the pausing. Those are the parts that actually
 * differ, and folding them together would be worse than the duplication was.
 *
 * Every failure path is a clean no-op: no WebGL, a shader that will not compile,
 * a program that will not link. All three degrade to "no effect" rather than
 * throwing, because a cosmetic layer must never be able to take the session
 * down with it — which is also why a compile failure is LOGGED. It is otherwise
 * completely silent, and a silently missing overlay reads as a design choice.
 */

import { warn } from "../../core/const.mjs";

/** Cached across hosts: whether this browser can give us a context at all. */
let supported = null;

export function webglSupported() {
  if (supported !== null) return supported;
  try {
    const probe = document.createElement("canvas");
    supported = !!(probe.getContext("webgl") || probe.getContext("experimental-webgl"));
  } catch {
    supported = false;
  }
  return supported;
}

/**
 * Create a full-viewport canvas on `<body>` and its context.
 *
 * Returns `{ canvas, gl }`, or `null` when the context could not be had — in
 * which case the canvas is removed again rather than left as an invisible
 * element that does nothing.
 */
export function mountCanvas(className) {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  document.body.appendChild(canvas);

  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true })
    || canvas.getContext("experimental-webgl");
  if (!gl) {
    canvas.remove();
    return null;
  }

  // Both layers composite premultiplied output over whatever is beneath them.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return { canvas, gl };
}

/**
 * Compile and link, checking BOTH statuses.
 *
 * `label` names the program in any failure log — with two programs in the burst
 * alone, "shader compile failed" without one is not actionable.
 */
export function buildProgram(gl, vertexSource, fragmentSource, label) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      warn(`Arcane Surge | ${label} shader compile failed:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compile(gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    warn(`Arcane Surge | ${label} program link failed:`, gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/** Bind the one full-screen triangle every program here draws. */
export function bindFullscreenTriangle(gl, ...programs) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  for (const program of programs) {
    if (!program) continue;
    const loc = gl.getAttribLocation(program, "aPos");
    gl.useProgram(program);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
  return buffer;
}

/** Look up every uniform in `names` at once. */
export function uniformLocations(gl, program, names) {
  const out = {};
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}

/**
 * Size a canvas to the viewport.
 *
 * `scale` below 1 renders at a fraction of device pixels — the ambient veil is
 * soft and low-alpha with no hard edge in it, so half resolution is paid for
 * every frame of a whole session and reads identically. DPR is capped at 2
 * because a 3x phone display would triple the cost for no visible gain.
 */
export function sizeToViewport(canvas, gl, scale = 1) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
  const w = Math.max(1, Math.floor(window.innerWidth * dpr));
  const h = Math.max(1, Math.floor(window.innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl?.viewport(0, 0, w, h);
  return { w, h };
}
