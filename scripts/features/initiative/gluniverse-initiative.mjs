import { onSocket, emitSocket } from "../../core/socket.mjs";

// True when Foundry's socket subsystem is live. Emits are routed through the
// suite's shared dispatcher (emitSocket); this guard only gates the optimistic
// "broadcast to peers" paths, falling back to local-only behaviour otherwise.
const socketReady = () => Boolean(game?.socket);
import {
    MODULE_ID, FEATURE_ID, SOCKET_NAME, SETTINGS, TOKEN_OVERLAY_PALETTE, DISPOSITION_PALETTE,
  ACTIVE_SHADER_PALETTE, getDispositionColors, FLAGS, INITIATIVE_MODE, CARD_CONFIG_DEFAULTS, CARD_CONFIG_LIMITS,
  BREAK_GAUGE_DEFAULT_MAX, BREAK_GAUGE_MODES, BREAK_GAUGE_FLASH_SEC, BREAK_GAUGE_SHEEN_SEC,
  VISIBILITY, PF2E_GUARD_BREAK_EFFECT_SLUG, PF2E_GUARD_BREAK_PENALTY,
  LOCALIZATION_FALLBACKS, ADHOC_DEFAULT_TYPE, ADHOC_TYPES, ADHOC_VISIBILITY_MODES,
  ADHOC_LIFECYCLE, ADHOC_LIFECYCLE_MODES, STATUS_ANIMATION, ADHOC_ICON_CHOICES,
  COMBATANT_RENDER_UPDATE_KEYS, ACTOR_RENDER_UPDATE_KEYS, FALLBACK_PORTRAIT,
  PORTRAIT_MIN_PIXELS, CONFIGURABLE_ACTOR_TYPES, PORTRAIT_FRAME_DEFAULTS,
  PORTRAIT_FRAME_LIMITS, THEMES, DEFAULT_THEME, PALETTES, applyThemePalette
} from "./constants.mjs";
import { normalizeInitiativeNumber, getDisposition, formatRound, formatInitiative, localize, formatLocalized, modulo, clamp, wait, escapeHTML, escapeAttr, escapeCSSIdentifier } from "./util.mjs";
import { FX_SUPERSAMPLE, FX_GLSL_NOISE, FX_FRAG_BREAK, FX_FRAG_DYING, FX_FRAG_DELAY, FX_FRAG_SCRAMBLE, FX_FRAG_APEX, FX_FRAG_TURN, FX_FRAG_TURN_BAKE, FX_FRAG_TURN_PLAY, FX_FRAG_DOWNSAMPLE, rgbFloat, FX_VERT_MESH, makeFxMesh, setFxMeshQuad, destroyFxMesh } from "./gl.mjs";
import { TokenOverlayManager, getMarkerSheets, prewarmStatusShaders } from "./token-overlay.mjs";
import { getPF2eDyingState, getDnd5eDeathState, getDyingState, getActorAttributeValue, getConditionValue, hasActorItem, COVERED_CONDITION_SLUGS, isPrimaryCondition, getConditionBadgeValue, getHiddenConditionKeys, getPrimaryConditionTags, getConditionTags, renderConditionRepeatText, getConditionTone, renderConditionLabels, findPF2eGuardBreakEffects, getActorItems, getItemSlug, renderDyingRepeatText, renderGuardBreakRepeatText, getGuardBreakState, getBreakGaugeState, renderBreakGaugeBar, renderDyingPips, renderDeathSavePips, renderDeathSaveRepeatText, getApexState, getApexGroupCombatants } from "./conditions.mjs";


// Exported as a live binding: token-overlay.mjs reads `overlay` (enabled state,
// isDelayed, resolveVisibility, getTurnMarkerTargets) and relies on this binding
// updating when the `ready` hook assigns the instance below.
export let overlay;
let tokenOverlays;
let cardFX;
let breakGaugeEditor = null;
const portraitQualityCache = new Map();

// Suite lifecycle: these three functions are invoked by the feature adapter
// (index.mjs). registerSettings() runs unconditionally at init so the toggles
// exist; onInit()/onReady() run only when the feature is enabled. Nothing is
// done at import time except defining classes/functions.

export { registerSettings };

export function onReady() {
  // Mutate live palettes from the world theme setting BEFORE constructing the
  // overlay / card FX / token overlays, so their initial paint uses the active
  // palette directly (no first-frame in default theme then swap).
  applyTheme({ skipRedraw: true });
  overlay = new GLUniverseInitiativeOverlay();
  cardFX = new CardFXManager();
  cardFX.ensureRenderer();
  overlay.mount();
  overlay.render();
  overlay.maybeRedealCards();
  tokenOverlays = new TokenOverlayManager();
  refreshNativeTurnMarkerSuppression();
  // Pre-compile the guard-break splash shader at idle so the first break in play
  // doesn't stall the main thread on synchronous shader compilation.
  getBreakSplashRenderer();

  // Route the feature's socket messages through the suite's shared dispatcher.
  onSocket(FEATURE_ID, data => overlay?.handleSocket(data));
}

// Reads the theme world setting, mutates the live palettes, toggles the theme
// class on <html>, and refreshes every consumer (overlay HTML, card FX shader
// uniforms, token overlay graphics, baked break-splash frames). Safe to call
// before the singletons exist (ready); guards every consumer touch.
function applyTheme({ skipRedraw = false } = {}) {
  let themeName = DEFAULT_THEME;
  try { themeName = game.settings.get(MODULE_ID, SETTINGS.theme) || DEFAULT_THEME; } catch {}
  const resolved = applyThemePalette(themeName);
  try {
    const cls = document.documentElement.classList;
    for (const t of Object.values(THEMES)) cls.remove(`gluni-theme--${t}`);
    cls.add(`gluni-theme--${resolved}`);
  } catch {}
  if (skipRedraw) return resolved;
  try { cardFX?.notifyThemeChange?.(); } catch {}
  try { tokenOverlays?.notifyThemeChange?.(); } catch {}
  try { breakSplashRenderer?.rebake?.(); } catch {}
  try { overlay?.render?.(); } catch {}
  return resolved;
}

// All Foundry hooks are attached here (called at init only when the feature is
// enabled & available), so a disabled feature stays completely inert.
export function onInit() {
  Hooks.on("createCombat", () => { overlay?.renderSoon(); overlay?.maybeRedealCards(); });
  Hooks.on("preDeleteCombat", combat => overlay?.removeAllPF2eGuardBreakEffects(combat));
  Hooks.on("deleteCombat", () => {
    overlay?.renderSoon();
    refreshNativeTurnMarkerSuppression();
  });
  Hooks.on("updateCombat", (combat, changed) => overlay?.onCombatUpdate(combat, changed));
  Hooks.on("createCombatant", () => { overlay?.renderSoon(); overlay?.maybeRedealCards(); });
  Hooks.on("preDeleteCombatant", combatant => overlay?.removePF2eGuardBreakEffect(combatant));
  Hooks.on("deleteCombatant", () => { overlay?.renderSoon(); overlay?.maybeRedealCards(); });
  Hooks.on("updateCombatant", (_combatant, changed) => {
    if (isRelevantCombatantUpdate(changed)) overlay?.renderSoon();
  });
  Hooks.on("updateActor", (actor, changed) => {
    if (isRelevantActorUpdate(changed) && overlay?.hasCombatActor(actor)) {
      overlay?.renderSoon();
    }
  });
  Hooks.on("createItem", item => overlay?.onActorItemChange(item?.parent));
  Hooks.on("deleteItem", item => overlay?.onActorItemChange(item?.parent));
  Hooks.on("updateItem", item => overlay?.onActorItemChange(item?.parent));
  // D&D 5e (and other systems) model conditions/statuses as ActiveEffects rather
  // than items, so the card's condition badges/background react to effect changes.
  // An effect's parent is an Actor (status applied to the token/actor) or an Item
  // whose own parent is the actor; resolve to the actor before re-rendering.
  Hooks.on("createActiveEffect", effect => overlay?.onActorItemChange(resolveEffectActor(effect)));
  Hooks.on("deleteActiveEffect", effect => overlay?.onActorItemChange(resolveEffectActor(effect)));
  Hooks.on("updateActiveEffect", effect => overlay?.onActorItemChange(resolveEffectActor(effect)));
  Hooks.on("getApplicationHeaderButtons", (app, buttons) => { addPortraitHeaderButton(app, buttons); addCardConfigHeaderButton(app, buttons); });
  Hooks.on("getApplicationV1HeaderButtons", (app, buttons) => { addPortraitHeaderButton(app, buttons); addCardConfigHeaderButton(app, buttons); });
  Hooks.on("getActorSheetHeaderButtons", (app, buttons) => { addPortraitHeaderButton(app, buttons); addCardConfigHeaderButton(app, buttons); });
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => { addPortraitHeaderControl(app, controls); addCardConfigHeaderControl(app, controls); });
  Hooks.on("renderApplicationV1", (app, html) => { injectPortraitTitlebarButton(app, html); injectCardConfigTitlebarButton(app, html); });
  Hooks.on("renderApplicationV2", (app, html) => { injectPortraitTitlebarButton(app, html); injectCardConfigTitlebarButton(app, html); });
  Hooks.on("renderTokenHUD", (hud, html, data) => {
    addGuardBreakTokenHudButton(hud, html, data);
    addBreakGaugeTokenHudButton(hud, html, data);
  });
  Hooks.on("combatRound", (_combat, updateData) => {
    if (typeof updateData?.round === "number") overlay?.showRoundSplash(updateData.round);
  });
  Hooks.on("canvasReady", () => {
    tokenOverlays?.refresh();
    refreshNativeTurnMarkerSuppression();
    // Pre-bake the turn-marker loop sheets now that the renderer exists, so the
    // first combat doesn't pay the bake cost mid-encounter.
    try { getMarkerSheets(); } catch { /* falls back to the live shader on demand */ }
    // Compile the break/dying/delay status shaders now too, so the first time one of
    // those states appears on a token it doesn't stall on a synchronous GLSL compile.
    try { prewarmStatusShaders(); } catch { /* compiles on demand if this fails */ }
  });
  Hooks.on("refreshToken", token => hideNativeTurnMarker(token));
}

function registerSettings() {
  const rerender = () => overlay?.renderSoon();

  game.settings.register(MODULE_ID, SETTINGS.enabled, {
    name: localize("GLUNI.Settings.Enabled.Name"),
    hint: localize("GLUNI.Settings.Enabled.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => { rerender(); refreshNativeTurnMarkerSuppression(); }
  });

  game.settings.register(MODULE_ID, SETTINGS.initiativeMode, {
    name: localize("GLUNI.Settings.InitiativeMode.Name"),
    hint: localize("GLUNI.Settings.InitiativeMode.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [INITIATIVE_MODE.standard]: localize("GLUNI.Settings.InitiativeMode.Standard"),
      [INITIATIVE_MODE.card]: localize("GLUNI.Settings.InitiativeMode.Card")
    },
    default: INITIATIVE_MODE.standard,
    onChange: () => { overlay?.onInitiativeModeChanged(); }
  });

  game.settings.register(MODULE_ID, SETTINGS.edge, {
    name: localize("GLUNI.Settings.Edge.Name"),
    hint: localize("GLUNI.Settings.Edge.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      left: localize("GLUNI.Settings.Edge.Left"),
      right: localize("GLUNI.Settings.Edge.Right")
    },
    default: "right",
    onChange: rerender
  });

  game.settings.register(MODULE_ID, SETTINGS.visibleCount, {
    name: localize("GLUNI.Settings.VisibleCount.Name"),
    hint: localize("GLUNI.Settings.VisibleCount.Hint"),
    scope: "world",
    config: true,
    type: Number,
    range: {
      min: 1,
      max: 12,
      step: 1
    },
    default: 6,
    onChange: rerender
  });

  game.settings.register(MODULE_ID, SETTINGS.showAllCombatants, {
    name: localize("GLUNI.Settings.ShowAllCombatants.Name"),
    hint: localize("GLUNI.Settings.ShowAllCombatants.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: rerender
  });

  game.settings.register(MODULE_ID, SETTINGS.delayedPlacement, {
    name: localize("GLUNI.Settings.DelayedPlacement.Name"),
    hint: localize("GLUNI.Settings.DelayedPlacement.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      bottom: localize("GLUNI.Settings.DelayedPlacement.Bottom"),
      side: localize("GLUNI.Settings.DelayedPlacement.Side")
    },
    default: "side",
    onChange: rerender
  });

  game.settings.register(MODULE_ID, SETTINGS.showDefeated, {
    name: localize("GLUNI.Settings.ShowDefeated.Name"),
    hint: localize("GLUNI.Settings.ShowDefeated.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: rerender
  });

  game.settings.register(MODULE_ID, SETTINGS.uiScale, {
    name: localize("GLUNI.Settings.UIScale.Name"),
    hint: localize("GLUNI.Settings.UIScale.Hint"),
    scope: "client",
    config: true,
    type: Number,
    range: {
      min: 0.5,
      max: 2.0,
      step: 0.05
    },
    default: 1,
    onChange: rerender
  });

  game.settings.register(MODULE_ID, SETTINGS.tokenOverlayShape, {
    name: localize("GLUNI.Settings.TokenOverlayShape.Name"),
    hint: localize("GLUNI.Settings.TokenOverlayShape.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      circle: localize("GLUNI.Settings.TokenOverlayShape.Circle"),
      square: localize("GLUNI.Settings.TokenOverlayShape.Square")
    },
    default: "circle",
    onChange: () => tokenOverlays?.forceRedraw()
  });

  game.settings.register(MODULE_ID, SETTINGS.turnMarkerEnabled, {
    name: localize("GLUNI.Settings.TurnMarker.Name"),
    hint: localize("GLUNI.Settings.TurnMarker.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => { tokenOverlays?.forceRedraw(); refreshNativeTurnMarkerSuppression(); }
  });

  game.settings.register(MODULE_ID, SETTINGS.startMarkerEnabled, {
    name: localize("GLUNI.Settings.StartMarker.Name"),
    hint: localize("GLUNI.Settings.StartMarker.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => tokenOverlays?.forceRedraw()
  });

  game.settings.register(MODULE_ID, SETTINGS.startConnectorEnabled, {
    name: localize("GLUNI.Settings.StartConnector.Name"),
    hint: localize("GLUNI.Settings.StartConnector.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => tokenOverlays?.forceRedraw()
  });

  game.settings.register(MODULE_ID, SETTINGS.conditionBadges, {
    name: localize("GLUNI.Settings.ConditionBadges.Name"),
    hint: localize("GLUNI.Settings.ConditionBadges.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: rerender
  });

  game.settings.register(MODULE_ID, SETTINGS.conditionBadgeLayout, {
    name: localize("GLUNI.Settings.ConditionBadgeLayout.Name"),
    hint: localize("GLUNI.Settings.ConditionBadgeLayout.Hint"),
    scope: "client",
    config: true,
    type: String,
    choices: {
      horizontal: localize("GLUNI.Settings.ConditionBadgeLayout.Horizontal"),
      vertical: localize("GLUNI.Settings.ConditionBadgeLayout.Vertical")
    },
    default: "horizontal",
    onChange: rerender
  });

  game.settings.register(MODULE_ID, SETTINGS.guardBreakSound, {
    name: localize("GLUNI.Settings.GuardBreakSound.Name"),
    hint: localize("GLUNI.Settings.GuardBreakSound.Hint"),
    scope: "world",
    config: true,
    type: String,
    filePicker: "audio",
    default: ""
  });

  game.settings.register(MODULE_ID, SETTINGS.guardBreakSoundVolume, {
    name: localize("GLUNI.Settings.GuardBreakSoundVolume.Name"),
    hint: localize("GLUNI.Settings.GuardBreakSoundVolume.Hint"),
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.8
  });

  game.settings.register(MODULE_ID, SETTINGS.theme, {
    name: localize("GLUNI.Settings.Theme.Name"),
    hint: localize("GLUNI.Settings.Theme.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [THEMES.scifi]:     localize("GLUNI.Settings.Theme.SciFi"),
      [THEMES.core]:      localize("GLUNI.Settings.Theme.Core"),
      [THEMES.fantasy]:   localize("GLUNI.Settings.Theme.Fantasy"),
      [THEMES.chronicle]: localize("GLUNI.Settings.Theme.Chronicle")
    },
    default: DEFAULT_THEME,
    onChange: () => applyTheme()
  });

  game.settings.register(MODULE_ID, SETTINGS.position, {
    scope: "client",
    config: false,
    type: Object,
    default: {
      x: null,
      y: 120
    },
    onChange: rerender
  });
}

function getConditionBadgesEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.conditionBadges) !== false;
  } catch {
    return true;
  }
}

function getConditionBadgeLayout() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.conditionBadgeLayout) === "vertical" ? "vertical" : "horizontal";
  } catch {
    return "horizontal";
  }
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

// WebGL renderer for the guard-break splash: a procedural glass-crack + shatter
// shockwave drawn additively over the existing CSS deck. It is purely
// decorative and self-contained — if a GL context can't be created the splash
// still works from CSS alone. One instance lives for the lifetime of a single
// splash element and tears itself down via destroy().
const BREAK_GL_VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Fullscreen sibling of FX_FRAG_BREAK (the card / token break overlay). Same
// Voronoi-shard glass fracture, warp, shatter front and flowing glow that read
// so well on the cards — scaled up to the whole screen. Output is premultiplied
// (col*a, a) and the layer is screen-blended in CSS so the shards glow over the
// amber deck. A hard impact envelope fades the whole thing out fast so it never
// sits frozen after the fracture lands.
const BREAK_GL_FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;       // seconds since start (keeps the glow flowing)
uniform float u_progress;   // 0..1 over the GL life
uniform float u_seed;       // per-splash randomization
uniform float u_intensity;  // 0..1 (default vs cinematic)
uniform vec3 u_break;       // amber
uniform vec3 u_hot;

vec2 gluHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p + u_seed) * 43758.5453);
}
float gluHash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453); }
float gluVNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gluHash1(i), gluHash1(i + vec2(1.0, 0.0)), f.x),
             mix(gluHash1(i + vec2(0.0, 1.0)), gluHash1(i + vec2(1.0, 1.0)), f.x), f.y);
}
float gluFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * gluVNoise(p); p *= 2.02; a *= 0.5; } return s; }

// Second-minus-first Voronoi distance: zero exactly on the cell seams -> crisp
// shard edges, identical to the card/token break.
float gluVoroEdge(vec2 x) {
  vec2 n = floor(x), f = fract(x); float f1 = 9.0, f2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = gluHash2(n + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return sqrt(f2) - sqrt(f1);
}

void main() {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 uv = v_uv;

  // Impact dead-centre on screen.
  vec2 impact = vec2(0.5);
  vec2 d = uv - impact; d.x *= aspect;
  float dist = length(d);
  float ang = atan(d.y, d.x);
  float texel = 1.0 / max(u_res.y, 1.0);

  // Warp the radius so the fracture front is irregular, not a clean circle.
  float warp = 0.16 * gluFbm(vec2(ang * 1.2 + 3.0, 1.7)) + 0.08 * gluFbm(vec2(ang * 3.3, 5.0)) - 0.12;
  float wdist = dist + warp;

  // Fast, snappy shatter front that sweeps out from the centre.
  float shatterT = clamp(u_progress * 2.6, 0.0, 1.0);
  shatterT = 1.0 - pow(1.0 - shatterT, 3.0);
  float reach = mix(1.6, 1.95, u_intensity);
  float frontR = 0.05 + reach * shatterT;
  float front = smoothstep(0.07, -0.07, wdist - frontR);
  float coverage = smoothstep(1.75, 0.06, wdist) * front;

  // Coarse shards: large bold cells near the impact, finer toward the rim.
  float scaleC = mix(6.0, 3.0, smoothstep(0.0, 1.0, dist));
  float ceC = gluVoroEdge(vec2(uv.x * aspect, uv.y) * scaleC + 7.0);
  float edgeC = 1.0 - smoothstep(0.0, max(0.011, 1.5 * scaleC * texel), ceC);

  // Fine shards: a denser second octave that snaps in slightly later for detail.
  float scaleF = scaleC * 2.5;
  float ceF = gluVoroEdge(vec2(uv.x * aspect, uv.y) * scaleF + 21.0);
  float edgeF = 1.0 - smoothstep(0.0, max(0.011, 1.5 * scaleF * texel), ceF);
  float fineGate = smoothstep(0.28, 0.72, shatterT) * 0.6;
  float shards = max(edgeC, edgeF * fineGate) * coverage;

  // Bold radial cracks shooting straight out from the centre, jittered so they
  // wander like real glass and growing with the shatter front.
  float radial = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float a0 = (fi + gluHash1(vec2(fi, 3.0)) * 0.8) * 6.28318530 / 7.0;
    float jit = (gluVNoise(vec2(dist * 5.5, fi * 2.0 + 1.0)) - 0.5) * 0.45 * smoothstep(0.04, 0.4, dist);
    float da = atan(sin(ang - a0 - jit), cos(ang - a0 - jit));
    float w = mix(0.004, 0.013, gluHash1(vec2(fi, 9.0))) / max(dist, 0.05);
    float along = smoothstep(frontR * 1.05, frontR * 0.3, dist);
    radial = max(radial, smoothstep(w, 0.0, abs(da)) * along);
  }
  float crack = max(shards, radial * front);

  // Expanding shockwave ring riding the fracture front.
  float ring = smoothstep(0.05, 0.0, abs(dist - frontR)) * smoothstep(0.04, 0.3, shatterT) * (1.0 - shatterT * 0.5);

  // Flowing glow + twinkling glints keep the fracture alive, never frozen.
  float settled = smoothstep(0.4, 1.0, shatterT);
  float flow = pow(0.5 + 0.5 * sin(dist * 15.0 - u_time * 7.0), 8.0);
  float glints = pow(0.5 + 0.5 * sin(ang * 38.0 + dist * 26.0 - u_time * 5.0), 18.0) * crack;
  float glowFlow = crack * flow * settled + glints * 0.85;

  // Punchy white-hot impact core + flash, both gone almost instantly.
  float core = smoothstep(0.17, 0.0, dist) * (1.0 - smoothstep(0.0, 0.10, u_progress));
  float flash = smoothstep(0.72, 0.0, dist) * (1.0 - smoothstep(0.0, 0.16, u_progress));

  // Hard hit, then a quick fade-out so nothing lingers static.
  float env = 1.0 - smoothstep(0.30, 0.66, u_progress);

  vec3 amber = u_break, hot = u_hot, white = vec3(1.0);
  vec3 col = mix(amber, hot, clamp(crack + ring * 0.6, 0.0, 1.0));
  col = mix(col, white, clamp(core + glowFlow, 0.0, 1.0));
  float a = clamp(crack * 0.92 + core * 0.9 + glowFlow * 0.7 + flash * 0.5 + ring * 0.55, 0.0, 1.0) * env;
  gl_FragColor = vec4(col * a, a);
}`;

// Playback shader: the heavy fracture above is rendered ONCE per animation step
// into its own texture (see BreakSplashGL.bake); at play time we just blit the
// pre-baked frame. The fracture is baked square (aspect 1) so this cover-fits it
// to any viewport without turning the impact circle into an ellipse.
const BREAK_GL_PLAY_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;   // baked frame A
uniform sampler2D u_texB;  // baked frame B (next step)
uniform float u_mix;       // 0..1 A->B, so few baked frames still play smoothly
uniform vec2 u_cover;      // (vw/max, vh/max): centre-crop the square to cover
void main() {
  vec2 uv = (v_uv - 0.5) * u_cover + 0.5;
  // Both frames are already premultiplied (col*a, a); a lerp stays valid.
  gl_FragColor = mix(texture2D(u_tex, uv), texture2D(u_texB, uv), u_mix);
}`;

