/**
 * Diorama — the environment layer: the light for the time of day, weather
 * particles, fog and air, lightning. Pure (no game/canvas/foundry): it draws
 * the resolved environment (environment.mjs resolveEnv) it is handed.
 *
 * Contract with renderer.mjs:
 *   new AtmosphereLayer(shared)
 *   .group
 *   .setGridSize(px)
 *   .setTerrain(terrain|null, mesh|null)    the ground under the weather
 *   .setEnvironment(env|null) → bool        resolved env; true when anything changed
 *   .animated(fx) → bool                    true while weather or air moves
 *   .frame(t, dt, camera, fx, view) → bool  per-frame uniforms; true while animating
 *   .dispose()
 *
 * What it writes:
 *   static (setEnvironment): the sun's direction (uKeyDir) and colour, the sky
 *     fill, bounce and sky colour, overcast, fog, haze, shafts, clouds, wetness,
 *     snow, mist, river flow, the weather particles' kind, tint and wind.
 *   per frame (frame): the env clock (a copy of the water clock), the user's
 *     graphics switches (uEnvFx, uEnvAtmo.w), the camera focus for haze, how
 *     many particles draw and in what box, rain on water, the lightning flash.
 *
 * Cost: weather is two instanced draws (particles, splashes) whose instances
 * carry only a seed; every position is computed in the vertex shader from that
 * seed and the clock, so frame() never loops over particles. Calm and clear
 * draws nothing and asks for no frames.
 */

import * as THREE from "./three.mjs";
import { MATERIALS } from "./materials.mjs";
import { VIEW_CELLS } from "./camera.mjs";
import { SUB, Q_PER_CELL, KIND } from "../constants.mjs";
import { resolveEnv, RAIN_KINDS } from "../environment.mjs";

/** Water surfaces sit this far below their sub-cell top (q; mirrors terrain-mesh). */
const WATER_SURFACE_Q = 0.3;

/** Particle kind (PARTICLE_VERT uKind) and most instances drawn, per weather kind. */
const KINDS = Object.freeze({
  rain: { id: 1, max: 4200 },
  storm: { id: 1, max: 5200 },
  snow: { id: 2, max: 2600 },
  blizzard: { id: 2, max: 4200 },
  leaves: { id: 3, max: 420 },
  petals: { id: 4, max: 520 },
  embers: { id: 5, max: 650 },
  ash: { id: 6, max: 1400 },
  sand: { id: 7, max: 2200 },
  fireflies: { id: 8, max: 140 },
});
const MAX_PARTICLES = Math.max(...Object.values(KINDS).map((k) => k.max));
const MAX_SPLASHES = 360;
/** Reduced weather (fx.weather 1) draws this share of the particles. */
const REDUCED = 1 / 3;

/** Lightning: seconds between strikes (never closer: no strobing), and the flash's peak. */
const LIGHTNING_GAP = [6, 18];
const LIGHTNING_PEAK = 0.55;
const LIGHTNING_LIFE = 0.85;

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** A small deterministic generator (the seeds and the strike schedule). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededGeometry(count, seed) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const r = rng(seed);
  const s = new Float32Array(count * 4);
  for (let i = 0; i < s.length; i++) s[i] = r();
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(s, 4));
  g.instanceCount = 0;
  return g;
}

