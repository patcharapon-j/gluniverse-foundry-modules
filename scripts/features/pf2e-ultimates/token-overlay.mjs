import { DEFAULT_ICON } from "./constants.mjs";
import { effectChunk, sanitizeEffect } from "./effects.mjs";
import {
  getDisplayMode,
  getUltimateState,
  hasUltimateItems,
  iconCdnUrl,
  isCharged,
  isNpcActor,
  sanitizeIcon,
  shouldShowCounter,
} from "./state.mjs";

const VERTEX_SHADER = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main(void) {
  vTextureCoord = aUvs;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const MATERIAL_FRAGMENT_SHADER = `
varying vec2 vTextureCoord;
uniform sampler2D uIcon;
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;

void main(void) {
  vec2 uv = vTextureCoord - vec2(0.5);
  float r = length(uv);
  float sphereRadius = 0.205;
  float sphereMask = 1.0 - smoothstep(sphereRadius - 0.011, sphereRadius, r);
  float z = sqrt(max(0.0, 1.0 - pow(r / sphereRadius, 2.0)));
  vec3 normal = normalize(vec3(uv / sphereRadius, z));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);

  vec3 keyLight = normalize(vec3(-0.48, -0.62, 0.95));
  vec3 fillLight = normalize(vec3(0.58, 0.44, 0.40));
  float diffuse = 0.20 + max(dot(normal, keyLight), 0.0) * 0.68 + max(dot(normal, fillLight), 0.0) * 0.18;
  float bottomOcclusion = max(dot(normal, vec3(0.0, 1.0, 0.30)), 0.0) * 0.16;

  float fresnel = pow(1.0 - z, 2.6);
  vec3 halfKey = normalize(keyLight + viewDir);
  float specKey = pow(max(dot(normal, halfKey), 0.0), 120.0) * 1.1;
  vec3 halfFill = normalize(fillLight + viewDir);
  float specFill = pow(max(dot(normal, halfFill), 0.0), 40.0) * 0.26;
  float sheen = pow(max(dot(normal, keyLight), 0.0), 9.0) * 0.26;

  vec2 windowOffset = (uv - vec2(-0.072, -0.084)) * vec2(1.0, 1.5);
  float window = exp(-dot(windowOffset, windowOffset) * 330.0) * 0.8;

  float c1 = sin(uv.x * 41.0 - uv.y * 29.0 + uTime * 0.58 + sin(uv.y * 21.0 + uSeed));
  float c2 = sin(uv.x * 24.0 + uv.y * 37.0 - uTime * 0.41 + uSeed * 1.7);
  float caustic = pow(0.5 + 0.5 * c1, 5.0) * 0.7 + pow(0.5 + 0.5 * c2, 6.0) * 0.5;
  caustic *= z * sphereMask;
  float innerShade = smoothstep(0.19, 0.04, r) * 0.16;

  vec2 refractedUv = vTextureCoord - normal.xy * (1.0 - z) * 0.028;
  float iconEdge = 1.0 - smoothstep(0.17, 0.198, r);
  float icon = smoothstep(0.10, 0.62, texture2D(uIcon, refractedUv).a) * iconEdge;
  float iconShadow = smoothstep(0.10, 0.62, texture2D(uIcon, refractedUv - vec2(-0.011, -0.014)).a) * iconEdge * 0.32;

  vec3 deep = uColor * 0.10;
  vec3 body = mix(deep, uColor * 0.86, clamp(diffuse - bottomOcclusion, 0.0, 1.0));
  body += uColor * (caustic * 0.22 + innerShade);
  vec3 pearl = min(vec3(1.0), uColor * 0.72 + vec3(0.58));
  vec3 rimDispersion = fresnel * vec3(1.05, 1.0, 0.94);
  body = mix(body, pearl, clamp(rimDispersion * 0.62 + vec3(specFill + sheen), vec3(0.0), vec3(1.0)));

  body = mix(body, deep * 0.5, iconShadow * (1.0 - icon));
  body = mix(body, vec3(1.0), clamp(icon * 0.88 + specKey + window, 0.0, 1.0));
  float gloss = (specKey + window) * sphereMask;
  float alpha = clamp(sphereMask * (0.50 + z * 0.26 + fresnel * 0.20) + icon * 0.36 + gloss * 0.35, 0.0, 0.96);
  gl_FragColor = vec4(body * alpha, alpha);
}`;

/* Per-effect fragment shaders. Each effect (effects.mjs) supplies a
   `glultEffect(uv, r, a) -> (energy, heat, fill)` body; the templates below
   wrap it with the gel-sphere/icon rendering (icon) or the base ring, comet,
   and token masking (ring). The gel icon compiles the simplified variant
   (GLULT_SIMPLE), the token overlay ring the full-complexity one. */

const iconFragmentCache = new Map();
const ringFragmentCache = new Map();

function iconFragmentShader(effectId) {
  const key = sanitizeEffect(effectId);
  let source = iconFragmentCache.get(key);
  if (source) return source;
  source = `
varying vec2 vTextureCoord;
uniform sampler2D uIcon;
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;
#define GLULT_SIMPLE 1
#define GLULT_EDGE 0.188
#define GLULT_BASE 0.21
#define GLULT_OUT 0.44
${effectChunk(key)}

void main(void) {
  vec2 uv = vTextureCoord - vec2(0.5);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float breathe = 0.92 + 0.08 * sin(uTime * 2.25 + uSeed);

  vec3 fx = glultEffect(uv, r, a);

  float sphereMask = 1.0 - smoothstep(0.178, 0.205, r);
  float sphereDepth = sqrt(max(0.0, 1.0 - pow(r / 0.205, 2.0)));
  float sphereShade = sphereMask * (0.24 + sphereDepth * 0.58);
  float sphereRim = exp(-pow((r - 0.196) * 43.0, 2.0)) * 0.92;
  float sphereHighlight = exp(-length(uv - vec2(-0.065, -0.075)) * 22.0) * sphereMask * 0.58;

  float icon = smoothstep(0.10, 0.62, texture2D(uIcon, vTextureCoord).a) * (1.0 - smoothstep(0.17, 0.198, r));
  float iconAura = (1.0 - smoothstep(0.0, 0.18, r)) * 0.24 * breathe;
  float energy = sphereShade + sphereRim + sphereHighlight + iconAura + icon * 1.85 + fx.x;
  float alpha = clamp(energy, 0.0, 0.98) * (1.0 - smoothstep(0.47, 0.5, r));

  vec3 deep = uColor * 0.42;
  vec3 bright = min(vec3(1.0), uColor * 1.32 + vec3(0.28));
  vec3 whiteHot = min(vec3(1.0), bright + vec3(0.38));
  float heat = clamp(sphereHighlight + fx.y, 0.0, 1.0);
  vec3 color = mix(deep, bright, clamp(sphereDepth + fx.z, 0.0, 1.0));
  color = mix(color, whiteHot, clamp(icon * 0.72 + heat * 0.78, 0.0, 1.0));
  gl_FragColor = vec4(color * alpha, alpha);
}`;
  iconFragmentCache.set(key, source);
  return source;
}

function ringFragmentShader(effectId) {
  const key = sanitizeEffect(effectId);
  let source = ringFragmentCache.get(key);
  if (source) return source;
  source = `
varying vec2 vTextureCoord;
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;
#define GLULT_EDGE 0.30
#define GLULT_BASE 0.335
#define GLULT_OUT 0.46
${effectChunk(key)}

void main(void) {
  vec2 uv = vTextureCoord - vec2(0.5);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float breathe = 0.9 + 0.1 * sin(uTime * 2.1 + uSeed);

  vec3 fx = glultEffect(uv, r, a);

  float base = exp(-pow((r - GLULT_BASE) * 34.0, 2.0)) * 0.5 * breathe;
  float comet = pow(0.5 + 0.5 * sin(a - uTime * 0.9 + uSeed), 18.0) * exp(-abs(r - GLULT_BASE) * 70.0) * 1.4;

  float energy = base + comet + fx.x;
  energy *= smoothstep(0.265, 0.30, r) * (1.0 - smoothstep(0.44, 0.5, r));

  vec3 bright = min(vec3(1.0), uColor * 1.25 + vec3(0.22));
  vec3 whiteHot = min(vec3(1.0), bright + vec3(0.35));
  vec3 color = mix(uColor * 0.6, bright, clamp(energy * 0.6 + fx.z, 0.0, 1.0));
  color = mix(color, whiteHot, clamp(comet + fx.y, 0.0, 1.0));
  float alpha = clamp(energy, 0.0, 0.9);
  gl_FragColor = vec4(color * alpha, alpha);
}`;
  ringFragmentCache.set(key, source);
  return source;
}

/* Enter/exit animation timing (seconds). */
const APPEAR_SECONDS = 0.5;
const VANISH_SECONDS = 0.35;

/* Ease-out-back: overshoots slightly past 1 for a gel-like pop. */
function easeOutBack(p) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
}