// Downsample pass for the supersampled splash bake: sample the 2x scratch texture
// (LINEAR) at the stored resolution to box-average each 2x2 block, anti-aliasing
// the procedural cracks/shards that polygon MSAA can't touch.
const BREAK_GL_DOWNSAMPLE_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_src;
void main() { gl_FragColor = texture2D(u_src, v_uv); }`;

// Bake resolution / step count for the pre-rendered fracture. The splash is a
// full-screen burst, so it needs a decent baked resolution or it looks blurry and
// aliased once cover-fit to the viewport; 1024² is sharp at 1080p and crisp to
// ~1440p, and it's rendered at SS× then averaged down so the cracks don't alias.
// Frames are cross-faded at playback (see frame()), so a modest count stays smooth.
// Memory is ~16 * 1024² * 4 ≈ 67MB of GPU textures (down from ~118MB) — a meaningful
// VRAM saving on mid-tier GPUs, and the SS scratch (transient) drops from 2560² to
// 2048², which also shortens the one-time startup bake.
const SPLASH_BAKE_SIZE = 1024;
const SPLASH_BAKE_FRAMES = 16;
const SPLASH_BAKE_SS = 2;

// One persistent renderer is reused across every guard break. The (fairly heavy)
// Voronoi/fbm fracture shader is compiled AND fully evaluated exactly once at
// load: every animation step is rendered into its own texture, then the live
// splash just blits the matching pre-baked frame each tick. Running that
// full-screen procedural field every frame on every break is what caused the
// performance hiccup; baking removes the per-frame shader cost entirely.
// Self-contained — if a GL context can't be created the splash works from CSS alone.
class BreakSplashGL {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gluni-break-splash-gl";
    this.canvas.setAttribute("aria-hidden", "true");
    this.lifeMs = 1050;
    this.raf = 0;
    this.start = 0;
    this.host = null;
    this.gl = null;
    this.playProgram = null;
    this.frames = [];          // one baked WebGL texture per animation step
    this.uniforms = {};
    this.cover = [1, 1];
    this.onResize = () => this.resize();

    this.colors = {
      break: [...ACTIVE_SHADER_PALETTE.splashHot],
      hot:   [...ACTIVE_SHADER_PALETTE.splashGlow]
    };
    this._bakeBuffer = null;

    this.init();
  }

  // Re-render the baked fracture frames using the current ACTIVE_SHADER_PALETTE.
  // Cheap — costs the one-time bake (~tens of ms) per theme switch.
  rebake() {
    const gl = this.gl;
    if (!gl || !this._bakeBuffer) return false;
    for (const t of this.frames) { try { gl.deleteTexture(t); } catch {} }
    this.frames = [];
    this.colors = {
      break: [...ACTIVE_SHADER_PALETTE.splashHot],
      hot:   [...ACTIVE_SHADER_PALETTE.splashGlow]
    };
    return this.bake(gl, this._bakeBuffer);
  }

  init() {
    const opts = { alpha: true, premultipliedAlpha: true, antialias: false };
    const gl = this.canvas.getContext("webgl", opts) || this.canvas.getContext("experimental-webgl", opts);
    if (!gl) return false;
    this.gl = gl;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this._bakeBuffer = buffer;

    // Pay the heavy shader's full cost once, here at load: render every animation
    // step into its own texture. After this the fracture shader is never run again.
    if (!this.bake(gl, buffer)) {
      this.gl = null;
      return false;
    }

    // Lightweight playback program used per-frame at play time.
    const play = this.buildProgram(gl, BREAK_GL_VERT, BREAK_GL_PLAY_FRAG);
    if (!play) {
      this.gl = null;
      return false;
    }
    this.playProgram = play;
    gl.useProgram(play);
    const loc = gl.getAttribLocation(play, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = {
      tex: gl.getUniformLocation(play, "u_tex"),
      texB: gl.getUniformLocation(play, "u_texB"),
      mix: gl.getUniformLocation(play, "u_mix"),
      cover: gl.getUniformLocation(play, "u_cover")
    };
    gl.uniform1i(this.uniforms.tex, 0);
    gl.uniform1i(this.uniforms.texB, 1);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Premultiplied source-over (baked frames store col*a, a); CSS screen-blends
    // the canvas so the bright shards glow over the amber deck.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.resize();
    window.addEventListener("resize", this.onResize);
    return true;
  }

  // Render SPLASH_BAKE_FRAMES steps of the heavy fracture shader into individual
  // textures through an off-screen framebuffer. Each step is rendered at SS× into a
  // scratch texture and box-averaged down into the stored frame, so the procedural
  // cracks come out anti-aliased. Square (aspect 1) so playback can cover-fit any
  // viewport. Blending is disabled so the premultiplied fragment (col*a, a) is
  // written verbatim for later blitting.
  bake(gl, buffer) {
    const bakeProgram = this.buildProgram(gl, BREAK_GL_VERT, BREAK_GL_FRAG);
    const downProgram = this.buildProgram(gl, BREAK_GL_VERT, BREAK_GL_DOWNSAMPLE_FRAG);
    if (!bakeProgram || !downProgram) return false;

    const S = SPLASH_BAKE_SIZE;
    const hiRes = S * SPLASH_BAKE_SS;
    const bakeLoc = gl.getAttribLocation(bakeProgram, "a_pos");
    const downLoc = gl.getAttribLocation(downProgram, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    gl.useProgram(bakeProgram);
    const u = name => gl.getUniformLocation(bakeProgram, name);
    gl.uniform2f(u("u_res"), hiRes, hiRes);
    gl.uniform1f(u("u_seed"), Math.random() * 100);
    // Bake the fuller cinematic field; the calmer tiers read fine from the same frames.
    gl.uniform1f(u("u_intensity"), 1.0);
    gl.uniform3fv(u("u_break"), this.colors.break);
    gl.uniform3fv(u("u_hot"), this.colors.hot);
    const uProgress = u("u_progress"), uTime = u("u_time");

    gl.useProgram(downProgram);
    gl.uniform1i(gl.getUniformLocation(downProgram, "u_src"), 0);

    // Scratch hi-res target the fracture is rendered into before averaging down.
    const temp = this.makeTexture(gl, hiRes);
    const fbo = gl.createFramebuffer();
    gl.disable(gl.BLEND);

    const refLifeSec = 1.05;   // reference GL life the flowing-glow term is baked against
    let ok = true;
    for (let i = 0; i < SPLASH_BAKE_FRAMES; i++) {
      const tex = this.makeTexture(gl, S);
      const progress = (i / (SPLASH_BAKE_FRAMES - 1)) * 1.05;

      // 1) heavy fracture -> hi-res scratch
      gl.useProgram(bakeProgram);
      gl.enableVertexAttribArray(bakeLoc);
      gl.vertexAttribPointer(bakeLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { ok = false; gl.deleteTexture(tex); break; }
      gl.viewport(0, 0, hiRes, hiRes);
      gl.uniform1f(uProgress, progress);
      gl.uniform1f(uTime, progress * refLifeSec);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2) box-average scratch -> stored frame
      gl.useProgram(downProgram);
      gl.enableVertexAttribArray(downLoc);
      gl.vertexAttribPointer(downLoc, 2, gl.FLOAT, false, 0, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, S, S);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, temp);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.frames.push(tex);
    }
    gl.finish();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(temp);
    gl.deleteProgram(bakeProgram);
    gl.deleteProgram(downProgram);

    if (!ok) {
      for (const t of this.frames) gl.deleteTexture(t);
      this.frames = [];
      return false;
    }
    return true;
  }

  // Allocate an empty RGBA texture with edge clamping + linear filtering.
  makeTexture(gl, size) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  get available() {
    return !!this.gl && this.frames.length > 0;
  }

  // Attach the persistent canvas to a splash element and play back the baked
  // frames. A second guard break that lands mid-cycle steals the canvas from the
  // previous splash (whose CSS text/deck keep animating without the GL layer).
  play(host, { lifeMs = 1050 } = {}) {
    if (!this.available || !host) return false;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.detach();

    this.host = host;
    this.lifeMs = Math.max(400, lifeMs);

    // Insert just after the burst so stacking matches the old inline canvas.
    const burst = host.querySelector(".gluni-break-splash-burst");
    if (burst && burst.nextSibling) host.insertBefore(this.canvas, burst.nextSibling);
    else host.insertBefore(this.canvas, host.firstChild);

    this.resize();
    this.start = performance.now();
    this.raf = window.requestAnimationFrame(() => this.frame());
    return true;
  }

  detach() {
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.host = null;
  }

  // Stop the current cycle but keep the context/baked frames alive for reuse.
  // Only honours the request if `host` still owns the canvas (guards against a
  // newer splash that has already taken it over).
  stop(host = null) {
    if (host && this.host !== host) return;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.detach();
  }

  buildProgram(gl, vertSrc, fragSrc) {
    const vert = this.compile(gl, gl.VERTEX_SHADER, vertSrc);
    const frag = this.compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!vert || !frag) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(`${MODULE_ID} | break-splash GL link failed`, gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  compile(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(`${MODULE_ID} | break-splash GL compile failed`, gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  resize() {
    const gl = this.gl;
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    // Centre-crop the square baked frame to cover the viewport (keeps the impact
    // circle circular at any aspect ratio).
    const m = Math.max(w, h);
    this.cover = [w / m, h / m];
  }

  frame() {
    const gl = this.gl;
    if (!gl) return;
    const elapsed = performance.now() - this.start;
    const progress = elapsed / this.lifeMs;
    const last = this.frames.length - 1;
    const fpos = Math.max(0, Math.min(last, (progress / 1.05) * last));
    const i = Math.min(last, Math.floor(fpos));
    const j = Math.min(last, i + 1);
    gl.useProgram(this.playProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frames[i]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.frames[j]);
    gl.uniform1f(this.uniforms.mix, fpos - i);
    gl.uniform2f(this.uniforms.cover, this.cover[0], this.cover[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (progress >= 1.05) {
      this.stop();
      return;
    }
    this.raf = window.requestAnimationFrame(() => this.frame());
  }

  destroy() {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.detach();
    window.removeEventListener("resize", this.onResize);
    const gl = this.gl;
    this.gl = null;
    if (gl) {
      for (const t of this.frames) {
        try { gl.deleteTexture(t); } catch { /* best-effort cleanup */ }
      }
      this.frames = [];
      try {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

// Lazily build (and cache) the single shared break-splash renderer. Returns null
// if WebGL is unavailable so callers fall back to the CSS-only splash.
let breakSplashRenderer;
function getBreakSplashRenderer() {
  if (breakSplashRenderer === undefined) {
    const renderer = new BreakSplashGL();
    breakSplashRenderer = renderer.available ? renderer : null;
  }
  return breakSplashRenderer;
}

function isRelevantCombatantUpdate(changed) {
  if (!changed || typeof changed !== "object") return true;
  const keys = Object.keys(changed);
  if (!keys.length) return true;
  return keys.some(key => COMBATANT_RENDER_UPDATE_KEYS.has(key));
}

// Resolve the owning Actor of an ActiveEffect. The effect's parent is either the
// Actor itself (status effects applied to the token/actor) or an owned Item
// whose parent is the actor. Returns null for world/compendium effects.
function resolveEffectActor(effect) {
  const parent = effect?.parent;
  if (!parent) return null;
  if (parent.documentName === "Actor") return parent;
  if (parent.parent?.documentName === "Actor") return parent.parent;
  return parent.actor ?? null;
}

function isRelevantActorUpdate(changed) {
  if (!changed || typeof changed !== "object") return true;
  const keys = Object.keys(changed);
  if (!keys.length) return true;
  if (!keys.some(key => ACTOR_RENDER_UPDATE_KEYS.has(key))) return false;
  if (changed.name !== undefined || changed.img !== undefined || changed.prototypeToken !== undefined || changed.system !== undefined || changed.items !== undefined) return true;
  return Boolean(changed.flags?.[MODULE_ID] || foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${FLAGS.portraitFrame}`));
}

function addGuardBreakTokenHudButton(hud, html, data) {
  if (!game.user.isGM) return;

  const element = getHTMLElement(html);
  const token = hud?.object ?? canvas?.scene?.tokens?.get(data?._id ?? "")?.object ?? null;
  if (!element || !token?.document) return;
  if (element.querySelector(".gluni-token-guard-break")) return;

  const combatant = getCombatantForToken(game.combat, token);
  const isBroken = Boolean(combatant && getGuardBreakState(combatant));

  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon gluni-token-guard-break${isBroken ? " active" : ""}`;
  button.title = localize(isBroken ? "GLUNI.Controls.ClearGuardBreak" : "GLUNI.Controls.GuardBreak");
  button.ariaLabel = localize("GLUNI.Controls.TokenGuardBreak");
  button.dataset.tooltip = localize("GLUNI.Controls.TokenGuardBreak");
  button.innerHTML = '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>';
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;

    button.disabled = true;
    try {
      await toggleTokenHudGuardBreak(token, button);
    } finally {
      button.disabled = false;
    }
  });

  const column = element.querySelector(".col.right") ?? element.querySelector(".right") ?? element;
  column.append(button);
}

async function toggleTokenHudGuardBreak(token, button) {
  const combat = game.combat ?? null;
  if (!combat?.started) {
    ui.notifications?.warn(localize("GLUNI.Controls.TokenGuardBreak.NoCombat"));
    return;
  }

  const combatant = getCombatantForToken(combat, token);
  if (!combatant || isAdhocCombatant(combatant)) {
    ui.notifications?.warn(localize("GLUNI.Controls.TokenGuardBreak.NoCombatant"));
    return;
  }

  const wasBroken = Boolean(getGuardBreakState(combatant));
  if (wasBroken) await overlay?.clearGuardBreak(combatant);
  else await overlay?.applyGuardBreak(combatant);

  const isBroken = !wasBroken;
  button?.classList.toggle("active", isBroken);
  if (button) button.title = localize(isBroken ? "GLUNI.Controls.ClearGuardBreak" : "GLUNI.Controls.GuardBreak");
}

function addBreakGaugeTokenHudButton(hud, html, data) {
  if (!game.user.isGM) return;

  const element = getHTMLElement(html);
  const token = hud?.object ?? canvas?.scene?.tokens?.get(data?._id ?? "")?.object ?? null;
  if (!element || !token?.document) return;
  if (element.querySelector(".gluni-token-break-gauge")) return;

  const combatant = getCombatantForToken(game.combat, token);
  const hasGauge = Boolean(combatant && getBreakGaugeState(combatant));

  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon gluni-token-break-gauge${hasGauge ? " active" : ""}`;
  button.title = localize("GLUNI.Controls.TokenBreakGauge");
  button.ariaLabel = localize("GLUNI.Controls.TokenBreakGauge");
  button.dataset.tooltip = localize("GLUNI.Controls.TokenBreakGauge");
  button.innerHTML = '<i class="fa-solid fa-gauge-high" aria-hidden="true"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openTokenBreakGaugeEditor(token, button);
  });

  const column = element.querySelector(".col.right") ?? element.querySelector(".right") ?? element;
  column.append(button);
}

function openTokenBreakGaugeEditor(token, button) {
  const combat = game.combat ?? null;
  if (!combat?.started) {
    ui.notifications?.warn(localize("GLUNI.Controls.TokenGuardBreak.NoCombat"));
    return;
  }

  const combatant = getCombatantForToken(combat, token);
  if (!combatant || isAdhocCombatant(combatant)) {
    ui.notifications?.warn(localize("GLUNI.Controls.TokenGuardBreak.NoCombatant"));
    return;
  }

  openBreakGaugeEditor(combatant, button?.getBoundingClientRect?.() ?? null);
}

function getCombatantForToken(combat, token, combatants = getCombatantList(combat)) {
  const direct = token?.document?.combatant ?? token?.combatant ?? null;
  if (direct?.id && combat?.combatants?.get?.(direct.id)) return direct;

  const document = token?.document ?? token;
  const tokenId = document?.id ?? token?.id ?? null;
  const sceneId = document?.parent?.id ?? document?.scene?.id ?? canvas?.scene?.id ?? null;
  const actorId = token?.actor?.id ?? document?.actor?.id ?? document?.actorId ?? null;

  if (tokenId) {
    const exact = combatants.find(combatant => {
      const combatantTokenId = combatant.token?.id ?? combatant.tokenId ?? null;
      if (combatantTokenId !== tokenId) return false;

      const combatantSceneId = getCombatantSceneId(combatant);
      return !sceneId || !combatantSceneId || combatantSceneId === sceneId;
    });
    if (exact) return exact;
  }

  if (!actorId) return null;

  const actorMatches = combatants.filter(combatant => {
    const combatantActorId = combatant.actor?.id ?? combatant.actorId ?? null;
    return combatantActorId === actorId;
  });
  if (actorMatches.length === 1) return actorMatches[0];

  const sceneMatches = actorMatches.filter(combatant => {
    const combatantSceneId = getCombatantSceneId(combatant);
    return !sceneId || !combatantSceneId || combatantSceneId === sceneId;
  });
  return sceneMatches.length === 1 ? sceneMatches[0] : null;
}

function getCombatantList(combat) {
  return Array.from(combat?.combatants?.contents ?? combat?.combatants ?? [])
    .map(entry => Array.isArray(entry) ? entry[1] : entry)
    .filter(Boolean);
}

function getCombatantSceneId(combatant) {
  return combatant?.scene?.id ?? combatant?.sceneId ?? combatant?.token?.parent?.id ?? combatant?.token?.scene?.id ?? null;
}

class GLUniverseInitiativeOverlay {
  constructor() {
    this.root = null;
    this.drag = null;
    this.renderTimer = null;
    this.lastRound = game.combat?.round ?? null;
    this.lastRenderedRound = game.combat?.round ?? null;
    this.lastTurnKey = "";
    this.lastActiveId = null;
    this.lastActiveKey = null;
    this.lastActiveInitiative = null;
    this.pendingDelayReturnId = null;
    this.lastMarkup = "";
    this.lastRootClassName = "";
    this.lastPositionStyle = null;
    this.adhocSkipTimer = null;
    this.guardBreakClearTimer = null;
    this.pendingGuardBreakImpactId = null;
    this.cardDrag = null;
    this.contextMenu = null;
    this.pendingSlideInIds = new Set();
    this.pendingDyingWipeIds = new Set();
    this.pendingStatusFlashes = new Map();
    this.lastDyingIds = new Set();
    this.lastDelayedIds = new Set();
    this.lastBrokenIds = new Set();
    this.lastConditionKeys = new Map();
    this.pendingConditionFlashes = new Map();
    this.recentStatusAnimations = new Map();
    this.statusSnapshotInitialized = false;
    this.handledEndTurnRequests = new Set();
  }

  mount() {
    if (this.root) return;

    this.root = document.createElement("aside");
    this.root.id = "gluni-initiative";
    // The rail is a labelled landmark, not a live region: it is rebuilt wholesale
    // on every render, so making the whole element aria-live would spam screen
    // readers with the entire card list on each tick. Turn/round changes are
    // announced through a dedicated, atomic status region instead (see below).
    this.root.setAttribute("aria-label", localize("GLUNI.A11y.OverlayLabel"));
    document.body.appendChild(this.root);

    this.announcer = document.createElement("div");
    this.announcer.id = "gluni-initiative-announcer";
    this.announcer.className = "gluni-sr-only";
    this.announcer.setAttribute("role", "status");
    this.announcer.setAttribute("aria-live", "polite");
    this.announcer.setAttribute("aria-atomic", "true");
    document.body.appendChild(this.announcer);
    this.lastAnnouncement = "";

    this.root.addEventListener("click", event => this.onClick(event));
    this.root.addEventListener("contextmenu", event => this.onContextMenu(event));
    this.root.addEventListener("pointerdown", event => this.onPointerDown(event));
    this.root.addEventListener("mouseover", event => this.onCardHover(event, true));
    this.root.addEventListener("mouseout", event => this.onCardHover(event, false));

    // Socket wiring is registered once from onReady() via core's shared
    // dispatcher (onSocket("initiative", ...)) — see handleSocket below.
  }

  // Dispatched by the suite's shared socket channel (core/socket.mjs) for the
  // "initiative" feature. Payloads are the same shapes previously emitted on the
  // per-module channel; the core wrapper strips its own __feature tag.
  handleSocket(data) {
    if (data?.type === "refresh") this.renderSoon();
    if (data?.type === "roundSplash") this.showRoundSplash(data.round);
    if (data?.type === "guardBreakImpact") this.queueGuardBreakImpact(data);
    if (data?.type === "breakSplash") this.showBreakSplash(data.name);
    if (data?.type === "statusAnimation") this.queueStatusAnimation(data);
    if (data?.type === "requestEndTurn") this.onSocketEndTurnRequest(data);
    if (data?.type === "requestCardSwap") this.onSocketCardSwapRequest(data);
  }

  get combat() {
    return game.combat ?? null;
  }

  get enabled() {
    return Boolean(game.settings.get(MODULE_ID, SETTINGS.enabled));
  }

  hasCombatActor(actor) {
    if (!actor) return false;
    const combatants = this.combat?.combatants?.contents ?? Array.from(this.combat?.combatants ?? []);
    return combatants.some(entry => {
      const combatant = Array.isArray(entry) ? entry[1] : entry;
      return combatant?.actor?.id === actor.id || combatant?.actorId === actor.id;
    });
  }

  onActorItemChange(actor) {
    if (this.hasCombatActor(actor)) this.renderSoon();
  }

