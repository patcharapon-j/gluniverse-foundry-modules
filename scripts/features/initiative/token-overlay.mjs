import { MODULE_ID, SOCKET_NAME, SETTINGS, TOKEN_OVERLAY_PALETTE, DISPOSITION_PALETTE,
ACTIVE_SHADER_PALETTE, getDispositionColors, FLAGS, INITIATIVE_MODE, CARD_CONFIG_DEFAULTS, CARD_CONFIG_LIMITS,
BREAK_GAUGE_DEFAULT_MAX, BREAK_GAUGE_MODES, BREAK_GAUGE_FLASH_SEC, BREAK_GAUGE_SHEEN_SEC,
VISIBILITY, PF2E_GUARD_BREAK_EFFECT_SLUG, PF2E_GUARD_BREAK_PENALTY, LOCALIZATION_FALLBACKS,
ADHOC_DEFAULT_TYPE, ADHOC_TYPES, ADHOC_VISIBILITY_MODES, ADHOC_LIFECYCLE,
ADHOC_LIFECYCLE_MODES, STATUS_ANIMATION, ADHOC_ICON_CHOICES, COMBATANT_RENDER_UPDATE_KEYS,
ACTOR_RENDER_UPDATE_KEYS, FALLBACK_PORTRAIT, PORTRAIT_MIN_PIXELS, CONFIGURABLE_ACTOR_TYPES,
PORTRAIT_FRAME_DEFAULTS, PORTRAIT_FRAME_LIMITS } from "./constants.mjs";
import { normalizeInitiativeNumber, getDisposition, formatRound, formatInitiative, 
localize, formatLocalized, modulo, clamp, wait, escapeHTML, escapeAttr, escapeCSSIdentifier 
} from "./util.mjs";
import { FX_SUPERSAMPLE, FX_GLSL_NOISE, FX_FRAG_BREAK, FX_FRAG_DYING, FX_FRAG_DELAY, 
FX_FRAG_TURN, FX_FRAG_TURN_BAKE, FX_FRAG_TURN_PLAY, FX_FRAG_DOWNSAMPLE, rgbFloat, 
FX_VERT_MESH, makeFxMesh, setFxMeshQuad, destroyFxMesh } from "./gl.mjs";
import { overlay, getCombatantTokenObject } from "./gluniverse-initiative.mjs";
import { getGuardBreakState, getDyingState, getBreakGaugeState } from "./conditions.mjs";

// Ground turn-markers + above-token status overlays drawn with PIXI/WebGL.

const MARKER_BAKE_SS = 2;

// Baked turn-marker sheet: how many loop frames, at what resolution. The disc can
// be drawn well above token size at high zoom, so it needs a generous baked
// resolution (plus supersampling) or the crisp rims/ticks look blurry and
// aliased; 512² (power-of-two), rendered at 2x and averaged down, stays sharp
// deep into zoom. ~24 frames cross-faded is smooth for the slow orbit. Three
// sheets (active-high, active-balanced, next) bake once → ~24 * 512² * 4 * 3
// ≈ 75MB of GPU textures.
const MARKER_BAKE_SIZE = 512;
const MARKER_BAKE_FRAMES = 24;
// Seconds for one full loop (one comet orbit). ~TAU / 1.1 matches the old spin
// rate; cinematic plays it faster (see the speed multiplier in _syncMarker).
const MARKER_LOOP_SEC = 5.7;

// Lazily bake (and cache) the three shared turn-marker sheets. Returns null when
// the renderer / PIXI render-to-texture isn't available, so callers fall back to
// the live shader. Re-bakes if a canvas teardown invalidated the textures.
let markerSheets = null;
export function getMarkerSheets() {
  if (markerSheets && !markerSheets.next.frames[0]?.baseTexture?.destroyed) return markerSheets;
  const renderer = canvas?.app?.renderer;
  if (!renderer || !globalThis.PIXI?.RenderTexture || !globalThis.PIXI?.Mesh || !globalThis.PIXI?.Geometry) {
    return null;
  }
  try {
    if (markerSheets) destroyMarkerSheets(markerSheets);
    // Single fidelity tier: only the high active + next sheets are ever used, so
    // we no longer bake the (formerly "balanced") third sheet — saves a third of
    // the startup bake time and ~24MB of GPU texture memory.
    markerSheets = {
      activeHigh: bakeMarkerSheet(renderer, 1, 1),
      next: bakeMarkerSheet(renderer, 0, 1)
    };
    return markerSheets;
  } catch (err) {
    console.warn(`${MODULE_ID} | Turn-marker sheet bake failed, using live shader`, err);
    markerSheets = null;
    return null;
  }
}

// Render the periodic bake shader into one RenderTexture per loop frame. Blending
// is disabled so the mask/alpha fragment is stored verbatim (not premultiplied).
function bakeMarkerSheet(renderer, active, high) {
  const S = MARKER_BAKE_SIZE, N = MARKER_BAKE_FRAMES, SS = MARKER_BAKE_SS, TAU = Math.PI * 2;
  const hiRes = S * SS;
  // Scratch hi-res target the procedural disc is rendered into, then box-averaged
  // down into each stored frame. One temp, reused across every frame.
  const temp = PIXI.RenderTexture.create({ width: hiRes, height: hiRes });
  temp.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;

  const src = makeFxMesh(FX_FRAG_TURN_BAKE, { uPhase: 0, uActive: active, uHigh: high });
  src.blendMode = PIXI.BLEND_MODES.NONE;
  setFxMeshQuad(src, hiRes, hiRes, false);

  const down = makeFxMesh(FX_FRAG_DOWNSAMPLE, { uSampler: temp });
  down.blendMode = PIXI.BLEND_MODES.NONE;
  setFxMeshQuad(down, S, S, false);

  const frames = [];
  for (let i = 0; i < N; i++) {
    src.shader.uniforms.uPhase = (i / N) * TAU;
    renderer.render(src, { renderTexture: temp, clear: true });
    const rt = PIXI.RenderTexture.create({ width: S, height: S });
    renderer.render(down, { renderTexture: rt, clear: true });
    frames.push(rt);
  }

  destroyFxMesh(src);
  destroyFxMesh(down);
  try { temp.destroy(true); } catch {}
  return { frames };
}

function destroyMarkerSheets(sheets) {
  for (const sheet of Object.values(sheets)) {
    for (const rt of sheet.frames) { try { rt.destroy(true); } catch {} }
  }
}

// Force the GLSL compile + link of the three above-token status FX programs
// (break / dying / delay) up front by rendering each mesh once into a throwaway
// RenderTexture. PIXI caches the compiled program by shader source, so the first
// real break/dying/delay overlay then reuses it instead of stalling the main
// thread on a synchronous shader compile mid-encounter — which is what made the
// first state change of each kind hitch. One-time, idempotent.
let statusShadersWarmed = false;
export function prewarmStatusShaders() {
  if (statusShadersWarmed) return;
  const renderer = canvas?.app?.renderer;
  if (!renderer || !globalThis.PIXI?.RenderTexture || !globalThis.PIXI?.Mesh || !globalThis.PIXI?.Geometry) return;
  const S = ACTIVE_SHADER_PALETTE;
  const variants = [
    [FX_FRAG_BREAK, { uBreakAmber: [...S.breakAmber], uBreakHot: [...S.breakHot] }],
    [FX_FRAG_DYING, { uVeinBase: [...S.veinBase], uVeinHot: [...S.veinHot] }],
    [FX_FRAG_DELAY, { uDelayBase: [...S.delayBase], uDelayHot: [...S.delayHot] }]
  ];
  let rt = null;
  try {
    rt = PIXI.RenderTexture.create({ width: 4, height: 4 });
    for (const [frag, themeUniforms] of variants) {
      const mesh = makeFxMesh(frag, { uTime: 0, uSeed: 0, uAspect: 1, uClipCircle: 0, uThick: 0.08, uTexel: 0, uImpact: [0.5, 0.5], ...themeUniforms });
      setFxMeshQuad(mesh, 4, 4, false);
      renderer.render(mesh, { renderTexture: rt, clear: true });
      destroyFxMesh(mesh);
    }
    statusShadersWarmed = true;
  } catch (err) {
    console.warn(`${MODULE_ID} | Status FX shader prewarm failed, compiling on demand`, err);
  } finally {
    try { rt?.destroy(true); } catch {}
  }
}


export class TokenOverlayManager {
  constructor() {
    this._entries = new Map();
    this._ticking = false;
    this._tickFn = this._onTick.bind(this);
    this._time = 0;
    // Ground turn-markers (active ring / next ring / start echo + connector) live
    // in their own layer beneath the token art, separate from the above-token
    // status overlays in `_entries`.
    this._markers = new Map();     // tokenId -> ground marker entry
    this._groundLayer = null;
    this._markerConnector = true;
  }

  refresh() {
    if (!canvas?.ready || !globalThis.PIXI) {
      this._clearAll();
      return;
    }

    const combat = game.combat;
    if (!combat?.started || !overlay?.enabled) {
      this._clearAll();
      return;
    }

    const wanted = new Map();
    for (const combatant of combat.combatants ?? []) {
      const delayed = overlay.isDelayed(combatant);
      const broken = Boolean(getGuardBreakState(combatant));
      const dying = this._dyingFor(combatant);
      const gauge = this._gaugeFor(combatant);
      if (!delayed && !broken && !dying && !gauge) continue;

      const token = getCombatantTokenObject(combatant);
      if (!token || !token.w || !token.h) continue;

      wanted.set(token.id, { token, delayed, broken, dying, gauge });
    }

    for (const tokenId of [...this._entries.keys()]) {
      if (!wanted.has(tokenId)) this._removeEntry(tokenId);
    }

    for (const [tokenId, state] of wanted) {
      // Dying outranks the other states — proximity to death is the most urgent
      // thing to surface on the token.
      const mode = state.dying ? "dying" : state.broken ? "broken" : state.delayed ? "delayed" : "gauge";
      this._upsert(state.token, mode, state.gauge, state.dying);
    }

    this._refreshMarkers(combat);

    const active = this._entries.size > 0 || this._markers.size > 0;
    if (active && !this._ticking) this._startTick();
    else if (!active) this._stopTick();
  }

  // Break gauge for a combatant, respecting player visibility so a hidden or
  // mystery actor never leaks its gauge to non-GM clients.
  _gaugeFor(combatant) {
    const gauge = getBreakGaugeState(combatant);
    if (!gauge) return null;
    if (!game.user.isGM) {
      const mode = overlay?.resolveVisibility?.(combatant)?.playerMode;
      if (mode === VISIBILITY.hidden || mode === VISIBILITY.mystery) return null;
    }
    return gauge;
  }

  // Dying / death-save state for a combatant, gated by player visibility so a
  // hidden or mystery actor never leaks its state to non-GM clients.
  _dyingFor(combatant) {
    const dying = getDyingState(combatant);
    if (!dying) return null;
    if (!game.user.isGM) {
      const mode = overlay?.resolveVisibility?.(combatant)?.playerMode;
      if (mode === VISIBILITY.hidden || mode === VISIBILITY.mystery) return null;
    }
    return dying;
  }

