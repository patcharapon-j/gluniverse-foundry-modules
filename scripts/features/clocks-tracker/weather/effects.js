/**
 * WeatherEffect — a self-contained PixiJS mini-diorama for the weather display
 * (decision #7). It owns one PIXI.Application sized to a host element and never
 * touches the scene canvas. Particles are tinted Sprites generated from
 * procedural textures (no asset files), so any weather is just an archetype +
 * two tints (decision #8): acid rain = streaks + green, crimson lightning =
 * flashes + crimson, etc.
 *
 * Fidelity: particles carry a depth `z` that drives parallax (near particles are
 * larger, faster and brighter than far ones), streaks use a head→tail gradient
 * texture, and particle counts scale with canvas area so the same effect reads
 * well in a tiny chip OR across the full HUD bar.
 *
 * Lifecycle (decision D4): the ticker stops when the host is hidden/collapsed or
 * the tab is backgrounded, and on destroy. `prefers-reduced-motion` renders a
 * single static frame.
 *
 * Uses Foundry's bundled Pixi (PIXI global) — no new dependency. If Pixi or
 * WebGL is unavailable, create() returns null and the host falls back to its
 * CSS-only tinted look.
 */

const ADDITIVE = new Set(["motes", "embers", "spores", "runes", "void"]);

/**
 * Motion map: every archetype resolves to ONE of the nine implemented motion
 * behaviours. The original nine map to themselves; the expanded batch reuses a
 * base motion and distinguishes itself by texture / blend / tint / tuning. This
 * is what makes the library "virtually unlimited looks" without bespoke physics
 * per effect — a new archetype is just an entry here plus a TUNING row.
 */
const MOTION = {
  clear: "clear", streaks: "streaks", flakes: "flakes", volume: "volume",
  flashes: "flashes", motes: "motes", embers: "embers", gusts: "gusts", shards: "shards",
  // ---- expanded batch ----
  shadow: "volume",    // dark soft masses creeping / pulsing at the edges
  creep: "embers",     // spreading rot rising from below
  spores: "motes",     // glowing spores hanging in the air
  miasma: "volume",    // heavy sickly low haze
  static: "motes",     // signal loss — fast flickering speckle
  swarm: "motes",      // erratic drifting swarm
  drips: "streaks",    // slow oozing drips
  bubbles: "embers",   // rising depth bubbles
  runes: "motes",      // glowing glyph-motes pulsing in place
  void: "motes",       // distant twinkling void / stars
  dust: "flakes",      // fine grains drifting sideways
  ripples: "gusts"     // rising water lines
};

/** Per-archetype tuning: base count @intensity 1 & unit area, hard cap, texture. */
const TUNING = {
  clear:   { max: 14, cap: 60,  tex: "dot"    },
  streaks: { max: 80, cap: 420, tex: "streak" },
  flakes:  { max: 60, cap: 340, tex: "flake"  },
  volume:  { max: 8,  cap: 46,  tex: "blob"   },
  flashes: { max: 70, cap: 380, tex: "streak" },   // storm = rain + strobe overlay
  motes:   { max: 50, cap: 280, tex: "glow"   },
  embers:  { max: 46, cap: 260, tex: "glow"   },
  gusts:   { max: 60, cap: 300, tex: "streak" },
  shards:  { max: 50, cap: 300, tex: "shard"  },
  // ---- expanded batch ----
  shadow:  { max: 7,  cap: 40,  tex: "blob"   },
  creep:   { max: 40, cap: 220, tex: "glow"   },
  spores:  { max: 46, cap: 260, tex: "glow"   },
  miasma:  { max: 8,  cap: 46,  tex: "blob"   },
  static:  { max: 70, cap: 380, tex: "dot"    },
  swarm:   { max: 60, cap: 320, tex: "dot"    },
  drips:   { max: 50, cap: 260, tex: "streak" },
  bubbles: { max: 44, cap: 240, tex: "glow"   },
  runes:   { max: 40, cap: 220, tex: "glow"   },
  void:    { max: 60, cap: 320, tex: "glow"   },
  dust:    { max: 60, cap: 340, tex: "flake"  },
  ripples: { max: 46, cap: 240, tex: "streak" }
};