  renderSoon() {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.render(), 30);
  }

  onCombatUpdate(combat, changed) {
    if (changed?.started === true) {
      this.showRoundSplash(combat.round ?? 1);
    }

    if (typeof changed?.round === "number" && changed.round !== this.lastRound) {
      this.showRoundSplash(changed.round);
      this.lastRound = changed.round;
    }

    // Card mode: (re)deal when combat starts or the round changes. Self-guards to
    // the primary GM and is a no-op when the current deal already matches.
    if (this.isCardMode() && (changed?.started === true || typeof changed?.round === "number")) {
      this.maybeRedealCards(combat);
    }

    if (game.user.isGM && (typeof changed?.turn === "number" || typeof changed?.round === "number")) {
      this.skipInactiveAdhocTurnSoon();
      this.clearActiveGuardBreakSoon();
    }

    if (typeof changed?.turn === "number" || typeof changed?.round === "number" || changed?.started === true) {
      this.captureTurnStartPosition(combat);
    }

    if (changed?.started !== undefined) refreshNativeTurnMarkerSuppression();

    this.renderSoon();
  }

  // Records where the newly-active combatant's token sits at the moment its turn
  // begins, so every client can draw the "started here" ground marker. Written to
  // a single Combat flag by the primary active GM only — with multiple GMs logged
  // in, exactly one writes it (no races); everyone else reads it. Survives reload
  // because it lives on the Combat document.
  captureTurnStartPosition(combat) {
    if (!combat?.started || !game.user.isGM || !this.isPrimaryActiveGM()) return;

    const combatant = combat.combatant;
    const token = combatant ? getCombatantTokenObject(combatant) : null;
    const existing = combat.getFlag(MODULE_ID, FLAGS.turnStart) ?? null;

    if (!token || !token.center) {
      // No locatable token (off-scene / tokenless ad hoc): clear any stale origin
      // so a previous turn's marker doesn't linger on the wrong creature.
      if (existing) combat.unsetFlag(MODULE_ID, FLAGS.turnStart).catch(() => {});
      return;
    }

    const round = Number(combat.round) || 1;
    const turn = Number.isInteger(combat.turn) ? combat.turn : 0;
    if (
      existing &&
      existing.combatantId === combatant.id &&
      existing.round === round &&
      existing.turn === turn
    ) return;

    combat.setFlag(MODULE_ID, FLAGS.turnStart, {
      combatantId: combatant.id,
      tokenId: token.id,
      cx: token.center.x,
      cy: token.center.y,
      round,
      turn
    }).catch(() => {});
  }

  // Resolves the active and next ground-marker targets for THIS client, reusing
  // buildCombatantCard so visibility (hidden -> omitted, mystery -> secret colour)
  // and disposition are resolved exactly as the rail does. Scans far enough to
  // find the next actor regardless of the visibleCount setting, wraps rounds, and
  // skips defeated/delayed/hidden combatants silently (no perceivable gap).
  getTurnMarkerTargets(combat) {
    const result = { active: null, next: null };
    if (!combat?.started) return result;

    if (this.isCardMode()) {
      const cardTargets = this.getCardTurnMarkerTargets(combat);
      if (cardTargets) return cardTargets;
    }

    const sourceTurns = Array.isArray(combat.turns) && combat.turns.length
      ? combat.turns
      : combat.combatants?.contents ?? Array.from(combat.combatants ?? []);
    const turns = Array.from(sourceTurns)
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .filter(Boolean);
    if (!turns.length) return result;

    const showDefeated = Boolean(game.settings.get(MODULE_ID, SETTINGS.showDefeated));
    const currentTurn = Number.isInteger(combat.turn) ? combat.turn : 0;
    const activeId = combat.combatant?.id ?? turns[currentTurn]?.id ?? null;
    const currentRound = Number(combat.round) || 1;

    const eligible = combatant => {
      if (!combatant) return false;
      if (combatant.defeated && !showDefeated) return false;
      if (this.isDelayed(combatant)) return false;
      return true;
    };

    const toTarget = (combatant, displayRound, active) => {
      const card = this.buildCombatantCard(combatant, {
        active,
        delayed: false,
        roundOffset: displayRound - currentRound,
        displayRound,
        key: `marker:${combatant.id}`
      });
      if (!card) return null;   // hidden from this client
      return { combatantId: combatant.id, disposition: card.disposition, mystery: card.mystery };
    };

    const maxScan = turns.length * 4;
    for (let step = 0; step < maxScan; step++) {
      const absoluteIndex = currentTurn + step;
      const turnIndex = modulo(absoluteIndex, turns.length);
      const combatant = turns[turnIndex];
      const displayRound = currentRound + Math.floor(absoluteIndex / turns.length);

      if (step === 0) {
        if (combatant?.id === activeId && eligible(combatant) && shouldShowAdhocOnRound(combatant, displayRound)) {
          result.active = toTarget(combatant, displayRound, true);
        }
        continue;
      }

      if (!eligible(combatant) || !shouldShowAdhocOnRound(combatant, displayRound)) continue;
      if (combatant.id === activeId) continue;   // single combatant: no distinct next
      const next = toTarget(combatant, displayRound, false);
      if (next) { result.next = next; break; }
    }

    return result;
  }

  // Card-mode marker targets: active is the slot under the pointer, next is the
  // following eligible slot in the dealt order (no wrap — the next round is
  // reshuffled and unknown).
  getCardTurnMarkerTargets(combat) {
    const deal = this.getCardDeal(combat);
    if (!deal) return null;

    const showDefeated = Boolean(game.settings.get(MODULE_ID, SETTINGS.showDefeated));
    const currentRound = Number(combat.round) || 1;
    const result = { active: null, next: null };

    const toTarget = (combatant, active) => {
      if (!combatant) return null;
      if (combatant.defeated && !showDefeated) return null;
      const card = this.buildCombatantCard(combatant, {
        active,
        delayed: false,
        roundOffset: 0,
        displayRound: currentRound,
        key: `marker:${combatant.id}`
      });
      if (!card) return null;
      return { combatantId: combatant.id, disposition: card.disposition, mystery: card.mystery };
    };

    for (let index = deal.pointer; index < deal.sequence.length; index++) {
      const combatant = combat.combatants?.get(deal.sequence[index].cid);
      if (index === deal.pointer) { result.active = toTarget(combatant, true); continue; }
      const next = toTarget(combatant, false);
      if (next && next.combatantId !== result.active?.combatantId) { result.next = next; break; }
    }

    return result;
  }

  render() {
    if (!this.root) return;
    this.renderTimer = null;

    const combat = this.combat;
    // GMs get the tracker the moment a combat has any combatants — before the
    // encounter starts — so they can stage rail placement and per-combatant
    // visibility (hide/mystery) privately. Players only ever see it once combat
    // has actually started.
    const hasCombatants = Boolean(combat?.combatants?.size);
    const hasActiveCombat = hasCombatants && (Boolean(combat?.started) || game.user.isGM);

    if (!this.enabled || !hasActiveCombat) {
      this.finishCardDrag();
      this.closeInitiativeContextMenu();
      closeBreakGaugeEditor();
      this.root.className = "gluni-initiative gluni-initiative--hidden";
      if (this.lastMarkup) {
        this.root.innerHTML = "";
        this.lastMarkup = "";
      }
      this.lastRootClassName = this.root.className;
      this.clearAnnouncement();
      tokenOverlays?.refresh();
      cardFX?.clear();
      return;
    }

    const settings = this.getRenderSettings();
    const view = this.buildViewModel(combat, settings);
    this.detectStatusTransitions();
    const turnKey = view.normal.map(item => item.key ?? `${item.type}:${item.round}`).join("|");
    const isTurnChange = this.lastTurnKey && turnKey !== this.lastTurnKey;
    const previousRenderedRound = this.lastRenderedRound;
    const roundDelta = Number.isFinite(previousRenderedRound) ? Math.max(0, (combat.round ?? 1) - previousRenderedRound) : 0;
    const previousActiveKey = this.lastActiveKey;
    const previousActiveInitiative = this.lastActiveInitiative ?? null;
    const isDelayReturn = Boolean(this.pendingDelayReturnId && view.activeId === this.pendingDelayReturnId);
    const isCardView = Boolean(view.cardMode);
    // A reshuffle is signalled purely by the deal flag's round advancing: the
    // whole sequence was re-dealt. (The combat round + deal often update together,
    // so leaning on roundDelta here would miss the render that shows the new
    // order.) Drives the collect -> shuffle -> deal beat.
    const isReshuffle = isCardView
      && Number.isFinite(this.lastDealRound) && view.dealRound > this.lastDealRound;
    const rootClassName = [
      "gluni-initiative",
      `gluni-initiative--${settings.edge}`,
      settings.isGM ? "gluni-initiative--gm" : "gluni-initiative--player",
      isCardView ? "gluni-initiative--card-mode" : "",
      settings.delayedPlacement === "side" ? "gluni-initiative--delayed-side" : "",
      isTurnChange ? "gluni-initiative--turn-change" : "",
      isDelayReturn ? "gluni-initiative--delay-return" : ""
    ].filter(Boolean).join(" ");
    const markup = this.renderMarkup(combat, view, settings);
    const markupChanged = markup !== this.lastMarkup;
    const shouldAnimateTurnChange = isTurnChange && markupChanged && !prefersReducedMotion();
    const oldRects = shouldAnimateTurnChange ? this.captureItemRects() : new Map();
    // Card mode collect/deal beats fly clones of the outgoing cards into (and new
    // cards out of) the deck stub, so snapshot the rail's current look + geometry
    // before the markup is swapped out.
    const cardSnapshot = (isCardView && shouldAnimateTurnChange) ? this.snapshotRailCards() : null;
    this.lastTurnKey = turnKey;

    if (rootClassName !== this.lastRootClassName) {
      this.root.className = rootClassName;
      this.lastRootClassName = rootClassName;
    }

    this.applyUIScale(settings.uiScale);
    this.applyPosition(settings.edge);

    if (markupChanged) {
      this.closeInitiativeContextMenu();
      this.root.innerHTML = markup;
      this.lastMarkup = markup;
      this.positionFloatingControls();
      this.reacquireCardDragAfterRender();
    }

    if (shouldAnimateTurnChange) {
      this.animateTurnChange(oldRects, {
        previousActiveKey,
        isDelayReturn,
        roundDelta,
        edge: settings.edge,
        previousActiveInitiative
      });
    }
    if (cardSnapshot) {
      this.playCardModeMotion(cardSnapshot, { isReshuffle, edge: settings.edge });
    }
    this.lastDealRound = isCardView ? view.dealRound : null;
    this.playPendingGuardBreakImpact();
    this.playPendingSlideIns();
    this.playPendingDyingWipes();
    this.playPendingConditionFlashes();
    this.lastActiveId = view.activeId;
    this.lastActiveKey = view.activeKey;
    this.lastActiveInitiative = this.getActiveInitiative(view);
    this.lastRenderedRound = combat.round ?? null;
    if (isDelayReturn) this.pendingDelayReturnId = null;
    tokenOverlays?.refresh();
    cardFX?.sync(this.root);
    this.animateGaugeChanges();
    this.updateAnnouncement(combat);
  }

  // Announce the current round + active combatant to assistive tech through the
  // dedicated status region. The active name is read back from the just-rendered
  // DOM, so it automatically inherits the viewer's visibility rules (a mystery
  // card already reads "Unknown"; a card hidden from this user is simply absent,
  // in which case only the round is announced). De-duplicated so an unchanged
  // turn never re-speaks on incidental re-renders.
  updateAnnouncement(combat) {
    if (!this.announcer) return;
    const round = combat?.round ?? null;
    if (round == null) { this.clearAnnouncement(); return; }
    const activeName = this.root?.querySelector(".gluni-card--active h3")?.textContent?.trim() || "";
    const text = activeName
      ? formatLocalized("GLUNI.A11y.TurnAnnouncement", { round, name: activeName })
      : formatLocalized("GLUNI.A11y.RoundAnnouncement", { round });
    if (text && text !== this.lastAnnouncement) {
      this.announcer.textContent = text;
      this.lastAnnouncement = text;
    }
  }

  clearAnnouncement() {
    if (this.announcer && this.lastAnnouncement) {
      this.announcer.textContent = "";
      this.lastAnnouncement = "";
    }
  }

  // The gauge markup is rebuilt on every render, so a plain CSS width transition
  // never animates (each fill mounts at its final width). Compare the new ratio
  // against the last one we saw for this combatant and, when it changed, snap the
  // fill back to the old width, force a reflow, then let it transition to the new
  // one — and flash the bar so a value change reads clearly.
  animateGaugeChanges() {
    if (!this.root) return;
    if (!this._lastGaugeRatios) this._lastGaugeRatios = new Map();
    const seen = new Set();
    this.root.querySelectorAll(".gluni-card[data-combatant-id]").forEach(cardEl => {
      const track = cardEl.querySelector(".gluni-break-gauge-track");
      if (!track) return;
      const id = cardEl.dataset.combatantId;
      const key = cardEl.dataset.gluniKey || id;
      seen.add(key);
      const ratio = clamp(Number(track.dataset.ratio) || 0, 0, 1);
      const prev = this._lastGaugeRatios.get(key);
      this._lastGaugeRatios.set(key, ratio);
      if (prev === undefined || prev === ratio) return;
      const fill = track.querySelector(".gluni-break-gauge-fill");
      if (fill) {
        fill.style.transition = "none";
        fill.style.width = `${(clamp(prev, 0, 1) * 100).toFixed(2)}%`;
        void fill.offsetWidth;                       // force reflow before re-enabling transition
        fill.style.transition = "";
        fill.style.width = `${(ratio * 100).toFixed(2)}%`;
      }
      track.classList.remove("gluni-break-gauge-track--down", "gluni-break-gauge-track--up");
      void track.offsetWidth;                        // restart the flash keyframe
      track.classList.add(ratio < prev ? "gluni-break-gauge-track--down" : "gluni-break-gauge-track--up");
    });
    for (const key of this._lastGaugeRatios.keys()) {
      if (!seen.has(key)) this._lastGaugeRatios.delete(key);
    }
  }

  getRenderSettings() {
    const visibleCount = clamp(Number(game.settings.get(MODULE_ID, SETTINGS.visibleCount)) || 5, 1, 12);
    const uiScale = clamp(Number(game.settings.get(MODULE_ID, SETTINGS.uiScale)) || 1, 0.5, 2.0);

    return {
      edge: game.settings.get(MODULE_ID, SETTINGS.edge) || "right",
      visibleCount,
      showAll: Boolean(game.settings.get(MODULE_ID, SETTINGS.showAllCombatants)),
      delayedPlacement: game.settings.get(MODULE_ID, SETTINGS.delayedPlacement) || "side",
      uiScale,
      mode: getInitiativeMode(),
      showDefeated: Boolean(game.settings.get(MODULE_ID, SETTINGS.showDefeated)),
      isGM: Boolean(game.user.isGM)
    };
  }

  renderMarkup(combat, view, settings) {
    return `
      <div class="gluni-shell">
        <header class="gluni-header">
          <button class="gluni-drag-handle" type="button" title="Move tracker" aria-label="Move tracker">
            <span class="gluni-drag-handle-grip" aria-hidden="true"></span>
          </button>
          <div class="gluni-round-chip">
            <span class="gluni-round-chip-label">${localize("GLUNI.Round").toUpperCase()}</span>
            <span class="gluni-round-chip-divider" aria-hidden="true"></span>
            <strong class="gluni-round-chip-num">${formatRound(combat.round)}</strong>
          </div>
        </header>
        <div class="gluni-rail">
          ${view.normal.map(item => this.renderRailItem(item)).join("")}
        </div>
        ${view.cardMode ? this.renderDeckStub(view) : ""}
        ${this.renderDelayedSection(view.delayed)}
        ${this.renderFloatingTurnControls(view)}
      </div>
    `;
  }

  buildViewModel(combat, settings = this.getRenderSettings()) {
    // Card mode draws its order from the shared deal flag rather than native
    // initiative sorting. Falls through to the standard model when no deal exists
    // yet (e.g. a player before the GM has dealt the first round).
    if (settings.mode === INITIATIVE_MODE.card) {
      const cardView = this.buildCardViewModel(combat, settings);
      if (cardView) return cardView;
    }

    const sourceTurns = Array.isArray(combat.turns) && combat.turns.length
      ? combat.turns
      : combat.combatants?.contents ?? Array.from(combat.combatants ?? []);
    const turns = Array.from(sourceTurns)
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .filter(Boolean);
    const states = turns.map(combatant => {
      const skipped = Boolean(combatant.defeated && !settings.showDefeated);
      return {
        combatant,
        skipped,
        delayed: skipped ? false : this.isDelayed(combatant)
      };
    });
    const normal = [];
    const delayed = [];

    if (!turns.length) return { normal, delayed, activeId: null, activeKey: null };

    const currentTurn = Number.isInteger(combat.turn) ? combat.turn : 0;
    // Before combat starts the overlay is a GM-only staging roster, so nothing is
    // "active" yet — leaving activeId null keeps every card in its resting state
    // (no expanded turn card, no floating turn controls).
    const activeId = combat.started
      ? (combat.combatant?.id ?? turns[currentTurn]?.id ?? null)
      : null;
    const currentRound = combat.round ?? 1;

    for (const state of states) {
      if (state.skipped || !state.delayed) continue;
      if (!shouldShowAdhocOnRound(state.combatant, currentRound)) continue;

      const card = this.buildCombatantCard(state.combatant, {
        active: false,
        delayed: true,
        roundOffset: 0,
        displayRound: currentRound,
        key: `delayed:${state.combatant.id}`
      });
      if (card) delayed.push(card);
    }

    let added = 0;
    const insertedRoundOffsets = new Set();
    let guard = 0;
    // "Show all" walks exactly one full cycle of the turn order so every combatant
    // appears once (those who already acted wrap into the next round with a
    // separator); one-shot ad hoc cards self-filter via shouldShowAdhocOnRound, so
    // a one-shot that already fired this round simply drops out of the next-round
    // wrap. Otherwise we cap at the configured visible count.
    const targetCount = settings.showAll ? Infinity : settings.visibleCount;
    const maxScannedTurns = settings.showAll
      ? turns.length
      : turns.length * Math.max(settings.visibleCount * 2, 4);

    while (added < targetCount && guard < maxScannedTurns) {
      const absoluteIndex = currentTurn + guard;
      const turnIndex = modulo(absoluteIndex, turns.length);
      const state = states[turnIndex];
      const combatant = state?.combatant;
      const roundOffset = Math.floor(absoluteIndex / turns.length);
      const displayRound = currentRound + roundOffset;
      guard += 1;

      if (!combatant || state.skipped || state.delayed) continue;
      if (!shouldShowAdhocOnRound(combatant, displayRound)) continue;

      const card = this.buildCombatantCard(combatant, {
        active: combatant.id === activeId && roundOffset === 0,
        delayed: false,
        roundOffset,
        displayRound,
        key: `combatant:${combatant.id}:round:${roundOffset}`
      });
      if (!card) continue;

      if (roundOffset > 0 && !insertedRoundOffsets.has(roundOffset)) {
        const round = currentRound + roundOffset;
        normal.push({
          type: "separator",
          key: `separator:${round}:offset:${roundOffset}`,
          round
        });
        insertedRoundOffsets.add(roundOffset);
      }

      normal.push(card);
      added += 1;
    }

    const activeKey = normal.find(item => item.type === "combatant" && item.active)?.key ?? null;
    return { normal, delayed, activeId, activeKey };
  }

  // Whether this client controls the currently-active card (GM, or a player who
  // owns the active combatant) — gates who may start a swap.
  userControlsActiveCard(combat = this.combat) {
    const combatant = combat?.combatant;
    return Boolean(combatant && this.userOwnsCombatant(combatant, game.user));
  }

  buildCardViewModel(combat, settings) {
    const deal = this.getCardDeal(combat);
    if (!deal) return null;

    const { pointer, sequence, round: dealRound } = deal;
    const currentRound = combat.round ?? 1;
    const activeId = sequence[pointer]?.cid ?? null;
    const controlsActive = this.userControlsActiveCard(combat);
    const swapPending = Boolean(this.cardSwapPending) && controlsActive;
    const normal = [];

    const totalByCid = new Map();
    for (const slot of sequence) totalByCid.set(slot.cid, (totalByCid.get(slot.cid) ?? 0) + 1);

    // A chaotic fight could leave many combatants broken/dying at once; force-
    // expanding all of them would un-compress the whole deck and defeat the
    // stacked look. Cap how many non-active alert cards pop out of the stack —
    // the rest keep their always-on status edge but stay compressed.
    const ALERT_EXPAND_CAP = 2;
    let alertExpands = 0;

    // Show all reveals the whole remaining deal instead of a fixed window.
    const cardLimit = settings.showAll ? sequence.length : settings.visibleCount;
    let added = 0;
    for (let index = pointer; index < sequence.length && added < cardLimit; index++) {
      const slot = sequence[index];
      const combatant = combat.combatants?.get(slot.cid);
      if (!combatant) continue;
      if (combatant.defeated && !settings.showDefeated) continue;

      const isActive = index === pointer;
      const card = this.buildCombatantCard(combatant, {
        active: isActive,
        delayed: false,
        roundOffset: 0,
        displayRound: currentRound,
        key: `card:${dealRound}:${slot.cid}:${slot.n}`
      });
      if (!card) continue;

      card.cardMode = true;
      card.cardSlot = index;
      card.cardOrder = index - pointer + 1;
      card.cardCompressed = !isActive;
      // Critical states keep an always-on status edge even when compressed; the
      // first few also force-expand out of the stack for triage.
      card.cardAlert = !isActive && (card.guardBroken || Boolean(card.dying && !card.dying.stable));
      card.cardAlertExpand = card.cardAlert && alertExpands < ALERT_EXPAND_CAP;
      if (card.cardAlertExpand) alertExpands += 1;
      const total = totalByCid.get(slot.cid) ?? 1;
      if (total > 1) {
        card.cardTurn = slot.n + 1;
        card.cardTurnTotal = total;
      }
      card.canSwap = isActive && controlsActive && index < sequence.length - 1;
      card.canReorder = settings.isGM && !isActive;
      card.swapPending = isActive && swapPending;
      card.swapTarget = swapPending && index > pointer;
      normal.push(card);
      added += 1;
    }

    if (!settings.showAll && added < settings.visibleCount && normal.length) {
      normal.push({
        type: "separator",
        key: `separator:cardnext:${dealRound}`,
        round: currentRound + 1,
        cardNext: true
      });
    }

    const activeKey = normal.find(item => item.type === "combatant" && item.active)?.key ?? null;
    return {
      normal,
      delayed: [],
      activeId,
      activeKey,
      cardMode: true,
      dealRound,
      deckRemaining: Math.max(0, sequence.length - pointer),
      deckTotal: sequence.length
    };
  }

  buildCombatantCard(combatant, options) {
    const visibility = this.resolveVisibility(combatant);
    if (visibility.playerMode === VISIBILITY.hidden && !game.user.isGM) return null;

    const adhoc = getAdhocData(combatant, options.displayRound);
    const mystery = visibility.playerMode === VISIBILITY.mystery && !game.user.isGM;
    const disposition = adhoc ? adhoc.disposition : getDisposition(combatant, mystery);

    const portrait = mystery || adhoc ? null : getPortrait(combatant);

    const guardBroken = !adhoc && Boolean(getGuardBreakState(combatant));
    const dying = mystery || adhoc ? null : getDyingState(combatant);
    // Apex (PF2e-Flatfinder solo boss). Suppressed for mystery (never leak that a
    // hidden token is a boss / its phase) and defeated (the defeated treatment
    // wins — menace dies with it), per the agreed precedence.
    const apex = mystery || adhoc || combatant.defeated ? null : getApexState(combatant);
    // Generic conditions are completely overridden by dying/break/delay — those
    // states own the card's background field and announce themselves.
    const conditionsOverridden = options.delayed || guardBroken || Boolean(dying);
    const conditions = mystery || adhoc || conditionsOverridden ? null : getConditionTags(combatant);

    return {
      type: "combatant",
      id: combatant.id,
      key: options.key ?? `combatant:${combatant.id}`,
      active: options.active,
      delayed: options.delayed,
      roundOffset: Number(options.roundOffset) || 0,
      mystery,
      gmVisibilityMode: visibility.gmMode,
      defeated: Boolean(combatant.defeated),
      disposition,
      adhoc,
      guardBroken,
      breakGauge: mystery || adhoc ? null : getBreakGaugeState(combatant),
      dying,
      apex,
      conditions,
      name: mystery ? localize("GLUNI.Unknown") : adhoc?.name ?? combatant.name,
      initiative: combatant.initiative,
      portrait,
      portraitScaleCap: mystery || adhoc ? 1 : getPortraitScaleCap(portrait),
      portraitFrame: mystery || adhoc ? null : getPortraitFrame(combatant.actor),
      canEndTurn: Boolean(options.active && !game.user.isGM && this.userOwnsCombatant(combatant, game.user))
    };
  }

  renderRailItem(item) {
    if (item.type === "separator") {
      if (item.cardNext) {
        return `
          <div class="gluni-round-separator gluni-round-separator--reshuffle" data-gluni-key="${escapeAttr(item.key)}" data-round="${item.round}">
            <span><i class="fa-solid fa-shuffle" aria-hidden="true"></i> ${localize("GLUNI.Card.Reshuffle").toUpperCase()}</span>
            <strong>${formatRound(item.round)}</strong>
          </div>
        `;
      }
      return `
        <div class="gluni-round-separator" data-gluni-key="${escapeAttr(item.key)}" data-round="${item.round}">
          <span>${localize("GLUNI.Round").toUpperCase()}</span>
          <strong>${formatRound(item.round)}</strong>
        </div>
      `;
    }

    return this.renderCombatantCard(item);
  }

  // Card mode replaces the numeric initiative badge with a draw-order chip. For
  // multi-turn actors it also shows which of their turns this slot is (e.g. 2/3).
  renderCardBadge(card) {
    const multi = card.cardTurnTotal > 1
      ? `<span class="gluni-card-badge-turn">${card.cardTurn}/${card.cardTurnTotal}</span>`
      : "";
    return `
      <span class="gluni-card-badge gluni-initiative-badge" aria-label="${formatLocalized("GLUNI.Card.Order", { order: card.cardOrder })}">
        <i class="fa-solid fa-clone" aria-hidden="true"></i>
        <span class="gluni-card-badge-order">${card.cardOrder}</span>
        ${multi}
      </span>
    `;
  }

  // The face-down deck identity: a holo emblem on a patterned panel. Shown on the
  // persistent deck stub and, transiently, on cards as they flip during a
  // reshuffle. Pure CSS + a FontAwesome centrepiece — no shipped art.
  renderCardBack() {
    return `
      <span class="gluni-card-back" aria-hidden="true">
        <span class="gluni-card-back-lattice"></span>
        <span class="gluni-card-back-emblem"><i class="fa-solid fa-clone"></i></span>
        <span class="gluni-card-back-sheen"></span>
      </span>
    `;
  }

  // The persistent face-down pile at the rail tail. Cards deal out of it and are
  // collected back into it; its depth hints at how many draws remain this round.
  renderDeckStub(view) {
    const remaining = Math.max(0, Number(view.deckRemaining) || 0);
    const depth = clamp(remaining, 0, 6);
    const label = formatLocalized("GLUNI.Card.DeckRemaining", { count: remaining });
    return `
      <div class="gluni-card-deck-stub" style="--gluni-deck-depth:${depth};" data-remaining="${remaining}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
        <span class="gluni-card-deck-stub-pile" aria-hidden="true">${this.renderCardBack()}</span>
        <span class="gluni-card-deck-stub-meta" aria-hidden="true">
          <span class="gluni-card-deck-stub-label">${localize("GLUNI.Card.Deck").toUpperCase()}</span>
          <span class="gluni-card-deck-stub-count">${remaining}</span>
        </span>
      </div>
    `;
  }

  // Compact always-on status row for compressed sliver cards: keeps break / dying
  // / condition-count readable at a glance without expanding the card.
  renderCardSliverStatus(card) {
    const icons = [];
    if (card.guardBroken) {
      icons.push(`<i class="fa-solid fa-shield-halved gluni-sliver-icon gluni-sliver-icon--break"></i>`);
    }
    if (card.dying && !card.dying.stable) {
      icons.push(`<i class="fa-solid fa-skull gluni-sliver-icon gluni-sliver-icon--dying"></i>`);
    } else if (card.dying?.stable) {
      icons.push(`<i class="fa-solid fa-heart-pulse gluni-sliver-icon gluni-sliver-icon--stable"></i>`);
    }
    if (Array.isArray(card.conditions) && card.conditions.length) {
      icons.push(`<span class="gluni-sliver-icon gluni-sliver-icon--cond">${card.conditions.length}</span>`);
    }
    return icons.join("");
  }

  renderCardSwapControl(card) {
    const pending = card.swapPending;
    const label = pending ? localize("GLUNI.Card.SwapCancel") : localize("GLUNI.Card.Swap");
    return `
      <button class="gluni-card-swap${pending ? " is-active" : ""}" type="button" data-action="cardSwapStart" title="${label}" aria-label="${label}">
        <i class="fa-solid ${pending ? "fa-xmark" : "fa-shuffle"}" aria-hidden="true"></i>
      </button>
    `;
  }

  // Apex kicker tags: a crowned APEX label on every apex card, plus either the
  // reprise ordinal (k/N — "the boss acts again") or, on the prime, the current
  // HP phase. The crown lives here over the dark scrim, never on the portrait.
  renderApexKicker(apex) {
    const crown = `<span class="gluni-apex-tag"><i class="fa-solid fa-crown" aria-hidden="true"></i>${escapeHTML(localize("GLUNI.Apex").toUpperCase())}</span>`;
    if (apex.role === "reprise") {
      const aria = formatLocalized("GLUNI.Apex.Ordinal.Aria", { index: apex.index, total: apex.total });
      return `${crown}<span class="gluni-apex-tag gluni-apex-tag--ordinal" role="img" aria-label="${escapeAttr(aria)}">${apex.index}/${apex.total}</span>`;
    }
    const roman = ["", "I", "II", "III"][apex.phase] ?? "I";
    const aria = formatLocalized("GLUNI.Apex.Aria", { phase: apex.phase });
    return `${crown}<span class="gluni-apex-tag gluni-apex-tag--phase" role="img" aria-label="${escapeAttr(aria)}">${escapeHTML(localize("GLUNI.Apex.PhaseLabel").toUpperCase())} ${roman}</span>`;
  }

  // Three-segment phase indicator on the prime card, filled to the current HP
  // phase — the boss's life as a threat meter (composed → enraged → desperate).
  renderApexPhasePips(apex) {
    const aria = formatLocalized("GLUNI.Apex.Aria", { phase: apex.phase });
    const pips = Array.from({ length: 3 }, (_unused, index) =>
      `<span class="gluni-apex-phase-pip${index < apex.phase ? " gluni-apex-phase-pip--on" : ""}" aria-hidden="true"></span>`
    ).join("");
    return `<div class="gluni-apex-phase-pips" role="img" aria-label="${escapeAttr(aria)}">${pips}</div>`;
  }

  renderCombatantCard(card) {
    const classes = [
      "gluni-card",
      card.active ? "gluni-card--active" : "",
      this.lastActiveKey === card.key && !card.active ? "gluni-card--outgoing-active" : "",
      card.delayed ? "gluni-card--delayed" : "",
      card.adhoc ? "gluni-card--adhoc" : "",
      card.adhoc ? `gluni-card--adhoc-${card.adhoc.type}` : "",
      card.guardBroken ? "gluni-card--guard-broken" : "",
      card.conditions ? "gluni-card--conditioned" : "",
      card.dying ? "gluni-card--dying" : "",
      card.dying ? `gluni-card--dying-${card.dying.severity}` : "",
      card.dying?.kind === "deathsaves" ? "gluni-card--deathsaves" : "",
      card.dying?.stable ? "gluni-card--stable" : "",
      card.apex ? "gluni-card--apex" : "",
      card.apex ? `gluni-card--apex-${card.apex.role}` : "",
      card.apex ? `gluni-card--apex-phase-${card.apex.phase}` : "",
      card.mystery ? "gluni-card--mystery" : "",
      card.defeated ? "gluni-card--defeated" : "",
      card.cardMode ? "gluni-card--card-mode" : "",
      card.cardCompressed ? "gluni-card--card-compressed" : "",
      card.cardAlert ? "gluni-card--card-alert" : "",
      card.cardAlertExpand ? "gluni-card--card-alert-expand" : "",
      card.canReorder ? "gluni-card--card-reorderable" : "",
      card.swapPending ? "gluni-card--swap-source" : "",
      card.swapTarget ? "gluni-card--swap-target" : "",
      `gluni-card--${card.disposition}`,
      game.user.isGM && card.gmVisibilityMode !== VISIBILITY.auto ? `gluni-card--gm-${card.gmVisibilityMode}` : ""
    ].filter(Boolean).join(" ");
    const style = renderCombatantStyle(card);

    // WebGL portrait FX layer (replaces the CSS crack/vein bg). Mystery cards get
    // a glitch scramble over the "?"; portrait cards get break/dying (the
    // persistent states). Falls back to the CSS background when WebGL is
    // unsupported.
    // Apex ember runs only on the showpiece prime or an active reprise — bounding
    // the live GPU work (inactive reprises carry the CSS treatment alone). Guard
    // break / dying FX still take the portrait when present (break is on top).
    const apexFx = card.apex && (card.apex.role === "prime" || card.active);
    const fxReady = !card.adhoc && cardFX?.supported;
    const fxMode = !fxReady
      ? null
      : card.mystery
        ? "scramble"
        : card.portrait
          ? (card.guardBroken ? "break" : card.dying && !card.dying.stable ? "dying" : apexFx ? "apex" : null)
          : null;

    const slotAttr = Number.isInteger(card.cardSlot) ? ` data-card-slot="${card.cardSlot}"` : "";

    return `
      <article class="${classes}" data-gluni-key="${escapeAttr(card.key)}" data-combatant-id="${card.id}" data-round-offset="${card.roundOffset}"${slotAttr}${style}>
        <div class="gluni-card-surface">
        <div class="gluni-card-accent" aria-hidden="true"></div>
        <div class="gluni-card-spec" aria-hidden="true"></div>
        <div class="gluni-card-bracket" aria-hidden="true"></div>
        ${game.user.isGM ? this.renderGMVisibilityMarker(card) : ""}
        ${card.adhoc && !card.mystery
          ? `
            <div class="gluni-card-adhoc-repeat" aria-hidden="true">
              ${renderAdhocRepeatText(card.name)}
            </div>
            <div class="gluni-card-adhoc-bg" aria-hidden="true"><i class="${escapeAttr(card.adhoc.icon)}"></i></div>
          `
          : `<div class="gluni-card-portrait-wrap">
              ${card.mystery
                ? `<div class="gluni-card-mystery-mark" aria-hidden="true">?</div>`
                : `<img class="gluni-card-portrait" src="${escapeAttr(card.portrait)}" alt="" loading="lazy" decoding="async">`}
              <div class="gluni-card-glass" aria-hidden="true"></div>
            </div>`}
        ${card.delayed
          ? `
            <div class="gluni-card-delayed-bg" aria-hidden="true"></div>
            <div class="gluni-card-delayed-repeat" aria-hidden="true">
              ${renderDelayedRepeatText(card.name)}
            </div>
          `
          : ""}
        ${card.dying
          ? `
            ${fxMode === "dying" || fxMode === "scramble" ? "" : `<div class="gluni-card-dying-bg" aria-hidden="true"></div>`}
            <div class="gluni-card-dying-repeat" aria-hidden="true">
              ${card.dying.kind === "deathsaves" ? renderDeathSaveRepeatText(card.dying) : renderDyingRepeatText(card.dying)}
            </div>
          `
          : ""}
        ${card.guardBroken
          ? `
            ${fxMode === "break" || fxMode === "scramble" ? "" : `<div class="gluni-card-guard-break-bg" aria-hidden="true"></div>`}
            <div class="gluni-card-guard-break-repeat" aria-hidden="true">
              ${renderGuardBreakRepeatText()}
            </div>
          `
          : ""}
        ${card.conditions
          ? `
            <div class="gluni-card-condition-bg" aria-hidden="true"></div>
            <div class="gluni-card-condition-repeat" aria-hidden="true">
              ${renderConditionRepeatText(card.conditions)}
            </div>
          `
          : ""}
        ${fxMode ? `<canvas class="gluni-card-portrait-fx gluni-card-portrait-fx--${fxMode}" data-fx="${fxMode}"${fxMode === "apex" ? ` data-fx-phase="${card.apex.phase}"` : ""} aria-hidden="true"></canvas>` : ""}
        ${card.apex
          ? `<div class="gluni-card-apex-corona" aria-hidden="true"></div>
             <div class="gluni-card-apex-corners" aria-hidden="true"><span></span><span></span><span></span><span></span></div>`
          : ""}
        <div class="gluni-card-content">
          <div class="gluni-card-kicker">
            ${card.active ? `<span class="gluni-active-tag">TURN</span>` : ""}
            ${card.apex ? this.renderApexKicker(card.apex) : ""}
            ${card.guardBroken ? `<span class="gluni-guard-break-tag">${localize("GLUNI.GuardBreak").toUpperCase()}</span>` : ""}
            ${card.dying ? (card.dying.kind === "deathsaves"
              ? `<span class="gluni-dying-tag${card.dying.stable ? " gluni-dying-tag--stable" : ""}">${(card.dying.stable ? localize("GLUNI.DeathSaves.Stable") : localize("GLUNI.DeathSaves")).toUpperCase()}</span>`
              : `<span class="gluni-dying-tag">${localize("GLUNI.Dying").toUpperCase()} ${card.dying.value}</span>`) : ""}
            ${card.adhoc ? `<span class="gluni-adhoc-tag">${escapeHTML(card.adhoc.label).toUpperCase()}</span>` : ""}
            ${card.adhoc?.oneShot ? `<span class="gluni-adhoc-tag gluni-adhoc-tag--oneshot">${localize("GLUNI.AdHoc.OneShot").toUpperCase()} ${formatRound(card.adhoc.round)}</span>` : ""}
            ${card.delayed ? `<span class="gluni-delayed-tag">${localize("GLUNI.Delayed").toUpperCase()}</span>` : ""}
          </div>
          <h3>${escapeHTML(card.name)}</h3>
          ${card.dying ? (card.dying.kind === "deathsaves" ? renderDeathSavePips(card.dying) : renderDyingPips(card.dying)) : ""}
          ${card.apex?.role === "prime" ? this.renderApexPhasePips(card.apex) : ""}
          ${card.breakGauge ? renderBreakGaugeBar(card.breakGauge) : ""}
        </div>
        ${card.cardMode ? this.renderCardBadge(card) : `<span class="gluni-initiative-badge">${formatInitiative(card.initiative)}</span>`}
        ${card.active ? `<div class="gluni-card-holo" aria-hidden="true"></div><div class="gluni-card-sheen" aria-hidden="true"></div>` : ""}
        ${card.canSwap ? this.renderCardSwapControl(card) : ""}
        ${game.user.isGM ? this.renderGMControls(card) : ""}
        ${card.cardMode ? `<div class="gluni-card-sliver-status" aria-hidden="true">${this.renderCardSliverStatus(card)}</div>` : ""}
        ${card.cardMode ? this.renderCardBack() : ""}
        </div>
        ${card.swapTarget ? `<button class="gluni-card-swap-pick" type="button" data-action="cardSwapPick" data-target-id="${card.id}" title="${localize("GLUNI.Card.SwapPick")}" aria-label="${localize("GLUNI.Card.SwapPick")}"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i><span>${localize("GLUNI.Card.SwapPickShort").toUpperCase()}</span></button>` : ""}
        ${card.conditions && getConditionBadgesEnabled()
          ? `<div class="gluni-card-condition-labels gluni-card-condition-labels--${getConditionBadgeLayout()}">${renderConditionLabels(card.conditions)}</div>`
          : ""}
      </article>
    `;
  }

  renderFloatingTurnControls(view) {
    const activeCard = view.normal.find(item => item.type === "combatant" && item.active);
    if (!activeCard) return "";

    const content = game.user.isGM
      ? this.renderGMTurnControl()
      : activeCard.canEndTurn ? this.renderEndTurnControl() : "";

    if (!content) return "";

    return `<div class="gluni-floating-turn-controls">${content}</div>`;
  }

  renderGMTurnControl() {
    return `
      <div class="gluni-turn-controls" aria-label="${localize("GLUNI.Controls.TurnControls")}">
        <button type="button" data-action="previousTurn" title="${localize("GLUNI.Controls.PreviousTurn")}" aria-label="${localize("GLUNI.Controls.PreviousTurn")}">
          <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
        </button>
        <button type="button" data-action="addAdhoc" title="${localize("GLUNI.AdHoc.Add")}" aria-label="${localize("GLUNI.AdHoc.Add")}">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
        </button>
        <button type="button" data-action="nextTurn" title="${localize("GLUNI.Controls.NextTurn")}" aria-label="${localize("GLUNI.Controls.NextTurn")}">
          <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>
      </div>
    `;
  }

  renderEndTurnControl() {
    return `
      <button class="gluni-end-turn" type="button" data-action="endTurn" title="${localize("GLUNI.Controls.EndTurn")}" aria-label="${localize("GLUNI.Controls.EndTurn")}">
        <span>${localize("GLUNI.Controls.EndTurn").toUpperCase()}</span>
        <i class="fa-solid fa-forward-step" aria-hidden="true"></i>
      </button>
    `;
  }

  positionFloatingControls() {
    const shell = this.root?.querySelector(".gluni-shell");
    const activeCard = this.root?.querySelector(".gluni-card--active");
    const controls = this.root?.querySelector(".gluni-floating-turn-controls");
    if (!shell || !activeCard || !controls) return;

    const shellRect = shell.getBoundingClientRect();
    const cardRect = activeCard.getBoundingClientRect();
    const top = Math.max(0, Math.round(cardRect.top - shellRect.top + 32));
    shell.style.setProperty("--gluni-control-top", `${top}px`);
  }

  renderGMVisibilityMarker(card) {
    const mode = card.gmVisibilityMode ?? VISIBILITY.auto;
    const labels = {
      [VISIBILITY.auto]: "AUTO",
      [VISIBILITY.visible]: "SHOW",
      [VISIBILITY.hidden]: "HIDE",
      [VISIBILITY.mystery]: "MASK"
    };

    return `<span class="gluni-gm-visibility gluni-gm-visibility--${mode}">${labels[mode] ?? "AUTO"}</span>`;
  }

  renderGMControls(card) {
    const activeMode = card.gmVisibilityMode ?? VISIBILITY.auto;

    return `
      <div class="gluni-card-controls">
        <button class="${activeMode === VISIBILITY.auto ? "is-selected" : ""}" type="button" data-action="visibility" data-mode="auto" title="${localize("GLUNI.Controls.Auto")}" aria-label="${localize("GLUNI.Controls.Auto")}">
          <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
        </button>
        <button class="${activeMode === VISIBILITY.visible ? "is-selected" : ""}" type="button" data-action="visibility" data-mode="visible" title="${localize("GLUNI.Controls.Visible")}" aria-label="${localize("GLUNI.Controls.Visible")}">
          <i class="fa-solid fa-eye" aria-hidden="true"></i>
        </button>
        <button class="${activeMode === VISIBILITY.mystery ? "is-selected" : ""}" type="button" data-action="visibility" data-mode="mystery" title="${localize("GLUNI.Controls.Mystery")}" aria-label="${localize("GLUNI.Controls.Mystery")}">
          <i class="fa-solid fa-user-secret" aria-hidden="true"></i>
        </button>
        <button class="${activeMode === VISIBILITY.hidden ? "is-selected" : ""}" type="button" data-action="visibility" data-mode="hidden" title="${localize("GLUNI.Controls.Hidden")}" aria-label="${localize("GLUNI.Controls.Hidden")}">
          <i class="fa-solid fa-eye-slash" aria-hidden="true"></i>
        </button>
        ${card.cardMode ? "" : `
        <button type="button" data-action="${card.delayed ? "return" : "delay"}" title="${card.delayed ? localize("GLUNI.Controls.Return") : localize("GLUNI.Controls.Delay")}" aria-label="${card.delayed ? localize("GLUNI.Controls.Return") : localize("GLUNI.Controls.Delay")}">
          <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
        </button>`}
        ${!card.adhoc ? `
          <button class="${card.guardBroken ? "is-selected" : ""}" type="button" data-action="guardBreak" title="${card.guardBroken ? localize("GLUNI.Controls.ClearGuardBreak") : localize("GLUNI.Controls.GuardBreak")}" aria-label="${card.guardBroken ? localize("GLUNI.Controls.ClearGuardBreak") : localize("GLUNI.Controls.GuardBreak")}">
            <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
          </button>
        ` : ""}
        ${card.adhoc ? `
          <button type="button" data-action="deleteAdhoc" title="${localize("GLUNI.AdHoc.Delete")}" aria-label="${localize("GLUNI.AdHoc.Delete")}">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        ` : ""}
      </div>
    `;
  }

  renderDelayedSection(delayedCards) {
    if (!delayedCards.length) return "";

    return `
      <section class="gluni-delayed-section">
        <div class="gluni-delayed-heading">
          <span class="gluni-delayed-tick" aria-hidden="true"></span>
          <span>&mdash; ${localize("GLUNI.Delayed").toUpperCase()}</span>
        </div>
        <div class="gluni-delayed-list">
          ${delayedCards.map(card => this.renderCombatantCard(card)).join("")}
        </div>
      </section>
    `;
  }

  captureItemRects() {
    const rects = new Map();
    if (!this.root) return rects;

    for (const item of this.root.querySelectorAll("[data-gluni-key]")) {
      rects.set(item.dataset.gluniKey, item.getBoundingClientRect());
    }

    return rects;
  }

  animateTurnChange(oldRects, options = {}) {
    const items = Array.from(this.root.querySelectorAll("[data-gluni-key]"));
    const previousActiveKey = options.previousActiveKey ?? null;
    const roundDelta = Number(options.roundDelta) || 0;
    const enterItems = [];   // no continuity rect -> CSS enter animation
    const flipItems = [];     // { item, dx, dy, scaleX, scaleY }

    // Read pass: measure every moved item's new rect up front. Interleaving these
    // getBoundingClientRect() reads with the preflip class/style writes below
    // forces a synchronous reflow per item (layout thrash) right as the turn
    // animation starts — the classic FLIP stutter on initiative move. Batching all
    // reads before any mutation collapses it to a single layout.
    for (const item of items) {
      const isActive = item.classList.contains("gluni-card--active");
      const oldRect = this.getContinuityRect(oldRects, item.dataset.gluniKey, roundDelta);
      if (!oldRect) {
        enterItems.push({ item, isActive });
        continue;
      }

      const newRect = item.getBoundingClientRect();
      const dx = oldRect.left + oldRect.width / 2 - (newRect.left + newRect.width / 2);
      const dy = oldRect.top + oldRect.height / 2 - (newRect.top + newRect.height / 2);
      const scaleX = newRect.width ? oldRect.width / newRect.width : 1;
      const scaleY = newRect.height ? oldRect.height / newRect.height : 1;
      const moved = Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5;
      const resized = Math.abs(scaleX - 1) >= 0.01 || Math.abs(scaleY - 1) >= 0.01;

      if (moved || resized) flipItems.push({ item, dx, dy, scaleX, scaleY });
    }

    // Write pass: apply enter classes + preflip transforms only (no reads here, so
    // nothing forces a reflow mid-loop).
    for (const { item, isActive } of enterItems) {
      item.classList.add("gluni-item--entering");
      if (!isActive) item.classList.add("gluni-item--entering-bottom");
      if (isActive && item.dataset.gluniKey !== previousActiveKey) item.classList.add("gluni-card--active-entering");
      window.setTimeout(() => item.classList.remove("gluni-item--entering", "gluni-item--entering-bottom", "gluni-card--active-entering"), 680);
    }

    for (const { item, dx, dy, scaleX, scaleY } of flipItems) {
      item.classList.add("gluni-item--preflip");
      item.style.setProperty("--gluni-flip-x", `${Math.round(dx)}px`);
      item.style.setProperty("--gluni-flip-y", `${Math.round(dy)}px`);
      item.style.setProperty("--gluni-flip-scale-x", scaleX.toFixed(4));
      item.style.setProperty("--gluni-flip-scale-y", scaleY.toFixed(4));
    }

    if (flipItems.length) {
      this.root.getBoundingClientRect();   // single reflow to commit the preflip offsets

      for (const { item } of flipItems) {
        item.classList.remove("gluni-item--preflip");
        item.classList.add("gluni-item--flipping");

        window.requestAnimationFrame(() => {
          item.style.setProperty("--gluni-flip-x", "0px");
          item.style.setProperty("--gluni-flip-y", "0px");
          item.style.setProperty("--gluni-flip-scale-x", "1");
          item.style.setProperty("--gluni-flip-scale-y", "1");
        });

        window.setTimeout(() => item.classList.remove("gluni-item--flipping"), 680);
      }
    }

    // ---- Magic-move hand-off: the card morphs from its small rail size into the active
    // size purely via the FLIP transform above. No slam, shake, shockwave, swipe, or badge
    // count-up — the initiative number simply snaps to its new value to match the move. ----
  }

  // ---- Card-mode collect / deal / reshuffle motion --------------------------
  //
  // These beats are additive overlays: clones of the cards that left the rail
  // fly into the deck stub (collect), while the freshly-dealt cards play their
  // CSS deal-in keyframe. Because the ghosts are throwaway clones and the deal-in
  // rides the existing enter animation, none of this fights the FLIP reflow that
  // moves the cards that simply shifted position. All of it is gated behind
  // !prefersReducedMotion() by the caller (the snapshot is only taken then).

  snapshotRailCards() {
    if (!this.root) return null;
    const cards = Array.from(this.root.querySelectorAll(".gluni-rail .gluni-card[data-gluni-key]"));
    if (!cards.length) return null;
    const stubPile = this.root.querySelector(".gluni-card-deck-stub-pile");
    return {
      stubRect: stubPile?.getBoundingClientRect() ?? null,
      cards: cards.map(el => ({
        key: el.dataset.gluniKey,
        rect: el.getBoundingClientRect(),
        html: el.outerHTML
      }))
    };
  }

  playCardModeMotion(snapshot, { isReshuffle = false, edge = "right" } = {}) {
    if (!this.root || !snapshot?.cards?.length) return;
    // The stub lives in the freshly rendered DOM; fall back to the pre-swap
    // position if the new one hasn't been laid out yet.
    const stubPile = this.root.querySelector(".gluni-card-deck-stub-pile");
    const stubRect = stubPile?.getBoundingClientRect() || snapshot.stubRect;
    if (!stubRect || !stubRect.width) return;

    const presentKeys = new Set(
      Array.from(this.root.querySelectorAll(".gluni-rail .gluni-card[data-gluni-key]"))
        .map(el => el.dataset.gluniKey)
    );
    // On a reshuffle every card is re-dealt, so collect them all; on a normal
    // turn only the cards that left the visible window (the spent active card)
    // are collected.
    const leaving = snapshot.cards.filter(card => isReshuffle || !presentKeys.has(card.key));
    if (isReshuffle) this.flashReshuffle();
    this.spawnCollectGhosts(leaving, stubRect, { stagger: isReshuffle, edge });
  }

  flashReshuffle() {
    if (!this.root) return;
    this.root.classList.add("gluni-initiative--reshuffling");
    window.clearTimeout(this._reshuffleTimer);
    this._reshuffleTimer = window.setTimeout(() => {
      this.root?.classList.remove("gluni-initiative--reshuffling");
    }, 900);
  }

  spawnCollectGhosts(items, stubRect, { stagger = false, edge = "right" } = {}) {
    if (!items?.length) return;
    const layer = document.createElement("div");
    // Carry the overlay's scoping classes so the cloned cards keep their styling,
    // but live on <body> so the shell's UI-scale transform doesn't double-apply.
    layer.className = `gluni-initiative gluni-initiative--${edge} gluni-initiative--card-mode gluni-card-ghost-layer`;
    document.body.appendChild(layer);

    const stubCx = stubRect.left + stubRect.width / 2;
    const stubCy = stubRect.top + stubRect.height / 2;
    let alive = items.length;
    const finish = () => { if (--alive <= 0) layer.remove(); };

    items.forEach((item, index) => {
      const ghost = document.createElement("div");
      ghost.className = "gluni-card-ghost gluni-card-ghost--collect";
      ghost.innerHTML = item.html;
      ghost.style.left = `${item.rect.left}px`;
      ghost.style.top = `${item.rect.top}px`;
      ghost.style.width = `${item.rect.width}px`;
      ghost.style.height = `${item.rect.height}px`;
      layer.appendChild(ghost);

      const dx = stubCx - (item.rect.left + item.rect.width / 2);
      const dy = stubCy - (item.rect.top + item.rect.height / 2);
      const delay = stagger ? index * 55 : 0;
      // Keep the tilt under 90° so the cloned face never mirrors into a backwards
      // card on its way into the deck; the stub's card-back carries the "now
      // face-down in the deck" read.
      const anim = ghost.animate([
        { transform: "translate(0px, 0px) scale(1) rotateY(0deg)", opacity: 1, offset: 0 },
        { transform: `translate(${dx * 0.4}px, ${dy * 0.4}px) scale(0.82) rotateY(34deg)`, opacity: 0.9, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.14) rotateY(58deg)`, opacity: 0, offset: 1 }
      ], { duration: 440, delay, easing: "cubic-bezier(0.55, 0, 0.36, 1)", fill: "forwards" });
      anim.onfinish = finish;
      anim.oncancel = finish;
    });

    // Safety net: if WAAPI events never fire (e.g. the tab was hidden), make sure
    // the throwaway layer is still cleaned up.
    window.setTimeout(() => layer.isConnected && layer.remove(), 440 + items.length * 55 + 400);
  }

  getContinuityRect(oldRects, key, roundDelta = 0) {
    const direct = oldRects.get(key);
    if (direct || roundDelta <= 0 || !key) return direct;

    const combatantMatch = key.match(/^combatant:([^:]+):round:(\d+)$/);
    if (combatantMatch) {
      const [, id, roundOffset] = combatantMatch;
      return oldRects.get(`combatant:${id}:round:${Number(roundOffset) + roundDelta}`) ?? null;
    }

    const separatorMatch = key.match(/^separator:(\d+):offset:(\d+)$/);
    if (separatorMatch) {
      const [, round, roundOffset] = separatorMatch;
      return oldRects.get(`separator:${round}:offset:${Number(roundOffset) + roundDelta}`) ?? null;
    }

    return null;
  }

  getActiveInitiative(view) {
    try {
      const active = view?.normal?.find(item => item.type === "combatant" && item.active);
      return active ? formatInitiative(active.initiative) : null;
    } catch (_e) {
      return null;
    }
  }

  resolveVisibility(combatant) {
    const flagMode = combatant.getFlag(MODULE_ID, FLAGS.visibility) || VISIBILITY.auto;
    const foundryHidden = Boolean(combatant.hidden || combatant.token?.hidden);

    let playerMode = flagMode;
    if (flagMode === VISIBILITY.auto) playerMode = foundryHidden ? VISIBILITY.mystery : VISIBILITY.visible;

    return {
      gmMode: flagMode,
      playerMode
    };
  }

  isDelayed(combatant) {
    if (combatant.getFlag(MODULE_ID, FLAGS.manualDelayed)) return true;
    if (game.system?.id !== "pf2e") return false;

    const flags = combatant.flags?.pf2e ?? {};
    return Boolean(
      combatant.getFlag("pf2e", "delayed") ||
      flags.delayed ||
      flags.delay ||
      flags.turn?.delayed ||
      flags.initiative?.delayed ||
      flags.combatant?.delayed
    );
  }

  onCardHover(event, hovered) {
    const card = event.target.closest("[data-combatant-id]");
    if (!card || !this.root.contains(card)) return;
    if (event.relatedTarget && card.contains(event.relatedTarget)) return;
    if (!game.user.isGM && card.classList.contains("gluni-card--mystery")) return;

    const combatant = this.combat?.combatants?.get(card.dataset.combatantId);
    this.setTokenHover(combatant, hovered);
  }

  setTokenHover(combatant, hovered) {
    const token = getCombatantTokenObject(combatant);
    if (!token) return;

    try {
      if (hovered && typeof token._onHoverIn === "function") {
        token._onHoverIn({ type: "mouseover" }, { hoverOutOthers: false });
        return;
      }

      if (!hovered && typeof token._onHoverOut === "function") {
        token._onHoverOut({ type: "mouseout" });
        return;
      }
    } catch (_error) {
      // Fall through to the render-flag path for Foundry versions with stricter hover handlers.
    }

    token.hover = hovered;
    token.renderFlags?.set?.({ refreshState: true });
    token.refresh?.();
  }

  async onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || !this.root.contains(button)) return;

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.action;

    if (action === "addAdhoc") {
      if (!game.user.isGM) return;
      this.openAdhocDialog();
      return;
    }

    if (action === "previousTurn" || action === "nextTurn") {
      if (!game.user.isGM) return;
      await this.changeTurn(action === "nextTurn" ? 1 : -1);
      return;
    }

    if (action === "endTurn") {
      await this.requestEndTurn();
      return;
    }

    // Card-mode swap is available to whoever controls the active card (GM or the
    // owning player), so these branches sit ahead of the GM-only guard.
    if (action === "cardSwapStart") {
      if (!this.isCardMode() || !this.userControlsActiveCard()) return;
      this.cardSwapPending = !this.cardSwapPending;
      this.renderSoon();
      return;
    }

    if (action === "cardSwapPick") {
      const wasPending = Boolean(this.cardSwapPending);
      this.cardSwapPending = false;
      this.renderSoon();
      if (wasPending && this.isCardMode()) await this.requestCardSwap(button.dataset.targetId);
      return;
    }

    if (!game.user.isGM) return;

    const card = button.closest("[data-combatant-id]");
    const combatant = this.combat?.combatants?.get(card?.dataset.combatantId);
    if (!combatant) return;

    if (action === "visibility") {
      await this.setVisibility(combatant, button.dataset.mode);
      return;
    }

    if (action === "deleteAdhoc") {
      if (!isAdhocCombatant(combatant)) return;
      await this.deleteAdhocCombatant(combatant);
      return;
    }

    if (action === "delay") {
      const edge = game.settings.get(MODULE_ID, SETTINGS.edge) || "right";
      const cardEl = this.root?.querySelector(`.gluni-card[data-combatant-id="${escapeCSSIdentifier(combatant.id)}"]`);
      if (cardEl) {
        this.createStatusFlashGhost(cardEl, localize("GLUNI.Delayed").toUpperCase(), "delay", edge);
      }
      this.pendingSlideInIds.add(combatant.id);
      this.statusAnimationRecentlyQueued(combatant.id, "delay");
      this.broadcastStatusAnimation(combatant.id, "delay");
      await combatant.setFlag(MODULE_ID, FLAGS.manualDelayed, true);
      if (this.combat?.combatant?.id === combatant.id) await this.combat.nextTurn();
      this.broadcastRefresh();
      return;
    }

    if (action === "return") {
      const wasDelayed = this.isDelayed(combatant);
      this.pendingDelayReturnId = combatant.id;
      await combatant.unsetFlag(MODULE_ID, FLAGS.manualDelayed);
      await this.clearKnownPF2eDelayFlags(combatant);
      if (wasDelayed) await this.returnDelayedCombatantToTurn(combatant);
      this.broadcastRefresh();
      return;
    }

    if (action === "guardBreak") {
      if (getGuardBreakState(combatant)) await this.clearGuardBreak(combatant);
      else await this.applyGuardBreak(combatant);
    }
  }

  onContextMenu(event) {
    if (!game.user.isGM) return;

    const card = event.target.closest(".gluni-card[data-combatant-id]");
    if (!card || !this.root.contains(card)) return;
    if (event.target.closest("button, input, select, textarea, .gluni-card-controls")) return;

    const combatant = this.combat?.combatants?.get(card.dataset.combatantId);
    if (!combatant) return;

    event.preventDefault();
    event.stopPropagation();
    this.openInitiativeContextMenu(combatant, event);
  }

  openAdhocDialog() {
    const combat = this.combat;
    if (!game.user.isGM || !combat?.started) return;

    openAdhocInitiativeDialog({
      combat,
      onCreate: data => this.createAdhocCombatant(data)
    });
  }

  async createAdhocCombatant(data) {
    const combat = this.combat;
    if (!game.user.isGM || !combat?.started) return null;

    const payload = normalizeAdhocPayload(data, combat);
    const flags = {
      [MODULE_ID]: {
        [FLAGS.adhoc]: {
          name: payload.name,
          type: payload.type,
          icon: payload.icon,
          lifecycle: payload.lifecycle,
          round: payload.round
        },
        [FLAGS.visibility]: payload.visibility
      }
    };
    const combatantData = {
      name: payload.name,
      img: FALLBACK_PORTRAIT,
      hidden: payload.visibility !== VISIBILITY.visible,
      initiative: payload.initiative,
      flags
    };

    try {
      const [combatant] = await combat.createEmbeddedDocuments("Combatant", [combatantData]);
      await this.applyCombatantInitiative(combatant, payload.initiative);
      this.broadcastRefresh();
      return combatant;
    } catch (error) {
      return this.createActorBackedAdhocCombatant(payload, flags, error);
    }
  }

  async createActorBackedAdhocCombatant(payload, flags, originalError) {
    const combat = this.combat;
    if (!globalThis.Actor || !combat?.started) throw originalError;

    let actor = null;
    try {
      actor = await Actor.create({
        name: payload.name,
        type: getAdhocActorType(),
        img: FALLBACK_PORTRAIT,
        flags: {
          [MODULE_ID]: {
            [FLAGS.adhocActor]: true
          }
        }
      }, { renderSheet: false });

      const [combatant] = await combat.createEmbeddedDocuments("Combatant", [{
        actorId: actor.id,
        hidden: payload.visibility !== VISIBILITY.visible,
        initiative: payload.initiative,
        flags
      }]);
      await this.applyCombatantInitiative(combatant, payload.initiative);
      this.broadcastRefresh();
      return combatant;
    } catch (error) {
      if (actor?.delete) await actor.delete().catch(() => {});
      console.error(`${MODULE_ID} | Failed to create ad hoc initiative combatant`, error, originalError);
      throw error;
    }
  }

  async applyCombatantInitiative(combatant, initiative) {
    if (!combatant || !Number.isFinite(initiative)) return;
    if (typeof this.combat?.setInitiative === "function") {
      await this.combat.setInitiative(combatant.id, initiative);
      return;
    }
    await combatant.update({ initiative });
  }

  async deleteAdhocCombatant(combatant, options = {}) {
    const shouldConfirm = options.confirm !== false;
    const confirmed = !shouldConfirm || await confirmAdhocDelete(combatant);
    if (!confirmed) return;

    const actor = combatant.actor;
    const deleteActor = Boolean(actor?.getFlag?.(MODULE_ID, FLAGS.adhocActor));
    await combatant.delete();
    if (deleteActor) await actor.delete().catch(() => {});
    this.broadcastRefresh();
  }

  async changeTurn(direction, combat = this.combat) {
    if (!combat?.started) return;

    if (this.isCardMode()) {
      await this.cardAdvance(direction, combat);
      return;
    }

    const outgoingCombatant = combat.combatant;
    const outgoingRound = combat.round ?? 1;

    if (direction > 0 && typeof combat.nextTurn === "function") await combat.nextTurn();
    else if (direction < 0 && typeof combat.previousTurn === "function") await combat.previousTurn();
    else await this.updateTurnFallback(direction, combat);

    if (direction > 0 && isDueOneShotAdhoc(outgoingCombatant, outgoingRound)) {
      await this.deleteAdhocCombatant(outgoingCombatant, { confirm: false });
    }

    if (direction > 0) await this.skipInactiveAdhocTurns(combat);

    this.broadcastRefresh();
  }

  // ---- Card initiative mode -------------------------------------------------

  isCardMode() {
    return getInitiativeMode() === INITIATIVE_MODE.card;
  }

  // Reads and validates the live deal stored on the combat. Returns null when no
  // deal exists yet (e.g. a player before the GM has dealt, or a fresh combat).
  getCardDeal(combat = this.combat) {
    const raw = combat?.getFlag?.(MODULE_ID, FLAGS.cardDeal);
    if (!raw || !Array.isArray(raw.sequence) || !raw.sequence.length) return null;
    // Defeated combatants are treated as no longer live (consistent with
    // dealCards), so a mid-round defeat drops that creature's remaining slots
    // from the order rather than letting the turn advance onto a dead creature.
    const liveIds = new Set(Array.from(combat.combatants ?? [])
      .map(entry => (Array.isArray(entry) ? entry[1] : entry))
      .filter(combatant => combatant && !combatant.defeated)
      .map(combatant => combatant.id));
    // Track the active slot by object identity so removing an earlier combatant
    // keeps the same combatant active rather than shifting the pointer.
    const rawPointer = clamp(Number(raw.pointer) || 0, 0, raw.sequence.length - 1);
    const activeSlot = raw.sequence[rawPointer];
    const sequence = raw.sequence.filter(slot => slot && liveIds.has(slot.cid));
    if (!sequence.length) return null;
    let pointer = sequence.indexOf(activeSlot);
    if (pointer < 0) pointer = clamp(rawPointer, 0, sequence.length - 1);
    return { round: Number(raw.round) || 1, pointer, sequence };
  }

  // Re-deals when the stored deal is missing, stale (wrong round), or its actor
  // set drifted. GM-primary only, so exactly one client writes the flag.
  async maybeRedealCards(combat = this.combat, { force = false } = {}) {
    if (!this.isCardMode()) return;
    if (!game.user.isGM || !this.isPrimaryActiveGM()) return;
    if (!combat?.started || !combat.combatants?.size) return;

    const deal = combat.getFlag(MODULE_ID, FLAGS.cardDeal) ?? null;
    const round = Number(combat.round) || 1;
    const stale = !deal || !Array.isArray(deal.sequence) || !deal.sequence.length || deal.round !== round;

    if (force || stale) {
      await this.dealCards(combat, round);
      return;
    }

    await this.reconcileCardDeal(combat);
  }

  // Shuffles a fresh order for the round and writes it together with the round
  // and the native turn pointer in one update (single updateCombat for all).
  async dealCards(combat, round = Number(combat.round) || 1) {
    const combatants = Array.from(combat.combatants ?? [])
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .filter(combatant => combatant && !combatant.defeated);
    const sequence = buildCardSequence(combatants);
    if (!sequence.length) return;

    const update = {
      round,
      flags: { [MODULE_ID]: { [FLAGS.cardDeal]: { round, pointer: 0, sequence } } }
    };
    const turnIndex = nativeTurnIndexOf(combat, sequence[0].cid);
    if (turnIndex !== null) update.turn = turnIndex;
    await combat.update(update);
    this.broadcastRefresh();
  }

  // Keeps an in-progress deal valid when combatants are added/removed mid-round
  // without reshuffling: drops slots for departed combatants (keeping the active
  // slot stable) and appends turn slots for newcomers after the current pointer.
  async reconcileCardDeal(combat) {
    const deal = this.getCardDeal(combat);
    if (!deal) { await this.dealCards(combat); return; }

    const combatants = Array.from(combat.combatants ?? [])
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .filter(combatant => combatant && !combatant.defeated);
    const presentIds = new Set(deal.sequence.map(slot => slot.cid));
    const additions = [];
    for (const combatant of combatants) {
      if (presentIds.has(combatant.id)) continue;
      const config = getCombatantCardConfig(combatant);
      for (let n = 0; n < config.turns; n++) additions.push({ cid: combatant.id, n });
    }

    const sameLength = deal.sequence.length === combat.getFlag(MODULE_ID, FLAGS.cardDeal)?.sequence?.length;
    if (!additions.length && sameLength) return;

    const sequence = deal.sequence.slice();
    if (additions.length) sequence.splice(deal.pointer + 1, 0, ...additions);

    await combat.setFlag(MODULE_ID, FLAGS.cardDeal, {
      round: deal.round,
      pointer: deal.pointer,
      sequence
    });
    this.broadcastRefresh();
  }

  async setCardPointer(combat, pointer) {
    const deal = this.getCardDeal(combat);
    if (!deal) return;
    const next = clamp(pointer, 0, deal.sequence.length - 1);
    const update = {
      flags: { [MODULE_ID]: { [FLAGS.cardDeal]: { round: deal.round, pointer: next, sequence: deal.sequence } } }
    };
    const turnIndex = nativeTurnIndexOf(combat, deal.sequence[next].cid);
    if (turnIndex !== null) update.turn = turnIndex;
    await combat.update(update);
    this.broadcastRefresh();
  }

  async cardAdvance(direction, combat = this.combat) {
    if (!game.user.isGM) return;
    const deal = this.getCardDeal(combat);
    if (!deal) { await this.maybeRedealCards(combat, { force: true }); return; }

    const next = deal.pointer + direction;
    if (next >= deal.sequence.length) {
      // Past the last slot: advance the round and reshuffle a new deal.
      await this.dealCards(combat, (Number(combat.round) || 1) + 1);
      return;
    }
    if (next < 0) return;   // clamp at the first slot; a shuffle can't be rewound
    await this.setCardPointer(combat, next);
  }

  // Swap-delay: the active creature trades places with an upcoming creature,
  // forcing that creature to act now. Identified by target combatant id; we swap
  // the active slot with that combatant's next upcoming slot. GM authority only.
  async performCardSwap(targetCid, combat = this.combat) {
    if (!game.user.isGM) return;
    const deal = this.getCardDeal(combat);
    if (!deal) return;
    const { pointer, sequence } = deal;
    if (sequence[pointer]?.cid === targetCid) return;

    const targetSlot = sequence.findIndex((slot, index) => index > pointer && slot.cid === targetCid);
    if (targetSlot < 0) return;

    const next = sequence.slice();
    [next[pointer], next[targetSlot]] = [next[targetSlot], next[pointer]];

    const update = {
      flags: { [MODULE_ID]: { [FLAGS.cardDeal]: { round: deal.round, pointer, sequence: next } } }
    };
    const turnIndex = nativeTurnIndexOf(combat, next[pointer].cid);
    if (turnIndex !== null) update.turn = turnIndex;
    await combat.update(update);
    this.broadcastRefresh();
  }

  onInitiativeModeChanged() {
    this.cardSwapPending = null;
    if (this.isCardMode()) this.maybeRedealCards();
    this.renderSoon();
  }

  skipInactiveAdhocTurnSoon() {
    window.clearTimeout(this.adhocSkipTimer);
    this.adhocSkipTimer = window.setTimeout(() => this.skipInactiveAdhocTurns(), 40);
  }

  async skipInactiveAdhocTurns(combat = this.combat) {
    if (this.isCardMode()) return;   // card mode drives order from the deal, not native nextTurn
    if (!game.user.isGM || !combat?.started || !this.isPrimaryActiveGM()) return;

    const turns = Array.from(combat.turns ?? []);
    const maxSkips = Math.max(turns.length, 1);
    let skipped = 0;

    while (skipped < maxSkips) {
      const combatant = combat.combatant;
      const adhoc = getAdhocData(combatant);
      const round = combat.round ?? 1;
      if (!adhoc?.oneShot) break;
      if (adhoc.round < round) {
        await this.deleteAdhocCombatant(combatant, { confirm: false });
        break;
      }
      if (adhoc.round === round) break;

      skipped += 1;
      if (typeof combat.nextTurn === "function") await combat.nextTurn();
      else await this.updateTurnFallback(1, combat);
    }

    if (skipped) this.broadcastRefresh();
  }

  async updateTurnFallback(direction, combat = this.combat) {
    const turns = Array.from(combat?.turns ?? []);
    if (!combat?.started || !turns.length) return;

    const currentTurn = Number.isInteger(combat.turn) ? combat.turn : 0;
    const nextTurn = modulo(currentTurn + direction, turns.length);
    await combat.update({ turn: nextTurn });
  }

  async requestEndTurn() {
    const combat = this.combat;
    const combatant = combat?.combatant;
    if (!combat?.started || !combatant || !this.userOwnsCombatant(combatant, game.user)) {
      this.shakeEndTurnButton();
      return;
    }

    if (game.user.isGM) {
      await this.changeTurn(1);
      return;
    }

    if (socketReady()) {
      emitSocket(FEATURE_ID, {
        type: "requestEndTurn",
        requestId: `${game.user.id}:${combat.id}:${combatant.id}:${Date.now()}`,
        combatId: combat.id,
        combatantId: combatant.id,
        userId: game.user.id
      });
    } else {
      this.shakeEndTurnButton();
    }
  }

  shakeEndTurnButton() {
    const button = this.root?.querySelector(".gluni-end-turn");
    if (!button) return;
    button.classList.remove("gluni-end-turn--denied");
    void button.offsetWidth;
    button.classList.add("gluni-end-turn--denied");
    window.setTimeout(() => button.classList.remove("gluni-end-turn--denied"), 240);
  }

  async onSocketEndTurnRequest(data) {
    if (!game.user.isGM || !data?.combatId || !data?.combatantId || !data?.userId) return;

    const requestId = data.requestId || `${data.userId}:${data.combatId}:${data.combatantId}`;
    if (this.handledEndTurnRequests.has(requestId)) return;
    this.handledEndTurnRequests.add(requestId);
    window.setTimeout(() => this.handledEndTurnRequests.delete(requestId), 10000);

    const gmRank = this.getActiveGMRank();
    if (gmRank > 0) await wait(gmRank * 180);

    const combat = this.getCombatById(data.combatId);
    if (!combat?.started || combat.id !== data.combatId) return;
    if (combat.combatant?.id !== data.combatantId) return;

    const requestingUser = game.users?.get(data.userId);
    if (!requestingUser || !this.userOwnsCombatant(combat.combatant, requestingUser)) return;

    await this.changeTurn(1, combat);
  }

  // Card-mode swap initiated by the active combatant's owner. GM applies it
  // directly; players socket the request to the GM (mirrors End Turn).
  async requestCardSwap(targetId) {
    const combat = this.combat;
    const combatant = combat?.combatant;
    if (!combat?.started || !combatant || !targetId || !this.userOwnsCombatant(combatant, game.user)) {
      this.renderSoon();
      return;
    }

    if (game.user.isGM) {
      await this.performCardSwap(targetId, combat);
      return;
    }

    if (socketReady()) {
      emitSocket(FEATURE_ID, {
        type: "requestCardSwap",
        requestId: `${game.user.id}:${combat.id}:${Date.now()}`,
        combatId: combat.id,
        sourceId: combatant.id,
        targetId,
        userId: game.user.id
      });
    } else {
      this.renderSoon();
    }
  }

  async onSocketCardSwapRequest(data) {
    if (!game.user.isGM || !data?.combatId || !data?.sourceId || !data?.targetId || !data?.userId) return;

    this.handledCardSwapRequests ??= new Set();
    const requestId = data.requestId || `${data.userId}:${data.combatId}:${data.targetId}`;
    if (this.handledCardSwapRequests.has(requestId)) return;
    this.handledCardSwapRequests.add(requestId);
    window.setTimeout(() => this.handledCardSwapRequests.delete(requestId), 10000);

    const gmRank = this.getActiveGMRank();
    if (gmRank > 0) await wait(gmRank * 180);

    const combat = this.getCombatById(data.combatId);
    if (!combat?.started || combat.combatant?.id !== data.sourceId) return;

    const requestingUser = game.users?.get(data.userId);
    if (!requestingUser || !this.userOwnsCombatant(combat.combatant, requestingUser)) return;

    await this.performCardSwap(data.targetId, combat);
  }

  getCombatById(combatId) {
    if (this.combat?.id === combatId) return this.combat;

    const direct = game.combats?.get?.(combatId);
    if (direct) return direct;

    const combats = game.combats?.contents ?? Array.from(game.combats ?? []);
    return Array.from(combats)
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .find(combat => combat?.id === combatId) ?? null;
  }

  isPrimaryActiveGM() {
    if (!game.user.isGM) return false;

    const activeGMs = this.getActiveGMs();
    return (activeGMs[0]?.id ?? game.user.id) === game.user.id;
  }

  getActiveGMRank() {
    if (!game.user.isGM) return -1;
    const activeGMs = this.getActiveGMs();
    const rank = activeGMs.findIndex(user => user.id === game.user.id);
    return rank >= 0 ? rank : 0;
  }

  getActiveGMs() {
    const users = game.users?.contents ?? Array.from(game.users ?? []);
    return Array.from(users)
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .filter(user => user?.active && user.isGM)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  userOwnsCombatant(combatant, user) {
    if (!combatant || !user) return false;
    if (user.isGM) return true;

    const actor = combatant.actor;
    if (typeof actor?.testUserPermission === "function" && actor.testUserPermission(user, "OWNER")) return true;

    const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const ownership = actor?.ownership ?? {};
    if (Number(ownership[user.id] ?? ownership.default ?? 0) >= ownerLevel) return true;

    const players = Array.from(combatant.players ?? []);
    return players.some(player => player?.id === user.id);
  }

  async returnDelayedCombatantToTurn(combatant) {
    const combat = this.combat;
    const current = combat?.combatant;
    if (!combat?.started || !current || current.id === combatant.id) return;

    const turns = Array.from(combat.turns ?? []);
    const currentIndex = turns.findIndex(turn => turn.id === current.id);
    if (currentIndex < 0) return;

    const before = currentIndex > 0 ? turns[currentIndex - 1] : null;
    const targetInitiative = chooseInitiativeBetween({
      before: before?.initiative,
      after: current.initiative,
      existing: getUsedInitiatives(combat, combatant.id)
    });

    if (typeof combat.setInitiative === "function") {
      await combat.setInitiative(combatant.id, targetInitiative);
    } else {
      await combatant.update({ initiative: targetInitiative });
    }

    const returnedIndex = Array.from(combat.turns ?? []).findIndex(turn => turn.id === combatant.id);
    if (returnedIndex >= 0) await combat.update({ turn: returnedIndex });
  }

  async clearKnownPF2eDelayFlags(combatant) {
    if (game.system?.id !== "pf2e") return;

    await Promise.allSettled([
      combatant.unsetFlag("pf2e", "delayed"),
      combatant.unsetFlag("pf2e", "delay")
    ]);
  }

  async applyPF2eGuardBreakEffect(combatant) {
    if (game.system?.id !== "pf2e" || !game.user.isGM) return;
    const actor = combatant?.actor;
    if (!actor?.createEmbeddedDocuments) return;
    if (findPF2eGuardBreakEffects(actor).length) return;

    const effectData = {
      type: "effect",
      name: localize("GLUNI.PF2e.BreakEffect.Name"),
      img: `modules/${MODULE_ID}/assets/initiative/icons/guard-break.png`,
      system: {
        slug: PF2E_GUARD_BREAK_EFFECT_SLUG,
        description: { value: localize("GLUNI.PF2e.BreakEffect.Description") },
        tokenIcon: { show: true },
        duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
        rules: [
          { key: "FlatModifier", selector: "ac", type: "status", value: -PF2E_GUARD_BREAK_PENALTY },
          { key: "FlatModifier", selector: "saving-throw", type: "status", value: -PF2E_GUARD_BREAK_PENALTY },
          { key: "ActiveEffectLike", mode: "override", path: "system.attributes.resistances", value: [] }
        ]
      },
      flags: { [MODULE_ID]: { init: { guardBreak: true } } }
    };

    try {
      await actor.createEmbeddedDocuments("Item", [effectData]);
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to apply PF2e break effect`, error);
    }
  }

  async removePF2eGuardBreakEffect(combatant) {
    if (game.system?.id !== "pf2e" || !game.user.isGM) return;
    const actor = combatant?.actor;
    if (!actor?.deleteEmbeddedDocuments) return;

    const ids = findPF2eGuardBreakEffects(actor).map(effect => effect.id);
    if (!ids.length) return;

    try {
      await actor.deleteEmbeddedDocuments("Item", ids);
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to remove PF2e break effect`, error);
    }
  }

  async removeAllPF2eGuardBreakEffects(combat) {
    if (game.system?.id !== "pf2e" || !game.user.isGM || !combat) return;
    const combatants = Array.from(combat.combatants ?? []);
    await Promise.allSettled(combatants.map(combatant => this.removePF2eGuardBreakEffect(combatant)));
  }

  async applyGuardBreak(combatant, { syncGauge = true } = {}) {
    const combat = this.combat;
    if (!game.user.isGM || !combat?.started || !combatant || isAdhocCombatant(combatant)) return;

    const activeId = combat.combatant?.id ?? null;
    const wasActive = activeId === combatant.id;
    const edge = game.settings.get(MODULE_ID, SETTINGS.edge) || "right";

    const cardEl = this.root?.querySelector(`.gluni-card[data-combatant-id="${escapeCSSIdentifier(combatant.id)}"]`);
    if (cardEl) {
      this.createStatusFlashGhost(cardEl, localize("GLUNI.GuardBreak").toUpperCase(), "break", edge);
    }
    this.pendingSlideInIds.add(combatant.id);
    this.statusAnimationRecentlyQueued(combatant.id, "guardBreak");
    this.showBreakSplash(combatant.name);
    // The broken card is moved before the active turn, so it falls outside the
    // forward-looking window on other clients and their local detection can't
    // see it. Broadcast the splash + entrance so every player gets the cue.
    this.broadcastBreakSplash(combatant.name);
    this.broadcastStatusAnimation(combatant.id, "guardBreak");

    const payload = {
      round: combat.round ?? 1,
      anchorCombatantId: activeId,
      appliedTurn: Number.isInteger(combat.turn) ? combat.turn : null,
      appliedAt: Date.now()
    };

    await combatant.setFlag(MODULE_ID, FLAGS.guardBroken, payload);
    await combatant.unsetFlag(MODULE_ID, FLAGS.manualDelayed);
    if (syncGauge) await this.writeBreakGaugeValue(combatant, 0);   // manual break empties the gauge
    await this.clearKnownPF2eDelayFlags(combatant);
    await this.applyPF2eGuardBreakEffect(combatant);
    const movedApexGroup = await this.moveGuardBrokenCombatantBeforeActive(combatant, activeId);
    this.queueGuardBreakImpact({ combatId: combat.id, combatantId: combatant.id });
    this.broadcastGuardBreakImpact(combatant.id);

    // The Apex group move already settles the turn pointer (advancing off the
    // boss when it was active), so skip the single-turn advance in that case.
    if (wasActive && !movedApexGroup) await this.changeTurn(1);
    else this.broadcastRefresh();
  }

  async clearGuardBreak(combatant, { syncGauge = true } = {}) {
    if (!game.user.isGM || !combatant || !getGuardBreakState(combatant)) return;
    await combatant.unsetFlag(MODULE_ID, FLAGS.guardBroken);
    await this.removePF2eGuardBreakEffect(combatant);
    if (syncGauge) await this.writeBreakGaugeValue(combatant, null);   // clearing break refills the gauge
    this.broadcastRefresh();
  }

  // Writes a new gauge value in place without re-triggering the guard-break sync
  // (used by applyGuardBreak/clearGuardBreak to keep the gauge mirroring the
  // break state). Pass null to refill to max. Returns true when it changed.
  async writeBreakGaugeValue(combatant, value) {
    const state = getBreakGaugeState(combatant);
    if (!state) return false;
    const next = value === null ? state.max : clamp(Math.round(Number(value) || 0), 0, state.max);
    if (next === state.value) return false;
    await combatant.setFlag(MODULE_ID, FLAGS.breakGauge, { max: state.max, value: next, mode: state.mode });
    return true;
  }

  // Marks a combatant with a break gauge (or updates an existing one). Writing
  // the flag drives the guard-break state: a depleted gauge applies guard break
  // (and, on PF2e, the break effect), refilling above zero clears it.
  async setBreakGauge(combatant, { max, value, mode } = {}) {
    if (!game.user.isGM || !combatant || isAdhocCombatant(combatant)) return;

    const safeMax = Math.max(1, Math.round(Number(max) || 0));
    const safeValue = clamp(Math.round(Number(value) || 0), 0, safeMax);
    const safeMode = mode === BREAK_GAUGE_MODES.segmented ? BREAK_GAUGE_MODES.segmented : BREAK_GAUGE_MODES.smooth;

    await combatant.setFlag(MODULE_ID, FLAGS.breakGauge, { max: safeMax, value: safeValue, mode: safeMode });
    await this.syncBreakGuard(combatant, safeValue);
  }

  // Removes the gauge entirely. If the gauge was the reason for an active guard
  // break (value at zero), the guard break is cleared along with it.
  async clearBreakGauge(combatant) {
    if (!game.user.isGM || !combatant) return;
    const state = getBreakGaugeState(combatant);
    await combatant.unsetFlag(MODULE_ID, FLAGS.breakGauge);
    if (state && state.value <= 0 && getGuardBreakState(combatant)) {
      await this.clearGuardBreak(combatant, { syncGauge: false });
    } else {
      this.broadcastRefresh();
    }
  }

  // Keeps the guard-break state in lockstep with the gauge value. Both
  // applyGuardBreak and clearGuardBreak already broadcast a refresh; the
  // unchanged branch broadcasts so the new gauge value reaches every client.
  async syncBreakGuard(combatant, value) {
    const broken = Boolean(getGuardBreakState(combatant));
    if (value <= 0 && !broken) await this.applyGuardBreak(combatant, { syncGauge: false });
    else if (value > 0 && broken) await this.clearGuardBreak(combatant, { syncGauge: false });
    else this.broadcastRefresh();
  }

  // Relocates a guard-broken combatant so it forfeits the rest of the current
  // round. For an Apex boss (which acts several times a round) this sweeps the
  // whole boss group — prime plus every reprise — out of the round at once and
  // settles the turn pointer itself; it returns true in that case so the caller
  // skips its own turn advance. A normal single combatant returns false.
  async moveGuardBrokenCombatantBeforeActive(combatant, activeId) {
    const combat = this.combat;
    const current = combat?.combatant;
    if (!combat?.started || !current || !combatant) return false;

    const group = getApexGroupCombatants(combat, combatant);
    if (group && group.length > 1) {
      await this.moveGuardBrokenApexGroupBeforeActive(group);
      return true;
    }

    const turns = Array.from(combat.turns ?? []);
    const currentIndex = turns.findIndex(turn => turn.id === current.id);
    if (currentIndex < 0) return false;

    const before = currentIndex > 0 ? turns[currentIndex - 1] : null;
    const targetInitiative = chooseInitiativeBetween({
      before: before?.initiative,
      after: current.initiative,
      existing: getUsedInitiatives(combat, combatant.id)
    });

    await this.applyCombatantInitiative(combatant, targetInitiative);
    if (activeId) await this.restoreActiveTurn(activeId);
    return false;
  }

  // Moves an entire Apex boss group ahead of the next non-boss combatant so none
  // of the boss's turns (the prime or any reprise) fire again this round, and the
  // whole block reappears next round in its correct relative order. The round
  // resumes on the anchor — the first combatant at or after the active turn that
  // is not part of the group — which also ends the boss's turn when it was active.
  async moveGuardBrokenApexGroupBeforeActive(group) {
    const combat = this.combat;
    const current = combat?.combatant;
    if (!combat?.started || !current || !group?.length) return;

    const turns = Array.from(combat.turns ?? [])
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .filter(Boolean);
    const moverIds = new Set(group.map(member => member.id));

    // The anchor is where the round picks back up: the first non-boss combatant
    // at or after the active turn. If the boss closes out the round, fall back to
    // the first non-boss combatant overall so the block still lands cleanly.
    const currentIndex = Math.max(0, turns.findIndex(turn => turn.id === current.id));
    let anchor = null;
    for (let i = currentIndex; i < turns.length; i += 1) {
      if (!moverIds.has(turns[i].id)) { anchor = turns[i]; break; }
    }
    if (!anchor) anchor = turns.find(turn => !moverIds.has(turn.id)) ?? null;
    if (!anchor) return;   // boss-only combat: nothing meaningful to reorder

    // Top bound of the relocated block: the nearest non-boss combatant ranked
    // above the anchor (none when the anchor already sits at the top).
    const anchorIndex = turns.findIndex(turn => turn.id === anchor.id);
    let before = null;
    for (let i = anchorIndex - 1; i >= 0; i -= 1) {
      if (!moverIds.has(turns[i].id)) { before = turns[i]; break; }
    }

    // Pack the group contiguously between `before` and the anchor, descending in
    // canonical order (prime first) so the boss reads in the right order when it
    // acts next round.
    const existing = turns
      .filter(turn => !moverIds.has(turn.id))
      .map(turn => Number(turn.initiative))
      .filter(Number.isFinite);

    let upper = before?.initiative;
    for (const mover of group) {
      const target = chooseInitiativeBetween({ before: upper, after: anchor.initiative, existing });
      await this.applyCombatantInitiative(mover, target);
      existing.push(target);
      upper = target;
    }

    // Resume on the anchor; the whole boss block now sits just behind the turn
    // pointer, so it has effectively passed for this round.
    await this.restoreActiveTurn(anchor.id);
  }

  clearActiveGuardBreakSoon() {
    window.clearTimeout(this.guardBreakClearTimer);
    this.guardBreakClearTimer = window.setTimeout(() => this.clearActiveGuardBreak(), 50);
  }

  async clearActiveGuardBreak() {
    const combat = this.combat;
    const combatant = combat?.combatant;
    if (!game.user.isGM || !combat?.started || !combatant || !this.isPrimaryActiveGM()) return;

    const state = getGuardBreakState(combatant);
    if (!state) return;
    if (state.anchorCombatantId === combatant.id && state.round === (combat.round ?? 1)) return;

    // Route through clearGuardBreak so the gauge auto-replenishes in lockstep
    // with the break state (it unsets the flag, removes the PF2e effect,
    // refills the gauge to max, and broadcasts).
    await this.clearGuardBreak(combatant);
  }

  queueGuardBreakImpact(data) {
    if (!data?.combatantId) return;
    if (data.combatId && this.combat?.id !== data.combatId) return;
    this.pendingGuardBreakImpactId = data.combatantId;
    this.playGuardBreakSound();
    this.renderSoon();
  }

  // Plays the configured guard-break sting locally. queueGuardBreakImpact runs on
  // every client (the GM applies it; players receive the broadcast), so each
  // client plays its own copy — never socket-push the sound or it doubles up.
  playGuardBreakSound() {
    let src = "";
    try { src = game.settings.get(MODULE_ID, SETTINGS.guardBreakSound) || ""; } catch { src = ""; }
    if (!src) return;

    let volume = 0.8;
    try {
      const raw = Number(game.settings.get(MODULE_ID, SETTINGS.guardBreakSoundVolume));
      if (Number.isFinite(raw)) volume = clamp(raw, 0, 1);
    } catch { volume = 0.8; }
    if (volume <= 0) return;

    try {
      foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to play guard break sound`, err);
    }
  }

  playPendingGuardBreakImpact() {
    const combatantId = this.pendingGuardBreakImpactId;
    if (!combatantId || !this.root) return;
    this.pendingGuardBreakImpactId = null;

    window.requestAnimationFrame(() => {
      const card = this.root?.querySelector(`.gluni-card[data-combatant-id="${escapeCSSIdentifier(combatantId)}"]`);
      if (!card) return;
      card.classList.remove("gluni-card--guard-break-impact");
      void card.offsetWidth;
      card.classList.add("gluni-card--guard-break-impact");
      this.pulseTagEnter(card, ".gluni-guard-break-tag");
      window.setTimeout(() => card.classList.remove("gluni-card--guard-break-impact"), 760);
    });
  }

  broadcastGuardBreakImpact(combatantId) {
    if (!socketReady() || !combatantId) return;
    emitSocket(FEATURE_ID, {
      type: "guardBreakImpact",
      combatId: this.combat?.id,
      combatantId
    });
  }

  showBreakSplash(name) {
    if (!this.enabled || !name) return;

    const breakText = localize("GLUNI.GuardBreak").toUpperCase();
    const letterSpans = Array.from(breakText).map(letter =>
      letter === " " ? `<span class="d"> </span>` : `<span class="d">${escapeHTML(letter)}</span>`
    ).join("");

    const splash = document.createElement("div");
    splash.className = "gluni-break-splash gluni-break-splash--cinematic";
    splash.innerHTML = `
      <div class="gluni-break-splash-burst" aria-hidden="true"></div>
      <div class="gluni-break-splash-rule" aria-hidden="true"></div>
      <div class="gluni-break-splash-inner">
        <div class="gluni-break-deck" aria-hidden="true"></div>
        <div class="gluni-break-splash-label">
          <span class="tick" aria-hidden="true"></span>
          <span>${localize("GLUNI.Splash.Break").toUpperCase()}</span>
        </div>
        <div class="gluni-break-splash-text">${letterSpans}</div>
        <div class="gluni-break-splash-name"><span>${escapeHTML(name)}</span></div>
      </div>
    `;
    document.body.appendChild(splash);

    // WebGL glass-crack + shockwave layer. Decorative and additive over the CSS
    // deck — skipped only when the user's OS prefers reduced motion. Uses the
    // shared pre-compiled renderer, so no per-break shader compilation.
    let breakGL = null;
    if (!prefersReducedMotion()) {
      const renderer = getBreakSplashRenderer();
      if (renderer?.play(splash, { lifeMs: this.getBreakGLLife() })) {
        breakGL = renderer;
      }
    }

    window.requestAnimationFrame(() => splash.classList.add("gluni-break-splash--show"));
    // Short screen-shake on impact.
    if (!prefersReducedMotion()) {
      window.requestAnimationFrame(() => {
        splash.classList.add("gluni-break-splash--shake");
        window.setTimeout(() => splash.classList.remove("gluni-break-splash--shake"), 520);
      });
    }
    window.setTimeout(() => splash.classList.add("gluni-break-splash--leave"), this.getBreakSplashHold());
    window.setTimeout(() => {
      breakGL?.stop(splash);
      splash.remove();
    }, this.getBreakSplashDuration());
  }

  getBreakSplashHold() {
    return 1080;
  }

  getBreakSplashDuration() {
    return 1680;
  }

  // The WebGL fracture is the impact: it hits hard and fades out fast, well
  // before the deck/text leaves, so the screen never sits frozen on a static
  // crack. Kept shorter than the splash hold on purpose.
  getBreakGLLife() {
    return 1300;
  }

  broadcastBreakSplash(name) {
    if (!socketReady() || !name) return;
    emitSocket(FEATURE_ID, { type: "breakSplash", name });
  }

  queueStatusAnimation(data) {
    if (!data?.combatantId || data.senderId === game.user.id) return;
    if (data.combatId && this.combat?.id !== data.combatId) return;

    const status = STATUS_ANIMATION[data.kind];
    if (!status) return;
    if (this.statusAnimationRecentlyQueued(data.combatantId, data.kind)) return;

    if (status.motion === "slide") {
      this.pendingSlideInIds.add(data.combatantId);
      this.pendingStatusFlashes.set(data.combatantId, data.kind);
    } else if (status.motion === "dying") {
      this.pendingDyingWipeIds.add(data.combatantId);
    }

    this.renderSoon();
  }

  broadcastStatusAnimation(combatantId, kind) {
    if (!socketReady() || !combatantId || !STATUS_ANIMATION[kind]) return;
    emitSocket(FEATURE_ID, {
      type: "statusAnimation",
      combatId: this.combat?.id,
      combatantId,
      kind,
      senderId: game.user.id
    });
  }

  statusAnimationRecentlyQueued(combatantId, kind) {
    const now = Date.now();
    for (const [key, timestamp] of this.recentStatusAnimations) {
      if (now - timestamp > 1500) this.recentStatusAnimations.delete(key);
    }

    const key = `${combatantId}:${kind}`;
    const lastQueuedAt = this.recentStatusAnimations.get(key) ?? 0;
    if (now - lastQueuedAt < 1200) return true;

    this.recentStatusAnimations.set(key, now);
    return false;
  }

  async setVisibility(combatant, mode) {
    if (mode === VISIBILITY.auto) await combatant.unsetFlag(MODULE_ID, FLAGS.visibility);
    else await combatant.setFlag(MODULE_ID, FLAGS.visibility, mode);
    this.broadcastRefresh();
  }

  onPointerDown(event) {
    const handle = event.target.closest(".gluni-drag-handle");
    if (handle && this.root.contains(handle)) {
      this.startTrackerDrag(event);
      return;
    }

    if (!game.user.isGM) return;
    if (event.button !== 0) return;
    if (event.target.closest("button, input, select, textarea, .gluni-card-controls")) return;

    const card = event.target.closest(".gluni-rail .gluni-card[data-combatant-id]");
    if (!card || !this.root.contains(card)) return;
    this.startCardDrag(event, card);
  }

  startTrackerDrag(event) {
    event.preventDefault();
    const rect = this.root.getBoundingClientRect();

    this.drag = {
      startX: event.clientX,
      startY: event.clientY,
      rootX: rect.left,
      rootY: rect.top
    };

    this.root.classList.add("gluni-initiative--dragging");
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp, { once: true });
  }

  startCardDrag(event, card) {
    const combatant = this.combat?.combatants?.get(card.dataset.combatantId);
    if (!combatant) return;

    // Card mode reorders the deal sequence rather than initiative. Only upcoming
    // (non-active) slots may move — the active/spent slots are fixed — and the
    // drop maths works off the live, possibly-overlapping card rects.
    const cardMode = this.isCardMode();
    if (cardMode) {
      if (card.classList.contains("gluni-card--active")) return;
      const fromSlot = Number(card.dataset.cardSlot);
      if (!Number.isInteger(fromSlot)) return;
      event.preventDefault();
      this.closeInitiativeContextMenu();
      card.setPointerCapture?.(event.pointerId);
      this.cardDrag = {
        cardMode: true,
        combatantId: combatant.id,
        dragKey: card.dataset.gluniKey,
        fromSlot,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastClientY: event.clientY,
        moved: false,
        card
      };
      this.root.classList.add("gluni-initiative--card-dragging");
      card.classList.add("gluni-card--dragging");
      window.addEventListener("pointermove", this.onCardPointerMove);
      window.addEventListener("pointerup", this.onCardPointerUp, { once: true });
      window.addEventListener("pointercancel", this.onCardPointerCancel, { once: true });
      return;
    }

    const railCards = Array.from(this.root?.querySelectorAll(".gluni-rail .gluni-card[data-combatant-id]") ?? []);
    const originalIndex = railCards.indexOf(card);

    event.preventDefault();
    this.closeInitiativeContextMenu();
    card.setPointerCapture?.(event.pointerId);

    // Snapshot the untransformed geometry of every rail card so that drop-target
    // and gap calculations stay stable while the other cards shift to open space.
    const layout = railCards.map(el => {
      const rect = el.getBoundingClientRect();
      return { id: el.dataset.combatantId, el, mid: rect.top + rect.height / 2 };
    });

    this.cardDrag = {
      combatantId: combatant.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastClientY: event.clientY,
      moved: false,
      originalBeforeId: railCards[originalIndex - 1]?.dataset.combatantId ?? null,
      originalAfterId: railCards[originalIndex + 1]?.dataset.combatantId ?? null,
      layout,
      slotHeight: card.getBoundingClientRect().height + 5,
      card
    };

    this.root.classList.add("gluni-initiative--card-dragging");
    card.classList.add("gluni-card--dragging");
    window.addEventListener("pointermove", this.onCardPointerMove);
    window.addEventListener("pointerup", this.onCardPointerUp, { once: true });
    window.addEventListener("pointercancel", this.onCardPointerCancel, { once: true });
  }

  onPointerMove = event => {
    if (!this.drag) return;

    const x = clamp(this.drag.rootX + event.clientX - this.drag.startX, 0, window.innerWidth - this.root.offsetWidth);
    const y = clamp(this.drag.rootY + event.clientY - this.drag.startY, 0, window.innerHeight - this.root.offsetHeight);

    this.root.style.left = `${Math.round(x)}px`;
    this.root.style.top = `${Math.round(y)}px`;
    this.root.style.right = "auto";
  };

  onPointerUp = async () => {
    if (!this.drag) return;

    window.removeEventListener("pointermove", this.onPointerMove);
    this.root.classList.remove("gluni-initiative--dragging");
    this.drag = null;

    const rect = this.root.getBoundingClientRect();
    await game.settings.set(MODULE_ID, SETTINGS.position, {
      x: Math.round(rect.left),
      y: Math.round(rect.top)
    });
  };

  onCardPointerMove = event => {
    if (!this.cardDrag) return;

    this.cardDrag.lastClientY = event.clientY;
    const distance = Math.hypot(event.clientX - this.cardDrag.startX, event.clientY - this.cardDrag.startY);
    if (distance > 4) this.cardDrag.moved = true;
    if (!this.cardDrag.moved) return;

    this.cardDrag.card.style.setProperty("--gluni-card-drag-y", `${Math.round(event.clientY - this.cardDrag.startY)}px`);
    this.updateCardReorder(event.clientY);
  };

  onCardPointerUp = async event => {
    const drag = this.cardDrag;
    if (!drag) return;

    if (drag.cardMode) {
      const target = drag.moved ? this.getCardDropTargetCard(event.clientY) : null;
      this.finishCardDrag();
      if (!target || target.toSlot === drag.fromSlot) return;
      await this.moveCardSlot(drag.fromSlot, target.toSlot);
      return;
    }

    const target = drag.moved ? this.getCardDropTarget(event.clientY) : null;
    this.finishCardDrag();

    if (!target) return;
    if (target.beforeId === drag.originalBeforeId && target.afterId === drag.originalAfterId) return;

    const combatant = this.combat?.combatants?.get(drag.combatantId);
    if (!combatant) return;

    await this.moveCombatantBetween(combatant, target.beforeId, target.afterId);
  };

  onCardPointerCancel = () => {
    this.finishCardDrag();
  };

  finishCardDrag() {
    if (!this.cardDrag) return;

    window.removeEventListener("pointermove", this.onCardPointerMove);
    this.clearCardDropMarkers();
    for (const entry of this.cardDrag.layout ?? []) {
      entry.el?.style.removeProperty("--gluni-reorder-shift-y");
    }
    this.cardDrag.card.classList.remove("gluni-card--dragging");
    this.cardDrag.card.style.removeProperty("--gluni-card-drag-y");
    this.root.classList.remove("gluni-initiative--card-dragging");
    this.cardDrag = null;
  }

  // A background combat/actor update can rebuild the rail mid-drag, detaching the
  // dragged element and the cached layout. Re-bind to the fresh DOM (or cancel if
  // the dragged combatant is gone) so drop targeting reflects what the user sees.
  reacquireCardDragAfterRender() {
    const drag = this.cardDrag;
    if (!drag) return;

    // Card mode rebinds by the per-slot rail key (a multi-turn boss has several
    // cards sharing one combatant id, so the id alone is ambiguous) and refreshes
    // the slot index in case the deal shifted under us.
    if (drag.cardMode) {
      const newCard = drag.dragKey
        ? this.root?.querySelector(`.gluni-rail .gluni-card[data-gluni-key="${CSS.escape(drag.dragKey)}"]`)
        : null;
      if (!newCard || newCard.classList.contains("gluni-card--active")) {
        this.finishCardDrag();
        return;
      }
      const fromSlot = Number(newCard.dataset.cardSlot);
      if (!Number.isInteger(fromSlot)) {
        this.finishCardDrag();
        return;
      }
      drag.card = newCard;
      drag.fromSlot = fromSlot;
      this.root.classList.add("gluni-initiative--card-dragging");
      newCard.classList.add("gluni-card--dragging");
      newCard.setPointerCapture?.(drag.pointerId);
      if (drag.moved) {
        newCard.style.setProperty("--gluni-card-drag-y", `${Math.round(drag.lastClientY - drag.startY)}px`);
        this.updateCardReorder(drag.lastClientY);
      }
      return;
    }

    const railCards = Array.from(this.root?.querySelectorAll(".gluni-rail .gluni-card[data-combatant-id]") ?? []);
    const newCard = railCards.find(el => el.dataset.combatantId === drag.combatantId) ?? null;
    if (!newCard) {
      this.finishCardDrag();
      return;
    }

    drag.card = newCard;
    drag.slotHeight = newCard.getBoundingClientRect().height + 5;
    drag.layout = railCards.map(el => {
      const rect = el.getBoundingClientRect();
      return { id: el.dataset.combatantId, el, mid: rect.top + rect.height / 2 };
    });

    this.root.classList.add("gluni-initiative--card-dragging");
    newCard.classList.add("gluni-card--dragging");
    newCard.setPointerCapture?.(drag.pointerId);

    if (drag.moved) {
      newCard.style.setProperty("--gluni-card-drag-y", `${Math.round(drag.lastClientY - drag.startY)}px`);
      this.updateCardReorder(drag.lastClientY);
    }
  }

  // Shift the surrounding cards to open a gap where the dragged card will land,
  // and draw the drop line at that boundary.
  updateCardReorder(clientY) {
    this.clearCardDropMarkers();

    // Card mode: overlapping, variable-height cards make a slot-height gap shift
    // unreliable, so just draw the insertion line; the FLIP reflow animates the
    // cards into their new order on drop.
    if (this.cardDrag?.cardMode) {
      const target = this.getCardDropTargetCard(clientY);
      if (target?.marker) {
        target.marker.classList.add(target.position === "before" ? "gluni-card--drop-before" : "gluni-card--drop-after");
      }
      return;
    }

    const target = this.getCardDropTarget(clientY);
    if (!target) return;

    const fromIndex = target.fromIndex;
    const insertIndex = target.insertIndex;
    const slot = this.cardDrag?.slotHeight ?? 0;

    this.cardDrag?.layout.forEach((entry, i) => {
      if (i === fromIndex) return;
      const othersIndex = i < fromIndex ? i : i - 1;
      let delta = 0;
      if (i > fromIndex) delta -= slot;            // close the vacated slot
      if (othersIndex >= insertIndex) delta += slot; // open the landing gap
      entry.el?.style.setProperty("--gluni-reorder-shift-y", delta ? `${delta}px` : "0px");
    });

    if (target.marker) {
      target.marker.classList.add(target.position === "before" ? "gluni-card--drop-before" : "gluni-card--drop-after");
    }
  }

  clearCardDropMarkers() {
    for (const card of this.root?.querySelectorAll(".gluni-card--drop-before, .gluni-card--drop-after") ?? []) {
      card.classList.remove("gluni-card--drop-before", "gluni-card--drop-after");
    }
  }

  getCardDropTarget(clientY) {
    const drag = this.cardDrag;
    const layout = drag?.layout;
    if (!layout?.length) return null;

    const fromIndex = layout.findIndex(entry => entry.id === drag.combatantId);
    const others = layout.filter((_, i) => i !== fromIndex);
    if (!others.length) return null;

    let insertIndex = others.findIndex(entry => clientY < entry.mid);
    if (insertIndex < 0) insertIndex = others.length;

    const beforeEntry = others[insertIndex - 1] ?? null;
    const afterEntry = others[insertIndex] ?? null;
    const marker = afterEntry?.el ?? beforeEntry?.el ?? null;
    const position = afterEntry ? "before" : "after";

    return {
      beforeId: beforeEntry?.id ?? null,
      afterId: afterEntry?.id ?? null,
      fromIndex,
      insertIndex,
      marker,
      position
    };
  }

  // Card-mode drop target: find where, among the upcoming rail cards, the cursor
  // wants to land and return the absolute deal-sequence slot to insert before.
  getCardDropTargetCard(clientY) {
    const drag = this.cardDrag;
    if (!drag) return null;

    const cards = Array.from(this.root?.querySelectorAll(".gluni-rail .gluni-card[data-card-slot]") ?? [])
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          slot: Number(el.dataset.cardSlot),
          mid: rect.top + rect.height / 2,
          active: el.classList.contains("gluni-card--active")
        };
      })
      .filter(card => Number.isInteger(card.slot) && !card.active);
    if (!cards.length) return null;

    const others = cards.filter(card => card.slot !== drag.fromSlot);
    if (!others.length) return null;

    const before = others.find(card => clientY < card.mid);
    if (before) {
      return { toSlot: before.slot, marker: before.el, position: "before" };
    }
    const last = others[others.length - 1];
    return { toSlot: last.slot + 1, marker: last.el, position: "after" };
  }

  // Reorder the upcoming portion of the live deal. GM authority only (drag is
  // gated to the GM); active and already-spent slots are left untouched, and the
  // new order holds until the next round's reshuffle re-deals.
  async moveCardSlot(fromSlot, toSlot, combat = this.combat) {
    if (!game.user.isGM) return;
    const deal = this.getCardDeal(combat);
    if (!deal) return;
    const { pointer, sequence } = deal;
    if (!Number.isInteger(fromSlot) || fromSlot <= pointer || fromSlot >= sequence.length) return;
    if (!Number.isInteger(toSlot) || toSlot <= pointer || toSlot > sequence.length) return;

    const next = sequence.slice();
    const [moved] = next.splice(fromSlot, 1);
    const insertAt = toSlot > fromSlot ? toSlot - 1 : toSlot;
    if (insertAt === fromSlot) return;
    next.splice(insertAt, 0, moved);

    await combat.setFlag(MODULE_ID, FLAGS.cardDeal, { round: deal.round, pointer, sequence: next });
    this.broadcastRefresh();
  }

  async moveCombatantBetween(combatant, beforeId, afterId) {
    const combat = this.combat;
    if (!combat?.started || !combatant) return;

    const before = beforeId ? combat.combatants?.get(beforeId) : null;
    const after = afterId ? combat.combatants?.get(afterId) : null;
    if (!before && !after) return;

    const activeId = combat.combatant?.id ?? null;
    const initiative = chooseInitiativeBetween({
      before: before?.initiative,
      after: after?.initiative,
      existing: getUsedInitiatives(combat, combatant.id)
    });

    await this.applyCombatantInitiative(combatant, initiative);
    await this.restoreActiveTurn(activeId);
    this.broadcastRefresh();
  }

  async restoreActiveTurn(activeId) {
    if (!activeId) return;
    const activeIndex = Array.from(this.combat?.turns ?? []).findIndex(turn => turn.id === activeId);
    if (activeIndex >= 0 && this.combat?.turn !== activeIndex) await this.combat.update({ turn: activeIndex });
  }

  openInitiativeContextMenu(combatant, event) {
    this.closeInitiativeContextMenu();

    const currentInitiative = Number(combatant.initiative);
    const menu = document.createElement("form");
    menu.className = "gluni-context-menu";
    menu.innerHTML = `
      <label class="gluni-context-field">
        <span>${localize("GLUNI.Controls.AdjustInitiative")}</span>
        <input type="number" name="initiative" step="0.1" value="${escapeAttr(Number.isFinite(currentInitiative) ? formatInitiative(currentInitiative) : "")}" autofocus>
      </label>
      <div class="gluni-context-actions">
        <button type="button" data-context-action="decrease" title="${localize("GLUNI.Controls.DecreaseInitiative")}" aria-label="${localize("GLUNI.Controls.DecreaseInitiative")}">
          <i class="fa-solid fa-minus" aria-hidden="true"></i>
        </button>
        <button type="submit" data-context-action="apply">${localize("GLUNI.Controls.Apply").toUpperCase()}</button>
        <button type="button" data-context-action="increase" title="${localize("GLUNI.Controls.IncreaseInitiative")}" aria-label="${localize("GLUNI.Controls.IncreaseInitiative")}">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
        </button>
      </div>
      <button type="button" class="gluni-context-gauge${getBreakGaugeState(combatant) ? " gluni-context-gauge--active" : ""}" data-context-action="break-gauge">
        <i class="fa-solid fa-gauge-high" aria-hidden="true"></i>
        <span>${escapeHTML(localize("GLUNI.BreakGauge.Title").toUpperCase())}</span>
      </button>
      ${this.renderConditionContextSection(combatant)}
    `;

    document.body.appendChild(menu);
    const menuRect = menu.getBoundingClientRect();
    const left = clamp(event.clientX, 6, window.innerWidth - menuRect.width - 6);
    const top = clamp(event.clientY, 6, window.innerHeight - menuRect.height - 6);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    const input = menu.querySelector("input[name='initiative']");
    const applyValue = async value => {
      const activeId = this.combat?.combatant?.id ?? null;
      const initiative = makeUniqueInitiative(value, getUsedInitiatives(this.combat, combatant.id));
      await this.applyCombatantInitiative(combatant, initiative);
      await this.restoreActiveTurn(activeId);
      this.closeInitiativeContextMenu();
      this.broadcastRefresh();
    };

    menu.addEventListener("submit", async submitEvent => {
      submitEvent.preventDefault();
      const value = Number(input?.value);
      if (Number.isFinite(value)) await applyValue(value);
    });

    menu.addEventListener("click", async clickEvent => {
      const conditionButton = clickEvent.target.closest("[data-context-action='toggle-condition']");
      if (conditionButton) {
        clickEvent.preventDefault();
        await this.toggleHiddenCondition(combatant, conditionButton.dataset.key);
        const reopen = menu.getBoundingClientRect();
        this.closeInitiativeContextMenu();
        this.openInitiativeContextMenu(combatant, { clientX: reopen.left, clientY: reopen.top, preventDefault() {}, stopPropagation() {} });
        return;
      }
      const action = clickEvent.target.closest("[data-context-action]")?.dataset.contextAction;
      if (action === "break-gauge") {
        clickEvent.preventDefault();
        const anchor = menu.getBoundingClientRect();
        this.closeInitiativeContextMenu();
        openBreakGaugeEditor(combatant, anchor);
        return;
      }
      if (action !== "increase" && action !== "decrease") return;
      clickEvent.preventDefault();
      const base = Number(input?.value);
      const next = (Number.isFinite(base) ? base : currentInitiative || 0) + (action === "increase" ? 1 : -1);
      await applyValue(next);
    });

    const closeOnOutside = closeEvent => {
      if (menu.contains(closeEvent.target)) return;
      this.closeInitiativeContextMenu();
    };
    window.setTimeout(() => {
      if (this.contextMenu?.element !== menu) return;
      document.addEventListener("pointerdown", closeOnOutside);
      document.addEventListener("contextmenu", closeOnOutside);
    }, 0);

    this.contextMenu = { element: menu, closeOnOutside };
    input?.focus();
    input?.select();
  }

  closeInitiativeContextMenu() {
    if (this.contextMenu?.closeOnOutside) {
      document.removeEventListener("pointerdown", this.contextMenu.closeOnOutside);
      document.removeEventListener("contextmenu", this.contextMenu.closeOnOutside);
    }
    this.contextMenu?.element?.remove();
    this.contextMenu = null;
  }

  // Per-card condition visibility toggles. Lists every primary temporary
  // condition (PF2e condition items or D&D 5e statuses) so the GM can suppress
  // one on the tracker without touching the actual condition on the actor/token.
  renderConditionContextSection(combatant) {
    const items = getPrimaryConditionTags(combatant);
    if (!items.length) return "";

    const hidden = getHiddenConditionKeys(combatant);
    const rows = items.map(item => {
      const isHidden = hidden.has(item.key);
      const title = localize(isHidden ? "GLUNI.Conditions.Show" : "GLUNI.Conditions.Hide");
      return `
        <button type="button" class="gluni-context-condition${isHidden ? " gluni-context-condition--hidden" : ""}" data-context-action="toggle-condition" data-key="${escapeAttr(item.key)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">
          <i class="fa-solid ${isHidden ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i>
          <span>${escapeHTML(item.text)}</span>
        </button>
      `;
    }).join("");

    return `
      <div class="gluni-context-conditions">
        <span class="gluni-context-conditions-label">${escapeHTML(localize("GLUNI.Conditions.Title").toUpperCase())}</span>
        ${rows}
      </div>
    `;
  }

  async toggleHiddenCondition(combatant, key) {
    if (!game.user.isGM || !combatant || !key) return;
    const hidden = getHiddenConditionKeys(combatant);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    await combatant.setFlag(MODULE_ID, FLAGS.hiddenConditions, Array.from(hidden));
    this.broadcastRefresh();
  }

  applyPosition(edge) {
    const position = game.settings.get(MODULE_ID, SETTINGS.position) ?? {};
    const hasCustomX = Number.isFinite(position.x);
    const y = Number.isFinite(position.y) ? position.y : 120;
    const next = {
      top: `${y}px`,
      left: hasCustomX || edge === "left" ? `${hasCustomX ? position.x : 18}px` : "",
      right: hasCustomX || edge === "left" ? "auto" : "18px"
    };

    if (
      this.lastPositionStyle?.top === next.top &&
      this.lastPositionStyle?.left === next.left &&
      this.lastPositionStyle?.right === next.right
    ) return;

    this.root.style.top = next.top;
    this.root.style.left = next.left;
    this.root.style.right = next.right;
    this.lastPositionStyle = next;
  }

  applyUIScale(scale) {
    this.root?.style.setProperty("--gluni-ui-scale", String(scale || 1));
  }

  showRoundSplash(round) {
    if (!this.enabled || !round) return;
    if (this.lastSplashRound === round) return;
    this.lastSplashRound = round;

    const formatted = formatRound(round);
    const digitSpans = Array.from(formatted).map(digit => `<span class="d">${digit}</span>`).join("");
    const subString = formatLocalized("GLUNI.Splash.Cycle", { round: formatted });

    const splash = document.createElement("div");
    splash.className = "gluni-round-splash gluni-round-splash--cinematic";
    splash.innerHTML = `
      <div class="gluni-round-rule" aria-hidden="true"></div>
      <div class="gluni-round-splash-inner">
        <div class="gluni-round-deck" aria-hidden="true"></div>
        <div class="gluni-round-label">
          <span class="tick" aria-hidden="true"></span>
          <span>${localize("GLUNI.Round").toUpperCase()}</span>
        </div>
        <div class="gluni-round-num">${digitSpans}</div>
        <div class="gluni-round-sub"><span>${escapeHTML(subString)}</span></div>
      </div>
    `;
    document.body.appendChild(splash);

    window.requestAnimationFrame(() => splash.classList.add("gluni-round-splash--show"));
    window.setTimeout(() => splash.classList.add("gluni-round-splash--leave"), this.getRoundSplashHold());
    window.setTimeout(() => splash.remove(), this.getRoundSplashDuration());
  }

  getRoundSplashHold() {
    return 940;
  }

  getRoundSplashDuration() {
    return 1500;
  }

  broadcastRefresh() {
    this.renderSoon();
    if (socketReady()) emitSocket(FEATURE_ID, { type: "refresh" });
  }

  playStatusFlash(card, text, colorClass) {
    return new Promise(resolve => {
      const flash = document.createElement("div");
      flash.className = `gluni-status-flash gluni-status-flash--${colorClass}`;
      flash.innerHTML = `<span>${escapeHTML(text)}</span>`;
      card.appendChild(flash);
      window.requestAnimationFrame(() => flash.classList.add("gluni-status-flash--go"));
      window.setTimeout(() => {
        flash.remove();
        resolve();
      }, 560);
    });
  }

  playInlineStatusFlash(card, text, colorClass) {
    const flash = document.createElement("div");
    // Long condition names (e.g. "PERSISTENT FIRE DAMAGE") overflow the card at
    // the default flash size; shrink them so they still read in one pass.
    const lengthClass = text.length > 22 ? " gluni-status-flash--xlong" : text.length > 13 ? " gluni-status-flash--long" : "";
    flash.className = `gluni-status-flash gluni-status-flash--${colorClass}${lengthClass}`;
    flash.innerHTML = `<span>${escapeHTML(text)}</span>`;
    // Mount on the clipped surface (not the outer card) so clip-path: inherit
    // keeps the flash within the card silhouette.
    (card.querySelector(".gluni-card-surface") ?? card).appendChild(flash);
    window.requestAnimationFrame(() => flash.classList.add("gluni-status-flash--go"));
    window.setTimeout(() => flash.remove(), 620);
  }

  // One-shot "stamp" entrance for a status tag chip when its status is first applied.
  pulseTagEnter(card, selector) {
    const tag = card?.querySelector?.(selector);
    if (!tag) return;
    tag.classList.remove("gluni-tag--enter");
    void tag.offsetWidth;
    tag.classList.add("gluni-tag--enter");
    window.setTimeout(() => tag.classList.remove("gluni-tag--enter"), 480);
  }

  createStatusSlideGhost(card, edge) {
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.querySelector(".gluni-card-controls")?.remove();
    ghost.querySelector(".gluni-card-sheen")?.remove();
    ghost.querySelector(".gluni-status-flash")?.remove();
    ghost.classList.add("gluni-status-slide-ghost");
    ghost.style.position = "fixed";
    ghost.style.left = `${Math.round(rect.left)}px`;
    ghost.style.top = `${Math.round(rect.top)}px`;
    ghost.style.width = `${Math.round(rect.width)}px`;
    ghost.style.height = `${Math.round(rect.height)}px`;
    ghost.style.zIndex = "71";
    ghost.style.margin = "0";
    document.body.appendChild(ghost);
    window.requestAnimationFrame(() => {
      ghost.classList.add(edge === "left" ? "gluni-status-slide-ghost--go-left" : "gluni-status-slide-ghost--go-right");
    });
    window.setTimeout(() => ghost.remove(), 320);
  }

  createStatusFlashGhost(card, text, colorClass, edge) {
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.querySelector(".gluni-card-controls")?.remove();
    ghost.querySelector(".gluni-card-sheen")?.remove();
    ghost.querySelector(".gluni-status-flash")?.remove();
    ghost.classList.add("gluni-status-slide-ghost", "gluni-status-slide-ghost--cinematic");
    ghost.style.position = "fixed";
    ghost.style.left = `${Math.round(rect.left)}px`;
    ghost.style.top = `${Math.round(rect.top)}px`;
    ghost.style.width = `${Math.round(rect.width)}px`;
    ghost.style.height = `${Math.round(rect.height)}px`;
    ghost.style.zIndex = "71";
    ghost.style.margin = "0";
    const flash = document.createElement("div");
    flash.className = `gluni-status-flash gluni-status-flash--${colorClass}`;
    flash.innerHTML = `<span>${escapeHTML(text)}</span>`;
    ghost.appendChild(flash);
    document.body.appendChild(ghost);
    window.requestAnimationFrame(() => flash.classList.add("gluni-status-flash--go"));
    const flashDuration = 680;
    const slideDuration = 420;
    window.setTimeout(() => {
      flash.remove();
      ghost.classList.add(edge === "left" ? "gluni-status-slide-ghost--go-left" : "gluni-status-slide-ghost--go-right");
      window.setTimeout(() => ghost.remove(), slideDuration);
    }, flashDuration);
  }

  playPendingSlideIns() {
    if (!this.pendingSlideInIds.size || !this.root) return;
    // Iterate a snapshot so we can drop entries that played while leaving the
    // rest pending. A transition detected while the card was outside this
    // client's window (full-roster detection) keeps its cue until the card
    // actually renders, so the entrance still plays when it scrolls into view.
    for (const id of [...this.pendingSlideInIds]) {
      const card = this.root.querySelector(`.gluni-card[data-combatant-id="${escapeCSSIdentifier(id)}"]`);
      if (!card) continue;
      const statusKind = this.pendingStatusFlashes.get(id);
      // A cue queued while the card was off-window may have gone stale by the
      // time the card scrolls in (status reverted). Re-check the live flag —
      // delay/guard-break are flag-based and replicate to every client — and
      // drop the cue rather than flash a status the combatant no longer has.
      // (A GM-local slide-in without a tracked kind always plays.)
      const combatant = statusKind ? this.combat?.combatants?.get?.(id) : null;
      const stale = (statusKind === "delay" && !(combatant && this.isDelayed(combatant)))
        || (statusKind === "guardBreak" && !(combatant && getGuardBreakState(combatant)));
      if (stale) {
        this.pendingStatusFlashes.delete(id);
        this.pendingSlideInIds.delete(id);
        continue;
      }
      const status = STATUS_ANIMATION[statusKind];
      if (status) this.playInlineStatusFlash(card, localize(status.label).toUpperCase(), status.colorClass);
      if (statusKind === "delay") {
        this.pulseTagEnter(card, ".gluni-delayed-tag");
        // Mirror the dying/break entrance richness: wipe the time-shift field in
        // and settle the card with a blue energy pulse rather than a bare slide.
        card.classList.add("gluni-card--delay-entering");
        window.setTimeout(() => card.classList.remove("gluni-card--delay-entering"), 700);
      }
      this.pendingStatusFlashes.delete(id);
      this.pendingSlideInIds.delete(id);
      card.classList.add("gluni-card--slide-in");
      window.setTimeout(() => card.classList.remove("gluni-card--slide-in"), 400);
    }
  }

  playPendingDyingWipes() {
    if (!this.pendingDyingWipeIds.size || !this.root) return;
    for (const id of this.pendingDyingWipeIds) {
      const card = this.root.querySelector(`.gluni-card[data-combatant-id="${escapeCSSIdentifier(id)}"]`);
      if (!card || !card.classList.contains("gluni-card--dying")) continue;
      card.classList.add("gluni-card--dying-entering");
      const flashLabel = card.classList.contains("gluni-card--deathsaves")
        ? localize("GLUNI.DeathSaves")
        : localize("GLUNI.Dying");
      this.playInlineStatusFlash(card, flashLabel.toUpperCase(), "dying");
      this.pulseTagEnter(card, ".gluni-dying-tag");
      window.setTimeout(() => card.classList.remove("gluni-card--dying-entering"), 640);
    }
    this.pendingDyingWipeIds.clear();
  }

  // One-shot horizontal announce for each newly applied primary condition,
  // mirroring the break/dying/delay flash. Multiple conditions applied in the
  // same tick are staggered so each reads. The card node is re-queried inside
  // the timeout because an intervening render() replaces the overlay markup.
  playPendingConditionFlashes() {
    if (!this.pendingConditionFlashes.size || !this.root) return;
    for (const [id, texts] of this.pendingConditionFlashes) {
      const selector = `.gluni-card[data-combatant-id="${escapeCSSIdentifier(id)}"]`;
      const card = this.root.querySelector(selector);
      if (!card) continue;
      card.classList.add("gluni-card--condition-entering");
      window.setTimeout(() => this.root?.querySelector(selector)?.classList.remove("gluni-card--condition-entering"), 620);
      texts.forEach((text, index) => {
        window.setTimeout(() => {
          const live = this.root?.querySelector(selector);
          if (live) this.playInlineStatusFlash(live, text, "condition");
        }, index * 240);
      });
    }
    this.pendingConditionFlashes.clear();
  }

  // Status sets are computed from the FULL combatant list (respecting this
  // client's visibility), never the windowed view. A combatant that scrolls
  // out of the visible window and back in must not read as a fresh status
  // transition (which previously replayed the break splash on every turn).
  collectStatusSets() {
    const dying = new Set();
    const delayed = new Set();
    const broken = new Set();
    // id -> Map(conditionKey -> displayText). Tracked raw (ignoring override)
    // so override clearing never replays an announce; `conditionOverridden`
    // gates whether a transition is allowed to flash.
    const conditions = new Map();
    const conditionOverridden = new Set();
    // id -> Set(hidden slug). Transition tracking ignores the GM hide toggle so
    // hiding/unhiding never fakes a "new condition"; these let the announce loop
    // skip flashing a condition that is currently hidden.
    const conditionHidden = new Map();
    const combat = this.combat;
    if (!combat) return { dying, delayed, broken, conditions, conditionOverridden, conditionHidden };

    const showDefeated = Boolean(game.settings.get(MODULE_ID, SETTINGS.showDefeated));
    const combatants = combat.combatants?.contents ?? Array.from(combat.combatants ?? []);
    for (const entry of combatants) {
      const combatant = Array.isArray(entry) ? entry[1] : entry;
      if (!combatant || isAdhocCombatant(combatant)) continue;

      const visibility = this.resolveVisibility(combatant);
      // Hidden/mystery combatants must never leak a status through detection.
      if (!game.user.isGM && visibility.playerMode === VISIBILITY.hidden) continue;
      if (!game.user.isGM && visibility.playerMode === VISIBILITY.mystery) continue;

      const skipped = Boolean(combatant.defeated && !showDefeated);
      if (skipped) continue;

      const isBroken = Boolean(getGuardBreakState(combatant));
      const isDelayedNow = this.isDelayed(combatant);
      const isDying = Boolean(getDyingState(combatant));
      if (isBroken) broken.add(combatant.id);
      if (isDelayedNow) delayed.add(combatant.id);
      if (isDying) dying.add(combatant.id);

      // Track the FULL primary set (ignoring the GM per-card hide toggle) so a
      // long-standing condition that gets hidden then shown is not mistaken for
      // a freshly applied one. Hidden slugs are remembered separately so the
      // announce loop can skip flashing them while still recording them.
      const primary = getPrimaryConditionTags(combatant);
      if (primary.length) {
        const keyTexts = new Map();
        for (const tag of primary) keyTexts.set(tag.key, tag.text);
        conditions.set(combatant.id, keyTexts);
        const hidden = getHiddenConditionKeys(combatant);
        if (hidden.size) conditionHidden.set(combatant.id, hidden);
        if (isBroken || isDelayedNow || isDying) conditionOverridden.add(combatant.id);
      }
    }
    return { dying, delayed, broken, conditions, conditionOverridden, conditionHidden };
  }

  detectStatusTransitions() {
    const hadSnapshot = this.statusSnapshotInitialized;
    const isPrimaryGM = game.user.isGM && this.isPrimaryActiveGM();
    const {
      dying: currentDying,
      delayed: currentDelayed,
      broken: currentBroken,
      conditions: currentConditions,
      conditionOverridden,
      conditionHidden
    } = this.collectStatusSets();

    for (const id of currentDying) {
      if (this.lastDyingIds.has(id)) continue;

      const queuedLocally = !this.statusAnimationRecentlyQueued(id, "dying");
      if (queuedLocally) this.pendingDyingWipeIds.add(id);
      if (queuedLocally && hadSnapshot && isPrimaryGM) {
        this.broadcastStatusAnimation(id, "dying");
      }
    }
    const edge = game.settings.get(MODULE_ID, SETTINGS.edge) || "right";
    for (const id of currentDelayed) {
      if (this.lastDelayedIds.has(id)) continue;
      if (this.statusAnimationRecentlyQueued(id, "delay")) continue;
      const cardEl = this.root?.querySelector(`.gluni-card[data-combatant-id="${escapeCSSIdentifier(id)}"]`);
      if (cardEl) {
        this.createStatusFlashGhost(cardEl, localize("GLUNI.Delayed").toUpperCase(), "delay", edge);
      }
      this.pendingSlideInIds.add(id);
      // Drive the on-card swipe directly so the entrance plays even when the
      // card was off-screen before (no ghost), e.g. on player clients.
      this.pendingStatusFlashes.set(id, "delay");
      if (hadSnapshot && isPrimaryGM) this.broadcastStatusAnimation(id, "delay");
    }
    for (const id of currentBroken) {
      if (this.lastBrokenIds.has(id)) continue;
      if (this.statusAnimationRecentlyQueued(id, "guardBreak")) continue;
      const cardEl = this.root?.querySelector(`.gluni-card[data-combatant-id="${escapeCSSIdentifier(id)}"]`);
      if (cardEl) {
        this.createStatusFlashGhost(cardEl, localize("GLUNI.GuardBreak").toUpperCase(), "break", edge);
      }
      this.pendingSlideInIds.add(id);
      this.pendingStatusFlashes.set(id, "guardBreak");
      if (hadSnapshot && isPrimaryGM) this.broadcastStatusAnimation(id, "guardBreak");
    }
    // Generic PF2e conditions replicate to every client (they are items on the
    // actor), so each client detects new conditions and plays the announce
    // locally — no socket broadcast needed. A condition new since the last
    // snapshot announces once; nested/linked children were already filtered out
    // upstream. Overridden combatants record their slugs silently so a later
    // override clear never replays the announce.
    const nextConditionKeys = new Map();
    for (const [id, keyTexts] of currentConditions) {
      nextConditionKeys.set(id, new Set(keyTexts.keys()));
      if (!hadSnapshot || conditionOverridden.has(id)) continue;
      const last = this.lastConditionKeys.get(id) ?? new Set();
      const hidden = conditionHidden.get(id);
      for (const [key, text] of keyTexts) {
        if (last.has(key)) continue;
        // Remember (via nextConditionKeys above) but never announce a condition
        // the GM has hidden — otherwise unhiding it later would flash anew.
        if (hidden?.has(key)) continue;
        if (this.statusAnimationRecentlyQueued(id, `condition:${key}`)) continue;
        if (!this.pendingConditionFlashes.has(id)) this.pendingConditionFlashes.set(id, []);
        this.pendingConditionFlashes.get(id).push(text);
      }
    }
    this.lastConditionKeys = nextConditionKeys;

    this.lastDyingIds = currentDying;
    this.lastDelayedIds = currentDelayed;
    this.lastBrokenIds = currentBroken;
    this.statusSnapshotInitialized = true;
  }
}

