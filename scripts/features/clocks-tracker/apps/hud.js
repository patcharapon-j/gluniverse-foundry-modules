/**
 * GlctHud — the Arcane Glass top-bar HUD as a frameless ApplicationV2.
 *
 * Rendering strategy: the Handlebars template provides the skeleton; the
 * dynamic children (stretch pips, shift cells, dual-ring, slot-reel clocks)
 * are built once in _onRender. Time updates call update() which *mutates* the
 * existing DOM — never a full re-render — so reel/pip animations stay
 * continuous, exactly like the approved mockup.
 */

import { MODULE_ID, SETTINGS } from "../const.js";
import { Features } from "../features.js";
import { TimeEngine } from "../engine.js";
import {
  STRETCHES_PER_SHIFT, STRETCHES_PER_HOUR, HOURS_PER_SHIFT, SHIFTS_PER_DAY
} from "../time-math.js";
import { WeatherStore } from "../weather/weather-store.js";
import { WeatherEngine } from "../weather/engine.js";
import { WeatherEffect } from "../weather/effects.js";
import { DelvingStore } from "../delving/delving-store.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const NS = "http://www.w3.org/2000/svg";

// Compact value-flash choreography (ms). The flash is a deliberate four-beat
// sequence — open the bar, pause, animate the value change, pause, close —
// rather than letting the open and the value change overlap.
const PEEK_OPEN  = 430;   // bar width ease when opening / closing the card
const PEEK_PAUSE = 300;   // beat held still between each step
const PEEK_VALUE = 620;   // reel/pip ease as the values change (.52s + a margin)