function heightTexture(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export class AtmosphereLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.atmosphere";
    this.gridSize = 100;

    this._blankHeight = heightTexture(new Float32Array([-1000]), 1, 1);
    this.height = { value: this._blankHeight };
    this.heightInfo = { value: new THREE.Vector3(1, 1, SUB) };
    this.box = { min: { value: new THREE.Vector3() }, size: { value: new THREE.Vector3(1, 1, 1) }, scale: { value: 1 }, px: { value: 0.01 } };
    /** One device pixel in cells; the renderer writes it each frame (hairlines are device px). */
    this.pxWorld = 0.01;
    this.bounds = { cols: 0, rows: 0, minY: 0, maxY: 0, water: false };

    const refs = { height: this.height, heightInfo: this.heightInfo, box: this.box };
    this.pMat = MATERIALS.particles(shared, refs);
    this.sMat = MATERIALS.splash(shared, refs);
    this.pGeo = seededGeometry(MAX_PARTICLES, 0x5eed);
    this.sGeo = seededGeometry(MAX_SPLASHES, 0xd1a0);
    // Always in the scene so both programs compile with the first frame; with
    // no instances the draw is skipped.
    this.particles = new THREE.Mesh(this.pGeo, this.pMat);
    this.particles.name = "dio.weather";
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 30;
    this.splashes = new THREE.Mesh(this.sGeo, this.sMat);
    this.splashes.name = "dio.weather.splash";
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 29;
    this.group.add(this.splashes, this.particles);

    this.env = null;
    this._sig = "";
    this._kind = null;       // KINDS entry, or null for clear
    this._intensity = 0;
    this._rain = false;
    this._lightning = false;
    this._moving = false;    // clouds / fog / mist drift
    this._back = [1, 1, 1];
    this._sec = 0;
    this._next = 0;
    this._flashAt = -1;
    this._strikes = rng(0x7a11);
    this.setEnvironment(null);
  }

  setGridSize(px) {
    this.gridSize = px || 100;
  }

  /**
   * @param {import("../terrain/model.mjs").Terrain|null} terrain
   * @param {{minY:number, maxY:number}|null} mesh  terrain-mesh output
   */
  setTerrain(terrain, mesh) {
    if (this.height.value !== this._blankHeight) this.height.value.dispose();
    this.height.value = this._blankHeight;
    this.heightInfo.value.set(1, 1, SUB);
    this.bounds = { cols: 0, rows: 0, minY: 0, maxY: 0, water: false };
    if (!terrain?.sw || !terrain?.sh) return;
    const sw = terrain.sw, sh = terrain.sh;
    const data = new Float32Array(sw * sh);
    let water = false;
    for (let k = 0; k < sw * sh; k++) {
      const kind = terrain.kind[k] & 0x0f;
      if (kind === KIND.VOID) { data[k] = -1000; continue; }
      const w = kind === KIND.WATER;
      water ||= w;
      data[k] = (w ? terrain.h[k] - WATER_SURFACE_Q : terrain.h[k]) / Q_PER_CELL;
    }
    this.height.value = heightTexture(data, sw, sh);
    this.heightInfo.value.set(sw, sh, SUB);
    this.bounds = {
      cols: terrain.cols ?? sw / SUB, rows: terrain.rows ?? sh / SUB,
      minY: mesh?.minY ?? 0, maxY: mesh?.maxY ?? 0, water,
    };
  }

  /**
   * The resolved environment (null = neutral: today's look). Writes every
   * uniform that changes only with the environment.
   * @returns {boolean} whether anything changed
   */
  setEnvironment(env) {
    const E = env ?? resolveEnv(null, { dayNight: false });
    const sig = JSON.stringify(E);
    if (sig === this._sig) return false;
    this._sig = sig;
    this.env = E;
    const u = this.shared;
    u.uKeyDir.value.set(E.sun.dir[0], E.sun.dir[1], E.sun.dir[2]).normalize();
    u.uEnvKey.value.fromArray(E.sun.color);
    u.uEnvFill.value.fromArray(E.fill);
    u.uEnvBounce.value.fromArray(E.bounce);
    u.uEnvSky.value.fromArray(E.sky);
    u.uEnvOvercast.value = E.overcast;
    u.uEnvFog.value.set(E.fog.color[0], E.fog.color[1], E.fog.color[2], E.fog.density);
    u.uEnvAtmo.value.x = E.fog.height;
    u.uEnvAtmo.value.y = E.haze;
    u.uEnvAtmo.value.z = E.shafts;
    u.uEnvClouds.value.set(E.clouds.cover, E.clouds.speed, E.wind.x, E.wind.z);
    u.uEnvSurface.value.set(E.wetness, E.snow, E.mist, 0);
    u.uEnvFlow.value.x = E.water.x;
    u.uEnvFlow.value.y = E.water.z;
    u.uEnvFlow.value.z = E.water.speed;

    // the room around the table follows the sky: cooler at night, warm at dusk
    if (E.neutral) this._back = [1, 1, 1];
    else {
      const L = Math.max(luma(E.sky), 1e-3);
      const dim = 1 - 0.55 * E.darkness;
      this._back = E.sky.map((c) => (0.55 + 0.45 * Math.min(c / L, 1.6)) * dim);
    }

    const kind = E.weather.kind;
    this._kind = KINDS[kind] ?? null;
    this._intensity = this._kind ? E.weather.intensity : 0;
    this._rain = RAIN_KINDS.includes(kind) && this._intensity > 0;
    this._lightning = !!E.lightning;
    if (!this._lightning) this._flashAt = -1;
    const p = this.pMat.uniforms;
    p.uKind.value = this._kind?.id ?? 0;
    const gust = kind === "storm" ? Math.max(E.wind.speed, 0.45) : E.wind.speed;
    p.uPWind.value.set(E.wind.x, E.wind.z, gust, 0);
    const tint = E.weather.tint;
    p.uPTint.value.set(tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1, tint ? 0.7 : 0);
    // the air drifts only when there is something in it
    this._moving = E.clouds.cover > 0.01 || E.fog.density > 0.001 || E.mist > 0.01;
    return true;
  }

  /** Whether weather or the air moves this frame (the renderer's clock runs while it does). */
  animated(fx) {
    if (fx?.weather > 0 && this._intensity > 0) return true;
    if (fx?.atmosphere && this._moving) return true;
    return this._flashAt >= 0;
  }

  frame(t, dt, camera, fx, view) {
    const u = this.shared;
    u.uEnvTime.value = u.uTime.value;
    u.uEnvFx.value.set(fx.detail > 0 ? 1 : 0, fx.water > 0 ? 1 : 0, fx.grade === false ? 0 : 1, 0);
    u.uEnvAtmo.value.w = fx.atmosphere ? 1 : 0;
    if (view) u.uEnvFocus.value.set(view.tx, view.ty, view.tz);

    const weather = fx.weather > 0 && this._intensity > 0;
    const share = fx.weather === 1 ? REDUCED : 1;
    u.uEnvFlow.value.w = weather && this._rain ? this._intensity : 0;

    if (weather) {
      // A box around what the camera looks at, sized from the zoom in steps of
      // √2 (so a zoom tween does not reshuffle every frame) and kept to the board.
      const zoom = Math.max(1e-3, view?.zoom ?? 1);
      const H = VIEW_CELLS * Math.SQRT2 ** Math.ceil(Math.log2(1 / zoom) * 2);
      // wide enough for a 16:9 view at the lowest pitch; the full count fills it
      const side = H * 2.4;
      const B = this.bounds;
      const sx = Math.min(side, (B.cols || side) + 2), sz = Math.min(side, (B.rows || side) + 2);
      const cx = Math.min(Math.max(view?.tx ?? 0, sx / 2 - 1), (B.cols || 0) + 1 - sx / 2);
      const cz = Math.min(Math.max(view?.tz ?? 0, sz / 2 - 1), (B.rows || 0) + 1 - sz / 2);
      const y0 = B.minY - 0.4;
      const sy = B.maxY - B.minY + 0.6 + H * 0.8;
      this.box.min.value.set(cx - sx / 2, y0, cz - sz / 2);
      this.box.size.value.set(sx, sy, sz);
      this.box.scale.value = H / VIEW_CELLS;
      this.box.px.value = this.pxWorld > 0 ? this.pxWorld : 0.01;
      const fill = (sx * sz) / (side * side);
      const amount = Math.pow(this._intensity, 0.8) * share * fill;
      this.pGeo.instanceCount = Math.round(this._kind.max * amount);
      this.pMat.uniforms.uPOpacity.value = 0.55 + 0.45 * Math.min(1, this._intensity * 1.4);
      this.sGeo.instanceCount = this._rain ? Math.round(MAX_SPLASHES * amount) : 0;
      this.sMat.uniforms.uPOpacity.value = 0.6 + 0.4 * this._intensity;
    } else {
      this.pGeo.instanceCount = 0;
      this.sGeo.instanceCount = 0;
    }

    // Lightning: rare, a double flash and a tail; the next one 6 to 18 s later.
    let flash = 0;
    if (this._lightning && fx.weather > 0) {
      this._sec += dt;
      if (this._next <= 0) this._next = this._sec + 2 + this._strikes() * 6;
      if (this._flashAt < 0 && this._sec >= this._next) {
        this._flashAt = this._sec;
        this._next = this._sec + LIGHTNING_GAP[0] + this._strikes() * (LIGHTNING_GAP[1] - LIGHTNING_GAP[0]);
      }
      if (this._flashAt >= 0) {
        const a = this._sec - this._flashAt;
        if (a > LIGHTNING_LIFE) this._flashAt = -1;
        else {
          const p1 = Math.exp(-(((a - 0.04) / 0.05) ** 2));
          const p2 = 0.75 * Math.exp(-(((a - 0.3) / 0.07) ** 2));
          const tail = 0.18 * Math.max(0, 1 - a / LIGHTNING_LIFE) * (a > 0.3 ? 1 : 0);
          flash = Math.min(1, p1 + p2 + tail) * LIGHTNING_PEAK * this._intensity;
        }
      }
    } else this._flashAt = -1;
    u.uEnvFlash.value = flash;
    const b = this._back, k = 1 + flash * 0.6;
    u.uEnvBack.value.set(b[0] * k, b[1] * k, b[2] * k);

    return this.animated(fx);
  }

  dispose() {
    this.group.remove(this.particles, this.splashes);
    this.pGeo.dispose();
    this.sGeo.dispose();
    this.pMat.dispose();
    this.sMat.dispose();
    if (this.height.value !== this._blankHeight) this.height.value.dispose();
    this._blankHeight.dispose();
  }
}