function getPortrait(combatant) {
  const actorImage = combatant.actor?.img;
  const tokenImage = combatant.token?.texture?.src || combatant.token?.img || combatant.img;
  return actorImage || tokenImage || FALLBACK_PORTRAIT;
}

function renderCombatantStyle(card) {
  const styleParts = [];
  if (card.portraitFrame) styleParts.push(renderPortraitFrameStyle(card.portraitFrame));
  if (Number.isFinite(card.portraitScaleCap)) {
    styleParts.push(`--gluni-portrait-quality-cap: ${card.portraitScaleCap.toFixed(3)};`);
  }
  // Card-mode deck stacking: earlier draws paint above later ones so each card's
  // lower band (name + badge + status) stays clear of the card tucked beneath it.
  if (Number.isInteger(card.cardOrder)) {
    styleParts.push(`--gluni-deck-z: ${40 - card.cardOrder};`);
  }
  return styleParts.length ? ` style="${escapeAttr(styleParts.join(" "))}"` : "";
}

function getUsedInitiatives(combat, exceptId = null) {
  return Array.from(combat?.combatants ?? [])
    .map(entry => Array.isArray(entry) ? entry[1] : entry)
    .filter(combatant => combatant?.id !== exceptId)
    .map(combatant => Number(combatant.initiative))
    .filter(Number.isFinite);
}