export class GlctHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  /** Open (or focus) the singleton HUD. */
  static async open() {
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  /** Repaint the live HUD from current world time (no full re-render). */
  static refreshState() { this.instance?.update(); }

  /** Force a structural re-render (e.g. after isGM/collapse template changes). */
  static async refreshStructure() {
    if (this.instance?.rendered) { this.instance._built = false; await this.instance.render(); }
  }

  /** Toggle shift/watch mode live (no re-render) so the swap can animate. */
  static applyShiftMode() { this.instance?._applyShiftMode(); }

  /** Engage/lift the "temporal distortion" glitch live (no re-render). */
  static applyGlitch() { this.instance?._applyGlitch(); }

  /** Repaint just the weather chip (after a weatherChanged / enable toggle). */
  static refreshWeather() { this.instance?._paintWeather(); }

  /** Repaint the delving readout + diorama (after a delvingChanged / enable toggle). */
  static refreshDelving() { this.instance?._paintDelving(); this.instance?._paintWeather(); }

  /**
   * Release the held pool readout after a roll's in-card slot animation finishes,
   * so the HUD only catches up to the new pool/stage/atmosphere once the player has
   * watched the dice resolve. `seq` is the roll sequence the card animated.
   */
  static settleDelveRoll(seq) {
    const i = this.instance;
    if (!i) return;
    if (seq != null) i._seenRollSeq = seq;
    clearTimeout(i._rollSafety); i._rollSafety = null; i._rollSafetySeq = null;
    i._paintDelving();
    i._paintWeather();
  }

  static DEFAULT_OPTIONS = {
    id: "glct-hud",
    classes: ["glct"],
    tag: "div",
    window: { frame: false, positioned: false, minimizable: false, resizable: false },
    actions: {
      advance: GlctHud.prototype._onAdvance,
      nextShift: GlctHud.prototype._onNextShift,
      setTime: GlctHud.prototype._onSetTime,
      toggleShiftMode: GlctHud.prototype._onToggleShiftMode,
      toggleGlitch: GlctHud.prototype._onToggleGlitch,
      openMission: GlctHud.prototype._onOpenMission,
      openCalendar: GlctHud.prototype._onOpenCalendar,
      openWeather: GlctHud.prototype._onOpenWeather,
      passTurn: GlctHud.prototype._onPassTurn,
      rollPool: GlctHud.prototype._onRollPool,
      toggleDelving: GlctHud.prototype._onToggleDelving,
      resetDelve: GlctHud.prototype._onResetDelve,
      openDelving: GlctHud.prototype._onOpenDelving
    }
  };

  static PARTS = {
    hud: { template: `modules/${MODULE_ID}/features/clocks-tracker/templates/hud.hbs` }
  };

  _built = false;
  _prevShift = null;
  _prevShiftDial = null;
  _reels = [];
  _missReel = [];
  _ringPies = [];
  _ringSqs = [];
  _dialPies = [];
  _dialPtr = null;
  _dialRot = 0;
  _barT = null;         // pending bar-width-tween cleanup timeout
  _wx = null;           // WeatherEffect (chip Pixi diorama), lazily created
  _dx = null;           // delving featured-stage diorama (Pixi), lazily created
  _prevTurn = null;     // last painted turns-elapsed (for the tick animation)
  _seenRollSeq = null;  // last roll sequence whose card animation has finalised
  _rollSafety = null;   // safety timer that releases a held roll if no card settles
  _rollSafetySeq = null;// the roll sequence the safety timer is armed for
  _delveCtx = null;     // open delving context menu element, if any
  _delveCtxOff = null;  // teardown for the delving menu's window listeners
  _sig = null;          // signature of the last painted display values
  _peeking = false;     // mid value-flash (compact bar temporarily expanded)
  _peekShown = false;   // the open finished and the value change has been painted
  _peekShowT = null;    // pending "open done → animate the value change" timeout
  _peekEndT = null;     // pending re-collapse timeout after a peek
  _peekTransT = null;   // pending cleanup of the peek's transform-transition
  _peekStyle = null;    // saved inline transform to restore after a peek clamp
  _glitchT = null;      // 1 Hz scramble interval while the temporal-distortion glitch is live

  get collapsed() {
    try { return game.settings.get(MODULE_ID, SETTINGS.hudCollapsed); } catch { return false; }
  }

  /** World-wide shift-level (watch) display mode. */
  get shiftMode() {
    if (!Features.on("timeHud.shiftMode")) return false;   // capability disabled → always stretch view
    try { return game.settings.get(MODULE_ID, SETTINGS.shiftLevelMode); } catch { return false; }
  }

  /** World-wide "temporal distortion": the GM corrupts the HUD readout so the
   *  date/time reads as noise — for scenes where the when/where is a mystery. */
  get glitched() {
    try { return !!game.settings.get(MODULE_ID, SETTINGS.hudGlitch); } catch { return false; }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      isGM: game.user?.isGM ?? false,
      collapsed: this.collapsed,
      shiftMode: this.shiftMode
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    // a fresh DOM drops any in-flight value-flash (peek) state
    clearTimeout(this._peekEndT); clearTimeout(this._barT); clearTimeout(this._peekTransT);
    this._peeking = false; this._peekStyle = null;
    this._wx?.destroy(); this._wx = null;   // the chip host is recreated on re-render
    this._dx?.destroy(); this._dx = null;   // delving diorama host is recreated too
    this._prevTurn = null;
    clearTimeout(this._rollSafety); this._rollSafety = null; this._rollSafetySeq = null;
    this._buildDynamic();
    this._applyFeatureGates();
    this._applyPosition();
    this._wireViewportClamp();
    this._activateInteractions();
    this._activateDelving();
    this.update();
    this._paintWeather();
    this._paintDelving();
    this._applyGlitch();   // re-engage the distortion if a client renders mid-glitch
  }

  /**
   * Hide the HUD pieces whose sub-feature is switched off in the Module
   * Configuration. Applied once per render via a sticky class (`feat-off`,
   * display:none !important) that update()'s class-toggling never clears — so a
   * disabled control stays gone without touching the live-painting code paths.
   */
  _applyFeatureGates() {
    const root = this.element;
    if (!root) return;
    const gate = (on, ...sels) => {
      for (const sel of sels) root.querySelectorAll(sel).forEach(el => el?.classList.toggle("feat-off", !on));
    };

    // Calendar access: the date stays visible but stops being a button, and the
    // event badge / chip is hidden. Events nest under calendar.
    const calendar = Features.on("timeHud.calendar");
    gate(Features.on("timeHud.events"), ".event-badge");
    root.querySelector(".cell.date")?.classList.toggle("feat-noclick", !calendar);

    // Mission countdown: drop the dock button and the meter's countdown line.
    gate(Features.on("timeHud.mission"), "[data-missionbtn]", "[data-missline]");

    // Watch/stretch view toggle.
    gate(Features.on("timeHud.shiftMode"), "[data-modebtn]");

    // GM time controls: the advance / next-shift / set-time / distort buttons.
    gate(Features.on("timeHud.gmControls"),
      '.c[data-action="advance"]', '[data-action="nextShift"]', '[data-action="setTime"]', '[data-action="toggleGlitch"]');
  }

  async _onClose(options) {
    clearTimeout(this._peekEndT); clearTimeout(this._barT); clearTimeout(this._peekTransT); clearTimeout(this._clampT);
    clearTimeout(this._rollSafety); this._rollSafety = null;
    clearInterval(this._glitchT); this._glitchT = null;
    this._peeking = false;
    this._closeDelveMenu();
    this._wx?.destroy();
    this._wx = null;
    this._dx?.destroy();
    this._dx = null;
    if (this._onViewportResize) window.removeEventListener("resize", this._onViewportResize);
    if (this._resizeRAF) { cancelAnimationFrame(this._resizeRAF); this._resizeRAF = null; }
    return super._onClose(options);
  }

  /* ------------------------------ weather chip ------------------------------ */

  /**
   * Repaint the weather readout + the full-bar diorama from the current
   * condition. The readout (icon · label · temperature) lives as a cell in the
   * bar; the animated effect is a Pixi layer spanning the whole bar behind the
   * content at low opacity. The Pixi app is created lazily and only re-specced
   * when the effect changes; its ticker is paused while the bar is collapsed or
   * the tab is backgrounded (decision D4). The condition tint is scoped to the
   * weather cell only, so the rest of the HUD keeps the shift colour (#6).
   */
  _paintWeather() {
    if (!this.rendered) return;
    const cell = this.element.querySelector("[data-weather]");
    const host = this.element.querySelector("[data-wxbar]");
    const scrim = this.element.querySelector("[data-wxscrim]");
    const bar = this.element.querySelector("[data-bar]");

    // Weather and delving coexist: weather washes the LEFT edge (behind the date
    // stack), delving the RIGHT (behind the turn/resource cell). They carry
    // separate bar tint vars so neither overwrites the other.
    const enabled = WeatherStore.enabled && WeatherStore.configured && Features.on("weather.hudChip");
    if (!enabled) {
      cell?.classList.add("hidden");
      host?.classList.add("off");
      scrim?.classList.add("off");
      bar?.classList.remove("has-wx");
      this._wx?.destroy(); this._wx = null;
      return;
    }

    const cur = WeatherEngine.getCurrent();
    const hex = cur?.hex;
    if (!hex) { cell?.classList.add("hidden"); host?.classList.add("off"); scrim?.classList.add("off"); bar?.classList.remove("has-wx"); this._wx?.pause(); return; }
    const e = hex.effect ?? {};

    cell?.classList.remove("hidden");
    this._setText("[data-wxlabel]", hex.label ?? "");
    const tempEl = cell?.querySelector("[data-wxtemp]");
    if (tempEl) { tempEl.textContent = hex.temperature ?? ""; tempEl.style.display = hex.temperature ? "" : "none"; }
    const ico = cell?.querySelector("[data-wxicon]");
    if (ico) ico.className = hex.icon ?? "fa-solid fa-cloud";

    // tint scoped to the weather cell only — never the shift-driven HUD vars
    if (cell) {
      cell.style.setProperty("--glct-weather-tint", e.tintParticle ?? "#cfe8ff");
      cell.style.setProperty("--glct-weather-glow", e.tintGlow ?? "#7fb4e6");
      cell.classList.toggle("ominous", !!e.ominous);
    }

    // Carry the weather tint on the bar so the left-edge scrim/glow can pick it up
    // (scoped var — never the shift-driven HUD colour).
    if (bar) {
      bar.style.setProperty("--glct-weather-tint", e.tintParticle ?? "#cfe8ff");
      bar.style.setProperty("--glct-weather-glow", e.tintGlow ?? "#7fb4e6");
      bar.classList.toggle("wx-ominous", !!e.ominous);
    }

    // full-bar diorama + the legibility scrim behind the left text. The diorama
    // keeps animating whether the bar is full or collapsed — when compact, the live
    // particle field plays behind the pill (re-seeded to the smaller area by resize)
    // so the current weather reads at a glance with its glass-edge refraction. Only
    // a backgrounded tab fully drops it (decision D4).
    if (host) {
      if (document.hidden) {
        host.classList.add("off");
        scrim?.classList.add("off");
        this._wx?.pause();          // nothing visible to paint while backgrounded
      } else {
        host.classList.remove("off");
        scrim?.classList.remove("off");
        bar?.classList.add("has-wx");
        if (!this._wx) this._wx = WeatherEffect.create(host, e);
        else this._wx.setSpec(e);
        this._wx?.resize();
        this._wx?.resume();   // keep the field animating in full and compact modes
      }
    }
  }

  async _onOpenWeather() {
    const { WeatherHud } = await import("./weather-hud.js");
    await WeatherHud.open();
  }

  /* ------------------------------ delving ------------------------------ */

  _mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  /** Wire the (static) delving controls once. Handlers read the live featured id
   *  at click time so re-featuring never leaves a stale binding. */
  _activateDelving() {
    const root = this.element;
    const featId = () => DelvingStore.data.featuredId;
    const dice = root.querySelector("[data-dxdice]");
    if (dice) {
      dice.addEventListener("click", ev => { ev.stopPropagation(); if (game.user.isGM) DelvingStore.editDice(featId(), +1); });
      dice.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); if (game.user.isGM) DelvingStore.editDice(featId(), -1); });
    }
    root.querySelector("[data-dxstageless]")?.addEventListener("click", ev => { ev.stopPropagation(); if (game.user.isGM) DelvingStore.stepStage(featId(), -1); });
    root.querySelector("[data-dxstagemore]")?.addEventListener("click", ev => { ev.stopPropagation(); if (game.user.isGM) DelvingStore.stepStage(featId(), +1); });
    root.querySelector("[data-dxfeatured]")?.addEventListener("contextmenu", ev => {
      if (!game.user.isGM) return;
      ev.preventDefault();
      this._openDelveMenu(ev, DelvingStore.featured());
    });
    // Right-click the Pass-Turn dock button rewinds a turn (mirrors the step buttons).
    root.querySelector("[data-passbtn]")?.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      if (game.user.isGM) DelvingStore.advanceTurn({ rewind: true });
    });
  }

  /**
   * Repaint the delving readout, the featured-stage diorama, and the dock state.
   * Toggles the `.delving` class that swaps the clock/meter view for the turn +
   * resource view. Players see the stage + atmosphere; GM-only controls are gated
   * by the `.is-gm` class (and the dock, which is GM-only in the template).
   */
  _paintDelving() {
    if (!this.rendered) return;
    const root = this.element;
    const hud = root.querySelector(".hud-root");
    const bar = root.querySelector("[data-bar]");
    const host = root.querySelector("[data-dxbar]");
    const scrim = root.querySelector("[data-dxscrim]");
    const enabled = DelvingStore.enabled;
    const active = enabled && DelvingStore.active;

    hud?.classList.toggle("delve-enabled", enabled);
    hud?.classList.toggle("delving", active);
    hud?.classList.toggle("is-gm", game.user?.isGM ?? false);
    this._updateDelveDock();

    if (!active) {
      host?.classList.add("off");
      scrim?.classList.add("off");
      bar?.classList.remove("has-dx");
      this._dx?.pause();
      this._prevTurn = null;
      return;
    }

    const data = DelvingStore.data;

    // Hold the readout while a fresh roll's card animation is still playing: the
    // turn counter, pool count, stage, chips and atmosphere all keep their current
    // values until the matching card's slot machine finalises (which calls
    // settleDelveRoll), so the bar reveals the outcome only after the dice resolve.
    // A safety timer releases the hold if no card ends up animating on this client.
    // The freshness window and the safety timer both sit above the longest the
    // slot animation can run, so a real card settle always releases the hold first;
    // the safety only fires when no card animates on this client at all.
    const lr = data.lastRoll;
    const freshRoll = lr && (Date.now() - (lr.at || 0) < 9000);
    if (freshRoll && this._seenRollSeq !== lr.seq) {
      if (this._rollSafetySeq !== lr.seq) {
        clearTimeout(this._rollSafety);
        this._rollSafetySeq = lr.seq;
        this._rollSafety = setTimeout(() => GlctHud.settleDelveRoll(lr.seq), 6500);
      }
      return;
    }
    if (lr) this._seenRollSeq = lr.seq;   // acknowledge the current roll state

    const tn = root.querySelector("[data-dxturn]");
    if (tn) {
      tn.textContent = String(data.turnsElapsed);
      if (this._prevTurn !== null && data.turnsElapsed !== this._prevTurn) {
        tn.classList.remove("tick"); void tn.offsetWidth; tn.classList.add("tick");
      }
    }
    this._prevTurn = data.turnsElapsed;
    this._setText("[data-dxturnlbl]", DelvingStore.turn.label);

    const feat = DelvingStore.featured(data);
    const stage = feat?.stages?.[feat.stageIndex] ?? null;
    const fx = stage?.effect ?? null;
    const ended = feat ? DelvingStore.isEnded(feat) : false;
    // The end of the line gets its own, intensified "terminal" atmosphere rather
    // than just lingering the final stage's effect.
    const efx = ended ? DelvingStore.terminalEffect(feat) : fx;
    const cell = root.querySelector("[data-delvingcell]");

    if (feat && stage) {
      // The depleted end shows the resource's own terminal name (configured
      // endName, else the final-stage name), presented as a distinct terminal
      // state: a skull, a crossed-out count, and the intensified diorama below.
      this._setText("[data-dxstage]", ended ? DelvingStore.terminalName(feat) : (stage.name ?? ""));
      const ico = root.querySelector("[data-dxicon]");
      if (ico) ico.className = ended ? "fa-solid fa-skull" : (feat.icon || "fa-solid fa-hourglass-half");
      if (ended) { this._setText("[data-dxcur]", "✕"); this._setText("[data-dxsize]", ""); }
      else { this._setText("[data-dxcur]", String(feat.current)); this._setText("[data-dxsize]", "d" + (stage.size ?? 6)); }
      root.querySelector("[data-dxfeatured] .dx-stagebadge")?.classList.toggle("ended", ended);
      // Stage name + atmosphere are always public, but the dice count is gated by
      // the resource's player-visibility flag (a hidden "corruption" featured by
      // the GM still sets the mood without leaking the number to players).
      const hideCount = !(game.user?.isGM ?? false) && feat.visibleToPlayers === false;
      const dice = root.querySelector("[data-dxdice]");
      if (dice) { dice.style.display = hideCount ? "none" : ""; dice.classList.toggle("empty", feat.current <= 0 && !ended); dice.classList.toggle("ended", ended); }
      if (cell && efx) {
        cell.style.setProperty("--dxtint", efx.tintParticle ?? "#ff9a3c");
        cell.style.setProperty("--dxglow", efx.tintGlow ?? "#ffd27a");
        cell.classList.toggle("ominous", !!efx.ominous);
        cell.classList.toggle("terminal", ended);
        // dread intensifies as the resource degrades toward its worst stage; the
        // ended state pins it past the worst.
        const frac = feat.stages.length > 1 ? feat.stageIndex / (feat.stages.length - 1) : 0;
        cell.style.setProperty("--dxstage", ended ? "1.000" : frac.toFixed(3));
      }
      root.querySelector("[data-dxstageless]")?.toggleAttribute("disabled", feat.stageIndex <= 0);
      root.querySelector("[data-dxstagemore]")?.toggleAttribute("disabled", feat.stageIndex >= feat.stages.length - 1);
    }

    this._buildDelveChips(data, feat);

    if (host) {
      if (document.hidden || !efx) { host.classList.add("off"); scrim?.classList.add("off"); bar?.classList.remove("has-dx"); bar?.classList.remove("dx-terminal"); this._dx?.pause(); }
      else {
        host.classList.remove("off");
        scrim?.classList.remove("off");
        bar?.classList.add("has-dx");
        if (!this._dx) this._dx = WeatherEffect.create(host, efx); else this._dx.setSpec(efx);
        this._dx?.resize(); this._dx?.resume();
        if (bar) {
          // delve-scoped vars so the right-edge wash never clobbers weather's
          // left-edge tint (both can be live at once).
          bar.style.setProperty("--glct-delve-tint", efx.tintParticle ?? "#ff9a3c");
          bar.style.setProperty("--glct-delve-glow", efx.tintGlow ?? "#ffd27a");
          bar.classList.toggle("dx-ominous", !!efx.ominous);
          // the depleted end cranks the liquid-glass edge refraction + glow
          bar.classList.toggle("dx-terminal", ended);
        }
      }
    }
  }

  /** Compact chips for the non-featured resources the viewer may see. */
  _buildDelveChips(data, feat) {
    const host = this.element.querySelector("[data-dxchips]");
    if (!host) return;
    const list = DelvingStore.visibleResources(data).filter(r => r.id !== feat?.id);
    host.replaceChildren(...list.map(r => {
      const stage = r.stages?.[r.stageIndex] ?? {};
      const fx = stage.effect ?? {};
      const chip = this._mk("button", "dx-chip" + (fx.ominous ? " ominous" : ""));
      chip.type = "button";
      chip.dataset.id = r.id;
      chip.style.setProperty("--dxtint", fx.tintParticle ?? "#9aa3b0");
      chip.style.setProperty("--dxglow", fx.tintGlow ?? "#9aa3b0");
      chip.title = `${r.name ?? ""} · ${stage.name ?? ""}`;
      chip.append(this._mk("i", r.icon || "fa-solid fa-hourglass-half"), this._mk("b", null, String(r.current)));
      chip.addEventListener("click", ev => { ev.stopPropagation(); if (game.user.isGM) DelvingStore.setFeatured(r.id); });
      chip.addEventListener("contextmenu", ev => { ev.preventDefault(); if (game.user.isGM) this._openDelveMenu(ev, r); });
      return chip;
    }));
  }

  _updateDelveDock() {
    const root = this.element;
    const active = DelvingStore.active;
    root.querySelector("[data-delvebtn]")?.classList.toggle("on", active);
    this._setText("[data-delvetext]", game.i18n.localize(active ? "GLCT.delving.controls.exit" : "GLCT.delving.controls.enter"));
    this._setText("[data-passlbl]", game.i18n.format("GLCT.delving.controls.pass", { label: DelvingStore.turn.label }));
  }

  /* ---- delving resource context menu (GM) ---- */

  _delveMenuItems(r) {
    const L = k => game.i18n.localize(k);
    const items = [];
    if (r.id !== DelvingStore.data.featuredId) items.push({ icon: "fa-star", label: L("GLCT.delving.ctx.feature"), run: () => DelvingStore.setFeatured(r.id) });
    items.push({ icon: "fa-dice", label: L("GLCT.delving.ctx.roll"), run: () => DelvingStore.rollResource(r.id) });
    items.push({ icon: "fa-arrows-rotate", label: L("GLCT.delving.ctx.refill"), run: () => DelvingStore.refill(r.id) });
    items.push({ icon: "fa-angles-down", label: L("GLCT.delving.ctx.nextStage"), run: () => DelvingStore.stepStage(r.id, +1) });
    items.push({ icon: "fa-angles-up", label: L("GLCT.delving.ctx.prevStage"), run: () => DelvingStore.stepStage(r.id, -1) });
    items.push({ sep: true });
    items.push({ icon: r.visibleToPlayers ? "fa-eye-slash" : "fa-eye", label: L(r.visibleToPlayers ? "GLCT.delving.ctx.hide" : "GLCT.delving.ctx.show"), run: () => DelvingStore.setVisibility(r.id, !r.visibleToPlayers) });
    items.push({ icon: "fa-gear", label: L("GLCT.delving.ctx.edit"), run: () => this._onOpenDelving() });
    return items;
  }

  _openDelveMenu(ev, r) {
    if (!r || !game.user.isGM) return;
    this._closeDelveMenu();
    const menu = this._mk("div", "glct trk-ctx glct-delve-ctx");
    for (const it of this._delveMenuItems(r)) {
      if (it.sep) { menu.appendChild(this._mk("div", "ctx-sep")); continue; }
      const b = this._mk("button", "ctx-item" + (it.danger ? " danger" : ""));
      b.appendChild(this._mk("i", "fa-solid " + it.icon));
      b.appendChild(this._mk("span", null, it.label));
      b.addEventListener("click", e => { e.stopPropagation(); this._closeDelveMenu(); it.run(); });
      menu.appendChild(b);
    }
    menu.style.position = "fixed";
    menu.style.zIndex = "100";
    menu.style.visibility = "hidden";
    document.body.appendChild(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${Math.max(6, Math.min(ev.clientX, window.innerWidth - mw - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(ev.clientY, window.innerHeight - mh - 6))}px`;
    menu.style.visibility = "";
    requestAnimationFrame(() => menu.classList.add("show"));
    this._delveCtx = menu;

    const onDown = e => { if (!menu.contains(e.target)) this._closeDelveMenu(); };
    const onKey = e => { if (e.key === "Escape") { e.preventDefault(); this._closeDelveMenu(); } };
    setTimeout(() => {
      if (!this._delveCtx) return;
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("contextmenu", onDown, true);
      window.addEventListener("keydown", onKey, true);
    }, 0);
    this._delveCtxOff = () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }

  _closeDelveMenu() {
    this._delveCtxOff?.(); this._delveCtxOff = null;
    this._delveCtx?.remove(); this._delveCtx = null;
  }

  async _onPassTurn() { if (!game.user.isGM) return; await DelvingStore.advanceTurn(); }
  async _onRollPool() { if (!game.user.isGM) return; await DelvingStore.rollResource(); }
  async _onToggleDelving() { if (!game.user.isGM) return; await DelvingStore.setActive(!DelvingStore.active); }
  async _onResetDelve() {
    if (!game.user.isGM) return;
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("GLCT.delving.controls.reset") },
      content: `<p>${game.i18n.localize("GLCT.delving.confirmReset")}</p>`
    });
    if (ok) await DelvingStore.resetDelve();
  }
  async _onOpenDelving() {
    if (!game.user.isGM) return;
    const { DelvingEditor } = await import("./delving-editor.js");
    DelvingEditor.show();
  }

  /* --------------------------- DOM construction --------------------------- */

  _buildDynamic() {
    if (this._built) return;
    const root = this.element;

    // stretch meter: 6 hour-groups x 6 pips
    const track = root.querySelector("[data-track]");
    if (track) {
      track.replaceChildren();
      for (let h = 0; h < HOURS_PER_SHIFT; h++) {
        const g = document.createElement("div"); g.className = "hourgrp";
        for (let p = 0; p < STRETCHES_PER_HOUR; p++) {
          const e = document.createElement("div"); e.className = "pip"; g.appendChild(e);
        }
        track.appendChild(g);
      }
    }

    // shift cells: four day-quarter squares; the active one expands and carries
    // the current watch's name inside it (so no separate name line is needed).
    const shiftsRow = root.querySelector("[data-shifts]");
    if (shiftsRow) {
      shiftsRow.replaceChildren();
      for (let i = 0; i < SHIFTS_PER_DAY; i++) {
        const d = document.createElement("span"); d.className = "s";
        d.appendChild(document.createElement("span")).className = "s-name";
        shiftsRow.appendChild(d);
      }
    }

    // dual-ring (inner 4-quadrant shift pie + outer hour-gapped stretch squares)
    const ringHost = root.querySelector("[data-ring]");
    this._ringPies = []; this._ringSqs = [];
    if (ringHost) {
      ringHost.replaceChildren();
      // viewBox is tight to the content (centre 13,13; squares reach r=13) so the
      // ring fills its box with no dead margin. Origin at 0,0 keeps the watch-mode
      // pie's transform-origin unambiguous across browsers.
      const svg = this._svg("svg", { viewBox: "0 0 26 26", width: 44, height: 44, class: "ring" });
      for (let i = 0; i < SHIFTS_PER_DAY; i++) {
        const p = this._svg("path", { d: this._wedge(13, 13, 8, i * 90 - 45, (i + 1) * 90 - 45), class: "pie" });
        svg.appendChild(p); this._ringPies.push(p);
      }
      svg.appendChild(this._svg("circle", { cx: 13, cy: 13, r: 2.3, class: "hub" }));
      const dpu = 360 / 42, off = -90 + dpu;
      for (let i = 0; i < STRETCHES_PER_SHIFT; i++) {
        const ang = off + (i + Math.floor(i / 6)) * dpu;
        const g = this._svg("g", { transform: `translate(13 13) rotate(${ang})` });
        const rect = this._svg("rect", { x: -1.15, y: -13, width: 2.3, height: 3, rx: 0.6, class: "sq" });
        g.appendChild(rect); svg.appendChild(g); this._ringSqs.push(rect);
      }
      ringHost.appendChild(svg);
    }

    // shift-mode hero dial — the dual-ring's 4-quadrant pie grown up, no
    // stretch squares. A pointer rides the rim to mark the active watch (it
    // sweeps along the arc on a watch change; no intra-shift sub-progress).
    const dialHost = root.querySelector("[data-dial]");
    this._dialPies = []; this._dialPtr = null;
    if (dialHost) {
      dialHost.replaceChildren();
      // Sized to read as large as the collapsed-pill watch dial: the pie nearly
      // fills the box (r=18 of the 40-unit viewBox) and the SVG renders at 44px,
      // so the wedge diameter (~40px) matches the compact view's scaled-up ring.
      const svg = this._svg("svg", { viewBox: "0 0 40 40", width: 44, height: 44, class: "ring" });
      for (let i = 0; i < SHIFTS_PER_DAY; i++) {
        const p = this._svg("path", { d: this._wedge(20, 20, 18, i * 90 - 45, (i + 1) * 90 - 45), class: "pie" });
        svg.appendChild(p); this._dialPies.push(p);
      }
      svg.appendChild(this._svg("circle", { cx: 20, cy: 20, r: 3.4, class: "hub" }));
      // pointer = a group rotated about the centre; the bead rides just inside the
      // (now wider) rim at the top — the bisector of watch 0 — so rotating by
      // shift*90° lands it on each watch.
      this._dialPtr = this._svg("g", { class: "dialptr" });
      this._dialPtr.appendChild(this._svg("circle", { cx: 20, cy: 3.6, r: 2.4, class: "marker" }));
      svg.appendChild(this._dialPtr);
      dialHost.appendChild(svg);
      this._dialRot = 0;
    }

    // slot-reel clocks
    this._reels = [...root.querySelectorAll("[data-reelclock]")].map(host => this._buildClock(host));

    // mission countdown reel (up to 3 digits; leading zeros collapse away)
    const missHost = root.querySelector("[data-missreel]");
    this._missReel = missHost ? this._buildMissReel(missHost) : [];

    this._built = true;
  }

  /** Build the mission countdown reel: 3 digit wheels, each a 0-9 strip. */
  _buildMissReel(host) {
    host.replaceChildren();
    const reels = [];
    for (let i = 0; i < 3; i++) {
      const r = document.createElement("span"); r.className = "mreel";
      const s = document.createElement("span"); s.className = "mstrip";
      for (let n = 0; n < 10; n++) { const d = document.createElement("span"); d.textContent = n; s.appendChild(d); }
      r.appendChild(s); host.appendChild(r); reels.push({ reel: r, strip: s });
    }
    return reels;
  }

  /** Show `val` on the mission reel, collapsing leading-zero wheels. */
  _setMissReel(reels, val) {
    const str = String(Math.max(0, Math.min(999, Math.round(val))));
    const lead = reels.length - str.length;
    reels.forEach((o, i) => {
      const pos = i - lead;
      if (pos < 0) { o.reel.classList.add("hide"); o.strip.style.transform = "translateY(0)"; }
      else { o.reel.classList.remove("hide"); o.strip.style.transform = `translateY(-${+str[pos]}em)`; }
    });
  }

  _svg(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  _polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  _wedge(cx, cy, r, a0, a1) {
    const [x0, y0] = this._polar(cx, cy, r, a0), [x1, y1] = this._polar(cx, cy, r, a1);
    const lg = a1 - a0 <= 180 ? 0 : 1;
    return `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${lg} 1 ${x1} ${y1} Z`;
  }

  _buildClock(host) {
    host.replaceChildren();
    const reels = [];
    for (let i = 0; i < 4; i++) {
      if (i === 2) { const c = document.createElement("span"); c.className = "colon"; c.textContent = ":"; host.appendChild(c); }
      const r = document.createElement("span"); r.className = "reel";
      const s = document.createElement("span"); s.className = "strip";
      for (let n = 0; n <= 10; n++) { const d = document.createElement("span"); d.textContent = n % 10; s.appendChild(d); }
      r.appendChild(s); r.dataset.cur = "0"; r.style.setProperty("--rd", `${i * 0.045}s`);
      host.appendChild(r); reels.push(r);
    }
    return { host, reels };
  }

  _setReel(reel, d) {
    const strip = reel.firstChild;
    let cur = +reel.dataset.cur;
    // If a prior forward-wrap left us parked on the duplicate 0 (index 10),
    // collapse to the real 0 and cancel its pending snap before retargeting —
    // otherwise that stale timeout fires mid-tween and resets the digit to 0.
    if (cur === 10) {
      clearTimeout(reel._t);
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      void strip.offsetWidth;
      strip.style.transition = "";
      cur = 0;
      reel.dataset.cur = "0";
    }
    if (d === cur) return;
    const target = (d === 0) ? 10 : d;   // roll forward through the duplicate 0
    strip.style.transform = `translateY(-${target * (100 / 11)}%)`;
    reel.dataset.cur = String(target);
    if (target === 10) {
      clearTimeout(reel._t);
      reel._t = setTimeout(() => {
        strip.style.transition = "none";
        strip.style.transform = "translateY(0)";
        reel.dataset.cur = "0";
        void strip.offsetWidth;
        strip.style.transition = "";
      }, 760);
    }
  }

  _setClock(clockObj, str) {
    const ds = str.replace(":", "").split("").map(Number);
    clockObj.reels.forEach((r, i) => this._setReel(r, ds[i]));
  }

  /* ------------------------------ painting ------------------------------- */

  /**
   * Entry point for all repaints. The UI is painted straight to the current
   * world time in a single pass — however far the GM jumps. The polished
   * motion comes from the CSS transitions on the reels, pips, rings and dial,
   * which glide once to the final values rather than ticking through every
   * intermediate stretch.
   */
  update() {
    if (!this.rendered || !this._built) return;
    const st = TimeEngine.getStateAt(TimeEngine.worldTime);

    // Value flash while compact: when a displayed value actually changes and the
    // bar is collapsed, run the four-beat peek — open the bar (showing the OLD
    // values), pause, animate the reels/pips to the new values, pause, close.
    // _beginPeek owns the paint timing in this case so the value change doesn't
    // ease in while the card is still sliding open; we skip the immediate paint
    // and let the peek schedule it once the bar has finished opening.
    const sig = this._displaySig(st);
    const changed = this._sig !== null && sig !== this._sig;
    this._sig = sig;
    // While glitched the readout is blurred into noise, so a value change has
    // nothing legible to flash — skip the compact peek (which would also pop the
    // bar wider) and just repaint underneath the overlay.
    if (changed && this.collapsed && !this.glitched) { this._beginPeek(); return; }

    // While the compact card is still opening (before its value change has been
    // revealed), hold off painting so the new values don't snap in mid-open; the
    // peek's own scheduled paint catches up to the latest state once it opens.
    if (this._peeking && !this._peekShown) return;

    this._paint(st);
  }

  /** A compact signature of every value shown on the bar/pill, so update() can
      tell a real change from a no-op repaint (a re-render, a resize, etc.). */
  _displaySig(st) {
    const m = st.mission;
    return [
      st.clock, st.shiftIndex, st.stretchInShift,
      st.date.weekday, st.date.day, st.date.monthAbbr, st.date.year,
      m.active, m.reached, m.stretchesLeft
    ].join("|");
  }

  /* ------------------------------ value flash ------------------------------ */

  /**
   * Compact value-flash: expand the collapsed bar so the changed values animate
   * in, then re-collapse. The `collapsed` *setting* is never touched — only the
   * visual classes — so the user's compact preference survives the flash. The
   * bar is centre-anchored, so a width change grows symmetrically about its
   * centre; _clampPeek then nudges the whole HUD inward if the wider bar would
   * spill past a screen edge, and the offset is restored on collapse.
   *
   * The flash plays as four distinct beats rather than letting the open and the
   * value change overlap:
   *   1. open the bar, committing the OLD reel/pip positions so the change has
   *      somewhere to animate FROM;
   *   2. pause for a beat once the open has finished;
   *   3. ease the reels/pips to the NEW values;
   *   4. pause, then collapse back.
   * _beginPeek schedules beats 2–3; _scheduleEndPeek handles the final dwell and
   * collapse, and a burst of changes keeps pushing the collapse back so the card
   * flashes once.
   */
  _beginPeek() {
    const root = this.element.querySelector(".hud-root");
    const bar = this.element.querySelector("[data-bar]");
    if (!root || !bar) return;

    // Card already open and the values revealed: ease straight to the newest
    // values and just push the collapse back.
    if (this._peeking && this._peekShown) {
      this._paint(TimeEngine.getStateAt(TimeEngine.worldTime));
      this._scheduleEndPeek();
      return;
    }
    // Still sliding open: the pending reveal (beat 3) grabs the freshest state,
    // so there's nothing to do but let the open finish.
    if (this._peeking) return;

    this._peeking = true;
    this._peekShown = false;

    // Beat 1 — open the card. Measure the collapsed width, reveal the full card,
    // measure the expanded width, then tween between the two explicit values (the
    // .bar CSS width transition eases it) — auto→auto can't animate on its own.
    const w0 = bar.getBoundingClientRect().width;
    bar.classList.remove("collapsed");
    root.classList.remove("is-collapsed");
    bar.classList.add("peeking");
    const w1 = bar.getBoundingClientRect().width;   // forces layout → commits old reels
    this._clampPeek();                              // keep the wider bar on-screen
    bar.style.transition = "none";
    bar.style.width = `${w0}px`;
    void bar.offsetWidth;
    bar.style.transition = "";
    bar.style.width = `${w1}px`;
    clearTimeout(this._barT);
    this._barT = setTimeout(() => { bar.style.width = ""; this._wx?.resize(); }, PEEK_OPEN);
    this._paintWeather();   // wake + resize the diorama for the expanded width

    // Beats 2–3 — wait for the open to finish, hold a beat, THEN ease the
    // reels/pips to the new values so the change reads as its own distinct step.
    clearTimeout(this._peekShowT);
    this._peekShowT = setTimeout(() => {
      this._peekShown = true;
      this._paint(TimeEngine.getStateAt(TimeEngine.worldTime));
      this._scheduleEndPeek();
    }, PEEK_OPEN + PEEK_PAUSE);
  }

  /**
   * Beat 4 — once the value change has been painted, hold it long enough for the
   * reel/pip ease to settle plus a final beat, then collapse. Rescheduled on each
   * fresh change so a burst flashes once rather than flickering shut between updates.
   */
  _scheduleEndPeek() {
    clearTimeout(this._peekEndT);
    this._peekEndT = setTimeout(() => this._endPeek(), PEEK_VALUE + PEEK_PAUSE);
  }

  /**
   * Collapse the bar after a value flash and glide the clamped offset back. The
   * shrink mirrors _beginPeek: measure the expanded width, peek the collapsed
   * width, then tween between them so the card eases shut instead of snapping;
   * the `collapsed` classes are re-applied only once the shrink completes.
   */
  _endPeek() {
    clearTimeout(this._peekEndT); this._peekEndT = null;
    clearTimeout(this._peekShowT); this._peekShowT = null;
    if (!this._peeking) return;
    this._peeking = false;
    this._peekShown = false;
    const root = this.element.querySelector(".hud-root");
    const bar = this.element.querySelector("[data-bar]");
    this._restorePeek();   // glide the HUD back to centre

    if (!bar || !root || !this.collapsed) {
      bar?.classList.remove("peeking");
      if (bar) bar.style.width = "";
      this._paintWeather();
      return;
    }

    const w1 = bar.getBoundingClientRect().width;
    bar.classList.add("collapsed"); root.classList.add("is-collapsed");
    const w0 = bar.getBoundingClientRect().width;     // collapsed (pill) width
    bar.classList.remove("collapsed"); root.classList.remove("is-collapsed");
    bar.style.transition = "none";
    bar.style.width = `${w1}px`;
    void bar.offsetWidth;
    bar.style.transition = "";
    bar.style.width = `${w0}px`;
    clearTimeout(this._barT);
    this._barT = setTimeout(() => {
      bar.classList.add("collapsed"); root.classList.add("is-collapsed");
      bar.classList.remove("peeking");
      bar.style.width = "";
      this._paintWeather();   // freeze the compact diorama again
    }, PEEK_OPEN);
  }

  /**
   * Shift the (centre-anchored) HUD inward if the currently-laid-out bar pokes
   * past a viewport edge, so the expanded card never clips off-screen. Stored as
   * an extra translate on top of the -50% centring; restored in _restorePeek.
   */
  _clampPeek() {
    const el = this.element;
    const bar = el.querySelector("[data-bar]");
    if (!bar) return;
    this._peekStyle = { transform: el.style.transform, transition: el.style.transition };
    const m = 6;   // viewport margin
    const r = bar.getBoundingClientRect();
    let shift = 0;
    if (r.left < m) shift = m - r.left;
    else if (r.right > window.innerWidth - m) shift = (window.innerWidth - m) - r.right;
    el.style.transition = "transform .42s cubic-bezier(.4,0,.2,1)";
    el.style.transform = shift ? `translateX(calc(-50% + ${Math.round(shift)}px))` : "translateX(-50%)";
  }

  _restorePeek() {
    const el = this.element;
    const prev = this._peekStyle?.transition || "";
    // glide the clamp offset back to the centre, then drop the temporary
    // transform-transition so it never lags a later drag / reposition.
    el.style.transition = "transform .42s cubic-bezier(.4,0,.2,1)";
    el.style.transform = this._peekStyle?.transform || "translateX(-50%)";
    clearTimeout(this._peekTransT);
    this._peekTransT = setTimeout(() => { el.style.transition = prev; }, 440);
    this._peekStyle = null;
  }

  _paint(st) {
    const root = this.element;
    const sm = this.shiftMode;

    // Mission countdown changes how the stretch meter reads (see CSS .mission).
    root.querySelector(".hud-root")?.classList.toggle("mission", st.mission.active);

    // per-shift theming — suppressed while glitched, where _setGlitchPalette pins
    // a cold "lost signal" palette so the watch colour can't betray the time of day.
    if (!this.glitched) {
      root.style.setProperty("--tint", st.watch.tint);
      root.style.setProperty("--tint2", st.watch.tint2);
      root.style.setProperty("--glow", st.watch.glow);
      root.style.setProperty("--glowsoft", st.watch.soft);
    }

    // light sweep on shift change
    if (this._prevShift !== null && st.shiftIndex !== this._prevShift) {
      const bar = root.querySelector("[data-bar]");
      if (bar) { bar.classList.remove("swept"); void bar.offsetWidth; bar.classList.add("swept"); }
    }
    this._prevShift = st.shiftIndex;

    // text fields
    this._setText("[data-watch]", st.watch.name);
    this._setText("[data-wd]", st.date.weekday);
    this._setText("[data-dy]", st.date.day);
    this._setText("[data-ord]", st.date.ordinal);
    this._setText("[data-moshort]", st.date.monthAbbr);
    this._setText("[data-mo]", `${st.date.monthName} · ${st.date.year}${st.date.yearLabel ? " " + st.date.yearLabel : ""}`);
    this._setText("[data-pilldate]", `${st.date.weekday} ${st.date.day}${st.date.ordinal} · ${st.date.monthAbbr}`);
    this._setText("[data-season]", st.seasonName);
    this._setText("[data-rem]", this._remText(st));
    this._setText("[data-shiftof]", game.i18n.format("GLCT.hud.watchOf", { n: st.shiftIndex + 1, total: SHIFTS_PER_DAY }));

    // mission dock button reflects whether a countdown is running (+ live count)
    root.querySelector("[data-missionbtn]")?.classList.toggle("on", st.mission.active);
    this._setText("[data-missioncount]", st.mission.active && !st.mission.reached ? String(st.mission.stretchesLeft) : "");

    // shift-mode toggle button reflects the current granularity
    const modeBtn = root.querySelector("[data-modebtn]");
    if (modeBtn) {
      modeBtn.classList.toggle("on", sm);
      this._setText("[data-modetext]", game.i18n.localize(sm ? "GLCT.controls.shiftModeOn" : "GLCT.controls.shiftModeOff"));
    }

    // slot-reel clocks — held at scrambled faces while glitched (see _glitchReels)
    if (!this.glitched) this._reels.forEach(c => this._setClock(c, st.clock));

    // moon phase shadow (present in both the watch cell and the shift-mode hero)
    root.querySelectorAll("[data-moon]").forEach(sh => { sh.style.left = `${(st.moonPhase / 7) * 14 - 7}px`; });

    // shift cells: the active square expands and shows the watch name inside it.
    // CSS can't transition to/from width:auto, so measure the lozenge's natural
    // width and set it explicitly — the .s `width` transition then eases the
    // grow/shrink as the active watch moves along the four squares.
    root.querySelectorAll("[data-shifts] .s").forEach((d, i) => {
      const active = i === st.shiftIndex;
      const nm = d.querySelector(".s-name");
      if (nm) nm.textContent = active ? st.watch.name : "";
      d.classList.toggle("on", active);
      d.classList.toggle("done", i < st.shiftIndex);
      if (active) {
        d.style.setProperty("--fill", `${st.shiftProgress * 100}%`);
        d.style.width = "auto";            // read the natural width...
        const w = d.scrollWidth;
        d.style.width = `${w}px`;          // ...then pin it so the transition animates
      } else {
        d.style.width = "";                // back to the CSS 9px square (transitions too)
      }
    });

    // stretch meter pips
    const m = st.mission;
    let headPip = null;
    root.querySelectorAll(".hourgrp .pip").forEach((p, idx) => {
      const dist = Math.abs(idx - st.stretchInShift);
      p.style.transitionDelay = `${Math.min(dist, 8) * 22}ms`;
      p.classList.toggle("fill", idx < st.stretchInShift);
      const isHead = idx === st.stretchInShift;
      p.classList.toggle("head", isHead);
      if (isHead) headPip = p;

      // Mission mode: highlight the stretches still to go before the target so
      // they can be counted, and flag the target stretch itself. A target beyond
      // this shift (targetStretchInShift > 35) lights every upcoming stretch.
      const upcoming = m.active && !m.reached && idx > st.stretchInShift;
      const inLeft = upcoming && m.targetStretchInShift >= 0 && idx <= m.targetStretchInShift;
      p.classList.toggle("mleft", inLeft);
      p.classList.toggle("mtarget", upcoming && idx === m.targetStretchInShift);
    });
    if (headPip) { headPip.classList.remove("pop"); void headPip.offsetWidth; headPip.classList.add("pop"); }

    // Only the active hour and the hours up to the target stay expanded; fully
    // past hours and hours beyond the target collapse to a single dot, as in
    // normal mode. `mexpand` marks an hour for the thin-rectangle treatment.
    const targetHour = m.targetStretchInShift >= 0 ? Math.floor(m.targetStretchInShift / STRETCHES_PER_HOUR) : -1;
    root.querySelectorAll(".hourgrp").forEach((g, h) => {
      g.classList.toggle("curr", h === st.hourOfShift);
      const expand = m.active && !m.reached && h > st.hourOfShift &&
        (m.targetStretchInShift >= STRETCHES_PER_SHIFT || h <= targetHour);
      g.classList.toggle("mexpand", expand);
    });

    // mission countdown readout (the rich meter-side reel + objective chip)
    const hud = root.querySelector(".hud-root");
    hud?.classList.toggle("mreached", m.active && m.reached);
    hud?.classList.toggle("kind-deadline", m.active && m.kind === "deadline");
    if (m.active) {
      if (!this.glitched) this._setMissReel(this._missReel, m.stretchesLeft);
      const dl = m.kind === "deadline";
      const unitKey = m.reached ? (dl ? "GLCT.hud.missionExpiredShort" : "GLCT.hud.missionReachedShort")
                                : (dl ? "GLCT.hud.missionUnitDeadline" : "GLCT.hud.missionUnit");
      this._setText("[data-missunit]", game.i18n.localize(unitKey));
      this._setText("[data-misslabel]", m.label || "");
      const chip = root.querySelector("[data-misschip]");
      if (chip) chip.style.display = m.label ? "" : "none";
    }

    // dual-ring (collapsed pill); in shift mode, fade past quadrants too
    this._ringPies.forEach((p, i) => {
      p.classList.toggle("on", i === st.shiftIndex);
      p.classList.toggle("done", sm && i < st.shiftIndex);
    });

    // shift-mode hero dial: light the active quadrant, fade the past ones.
    const shiftChanged = this._prevShiftDial !== null && st.shiftIndex !== this._prevShiftDial;
    this._dialPies.forEach((p, i) => {
      const active = i === st.shiftIndex;
      p.classList.toggle("on", active);
      p.classList.toggle("done", i < st.shiftIndex);
      if (active && shiftChanged) { p.classList.remove("lit"); void p.getBoundingClientRect(); p.classList.add("lit"); }
    });
    // sweep the pointer to the active watch's bisector along the shortest arc
    if (this._dialPtr) {
      const base = st.shiftIndex * 90;
      this._dialRot = base + 360 * Math.round((this._dialRot - base) / 360);
      this._dialPtr.style.transformOrigin = "20px 20px";
      this._dialPtr.style.transform = `rotate(${this._dialRot}deg)`;
    }
    this._prevShiftDial = st.shiftIndex;

    // GM-only compact time readout in shift mode (players keep the clean view):
    // the exact clock plus a slim stretch-progress bar.
    this._setText("[data-mtclock]", st.clock);
    root.querySelectorAll("[data-mtfill]").forEach(f => { f.style.width = `${st.shiftProgress * 100}%`; });
    this._setText("[data-mtrem]", this._remText(st));

    this._ringSqs.forEach((rect, idx) => {
      const inHour = Math.floor(idx / 6) === st.hourOfShift;
      const passed = idx < st.stretchInShift, head = idx === st.stretchInShift;
      let k = 1, fill = "rgba(255,255,255,.14)", filt = "none";
      if (head) { k = 2.9; fill = "#fff"; filt = "drop-shadow(0 0 3.2px rgba(255,255,255,1))"; }
      else if (inHour) { k = 1.55; fill = passed ? "var(--tint)" : "rgba(255,255,255,.22)"; }
      else if (passed) { k = 1; fill = "var(--tint)"; }
      rect.style.transform = `scaleY(${k})`; rect.style.fill = fill; rect.style.filter = filt;
    });

    // event chips — today's events, any GM-pinned upcoming events, then the
    // single nearest upcoming event. When there's nothing to show, the whole
    // badge is hidden rather than rendering an empty placeholder.
    const wrap = root.querySelector("[data-events]");
    const badge = root.querySelector(".event-badge");
    if (wrap && badge) {
      const ev = st.events ?? {};
      const pinned = ev.pinned ?? [];
      const chips = [];
      for (const t of ev.today ?? [])
        chips.push({ cls: "today", txt: game.i18n.format("GLCT.events.today", { name: t.name }) });
      for (const p of pinned)
        chips.push({ cls: "pinned", txt: game.i18n.format("GLCT.events.next", { name: p.name, days: p.days }) });
      // the nearest upcoming event, unless it's already shown as a pinned chip
      if (ev.next && !pinned.some(p => p.name === ev.next.name && p.days === ev.next.days))
        chips.push({ cls: "", txt: game.i18n.format("GLCT.events.next", { name: ev.next.name, days: ev.next.days }) });

      badge.classList.toggle("empty", chips.length === 0);
      wrap.replaceChildren(...chips.map(c => {
        const chip = document.createElement("span");
        chip.className = `event${c.cls ? " " + c.cls : ""}`;
        const dot = document.createElement("span");
        dot.className = "dot";
        const txt = document.createElement("span");
        txt.textContent = c.txt;
        chip.append(dot, txt);
        return chip;
      }));
    }

    Hooks.callAll(`${MODULE_ID}.timeChanged`, st);
  }

  _setText(sel, txt) {
    this.element.querySelectorAll(sel).forEach(e => { e.textContent = txt; });
  }

  /**
   * The "stretches remaining" caption. Normally counts to the end of the current
   * shift; when a mission is running it counts down to the pinned target (and
   * appends the mission's label, if any) or announces it once reached.
   */
  _remText(st) {
    const m = st.mission;
    if (!m.active) return game.i18n.format("GLCT.hud.stretchesLeft", { n: st.stretchesLeftInShift });
    if (m.reached) return game.i18n.localize(m.kind === "deadline" ? "GLCT.hud.missionExpired" : "GLCT.hud.missionReached");
    const base = game.i18n.format("GLCT.hud.missionLeft", { n: m.stretchesLeft });
    return m.label ? `${base} · ${m.label}` : base;
  }

  /* ---------------------------- interactions ----------------------------- */

  _activateInteractions() {
    const root = this.element;
    // right-click any step button to rewind that step
    root.querySelectorAll('.c[data-action="advance"]').forEach(c => {
      c.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        TimeEngine.advanceStep(c.dataset.step, { rewind: true });
        c.classList.add("rw"); setTimeout(() => c.classList.remove("rw"), 420);
      });
    });
    // Keyboard activation for non-<button> controls marked role="button" (the
    // event badge). Real <button>s fire click on Enter/Space natively and need
    // nothing here; this re-dispatches a click so their data-action handler runs.
    root.querySelectorAll('[role="button"]').forEach(el =>
      el.addEventListener("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); el.click(); }
      })
    );
    // drag to reposition via the grip
    const grip = root.querySelector(".grip");
    if (grip) grip.addEventListener("pointerdown", this._onDragStart.bind(this));
    // double-click the grip or the collapsed pill to switch standard <-> compact
    root.querySelectorAll(".grip, .pill").forEach(el =>
      el.addEventListener("dblclick", ev => { ev.preventDefault(); this._onToggleCollapse(); })
    );
  }

  /**
   * Anchor the HUD by its horizontal centre, never its left edge: `left` holds
   * the centre-x and `translateX(-50%)` recentres the element. This way any
   * width change (e.g. switching watch display mode) grows/shrinks symmetrically
   * about the same point, so a GM-placed HUD stays put instead of drifting.
   */
  _applyPosition() {
    const el = this.element;
    el.style.position = "fixed";
    el.style.zIndex = "70";
    el.style.transform = "translateX(-50%)";
    let pos = {};
    try { pos = game.settings.get(MODULE_ID, SETTINGS.hudPosition) ?? {}; } catch { /* ignore */ }
    // Prefer a saved centre-x; migrate legacy {left} (top-left corner) on the fly.
    let cx = Number.isFinite(pos.cx) ? pos.cx
      : Number.isFinite(pos.left) ? pos.left + el.getBoundingClientRect().width / 2
      : null;
    if (Number.isFinite(cx) && Number.isFinite(pos.top)) {
      el.style.left = `${cx}px`; el.style.top = `${pos.top}px`;
      this._clampToViewport();   // a saved position may be off-screen on a smaller window
    } else {
      el.style.left = "50%"; el.style.top = "6px";
    }
  }

  /**
   * Keep the bar fully on-screen. The HUD is centre-anchored (`left` holds the
   * centre-x, `translateX(-50%)` recentres it), so we bound the centre by half
   * the width. Used after restoring a saved position, on every drag frame, and
   * on viewport resize, so the HUD can never be stranded past a window edge.
   */
  _clampToViewport() {
    const el = this.element;
    if (!el) return;
    // Only act on a px-anchored HUD; the default "50%" centring is fluid and
    // already safe, so we leave it untouched (and never freeze it to pixels).
    if (!el.style.left.endsWith("px")) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const m = 6, hw = r.width / 2;
    const minCx = m + hw, maxCx = window.innerWidth - m - hw;
    let cx = r.left + hw;
    // If the bar is wider than the viewport, centre it rather than over-clamp.
    cx = minCx > maxCx ? window.innerWidth / 2 : Math.min(Math.max(cx, minCx), maxCx);
    const top = Math.min(Math.max(r.top, m), Math.max(m, window.innerHeight - m - r.height));
    el.style.left = `${Math.round(cx)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  /** Re-clamp on window resize so a shrinking viewport can't strand the HUD. */
  _wireViewportClamp() {
    this._onViewportResize ??= () => {
      if (this._resizeRAF) return;
      this._resizeRAF = requestAnimationFrame(() => {
        this._resizeRAF = null;
        if (this.rendered) this._applyPosition();
      });
    };
    window.removeEventListener("resize", this._onViewportResize);
    window.addEventListener("resize", this._onViewportResize);
  }

  _onDragStart(ev) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const el = this.element;
    const rect = el.getBoundingClientRect();
    // Drag (and store) by the centre, matching how the HUD is anchored, so the
    // placement survives later width changes (watch-mode swaps, collapse, etc).
    const ox = ev.clientX - (rect.left + rect.width / 2), oy = ev.clientY - rect.top;
    const start = { x: ev.clientX, y: ev.clientY };
    let moved = false;
    const move = e => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
        moved = true; el.style.transform = "translateX(-50%)";
      }
      if (moved) {
        el.style.left = `${e.clientX - ox}px`; el.style.top = `${e.clientY - oy}px`;
        this._clampToViewport();   // never let a drag carry the HUD off-screen
      }
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;   // a click, not a drag — collapse is double-click now
      const r = el.getBoundingClientRect();
      try { await game.settings.set(MODULE_ID, SETTINGS.hudPosition, { cx: Math.round(r.left + r.width / 2), top: Math.round(r.top) }); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* --------------------------- action handlers --------------------------- */

  async _onAdvance(ev, target) {
    if (!game.user.isGM) return;
    await TimeEngine.advanceStep(target.dataset.step);
  }
  async _onNextShift() {
    if (!game.user.isGM) return;
    await TimeEngine.nextShift();
  }
  async _onToggleCollapse() {
    // A manual toggle wins over any in-flight value flash: cancel the peek and
    // drop its temporary classes/offset before applying the new collapsed state.
    clearTimeout(this._peekEndT); this._peekEndT = null;
    clearTimeout(this._barT); this._barT = null;
    const wasPeeking = this._peeking;
    this._peeking = false;
    const bar = this.element.querySelector("[data-bar]");
    bar?.classList.remove("peeking");
    if (bar) bar.style.width = "";
    if (wasPeeking) this._restorePeek();

    const next = !this.collapsed;
    try { await game.settings.set(MODULE_ID, SETTINGS.hudCollapsed, next); } catch { /* ignore */ }
    bar?.classList.toggle("collapsed", next);
    this.element.querySelector(".hud-root")?.classList.toggle("is-collapsed", next);
    this._paintWeather();   // freeze the compact diorama / wake it when expanded
    // The width changed — re-fit once the bar's width transition settles so an
    // expand near a screen edge can't push the HUD off it.
    clearTimeout(this._clampT);
    this._clampT = setTimeout(() => this._clampToViewport(), 460);
  }
  async _onSetTime() {
    if (!game.user.isGM) return;
    const { SetTimeDialog } = await import("./set-time-dialog.js");
    SetTimeDialog.show();
  }
  async _onOpenMission() {
    if (!game.user.isGM || !Features.on("timeHud.mission")) return;
    const { MissionDialog } = await import("./mission-dialog.js");
    MissionDialog.show();
  }
  async _onToggleShiftMode() {
    if (!game.user.isGM || !Features.on("timeHud.shiftMode")) return;
    try { await game.settings.set(MODULE_ID, SETTINGS.shiftLevelMode, !this.shiftMode); } catch { /* ignore */ }
  }

  /* ----------------------- temporal distortion (glitch) ----------------------- */

  async _onToggleGlitch() {
    if (!game.user.isGM) return;
    try { await game.settings.set(MODULE_ID, SETTINGS.hudGlitch, !this.glitched); } catch { /* ignore */ }
  }

  /**
   * Engage or lift the glitch on the live DOM (no re-render). The real readout
   * text is never overwritten — it stays in the DOM (CSS renders it transparent)
   * so the bar keeps its true, stable width and NEVER jitters. The scramble is
   * shown by an absolutely-positioned ::after (content:attr(data-glitch)), which
   * can't affect layout, refreshed once a second; the digit reels scramble too.
   * Engaging also pins the cold "lost-signal" palette and parks the dioramas;
   * lifting clears the scramble attrs and repaints the truth.
   */
  _applyGlitch() {
    if (!this.rendered || !this._built) return;
    const on = this.glitched;
    const root = this.element.querySelector(".hud-root");
    const was = root?.classList.contains("glitched") ?? false;
    root?.classList.toggle("glitched", on);
    this.element.querySelector("[data-glitchbtn]")?.classList.toggle("on", on);

    clearInterval(this._glitchT); this._glitchT = null;
    if (on) {
      this._setGlitchPalette();
      // the static field subsumes the whole background — park the live weather and
      // delving dioramas (CSS hides them too) so only the distortion shows.
      this._wx?.pause(); this._dx?.pause();
      this._corrupt();   // scramble once immediately
      // Re-scramble at 1 Hz — a slow, deliberate churn, not a strobe. Under
      // reduced-motion we set it once and leave it static (the readout is still
      // illegible — the real text is transparent and the scramble is frozen).
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (!reduce) this._glitchT = setInterval(() => { if (this.rendered) this._corrupt(); }, 1000);
    } else if (was) {
      // lifting the distortion — drop the scramble attrs, repaint the truth, wake dioramas.
      this.element.querySelectorAll("[data-glitch]").forEach(el => { delete el.dataset.glitch; });
      this._paint(TimeEngine.getStateAt(TimeEngine.worldTime));
      this._paintWeather();
      this._paintDelving();
    }
  }

  /** Pin a cold, unstable "signal lost" palette while glitched (the per-shift
   *  theming is suppressed in _paint so this isn't overwritten on the next paint). */
  _setGlitchPalette() {
    const el = this.element;
    el.style.setProperty("--tint", "#7bf0ff");
    el.style.setProperty("--tint2", "#0a0d16");
    el.style.setProperty("--glow", "rgba(123,240,255,.5)");
    el.style.setProperty("--glowsoft", "rgba(176,128,255,.24)");
  }

  /** Glyph pool — letters + digits + technical punctuation, so the readout reads
   *  as scrambling characters rather than pure symbols. */
  static GLITCH_GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&?!/\\=<>*+";

  /** A narrower pool for the clock/mission reels (each reel box is ~.62em wide) so
   *  the scrambled "digits" stay tidy: digits + thin symbols. */
  static GLITCH_REEL_GLYPHS = "0123456789#?/*-=:%";

  /** Same-length scramble, preserving spacing glyphs (space · : / .) so each field
   *  keeps the silhouette of the value it's hiding. */
  _scramble(str) {
    const g = GlctHud.GLITCH_GLYPHS;
    let out = "";
    for (const ch of String(str ?? "")) {
      out += " ·:/.".includes(ch) ? ch : g[(Math.random() * g.length) | 0];
    }
    return out;
  }

  /** Every visible readout that names the when/where/weather. The scramble is
   *  written to each node's data-glitch attribute (shown by a CSS ::after); the
   *  real text underneath is untouched, so widths never change. */
  static GLITCH_NODES = "[data-watch],[data-wd],[data-dy],[data-ord],[data-moshort],[data-mo]," +
    "[data-pilldate],[data-season],[data-rem],[data-shiftof],[data-mtclock],[data-mtrem]," +
    "[data-misslabel],[data-missunit],[data-wxlabel],[data-wxtemp]," +
    "[data-dxstage],[data-dxturn],[data-dxturnlbl],[data-dxcur],[data-dxsize]";

  /** Refresh the scramble: a corrupted string into every readout's data-glitch
   *  attribute (read from the live real text so the length tracks the value), plus
   *  random faces on the digit reels. Nothing here mutates layout. */
  _corrupt() {
    this.element.querySelectorAll(GlctHud.GLITCH_NODES)
      .forEach(el => { el.dataset.glitch = this._scramble(el.textContent); });
    this._glitchReels();
  }

  /** Scramble the clock + mission reels as characters (no slot-machine spin): each
   *  reel's digit strip is hidden by CSS and a corrupted glyph is shown via the same
   *  ::after content:attr(data-glitch). Fixed-width reel boxes → layout-free. The
   *  real time is held off by a guard in _paint. */
  _glitchReels() {
    const g = GlctHud.GLITCH_REEL_GLYPHS;
    const rc = () => g[(Math.random() * g.length) | 0];
    for (const c of this._reels)
      for (const reel of c.reels) reel.dataset.glitch = rc();
    for (const o of this._missReel) { o.reel.classList.remove("hide"); o.reel.dataset.glitch = rc(); }
  }

  /**
   * Flip shift/watch mode on the live DOM (the hero, clock and meter are all
   * already present — only their CSS visibility differs), so the swap animates
   * instead of snapping through a re-render. A light sweep masks the change and
   * the appearing side plays an entrance.
   */
  _applyShiftMode() {
    if (!this.rendered || !this._built) return;
    const root = this.element.querySelector(".hud-root");
    const bar = this.element.querySelector("[data-bar]");
    if (!root) return;

    // Tween the bar's width across the layout change. CSS can't animate to/from
    // an auto width, so measure the old width, flip the mode to learn the new
    // natural width, then transition between the two explicit values (the .bar's
    // `width` transition in CSS does the easing) before releasing back to auto.
    // The HUD is centre-anchored, so this grows/shrinks about the same point.
    const w0 = bar?.getBoundingClientRect().width ?? 0;
    root.classList.toggle("shift-mode", this.shiftMode);
    if (bar) {
      bar.style.width = "auto";
      const w1 = bar.getBoundingClientRect().width;
      bar.style.transition = "none";
      bar.style.width = `${w0}px`;
      void bar.offsetWidth;            // commit the start width with no transition
      bar.style.transition = "";       // restore the stylesheet's width easing
      bar.style.width = `${w1}px`;
      clearTimeout(this._barT);
      this._barT = setTimeout(() => { bar.style.width = ""; this._clampToViewport(); }, 420);
    }

    if (bar) { bar.classList.remove("swept"); void bar.offsetWidth; bar.classList.add("swept"); }
    root.classList.remove("mode-swap"); void root.offsetWidth; root.classList.add("mode-swap");
    setTimeout(() => root.classList.remove("mode-swap"), 650);
    this.update();
    // the bar's width changed — re-fit the full-bar diorama once it settles
    setTimeout(() => this._wx?.resize(), 460);
  }
  async _onOpenCalendar() {
    if (!Features.on("timeHud.calendar")) return;
    const { CalendarView } = await import("./calendar-view.js");
    CalendarView.show();
  }
}
