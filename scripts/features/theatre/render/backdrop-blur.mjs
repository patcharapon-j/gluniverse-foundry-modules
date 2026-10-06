/**
 * Theatre — the backdrop's baked blur.
 *
 * The blurred picture around a fitted frame used to be a 13-tap golden-angle
 * disc read every frame at a deep mip. At the backdrop's radius that draws the
 * taps as ghost copies of every highlight and the deep mip as square steps.
 * The picture behind a backdrop is still between cuts, so it is blurred ONCE
 * per texture instead, with a dual-Kawase pyramid (each pass halves or doubles
 * the size and reads five or eight bilinear taps), into a small render texture
 * the backdrop shader then reads with a single tap. A video re-bakes at
 * `BAKE.videoMs`.
 *
 * Pure of the world: PIXI and the renderer are injected, nothing reads `game`
 * or `canvas`, so the preview page drives it as it is. Render textures store
 * their rows the way PIXI's own projection expects, so a pass drawn through a
 * PIXI mesh needs no flip of its own.
 */

/** Shapes of the bake (not durations, except the video re-bake interval). */
export const BAKE = Object.freeze({
  maxWidth: 1024,    // the source is read at most this wide; the result is half of it
  minLevels: 1,
  maxLevels: 6,
  minOffset: 0.5,    // the Kawase tap spread, in source texels of each level
  maxOffset: 2,
  videoMs: 100,      // a live video's backdrop re-bakes at most this often (real time)
});

/**
 * The pyramid for a blur radius of `radius` (a fraction of the image width) on
 * a source `width` px wide: how many levels and how far each pass spreads.
 * Dual Kawase reaches approximately 2^(levels+1) × offset base px.
 * @returns {{ base: number, levels: number, offset: number } | null}  null: no blur
 */
export function bakePlan(radius, width) {
  const base = Math.max(2, Math.min(BAKE.maxWidth, Number(width) || 0));
  const r = Math.max(0, Number(radius) || 0) * base;
  if (!(r >= 1)) return null;
  const levels = Math.max(BAKE.minLevels, Math.min(BAKE.maxLevels, Math.round(Math.log2(r / 2))));
  const offset = Math.max(BAKE.minOffset, Math.min(BAKE.maxOffset, r / 2 ** (levels + 1)));
  return { base, levels, offset };
}

const VERT = `
attribute vec2 aVertexPosition;
attribute vec2 aUv;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec4 uCrop;      // the source's frame inside its base texture (uv x, y, w, h)
uniform vec2 uStep;      // one tap spread, in source uv
vec3 s(vec2 uv) { return texture2D(uSrc, uCrop.xy + clamp(uv, 0.0, 1.0) * uCrop.zw).rgb; }
`;