function easeOutCubic(p) {
  return 1 - Math.pow(1 - p, 3);
}

export class UltimateTokenOverlay {
  constructor() {
    this.entries = new Map();
    this.iconTextures = new Map();
    this.dying = [];
    this.started = false;
    this.ticking = false;
    this.time = 0;
    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.started) return;
    this.started = true;
    Hooks.on("canvasReady", () => this.refreshAll());
    Hooks.on("canvasTearDown", () => this.clearAll({ destroyTextures: true }));
    Hooks.on("drawToken", () => this.refreshAll());
    Hooks.on("refreshToken", (token) => this.refreshToken(token));
    // The overlay ring lives in canvas.primary rather than under the Token,
    // so it must be released explicitly when the placeable is destroyed.
    Hooks.on("destroyToken", (token) => { this.remove(token?.id); this.syncTicker(); });
    Hooks.on("updateActor", () => this.refreshAll());
    Hooks.on("createItem", () => this.refreshAll());
    Hooks.on("updateItem", () => this.refreshAll());
    Hooks.on("deleteItem", () => this.refreshAll());
    Hooks.on("updateCombatant", () => this.refreshAll());
    Hooks.on("createCombat", () => this.refreshAll());
    Hooks.on("deleteCombat", () => this.refreshAll());
    this.refreshAll();
  }

  refreshAll() {
    if (!canvas?.ready || !globalThis.PIXI || !canvas.tokens) {
      this.clearAll();
      return;
    }
    const wanted = new Set();
    for (const token of canvas.tokens.placeables ?? []) {
      const display = this.computeDisplay(token);
      if (!display) continue;
      wanted.add(token.id);
      this.upsert(token, display);
    }
    for (const id of [...this.entries.keys()]) {
      if (!wanted.has(id)) this.remove(id, { animate: true });
    }
    this.syncTicker();
  }

  refreshToken(token) {
    if (!token?.id) return;
    const display = this.computeDisplay(token);
    if (display) this.upsert(token, display);
    else this.remove(token.id, { animate: true });
    this.syncTicker();
  }

  /** Resolve which layers this token needs: gel icon, overlay ring, counter. */
  computeDisplay(token) {
    const actor = token?.actor;
    if (!isNpcActor(actor) || !hasUltimateItems(actor)) return null;
    if (token.document?.hidden && !game.user?.isGM) return null;
    if (actor.isDead) return null;
    const combatant = token.document?.combatant
      ?? game.combat?.combatants?.find?.((entry) => entry.tokenId === token.id && entry.sceneId === token.document?.parent?.id);
    if (combatant?.defeated) return null;

    const charged = isCharged(actor);
    const mode = getDisplayMode(actor);
    const icon = charged && (mode === "icon" || mode === "both");
    const ring = charged && (mode === "overlay" || mode === "both");
    const counter = shouldShowCounter(actor);
    if (!icon && !ring && !counter) return null;
    return { icon, ring, counter };
  }

  upsert(token, display) {
    const state = getUltimateState(token.actor);
    const icon = sanitizeIcon(state.icon);
    const width = token.w || 0;
    const height = token.h || 0;
    const size = Math.max(16, Math.min(36, Math.min(width, height) * 0.2));
    const signature = [
      token.actor.uuid, state.color, state.effect, icon, size,
      display.icon ? 1 : 0, display.ring ? 1 : 0,
      display.counter ? state.value : "-",
      width, height,
    ].join("|");
    let entry = this.entries.get(token.id);
    if (entry?.signature !== signature || entry?.token !== token || entry.container?.destroyed) {
      const previous = entry && entry.token === token && !entry.container?.destroyed ? entry : null;
      const prevDisplay = previous?.display ?? null;
      if (previous) this.retireRemovedLayers(previous, display);
      this.remove(token.id);
      // Only layers that were not already showing animate in; a layer that
      // merely re-rendered (e.g. the counter after a value change) swaps
      // in place without replaying its entrance.
      const appear = {
        icon: display.icon && !prevDisplay?.icon,
        ring: display.ring && !prevDisplay?.ring,
        counter: display.counter && !prevDisplay?.counter,
      };
      entry = this.createEntry(token, state, icon, size, signature, display, appear);
      if (!entry) return;
      this.entries.set(token.id, entry);
    }
    this.positionEntry(entry, token);
  }

  /**
   * Detach layers that the next display no longer wants and hand them to the
   * fade-out queue, so a spent Ultimate's icon/ring dissolves instead of
   * vanishing when the entry is rebuilt (e.g. counter still showing).
   */
  retireRemovedLayers(entry, next) {
    const prev = entry.display ?? {};
    const hostParent = entry.container?.parent ?? null;
    if (entry.iconGroup && prev.icon && !next.icon) {
      const iconMeshes = (entry.meshes ?? []).filter((mesh) => mesh.parent === entry.iconGroup);
      entry.meshes = (entry.meshes ?? []).filter((mesh) => mesh.parent !== entry.iconGroup);
      // The entry container sits at the token origin, so reparenting to the
      // token keeps the group's local coordinates intact.
      if (hostParent) hostParent.addChild(entry.iconGroup);
      this.retire(entry.iconGroup, iconMeshes);
      entry.iconGroup = null;
    }
    if (entry.ringContainer && prev.ring && !next.ring) {
      const ringMeshes = entry.ring ? [entry.ring] : [];
      entry.meshes = (entry.meshes ?? []).filter((mesh) => mesh !== entry.ring);
      if (entry.ringContainer.parent === entry.container && hostParent) hostParent.addChild(entry.ringContainer);
      this.retire(entry.ringContainer, ringMeshes);
      entry.ring = null;
      entry.ringContainer = null;
    }
    if (entry.fallback && !next.icon && !next.ring) {
      if (hostParent) hostParent.addChild(entry.fallback);
      this.retire(entry.fallback, []);
      entry.fallback = null;
    }
  }

  /** Queue a display object for the fade-out animation, then destruction. */
  retire(node, meshes = []) {
    if (!node || node.destroyed) {
      for (const mesh of meshes) destroyMesh(mesh);
      return;
    }
    this.dying.push({ node, meshes, t: 0, alpha: node.alpha ?? 1, scale: node.scale?.x ?? 1 });
  }

  createEntry(token, state, icon, size, signature, display, appear = { icon: true, ring: true, counter: true }) {
    try {
      const container = new PIXI.Container();
      container.eventMode = "none";
      container.sortableChildren = true;
      container.zIndex = 1000;
      const texture = this.iconTexture(icon);
      const rgb = hexRgb(state.color);
      const meshes = [];
      const intro = [];
      let iconGroup = null;
      let ring = null;
      let ringContainer = null;
      let counter = null;
      let fallback = null;
      // Prime a layer for its entrance animation: invisible and shrunken on
      // the first frame, animated up to full size/alpha by tick().
      const introduce = (node, kind) => {
        node.alpha = 0;
        node.scale.set(kind === "ring" ? 0.65 : 0.4);
        intro.push({ node, kind, t: 0 });
      };

      try {
        if (display.icon) {
          iconGroup = new PIXI.Container();
          iconGroup.eventMode = "none";
          const material = makeMesh(MATERIAL_FRAGMENT_SHADER, {
            uIcon: texture,
            uTime: this.time,
            uSeed: Math.random() * 100,
            uColor: rgb,
          });
          setMeshQuad(material, size * 1.75, size * 1.75, true);
          material.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";

          const energy = makeMesh(iconFragmentShader(state.effect), {
            uIcon: texture,
            uTime: this.time,
            uSeed: Math.random() * 100,
            uColor: rgb,
          });
          setMeshQuad(energy, size * 1.75, size * 1.75, true);
          energy.blendMode = PIXI.BLEND_MODES?.ADD ?? "add";
          iconGroup.addChild(material, energy);
          meshes.push(material, energy);
          container.addChild(iconGroup);
          if (appear.icon) introduce(iconGroup, "icon");
        }

        if (display.ring) {
          ring = makeMesh(ringFragmentShader(state.effect), {
            uTime: this.time,
            uSeed: Math.random() * 100,
            uColor: rgb,
          });
          const ringSize = Math.max(32, Math.min(token.w || 0, token.h || 0) * 1.5);
          setMeshQuad(ring, ringSize, ringSize, true);
          ring.blendMode = PIXI.BLEND_MODES?.ADD ?? "add";
          meshes.push(ring);
          ringContainer = new PIXI.Container();
          ringContainer.eventMode = "none";
          ringContainer.addChild(ring);
          // Render the ring in the primary group just below the token's art
          // mesh, so the token portrait sits on top of the energy ring.
          const primary = canvas?.primary;
          if (primary?.addChild) {
            ringContainer.sortLayer = token.mesh?.sortLayer ?? 700;
            primary.addChild(ringContainer);
          } else {
            container.addChildAt(ringContainer, 0);
          }
          if (appear.ring) introduce(ringContainer, "ring");
        }
      } catch (error) {
        for (const mesh of meshes) destroyMesh(mesh);
        meshes.length = 0;
        intro.length = 0;
        iconGroup = null;
        ring = null;
        if (ringContainer && !ringContainer.destroyed) {
          try { ringContainer.destroy({ children: true }); } catch { /* noop */ }
        }
        ringContainer = null;
        console.warn("GLUniverse Suite | PF2e Ultimates | WebGL effect unavailable; using static icon", error);
        if (display.icon || display.ring) {
          fallback = makeFallback(texture, size, state.color);
          container.addChild(fallback);
          if (appear.icon || appear.ring) introduce(fallback, "icon");
        }
      }

      if (display.counter) {
        counter = makeCounter(state, size);
        container.addChild(counter);
        if (appear.counter) introduce(counter, "counter");
      }

      token.addChild(container);
      return { token, container, meshes, intro, iconGroup, ring, ringContainer, counter, fallback, display, signature, size };
    } catch (error) {
      console.warn("GLUniverse Suite | PF2e Ultimates | Could not attach token indicator", error);
      return null;
    }
  }

  positionEntry(entry, token) {
    const width = token.w || 0;
    const height = token.h || 0;
    const size = entry.size;
    entry.iconGroup?.position.set(width - size * 0.9, size * 0.9);
    entry.fallback?.position.set(width - size * 0.9, size * 0.9);
    entry.counter?.position.set(width - size * 0.9, height - size * 0.9);
    const ringContainer = entry.ringContainer;
    if (!ringContainer) return;
    if (ringContainer.parent && ringContainer.parent !== entry.container) {
      // Ring lives in canvas.primary: track the token in world coordinates
      // and keep its depth sort just below the token's art mesh.
      const cx = (token.x ?? 0) + width / 2;
      const cy = (token.y ?? 0) + height / 2;
      ringContainer.position.set(cx, cy);
      ringContainer.elevation = token.document?.elevation ?? 0;
      ringContainer.sort = (token.mesh?.sort ?? 0) - 1;
      ringContainer.zIndex = token.mesh?.zIndex ?? 0;
    } else {
      ringContainer.position.set(width / 2, height / 2);
    }
  }

  iconTexture(icon) {
    const key = sanitizeIcon(icon);
    const cached = this.iconTextures.get(key);
    if (cached && !cached.destroyed) return cached;
    const mask = document.createElement("canvas");
    mask.width = 256;
    mask.height = 256;
    const texture = PIXI.Texture.from(mask);
    if (texture.baseTexture) {
      texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? texture.baseTexture.scaleMode;
      if (PIXI.MIPMAP_MODES?.ON !== undefined) texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    }
    this.iconTextures.set(key, texture);
    void paintIconMask(mask, key).then(() => {
      if (!texture.destroyed) texture.baseTexture?.update?.();
    });
    return texture;
  }

  tick() {
    const deltaMs = canvas?.app?.ticker?.deltaMS ?? 16.667;
    const dt = Math.min(deltaMs, 100) / 1000;
    this.time += dt;
    for (const entry of this.entries.values()) {
      for (const mesh of entry.meshes ?? []) {
        if (mesh?.shader?.uniforms) mesh.shader.uniforms.uTime = this.time;
      }
      this.animateIntro(entry, dt);
    }
    this.animateDying(dt);
    if (!this.entries.size && !this.dying.length) this.syncTicker();
  }

  /** Advance a new layer's entrance: fade in with a gel pop / ring bloom. */
  animateIntro(entry, dt) {
    if (!entry.intro?.length) return;
    for (let i = entry.intro.length - 1; i >= 0; i--) {
      const anim = entry.intro[i];
      const node = anim.node;
      if (!node || node.destroyed) {
        entry.intro.splice(i, 1);
        continue;
      }
      anim.t += dt;
      const p = Math.min(1, anim.t / APPEAR_SECONDS);
      node.alpha = Math.min(1, p * 1.8);
      if (anim.kind === "ring") node.scale.set(0.65 + 0.35 * easeOutCubic(p));
      else node.scale.set(0.4 + 0.6 * easeOutBack(p));
      if (p >= 1) {
        node.alpha = 1;
        node.scale.set(1);
        entry.intro.splice(i, 1);
      }
    }
  }

  /** Advance retired layers' exit fade, destroying them when finished. */
  animateDying(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const record = this.dying[i];
      record.t += dt;
      const p = Math.min(1, record.t / VANISH_SECONDS);
      const alive = record.node && !record.node.destroyed;
      if (alive) {
        for (const mesh of record.meshes) {
          if (mesh?.shader?.uniforms) mesh.shader.uniforms.uTime = this.time;
        }
        const fade = 1 - p;
        record.node.alpha = record.alpha * fade * fade;
        record.node.scale?.set(record.scale * (1 - 0.2 * easeOutCubic(p)));
      }
      if (p >= 1 || !alive) {
        this.dying.splice(i, 1);
        for (const mesh of record.meshes) destroyMesh(mesh);
        if (alive) {
          if (record.node.parent) record.node.parent.removeChild(record.node);
          try { record.node.destroy({ children: true }); } catch { /* noop */ }
        }
      }
    }
  }

  syncTicker() {
    const ticker = canvas?.app?.ticker;
    if (!ticker) return;
    const active = this.entries.size > 0 || this.dying.length > 0;
    if (active && !this.ticking) {
      ticker.add(this.tick);
      this.ticking = true;
    } else if (!active && this.ticking) {
      ticker.remove(this.tick);
      this.ticking = false;
    }
  }

  remove(id, { animate = false } = {}) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (animate && entry.container && !entry.container.destroyed) {
      const ringMeshes = entry.ring ? [entry.ring] : [];
      const bodyMeshes = (entry.meshes ?? []).filter((mesh) => mesh !== entry.ring);
      if (entry.ringContainer && entry.ringContainer.parent !== entry.container) {
        this.retire(entry.ringContainer, ringMeshes);
      } else {
        bodyMeshes.push(...ringMeshes);
      }
      this.retire(entry.container, bodyMeshes);
      this.syncTicker();
      return;
    }
    for (const mesh of entry.meshes ?? []) destroyMesh(mesh);
    for (const child of [entry.fallback, entry.counter, entry.iconGroup, entry.ringContainer]) {
      if (child && !child.destroyed) {
        try { child.destroy({ children: true }); } catch { /* noop */ }
      }
    }
    if (entry.container && !entry.container.destroyed) {
      if (entry.container.parent) entry.container.parent.removeChild(entry.container);
      try { entry.container.destroy({ children: true }); } catch { /* noop */ }
    }
  }

  clearAll({ destroyTextures = false } = {}) {
    for (const id of [...this.entries.keys()]) this.remove(id);
    for (const record of this.dying.splice(0)) {
      for (const mesh of record.meshes) destroyMesh(mesh);
      if (record.node && !record.node.destroyed) {
        try { record.node.destroy({ children: true }); } catch { /* noop */ }
      }
    }
    this.syncTicker();
    if (destroyTextures) {
      for (const texture of this.iconTextures.values()) {
        try { texture.destroy(true); } catch { /* noop */ }
      }
      this.iconTextures.clear();
    }
  }
}