function getInitiativeMode() {
  return game.settings.get(MODULE_ID, SETTINGS.initiativeMode) === INITIATIVE_MODE.card
    ? INITIATIVE_MODE.card
    : INITIATIVE_MODE.standard;
}

function normalizeCardConfig(value) {
  const config = { ...CARD_CONFIG_DEFAULTS };
  if (value && typeof value === "object") {
    for (const key of ["cards", "turns"]) {
      const number = Math.round(Number(value[key]));
      if (Number.isFinite(number)) {
        config[key] = clamp(number, CARD_CONFIG_LIMITS[key].min, CARD_CONFIG_LIMITS[key].max);
      }
    }
  }
  return config;
}

function getActorCardConfig(actor) {
  return normalizeCardConfig(actor?.getFlag?.(MODULE_ID, FLAGS.cardConfig));
}

function getCombatantCardConfig(combatant) {
  return getActorCardConfig(combatant?.actor);
}

// Fisher-Yates, in place.
function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Builds a freshly shuffled turn order for the round. Each combatant contributes
// max(cards, turns) copies to the deck; dealing one card at a time, a combatant
// gains a turn slot on each draw until it has reached its `turns` count, after
// which further draws of that combatant are ignored. The result is an ordered
// list of { cid, n } slots, where n is the 0-based occurrence for that combatant
// (so multi-turn actors get stable per-occurrence keys for animation).
function buildCardSequence(combatants) {
  const deck = [];
  const turnsById = new Map();
  for (const combatant of combatants) {
    if (!combatant?.id) continue;
    const config = getCombatantCardConfig(combatant);
    const copies = Math.max(config.cards, config.turns);
    turnsById.set(combatant.id, config.turns);
    for (let i = 0; i < copies; i++) deck.push(combatant.id);
  }

  shuffleInPlace(deck);

  const sequence = [];
  const placed = new Map();
  for (const cid of deck) {
    const used = placed.get(cid) ?? 0;
    if (used >= (turnsById.get(cid) ?? 1)) continue;
    sequence.push({ cid, n: used });
    placed.set(cid, used + 1);
  }
  return sequence;
}

