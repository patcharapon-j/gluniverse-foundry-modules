import { DEFAULT_ICON } from "./constants.mjs";
import { getUltimateState, hasUltimateItems, isCharged, isNpcActor, sanitizeIcon } from "./state.mjs";

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

const FRAGMENT_SHADER = `
varying vec2 vTextureCoord;
uniform sampler2D uIcon;
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;

float glultHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + vec2(34.345 + uSeed));
  return fract(p.x * p.y);
}

float glultNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(glultHash(i), glultHash(i + vec2(1.0, 0.0)), f.x),
    mix(glultHash(i + vec2(0.0, 1.0)), glultHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float glultFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += glultNoise(p) * amplitude;
    p = p * 2.03 + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

mat2 glultRotate(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float glultBolt(vec2 p, float angle, float seed) {
  p = glultRotate(angle) * p;
  float cycle = uTime * 1.35 + seed * 17.0 + uSeed;
  float tick = floor(cycle);
  float age = fract(cycle);
  float jag = (glultNoise(vec2(p.x * 15.0 + seed, tick)) - 0.5) * 0.075;
  jag += sin(p.x * 49.0 + tick * 1.3) * 0.012;
  float trunk = exp(-abs(p.y - jag) * 155.0);
  float reach = smoothstep(0.16, 0.21, p.x) * (1.0 - smoothstep(0.38, 0.49, p.x));
  float event = step(0.76, glultHash(vec2(tick, seed * 31.7)));
  float strike = (1.0 - smoothstep(0.0, 0.18, age));
  float aftershock = exp(-pow((age - 0.34) * 30.0, 2.0)) * 0.48;
  float flash = event * (strike + aftershock);
  float branchY = jag + (p.x - 0.24) * (0.33 + seed * 0.12);
  float branch = exp(-abs(p.y - branchY) * 205.0);
  branch *= smoothstep(0.22, 0.27, p.x) * (1.0 - smoothstep(0.34, 0.44, p.x));
  return (trunk * reach + branch * 0.7) * flash;
}

float glultArc(float r, float a, float radius, float phase, float frequency) {
  float ring = exp(-abs(r - radius) * 145.0);
  float broken = smoothstep(-0.35, 0.42, sin(a * frequency + phase));
  return ring * broken;
}

void main(void) {
  vec2 uv = vTextureCoord - vec2(0.5);
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  float breathe = 0.92 + 0.08 * sin(uTime * 2.25 + uSeed);
  float flameNoise = glultFbm(vec2(a * 2.15 - uTime * 0.17 + r * 4.0, r * 16.0 - uTime * 0.72));
  float curl = sin(a * 6.0 - uTime * 0.52 + r * 22.0);
  float flameEdge = 0.305 + flameNoise * 0.09 + curl * 0.018;
  float flame = smoothstep(0.185, 0.235, r) * (1.0 - smoothstep(flameEdge - 0.045, flameEdge, r));
  flame *= (0.22 + flameNoise * 1.05) * breathe;

  float wisps = pow(glultFbm(vec2(a * 4.0 + uTime * 0.12, r * 22.0 - uTime * 0.84)), 3.2);
  wisps *= smoothstep(0.255, 0.31, r) * (1.0 - smoothstep(0.34, 0.47, r));

  float arcs = glultArc(r, a, 0.245, uTime * 0.72 + uSeed, 5.0);
  arcs += glultArc(r, a, 0.292, -uTime * 0.47 + uSeed * 0.4, 7.0) * 0.72;

  float sparks = exp(-abs(r - 0.325) * 180.0) * pow(max(0.0, sin(a * 3.0 - uTime * 1.15)), 30.0);
  sparks += exp(-abs(r - 0.276) * 190.0) * pow(max(0.0, sin(a * 2.0 + uTime * 0.83 + 1.7)), 34.0) * 0.75;

  float wavePhase = fract(uTime * 0.34 + fract(uSeed * 0.17));
  float waveRadius = 0.215 + wavePhase * 0.22;
  float chargeWave = exp(-abs(r - waveRadius) * 125.0) * (1.0 - wavePhase) * 0.42;

  float bolts = glultBolt(uv, 0.12, 0.17);
  bolts += glultBolt(uv, 2.24, 0.53);
  bolts += glultBolt(uv, 4.37, 0.89);

  float sphereMask = 1.0 - smoothstep(0.178, 0.205, r);
  float sphereDepth = sqrt(max(0.0, 1.0 - pow(r / 0.205, 2.0)));
  float sphereShade = sphereMask * (0.24 + sphereDepth * 0.58);
  float sphereRim = exp(-pow((r - 0.196) * 43.0, 2.0)) * 0.92;
  float sphereHighlight = exp(-length(uv - vec2(-0.065, -0.075)) * 22.0) * sphereMask * 0.58;

  float icon = smoothstep(0.10, 0.62, texture2D(uIcon, vTextureCoord).a) * (1.0 - smoothstep(0.17, 0.198, r));
  float iconAura = smoothstep(0.18, 0.0, r) * 0.24 * breathe;
  float energy = sphereShade + sphereRim + sphereHighlight + iconAura;
  energy += icon * 1.85 + arcs * 0.95 + flame * 1.1 + wisps * 1.15;
  energy += sparks * 1.7 + chargeWave + bolts * 2.15;
  float alpha = clamp(energy, 0.0, 0.98) * (1.0 - smoothstep(0.47, 0.5, r));

  vec3 deep = uColor * 0.42;
  vec3 bright = min(vec3(1.0), uColor * 1.32 + vec3(0.28));
  vec3 whiteHot = min(vec3(1.0), bright + vec3(0.38));
  float heat = clamp(sphereHighlight + arcs * 0.45 + flame * 0.32 + sparks + bolts * 1.25, 0.0, 1.0);
  vec3 color = mix(deep, bright, clamp(sphereDepth + flame * 0.55 + chargeWave, 0.0, 1.0));
  color = mix(color, whiteHot, clamp(icon * 0.72 + heat * 0.78, 0.0, 1.0));
  gl_FragColor = vec4(color * alpha, alpha);
}`;