/** Down: the centre and four diagonal half-texel taps. */
export const DOWN_FRAG = `${HEAD}
void main() {
  vec2 h = uStep;
  vec3 c = s(vUv) * 4.0 + s(vUv - h) + s(vUv + h) + s(vUv + vec2(h.x, -h.y)) + s(vUv + vec2(-h.x, h.y));
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

/** Up: four edge taps and four diagonal taps at twice their weight. */
export const UP_FRAG = `${HEAD}
void main() {
  vec2 h = uStep;
  vec3 c = s(vUv + vec2(-2.0 * h.x, 0.0)) + s(vUv + vec2(2.0 * h.x, 0.0))
         + s(vUv + vec2(0.0, -2.0 * h.y)) + s(vUv + vec2(0.0, 2.0 * h.y))
         + (s(vUv + vec2(-h.x, h.y)) + s(vUv + vec2(h.x, h.y))
          + s(vUv + vec2(h.x, -h.y)) + s(vUv + vec2(-h.x, -h.y))) * 2.0;
  gl_FragColor = vec4(c / 12.0, 1.0);
}`;

/** Every uniform both passes declare (the baker writes all of them). */
export const BAKE_UNIFORMS = Object.freeze(["uSrc", "uCrop", "uStep"]);

export class BackdropBaker {
  /** @param {typeof import("pixi.js")} PIXI */
  constructor(PIXI) {
    this.PIXI = PIXI;
    const g = new PIXI.Geometry();
    g.addAttribute("aVertexPosition", new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2);
    g.addAttribute("aUv", new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2);
    g.addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    const uniforms = () => ({
      uSrc: PIXI.Texture.EMPTY ?? PIXI.Texture.WHITE,
      uCrop: new Float32Array([0, 0, 1, 1]),
      uStep: new Float32Array(2),
    });
    this.down = new PIXI.Mesh(g, PIXI.Shader.from(VERT, DOWN_FRAG, uniforms()));
    this.up = new PIXI.Mesh(g, PIXI.Shader.from(VERT, UP_FRAG, uniforms()));
    this._geometry = g;
    this.failed = false;
  }

  /**
   * Blur `tex` (a PIXI.Texture) by `radius` (a fraction of its width) into
   * `prev`'s targets when they fit, else new ones.
   * @returns {{ texture, chain: any[], key: string } | null}  null: no blur wanted, or the bake failed
   */
  bake(renderer, tex, radius, prev = null) {
    if (this.failed || !renderer || !tex?.baseTexture) return null;
    const plan = bakePlan(radius, tex.width);
    if (!plan) return null;
    const aspect = (tex.height || 1) / (tex.width || 1);
    const key = `${plan.base}|${plan.levels}|${Math.round(aspect * 1000)}`;
    const chain = prev?.key === key ? prev.chain : this._chain(plan, aspect);
    if (prev && prev.chain !== chain) this.release(prev);
    try {
      const bt = tex.baseTexture, fr = tex.frame, bw = bt.width || 1, bh = bt.height || 1;
      let src = tex, crop = [fr.x / bw, fr.y / bh, fr.width / bw, fr.height / bh];
      // Down: each target reads the level above it (the first reads the source).
      for (const rt of chain) {
        this._pass(renderer, this.down, src, crop, rt, plan.offset / (src === tex ? rt.width * 2 : src.width), plan.offset / (src === tex ? rt.height * 2 : src.height));
        src = rt; crop = [0, 0, 1, 1];
      }
      // Up: back to the first level, each pass spreading by its source's texel.
      for (let i = chain.length - 2; i >= 0; i--) {
        const rt = chain[i];
        this._pass(renderer, this.up, src, crop, rt, plan.offset / src.width, plan.offset / src.height);
        src = rt;
      }
      return { texture: chain[0], chain, key };
    } catch (e) {
      this.failed = true;
      this.release({ chain });
      throw e;
    }
  }

  _chain({ base, levels }, aspect) {
    const PIXI = this.PIXI;
    const LINEAR = PIXI.SCALE_MODES?.LINEAR ?? 1;
    const chain = [];
    for (let i = 1; i <= levels; i++) {
      const w = Math.max(1, Math.round(base / 2 ** i));
      const h = Math.max(1, Math.round((base * aspect) / 2 ** i));
      chain.push(PIXI.RenderTexture.create({ width: w, height: h, resolution: 1, scaleMode: LINEAR }));
    }
    return chain;
  }

  _pass(renderer, mesh, src, crop, rt, sx, sy) {
    const u = mesh.shader.uniforms;
    u.uSrc = src;
    u.uCrop[0] = crop[0]; u.uCrop[1] = crop[1]; u.uCrop[2] = crop[2]; u.uCrop[3] = crop[3];
    u.uStep[0] = sx; u.uStep[1] = sy;
    mesh.scale.set(rt.width, rt.height);
    renderer.render(mesh, { renderTexture: rt, clear: true });
  }

  /** Free a bake's targets. */
  release(bake) {
    for (const rt of bake?.chain ?? []) { try { rt.destroy(true); } catch { /* gone */ } }
  }

  destroy() {
    try { this.down.destroy(); } catch { /* gone */ }
    try { this.up.destroy(); } catch { /* gone */ }
    try { this._geometry.destroy(); } catch { /* gone */ }
  }
}