  forceRedraw() {
    for (const entry of this._entries.values()) {
      entry.mode = null;
      entry.shape = null;
      entry.fidelity = null;
    }
    for (const marker of this._markers.values()) marker.key = null;
    this.refresh();
  }

  // Refresh colour-dependent state after the active theme has changed. Mutated
  // palette objects (TOKEN_OVERLAY_PALETTE / DISPOSITION_PALETTE) already serve
  // new values to redraws and per-frame marker tints; this pushes the new shader
  // uniforms into live fx meshes whose mode hasn't changed (so forceRedraw
  // wouldn't otherwise recreate them), then triggers a full redraw.
  notifyThemeChange() {
    const S = ACTIVE_SHADER_PALETTE;
    for (const entry of this._entries.values()) {
      const u = entry.fxShader?.uniforms;
      if (!u) continue;
      if (entry.fxFilterMode === "broken") { u.uBreakAmber = [...S.breakAmber]; u.uBreakHot = [...S.breakHot]; }
      else if (entry.fxFilterMode === "dying") { u.uVeinBase = [...S.veinBase]; u.uVeinHot = [...S.veinHot]; }
      else if (entry.fxFilterMode === "delayed") { u.uDelayBase = [...S.delayBase]; u.uDelayHot = [...S.delayHot]; }
    }
    this.forceRedraw();
  }

  // ---- ground turn-markers ----------------------------------------------

  _markerSettings() {
    const get = key => { try { return Boolean(game.settings.get(MODULE_ID, key)); } catch { return false; } };
    return {
      turn: get(SETTINGS.turnMarkerEnabled),
      start: get(SETTINGS.startMarkerEnabled),
      connector: get(SETTINGS.startConnectorEnabled)
    };
  }

  // The shared layer that hosts every ground marker. It lives in the primary
  // canvas group (where the token *art* lives — token children would sit above
  // the art) and is biased just below the token sort layer so rings read as
  // painted on the floor. Recreated on demand after a canvas teardown.
  _ensureGroundLayer() {
    const primary = canvas?.primary;
    if (!primary) return null;
    if (this._groundLayer && !this._groundLayer.destroyed && this._groundLayer.parent === primary) {
      return this._groundLayer;
    }
    try { if (this._groundLayer && !this._groundLayer.destroyed) this._groundLayer.destroy({ children: true }); } catch {}

    const layer = new PIXI.Container();
    layer.eventMode = "none";
    layer.interactiveChildren = false;
    layer.sortableChildren = false;
    const PrimaryCanvasGroup = foundry.canvas?.groups?.PrimaryCanvasGroup ?? globalThis.PrimaryCanvasGroup;
    const tokenSort = PrimaryCanvasGroup?.SORT_LAYERS?.TOKENS ?? 700;
    layer.elevation = 0;
    layer.sortLayer = tokenSort - 1;   // beneath tokens, above tiles/drawings
    layer.sort = 0;
    layer.zIndex = tokenSort - 1;
    primary.addChild(layer);
    primary.sortDirty = true;
    this._groundLayer = layer;
    return layer;
  }

  _refreshMarkers(combat) {
    const settings = this._markerSettings();
    this._markerConnector = settings.connector;
    if (!settings.turn && !settings.start) { this._clearMarkers(); return; }

    const layer = this._ensureGroundLayer();
    if (!layer) { this._clearMarkers(); return; }

    const targets = overlay?.getTurnMarkerTargets?.(combat) ?? { active: null, next: null };
    const origin = settings.start ? this._resolveStartOrigin(combat, targets.active) : null;

    const wanted = new Map();   // tokenId -> { token, role, disposition, mystery, origin, showRing, showStart }
    // The active token hosts both the ring and the start echo, so it is wanted if
    // EITHER toggle is on; each piece is drawn independently.
    if ((settings.turn || settings.start) && targets.active) {
      const combatant = combat.combatants?.get?.(targets.active.combatantId);
      const token = combatant ? getCombatantTokenObject(combatant) : null;
      if (token && token.w && token.h && this._tokenVisible(token)) {
        wanted.set(token.id, {
          token, role: "active", ...targets.active,
          origin, showRing: settings.turn, showStart: settings.start
        });
      }
    }
    if (settings.turn && targets.next) {
      const combatant = combat.combatants?.get?.(targets.next.combatantId);
      const token = combatant ? getCombatantTokenObject(combatant) : null;
      // Never let the next ring land on the active token (e.g. odd wrap states).
      if (token && token.w && token.h && this._tokenVisible(token) && !wanted.has(token.id)) {
        wanted.set(token.id, {
          token, role: "next", ...targets.next,
          origin: null, showRing: true, showStart: false
        });
      }
    }

    for (const tokenId of [...this._markers.keys()]) {
      if (!wanted.has(tokenId)) this._removeMarker(tokenId);
    }
    for (const [tokenId, state] of wanted) this._upsertMarker(state);
  }

  // True only when the token is genuinely visible to this client right now
  // (vision / fog / hidden). The ground layer is detached from the token, so —
  // unlike the above-token child overlays — it will not auto-hide; we must mirror
  // token.visible explicitly or a ring would leak a position through fog.
  _tokenVisible(token) {
    if (!token || token.destroyed) return false;
    if (token.visible === false) return false;
    if (token.document?.hidden && !game.user.isGM) return false;
    return true;
  }

  // The stored turn-start origin, validated against the *current* active turn so a
  // stale flag from a previous turn never paints under the wrong creature.
  _resolveStartOrigin(combat, activeTarget) {
    if (!activeTarget) return null;
    const flag = combat.getFlag(MODULE_ID, FLAGS.turnStart);
    if (!flag || flag.combatantId !== activeTarget.combatantId) return null;
    if (flag.round !== (Number(combat.round) || 1)) return null;
    if (!Number.isFinite(flag.cx) || !Number.isFinite(flag.cy)) return null;
    return { cx: flag.cx, cy: flag.cy };
  }

  _upsertMarker(state) {
    const { token, role, disposition, origin, showRing, showStart } = state;
    let marker = this._markers.get(token.id);
    if (marker && marker.root.destroyed) { this._markers.delete(token.id); marker = null; }
    if (!marker) {
      marker = this._createMarker();
      this._markers.set(token.id, marker);
    }

    const layer = this._ensureGroundLayer();
    if (layer && marker.root.parent !== layer) {
      try { layer.addChild(marker.root); } catch { return; }
    }

    marker.token = token;
    marker.origin = origin ?? null;
    marker.showStart = Boolean(showStart);
    const shape = this._getShape();
    const fidelity = this._getFidelity();
    // `hasOrigin` is in the key so the echo geometry rebuilds when an origin first
    // becomes available (or clears) for an otherwise-unchanged active marker.
    const key = `${role}/${disposition}/${shape}/${fidelity}/${Math.round(token.w)}x${Math.round(token.h)}/r${showRing ? 1 : 0}/s${showStart ? 1 : 0}/o${origin ? 1 : 0}/m1`;
    if (marker.key !== key) {
      marker.key = key;
      marker.role = role;
      marker.disposition = disposition;
      marker.shape = shape;
      marker.fidelity = fidelity;
      marker.showRing = Boolean(showRing);
      marker.w = token.w;
      marker.h = token.h;
      this._drawMarker(marker);
    }
    // Position is synced every tick; do an immediate sync so a freshly-built
    // marker doesn't flash at the origin for a frame.
    this._syncMarker(marker, 0);
  }

  _createMarker() {
    const root = new PIXI.Container();
    root.eventMode = "none";
    root.interactiveChildren = false;

    const connector = new PIXI.Graphics();   // scene-space line origin -> token
    root.addChild(connector);

    const echoWrap = new PIXI.Container();    // anchored at the start origin
    const echo = new PIXI.Graphics();
    echoWrap.addChild(echo);
    root.addChild(echoWrap);

    const ringWrap = new PIXI.Container();    // anchored at the token centre

    // Shader energy disc (the star of the show). Rendered as a world-space Mesh
    // (built lazily in _setupMarkerFx) so it stays locked to the token under zoom;
    // the holder keeps its z-slot. Falls back to the hand-drawn ring below when
    // meshes/shaders are unavailable.
    const fxHolder = new PIXI.Container();
    ringWrap.addChild(fxHolder);

    // Hand-drawn fallback ring (used only when shaders are unavailable).
    const glow = new PIXI.Graphics();
    const frame = new PIXI.Graphics();
    ringWrap.addChild(glow, frame);

    const chipBg = new PIXI.Graphics();
    const chip = new PIXI.Text("", {
      fontFamily: '"Bahnschrift", "Segoe UI", Arial, sans-serif',
      fontSize: 10,
      fontWeight: "bold",
      fill: "#02070b",
      letterSpacing: 1.4,
      align: "center",
      trim: true
    });
    chip.anchor.set(0.5, 0.5);
    ringWrap.addChild(chipBg, chip);
    root.addChild(ringWrap);

    return {
      root, connector, echoWrap, echo, ringWrap, glow, frame, chipBg, chip,
      fxHolder, fxMesh: null, fxShader: null, fxOn: false, fxStart: 0, discR: 0,
      fxBaked: false, fxSheet: null,
      token: null, role: null, disposition: null, shape: null, fidelity: null,
      w: 0, h: 0, origin: null, key: null,
      phase: Math.random() * Math.PI * 2
    };
  }

  // Draws a ground marker around its own local origin. The disc is a procedural
  // WebGL energy field sized LARGER than the token so it reads as a glowing
  // pedestal the art sits on (not a frame on the art). The tick loop only
  // repositions ringWrap, advances the shader clock and redraws the connector —
  // so this runs only on a data/size change.
  _drawMarker(marker) {
    const { glow, frame, chipBg, chip, echo, role, w, h } = marker;
    const colors = getDispositionColors(marker.disposition);
    const accent = colors.base;
    const hi = colors.hi;
    const high = true;   // single "best" performance tier
    const isActive = role === "active";
    const base = Math.max(w, h);
    // Active disc is a tight pedestal hugging the art; the next disc is sized a
    // touch wider so its dashed "on deck" ring lands clearly OUTSIDE the token
    // footprint rather than hiding underneath the token art.
    const discR = base * (isActive ? 0.70 : 0.82);
    marker.discR = discR;

    glow.clear(); glow.filters = null;
    frame.clear();
    chipBg.clear(); chip.text = ""; chip.visible = false;
    echo.clear();

    // Start echo — a faint shader-less ring at the origin (active only). Drawn
    // independently of the disc so the start toggle works with the turn toggle off.
    if (isActive && marker.showStart && marker.origin) {
      const er = base * 0.7;
      echo.lineStyle({ width: 2, color: accent, alpha: 0.5, alignment: 0.5 });
      echo.drawCircle(0, 0, er);
      echo.lineStyle({ width: 1, color: hi, alpha: 0.28, alignment: 1 });
      echo.drawCircle(0, 0, er - 2);
      echo.lineStyle({ width: 1, color: accent, alpha: 0.35 });   // crosshair ticks
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        echo.moveTo(Math.cos(a) * (er - 5), Math.sin(a) * (er - 5));
        echo.lineTo(Math.cos(a) * (er + 5), Math.sin(a) * (er + 5));
      }
      echo.beginFill(accent, 0.4);
      echo.drawCircle(0, 0, Math.max(2.5, base * 0.05));
      echo.endFill();
    }

