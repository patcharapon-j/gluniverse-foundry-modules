/**
 * WeatherHud — the dedicated Hex Flower window (decision #5, #16). A frameless,
 * draggable ApplicationV2 modeled on TrackerHud. It renders the 19-hex flower
 * with the current cell glowing, animates the marker hex-to-hex on each step,
 * shows a player-visible history strip, and gathers the GM controls.
 *
 * Players get a read-only view: the full flower only when
 * `weatherPlayerFlowerVisible` is on, otherwise just the current condition +
 * history (the current weather is always visible).
 */

import { MODULE_ID, SETTINGS, WEATHER_DIRECTIONS } from "../const.js";
import { HEX_LAYOUT, HEX_BOUNDS } from "../weather/hex-geometry.js";
import { WeatherStore } from "../weather/weather-store.js";
import { WeatherEngine } from "../weather/engine.js";
import { WeatherEffect } from "../weather/effects.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const R = 26;                              // hex "radius" in px (centre→vertex)
const TILE_W = 2 * R;
const TILE_H = Math.sqrt(3) * R;
const MARGIN = 10;

export class WeatherHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async open() {
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    try { await game.settings.set(MODULE_ID, SETTINGS.weatherHudHidden, false); } catch { /* ignore */ }
    return this.instance;
  }

  static async toggle() {
    if (this.instance?.rendered) return this.instance._close();
    return this.open();
  }

  /** Repaint from current weather state (no full re-render unless flower shape changed). */
  static refresh() { this.instance?.update(); }

  static DEFAULT_OPTIONS = {
    id: "glct-weather-hud",
    classes: ["glct"],
    tag: "div",
    window: { frame: false, positioned: false, minimizable: false, resizable: false },
    actions: {
      rollNow: WeatherHud.prototype._onRollNow,
      reset: WeatherHud.prototype._onReset,
      openEditor: WeatherHud.prototype._onOpenEditor,
      toggleReveal: WeatherHud.prototype._onToggleReveal,
      closeWindow: WeatherHud.prototype._onCloseWindow
    }
  };

  static PARTS = { hud: { template: `modules/${MODULE_ID}/templates/weather-hud.hbs` } };

  _tiles = new Map();   // index -> tile element
  _marker = null;
  _nowTag = null;       // "you are here" dot that hops to the current hex
  _sig = null;          // flower-shape signature (rebuild tiles when it changes)
  _regionSig = null;    // region-list signature (rebuild the switcher when it changes)
  _wx = null;           // hero Pixi diorama

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      isGM: game.user?.isGM ?? false,
      seesFlower: WeatherStore.viewerSeesFlower
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._tiles.clear();
    this._sig = null;
    this._regionSig = null;
    this._wx?.destroy(); this._wx = null;   // hero host is recreated on re-render
    this._applyPosition();
    this._wireChrome();
    // Repaints are driven by the `weather` setting's onChange (fires on every
    // client) → WeatherHud.refresh(); no extra hook listener needed here.
    this.update();
  }

  async _onClose(options) {
    this._wx?.destroy(); this._wx = null;
    // Kill the marker's infinite pulse/arrive animations before teardown:
    // ApplicationV2's close awaits in-flight element animations, and an endless
    // keyframe loop never "finishes", so the window would hang for a few seconds
    // until the framework's fallback timeout fired.
    if (this._marker) this._marker.style.animation = "none";
    this.element?.querySelectorAll(".wx-hex,.wx-marker,.wx-cur-ico").forEach(el => { el.style.animation = "none"; el.style.transition = "none"; });
    return super._onClose(options);
  }

  /* ------------------------------ painting ------------------------------ */

  update() {
    if (!this.rendered) return;
    const root = this.element;
    const dock = root.querySelector("[data-dock]");
    const configured = WeatherStore.configured;
    const cur = configured ? WeatherEngine.getCurrent() : null;

    // region switcher first — always available so the GM can swap even when the
    // active region isn't configured yet.
    this._paintRegionBar();

    // empty state (no flower configured)
    const empty = root.querySelector("[data-empty]");
    const hasContent = !!cur?.hex;
    if (empty) empty.hidden = hasContent;
    root.querySelector("[data-current]")?.classList.toggle("hidden", !hasContent);
    root.querySelector("[data-flowerwrap]")?.classList.toggle("hidden", !hasContent);

    const sees = WeatherStore.viewerSeesFlower;
    dock?.classList.toggle("no-flower", !sees);
    this._paintRevealBtn();

    if (!hasContent) return;

    this._paintHero(cur);
    this._paintFlower(cur);
    this._paintForecast(cur);
    this._paintStrip(cur);
  }

  _paintHero(cur) {
    const root = this.element, hex = cur.hex, e = hex.effect ?? {};
    const set = (sel, txt) => { const el = root.querySelector(sel); if (el) el.textContent = txt ?? ""; };
    set("[data-curlabel]", hex.label);
    set("[data-curseason]", cur.seasonName);
    const temp = root.querySelector("[data-curtemp]");
    if (temp) { temp.textContent = hex.temperature ?? ""; temp.style.display = hex.temperature ? "" : "none"; }
    set("[data-curdesc]", hex.description);
    const note = root.querySelector("[data-curnote]");
    if (note) {
      const show = game.user.isGM && hex.effectNote;
      note.textContent = show ? hex.effectNote : "";
      note.style.display = show ? "" : "none";
    }
    const ico = root.querySelector("[data-curicon]");
    if (ico) ico.className = hex.icon ?? "fa-solid fa-cloud";

    const curEl = root.querySelector("[data-current]");
    if (curEl) {
      curEl.style.setProperty("--glct-weather-tint", e.tintParticle ?? "#cfe8ff");
      curEl.style.setProperty("--glct-weather-glow", e.tintGlow ?? "#7fb4e6");
      curEl.classList.toggle("ominous", !!e.ominous);
    }

    // hero Pixi diorama
    const host = root.querySelector("[data-wxstage]");
    if (host) {
      if (!this._wx) this._wx = WeatherEffect.create(host, e);
      else this._wx.setSpec(e);
      if (this._wx) { if (document.hidden) this._wx.pause(); else { this._wx.resize(); this._wx.resume(); } }
    }
  }

  /** Build (once) or repaint the 19 hex tiles, then move the marker to current. */
  _paintFlower(cur) {
    const host = this.element.querySelector("[data-flower]");
    if (!host) return;
    const season = cur.season;
    const sig = this._flowerSig(season);
    if (sig !== this._sig) { this._buildFlower(season); this._sig = sig; }

    // current-cell glow + marker walk
    for (const [i, tile] of this._tiles) tile.classList.toggle("current", i === cur.index);
    // hop the "you are here" dot tag onto the current tile (appendChild moves it)
    const curTile = this._tiles.get(cur.index);
    if (this._nowTag && curTile) curTile.appendChild(this._nowTag);
    const c = this._centerPx(cur.index);
    if (this._marker) {
      this._marker.style.left = `${c.x}px`;
      this._marker.style.top = `${c.y}px`;
      const om = !!cur.hex.effect?.ominous;
      this._marker.classList.toggle("ominous", om);
      this._marker.style.setProperty("--glct-weather-glow", cur.hex.effect?.tintGlow ?? "#7fb4e6");
      // arrival pulse
      this._marker.classList.remove("arrive"); void this._marker.offsetWidth; this._marker.classList.add("arrive");
    }
  }

  _flowerSig(season) {
    const start = WeatherStore.climate()?.startHexIndex ?? "";
    return start + "#" + (season?.hexes ?? []).map(h =>
      `${h.index}:${h.icon}:${h.effect?.tintParticle}:${h.effect?.ominous ? 1 : 0}:${(h.disallow ?? []).join(",")}`).join("|");
  }

  _centerPx(index) {
    const h = HEX_LAYOUT[index];
    const padX = -HEX_BOUNDS.minX * R + TILE_W / 2 + MARGIN;
    const padY = -HEX_BOUNDS.minY * R + TILE_H / 2 + MARGIN;
    return { x: h.center.x * R + padX, y: h.center.y * R + padY };
  }

  _buildFlower(season) {
    const host = this.element.querySelector("[data-flower]");
    host.replaceChildren();
    this._tiles.clear();

    const width = (HEX_BOUNDS.maxX - HEX_BOUNDS.minX) * R + TILE_W + MARGIN * 2;
    const height = (HEX_BOUNDS.maxY - HEX_BOUNDS.minY) * R + TILE_H + MARGIN * 2;
    host.style.width = `${Math.round(width)}px`;
    host.style.height = `${Math.round(height)}px`;

    const isGM = game.user.isGM;
    const startIdx = WeatherStore.climate()?.startHexIndex;
    for (const h of HEX_LAYOUT) {
      const hex = season?.hexes?.[h.index];
      const e = hex?.effect ?? {};
      const c = this._centerPx(h.index);
      const tile = document.createElement("div");
      tile.className = "wx-hex" + (e.ominous ? " ominous" : "") + (h.index === startIdx ? " start" : "");
      tile.dataset.index = String(h.index);
      tile.style.left = `${c.x}px`;
      tile.style.top = `${c.y}px`;
      tile.style.width = `${TILE_W}px`;
      tile.style.height = `${TILE_H}px`;
      tile.style.setProperty("--glct-weather-tint", e.tintParticle ?? "#3a4250");
      tile.style.setProperty("--glct-weather-glow", e.tintGlow ?? "#7fb4e6");
      tile.title = `${hex?.label ?? ""}${hex?.temperature ? " · " + hex.temperature : ""}`;
      const ic = document.createElement("i");
      ic.className = hex?.icon ?? "fa-solid fa-cloud";
      tile.appendChild(ic);
      // green flag tag marks the start hex (where the walk begins)
      if (h.index === startIdx) {
        tile.appendChild(Object.assign(document.createElement("span"), {
          className: "wx-tag wx-tag-start", innerHTML: '<i class="fa-solid fa-flag"></i>',
          title: game.i18n.localize("GLCT.weather.editor.startHex")
        }));
      }
      // a red ✕ on each blocked face so disallowed directions are obvious
      for (const dir of hex?.disallow ?? []) {
        if (!WEATHER_DIRECTIONS.includes(dir)) continue;
        tile.appendChild(Object.assign(document.createElement("span"), {
          className: `wx-dir-x wx-dir-x-${dir}`, textContent: "✕",
          title: game.i18n.localize(`GLCT.weather.dir.${dir}`)
        }));
      }
      if (isGM) {
        tile.classList.add("clickable");
        tile.addEventListener("click", () => WeatherEngine.setCurrent(h.index));
      }
      host.appendChild(tile);
      this._tiles.set(h.index, tile);
    }

    // marker (glowing hex ring that rides over the current cell)
    const marker = document.createElement("div");
    marker.className = "wx-marker";
    marker.style.width = `${TILE_W}px`;
    marker.style.height = `${TILE_H}px`;
    host.appendChild(marker);
    this._marker = marker;

    // a "you are here" dot tag that hops to the current hex (see _paintFlower)
    this._nowTag = Object.assign(document.createElement("span"), {
      className: "wx-tag wx-tag-now", innerHTML: '<i class="fa-solid fa-location-dot"></i>',
      title: game.i18n.localize("GLCT.weather.editor.currentHex")
    });
  }

  /**
   * Next-step odds row: a compact chip per possible next condition, each showing
   * its weather icon + the probability of landing there next step. Follows the
   * flower's visibility (it exposes the Navigation Hex's behaviour, so it's hidden
   * from players unless the flower is revealed).
   */
  _paintForecast(cur) {
    const wrap = this.element.querySelector("[data-forecastwrap]");
    const row = this.element.querySelector("[data-forecast]");
    if (!wrap || !row) return;
    const odds = WeatherStore.viewerSeesFlower ? WeatherEngine.forecast(cur) : null;
    if (!odds?.length) { wrap.hidden = true; row.replaceChildren(); return; }
    wrap.hidden = false;

    const pct = p => Math.max(1, Math.round(p * 100));   // never show a real outcome as 0%
    const chips = odds.map(o => {
      const chip = document.createElement("span");
      chip.className = "wx-fc" + (o.ominous ? " ominous" : "") + (o.stay ? " stay" : "");
      chip.style.setProperty("--glct-weather-glow", o.tintGlow ?? "#7fb4e6");
      const stay = o.stay ? ` · ${game.i18n.localize("GLCT.weather.dir.stay")}` : "";
      chip.title = `${o.label} — ${pct(o.prob)}%${stay}`;
      const i = document.createElement("i");
      i.className = o.icon ?? "fa-solid fa-cloud";
      const n = document.createElement("b");
      n.textContent = `${pct(o.prob)}%`;
      chip.append(i, n);
      return chip;
    });
    row.replaceChildren(...chips);
  }

  _paintStrip(cur) {
    const strip = this.element.querySelector("[data-strip]");
    if (!strip) return;
    const season = cur.season;
    const hist = (cur.history ?? []).slice(-12);
    if (!hist.length) {
      strip.replaceChildren(Object.assign(document.createElement("span"), {
        className: "wx-strip-empty", textContent: game.i18n.localize("GLCT.weather.noHistory")
      }));
      return;
    }
    const chips = hist.map(rec => {
      const hex = season?.hexes?.[rec.to];
      const chip = document.createElement("span");
      chip.className = "wx-shist" + (hex?.effect?.ominous ? " ominous" : "");
      chip.title = hex?.label ?? "";
      chip.style.setProperty("--glct-weather-glow", hex?.effect?.tintGlow ?? "#7fb4e6");
      const i = document.createElement("i");
      i.className = hex?.icon ?? "fa-solid fa-cloud";
      chip.appendChild(i);
      return chip;
    });
    strip.replaceChildren(...chips);
    strip.scrollLeft = strip.scrollWidth;
  }

  _paintRevealBtn() {
    const btn = this.element.querySelector("[data-reveal]");
    if (!btn) return;
    const on = WeatherStore.playerFlowerVisible;
    btn.classList.toggle("on", on);
    const i = btn.querySelector("i");
    if (i) i.className = on ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
  }

  /** GM-only switcher: a select over every region + a quick add button. */
  _paintRegionBar() {
    const bar = this.element.querySelector("[data-regionbar]");
    if (!bar || !game.user.isGM) return;
    const list = WeatherStore.regionList();
    const sig = list.map(r => `${r.key}:${r.name}:${r.active ? 1 : 0}:${r.configured ? 1 : 0}`).join("|");
    if (sig === this._regionSig) return;
    this._regionSig = sig;
    bar.replaceChildren();

    const lbl = document.createElement("span");
    lbl.className = "wx-rb-lbl";
    lbl.innerHTML = `<i class="fa-solid fa-location-dot"></i>`;
    lbl.title = game.i18n.localize("GLCT.weather.region.label");

    const sel = document.createElement("select");
    sel.className = "wx-rb-select";
    sel.title = game.i18n.localize("GLCT.weather.region.switchHint");
    for (const r of list) {
      const o = document.createElement("option");
      o.value = r.key;
      o.textContent = r.name + (r.configured ? "" : " (—)");
      if (r.active) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", ev => WeatherStore.setActiveRegion(ev.target.value));

    const add = document.createElement("button");
    add.type = "button";
    add.className = "wx-rb-add";
    add.title = game.i18n.localize("GLCT.weather.region.add");
    add.innerHTML = `<i class="fa-solid fa-plus"></i>`;
    add.addEventListener("click", () => this._onAddRegion());

    bar.append(lbl, sel, add);
  }

  async _onAddRegion() {
    if (!game.user.isGM) return;
    let name = "New Region";
    try {
      name = await DialogV2.prompt({
        window: { title: game.i18n.localize("GLCT.weather.region.addTitle") },
        content: `<input type="text" name="rn" value="${game.i18n.localize("GLCT.weather.region.defaultName")}" style="width:100%" autofocus>`,
        ok: { label: game.i18n.localize("GLCT.weather.region.create"), callback: (ev, btn) => btn.form.elements.rn.value }
      });
    } catch { return; }   // cancelled
    if (name == null) return;
    await WeatherStore.addRegion({ name: name || game.i18n.localize("GLCT.weather.region.defaultName") });
    ui.notifications?.info(game.i18n.localize("GLCT.weather.region.added"));
  }

  /* ------------------------------ interactions ------------------------------ */

  _wireChrome() {
    const head = this.element.querySelector("[data-drag]");
    if (head) head.addEventListener("pointerdown", this._onDrag.bind(this));
    // right-click Roll-now = rewind (the module's advance/rewind idiom)
    const roll = this.element.querySelector("[data-rollnow]");
    if (roll) roll.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      if (game.user.isGM) WeatherEngine.rewind(1);
    });
  }

  _onDrag(ev) {
    if (ev.button !== 0 || ev.target.closest("button")) return;
    ev.preventDefault();
    const el = this.element;
    const rect = el.getBoundingClientRect();
    const ox = ev.clientX - rect.left, oy = ev.clientY - rect.top;
    const start = { x: ev.clientX, y: ev.clientY };
    let moved = false;
    const move = e => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) { moved = true; el.style.right = "auto"; }
      if (moved) { el.style.left = `${e.clientX - ox}px`; el.style.top = `${e.clientY - oy}px`; }
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;
      const r = el.getBoundingClientRect();
      try { await game.settings.set(MODULE_ID, SETTINGS.weatherHudPosition, { left: Math.round(r.left), top: Math.round(r.top) }); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  _applyPosition() {
    const el = this.element;
    el.style.position = "fixed";
    el.style.zIndex = "68";
    let pos = {};
    try { pos = game.settings.get(MODULE_ID, SETTINGS.weatherHudPosition) ?? {}; } catch { /* ignore */ }
    if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      el.style.left = `${pos.left}px`; el.style.top = `${pos.top}px`; el.style.right = "auto";
    } else {
      el.style.right = "14px"; el.style.top = "150px"; el.style.left = "auto";
    }
  }

  /* ------------------------------ actions ------------------------------ */

  async _onRollNow() {
    if (!game.user.isGM) return;
    if (!WeatherStore.configured) { ui.notifications?.warn(game.i18n.localize("GLCT.weather.notConfigured")); return; }
    await WeatherEngine.step({ manual: true });
  }

  async _onReset() {
    if (!game.user.isGM) return;
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("GLCT.weather.resetTitle") },
      content: `<p>${game.i18n.localize("GLCT.weather.resetConfirm")}</p>`
    });
    if (ok) await WeatherStore.resetWalk();
  }

  async _onOpenEditor() {
    if (!game.user.isGM) return;
    const { WeatherEditor } = await import("./weather-editor.js");
    WeatherEditor.show();
  }

  async _onToggleReveal() {
    if (!game.user.isGM) return;
    try { await game.settings.set(MODULE_ID, SETTINGS.weatherPlayerFlowerVisible, !WeatherStore.playerFlowerVisible); } catch { /* ignore */ }
    this._paintRevealBtn();
  }

  async _onCloseWindow() { return this._close(); }

  async _close() {
    // Fire-and-forget the client-scope flag so the close is instant; don't await.
    try { game.settings.set(MODULE_ID, SETTINGS.weatherHudHidden, true).catch(() => {}); } catch { /* ignore */ }
    return this.close({ animate: false });
  }
}