/** Archetypes whose particles mix in the secondary glow tint on a fraction of sprites. */
const GLOW_MIX = new Set(["embers", "motes", "spores", "runes", "void", "creep"]);

const REF_AREA = 1700;          // ~ the original 54×30 chip; counts scale off this

const hexInt = (s, fallback = 0xffffff) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s ?? ""));
  return m ? parseInt(m[1], 16) : fallback;
};
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class WeatherEffect {
  /** Build an effect for `host`, or null if Pixi/WebGL is unavailable. */
  static create(host, spec) {
    const PIXI = globalThis.PIXI;
    if (!PIXI || !host) return null;
    try { return new WeatherEffect(host, spec); }
    catch (err) { console.warn("gluniverse-clocks-and-tracker | Weather effect init failed", err); return null; }
  }

  constructor(host, spec) {
    const PIXI = globalThis.PIXI;
    this.host = host;
    this.spec = null;
    this.particles = [];
    this._paused = true;
    this._flashT = 0;
    this._strike = 0;
    this._reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    const w = Math.max(8, host.clientWidth || 54);
    const h = Math.max(8, host.clientHeight || 30);
    this.areaScale = clamp((w * h) / REF_AREA, 0.7, 6);
    this.app = new PIXI.Application({
      width: w, height: h, backgroundAlpha: 0, antialias: true,
      autoStart: false, resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    const view = this.app.view ?? this.app.canvas;
    view.classList.add("glct-wx-canvas");
    Object.assign(view.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
    host.appendChild(view);

    this._buildTextures();
    this.layer = new PIXI.Container();
    this.app.stage.addChild(this.layer);
    // Sky-flash bloom (storm), brighter at the top, hidden until a bolt fires.
    this.flash = new PIXI.Sprite(this.texFlash);
    this.flash.width = w; this.flash.height = h; this.flash.alpha = 0;
    this.flash.blendMode = PIXI.BLEND_MODES.ADD;
    this.app.stage.addChild(this.flash);
    // Lightning bolt: a jagged, branching path regenerated on each strike and
    // drawn additively over the flash bloom (storm archetype only).
    this.bolt = new PIXI.Graphics();
    this.bolt.blendMode = PIXI.BLEND_MODES.ADD;
    this.bolt.alpha = 0; this.bolt.visible = false;
    this.app.stage.addChild(this.bolt);
    this._boltMain = null; this._boltBranches = [];

    this.app.ticker.add(this._tick, this);
    this._onVis = () => this._syncPause();
    document.addEventListener("visibilitychange", this._onVis);

    this.setSpec(spec);
  }

  /* ------------------------------ textures ------------------------------ */

  /** Build a texture from a 2D canvas — smooth, anti-aliased gradients beat
      stacked-circle Graphics for soft, natural particles. */
  _canvasTex(w, h, draw) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    const t = globalThis.PIXI.Texture.from(cv);
    (this._texList ??= []).push(t);
    return t;
  }

  _buildTextures() {
    // a soft radial blob with a configurable alpha falloff. Textures are
    // super-sampled (drawn larger than they'll ever display) so the GPU
    // down-samples them — crisp, clean anti-aliasing at every particle size.
    const soft = (s, stops) => this._canvasTex(s, s, (ctx) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    });
    this.texDot  = soft(96,  [[0, 1], [0.30, 0.96], [0.58, 0.46], [1, 0]]);         // general round particle
    this.texGlow = soft(128, [[0, 0.95], [0.22, 0.62], [0.55, 0.18], [1, 0]]);      // motes / embers halo
    this.texBlob = soft(192, [[0, 0.46], [0.4, 0.2], [0.72, 0.06], [1, 0]]);        // fog volume

    // snow: a soft six-spoke ice crystal — faint radial spokes over a soft core,
    // so flakes read as crystalline without hard edges (also reads fine, tinted,
    // for drifting ash). Super-sampled for clean spokes at small sizes.
    this.texFlake = this._canvasTex(96, 96, (ctx, w, h) => {
      const c = w / 2;
      const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.62);
      core.addColorStop(0, "rgba(255,255,255,0.98)");
      core.addColorStop(0.4, "rgba(255,255,255,0.5)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = core; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.34)";
      ctx.lineWidth = w * 0.045; ctx.lineCap = "round";
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k, ex = Math.cos(a) * c * 0.82, ey = Math.sin(a) * c * 0.82;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + ex, c + ey); ctx.stroke();
        // small side-barbs for a hint of crystal structure
        const bx = c + ex * 0.6, by = c + ey * 0.6, bl = c * 0.2;
        for (const s2 of [-1, 1]) {
          const ba = a + s2 * (Math.PI / 3);
          ctx.beginPath(); ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl); ctx.stroke();
        }
      }
    });

    // rain: a smooth vertical motion-blur streak, bright head (bottom) → clear
    // tail, with a soft feathered edge. Super-sampled and narrow for a crisp,
    // glassy filament rather than a fat bar.
    this.texStreak = this._canvasTex(16, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.18, "rgba(255,255,255,0.7)");
      g.addColorStop(0.55, "rgba(255,255,255,0.28)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      const cw = w * 0.34;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(w / 2 - cw / 2, 3, cw, h - 6, cw / 2);
      else ctx.rect(w / 2 - cw / 2, 3, cw, h - 6);
      ctx.fill();
    });

    // hail / sleet: a small, crisp ice crystal — a faceted diamond with a lit
    // upper-left face, a darker lower body and a bright rim, wrapped in a faint
    // icy halo so it stays legible even when tiny. Super-sampled for clean edges.
    this.texShard = this._canvasTex(64, 80, (ctx, w, h) => {
      const cx = w / 2, top = h * 0.14, bot = h * 0.86, midY = h * 0.5, lx = w * 0.24, rx = w * 0.76;
      // faint halo (lets a small crystal still catch the eye as a bright glint)
      const halo = ctx.createRadialGradient(cx, midY, 0, cx, midY, w * 0.5);
      halo.addColorStop(0, "rgba(255,255,255,0.42)");
      halo.addColorStop(0.5, "rgba(255,255,255,0.1)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
      // crystal body, diagonally graded (bright top-left → dim bottom-right)
      const body = ctx.createLinearGradient(lx, top, rx, bot);
      body.addColorStop(0, "rgba(255,255,255,1)");
      body.addColorStop(0.5, "rgba(255,255,255,0.84)");
      body.addColorStop(1, "rgba(255,255,255,0.58)");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(cx, top); ctx.lineTo(rx, midY); ctx.lineTo(cx, bot); ctx.lineTo(lx, midY); ctx.closePath();
      ctx.fill();
      // lit upper-left facet
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.moveTo(cx, top); ctx.lineTo(lx, midY); ctx.lineTo(cx, midY); ctx.closePath();
      ctx.fill();
      // bright rim for crisp definition
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = w * 0.045;
      ctx.beginPath();
      ctx.moveTo(cx, top); ctx.lineTo(rx, midY); ctx.lineTo(cx, bot); ctx.lineTo(lx, midY); ctx.closePath();
      ctx.stroke();
    });

    // storm bloom: a vertical wash, bright at the top fading down (sky lighting)
    this.texFlash = this._canvasTex(32, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.38)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
  }

  _tex(name) {
    switch (name) {
      case "blob": return this.texBlob;
      case "streak": return this.texStreak;
      case "glow": return this.texGlow;
      case "shard": return this.texShard;
      case "flake": return this.texFlake;
      default: return this.texDot;
    }
  }

  /* ------------------------------ spec / particles ------------------------------ */

  setSpec(spec) {
    const s = spec ?? { archetype: "clear", intensity: 0.3, tintParticle: "#cfe8ff", tintGlow: "#7fb4e6", drift: "still" };
    const archChanged = !this.spec || this.spec.archetype !== s.archetype || this.spec.intensity !== s.intensity || this.spec.drift !== s.drift;
    this.spec = { ...s };
    this.pColor = hexInt(s.tintParticle, 0xffffff);
    this.gColor = hexInt(s.tintGlow, 0xffffff);
    if (archChanged) this._rebuild();
    else this._retint();
    if (this._reduced) this._renderStatic();
  }

  _rebuild() {
    const PIXI = globalThis.PIXI;
    this.layer.removeChildren().forEach(c => c.destroy());
    this.particles = [];
    const arch = this.spec.archetype;
    const motion = MOTION[arch] ?? "clear";
    const tune = TUNING[arch] ?? TUNING.clear;
    const blend = ADDITIVE.has(arch) ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
    const I = this.spec.intensity ?? 0.5;
    const count = clamp(Math.round(tune.max * (0.3 + 0.7 * I) * this.areaScale), 3, tune.cap);
    this.flash.visible = motion === "flashes";
    if (this.bolt) {
      this.bolt.visible = motion === "flashes";
      if (motion !== "flashes") { this.bolt.clear(); this.bolt.alpha = 0; }
    }

    for (let i = 0; i < count; i++) {
      const sp = new PIXI.Sprite(this._tex(tune.tex));
      sp.anchor.set(0.5);
      sp.blendMode = blend;
      this.layer.addChild(sp);
      const p = { sp, z: Math.random() };       // z = depth (0 far … 1 near)
      this._spawn(p, true);
      this.particles.push(p);
    }
    // draw nearer (bigger/brighter) particles last so they sit on top
    this.particles.sort((a, b) => a.z - b.z).forEach(p => this.layer.addChild(p.sp));
    this._retint();
  }

  _retint() {
    const arch = this.spec.archetype;
    const mix = GLOW_MIX.has(arch);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      // glow-mix archetypes blend in the secondary tint on a fraction of particles
      const useGlow = mix && (i % 3 === 0);
      p.sp.tint = useGlow ? this.gColor : this.pColor;
    }
    if (this.flash) this.flash.tint = this.gColor;
  }

  get _w() { return this.app.renderer.width / this.app.renderer.resolution; }
  get _h() { return this.app.renderer.height / this.app.renderer.resolution; }

  /** Initial / recycled spawn for a particle, per archetype. */
  _spawn(p, initial = false) {
    const w = this._w, h = this._h, arch = MOTION[this.spec.archetype] ?? "clear", drift = this.spec.drift, I = this.spec.intensity ?? 0.5;
    const sp = p.sp;
    const z = (p.z ??= Math.random());           // depth: near=1, far=0
    const near = 0.35 + 0.65 * z;                // parallax multiplier
    sp.rotation = 0;
    sp.alpha = 1;
    const driftX = drift === "left" ? -1 : drift === "right" ? 1 : 0;
    const driftY = drift === "rise" ? -1 : drift === "fall" ? 1 : 0;

    switch (arch) {
      case "flashes":      // storm: heavier, faster rain under the bloom
      case "streaks": {
        sp.x = rand(-6, w + 6); sp.y = initial ? rand(0, h) : rand(-h * 0.5, -6);
        // rain is near-vertical; wind only nudges the angle
        const wind = driftX * rand(0.06, 0.16);
        const speed = (arch === "flashes" ? 340 : 250) * (0.55 + I) * near;
        p.vx = wind * speed; p.vy = speed;
        sp.scale.set((0.4 + 0.28 * near) * rand(0.8, 1.15), (0.28 + 0.4 * near) * rand(0.85, 1.25));
        sp.rotation = Math.atan2(p.vy, p.vx) - Math.PI / 2;
        p.base = (0.13 + 0.32 * z) * rand(0.85, 1.1);
        break;
      }
      case "shards": {
        sp.x = rand(-4, w + 4); sp.y = initial ? rand(0, h) : rand(-12, -2);
        p.vx = driftX * rand(10, 30) * near; p.vy = rand(220, 320) * (0.55 + I) * near;
        // small, crisp ice pellets — a fraction of the old footprint so they
        // never crowd the readout; a slight vertical stretch reads as fast fall
        const sc = (0.085 + 0.09 * near) * rand(0.82, 1.14);
        sp.scale.set(sc, sc * 1.16);
        sp.rotation = rand(-0.5, 0.5);    // mostly upright, gentle tilt
        p.spin = rand(-2.4, 2.4);         // slow tumble (was a frantic spin)
        p.base = 0.6 + 0.4 * z;
        break;
      }
      case "flakes": {
        sp.x = rand(0, w); sp.y = initial ? rand(0, h) : (driftY < 0 ? h + 6 : -6);
        // snow falls slowly and drifts; small, soft, varied
        p.vx = rand(-5, 5) + driftX * 12; p.vy = (driftY < 0 ? -1 : 1) * rand(9, 24) * near;
        p.sway = rand(0.4, 1.3); p.phase = rand(0, Math.PI * 2); p.swayAmp = rand(3, 8) * near;
        // scaled for the 96px crystal texture so on-screen flakes stay small
        sp.scale.set((0.038 + 0.085 * near) * rand(0.85, 1.25));
        sp.rotation = rand(0, Math.PI);    // vary the crystal's orientation
        p.base = (0.4 + 0.5 * z);
        break;
      }
      case "volume": {
        // fog: big, very soft, very faint clouds drifting slowly sideways
        sp.x = initial ? rand(0, w) : (driftX < 0 ? w + 70 : -70);
        sp.y = rand(-h * 0.1, h * 1.1);
        p.vx = (driftX || 1) * rand(2, 7) * (0.5 + z); p.vy = rand(-1.5, 1.5);
        sp.scale.set((0.55 + 0.85 * near) * rand(0.8, 1.4));
        p.base = (0.05 + 0.12 * z) + I * 0.07;
        p.phase = rand(0, Math.PI * 2); p.twk = rand(0.25, 0.7);
        break;
      }
      case "motes": {
        sp.x = rand(0, w); sp.y = rand(0, h);
        p.vx = rand(-10, 10) * near; p.vy = (rand(-10, 10) + driftY * 10) * near;
        sp.scale.set((0.18 + 0.4 * near) * rand(0.85, 1.2));
        p.phase = rand(0, Math.PI * 2); p.twk = rand(1.5, 4);
        p.base = (0.35 + 0.6 * z);
        break;
      }
      case "embers": {
        sp.x = rand(0, w); sp.y = initial ? rand(0, h) : h + 4;
        p.vx = rand(-12, 12) + driftX * 10; p.vy = -rand(20, 52) * (0.55 + I) * near;
        sp.scale.set((0.16 + 0.36 * near) * rand(0.85, 1.2));
        p.phase = rand(0, Math.PI * 2); p.twk = rand(3, 7);
        p.base = (0.45 + 0.5 * z);
        break;
      }
      case "gusts": {
        sp.x = initial ? rand(0, w) : (driftX < 0 ? w + 12 : -12);
        sp.y = rand(0, h);
        p.vx = (driftX || 1) * rand(150, 300) * (0.55 + I) * near; p.vy = rand(-6, 6);
        sp.scale.set((0.5 + 0.7 * near) * rand(0.8, 1.2), (0.16 + 0.26 * near));
        sp.rotation = Math.PI / 2;   // lay the streak horizontal
        p.base = (0.22 + 0.5 * z);
        break;
      }
      default: { // clear — faint slow shimmer
        sp.x = rand(0, w); sp.y = rand(0, h);
        p.vx = rand(-4, 4); p.vy = rand(-4, 4);
        sp.scale.set((0.14 + 0.24 * near) * rand(0.85, 1.2));
        p.phase = rand(0, Math.PI * 2); p.twk = rand(1, 2.5);
        p.base = (0.1 + 0.22 * z);
        break;
      }
    }
    sp.alpha = p.base;
  }

  /* ------------------------------ ticker ------------------------------ */

  _tick() {
    if (this._paused) return;
    const dt = Math.min(0.05, (this.app?.ticker?.deltaMS ?? 16.6) / 1000);
    this._advance(dt);
  }

  _advance(dt) {
    const w = this._w, h = this._h, arch = MOTION[this.spec.archetype] ?? "clear", t = (this._flashT += dt);

    for (const p of this.particles) {
      const sp = p.sp;
      sp.x += p.vx * dt; sp.y += p.vy * dt;
      switch (arch) {
        case "flakes":
          sp.x += Math.sin(t * p.sway + p.phase) * p.swayAmp * dt;
          sp.rotation += dt * 0.3;
          if (sp.y > h + 8 || sp.y < -8) this._spawn(p);
          else if (sp.x < -10) sp.x = w + 8; else if (sp.x > w + 10) sp.x = -8;
          break;
        case "motes":
        case "clear":
          p.vx += rand(-12, 12) * dt; p.vy += rand(-12, 12) * dt;
          p.vx *= 0.96; p.vy *= 0.96;
          sp.alpha = p.base * (0.5 + 0.5 * Math.sin(t * p.twk + p.phase));
          if (sp.x < -6) sp.x = w + 6; else if (sp.x > w + 6) sp.x = -6;
          if (sp.y < -6) sp.y = h + 6; else if (sp.y > h + 6) sp.y = -6;
          break;
        case "embers":
          p.vx += Math.sin(t * 2 + p.phase) * 14 * dt;
          sp.alpha = p.base * (0.45 + 0.55 * Math.sin(t * p.twk + p.phase));
          if (sp.y < -6 || sp.x < -10 || sp.x > w + 10) this._spawn(p);
          break;
        case "volume":
          sp.alpha = p.base * (0.7 + 0.3 * Math.sin(t * p.twk + p.phase));
          if (sp.x < -76 || sp.x > w + 76) this._spawn(p);
          break;
        case "gusts":
          if (sp.x < -16 || sp.x > w + 16) this._spawn(p);
          break;
        case "shards":
          sp.rotation += (p.spin ?? 0) * dt;
          if (sp.y > h + 8) this._spawn(p);
          break;
        default: // streaks / flashes (rain)
          if (sp.y > h + 8 || sp.x < -12 || sp.x > w + 12) this._spawn(p);
          break;
      }
    }

    if (arch === "flashes") this._tickFlash(dt);
  }

  /** Storm: a forked bolt + ambient flash bloom, with an occasional re-flicker. */
  _tickFlash(dt) {
    const I = this.spec.intensity ?? 0.7;
    if (this._strike > 0) {
      this.flash.alpha = Math.max(0, this.flash.alpha - dt * 6);   // bloom lingers
      if (this.bolt) this.bolt.alpha = Math.max(0, this.bolt.alpha - dt * 11); // bolt snaps off
      if (this.flash.alpha <= 0.02 && (!this.bolt || this.bolt.alpha <= 0.02)) {
        this._strike--;
        if (this._strike > 0) { this._spawnBolt(); this.flash.alpha = rand(0.3, 0.6); }  // flicker
      }
    } else if (Math.random() < dt * (0.18 + I * 0.7)) {
      this._strike = Math.random() < 0.5 ? 2 : 1;        // sometimes a double-strike
      this._spawnBolt();
      this.flash.alpha = rand(0.5, 0.85);
    }
  }

  /** Generate a fresh jagged main channel + 1–2 branches, then draw it. */
  _spawnBolt() {
    if (!this.bolt) return;
    const w = this._w, h = this._h;
    const jit = Math.min(w * 0.16, 11);
    const segs = Math.max(4, Math.round(h / 7));
    const stepY = h / segs;
    const main = [];
    // The full HUD bar is very wide and masks the weather to its left third, so
    // strikes must land there to be visible; the popup chip is ~square with no
    // mask, so centre the strike there instead.
    const wide = w / h > 3;
    let x = wide ? rand(w * 0.05, w * 0.24) : rand(w * 0.34, w * 0.66), y = 0;
    for (let i = 0; i <= segs; i++) {
      main.push({ x: clamp(x, 2, w - 2), y });
      x += rand(-1, 1) * jit;
      y += stepY * rand(0.7, 1.3);
    }
    this._boltMain = main;
    this._boltBranches = [];
    const branches = Math.random() < 0.65 ? 1 : 2;
    for (let b = 0; b < branches; b++) {
      const from = main[Math.floor(rand(1, Math.max(2, segs - 1)))];
      const dir = Math.random() < 0.5 ? -1 : 1;
      const br = [{ x: from.x, y: from.y }];
      let bx = from.x, by = from.y;
      const blen = Math.round(rand(2, 4));
      for (let i = 0; i < blen; i++) {
        bx += dir * rand(3, 9) + rand(-2, 2);
        by += stepY * rand(0.5, 1);
        br.push({ x: clamp(bx, 1, w - 1), y: by });
      }
      this._boltBranches.push(br);
    }
    this.bolt.alpha = 1;
    this._drawBolt();
  }

  _drawBolt() {
    const g = this.bolt;
    if (!g || !this._boltMain) return;
    g.clear();
    const paths = [this._boltMain, ...this._boltBranches];
    const trace = (pts, width, color, alpha) => {
      g.lineStyle({ width, color, alpha, cap: "round", join: "round" });
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    };
    // wide soft glow in the storm's glow tint, then a bright white core
    for (const p of paths) trace(p, 4.2, this.gColor, 0.4);
    for (const p of paths) trace(p, 2.0, this.gColor, 0.7);
    for (const p of paths) trace(p, 0.9, 0xffffff, 1);
  }

  _renderStatic() {
    for (let i = 0; i < 30; i++) this._advance(0.05);
    try { this.app?.renderer?.render(this.app.stage); } catch { /* ignore */ }
  }

  /* ------------------------------ lifecycle ------------------------------ */

  pause() {
    if (this._paused) return;
    this._paused = true;
    this.app?.ticker?.stop();
  }

  resume() {
    if (this._reduced) { this._renderStatic(); return; }
    if (!this._paused) return;
    this._paused = false;
    this.app?.ticker?.start();
  }

  /** Pause when the tab is hidden or the host is display:none (collapsed/hidden);
      otherwise resume the live field (compact and full bar both animate). */
  _syncPause() {
    if (document.hidden || !this.host?.offsetParent) this.pause();
    else this.resume();
  }

  resize() {
    const w = Math.max(8, this.host.clientWidth || 54), h = Math.max(8, this.host.clientHeight || 30);
    try {
      this.app?.renderer?.resize(w, h);
      if (this.flash) { this.flash.width = w; this.flash.height = h; }
      // a large area change (chip ↔ full bar) warrants re-seeding the field density
      const next = clamp((w * h) / REF_AREA, 0.7, 6);
      if (this.spec && Math.abs(next - this.areaScale) / this.areaScale > 0.25) {
        this.areaScale = next; this._rebuild();
      }
    } catch { /* ignore */ }
  }

  destroy() {
    document.removeEventListener("visibilitychange", this._onVis);
    try { this.app?.ticker?.remove(this._tick, this); } catch { /* ignore */ }
    try { this.app?.destroy(true, { children: true, texture: true, baseTexture: true }); } catch { /* ignore */ }
    this.app = null; this.particles = [];
  }
}

/**
 * Shared alias. The class is no longer weather-specific — it renders any effect
 * archetype × tints for the delving HUD too — so new code should import it under
 * this neutral name. (Kept as an alias rather than a rename to avoid churning the
 * many existing `WeatherEffect` imports.)
 */
export { WeatherEffect as EffectField };