function nativeTurnIndexOf(combat, cid) {
  const turns = Array.from(combat?.turns ?? [])
    .map(entry => Array.isArray(entry) ? entry[1] : entry);
  const index = turns.findIndex(combatant => combatant?.id === cid);
  return index >= 0 ? index : null;
}

function chooseInitiativeBetween({ before, after, existing = [] } = {}) {
  const beforeValue = normalizeInitiativeNumber(before);
  const afterValue = normalizeInitiativeNumber(after);
  const used = new Set(Array.from(existing).map(value => normalizeInitiativeNumber(value)).filter(Number.isFinite));

  if (Number.isFinite(beforeValue) && Number.isFinite(afterValue) && beforeValue > afterValue) {
    const wholeHigh = Math.ceil(beforeValue) - 1;
    const wholeLow = Math.floor(afterValue) + 1;
    for (let value = wholeHigh; value >= wholeLow; value -= 1) {
      if (value < beforeValue && value > afterValue && !used.has(value)) return value;
    }

    return makeUniqueInitiative((beforeValue + afterValue) / 2, used, { min: afterValue, max: beforeValue });
  }

  if (Number.isFinite(afterValue)) {
    const whole = Math.floor(afterValue) + 1;
    if (whole > afterValue && !used.has(whole)) return whole;
    return makeUniqueInitiative(afterValue + 1, used, { min: afterValue });
  }

  if (Number.isFinite(beforeValue)) {
    const whole = Math.ceil(beforeValue) - 1;
    if (whole < beforeValue && !used.has(whole)) return whole;
    return makeUniqueInitiative(beforeValue - 1, used, { max: beforeValue });
  }

  return makeUniqueInitiative(10, used);
}

