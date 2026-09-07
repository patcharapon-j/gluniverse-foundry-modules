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
 * Create a canvas and its context.
 *
 * Returns `{ canvas, gl }`, or `null` when the context could not be had — in
 * which case the canvas is removed again rather than left as an invisible
 * element that does nothing.
 *
 * `parent` is `<body>` for the full-screen beats. The stability cracks pass
 * `null` and attach it themselves: they live inside a HUD that rebuilds its own
 * DOM on every clock tick, so the canvas is created ONCE and re-parented into
 * each fresh chip. Re-parenting keeps the context; recreating it would compile
 * the program again every minute, which is the whole cost warming exists to pay
 * once.
 */
export function mountCanvas(className, parent = document.body) {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  parent?.appendChild(canvas);

  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true })
    || canvas.getContext("experimental-webgl");
  if (!gl) {
    canvas.remove();
    return null;
  }
  canvas.setAttribute("aria-hidden", "true");

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
 * A supersampled full-screen pass with an adaptive quality ladder.
 *
 * The live beats are full of thin, high-contrast detail — ring edges, spiral
 * arms, filaments — which is the worst case for aliasing. Rendering them
 * straight to the canvas crawls; rendering them larger and box-averaging down
 * does not. That is the same trick the initiative break splash uses, and it is
 * why both of these render through a scratch texture rather than direct.
 *
 * The ladder opens at 2× and steps down only when this machine has actually
 * missed two frames in a row, so a capable GPU never loses quality and a
 * struggling one recovers within a few frames of a beat that only lasts one or
 * two seconds. Full fidelity by default; degraded on evidence, never on
 * assumption.
 */
export const SS_LADDER = Object.freeze([2, 1.5, 1]);
/** Beyond this the scratch allocation stops being reasonable on mid-tier GPUs. */
const SS_MAX_EDGE = 2560;
/** A frame slower than this twice running costs one rung. */
const SS_SLOW_MS = 26;

export class SuperSampler {
  constructor(gl, blitProgram, blitUniforms) {
    this.gl = gl;
    this.blitProgram = blitProgram;
    this.blitUniforms = blitUniforms;
    this.texture = null;
    this.size = [0, 0];
    this.fbo = gl.createFramebuffer();
    this.rung = 0;
    this.slowFrames = 0;
  }

  /** Composition size before supersampling, clamped on the long edge. */
  baseSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.max(1, Math.round(window.innerWidth * dpr));
    let h = Math.max(1, Math.round(window.innerHeight * dpr));
    const longest = Math.max(w, h);
    if (longest > SS_MAX_EDGE) {
      const k = SS_MAX_EDGE / longest;
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }
    return [w, h];
  }

  /** Re-allocated only when the viewport or the rung actually changes. */
  ensure() {
    const gl = this.gl;
    const ss = SS_LADDER[this.rung];
    const [bw, bh] = this.baseSize();
    const w = Math.max(1, Math.round(bw * ss));
    const h = Math.max(1, Math.round(bh * ss));
    if (this.texture && this.size[0] === w && this.size[1] === h) return;

    if (this.texture) { try { gl.deleteTexture(this.texture); } catch { /* best-effort */ } }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // LINEAR is load-bearing: it is what makes the downsample an honest average
    // rather than a nearest-texel pick, which would alias exactly as badly as
    // rendering direct.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texture = tex;
    this.size = [w, h];
  }

  /** Bind the scratch as the render target. Returns false if it is incomplete. */
  bind() {
    const gl = this.gl;
    this.ensure();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return false;
    }
    gl.viewport(0, 0, this.size[0], this.size[1]);
    // The field writes premultiplied colour verbatim; blending belongs to the
    // blit, not to the render into the scratch.
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }

  /** Average the scratch down onto the canvas. */
  blit(canvas, opacity = 1) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.blitProgram);
    gl.enable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.blitUniforms.uFrame, 0);
    gl.uniform1f(this.blitUniforms.uOpacity, opacity);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Feed the frame time back in; two slow frames costs a rung. */
  sample(frameMs) {
    if (frameMs > SS_SLOW_MS) {
      if (++this.slowFrames >= 2 && this.rung < SS_LADDER.length - 1) {
        this.rung++;
        this.slowFrames = 0;
        this.ensure();
      }
    } else {
      this.slowFrames = 0;
    }
  }

  destroy() {
    const gl = this.gl;
    try { if (this.texture) gl.deleteTexture(this.texture); } catch { /* best-effort */ }
    try { if (this.fbo) gl.deleteFramebuffer(this.fbo); } catch { /* best-effort */ }
    this.texture = null;
    this.fbo = null;
  }
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

/**
 * Size a canvas to an element's box, plus a CSS-pixel `bleed` on every side.
 *
 * The bleed is what makes the cracks read as being AROUND the label rather than
 * as a texture inside a box: the fracture has to be allowed to leave the chip's
 * own rectangle, or its outermost shards are all clipped to the same four
 * straight lines and the whole thing reads as a filled panel.
 *
 * Returns `null` while the element has no layout — a HUD that is collapsed, on
 * a hidden tab, or not yet in the document. Drawing into a zero-sized canvas
 * costs a GL error per frame and shows nothing.
 */
export function sizeToElement(canvas, gl, element, bleed = 0) {
  const box = element?.getBoundingClientRect();
  if (!box || box.width <= 0 || box.height <= 0) return null;

  const cssW = box.width + bleed * 2;
  const cssH = box.height + bleed * 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  /* A canvas is a REPLACED element: with `inset` alone and an auto width the
     browser uses the intrinsic size from the width/height attributes — which
     are device pixels — and the strip renders at twice its box on any HiDPI
     display. The CSS size has to be stated. */
  canvas.style.inset = `${-bleed}px`;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  gl?.viewport(0, 0, w, h);
  return { w, h, cssW, cssH };
}