    if (!marker.showRing) {
      marker.fxOn = false;
      if (marker.fxMesh) marker.fxMesh.visible = false;
      return;
    }

    // Shader energy disc — the primary visual.
    marker.fxOn = this._setupMarkerFx(marker, discR * 2, colors, isActive, high);

    // Hand-drawn fallback (only when the shader is unavailable). Active = solid
    // glowing rings; next = a thin dashed perimeter, mirroring the shader's
    // "live pedestal vs queued outline" distinction.
    if (!marker.fxOn) {
      if (isActive) {
        if (high) {
          glow.lineStyle({ width: 9, color: hi, alpha: 0.22, alignment: 0.5 });
          glow.drawCircle(0, 0, discR * 0.86);
          try { const blur = new PIXI.BlurFilter(6); blur.quality = 2; glow.filters = [blur]; } catch {}
        }
        frame.lineStyle({ width: 3, color: accent, alpha: 0.92, alignment: 0.5 });
        frame.drawCircle(0, 0, discR * 0.82);
        frame.lineStyle({ width: 1, color: hi, alpha: 0.3 });
        frame.drawCircle(0, 0, discR * 0.62);
      } else {
        const r = discR * 0.82;
        const segs = 22;
        frame.lineStyle({ width: 2, color: accent, alpha: 0.62, alignment: 0.5 });
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * Math.PI * 2;
          const a1 = a0 + (Math.PI * 2 / segs) * 0.5;   // half-on, half-off dashes
          frame.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
          frame.arc(0, 0, r, a0, a1);
        }
      }
    }

    // "NEXT" chip — next ring only, above the disc.
    if (role === "next") {
      const fontSize = clamp(Math.round(base * 0.13), 9, 16);
      chip.style.fontSize = fontSize;
      chip.text = localize("GLUNI.TurnMarker.Next").toUpperCase();
      chip.visible = true;
      const padX = fontSize * 0.62, padY = fontSize * 0.32;
      const cw = chip.width + padX * 2, ch = chip.height + padY * 2;
      const cy = -discR * 0.86 - ch * 0.6;
      const cx = -cw / 2;
      const notch = clamp(ch * 0.42, 3, 7);
      chipBg.beginFill(0x000000, 0.45);
      chipBg.drawPolygon(this._chipPoints(cx, cy + 1, cw, ch, notch));
      chipBg.endFill();
      chipBg.beginFill(accent, 0.95);
      chipBg.drawPolygon(this._chipPoints(cx, cy, cw, ch, notch));
      chipBg.endFill();
      chipBg.lineStyle({ width: 1, color: hi, alpha: 0.65 });
      chipBg.drawPolygon(this._chipPoints(cx, cy, cw, ch, notch));
      chip.position.set(0, cy + ch / 2);
    }
  }

  // Builds/updates the turn-marker energy disc as a world-space Mesh so it stays
  // locked to the token under zoom. Prefers the pre-baked looping sheet (a cheap
  // texture blit + tint per frame); if render-to-texture isn't available it falls
  // back to running the live FX_FRAG_TURN plasma shader every frame. Returns false
  // (hiding the mesh) when even that is unavailable, so the hand-drawn ring shows.
  _setupMarkerFx(marker, size, colors, isActive, high) {
    if (!globalThis.PIXI?.Mesh || !globalThis.PIXI?.Geometry || !globalThis.PIXI?.Shader) return false;
    try {
      const sheets = getMarkerSheets();
      const wantBaked = !!sheets;
      // The bake/live pipelines use different shaders, so rebuild the mesh when the
      // available pipeline flips (e.g. sheets finish baking after a live marker).
      if (marker.fxMesh && !marker.fxMesh.destroyed && marker.fxBaked !== wantBaked) {
        destroyFxMesh(marker.fxMesh);
        marker.fxMesh = null;
        marker.fxShader = null;
      }

      if (wantBaked) {
        const sheet = isActive ? sheets.activeHigh : sheets.next;
        marker.fxSheet = sheet;
        if (!marker.fxMesh || marker.fxMesh.destroyed) {
          const mesh = makeFxMesh(FX_FRAG_TURN_PLAY, {
            uSampler: sheet.frames[0], uFrameB: sheet.frames[0], uMix: 0,
            uColor: [1, 1, 1], uColorHi: [1, 1, 1]
          });
          marker.fxMesh = mesh;
          marker.fxShader = mesh.shader;
          marker.fxStart = this._time;
          marker.fxBaked = true;
          marker.fxHolder.addChild(mesh);
        }
        const u = marker.fxShader.uniforms;
        u.uColor = rgbFloat(colors.base);
        u.uColorHi = rgbFloat(colors.hi);
        setFxMeshQuad(marker.fxMesh, size, size, true);
        marker.fxMesh.visible = true;
        return true;
      }

      // Live-shader fallback (render-to-texture unavailable).
      if (!marker.fxMesh || marker.fxMesh.destroyed) {
        const mesh = makeFxMesh(FX_FRAG_TURN, {
          uTime: 0, uSeed: Math.random() * 100, uActive: 1, uReduced: 0, uHigh: 1,
          uColor: [1, 1, 1], uColorHi: [1, 1, 1]
        });
        marker.fxMesh = mesh;
        marker.fxShader = mesh.shader;
        marker.fxStart = this._time;
        marker.fxBaked = false;
        marker.fxHolder.addChild(mesh);
      }
      const u = marker.fxShader.uniforms;
      u.uColor = rgbFloat(colors.base);
      u.uColorHi = rgbFloat(colors.hi);
      u.uActive = isActive ? 1 : 0;
      u.uHigh = high ? 1 : 0;
      setFxMeshQuad(marker.fxMesh, size, size, true);
      marker.fxMesh.visible = true;
      return true;
    } catch (err) {
      console.warn(`${MODULE_ID} | Turn-marker shader unavailable, using fallback`, err);
      if (marker.fxMesh) marker.fxMesh.visible = false;
      return false;
    }
  }

  // Per-frame: place the ring at the token centre, rotate/pulse it, and redraw the
  // start connector (origin -> live token centre) so it tracks movement in real
  // time. `dt` seconds; `dt === 0` is a one-shot positional sync after a rebuild.
  _syncMarker(marker, dt) {
    const token = marker.token;
    if (!token || token.destroyed || !token.center) return;
    // Mirror the token's live visibility every frame: the ground layer is detached
    // from the token, so a token slipping into fog mid-move would otherwise leave
    // its ring (and origin echo) glowing on the floor and leak a position.
    const visible = this._tokenVisible(token);
    if (marker.root.visible !== visible) marker.root.visible = visible;
    if (!visible) return;
    const cx = token.center.x, cy = token.center.y;
    marker.ringWrap.position.set(cx, cy);

    const motion = true;   // markers always animate (no reduced-motion gating)
    const t = this._time;
    const isActive = marker.role === "active";

    // Drive the shader disc. Baked: pick + cross-fade the two loop frames for this
    // instant. Live: advance the procedural clock as before.
    if (marker.fxOn && marker.fxShader && marker.fxMesh?.visible) {
      const speed = 1.5;
      if (marker.fxBaked && marker.fxSheet) {
        const frames = marker.fxSheet.frames;
        const n = frames.length;
        let ph = ((t * speed) / MARKER_LOOP_SEC) % 1;
        if (ph < 0) ph += 1;
        const fpos = ph * n;
        const i = Math.floor(fpos) % n;
        const u = marker.fxShader.uniforms;
        u.uSampler = frames[i];
        u.uFrameB = frames[(i + 1) % n];
        u.uMix = fpos - Math.floor(fpos);
      } else {
        marker.fxShader.uniforms.uTime = (t - marker.fxStart) * speed;
        marker.fxShader.uniforms.uReduced = motion ? 0 : 1;
      }
    } else {
      // Hand-drawn fallback ring: a gentle breathing pulse.
      if (motion) {
        const period = isActive ? 1.6 : 3.0;
        const pulse = 0.5 + 0.5 * Math.sin((t * 2 * Math.PI / period) + marker.phase);
        marker.frame.alpha = (isActive ? 0.8 : 0.62) + (isActive ? 0.2 : 0.18) * pulse;
        if (marker.glow) marker.glow.alpha = 0.6 + 0.4 * pulse;
      } else {
        marker.frame.alpha = 1;
        if (marker.glow) marker.glow.alpha = 1;
      }
    }

    // Start echo + connector (active only). Both anchor to the stored origin and
    // share the active token's visibility (already gated upstream).
    const origin = isActive ? marker.origin : null;
    if (origin) {
      marker.echoWrap.visible = true;
      marker.echoWrap.position.set(origin.cx, origin.cy);
      const moved = Math.hypot(cx - origin.cx, cy - origin.cy);
      const connectorOn = this._markerConnector && moved > Math.max(8, Math.min(token.w, token.h) * 0.25);
      this._drawConnector(marker, origin, cx, cy, connectorOn, motion);
    } else {
      marker.echoWrap.visible = false;
      marker.connector.clear();
    }
  }

  _drawConnector(marker, origin, cx, cy, on, motion) {
    const g = marker.connector;
    g.clear();
    if (!on) return;
    const colors = getDispositionColors(marker.disposition);
    const dx = cx - origin.cx, dy = cy - origin.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;

    // Faint full-length guide line.
    g.lineStyle({ width: 1, color: colors.base, alpha: 0.22 });
    g.moveTo(origin.cx, origin.cy);
    g.lineTo(cx, cy);

    // Flowing bright dashes travelling origin -> token.
    const dash = Math.max(6, len * 0.06);
    const gap = dash * 1.6;
    const stride = dash + gap;
    const flow = motion ? (this._time * Math.max(28, len * 0.5)) % stride : 0;
    g.lineStyle({ width: 2, color: colors.hi, alpha: 0.85 });
    for (let d = flow - stride; d < len; d += stride) {
      const s = Math.max(0, d), e = Math.min(len, d + dash);
      if (e <= s) continue;
      g.moveTo(origin.cx + ux * s, origin.cy + uy * s);
      g.lineTo(origin.cx + ux * e, origin.cy + uy * e);
    }
  }

  _removeMarker(tokenId) {
    const marker = this._markers.get(tokenId);
    if (!marker) return;
    if (!marker.root.destroyed) {
      try { if (marker.glow) marker.glow.filters = null; } catch {}
      destroyFxMesh(marker.fxMesh);
      marker.fxMesh = null;
      marker.fxShader = null;
      if (marker.root.parent) marker.root.parent.removeChild(marker.root);
      marker.root.destroy({ children: true });
    }
    this._markers.delete(tokenId);
  }

  _clearMarkers() {
    for (const tokenId of [...this._markers.keys()]) this._removeMarker(tokenId);
    if (this._groundLayer && !this._groundLayer.destroyed) {
      try { this._groundLayer.destroy({ children: true }); } catch {}
    }
    this._groundLayer = null;
  }

  _getShape() {
    try { return game.settings.get(MODULE_ID, SETTINGS.tokenOverlayShape) || "circle"; }
    catch { return "circle"; }
  }

  _getFidelity() {
    return "high";
  }

  _upsert(token, mode, gauge = null, dying = null) {
    let entry = this._entries.get(token.id);

    if (entry && entry.container.destroyed) {
      this._entries.delete(token.id);
      entry = null;
    }

    if (!entry) {
      entry = this._createEntry(token);
      this._entries.set(token.id, entry);
    }

    if (entry.container.parent !== token) {
      try { token.addChild(entry.container); } catch { return; }
    }

    const shape = this._getShape();
    const fidelity = this._getFidelity();
    const gaugeKey = gauge ? `${gauge.value}/${gauge.max}/${gauge.mode}` : "";
    const dyingKey = dying ? `${dying.kind ?? "dying"}/${dying.value}/${dying.max}/${dying.severity}/${dying.successes ?? ""}` : "";
    if (
      entry.mode !== mode ||
      entry.w !== token.w ||
      entry.h !== token.h ||
      entry.shape !== shape ||
      entry.fidelity !== fidelity ||
      entry.gaugeKey !== gaugeKey ||
      entry.dyingKey !== dyingKey
    ) {
      entry.mode = mode;
      entry.w = token.w;
      entry.h = token.h;
      entry.shape = shape;
      entry.fidelity = fidelity;
      entry.gauge = gauge;
      entry.gaugeKey = gaugeKey;
      entry.dying = dying;
      entry.dyingKey = dyingKey;
      this._redraw(entry);
    }
  }

  _createEntry(token) {
    const container = new PIXI.Container();
    container.eventMode = "none";
    container.interactiveChildren = false;

    // Soft outer glow (own layer so it can carry a BlurFilter on "high").
    const glow = new PIXI.Graphics();
    container.addChild(glow);

    const wash = new PIXI.Graphics();
    container.addChild(wash);

    // Static tactical frame (angled-corner ring + inner hairline).
    const frame = new PIXI.Graphics();
    container.addChild(frame);

    // L-shaped corner brackets.
    const brackets = new PIXI.Graphics();
    container.addChild(brackets);

    const cracks = new PIXI.Graphics();
    container.addChild(cracks);

    // Shader-driven interior FX (fracture for break, energy scan for delay).
    // Rendered as a world-space Mesh (built lazily in _setupTokenFx) so the
    // procedural pattern stays locked to the token under zoom rather than swimming
    // like a screen-space filter. The holder keeps its z-slot; a mesh failure
    // falls back to the hand-drawn Graphics cracks/pattern below.
    const fxHolder = new PIXI.Container();
    container.addChild(fxHolder);

    // Animated holo edge sweep (BREAK only). Pre-drawn once; the tick loop
    // only rotates / fades it. Lives in its own container so rotation pivots
    // around the token centre without touching other layers.
    const sweep = new PIXI.Container();
    sweep.visible = false;
    const sweepGfx = new PIXI.Graphics();
    sweep.addChild(sweepGfx);
    container.addChild(sweep);

    const pillBg = new PIXI.Graphics();
    container.addChild(pillBg);

    const label = new PIXI.Text("", {
      fontFamily: '"Bahnschrift", "Segoe UI", Arial, sans-serif',
      fontSize: 10,
      fontWeight: "bold",
      fill: "#02070b",
      letterSpacing: 1.2,
      align: "center",
      trim: true
    });
    label.anchor.set(0.5, 0.5);
    container.addChild(label);

    // Dying pip row — diamonds above the chip showing dying value vs max.
    const dyingPips = new PIXI.Graphics();
    container.addChild(dyingPips);

    // Break gauge bar — drawn above the token, independent of status mode.
    const gaugeGfx = new PIXI.Graphics();
    container.addChild(gaugeGfx);
    const gaugeText = new PIXI.Text("", {
      fontFamily: '"Bahnschrift", "Segoe UI", Arial, sans-serif',
      fontSize: 9,
      fontWeight: "bold",
      fill: "#ffffff",
      letterSpacing: 0.6,
      align: "right",
      trim: true,
      dropShadow: true,
      dropShadowColor: "#000000",
      dropShadowAlpha: 0.95,
      dropShadowBlur: 2,
      dropShadowDistance: 1
    });
    gaugeText.anchor.set(1, 0.5);   // baked into the bar, right-aligned
    container.addChild(gaugeText);

    token.addChild(container);

    return {
      container, glow, wash, frame, brackets, cracks, sweep, sweepGfx, pillBg, label,
      dyingPips, gaugeGfx, gaugeText,
      fxHolder, fxMesh: null, fxShader: null, fxFilterMode: null, fxOn: false, fxStart: 0,
      mode: null, w: 0, h: 0, shape: null, fidelity: null, gauge: null, gaugeKey: "",
      dying: null, dyingKey: "",
      gaugeAnim: null, gaugeGeom: null,
      phase: Math.random() * Math.PI * 2,
      seed: Math.random() * 99999,
      // Geometry the tick loop needs without re-deriving each frame.
      cx: 0, cy: 0, sweepR: 0
    };
  }

  // ---- frame geometry helpers -------------------------------------------

  // Notch size for the angled corners, echoing the rail card clip-path.
  _notch(w, h) {
    return clamp(Math.min(w, h) * 0.16, 5, 16);
  }

  // Returns the angled-corner outline points for a square frame inset by `pad`.
  // Top-left and bottom-right corners are notched (mirrors the card silhouette).
  _framePoints(w, h, pad) {
    const n = this._notch(w, h);
    const x0 = pad, y0 = pad, x1 = w - pad, y1 = h - pad;
    return [
      x0 + n, y0,
      x1, y0,
      x1, y1 - n,
      x1 - n, y1,
      x0, y1,
      x0, y0 + n
    ];
  }

  // Draws the break gauge bar above the token's top edge, in the amber break
  // palette. Smooth mode is a proportional fill with a bright leading edge;
  // segmented mode is one lit pip per remaining point.
  // Sets up the gauge geometry + transition state on a data change, then paints.
  // Matches the rail card: value baked into the bar, a travelling sheen, a width
  // tween and an amber/cyan flash on value change (the latter three are driven
  // per-frame from _onTick).
  _drawGauge(entry) {
    const { gauge, w, h } = entry;

    if (!gauge) {
      entry.gaugeAnim = null;
      entry.gaugeGeom = null;
      entry.gaugeGfx.clear();
      entry.gaugeText.text = "";
      entry.gaugeText.visible = false;
      return;
    }

    const ratio = clamp(gauge.ratio, 0, 1);
    const barW = w * 0.9;
    const barH = clamp(Math.min(w, h) * 0.07, 4, 9);
    const x = (w - barW) / 2;
    const y = -clamp(Math.min(w, h) * 0.05, 4, 12) - barH;
    entry.gaugeGeom = { barW, barH, x, y };

    const anim = entry.gaugeAnim;
    if (!anim) {
      entry.gaugeAnim = { display: ratio, target: ratio, flashT: 0, flashDir: 0 };
    } else if (Math.abs(anim.target - ratio) > 0.0005) {
      anim.flashDir = ratio < anim.target ? -1 : 1;   // depleting vs replenishing
      anim.flashT = BREAK_GAUGE_FLASH_SEC;
      anim.target = ratio;                            // display tweens toward it in _onTick
    }
    this._paintGauge(entry);
  }

  // Pure paint at the current animation state — cheap (a handful of rects), safe
  // to call every frame for the few GM-marked gauged tokens.
  _paintGauge(entry) {
    const { gaugeGfx, gaugeText, gauge, gaugeGeom, w, h } = entry;
    if (!gauge || !gaugeGeom) return;
    const P = TOKEN_OVERLAY_PALETTE;
    const { barW, barH, x, y } = gaugeGeom;
    const anim = entry.gaugeAnim;
    const { value, max } = gauge;
    const segmented = gauge.mode === BREAK_GAUGE_MODES.segmented;

    gaugeGfx.clear();
    gaugeGfx.beginFill(P.ink, 0.7);
    gaugeGfx.drawRect(x - 1, y - 1, barW + 2, barH + 2);
    gaugeGfx.endFill();
    gaugeGfx.beginFill(0x1a0f02, 0.85);
    gaugeGfx.drawRect(x, y, barW, barH);
    gaugeGfx.endFill();

    if (segmented) {
      const segGap = Math.max(1, barW * 0.012);
      const segW = Math.max((barW - segGap * (max - 1)) / max, 0.5);
      for (let i = 0; i < max; i++) {
        const sx = x + i * (segW + segGap);
        const on = i < value;
        gaugeGfx.beginFill(on ? P.broken : P.brokenDeep, on ? 0.95 : 0.18);
        gaugeGfx.drawRect(sx, y, segW, barH);
        gaugeGfx.endFill();
        if (on) {
          gaugeGfx.beginFill(P.brokenHot, 0.5);
          gaugeGfx.drawRect(sx, y, segW, Math.max(1, barH * 0.3));
          gaugeGfx.endFill();
        }
      }
    } else {
      const fillW = barW * clamp(anim.display, 0, 1);
      if (fillW > 0) {
        gaugeGfx.beginFill(P.broken, 0.95);
        gaugeGfx.drawRect(x, y, fillW, barH);
        gaugeGfx.endFill();
        gaugeGfx.beginFill(P.brokenHot, 0.55);
        gaugeGfx.drawRect(x, y, fillW, Math.max(1, barH * 0.32));
        gaugeGfx.endFill();
        gaugeGfx.beginFill(P.white, 0.85);   // bright leading edge
        gaugeGfx.drawRect(x + Math.max(0, fillW - 2), y, 2, barH);
        gaugeGfx.endFill();
        // travelling sheen glint, clipped to the filled region
        const ph = (this._time % BREAK_GAUGE_SHEEN_SEC) / BREAK_GAUGE_SHEEN_SEC;
        const band = Math.max(2, barW * 0.07);
        const travel = ph * (fillW + band * 2) - band;
        const s0 = Math.max(x, x + travel);
        const s1 = Math.min(x + fillW, x + travel + band);
        if (s1 > s0) {
          gaugeGfx.beginFill(P.white, 0.28);
          gaugeGfx.drawRect(s0, y, s1 - s0, barH);
          gaugeGfx.endFill();
        }
      }
    }

    gaugeGfx.lineStyle({ width: 1, color: P.broken, alpha: 0.7 });
    gaugeGfx.drawRect(x, y, barW, barH);
    gaugeGfx.lineStyle(0);

    gaugeText.style.fontSize = clamp(Math.round(Math.max(w, h) * 0.078), 7, 12);
    gaugeText.text = `${value}/${max}`;
    gaugeText.visible = true;
    const pad = Math.max(2, barW * 0.035);
    gaugeText.position.set(x + barW - pad, y + barH / 2 + 0.5);

    // dark fade behind the baked number so it stays legible over pips/fill
    const tw = Math.min(gaugeText.width + 4, barW);
    gaugeGfx.beginFill(P.ink, 0.5);
    gaugeGfx.drawRect(x + barW - pad - tw + 2, y + 0.5, tw, barH - 1);
    gaugeGfx.endFill();

    if (anim.flashT > 0) {
      const f = anim.flashT / BREAK_GAUGE_FLASH_SEC;        // 1 -> 0
      const col = anim.flashDir < 0 ? P.brokenHot : P.delayedHi;  // amber down / cyan up
      gaugeGfx.beginFill(col, 0.5 * f);
      gaugeGfx.drawRect(x, y, barW, barH);
      gaugeGfx.endFill();
    }
  }

  // Builds/updates the shader interior (break fracture / dying veins / delay scan)
  // as a world-space Mesh so the pattern stays locked to the token under zoom.
  // Returns false (hiding the mesh) when meshes are unavailable, so _redraw falls
  // back to the hand-drawn Graphics.
  _setupTokenFx(entry, mode, w, h, isCircle) {
    if (!globalThis.PIXI?.Mesh || !globalThis.PIXI?.Geometry || !globalThis.PIXI?.Shader) return false;
    try {
      if (!entry.fxMesh || entry.fxMesh.destroyed || entry.fxFilterMode !== mode) {
        destroyFxMesh(entry.fxMesh);
        const frag = mode === "broken" ? FX_FRAG_BREAK : mode === "dying" ? FX_FRAG_DYING : FX_FRAG_DELAY;
        const S = ACTIVE_SHADER_PALETTE;
        const themeUniforms = mode === "broken"
          ? { uBreakAmber: [...S.breakAmber], uBreakHot: [...S.breakHot] }
          : mode === "dying"
            ? { uVeinBase: [...S.veinBase], uVeinHot: [...S.veinHot] }
            : { uDelayBase: [...S.delayBase], uDelayHot: [...S.delayHot] };
        const mesh = makeFxMesh(frag, { uTime: 0, uSeed: Math.random() * 100, uAspect: 1, uClipCircle: 0, uThick: 0.08, uTexel: 0, uImpact: [0.5, 0.5], ...themeUniforms });
        entry.fxMesh = mesh;
        entry.fxShader = mesh.shader;
        entry.fxFilterMode = mode;
        entry.fxStart = this._time;   // (re)start the fracture intro on assign
        entry.fxHolder.addChild(mesh);
      }
      const u = entry.fxShader.uniforms;
      u.uAspect = h > 0 ? w / h : 1;
      u.uClipCircle = isCircle ? 1 : 0;
      u.uImpact = [0.5, 0.5];
      setFxMeshQuad(entry.fxMesh, w, h, false);
      entry.fxMesh.visible = true;
      return true;
    } catch (err) {
      console.warn(`${MODULE_ID} | Token FX shader unavailable, using fallback`, err);
      if (entry.fxMesh) entry.fxMesh.visible = false;
      return false;
    }
  }

  _redraw(entry) {
    const { glow, wash, frame, brackets, cracks, sweep, sweepGfx, pillBg, label, dyingPips,
            mode, w, h, shape, seed } = entry;
    const P = TOKEN_OVERLAY_PALETTE;

    // The gauge bar is independent of the status frame; draw it first so it is
    // present whether or not the token also shows a delay/break overlay.
    this._drawGauge(entry);

    // Gauge-only tokens (marked but neither delayed/broken/dying) skip the heavy
    // status frame entirely — clear any leftover status graphics and bail.
    if (mode !== "broken" && mode !== "delayed" && mode !== "dying") {
      glow.clear(); glow.filters = null;
      wash.clear(); frame.clear(); brackets.clear(); cracks.clear();
      sweepGfx.clear(); sweep.visible = false; sweep.alpha = 0;
      pillBg.clear(); label.text = ""; dyingPips.clear();
      if (entry.fxMesh) entry.fxMesh.visible = false;
      entry.fxOn = false;
      return;
    }

    const isBreak = mode === "broken";
    const isDying = mode === "dying";
    const isDelay = mode === "delayed";
    const isCircle = shape === "circle";
    const high = true;   // single "best" performance tier
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2;
    const rng = this._seededRng(seed);

    entry.cx = cx;
    entry.cy = cy;

    // Dying escalates toward a hot magenta at death's door so the token reads as
    // critical without needing the player to parse the pip count.
    const critical = isDying && entry.dying?.severity === "critical";
    // A stabilized 5e combatant (3 successes) reads calm teal instead of the
    // urgent violet/magenta of an actively dying one.
    const stableSave = isDying && entry.dying?.stable === true;
    const accent = isBreak ? P.broken : isDying ? (stableSave ? P.stable : critical ? P.magenta : P.dying) : P.delayed;
    const hi = isBreak ? P.brokenHot : isDying ? (stableSave ? P.stableHot : P.dyingHot) : P.delayedHi;

    // Shader interior (fracture / energy scan). When active, the hand-drawn
    // cracks/pattern below are skipped; the frame, brackets and label stay.
    entry.fxOn = this._setupTokenFx(entry, mode, w, h, isCircle);
    if (entry.fxOn) cracks.clear();

    // ---- wash (interior fill + subtle interior shading) -------------------
    wash.clear();
    if (isCircle) {
      if (isBreak) {
        wash.beginFill(P.broken, 0.06); wash.drawCircle(cx, cy, r - 2); wash.endFill();
        wash.beginFill(P.brokenDeep, 0.04); wash.drawCircle(cx + r * 0.18, cy - r * 0.12, r * 0.5); wash.endFill();
        wash.beginFill(P.brokenHot, 0.035); wash.drawCircle(cx - r * 0.22, cy + r * 0.18, r * 0.4); wash.endFill();
      } else if (isDying) {
        wash.beginFill(accent, critical ? 0.08 : 0.06); wash.drawCircle(cx, cy, r - 2); wash.endFill();
        wash.beginFill(P.dyingDeep, 0.05); wash.drawCircle(cx + r * 0.2, cy - r * 0.14, r * 0.5); wash.endFill();
        wash.beginFill(P.dyingHot, 0.03); wash.drawCircle(cx - r * 0.2, cy + r * 0.2, r * 0.4); wash.endFill();
      } else {
        wash.beginFill(P.delayed, 0.05); wash.drawCircle(cx, cy, r - 2); wash.endFill();
        wash.beginFill(P.delayedHi, 0.035); wash.drawCircle(cx + r * 0.25, cy - r * 0.15, r * 0.45); wash.endFill();
      }
      wash.lineStyle({ width: r * 0.4, color: P.ink, alpha: 0.12, alignment: 0 });
      wash.drawCircle(cx, cy, r - 1);
      wash.lineStyle(0);
    } else {
      const pts = this._framePoints(w, h, 2);
      wash.beginFill(accent, isBreak ? 0.06 : isDying && critical ? 0.07 : 0.05);
      wash.drawPolygon(pts);
      wash.endFill();
      if (isBreak) {
        wash.beginFill(P.brokenDeep, 0.04); wash.drawCircle(cx + w * 0.16, cy - h * 0.12, r * 0.5); wash.endFill();
      } else if (isDying) {
        wash.beginFill(P.dyingDeep, 0.045); wash.drawCircle(cx + w * 0.16, cy - h * 0.12, r * 0.5); wash.endFill();
      } else {
        wash.beginFill(P.delayedHi, 0.03); wash.drawCircle(cx + w * 0.18, cy - h * 0.12, r * 0.45); wash.endFill();
      }
      wash.lineStyle({ width: Math.min(w, h) * 0.18, color: P.ink, alpha: 0.1, alignment: 0 });
      wash.drawPolygon(this._framePoints(w, h, 1));
      wash.lineStyle(0);
    }

    if (isDelay && !entry.fxOn) this._drawDelayPattern(wash, cx, cy, r, w, h, isCircle, rng);

    // ---- soft outer glow (high only; balanced skips the blur layers) ------
    glow.clear();
    glow.filters = null;
    if (high) {
      const gAlpha = isBreak ? 0.20 : isDying ? (critical ? 0.22 : 0.16) : 0.13;
      const expand = isBreak ? 4 : 3;
      glow.lineStyle({ width: isBreak ? 8 : 6, color: hi, alpha: gAlpha, alignment: 0 });
      if (isCircle) glow.drawCircle(cx, cy, r + expand);
      // Negative pad expands the frame polygon outward by `expand` on all sides.
      else glow.drawPolygon(this._framePoints(w, h, -expand));
      try {
        const blur = new PIXI.BlurFilter(isBreak ? 6 : 4);
        blur.quality = 2;
        glow.filters = [blur];
      } catch {}
    }

    // ---- tactical frame: accent stroke + inner hairline -------------------
    frame.clear();
    if (isCircle) {
      if (!high) {
        frame.lineStyle({ width: isBreak ? 4 : 3, color: hi, alpha: isBreak ? 0.10 : 0.07, alignment: 0 });
        frame.drawCircle(cx, cy, r + 1);
      }
      frame.lineStyle({ width: isBreak ? 2.5 : 2, color: accent, alpha: isBreak ? 0.82 : 0.72, alignment: 0.5 });
      frame.drawCircle(cx, cy, r);
      frame.lineStyle({ width: isBreak ? 1 : 0.8, color: hi, alpha: isBreak ? 0.26 : 0.2, alignment: 1 });
      frame.drawCircle(cx, cy, r - (isBreak ? 1.5 : 1.2));
    } else {
      if (!high) {
        frame.lineStyle({ width: isBreak ? 4 : 3, color: hi, alpha: isBreak ? 0.10 : 0.07, alignment: 0 });
        frame.drawPolygon(this._framePoints(w, h, isBreak ? -1 : 0));
      }
      frame.lineStyle({ width: isBreak ? 2.5 : 2, color: accent, alpha: isBreak ? 0.82 : 0.72, alignment: 0.5 });
      frame.drawPolygon(this._framePoints(w, h, 1));
      frame.lineStyle({ width: isBreak ? 1 : 0.8, color: hi, alpha: isBreak ? 0.26 : 0.2, alignment: 1 });
      frame.drawPolygon(this._framePoints(w, h, 2.5));
    }

    // ---- corner brackets (L-marks at the frame corners) -------------------
    this._drawBrackets(brackets, w, h, r, cx, cy, isCircle, accent, isBreak ? 0.9 : 0.78);

    // ---- break cracks -----------------------------------------------------
    cracks.clear();
    if (isBreak && !entry.fxOn) this._drawBreakCracks(cracks, cx, cy, r, rng);

    // ---- holo edge sweep (BREAK only) -------------------------------------
    sweepGfx.clear();
    sweep.visible = false;
    sweep.alpha = 0;
    if (isBreak) {
      this._buildSweep(entry, sweepGfx, w, h, r, isCircle, high);
      sweep.position.set(cx, cy);
      sweepGfx.position.set(-cx, -cy); // keep gfx in token-space; pivot at centre
      sweep.visible = true;
    }

    // ---- tag chip (clipped-corner) + label --------------------------------
    const baseSize = Math.max(w, h);
    const fontSize = clamp(Math.round(baseSize * 0.095), 8, 13);
    label.style.fontSize = fontSize;
    label.style.fontWeight = "bold";
    label.style.letterSpacing = fontSize > 10 ? 1.5 : 1;
    label.text = isBreak
      ? localize("GLUNI.GuardBreak").toUpperCase()
      : isDying
        ? (entry.dying.kind === "deathsaves"
            ? (stableSave ? localize("GLUNI.DeathSaves.Stable").toUpperCase() : `${localize("GLUNI.DeathSaves").toUpperCase()} ${entry.dying.failures}/3`)
            : `${localize("GLUNI.Dying").toUpperCase()} ${entry.dying.value}/${entry.dying.max}`)
        : localize("GLUNI.Delayed").toUpperCase();
    label.style.fill = isBreak ? "#02070b" : isDying ? (stableSave ? "#04201c" : "#1a0033") : "#4aa3ff";

    const padX = fontSize * 0.6;
    const padY = fontSize * 0.32;
    const chipW = label.width + padX * 2;
    const chipH = label.height + padY * 2;
    const chipX = (w - chipW) / 2;
    const chipY = h - chipH - Math.max(3, baseSize * 0.03);
    const chipNotch = clamp(chipH * 0.42, 3, 7);

    pillBg.clear();
    if (isBreak) {
      // Solid amber chip with near-black text — clipped top-left / bottom-right.
      if (high) {
        pillBg.lineStyle({ width: 3, color: P.broken, alpha: 0.22 });
        pillBg.drawPolygon(this._chipPoints(chipX - 1, chipY - 1, chipW + 2, chipH + 2, chipNotch));
        pillBg.lineStyle(0);
      }
      pillBg.beginFill(0x000000, 0.4);
      pillBg.drawPolygon(this._chipPoints(chipX, chipY + 1, chipW, chipH, chipNotch));
      pillBg.endFill();
      pillBg.beginFill(P.broken, 0.95);
      pillBg.drawPolygon(this._chipPoints(chipX, chipY, chipW, chipH, chipNotch));
      pillBg.endFill();
      pillBg.lineStyle({ width: 0.8, color: P.brokenHot, alpha: 0.55 });
      pillBg.drawPolygon(this._chipPoints(chipX, chipY, chipW, chipH, chipNotch));
    } else if (isDying) {
      // Solid violet (magenta when critical, teal when stable) chip with near-black text.
      const chipCol = stableSave ? P.stable : critical ? P.magenta : P.dying;
      if (high) {
        pillBg.lineStyle({ width: 3, color: chipCol, alpha: 0.24 });
        pillBg.drawPolygon(this._chipPoints(chipX - 1, chipY - 1, chipW + 2, chipH + 2, chipNotch));
        pillBg.lineStyle(0);
      }
      pillBg.beginFill(0x000000, 0.42);
      pillBg.drawPolygon(this._chipPoints(chipX, chipY + 1, chipW, chipH, chipNotch));
      pillBg.endFill();
      pillBg.beginFill(chipCol, 0.95);
      pillBg.drawPolygon(this._chipPoints(chipX, chipY, chipW, chipH, chipNotch));
      pillBg.endFill();
      pillBg.lineStyle({ width: 0.8, color: stableSave ? P.stableHot : P.dyingHot, alpha: 0.7 });
      pillBg.drawPolygon(this._chipPoints(chipX, chipY, chipW, chipH, chipNotch));
    } else {
      // Outlined blue chip with blue text.
      pillBg.lineStyle(0);
      pillBg.beginFill(0x000000, 0.32);
      pillBg.drawPolygon(this._chipPoints(chipX, chipY + 1, chipW, chipH, chipNotch));
      pillBg.endFill();
      pillBg.beginFill(P.ink, 0.6);
      pillBg.drawPolygon(this._chipPoints(chipX, chipY, chipW, chipH, chipNotch));
      pillBg.endFill();
      pillBg.lineStyle({ width: 1.2, color: P.delayed, alpha: 0.82 });
      pillBg.drawPolygon(this._chipPoints(chipX, chipY, chipW, chipH, chipNotch));
    }

    label.position.set(w / 2, chipY + chipH / 2);

    // ---- dying pip row (above the chip) -----------------------------------
    dyingPips.clear();
    if (isDying) {
      if (entry.dying?.kind === "deathsaves") this._drawDeathSavePips(entry, w, h, chipY);
      else this._drawDyingPips(entry, w, h, chipY);
    }
  }

  // Two short diamond rows above the chip for 5e death saves: a teal successes
  // row stacked over a red failures row, each three pips wide.
  _drawDeathSavePips(entry, w, h, chipTopY) {
    const g = entry.dyingPips;
    const state = entry.dying;
    if (!state) return;
    const P = TOKEN_OVERLAY_PALETTE;
    const successes = clamp(Math.round(state.successes) || 0, 0, 3);
    const failures = clamp(Math.round(state.failures) || 0, 0, 3);

    const base = Math.max(w, h);
    let pipR = clamp(base * 0.045, 2.2, 5.2);
    let gap = clamp(base * 0.04, 1.8, 5);
    const maxRow = w * 0.94;
    if ((pipR * 2 + gap) * 3 - gap > maxRow) {
      const scale = maxRow / ((pipR * 2 + gap) * 3 - gap);
      pipR *= scale;
      gap *= scale;
    }
    const stepX = pipR * 2 + gap;
    const totalW = stepX * 3 - gap;
    const startX = (w - totalW) / 2 + pipR;
    const rowGap = Math.max(1.6, base * 0.02);
    const failY = chipTopY - pipR - Math.max(2, base * 0.022);
    const succY = failY - (pipR * 2 + rowGap);

    const diamond = (px, py, rr) => [px, py - rr, px + rr, py, px, py + rr, px - rr, py];

    const drawRow = (value, y, litCol, litHot, deepCol) => {
      for (let i = 0; i < 3; i++) {
        const px = startX + i * stepX;
        const filled = i < value;
        g.beginFill(P.ink, 0.55);
        g.drawPolygon(diamond(px, y + 0.5, pipR + 1.2));
        g.endFill();
        if (filled) {
          const last = i === value - 1;
          g.beginFill(last ? litHot : litCol, 0.96);
          g.drawPolygon(diamond(px, y, pipR));
          g.endFill();
          g.lineStyle({ width: 0.8, color: P.white, alpha: 0.6 });
          g.drawPolygon(diamond(px, y, pipR));
          g.lineStyle(0);
          g.beginFill(P.white, 0.5);
          g.drawPolygon(diamond(px, y, pipR * 0.4));
          g.endFill();
        } else {
          g.beginFill(deepCol, 0.22);
          g.drawPolygon(diamond(px, y, pipR));
          g.endFill();
          g.lineStyle({ width: 0.8, color: litCol, alpha: 0.5 });
          g.drawPolygon(diamond(px, y, pipR));
          g.lineStyle(0);
        }
      }
    };

    drawRow(successes, succY, P.saveSuccess, P.saveSuccessHot, P.saveSuccess);
    drawRow(failures, failY, P.saveFailure, P.saveFailureHot, P.dyingDeep);
  }

  // A compact row of diamond pips above the dying chip — one per dying level,
  // the first `value` lit and escalating to a hot fill at the final (death)
  // level. Gives an at-a-glance read of how close the actor is to dying out.
  _drawDyingPips(entry, w, h, chipTopY) {
    const g = entry.dyingPips;
    const dying = entry.dying;
    if (!dying) return;
    const P = TOKEN_OVERLAY_PALETTE;
    const max = clamp(Math.round(dying.max) || 4, 1, 9);
    const value = clamp(Math.round(dying.value) || 0, 0, max);
    const critical = dying.severity === "critical";

    const base = Math.max(w, h);
    let pipR = clamp(base * 0.05, 2.5, 6);            // half-diagonal of each diamond
    let gap = clamp(base * 0.045, 2, 6);
    // Shrink to fit the row within the token width when there are many levels.
    const maxRow = w * 0.94;
    if ((pipR * 2 + gap) * max - gap > maxRow) {
      const scale = maxRow / ((pipR * 2 + gap) * max - gap);
      pipR *= scale;
      gap *= scale;
    }
    const stepX = pipR * 2 + gap;
    const totalW = stepX * max - gap;
    const startX = (w - totalW) / 2 + pipR;
    const y = chipTopY - pipR - Math.max(2, base * 0.022);

    const diamond = (px, py, rr) => [px, py - rr, px + rr, py, px, py + rr, px - rr, py];

    // Triangle halves of a diamond, split at its waist — a lit upper facet over
    // a shadowed lower facet reads as a cut gem rather than a flat fill.
    const upperFacet = (px, py, rr) => [px, py - rr, px + rr, py, px - rr, py];
    const lowerFacet = (px, py, rr) => [px - rr, py, px + rr, py, px, py + rr];

    for (let i = 0; i < max; i++) {
      const px = startX + i * stepX;
      const filled = i < value;
      const last = i === max - 1;
      // dark plate beneath each pip so it stays legible over the portrait
      g.beginFill(P.ink, 0.55);
      g.drawPolygon(diamond(px, y + 0.5, pipR + 1.2));
      g.endFill();
      if (filled) {
        const col = critical || last ? P.dyingHot : P.dying;
        // soft coloured halo so the gem glows off the plate
        g.beginFill(col, critical || last ? 0.3 : 0.2);
        g.drawPolygon(diamond(px, y, pipR + 2.2));
        g.endFill();
        // shadowed lower facet, then the lit upper facet
        g.beginFill(P.dyingDeep, 0.95);
        g.drawPolygon(lowerFacet(px, y, pipR));
        g.endFill();
        g.beginFill(col, 0.97);
        g.drawPolygon(upperFacet(px, y, pipR));
        g.endFill();
        // crisp facet edges + waistline
        g.lineStyle({ width: 0.8, color: P.white, alpha: 0.6 });
        g.drawPolygon(diamond(px, y, pipR));
        g.moveTo(px - pipR, y); g.lineTo(px + pipR, y);
        g.lineStyle(0);
        // bright specular glint on the top facet
        g.beginFill(P.white, 0.85);
        g.drawPolygon(diamond(px, y - pipR * 0.42, pipR * 0.26));
        g.endFill();
      } else {
        g.beginFill(P.dyingDeep, 0.26);
        g.drawPolygon(diamond(px, y, pipR));
        g.endFill();
        // faint sheen on the upper facet hints at the unspent gem
        g.beginFill(P.dying, 0.16);
        g.drawPolygon(upperFacet(px, y, pipR));
        g.endFill();
        g.lineStyle({ width: 0.8, color: P.dying, alpha: 0.5 });
        g.drawPolygon(diamond(px, y, pipR));
        g.lineStyle(0);
      }
    }
  }

  // Clipped-corner chip outline (top-left + bottom-right notched, matching the
  // rail tag chips).
  _chipPoints(x, y, cw, ch, n) {
    return [
      x + n, y,
      x + cw, y,
      x + cw, y + ch - n,
      x + cw - n, y + ch,
      x, y + ch,
      x, y + n
    ];
  }

  _drawBrackets(g, w, h, r, cx, cy, isCircle, color, alpha) {
    g.clear();
    const len = clamp(Math.min(w, h) * 0.16, 6, 18);
    const lw = 1.6;
    g.lineStyle({ width: lw, color, alpha });

    if (isCircle) {
      // Four short tangential ticks at the diagonal NE/NW/SE/SW positions.
      const off = r + 1;
      const diag = Math.SQRT1_2;
      const corners = [
        { dx: -diag, dy: -diag }, // NW
        { dx: diag, dy: -diag },  // NE
        { dx: diag, dy: diag },   // SE
        { dx: -diag, dy: diag }   // SW
      ];
      for (const c of corners) {
        const px = cx + c.dx * off;
        const py = cy + c.dy * off;
        // tangent direction (perpendicular to radius)
        const tx = -c.dy, ty = c.dx;
        // two short arms forming an L (along tangent + inward radial)
        g.moveTo(px - tx * len * 0.5, py - ty * len * 0.5);
        g.lineTo(px + tx * len * 0.5, py + ty * len * 0.5);
        g.moveTo(px, py);
        g.lineTo(px - c.dx * len * 0.55, py - c.dy * len * 0.55);
      }
    } else {
      const pad = 1;
      const x0 = pad, y0 = pad, x1 = w - pad, y1 = h - pad;
      const n = this._notch(w, h);
      // Top-left (sits just past the notch).
      g.moveTo(x0, y0 + n + len); g.lineTo(x0, y0 + n); g.lineTo(x0 + n, y0); g.lineTo(x0 + n + len, y0);
      // Top-right.
      g.moveTo(x1 - len, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + len);
      // Bottom-left.
      g.moveTo(x0, y1 - len); g.lineTo(x0, y1); g.lineTo(x0 + len, y1);
      // Bottom-right (sits just past the notch).
      g.moveTo(x1, y1 - n - len); g.lineTo(x1, y1 - n); g.lineTo(x1 - n, y1); g.lineTo(x1 - n - len, y1);
    }
    g.lineStyle(0);
  }

  // Builds the holo sweep as a short bright arc/segment of the frame edge.
  // It is positioned/rotated by the tick loop. We bake a localized highlight
  // (a fading "comet" along the edge) once; animation only spins + fades it.
  _buildSweep(entry, g, w, h, r, isCircle, high) {
    const P = TOKEN_OVERLAY_PALETTE;
    g.clear();
    const cx = w / 2, cy = h / 2;
    const sweepR = isCircle ? r : Math.min(w, h) / 2;
    entry.sweepR = sweepR;

    // Three colour stops travelling around: deep amber -> hot -> white tip.
    const stops = high
      ? [
          { col: P.brokenDeep, a: 0.0, span: 0.55, wmul: 0.9 },
          { col: P.broken,     a: 0.55, span: 0.32, wmul: 1.0 },
          { col: P.brokenHot,  a: 0.85, span: 0.16, wmul: 1.2 },
          { col: P.white,      a: 1.0, span: 0.05, wmul: 1.5 }
        ]
      : [
          { col: P.broken,    a: 0.55, span: 0.3, wmul: 1.0 },
          { col: P.brokenHot, a: 0.9, span: 0.12, wmul: 1.3 }
        ];

    if (isCircle) {
      // Draw a comet arc from angle 0 backwards; tick loop rotates the gfx.
      const arc = high ? Math.PI * 0.9 : Math.PI * 0.6;
      const segCount = high ? 22 : 12;
      for (let s = 0; s < segCount; s++) {
        const t0 = s / segCount;
        const t1 = (s + 1) / segCount;
        // brightness ramps toward the leading tip (t -> 1)
        const stop = this._sweepStop(stops, t0);
        const lw = (high ? 3 : 2.4) * stop.wmul;
        g.lineStyle({ width: lw, color: stop.col, alpha: stop.a * (0.5 + 0.5 * t0) });
        const a0 = -arc + arc * t0;
        const a1 = -arc + arc * t1;
        g.moveTo(cx + Math.cos(a0) * sweepR, cy + Math.sin(a0) * sweepR);
        g.lineTo(cx + Math.cos(a1) * sweepR, cy + Math.sin(a1) * sweepR);
      }
    } else {
      // Square: trace a comet along the angled-corner perimeter starting at the
      // top-left notch. The tick loop advances `entry` by re-positioning along
      // the path, but to keep it cheap we instead rotate the same way as the
      // circle using an approximate radius pivot, plus a perimeter shimmer.
      const pts = this._framePoints(w, h, 1);
      // Build perimeter point list (closed loop).
      const loop = [];
      for (let i = 0; i < pts.length; i += 2) loop.push({ x: pts[i], y: pts[i + 1] });
      loop.push({ ...loop[0] });
      // cumulative lengths
      let total = 0;
      const segs = [];
      for (let i = 0; i < loop.length - 1; i++) {
        const dx = loop[i + 1].x - loop[i].x, dy = loop[i + 1].y - loop[i].y;
        const len = Math.hypot(dx, dy);
        segs.push({ a: loop[i], b: loop[i + 1], len, at: total });
        total += len;
      }
      entry.sweepPerim = total;
      entry.sweepSegs = segs;
      // The comet is drawn at distance 0; tick loop sets sweepGfx via a sampled
      // position. For square we render a static gradient dash set and let the
      // tick loop slide a mask-free bright dot. Simplest cheap approach: draw a
      // fixed bright dash and animate alpha + a moving highlight graphic.
      const dashCount = high ? 14 : 8;
      const dashLen = total / (dashCount * 2);
      for (let i = 0; i < dashCount; i++) {
        const t = i / dashCount;
        const stop = this._sweepStop(stops, t);
        const startD = t * total;
        this._drawPerimDash(g, segs, startD, dashLen, stop.col, stop.a * 0.5, (high ? 2.6 : 2.2) * stop.wmul);
      }
    }
  }

  _sweepStop(stops, t) {
    // Map normalized progress to one of the colour stops by cumulative span.
    let acc = 0;
    for (const s of stops) {
      acc += s.span;
      if (t <= acc) return s;
    }
    return stops[stops.length - 1];
  }

  // Draws a dash of length `dashLen` starting at perimeter distance `startD`.
  _drawPerimDash(g, segs, startD, dashLen, color, alpha, width) {
    const total = segs[segs.length - 1].at + segs[segs.length - 1].len;
    let d = ((startD % total) + total) % total;
    let remaining = dashLen;
    g.lineStyle({ width, color, alpha });
    let started = false;
    let guard = 0;
    while (remaining > 0 && guard++ < 64) {
      const seg = segs.find(s => d >= s.at && d < s.at + s.len) || segs[0];
      const into = d - seg.at;
      const segRemain = seg.len - into;
      const take = Math.min(segRemain, remaining);
      const ux = (seg.b.x - seg.a.x) / (seg.len || 1);
      const uy = (seg.b.y - seg.a.y) / (seg.len || 1);
      const px = seg.a.x + ux * into;
      const py = seg.a.y + uy * into;
      const qx = px + ux * take;
      const qy = py + uy * take;
      if (!started) { g.moveTo(px, py); started = true; }
      g.lineTo(qx, qy);
      remaining -= take;
      d += take;
      if (d >= total) d -= total;
    }
  }

  _drawDelayPattern(g, cx, cy, r, w, h, isCircle, rng) {
    const insetR = r * 0.9;
    const P = TOKEN_OVERLAY_PALETTE;

    this._drawHatchSet(g, cx, cy, insetR, w, h, isCircle, Math.PI / 6, P.delayed, 0.06, 0.7);
    this._drawHatchSet(g, cx, cy, insetR, w, h, isCircle, 5 * Math.PI / 6, P.delayedHi, 0.04, 0.6);

    const nodeCount = 3 + Math.floor(rng() * 2);
    const bounds = isCircle ? r * 0.65 : Math.min(w, h) * 0.32;
    const nodes = [];

    for (let i = 0; i < nodeCount; i++) {
      const a = rng() * Math.PI * 2;
      const d = bounds * (0.3 + rng() * 0.7);
      const nx = cx + Math.cos(a) * d;
      const ny = cy + Math.sin(a) * d;
      const sides = 4 + Math.floor(rng() * 2);
      const nodeR = Math.max(w, h) * (0.04 + rng() * 0.04);

      const pts = [];
      for (let s = 0; s < sides; s++) {
        const sa = (s / sides) * Math.PI * 2 + rng() * 0.5;
        const sr = nodeR * (0.7 + rng() * 0.6);
        pts.push(nx + Math.cos(sa) * sr, ny + Math.sin(sa) * sr);
      }
      g.lineStyle({ width: 0.7, color: P.delayedHi, alpha: 0.2 + rng() * 0.1 });
      g.drawPolygon(pts);
      nodes.push({ x: nx, y: ny });
    }

    for (let i = 1; i < nodes.length; i++) {
      g.lineStyle({ width: 0.5, color: P.delayed, alpha: 0.14 });
      g.moveTo(nodes[i - 1].x, nodes[i - 1].y);
      g.lineTo(nodes[i].x, nodes[i].y);

      if (rng() > 0.5) {
        const mx = (nodes[i - 1].x + nodes[i].x) / 2 + (rng() - 0.5) * 6;
        const my = (nodes[i - 1].y + nodes[i].y) / 2 + (rng() - 0.5) * 6;
        const ta = rng() * Math.PI * 2;
        const tl = Math.max(w, h) * 0.04;
        g.lineStyle({ width: 0.4, color: P.delayedHi, alpha: 0.1 });
        g.moveTo(mx, my);
        g.lineTo(mx + Math.cos(ta) * tl, my + Math.sin(ta) * tl);
      }
    }
  }

  _drawHatchSet(g, cx, cy, insetR, w, h, isCircle, theta, color, alpha, lineW) {
    const dirX = Math.cos(theta), dirY = Math.sin(theta);
    const normX = -Math.sin(theta), normY = Math.cos(theta);
    const maxD = isCircle ? insetR : Math.max(w, h);
    const spacing = Math.max(10, maxD * 0.12);

    g.lineStyle({ width: lineW, color, alpha });

    for (let d = -maxD; d <= maxD; d += spacing) {
      if (isCircle) {
        const sqr = insetR * insetR - d * d;
        if (sqr < 4) continue;
        const half = Math.sqrt(sqr);
        const lx = cx + normX * d, ly = cy + normY * d;
        g.moveTo(lx - dirX * half, ly - dirY * half);
        g.lineTo(lx + dirX * half, ly + dirY * half);
      } else {
        const lx = cx + normX * d, ly = cy + normY * d;
        const ext = maxD * 1.5;
        g.moveTo(lx - dirX * ext, ly - dirY * ext);
        g.lineTo(lx + dirX * ext, ly + dirY * ext);
      }
    }
  }

  _drawBreakCracks(g, cx, cy, radius, rng) {
    const P = TOKEN_OVERLAY_PALETTE;
    const impactX = cx + (rng() - 0.5) * radius * 0.3;
    const impactY = cy + (rng() - 0.5) * radius * 0.3;

    g.beginFill(P.broken, 0.1);
    g.drawCircle(impactX, impactY, radius * 0.22);
    g.endFill();
    g.beginFill(P.brokenHot, 0.18);
    g.drawCircle(impactX, impactY, radius * 0.1);
    g.endFill();
    g.beginFill(P.white, 0.14);
    g.drawCircle(impactX, impactY, radius * 0.04);
    g.endFill();

    const armCount = 5 + Math.floor(rng() * 3);
    const step = (Math.PI * 2) / armCount;
    const colors = [P.brokenHot, P.broken, P.brokenDeep, P.white];
    const arms = [];

    for (let i = 0; i < armCount; i++) {
      const angle = step * i + (rng() - 0.5) * step * 0.5;
      const armLen = radius * (0.55 + rng() * 0.4);
      const segs = 6 + Math.floor(rng() * 4);
      const color = colors[Math.floor(rng() * colors.length)];
      const path = this._buildCrackPath(impactX, impactY, angle, armLen, segs, rng);
      arms.push({ path, color });

      if (rng() > 0.35) {
        const bi = Math.min(Math.floor(path.length * (0.3 + rng() * 0.35)), path.length - 1);
        const bp = path[bi];
        const ba = angle + (rng() > 0.5 ? 1 : -1) * (0.4 + rng() * 0.8);
        const bl = armLen * (0.25 + rng() * 0.3);
        const branchPath = this._buildCrackPath(bp.x, bp.y, ba, bl, 3 + Math.floor(rng() * 3), rng);
        arms.push({ path: branchPath, color, branch: true });

        if (rng() > 0.6 && branchPath.length > 1) {
          const si = Math.min(Math.floor(branchPath.length * (0.5 + rng() * 0.3)), branchPath.length - 1);
          const sp = branchPath[si];
          const sa = ba + (rng() > 0.5 ? 1 : -1) * (0.5 + rng() * 0.6);
          const subPath = this._buildCrackPath(sp.x, sp.y, sa, bl * 0.4, 2 + Math.floor(rng() * 2), rng);
          arms.push({ path: subPath, color: P.brokenHot, sub: true });
        }
      }
    }

    for (const arm of arms) {
      const bw = arm.sub ? 4 : arm.branch ? 5.5 : 7;
      const ba = arm.sub ? 0.06 : arm.branch ? 0.09 : 0.14;
      this._renderCrackPath(g, arm.path, arm.color, ba, bw, 0.6);
    }

    for (const arm of arms) {
      const sw = arm.sub ? 0.8 : arm.branch ? 1.2 : 1.8;
      const sa = arm.sub ? 0.3 : arm.branch ? 0.42 : 0.58;
      this._renderCrackPath(g, arm.path, arm.color, sa, sw, 0.85);
    }
  }

  _buildCrackPath(sx, sy, baseAngle, length, segments, rng) {
    const path = [{ x: sx, y: sy }];
    let px = sx, py = sy, angle = baseAngle;
    const segLen = length / segments;

    for (let s = 0; s < segments; s++) {
      angle += (rng() - 0.5) * 0.7;
      const nx = px + Math.cos(angle) * segLen;
      const ny = py + Math.sin(angle) * segLen;
      const mx = (px + nx) / 2 + (rng() - 0.5) * segLen * 0.4;
      const my = (py + ny) / 2 + (rng() - 0.5) * segLen * 0.4;
      path.push({ x: mx, y: my, ctrl: true });
      path.push({ x: nx, y: ny });
      px = nx;
      py = ny;
    }
    return path;
  }

  _renderCrackPath(g, path, color, alpha, startWidth, taper) {
    if (path.length < 2) return;
    const totalSegs = Math.floor((path.length - 1) / 2);
    let idx = 0;

    for (let s = 0; s < totalSegs; s++) {
      const progress = s / Math.max(totalSegs, 1);
      const lw = Math.max(startWidth * (1 - progress * taper), 0.3);
      const la = alpha * (1 - progress * 0.45);

      g.lineStyle({ width: lw, color, alpha: la });
      g.moveTo(path[idx].x, path[idx].y);

      if (idx + 2 < path.length && path[idx + 1].ctrl) {
        g.quadraticCurveTo(path[idx + 1].x, path[idx + 1].y, path[idx + 2].x, path[idx + 2].y);
        idx += 2;
      } else {
        g.lineTo(path[idx + 1].x, path[idx + 1].y);
        idx += 1;
      }
    }
  }

  _seededRng(seed) {
    let s = Math.floor(seed) | 0;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return (s >>> 16) / 32768;
    };
  }

  _removeEntry(tokenId) {
    const entry = this._entries.get(tokenId);
    if (!entry) return;
    if (!entry.container.destroyed) {
      // Drop any blur filter we attached so the GPU resource is released.
      try { if (entry.glow) entry.glow.filters = null; } catch {}
      destroyFxMesh(entry.fxMesh);
      entry.fxMesh = null;
      entry.fxShader = null;
      if (entry.container.parent) entry.container.parent.removeChild(entry.container);
      entry.container.destroy({ children: true });
    }
    this._entries.delete(tokenId);
  }

  _clearAll() {
    for (const tokenId of [...this._entries.keys()]) this._removeEntry(tokenId);
    this._clearMarkers();
    this._stopTick();
  }

  _startTick() {
    if (this._ticking) return;
    const ticker = canvas?.app?.ticker;
    if (!ticker) return;
    this._ticking = true;
    ticker.add(this._tickFn);
  }

  _stopTick() {
    if (!this._ticking) return;
    this._ticking = false;
    canvas?.app?.ticker?.remove(this._tickFn);
  }

  _onTick(dt) {
    const dts = (typeof dt === "number" ? dt : 1) / 60;
    this._time += dts;

    // Ground turn-markers: reposition + animate each marker. Cheap — at most the
    // active + next tokens. Intensity/connector flags are cached during refresh()
    // (setting changes trigger forceRedraw), so no per-frame settings reads here.
    if (this._markers.size) {
      for (const marker of this._markers.values()) {
        if (marker.root.destroyed) continue;
        this._syncMarker(marker, dts);
      }
    }

    for (const entry of this._entries.values()) {
      if (entry.container.destroyed) continue;

      // Break-gauge animation runs for any gauged token, even one that is neither
      // broken nor delayed: tween the fill toward its target, decay the flash and
      // keep the sheen sweeping.
      if (entry.gauge && entry.gaugeAnim && entry.gaugeGeom) {
        const a = entry.gaugeAnim;
        const smooth = entry.gauge.mode !== BREAK_GAUGE_MODES.segmented;
        let active = false;
        if (Math.abs(a.target - a.display) > 0.0008) {
          a.display += (a.target - a.display) * (1 - Math.exp(-dts * 7));
          if (Math.abs(a.target - a.display) <= 0.001) a.display = a.target;
          active = true;
        }
        if (a.flashT > 0) { a.flashT = Math.max(0, a.flashT - dts); active = true; }
        if (smooth && a.display > 0) active = true;   // keep the sheen alive
        // advance the math every tick but throttle the Graphics rebuild to ~30fps
        if (active && this._time - (a.paintAt || 0) >= 0.0333) {
          a.paintAt = this._time;
          this._paintGauge(entry);
        }
      }

      // Gauge-only entries have no animated status frame to drive.
      if (entry.mode !== "broken" && entry.mode !== "delayed" && entry.mode !== "dying") continue;
      const isBreak = entry.mode === "broken";
      const high = true;   // single "best" performance tier

      // Advance the shader interior clock (fracture / energy scan).
      if (entry.fxOn && entry.fxShader && entry.fxMesh?.visible) {
        entry.fxShader.uniforms.uTime = this._time - entry.fxStart;
      }

      if (isBreak) {
        // Frame keeps a gentle breathing pulse.
        const bt = 0.5 + 0.5 * Math.sin((this._time * 2 * Math.PI / 1.28) + entry.phase);
        entry.frame.alpha = 0.7 + 0.3 * bt;
        if (entry.brackets) entry.brackets.alpha = 0.65 + 0.35 * bt;

        const ct = 0.5 + 0.5 * Math.sin((this._time * 2 * Math.PI / 1.08) + entry.phase + 0.7);
        entry.cracks.alpha = 0.55 + 0.45 * ct;

        // Holo edge sweep — cheap: rotate (circle) or fade-pulse (square) the
        // pre-built highlight, plus an overall travelling alpha shimmer.
        if (entry.sweep && !entry.sweep.destroyed) {
          const speed = high ? 2.6 : 1.9; // radians/sec-ish
          const shimmer = 0.55 + 0.45 * Math.sin((this._time * 2 * Math.PI / (high ? 0.7 : 1.0)) + entry.phase);
          entry.sweep.alpha = (high ? 0.85 : 0.6) * shimmer;
          if (entry.shape === "circle") {
            entry.sweep.rotation = (this._time * speed) % (Math.PI * 2);
          } else {
            // Square: cannot cheaply rotate around a non-circular edge, so we
            // pulse alpha and slide a subtle skew via position bob instead.
            entry.sweep.rotation = 0;
            const bob = Math.sin(this._time * speed * 0.5 + entry.phase) * 0.6;
            entry.sweep.position.set(entry.cx, entry.cy + bob);
          }
        }
      } else if (entry.mode === "dying") {
        // DYING: an ominous heartbeat — faster and more insistent the closer the
        // actor is to death (critical), but never the frantic break sweep.
        const crit = entry.dying?.severity === "critical";
        const period = crit ? 0.9 : 1.7;
        const t = 0.5 + 0.5 * Math.sin((this._time * 2 * Math.PI / period) + entry.phase);
        entry.frame.alpha = (crit ? 0.68 : 0.58) + 0.34 * t;
        if (entry.brackets) entry.brackets.alpha = 0.5 + 0.4 * t;
        if (entry.glow) entry.glow.alpha = (crit ? 0.6 : 0.5) + 0.45 * t;
        // Pip row holds steady normally; pulses only at death's door so the
        // value-vs-max read stays clear while still screaming "critical".
        if (entry.dyingPips) entry.dyingPips.alpha = crit ? 0.6 + 0.4 * t : 1;
      } else {
        // DELAYED stays calm: slow gentle pulse, no sweep.
        const t = 0.5 + 0.5 * Math.sin((this._time * 2 * Math.PI / 3.5) + entry.phase);
        entry.frame.alpha = 0.55 + 0.3 * t;
        if (entry.brackets) entry.brackets.alpha = 0.5 + 0.3 * t;
        if (entry.glow) entry.glow.alpha = 0.6 + 0.4 * t;
      }
    }
  }

  destroy() {
    this._clearAll();
  }
}
