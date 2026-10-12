/**
 * Stage — the WebGL2 renderer.
 *
 * Deliberately dumb: it owns a context, its programs and its textures, and draws
 * a FRAME — a plain object the director computes, with every position, every
 * amount and the resolved light already in it. Nothing here decides anything,
 * which is what lets the preview page drive this exact class with the exact
 * director the table runs.
 *
 * No `game`, no `canvas`, no Foundry. One context per instance.
 */

import { PROGRAMS, UNIFORMS } from "./shaders.mjs";

const ART_MAX = 2048;

export class StageGL {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.programs = {};
    this.report = "";
    this._arts = new Map();
    this._bgs = new Map();
    this._dpr = 1;
    this._view = { w: 1, h: 1 };
    this._onLost = (e) => { e.preventDefault(); this._lost = true; };
    canvas.addEventListener("webglcontextlost", this._onLost);
  }

  get ok() { return !!this.gl && !this._lost; }
  get lost() { return !!this._lost; }

  init() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: "high-performance",
    });
    if (!gl) { this.report = "no WebGL2"; return false; }
    this.gl = gl;
    this._lost = false;
    try {
      for (const [name, src] of Object.entries(PROGRAMS)) this.programs[name] = this._program(name, src.vs, src.fs);
    } catch (e) {
      this.report = String(e?.message ?? e);
      this.gl = null;
      return false;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this._quad = buf;
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // A 1×1 grey stands in for a missing env/bg so every sampler is bound.
    this._grey = this._texture({ data: new Uint8Array([46, 46, 50, 255]), width: 1, height: 1 }, { mip: false });
    this._black = this._texture({ data: new Uint8Array([0, 0, 0, 255]), width: 1, height: 1 }, { mip: false });
    this.report = "ok";
    return true;
  }

  _program(name, vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
    const loc = {};
    for (const u of UNIFORMS[name]) loc[u] = gl.getUniformLocation(p, u);
    return { p, loc };
  }

  /** @param {{data?: ArrayLike<number>, width: number, height: number}|TexImageSource} src */
  _texture(src, { mip = false } = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (src && "data" in src && src.data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        src.data instanceof Uint8Array ? src.data : Uint8Array.from(src.data));
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return t;
  }

  /** Largest size an art is uploaded at: past this a close-up gains nothing. */
  static get ART_MAX() { return ART_MAX; }

  setSize(cssW, cssH, dpr = 1) {
    this._view = { w: Math.max(1, cssW), h: Math.max(1, cssH) };
    this._dpr = Math.max(0.25, dpr);
    const w = Math.max(1, Math.round(cssW * this._dpr));
    const h = Math.max(1, Math.round(cssH * this._dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /**
   * Install a backdrop under `key`: the sharp picture (mipmapped) and the
   * maps `buildBackdrop` made from it. Two can be held at once so a change of
   * picture cross-fades.
   * @param {string} key
   * @param {object} maps  light/backdrop.mjs `buildBackdrop`
   * @param {TexImageSource} [image]  the sharp picture, ≤ ART_MAX; the mid level stands in without one
   */
  setBackdrop(key, maps, image = null) {
    if (!this.ok || !maps) return;
    this.dropBackdrop(key);
    this._bgs.set(key, {
      sharp: image ? this._texture(image, { mip: true }) : null,
      mid: this._texture(maps.mid),
      soft: this._texture(maps.soft),
      glow: this._texture(maps.glow),
      env: this._texture(maps.env),
    });
  }

  hasBackdrop(key) { return this._bgs.has(key); }

  dropBackdrop(key) {
    const b = this._bgs.get(key);
    if (!b || !this.gl) return;
    for (const t of Object.values(b)) if (t) this.gl.deleteTexture(t);
    this._bgs.delete(key);
  }

  /** Keys of every backdrop held. */
  backdropKeys() { return [...this._bgs.keys()]; }

  hasArt(key) { return this._arts.has(key); }

  /**
   * Upload one art and its shape field (light/shape.mjs `buildShape`).
   * @param {string} key
   * @param {TexImageSource} image  already scaled to ≤ ART_MAX
   * @param {{data: Uint8Array, width: number, height: number}} shape
   */
  setArt(key, image, shape) {
    if (!this.ok) return;
    this.dropArt(key);
    const h = image.naturalHeight || image.videoHeight || image.height || 1;
    this._arts.set(key, { tex: this._texture(image, { mip: true }), shape: this._texture(shape), h });
  }

  dropArt(key) {
    const a = this._arts.get(key);
    if (!a || !this.gl) return;
    this.gl.deleteTexture(a.tex);
    this.gl.deleteTexture(a.shape);
    this._arts.delete(key);
  }

  /** Free the context. A new canvas is needed to come back (a lost context stays lost). */
  release() {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this._onLost);
    if (gl) {
      for (const k of [...this._arts.keys()]) this.dropArt(k);
      for (const k of [...this._bgs.keys()]) this.dropBackdrop(k);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
    this._arts.clear();
    this._bgs.clear();
  }

  /* ── drawing ─────────────────────────────────────────────────────── */

  _bind(name) {
    const prog = this.programs[name];
    this.gl.useProgram(prog.p);
    return prog.loc;
  }

  _tex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex ?? this._grey);
    gl.uniform1i(loc, unit);
  }

  _quadDraw() { this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4); }

  /**
   * Draw one frame. See `director.mjs` for the frame's shape.
   * @returns {number} figures drawn
   */
  draw(frame) {
    if (!this.ok) return 0;
    const gl = this.gl;
    const dpr = this._dpr;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this._vao);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    const normal = () => gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    normal();
    const view = [frame.view.w, frame.view.h];
    const cam = [frame.camera.x, frame.camera.y, frame.camera.zoom];
    const r = frame.rig;

    // ── the room ──
    for (const b of frame.backdrops ?? []) {
      const set = this._bgs.get(b.key);
      if (!set || b.alpha <= 0.001) continue;
      const u = this._bind("backdrop");
      this._tex(0, set.sharp ?? set.mid, u.uSharp);
      this._tex(1, set.mid, u.uMid);
      this._tex(2, set.soft, u.uSoft);
      this._tex(3, set.glow, u.uGlow);
      gl.uniform4fv(u.uBgMap, b.map);
      gl.uniform1f(u.uAmount, b.alpha);
      gl.uniform1f(u.uBlur, frame.bg.blur);
      gl.uniform1f(u.uBloom, frame.bg.bloom);
      gl.uniform1f(u.uLevel, frame.bg.level);
      gl.uniform3fv(u.uTint, frame.bg.tint);
      gl.uniform1f(u.uHaze, frame.bg.haze);
      gl.uniform3fv(u.uHazeColor, frame.bg.hazeColor);
      this._quadDraw();
    }

    // Floor shade under the cast (the letterbox and vignette come last).
    if (frame.floor.amount > 0.001) {
      const u = this._bind("screen");
      gl.uniform2fv(u.uView, view);
      gl.uniform1f(u.uFloor, frame.floor.amount);
      gl.uniform3fv(u.uFloorColor, frame.floor.color);
      gl.uniform1f(u.uFloorTop, frame.floor.top);
      gl.uniform1f(u.uVignette, 0);
      gl.uniform1f(u.uBars, 0);
      this._quadDraw();
    }

    const figs = frame.figures.filter((f) => f.alpha > 0.002 && this._arts.has(f.key));

    // Shadows first, all of them: one figure's shadow never lands on another.
    if (r.shadow > 0.001 && frame.shadowAmount > 0.001) {
      const u = this._bind("shadow");
      gl.uniform2fv(u.uView, view);
      gl.uniform3fv(u.uCamera, cam);
      gl.uniform3fv(u.uShadowColor, r.shadowColor);
      gl.uniform1f(u.uShadow, r.shadow * frame.shadowAmount);
      for (const f of figs) {
        const art = this._arts.get(f.key);
        this._tex(0, art.shape, u.uShape);
        gl.uniform4fv(u.uFoot, f.foot);
        gl.uniform2fv(u.uThrow, f.throw);
        gl.uniform2fv(u.uPad, f.pad);
        gl.uniform1f(u.uFlipX, f.flip);
        gl.uniform2fv(u.uFootUV, f.footUV);
        gl.uniform1f(u.uAlpha, f.alpha);
        this._quadDraw();
      }
    }

    // Figures, back to front (the director sorts).
    if (figs.length) {
      const room = this._bgs.get(frame.envKey);
      const u = this._bind("figure");
      gl.uniform2fv(u.uView, view);
      gl.uniform3fv(u.uCamera, cam);
      gl.uniform4fv(u.uEnvMap, frame.envMap);
      this._tex(2, room?.env, u.uEnv);
      this._tex(3, room?.glow ?? this._black, u.uGlow);
      gl.uniform1f(u.uStrength, r.strength);
      gl.uniform1f(u.uLevel, r.level);
      gl.uniform1f(u.uShoulder, r.shoulder);
      gl.uniform1f(u.uContrast, r.contrast);
      gl.uniform1f(u.uSaturation, r.saturation);
      gl.uniform3fv(u.uTintShadow, r.tintShadow);
      gl.uniform3fv(u.uTint, r.tint);
      gl.uniform3fv(u.uTintHigh, r.tintHigh);
      gl.uniform3fv(u.uLift, r.lift);
      gl.uniform3fv(u.uSky, r.sky);
      gl.uniform3fv(u.uGround, r.ground);
      gl.uniform1f(u.uEnvAmt, room ? r.env : 0);
      gl.uniform1f(u.uRoomLum, frame.roomLum);
      gl.uniform3fv(u.uKeyDir, r.keyDir);
      gl.uniform3fv(u.uKeyColor, r.keyColor);
      gl.uniform1f(u.uKey, r.key);
      gl.uniform2fv(u.uRimPos, r.rimPos.flat());
      gl.uniform3fv(u.uRimColor, r.rimColor.flat());
      gl.uniform1fv(u.uRimPower, r.rimPower);
      gl.uniform1f(u.uStroke, r.stroke);
      gl.uniform3fv(u.uStrokeColor, r.strokeColor);
      gl.uniform1f(u.uStrokeFloor, r.strokeFloor);
      gl.uniform1f(u.uRimGlow, r.rimGlow);
      gl.uniform1f(u.uHalo, r.halo);
      gl.uniform3fv(u.uHaloColor, r.haloColor);
      gl.uniform1f(u.uDiffusion, r.diffusion);
      gl.uniform1f(u.uWrap, room ? r.wrap : 0);
      gl.uniform1f(u.uAO, r.ao);
      gl.uniform3fv(u.uHaze, r.haze);
      gl.uniform1f(u.uFlicker, frame.flicker);
      gl.uniform1f(u.uDebug, frame.debug ?? 0);
      gl.uniform1f(u.uStrokePx, frame.strokePx);
      for (const f of figs) {
        const art = this._arts.get(f.key);
        // The mip that matches the art's size on screen, and the one a
        // diffusion of ~1.2% of the screen's height reads.
        const shown = Math.max(1, f.artPx[1] * dpr);
        const baseLod = Math.max(0, Math.log2(art.h / shown));
        const diffLod = baseLod + Math.log2(Math.max(2, frame.view.h * dpr * 0.012));
        this._tex(0, art.tex, u.uArt);
        this._tex(1, art.shape, u.uShape);
        gl.uniform4fv(u.uRect, f.rect);
        gl.uniform4fv(u.uMotion, f.motion);
        gl.uniform1f(u.uFlipX, f.flip);
        gl.uniform2fv(u.uPad, f.pad);
        gl.uniform2fv(u.uShapeTexel, f.shapeTexel);
        gl.uniform1f(u.uBaseLod, baseLod);
        gl.uniform1f(u.uLod, f.lod);
        gl.uniform1f(u.uDiffLod, diffLod);
        gl.uniform2fv(u.uArtPx, f.artPx);
        gl.uniform1f(u.uAlpha, f.alpha);
        gl.uniform1f(u.uDim, f.dim);
        gl.uniform1f(u.uDepth, f.depth);
        gl.uniform1f(u.uLit, f.lit);
        this._quadDraw();
      }
    }

    // ── the veil: the room's bloom over everything (screen) ──
    // Colour is screened on; the destination's alpha is kept.
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
    const veils = frame.veils ?? [];
    veils.forEach((v) => {
      const set = this._bgs.get(v.key);
      if (!set || v.amount <= 0.001) return;
      const u = this._bind("veil");
      this._tex(0, set.glow, u.uGlow);
      gl.uniform4fv(u.uBgMap, v.map);
      gl.uniform1f(u.uGlowAmt, v.amount);
      this._quadDraw();
    });

    // ── grain: 2× modulate (src·dst + dst·src), alpha kept ──
    if (frame.grain > 0.001) {
      gl.blendFuncSeparate(gl.DST_COLOR, gl.SRC_COLOR, gl.ZERO, gl.ONE);
      const u = this._bind("grain");
      gl.uniform1f(u.uGrain, frame.grain);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uGrainPx, dpr);
      this._quadDraw();
    }
    normal();

    // Vignette and letterbox, over everything.
    if (frame.vignette > 0.001 || frame.bars > 0.0005) {
      const u = this._bind("screen");
      gl.uniform2fv(u.uView, view);
      gl.uniform1f(u.uFloor, 0);
      gl.uniform3fv(u.uFloorColor, [0, 0, 0]);
      gl.uniform1f(u.uFloorTop, 1);
      gl.uniform1f(u.uVignette, frame.vignette);
      gl.uniform1f(u.uBars, frame.bars);
      this._quadDraw();
    }
    return figs.length;
  }
}