function makeUniqueInitiative(value, existing = [], bounds = {}) {
  const used = existing instanceof Set
    ? existing
    : new Set(Array.from(existing).map(entry => normalizeInitiativeNumber(entry)).filter(Number.isFinite));
  const base = normalizeInitiativeNumber(value);
  const fallback = Number.isFinite(base) ? base : 10;
  const min = normalizeInitiativeNumber(bounds.min);
  const max = normalizeInitiativeNumber(bounds.max);
  const fits = candidate => {
    if (!Number.isFinite(candidate)) return false;
    if (Number.isFinite(min) && candidate <= min) return false;
    if (Number.isFinite(max) && candidate >= max) return false;
    return !used.has(candidate);
  };

  if (fits(fallback)) return fallback;

  for (let step = 1; step <= 100; step += 1) {
    const offset = step / 10;
    for (const direction of [1, -1]) {
      const candidate = normalizeInitiativeNumber(fallback + direction * offset);
      if (fits(candidate)) return candidate;
    }
  }

  for (let step = 1; step <= 1000; step += 1) {
    const offset = step / 10;
    for (const direction of [1, -1]) {
      const candidate = normalizeInitiativeNumber(fallback + direction * offset);
      if (Number.isFinite(candidate) && !used.has(candidate)) return candidate;
    }
  }

  return normalizeInitiativeNumber(fallback + 0.1);
}


function closeBreakGaugeEditor() {
  if (breakGaugeEditor?.closeOnOutside) {
    document.removeEventListener("pointerdown", breakGaugeEditor.closeOnOutside);
    window.removeEventListener("keydown", breakGaugeEditor.onKeyDown);
  }
  breakGaugeEditor?.element?.remove();
  breakGaugeEditor = null;
}

// Floating editor for a combatant's break gauge. Opened from the initiative
// card right-click menu and from the token HUD button; both edit the same flag
// via overlay.setBreakGauge / overlay.clearBreakGauge. `anchor` is a viewport
// rect (e.g. the source button) the popover is positioned beneath.
function openBreakGaugeEditor(combatant, anchor) {
  if (!game.user.isGM || !combatant || isAdhocCombatant(combatant)) return;
  closeBreakGaugeEditor();

  const state = getBreakGaugeState(combatant);
  const initial = state ?? { max: BREAK_GAUGE_DEFAULT_MAX, value: BREAK_GAUGE_DEFAULT_MAX, mode: BREAK_GAUGE_MODES.smooth };
  let mode = initial.mode;

  const form = document.createElement("form");
  form.className = "gluni-break-gauge-editor";
  form.innerHTML = `
    <div class="gluni-break-gauge-editor-title">${escapeHTML(localize("GLUNI.BreakGauge.Title").toUpperCase())}</div>
    <label class="gluni-context-field">
      <span>${escapeHTML(localize("GLUNI.BreakGauge.Max"))}</span>
      <input type="number" name="max" min="1" step="1" value="${escapeAttr(String(initial.max))}">
    </label>
    <label class="gluni-context-field">
      <span>${escapeHTML(localize("GLUNI.BreakGauge.Current"))}</span>
      <div class="gluni-gauge-stepper">
        <button type="button" data-gauge-action="decrease" title="-1" aria-label="-1"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
        <input type="number" name="value" min="0" step="1" value="${escapeAttr(String(initial.value))}">
        <button type="button" data-gauge-action="increase" title="+1" aria-label="+1"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
      </div>
    </label>
    <div class="gluni-break-gauge-modes" role="group">
      <button type="button" data-gauge-mode="smooth">${escapeHTML(localize("GLUNI.BreakGauge.Mode.Smooth"))}</button>
      <button type="button" data-gauge-mode="segmented">${escapeHTML(localize("GLUNI.BreakGauge.Mode.Segmented"))}</button>
    </div>
    <div class="gluni-break-gauge-editor-buttons">
      ${state ? `<button type="button" class="gluni-break-gauge-remove" data-gauge-action="remove">${escapeHTML(localize("GLUNI.BreakGauge.Clear").toUpperCase())}</button>` : ""}
      <button type="submit" class="gluni-break-gauge-apply">${escapeHTML(localize("GLUNI.BreakGauge.Apply").toUpperCase())}</button>
    </div>
  `;

  document.body.appendChild(form);

  const maxInput = form.querySelector("input[name='max']");
  const valueInput = form.querySelector("input[name='value']");
  const modeButtons = Array.from(form.querySelectorAll("[data-gauge-mode]"));
  const syncModeButtons = () => modeButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.gaugeMode === mode));
  syncModeButtons();

  const rect = form.getBoundingClientRect();
  const anchorRect = anchor ?? { left: window.innerWidth / 2, bottom: window.innerHeight / 2 };
  const left = clamp(anchorRect.left, 6, window.innerWidth - rect.width - 6);
  const top = clamp((anchorRect.bottom ?? anchorRect.top ?? 0) + 6, 6, window.innerHeight - rect.height - 6);
  form.style.left = `${Math.round(left)}px`;
  form.style.top = `${Math.round(top)}px`;

  const readMax = () => Math.max(1, Math.round(Number(maxInput.value) || 0));
  const clampValue = () => {
    const max = readMax();
    valueInput.max = String(max);
    valueInput.value = String(clamp(Math.round(Number(valueInput.value) || 0), 0, max));
  };
  maxInput.addEventListener("input", clampValue);
  valueInput.addEventListener("input", clampValue);

  form.addEventListener("click", clickEvent => {
    const modeBtn = clickEvent.target.closest("[data-gauge-mode]");
    if (modeBtn) {
      mode = modeBtn.dataset.gaugeMode === BREAK_GAUGE_MODES.segmented ? BREAK_GAUGE_MODES.segmented : BREAK_GAUGE_MODES.smooth;
      syncModeButtons();
      return;
    }
    const action = clickEvent.target.closest("[data-gauge-action]")?.dataset.gaugeAction;
    if (action === "increase" || action === "decrease") {
      valueInput.value = String(Number(valueInput.value || 0) + (action === "increase" ? 1 : -1));
      clampValue();
    } else if (action === "remove") {
      closeBreakGaugeEditor();
      overlay?.clearBreakGauge(combatant);
    }
  });

  form.addEventListener("submit", async submitEvent => {
    submitEvent.preventDefault();
    const max = readMax();
    const value = clamp(Math.round(Number(valueInput.value) || 0), 0, max);
    closeBreakGaugeEditor();
    await overlay?.setBreakGauge(combatant, { max, value, mode });
  });

  const closeOnOutside = closeEvent => {
    if (form.contains(closeEvent.target)) return;
    closeBreakGaugeEditor();
  };
  const onKeyDown = keyEvent => {
    if (keyEvent.key === "Escape") closeBreakGaugeEditor();
  };
  window.setTimeout(() => {
    if (breakGaugeEditor?.element !== form) return;
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", onKeyDown);
  }, 0);

  breakGaugeEditor = { element: form, closeOnOutside, onKeyDown };
  maxInput.focus();
  maxInput.select();
}

function getPortraitScaleCap(path) {
  if (!path) return 1;
  const cached = portraitQualityCache.get(path);
  if (cached) return cached.scaleCap;

  const pending = { scaleCap: 1, ready: false };
  portraitQualityCache.set(path, pending);
  loadPortraitScaleCap(path, pending);
  return pending.scaleCap;
}

async function loadPortraitScaleCap(path, entry) {
  try {
    const texture = await loadTexture(path, { fallback: FALLBACK_PORTRAIT });
    const baseTexture = texture?.baseTexture;
    if (baseTexture && globalThis.PIXI?.SCALE_MODES) {
      baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
      baseTexture.update?.();
    }
    const width = baseTexture?.realWidth ?? baseTexture?.width ?? texture?.width ?? 0;
    const height = baseTexture?.realHeight ?? baseTexture?.height ?? texture?.height ?? 0;
    const cap = computePortraitScaleCap(width, height);
    entry.scaleCap = cap;
    entry.ready = true;
    overlay?.renderSoon();
  } catch (_error) {
    entry.scaleCap = 1;
    entry.ready = true;
  }
}

function computePortraitScaleCap(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  const pixels = width * height;
  if (pixels <= 0) return 1;
  const normalArea = 188 * PORTRAIT_MIN_PIXELS.normalHeight;
  const activeArea = 200 * PORTRAIT_MIN_PIXELS.activeHeight;
  const targetArea = Math.max(normalArea, activeArea);
  const ratio = Math.sqrt(pixels / targetArea);
  return clamp(ratio, 0.22, 1);
}

function addPortraitHeaderButton(app, buttons) {
  const actor = getActorFromSheet(app);
  if (!canConfigurePortrait(actor)) return;
  if (buttons.some(button => button.class === "gluni-portrait-frame")) return;

  buttons.unshift({
    label: localize("GLUNI.PortraitConfig.Button"),
    class: "gluni-portrait-frame",
    icon: "fa-solid fa-crop-simple",
    onclick: event => {
      event?.preventDefault?.();
      openPortraitConfigDialog(actor);
    }
  });
}

function addPortraitHeaderControl(app, controls) {
  const actor = getActorFromSheet(app);
  if (!canConfigurePortrait(actor)) return;
  if (controls.some(control => control.action === "gluni-portrait-frame")) return;

  controls.unshift({
    action: "gluni-portrait-frame",
    icon: "fa-solid fa-crop-simple",
    label: localize("GLUNI.PortraitConfig.Button"),
    onClick: event => {
      event?.preventDefault?.();
      openPortraitConfigDialog(actor);
    },
    visible: true
  });
}

function injectPortraitTitlebarButton(app, html) {
  const actor = getActorFromSheet(app);
  if (!canConfigurePortrait(actor)) return;

  const element = getHTMLElement(html) ?? getHTMLElement(app.element) ?? app.element;
  const wrapper = element?.closest?.(".app, .application, .window-app") ?? element;
  const header = app.window?.header ?? wrapper?.querySelector?.(".window-header");
  if (!header || header.querySelector("[data-gluni-portrait-frame], .gluni-portrait-frame")) return;

  const button = document.createElement("a");
  button.className = "header-button gluni-portrait-frame";
  button.dataset.gluniPortraitFrame = "true";
  button.dataset.action = "gluni-portrait-frame";
  button.title = localize("GLUNI.PortraitConfig.Open");
  button.innerHTML = `<i class="fa-solid fa-crop-simple" aria-hidden="true"></i>${localize("GLUNI.PortraitConfig.Button")}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openPortraitConfigDialog(actor);
  });

  const close = header.querySelector('[data-action="close"], .close');
  if (close) header.insertBefore(button, close);
  else header.appendChild(button);
}

function getActorFromSheet(app) {
  const document = app?.actor ?? app?.document ?? app?.object ?? app?.options?.document;
  return document?.documentName === "Actor" ? document : null;
}

function canConfigurePortrait(actor) {
  if (!actor || !CONFIGURABLE_ACTOR_TYPES.has(actor.type)) return false;
  return game.user.isGM || actor.isOwner || actor.testUserPermission?.(game.user, "OWNER");
}

// The card-deck control only appears for users who could configure the actor and
// only while Card initiative mode is active, since it has no effect otherwise.
function canConfigureCards(actor) {
  return getInitiativeMode() === INITIATIVE_MODE.card && canConfigurePortrait(actor);
}

function addCardConfigHeaderButton(app, buttons) {
  const actor = getActorFromSheet(app);
  if (!canConfigureCards(actor)) return;
  if (buttons.some(button => button.class === "gluni-card-config")) return;

  buttons.unshift({
    label: localize("GLUNI.Card.Config.Button"),
    class: "gluni-card-config",
    icon: "fa-solid fa-clone",
    onclick: event => {
      event?.preventDefault?.();
      openCardConfigDialog(actor);
    }
  });
}

function addCardConfigHeaderControl(app, controls) {
  const actor = getActorFromSheet(app);
  if (!canConfigureCards(actor)) return;
  if (controls.some(control => control.action === "gluni-card-config")) return;

  controls.unshift({
    action: "gluni-card-config",
    icon: "fa-solid fa-clone",
    label: localize("GLUNI.Card.Config.Button"),
    onClick: event => {
      event?.preventDefault?.();
      openCardConfigDialog(actor);
    },
    visible: true
  });
}

function injectCardConfigTitlebarButton(app, html) {
  const actor = getActorFromSheet(app);
  if (!canConfigureCards(actor)) return;

  const element = getHTMLElement(html) ?? getHTMLElement(app.element) ?? app.element;
  const wrapper = element?.closest?.(".app, .application, .window-app") ?? element;
  const header = app.window?.header ?? wrapper?.querySelector?.(".window-header");
  if (!header || header.querySelector("[data-gluni-card-config], .gluni-card-config")) return;

  const button = document.createElement("a");
  button.className = "header-button gluni-card-config";
  button.dataset.gluniCardConfig = "true";
  button.dataset.action = "gluni-card-config";
  button.title = localize("GLUNI.Card.Config.Open");
  button.innerHTML = `<i class="fa-solid fa-clone" aria-hidden="true"></i>${localize("GLUNI.Card.Config.Button")}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openCardConfigDialog(actor);
  });

  const close = header.querySelector('[data-action="close"], .close');
  if (close) header.insertBefore(button, close);
  else header.appendChild(button);
}

function openCardConfigDialog(actor) {
  const config = getActorCardConfig(actor);

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return;

  new DialogV2({
    window: { title: formatLocalized("GLUNI.Card.Config.Title", { name: actor.name }) },
    classes: ["gluni-card-config-dialog"],
    position: { width: 440 },
    content: renderCardConfigDialog(config),
    buttons: [
      {
        action: "reset",
        icon: "fa-solid fa-rotate-left",
        label: localize("GLUNI.Card.Config.Reset"),
        callback: async () => {
          await actor.unsetFlag(MODULE_ID, FLAGS.cardConfig);
          overlay?.maybeRedealCards();
          overlay?.broadcastRefresh();
        }
      },
      {
        action: "save",
        icon: "fa-solid fa-check",
        label: localize("GLUNI.Card.Config.Save"),
        default: true,
        callback: async (event, button) => {
          const next = readCardConfigForm(button.form);
          await actor.setFlag(MODULE_ID, FLAGS.cardConfig, next);
          overlay?.maybeRedealCards();
          overlay?.broadcastRefresh();
        }
      }
    ]
  }).render({ force: true });
}

function renderCardConfigDialog(config) {
  const cardsField = renderCardConfigField(
    "cards",
    localize("GLUNI.Card.Config.Cards"),
    localize("GLUNI.Card.Config.CardsHint"),
    config.cards,
    CARD_CONFIG_LIMITS.cards
  );
  const turnsField = renderCardConfigField(
    "turns",
    localize("GLUNI.Card.Config.Turns"),
    localize("GLUNI.Card.Config.TurnsHint"),
    config.turns,
    CARD_CONFIG_LIMITS.turns
  );

  return `
    <div class="gluni-card-config-form" autocomplete="off">
      <p class="gluni-card-config-note">${localize("GLUNI.Card.Config.Hint")}</p>
      ${cardsField}
      ${turnsField}
    </div>
  `;
}

function renderCardConfigField(name, label, hint, value, limits) {
  return `
    <label class="gluni-card-config-field">
      <span class="gluni-card-config-field-label">${escapeHTML(label)}</span>
      <input type="number" name="${escapeAttr(name)}" min="${limits.min}" max="${limits.max}" step="1" value="${clamp(Math.round(Number(value) || limits.min), limits.min, limits.max)}">
      <small class="gluni-card-config-field-hint">${escapeHTML(hint)}</small>
    </label>
  `;
}

function readCardConfigForm(html) {
  const root = getHTMLElement(html) ?? html?.[0] ?? html;
  const read = name => {
    const input = root?.querySelector?.(`[name="${name}"]`);
    return input ? Number(input.value) : NaN;
  };
  return normalizeCardConfig({ cards: read("cards"), turns: read("turns") });
}

function openPortraitConfigDialog(actor) {
  const frame = getPortraitFrame(actor);
  const portrait = actor.img || FALLBACK_PORTRAIT;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return;

  const dialog = new DialogV2({
    window: { title: formatLocalized("GLUNI.PortraitConfig.Title", { name: actor.name }), resizable: false },
    classes: ["gluni-portrait-dialog"],
    position: { width: 560 },
    content: renderPortraitConfigDialog(actor, frame, portrait),
    buttons: [
      {
        action: "reset",
        icon: "fa-solid fa-rotate-left",
        label: localize("GLUNI.PortraitConfig.Reset"),
        callback: async () => {
          await actor.unsetFlag(MODULE_ID, FLAGS.portraitFrame);
          overlay?.broadcastRefresh();
        }
      },
      {
        action: "save",
        icon: "fa-solid fa-check",
        label: localize("GLUNI.PortraitConfig.Save"),
        default: true,
        callback: async (event, button) => {
          const nextFrame = readPortraitConfigForm(button.form);
          await actor.setFlag(MODULE_ID, FLAGS.portraitFrame, nextFrame);
          overlay?.broadcastRefresh();
        }
      }
    ]
  });
  // DialogV2 only honours a `render` option for its static confirm/prompt/wait
  // helpers — a directly-constructed instance never calls it. Attach the live
  // preview listeners once the render promise resolves and the DOM exists.
  dialog.render({ force: true }).then(() => activatePortraitConfigDialog(dialog.element));
}

function renderPortraitConfigDialog(actor, frame, portrait) {
  return `
    <div class="gluni-portrait-config-form" autocomplete="off">
      <p class="gluni-portrait-config-note">${localize("GLUNI.PortraitConfig.Hint")}</p>
      <div class="gluni-portrait-config-grid">
        ${renderPortraitConfigPanel("normal", localize("GLUNI.PortraitConfig.Normal"), frame.normal, portrait, actor.name)}
        ${renderPortraitConfigPanel("expanded", localize("GLUNI.PortraitConfig.Expanded"), frame.expanded, portrait, actor.name)}
      </div>
    </div>
  `;
}

function renderPortraitConfigPanel(mode, label, values, portrait, actorName) {
  const frameStyle = renderSinglePortraitFrameStyle(mode, values);
  const previewClasses = [
    "gluni-card",
    "gluni-card--frame-preview",
    mode === "expanded" ? "gluni-card--active gluni-card--frame-preview-expanded" : "gluni-card--frame-preview-normal",
    "gluni-card--friendly"
  ].join(" ");

  return `
    <section class="gluni-portrait-config-panel" data-frame-mode="${mode}">
      <div class="gluni-portrait-config-panel-head">
        <strong>${escapeHTML(label)}</strong>
        <span>${mode === "expanded" ? localize("GLUNI.PortraitConfig.ActiveCard") : localize("GLUNI.PortraitConfig.NormalCard")}</span>
      </div>
      <article class="${previewClasses}" data-frame-preview="${mode}" style="${escapeAttr(frameStyle)}" title="${localize("GLUNI.PortraitConfig.PreviewHint")}">
        <div class="gluni-card-surface">
        <div class="gluni-card-accent" aria-hidden="true"></div>
        <div class="gluni-card-bracket" aria-hidden="true"></div>
        <div class="gluni-card-portrait-wrap">
          <img class="gluni-card-portrait" src="${escapeAttr(portrait)}" alt="${escapeAttr(actorName)}" draggable="false">
        </div>
        <div class="gluni-card-content">
          <div class="gluni-card-kicker">${mode === "expanded" ? `<span class="gluni-active-tag">TURN</span>` : ""}</div>
          <h3>${escapeHTML(actorName)}</h3>
        </div>
        <span class="gluni-initiative-badge">18</span>
        </div>
      </article>
      ${renderPortraitControl(mode, "x", localize("GLUNI.PortraitConfig.PositionX"), values.x, PORTRAIT_FRAME_LIMITS.x.min, PORTRAIT_FRAME_LIMITS.x.max, 1)}
      ${renderPortraitControl(mode, "y", localize("GLUNI.PortraitConfig.PositionY"), values.y, PORTRAIT_FRAME_LIMITS.y.min, PORTRAIT_FRAME_LIMITS.y.max, 1)}
      ${renderPortraitControl(mode, "scale", localize("GLUNI.PortraitConfig.Scale"), values.scale, PORTRAIT_FRAME_LIMITS.scale.min, PORTRAIT_FRAME_LIMITS.scale.max, 0.01)}
    </section>
  `;
}

function renderPortraitControl(mode, property, label, value, min, max, step) {
  const name = `${mode}.${property}`;
  const displayValue = property === "scale" ? Number(value).toFixed(2) : Math.round(value);
  return `
    <label class="gluni-portrait-control">
      <span>${escapeHTML(label)}</span>
      <input type="range" name="${escapeAttr(name)}" min="${min}" max="${max}" step="${step}" value="${displayValue}" data-frame-input="${mode}" data-frame-property="${property}">
      <input type="number" name="${escapeAttr(name)}" min="${min}" max="${max}" step="${step}" value="${displayValue}" data-frame-input="${mode}" data-frame-property="${property}">
    </label>
  `;
}