export class UltimateTokenOverlay {
  constructor() {
    this.entries = new Map();
    this.iconTextures = new Map();
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
      if (!this.shouldDisplay(token)) continue;
      wanted.add(token.id);
      this.upsert(token);
    }
    for (const id of [...this.entries.keys()]) {
      if (!wanted.has(id)) this.remove(id);
    }
    this.syncTicker();
  }

  refreshToken(token) {
    if (!token?.id) return;
    if (this.shouldDisplay(token)) this.upsert(token);
    else this.remove(token.id);
    this.syncTicker();
  }

  shouldDisplay(token) {
    const actor = token?.actor;
    if (!isNpcActor(actor) || !hasUltimateItems(actor) || !isCharged(actor)) return false;
    if (token.document?.hidden && !game.user?.isGM) return false;
    if (actor.isDead) return false;
    const combatant = token.document?.combatant
      ?? game.combat?.combatants?.find?.((entry) => entry.tokenId === token.id && entry.sceneId === token.document?.parent?.id);
    return !combatant?.defeated;
  }

  upsert(token) {
    const state = getUltimateState(token.actor);
    const icon = sanitizeIcon(state.icon);
    const size = Math.max(16, Math.min(36, Math.min(token.w || 0, token.h || 0) * 0.2));
    const signature = `${token.actor.uuid}|${state.color}|${icon}|${size}`;
    let entry = this.entries.get(token.id);
    if (entry?.signature !== signature || entry?.token !== token || entry.container?.destroyed) {
      this.remove(token.id);
      entry = this.createEntry(token, state, icon, size, signature);
      if (!entry) return;
      this.entries.set(token.id, entry);
    }
    this.positionEntry(entry, token, size);
  }

  createEntry(token, state, icon, size, signature) {
    try {
      const container = new PIXI.Container();
      container.eventMode = "none";
      container.sortableChildren = true;
      container.zIndex = 1000;
      const texture = this.iconTexture(icon);
      const rgb = hexRgb(state.color);
      let material = null;
      let mesh = null;
      let fallback = null;

      try {
        material = makeMesh(MATERIAL_FRAGMENT_SHADER, {
          uIcon: texture,
          uTime: this.time,
          uSeed: Math.random() * 100,
          uColor: rgb,
        });
        setMeshQuad(material, size * 1.75, size * 1.75, true);
        material.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";

        mesh = makeMesh(FRAGMENT_SHADER, {
          uIcon: texture,
          uTime: this.time,
          uSeed: Math.random() * 100,
          uColor: rgb,
        });
        setMeshQuad(mesh, size * 1.75, size * 1.75, true);
        mesh.blendMode = PIXI.BLEND_MODES?.ADD ?? "add";
        container.addChild(material, mesh);
      } catch (error) {
        destroyMesh(material);
        destroyMesh(mesh);
        material = null;
        mesh = null;
        console.warn("GLUniverse Suite | PF2e Ultimates | WebGL effect unavailable; using static icon", error);
        fallback = makeFallback(texture, size, state.color);
        container.addChild(fallback);
      }

      token.addChild(container);
      return { token, container, material, mesh, fallback, signature, size };
    } catch (error) {
      console.warn("GLUniverse Suite | PF2e Ultimates | Could not attach token indicator", error);
      return null;
    }
  }

  positionEntry(entry, token, size) {
    entry.container.position.set((token.w || 0) - size * 0.9, size * 0.9);
  }

  iconTexture(icon) {
    const key = sanitizeIcon(icon);
    const cached = this.iconTextures.get(key);
    if (cached && !cached.destroyed) return cached;
    const mask = rasterizeFontAwesome(key) ?? rasterizeFontAwesome(DEFAULT_ICON);
    const texture = PIXI.Texture.from(mask);
    if (texture.baseTexture) {
      texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? texture.baseTexture.scaleMode;
      if (PIXI.MIPMAP_MODES?.ON !== undefined) texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    }
    this.iconTextures.set(key, texture);
    return texture;
  }

  tick() {
    const deltaMs = canvas?.app?.ticker?.deltaMS ?? 16.667;
    this.time += Math.min(deltaMs, 100) / 1000;
    for (const entry of this.entries.values()) {
      if (entry.material?.shader?.uniforms) entry.material.shader.uniforms.uTime = this.time;
      if (entry.mesh?.shader?.uniforms) entry.mesh.shader.uniforms.uTime = this.time;
    }
  }

  syncTicker() {
    const ticker = canvas?.app?.ticker;
    if (!ticker) return;
    if (this.entries.size && !this.ticking) {
      ticker.add(this.tick);
      this.ticking = true;
    } else if (!this.entries.size && this.ticking) {
      ticker.remove(this.tick);
      this.ticking = false;
    }
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    destroyMesh(entry.material);
    destroyMesh(entry.mesh);
    if (entry.fallback && !entry.fallback.destroyed) {
      try { entry.fallback.destroy({ children: true }); } catch { /* noop */ }
    }
    if (entry.container && !entry.container.destroyed) {
      if (entry.container.parent) entry.container.parent.removeChild(entry.container);
      try { entry.container.destroy({ children: true }); } catch { /* noop */ }
    }
  }

  clearAll({ destroyTextures = false } = {}) {
    for (const id of [...this.entries.keys()]) this.remove(id);
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

function rasterizeFontAwesome(iconClass) {
  if (!document?.body) return null;
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
  if (!glyph || !family) return null;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, 256, 256);
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${weight} 80px ${family}`;
  context.fillText(glyph, 128, 128);
  return canvas;
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