function makeMesh(fragment, uniforms) {
  if (!PIXI?.Geometry || !PIXI?.Shader || !PIXI?.Mesh) throw new Error("PIXI mesh APIs unavailable");
  const geometry = new PIXI.Geometry()
    .addAttribute("aVertexPosition", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
  const shader = PIXI.Shader.from(VERTEX_SHADER, fragment, uniforms);
  const mesh = new PIXI.Mesh(geometry, shader);
  mesh.eventMode = "none";
  return mesh;
}

function setMeshQuad(mesh, width, height, centered = false) {
  const x0 = centered ? -width / 2 : 0;
  const y0 = centered ? -height / 2 : 0;
  const x1 = x0 + width;
  const y1 = y0 + height;
  const buffer = mesh.geometry.getBuffer("aVertexPosition");
  const data = buffer.data;
  data[0] = x0; data[1] = y0;
  data[2] = x1; data[3] = y0;
  data[4] = x1; data[5] = y1;
  data[6] = x0; data[7] = y1;
  buffer.update();
}

function destroyMesh(mesh) {
  if (!mesh || mesh.destroyed) return;
  const shader = mesh.shader;
  if (mesh.parent) mesh.parent.removeChild(mesh);
  try { mesh.destroy({ children: true, geometry: true }); } catch { /* noop */ }
  try { shader?.destroy?.(); } catch { /* noop */ }
}

function makeFallback(texture, size, color) {
  const container = new PIXI.Container();
  const glow = new PIXI.Graphics();
  const tint = Number.parseInt(color.slice(1), 16);
  glow.beginFill(tint, 0.16);
  glow.drawCircle(0, 0, size * 0.56);
  glow.endFill();
  glow.lineStyle({ width: Math.max(1, size * 0.05), color: tint, alpha: 0.8 });
  glow.drawCircle(0, 0, size * 0.4);
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.width = size * 0.72;
  sprite.height = size * 0.72;
  sprite.tint = tint;
  container.addChild(glow, sprite);
  return container;
}

/** Small gel-styled numeric badge showing the current resource count. */
function makeCounter(state, size) {
  const container = new PIXI.Container();
  container.eventMode = "none";
  const tint = Number.parseInt(state.color.slice(1), 16);
  const radius = size * 0.46;

  const disc = new PIXI.Graphics();
  disc.beginFill(tint, 0.16);
  disc.drawCircle(0, 0, radius * 1.28);
  disc.endFill();
  disc.beginFill(0x0c1017, 0.88);
  disc.drawCircle(0, 0, radius);
  disc.endFill();
  disc.beginFill(tint, 0.26);
  disc.drawCircle(0, 0, radius * 0.9);
  disc.endFill();
  disc.lineStyle({ width: Math.max(1, size * 0.06), color: tint, alpha: 0.95 });
  disc.drawCircle(0, 0, radius);
  disc.lineStyle(0);
  disc.beginFill(0xffffff, 0.2);
  disc.drawEllipse(-radius * 0.16, -radius * 0.42, radius * 0.62, radius * 0.34);
  disc.endFill();
  container.addChild(disc);

  try {
    const text = new PIXI.Text(String(state.value), {
      fontFamily: "Signika, 'Signika Negative', Arial, sans-serif",
      fontSize: Math.max(10, Math.round(size * 0.58)),
      fontWeight: "700",
      fill: 0xffffff,
      stroke: 0x0a0d12,
      strokeThickness: Math.max(2, Math.round(size * 0.1)),
      align: "center",
    });
    text.anchor.set(0.5);
    text.resolution = Math.max(2, globalThis.devicePixelRatio || 2);
    container.addChild(text);
  } catch (error) {
    console.warn("GLUniverse Suite | PF2e Ultimates | Could not render counter text", error);
  }
  return container;
}

/** Paint the icon into the mask canvas: bundled FA font first, then the FA
 *  free CDN for icons Foundry doesn't ship, then the default glyph. */
async function paintIconMask(canvas, iconClass) {
  if (drawFontAwesomeGlyph(canvas, iconClass)) return;
  if (await drawCdnIcon(canvas, iconClass)) return;
  drawFontAwesomeGlyph(canvas, DEFAULT_ICON);
}

function drawFontAwesomeGlyph(canvas, iconClass) {
  if (!document?.body) return false;
  const probe = document.createElement("i");
  probe.className = iconClass;
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, { position: "fixed", left: "-9999px", top: "-9999px", visibility: "hidden" });
  document.body.appendChild(probe);
  const style = getComputedStyle(probe, "::before");
  const glyph = decodeCssContent(style.content);
  const family = style.fontFamily;
  const weight = style.fontWeight || "900";
  probe.remove();
  if (!glyph || !family) return false;

  const context = canvas.getContext("2d");
  if (!context) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${weight} 80px ${family}`;
  context.fillText(glyph, canvas.width / 2, canvas.height / 2);
  return true;
}

async function drawCdnIcon(canvas, iconClass) {
  const url = iconCdnUrl(iconClass);
  if (!url || !globalThis.fetch) return false;
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    let svg = await response.text();
    // FA SVGs carry only a viewBox; give them explicit dimensions so the
    // decoded image has an intrinsic size in every browser.
    const viewBox = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    if (viewBox && !/<svg[^>]*\swidth=/.test(svg)) {
      svg = svg.replace(/<svg /, `<svg width="${viewBox[1]}" height="${viewBox[2]}" `);
    }
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(`Could not decode icon SVG: ${url}`));
        image.src = blobUrl;
      });
      const context = canvas.getContext("2d");
      if (!context) return false;
      const scale = 104 / Math.max(image.width || 1, image.height || 1);
      const width = (image.width || 1) * scale;
      const height = (image.height || 1) * scale;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "source-over";
      return true;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch (error) {
    console.warn("GLUniverse Suite | PF2e Ultimates | Could not fetch icon from CDN", error);
    return false;
  }
}

export function decodeCssContent(raw) {
  let value = String(raw ?? "").trim();
  if (!value || value === "none" || value === "normal") return null;
  const quoted = value.match(/^"((?:\\.|[^"])*)"/) ?? value.match(/^'((?:\\.|[^'])*)'/);
  if (quoted) value = quoted[1];
  else value = value.split(/\s+\/\s+/, 1)[0];
  value = value.replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
  return value || null;
}

function hexRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