function activatePortraitConfigDialog(html) {
  const element = getHTMLElement(html);
  const form = element?.querySelector(".gluni-portrait-config-form");
  if (!form) return;

  const updatePreviews = () => {
    const frame = readPortraitConfigForm(form);
    for (const mode of ["normal", "expanded"]) {
      const preview = form.querySelector(`[data-frame-preview="${mode}"]`);
      if (!preview) continue;
      preview.style.setProperty("--gluni-portrait-normal-x", `${frame[mode].x}%`);
      preview.style.setProperty("--gluni-portrait-normal-y", `${frame[mode].y}%`);
      preview.style.setProperty("--gluni-portrait-normal-scale", frame[mode].scale);
      preview.style.setProperty("--gluni-portrait-active-x", `${frame[mode].x}%`);
      preview.style.setProperty("--gluni-portrait-active-y", `${frame[mode].y}%`);
      preview.style.setProperty("--gluni-portrait-active-scale", frame[mode].scale);
    }
  };

  form.addEventListener("input", event => {
    const input = event.target.closest("[data-frame-input]");
    if (!input) return;
    syncPortraitInputs(form, input);
    updatePreviews();
  });

  for (const preview of form.querySelectorAll("[data-frame-preview]")) {
    preview.addEventListener("wheel", event => {
      event.preventDefault();
      const mode = preview.dataset.framePreview;
      const scaleInput = form.querySelector(`input[type="number"][name="${mode}.scale"]`);
      if (!scaleInput) return;
      const delta = event.deltaY > 0 ? -0.04 : 0.04;
      setPortraitInputValue(form, mode, "scale", Number(scaleInput.value) + delta);
      updatePreviews();
    }, { passive: false });

    preview.addEventListener("pointerdown", event => {
      // Primary-button drag pans the frame freely in any direction.
      if (event.button !== 0) return;
      event.preventDefault();
      const mode = preview.dataset.framePreview;
      const startRect = preview.getBoundingClientRect();
      const startX = Number(form.querySelector(`input[type="number"][name="${mode}.x"]`)?.value ?? 50);
      const startY = Number(form.querySelector(`input[type="number"][name="${mode}.y"]`)?.value ?? 50);

      preview.setPointerCapture(event.pointerId);
      preview.classList.add("gluni-portrait-preview--dragging");

      const onMove = moveEvent => {
        const deltaX = ((moveEvent.clientX - event.clientX) / startRect.width) * 100;
        const deltaY = ((moveEvent.clientY - event.clientY) / startRect.height) * 100;
        setPortraitInputValue(form, mode, "x", startX - deltaX);
        setPortraitInputValue(form, mode, "y", startY - deltaY);
        updatePreviews();
      };
      const onUp = upEvent => {
        if (preview.hasPointerCapture(upEvent.pointerId)) preview.releasePointerCapture(upEvent.pointerId);
        preview.classList.remove("gluni-portrait-preview--dragging");
        preview.removeEventListener("pointermove", onMove);
        preview.removeEventListener("pointerup", onUp);
        preview.removeEventListener("pointercancel", onUp);
      };

      preview.addEventListener("pointermove", onMove);
      preview.addEventListener("pointerup", onUp);
      preview.addEventListener("pointercancel", onUp);
    });

    preview.addEventListener("contextmenu", event => event.preventDefault());
  }

  updatePreviews();
}

function openAdhocInitiativeDialog({ combat, onCreate }) {
  const defaults = getAdhocDialogDefaults(combat);

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return;

  const dialog = new DialogV2({
    window: { title: localize("GLUNI.AdHoc.DialogTitle"), resizable: false },
    classes: ["gluni-adhoc-dialog"],
    position: { width: 420 },
    content: renderAdhocInitiativeDialog(defaults),
    buttons: [
      {
        action: "create",
        icon: "fa-solid fa-plus",
        label: localize("GLUNI.AdHoc.Create"),
        default: true,
        callback: async (event, button) => {
          const data = readAdhocInitiativeForm(button.form, combat);
          if (!data.name) {
            globalThis.ui?.notifications?.warn(localize("GLUNI.AdHoc.NameRequired"));
            return false;
          }
          await onCreate(data);
        }
      }
    ]
  });
  // See openPortraitConfigDialog: the `render` option is ignored for a
  // directly-constructed DialogV2, so wire listeners off the render promise.
  dialog.render({ force: true }).then(() => activateAdhocInitiativeDialog(dialog.element));
}

function getAdhocDialogDefaults(combat) {
  const currentInitiative = Number(combat?.combatant?.initiative);
  return {
    name: localize("GLUNI.AdHoc.DefaultName"),
    initiative: Number.isFinite(currentInitiative) ? currentInitiative : 10,
    round: Math.max(1, Number(combat?.round) || 1),
    lifecycle: ADHOC_LIFECYCLE.persistent,
    type: ADHOC_DEFAULT_TYPE,
    visibility: VISIBILITY.visible,
    icon: ADHOC_TYPES[ADHOC_DEFAULT_TYPE].icon
  };
}

function renderAdhocInitiativeDialog(defaults) {
  return `
    <div class="gluni-adhoc-form" autocomplete="off">
      <label class="gluni-adhoc-field">
        <span>${localize("GLUNI.AdHoc.Name")}</span>
        <input type="text" name="name" value="${escapeAttr(defaults.name)}" required>
      </label>
      <div class="gluni-adhoc-row">
        <label class="gluni-adhoc-field">
          <span>${localize("GLUNI.AdHoc.Initiative")}</span>
          <input type="number" name="initiative" value="${escapeAttr(defaults.initiative)}" step="0.01">
        </label>
        <label class="gluni-adhoc-field">
          <span>${localize("GLUNI.AdHoc.Round")}</span>
          <input type="number" name="round" value="${escapeAttr(defaults.round)}" min="1" step="1" data-adhoc-round>
        </label>
      </div>
      <div class="gluni-adhoc-row">
        <label class="gluni-adhoc-field">
          <span>${localize("GLUNI.AdHoc.Lifecycle")}</span>
          <select name="lifecycle" data-adhoc-lifecycle>
            <option value="${ADHOC_LIFECYCLE.persistent}" selected>${localize("GLUNI.AdHoc.Persistent")}</option>
            <option value="${ADHOC_LIFECYCLE.oneShot}">${localize("GLUNI.AdHoc.OneShot")}</option>
          </select>
        </label>
        <label class="gluni-adhoc-field">
          <span>${localize("GLUNI.AdHoc.Type")}</span>
          <select name="type">
            ${Object.entries(ADHOC_TYPES).map(([type, config]) => `
              <option value="${escapeAttr(type)}" data-icon="${escapeAttr(config.icon)}" ${type === defaults.type ? "selected" : ""}>${localize(config.label)}</option>
            `).join("")}
          </select>
        </label>
      </div>
      <label class="gluni-adhoc-field">
        <span>${localize("GLUNI.AdHoc.Icon")}</span>
        <div class="gluni-adhoc-icon-input">
          <i class="${escapeAttr(defaults.icon)}" data-adhoc-icon-preview aria-hidden="true"></i>
          <input type="text" name="icon" value="${escapeAttr(defaults.icon)}" list="gluni-adhoc-icons">
        </div>
        <datalist id="gluni-adhoc-icons">
          ${ADHOC_ICON_CHOICES.map(icon => `<option value="${escapeAttr(icon)}"></option>`).join("")}
        </datalist>
      </label>
      <label class="gluni-adhoc-field">
        <span>${localize("GLUNI.AdHoc.Visibility")}</span>
        <select name="visibility">
          <option value="${VISIBILITY.visible}" selected>${localize("GLUNI.Controls.Visible")}</option>
          <option value="${VISIBILITY.mystery}">${localize("GLUNI.Controls.Mystery")}</option>
          <option value="${VISIBILITY.hidden}">${localize("GLUNI.Controls.Hidden")}</option>
        </select>
      </label>
    </div>
  `;
}

function activateAdhocInitiativeDialog(html) {
  const root = getHTMLElement(html);
  const form = root?.querySelector(".gluni-adhoc-form") ?? root;
  if (!form) return;

  const typeSelect = form.querySelector('[name="type"]');
  const iconInput = form.querySelector('[name="icon"]');
  const iconPreview = form.querySelector("[data-adhoc-icon-preview]");
  const lifecycleSelect = form.querySelector("[data-adhoc-lifecycle]");
  const roundInput = form.querySelector("[data-adhoc-round]");
  const updatePreview = () => {
    if (!iconPreview || !iconInput) return;
    iconPreview.className = normalizeAdhocIcon(iconInput.value);
  };
  const updateLifecycle = () => {
    if (!roundInput || !lifecycleSelect) return;
    roundInput.disabled = lifecycleSelect.value !== ADHOC_LIFECYCLE.oneShot;
  };

  typeSelect?.addEventListener("change", () => {
    const selected = typeSelect.selectedOptions?.[0];
    if (selected?.dataset.icon && iconInput) iconInput.value = selected.dataset.icon;
    updatePreview();
  });
  iconInput?.addEventListener("input", updatePreview);
  lifecycleSelect?.addEventListener("change", updateLifecycle);
  updatePreview();
  updateLifecycle();
}

function readAdhocInitiativeForm(html, combat) {
  const el = getHTMLElement(html);
  const form = el instanceof HTMLFormElement ? el : (el?.closest?.("form") ?? el?.querySelector?.("form") ?? el);
  const data = new FormData(form);
  return normalizeAdhocPayload({
    name: data.get("name"),
    initiative: data.get("initiative"),
    round: data.get("round"),
    lifecycle: data.get("lifecycle"),
    type: data.get("type"),
    visibility: data.get("visibility"),
    icon: data.get("icon")
  }, combat);
}

function normalizeAdhocPayload(data, combat) {
  const fallback = getAdhocDialogDefaults(combat);
  const type = ADHOC_TYPES[data?.type] ? data.type : fallback.type;
  const initiative = Number(data?.initiative);
  const round = Math.max(1, Math.round(Number(data?.round) || fallback.round));
  const lifecycle = ADHOC_LIFECYCLE_MODES.has(data?.lifecycle) ? data.lifecycle : fallback.lifecycle;
  const visibility = ADHOC_VISIBILITY_MODES.has(data?.visibility) ? data.visibility : fallback.visibility;
  const name = String(data?.name ?? fallback.name).trim();

  return {
    name: name || fallback.name,
    initiative: Number.isFinite(initiative) ? initiative : fallback.initiative,
    round,
    lifecycle,
    type,
    visibility,
    icon: normalizeAdhocIcon(data?.icon ?? ADHOC_TYPES[type].icon)
  };
}

function normalizeAdhocIcon(value) {
  const icon = String(value ?? "").trim();
  if (ADHOC_ICON_CHOICES.includes(icon)) return icon;
  const classes = icon.split(/\s+/).filter(Boolean);
  const hasFamily = classes.some(className => /^fa-(solid|regular|brands)$/.test(className));
  const hasIcon = classes.some(className => /^fa-[a-z0-9-]+$/i.test(className) && !/^fa-(solid|regular|brands)$/i.test(className));
  if (hasFamily && hasIcon && classes.every(className => /^fa-[a-z0-9-]+$/i.test(className))) return classes.join(" ");
  return ADHOC_TYPES[ADHOC_DEFAULT_TYPE].icon;
}

function renderAdhocRepeatText(name) {
  const text = escapeHTML(name);
  const line = Array.from({ length: 5 }, () => `<span>${text}</span>`).join("");
  return Array.from({ length: 6 }, (_, index) => `
    <div class="gluni-card-adhoc-repeat-line${index % 2 ? " gluni-card-adhoc-repeat-line--alt" : ""}">
      ${line}
    </div>
  `).join("");
}

function renderDelayedRepeatText(name) {
  const text = `${localize("GLUNI.Delayed").toUpperCase()} / ${escapeHTML(name)}`;
  const line = Array.from({ length: 4 }, () => `<span>${text}</span>`).join("");
  return Array.from({ length: 4 }, (_, index) => `
    <div class="gluni-card-delayed-repeat-line${index % 2 ? " gluni-card-delayed-repeat-line--alt" : ""}">
      ${line}
    </div>
  `).join("");
}

function getAdhocData(combatant) {
  const value = combatant?.getFlag?.(MODULE_ID, FLAGS.adhoc);
  if (!value || typeof value !== "object") return null;

  const type = ADHOC_TYPES[value.type] ? value.type : ADHOC_DEFAULT_TYPE;
  const config = ADHOC_TYPES[type];
  const name = String(value.name || combatant.name || localize("GLUNI.AdHoc.DefaultName")).trim();
  const lifecycle = ADHOC_LIFECYCLE_MODES.has(value.lifecycle) ? value.lifecycle : ADHOC_LIFECYCLE.persistent;
  const round = Math.max(1, Math.round(Number(value.round) || 1));

  return {
    type,
    name,
    label: localize(config.label),
    icon: normalizeAdhocIcon(value.icon ?? config.icon),
    disposition: config.disposition,
    lifecycle,
    round,
    oneShot: lifecycle === ADHOC_LIFECYCLE.oneShot
  };
}

function isAdhocCombatant(combatant) {
  return Boolean(getAdhocData(combatant));
}

function shouldShowAdhocOnRound(combatant, round) {
  const adhoc = getAdhocData(combatant);
  return !adhoc?.oneShot || adhoc.round === round;
}

function isDueOneShotAdhoc(combatant, round) {
  const adhoc = getAdhocData(combatant);
  return Boolean(adhoc?.oneShot && adhoc.round === round);
}

function getAdhocActorType() {
  const actorConfig = globalThis.CONFIG?.Actor ?? {};
  const types = new Set([
    ...Object.keys(actorConfig.typeLabels ?? {}),
    ...Object.keys(actorConfig.dataModels ?? {}),
    ...Object.keys(game.system?.model?.Actor ?? {})
  ]);
  for (const type of ["npc", "character", "pc", "creature"]) {
    if (types.has(type)) return type;
  }
  return types.values().next().value ?? "npc";
}

async function confirmAdhocDelete(combatant) {
  const name = getAdhocData(combatant)?.name ?? combatant?.name ?? localize("GLUNI.AdHoc.DefaultName");
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (typeof DialogV2?.confirm === "function") {
    return DialogV2.confirm({
      window: { title: localize("GLUNI.AdHoc.Delete") },
      content: `<p>${formatLocalized("GLUNI.AdHoc.DeleteConfirm", { name: escapeHTML(name) })}</p>`,
      modal: true,
      rejectClose: false
    });
  }

  return window.confirm(formatLocalized("GLUNI.AdHoc.DeleteConfirm", { name }));
}

function syncPortraitInputs(form, input) {
  const name = input.getAttribute("name");
  if (!name) return;
  const mode = input.dataset.frameInput;
  const property = input.dataset.frameProperty;
  const value = normalizePortraitValue(property, input.value);

  for (const related of form.querySelectorAll(`[name="${name}"]`)) {
    related.value = property === "scale" ? value.toFixed(2) : String(Math.round(value));
  }

  setPortraitInputValue(form, mode, property, value);
}

function setPortraitInputValue(form, mode, property, rawValue) {
  const value = normalizePortraitValue(property, rawValue);
  const displayValue = property === "scale" ? value.toFixed(2) : String(Math.round(value));
  for (const input of form.querySelectorAll(`[name="${mode}.${property}"]`)) {
    input.value = displayValue;
  }
}

function readPortraitConfigForm(html) {
  const form = getHTMLElement(html)?.querySelector?.(".gluni-portrait-config-form") ?? getHTMLElement(html);
  const frame = clonePortraitFrameDefaults();

  for (const mode of ["normal", "expanded"]) {
    for (const property of ["x", "y", "scale"]) {
      const input = form?.querySelector?.(`input[type="number"][name="${mode}.${property}"]`);
      frame[mode][property] = normalizePortraitValue(property, input?.value ?? PORTRAIT_FRAME_DEFAULTS[mode][property]);
    }
  }

  return frame;
}

function getPortraitFrame(actor) {
  return normalizePortraitFrame(actor?.getFlag?.(MODULE_ID, FLAGS.portraitFrame));
}

function normalizePortraitFrame(value) {
  const frame = clonePortraitFrameDefaults();
  if (!value || typeof value !== "object") return frame;

  for (const mode of ["normal", "expanded"]) {
    const source = value[mode];
    if (!source || typeof source !== "object") continue;
    for (const property of ["x", "y", "scale"]) {
      frame[mode][property] = normalizePortraitValue(property, source[property] ?? frame[mode][property]);
    }
  }

  return frame;
}

function normalizePortraitValue(property, value) {
  const number = Number(value);
  const fallback = property === "scale" ? 1 : 50;
  const safeValue = Number.isFinite(number) ? number : fallback;
  const limits = PORTRAIT_FRAME_LIMITS[property];
  return clamp(safeValue, limits.min, limits.max);
}

function renderPortraitFrameStyle(frame) {
  const value = normalizePortraitFrame(frame);
  return [
    `--gluni-portrait-normal-x: ${value.normal.x}%;`,
    `--gluni-portrait-normal-y: ${value.normal.y}%;`,
    `--gluni-portrait-normal-scale: ${value.normal.scale};`,
    `--gluni-portrait-active-x: ${value.expanded.x}%;`,
    `--gluni-portrait-active-y: ${value.expanded.y}%;`,
    `--gluni-portrait-active-scale: ${value.expanded.scale};`
  ].join(" ");
}

function renderSinglePortraitFrameStyle(mode, values) {
  const frame = normalizePortraitFrame({ [mode]: values });
  const value = frame[mode];
  return [
    `--gluni-portrait-normal-x: ${value.x}%;`,
    `--gluni-portrait-normal-y: ${value.y}%;`,
    `--gluni-portrait-normal-scale: ${value.scale};`,
    `--gluni-portrait-active-x: ${value.x}%;`,
    `--gluni-portrait-active-y: ${value.y}%;`,
    `--gluni-portrait-active-scale: ${value.scale};`
  ].join(" ");
}

function clonePortraitFrameDefaults() {
  return {
    normal: { ...PORTRAIT_FRAME_DEFAULTS.normal },
    expanded: { ...PORTRAIT_FRAME_DEFAULTS.expanded }
  };
}

// ---------------------------------------------------------------------------
// Card portrait FX — a high-fidelity WebGL effect layer for the initiative
// cards. One shared PIXI renderer draws each affected card's procedural effect
// (break / dying only, to keep the GPU cost low) and blits it into a per-card
// 2D <canvas> that sits between the portrait and the card content. DOM still
// owns layout, text, glows and controls; this only touches the imagery layer.
// Everything is feature-detected and fails back to the CSS effects. The same
// FX_FRAG_* shaders also drive the token break/delay overlays.
// ---------------------------------------------------------------------------

// Supersample factor for the procedural card FX. Shader-generated crack edges
// can't be smoothed by MSAA, so we render larger and let the blit downsample.
class CardFXManager {
  constructor() {
    this.supported = false;
    this._initTried = false;
    this.renderer = null;
    this.sprite = null;
    this.filters = {};
    this.entries = new Map();   // combatantId -> { canvas, ctx, mode, seed, impact, t0 }
    this.ticking = false;
    this.tickFn = this._tick.bind(this);
    // These effects are slow (a break glow / a dying creep); 30fps is visually
    // identical to 60 and halves the per-frame PIXI render + canvas blit cost.
    this._frameMs = 1000 / 30;
    this._lastDraw = 0;
  }

  ensureRenderer() {
    if (this._initTried) return this.supported;
    this._initTried = true;
    try {
      if (!globalThis.PIXI?.Renderer || !globalThis.PIXI?.Filter || !globalThis.PIXI?.Sprite) return false;
      this.renderer = new PIXI.Renderer({ width: 256, height: 160, backgroundAlpha: 0, antialias: true });
      this.sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
      const S = ACTIVE_SHADER_PALETTE;
      const mk = (frag, extra) => {
        const uniforms = { uTime: 0, uSeed: 0, uAspect: 1, uClipCircle: 0, uThick: 0.09, uTexel: 0, uImpact: [0.65, 0.34], ...extra };
        const f = new PIXI.Filter(undefined, frag, uniforms);
        f.padding = 0;
        return f;
      };
      this.filters = {
        break:    mk(FX_FRAG_BREAK,    { uBreakAmber: [...S.breakAmber], uBreakHot: [...S.breakHot] }),
        dying:    mk(FX_FRAG_DYING,    { uVeinBase:   [...S.veinBase],   uVeinHot:  [...S.veinHot]  }),
        scramble: mk(FX_FRAG_SCRAMBLE, { uMysteryA:   [...S.mysteryA],   uMysteryB: [...S.mysteryB] }),
        apex:     mk(FX_FRAG_APEX,     { uPhase: 1, uApexBase: [...S.apexBase], uApexHot: [...S.apexHot] })
      };
      // Force each filter's GLSL program to compile now. Otherwise the program
      // compiles lazily on the first frame a card is broken/dying/mystery, stalling
      // the main thread exactly when the break/dying transition should be smooth.
      try {
        this.sprite.width = 4;
        this.sprite.height = 4;
        for (const f of Object.values(this.filters)) {
          this.sprite.filters = [f];
          this.renderer.render(this.sprite);
        }
        this.sprite.filters = null;
      } catch { /* compiles on demand if the warm-up render fails */ }
      this.supported = true;
    } catch (err) {
      console.warn(`${MODULE_ID} | Card portrait FX unavailable, falling back to CSS`, err);
      this.supported = false;
      this.renderer = null;
    }
    return this.supported;
  }

  // Reconcile the live FX canvases in the DOM after each overlay render.
  sync(root) {
    if (!this.supported || !root) { this.clear(); return; }
    const seen = new Set();
    root.querySelectorAll(".gluni-card-portrait-fx").forEach(cv => {
      const card = cv.closest(".gluni-card");
      // Key by the per-card rail key, not the combatant id: the same combatant
      // can appear on more than one card (e.g. the active turn plus a next-round
      // preview), and each instance needs its own effect entry.
      const key = card?.dataset.gluniKey || card?.dataset.combatantId;
      const mode = cv.dataset.fx;
      if (!key || !this.filters[mode]) return;
      seen.add(key);
      const prev = this.entries.get(key);
      if (prev && prev.canvas === cv && prev.mode === mode) return;
      // New or replaced canvas (the rail rebuilds innerHTML each render): keep
      // the seed/impact stable so the effect doesn't re-randomize, and only
      // reset the clock when the effect type actually changed.
      this.entries.set(key, {
        canvas: cv,
        ctx: cv.getContext("2d"),
        mode,
        seed: prev?.seed ?? Math.random() * 100,
        impact: prev?.impact ?? [0.42 + Math.random() * 0.36, 0.18 + Math.random() * 0.42],
        // Apex HP phase (1..3) read fresh from the rebuilt canvas each render, so
        // escalation tracks HP without resetting the ember clock.
        phase: mode === "apex" ? (Number(cv.dataset.fxPhase) || 1) : 1,
        t0: prev && prev.mode === mode ? prev.t0 : performance.now()
      });
    });
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.entries.delete(id);
    if (this.entries.size && !this.ticking) this._start();
    else if (!this.entries.size) this._stop();
  }

  clear() {
    this.entries.clear();
    this._stop();
  }

  _start() {
    if (this.ticking) return;
    this.ticking = true;
    requestAnimationFrame(this.tickFn);
  }

  _stop() {
    this.ticking = false;
  }

  _tick() {
    if (!this.ticking) return;
    const now = performance.now();
    // Throttle the actual GPU work to ~30fps while still riding rAF (which the
    // browser pauses for us when the tab is hidden).
    if (now - this._lastDraw < this._frameMs) {
      requestAnimationFrame(this.tickFn);
      return;
    }
    this._lastDraw = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const entry of this.entries.values()) {
      const cv = entry.canvas;
      if (!cv.isConnected || !entry.ctx) continue;
      const cw = cv.clientWidth, ch = cv.clientHeight;
      if (!cw || !ch) continue;
      const pw = Math.max(1, Math.round(cw * dpr));
      const ph = Math.max(1, Math.round(ch * dpr));
      if (cv.width !== pw || cv.height !== ph) {
        // Resizing the backing store resets the 2D context to its defaults
        // (smoothing quality "low"), so reapply the high-quality downscale
        // filter every time we resize — including the first frame.
        cv.width = pw; cv.height = ph;
        entry.ctx.imageSmoothingEnabled = true;
        entry.ctx.imageSmoothingQuality = "high";
      }
      // Render the procedural FX at a supersample factor and downsample on blit.
      // MSAA can't smooth shader-generated edges (the cracks), so this is what
      // actually de-aliases them; the cards are small so the extra fragments are
      // cheap. rw/rh are the true render resolution we sample the field at.
      const rw = Math.max(1, Math.round(pw * FX_SUPERSAMPLE));
      const rh = Math.max(1, Math.round(ph * FX_SUPERSAMPLE));
      try {
        // Grow the shared renderer to the largest entry only; never shrink it.
        // Differently-sized entries then render into the top-left corner and we
        // blit just that region, so we avoid a resize() (render-target realloc)
        // on every entry every frame.
        if (this.renderer.width < rw || this.renderer.height < rh) {
          this.renderer.resize(Math.max(this.renderer.width, rw), Math.max(this.renderer.height, rh));
        }
        const filter = this.filters[entry.mode];
        filter.uniforms.uTime = (now - entry.t0) / 1000;
        filter.uniforms.uSeed = entry.seed;
        filter.uniforms.uAspect = rw / rh;
        filter.uniforms.uTexel = 1 / rh;
        if (entry.mode === "break") filter.uniforms.uImpact = entry.impact;
        if (entry.mode === "apex") filter.uniforms.uPhase = entry.phase;
        this.sprite.width = rw;
        this.sprite.height = rh;
        this.sprite.filters = [filter];
        this.renderer.render(this.sprite);
        entry.ctx.clearRect(0, 0, pw, ph);
        entry.ctx.drawImage(this.renderer.view, 0, 0, rw, rh, 0, 0, pw, ph);
      } catch { /* leave the canvas transparent; the portrait shows through */ }
    }
    if (this.ticking) requestAnimationFrame(this.tickFn);
  }

  // Updates the live filter colour uniforms from the active shader palette so
  // existing break/dying/scramble cards repaint in the new theme on the next tick.
  notifyThemeChange() {
    if (!this.supported) return;
    const S = ACTIVE_SHADER_PALETTE;
    const set = (filter, key, value) => { if (filter?.uniforms) filter.uniforms[key] = [...value]; };
    set(this.filters.break,    "uBreakAmber", S.breakAmber);
    set(this.filters.break,    "uBreakHot",   S.breakHot);
    set(this.filters.dying,    "uVeinBase",   S.veinBase);
    set(this.filters.dying,    "uVeinHot",    S.veinHot);
    set(this.filters.scramble, "uMysteryA",   S.mysteryA);
    set(this.filters.scramble, "uMysteryB",   S.mysteryB);
    set(this.filters.apex,     "uApexBase",   S.apexBase);
    set(this.filters.apex,     "uApexHot",    S.apexHot);
  }

  destroy() {
    this.clear();
    try { this.renderer?.destroy(); } catch {}
    this.renderer = null;
    this.supported = false;
  }
}


function getHTMLElement(value) {
  if (!value) return null;
  if (value instanceof HTMLElement) return value;
  if (value[0] instanceof HTMLElement) return value[0];
  if (value.element instanceof HTMLElement) return value.element;
  if (value.element?.[0] instanceof HTMLElement) return value.element[0];
  return null;
}

export function getCombatantTokenObject(combatant) {
  if (!combatant) return null;
  if (combatant.token?.object) return combatant.token.object;

  const tokenId = combatant.token?.id ?? combatant.tokenId;
  const sceneId = combatant.scene?.id ?? combatant.token?.parent?.id;
  const tokens = globalThis.canvas?.tokens?.placeables ?? [];

  return tokens.find(token => {
    const document = token.document;
    if (sceneId && document?.parent?.id !== sceneId) return false;
    if (tokenId && document?.id === tokenId) return true;
    return !tokenId && combatant.actor?.id && token.actor?.id === combatant.actor.id;
  }) ?? null;
}

// While our cinematic turn ring is active we hide Foundry v13's built-in turn
// marker so the two don't stack under the active token. We only suppress it when
// OUR ring is actually drawing (module enabled + turn marker on + combat running),
// so turning our ring off restores the native one. This hides the rendered object
// rather than mutating the world setting, so it's fully reversible.
function shouldSuppressNativeTurnMarker() {
  try {
    return Boolean(
      overlay?.enabled &&
      game.combat?.started &&
      game.settings.get(MODULE_ID, SETTINGS.turnMarkerEnabled)
    );
  } catch { return false; }
}

function getNativeTurnMarkers(token) {
  const markers = [];
  if (token?.turnMarker) markers.push(token.turnMarker);
  for (const child of token?.children ?? []) {
    if (child && child !== token.turnMarker && /TurnMarker/.test(child.constructor?.name ?? "")) {
      markers.push(child);
    }
  }
  return markers;
}

function hideNativeTurnMarker(token) {
  if (!token || !shouldSuppressNativeTurnMarker()) return;
  for (const marker of getNativeTurnMarkers(token)) {
    try { marker.visible = false; marker.renderable = false; } catch {}
  }
}

// Re-evaluate every token: hide native markers while suppressing, or ask Foundry
// to redraw them (so the native marker returns) once we stop.
function refreshNativeTurnMarkerSuppression() {
  const tokens = globalThis.canvas?.tokens?.placeables ?? [];
  const suppress = shouldSuppressNativeTurnMarker();
  for (const token of tokens) {
    if (suppress) hideNativeTurnMarker(token);
    else { try { token.renderFlags?.set?.({ refreshTurnMarker: true }); } catch {} }
  }
}

