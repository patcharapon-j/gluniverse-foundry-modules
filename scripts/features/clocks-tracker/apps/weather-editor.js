/**
 * WeatherEditor — the visual editor (decision #13, §6.3). A Settings-menu app
 * modeled on the calendar editor, extended with:
 *   • Season tabs over the climate's per-season flowers + Navigation Hexes.
 *   • A clickable flower: pick a hex → edit label/icon/description/temperature/
 *     effect note + the full effect spec (archetype/kind, intensity, two colour
 *     pickers, drift, ominous) with a live Pixi preview.
 *   • A Navigation-Hex editor: roll-total → direction map, per-face edge rules,
 *     dice selector, and a live trend/probability preview.
 *   • Presets dropdown + JSON import/export (validated on import).
 *
 * Edits run on an in-memory working copy of the climate; Save writes it back to
 * the world `weather` setting via WeatherStore.
 */

import { MODULE_ID, SETTINGS, WEATHER_DIRECTIONS, WEATHER_ARCHETYPES, WEATHER_DRIFTS, WEATHER_DICE } from "../const.js";
import { HEX_LAYOUT, HEX_BOUNDS, HEX_COUNT } from "../weather/hex-geometry.js";
import { WeatherStore } from "../weather/weather-store.js";
import { WeatherEffect } from "../weather/effects.js";
import { WEATHER_PRESETS, KIND_LIST, effectFromKind, freshState, isClimateSeasonal } from "../weather/presets.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const R = 17, TILE_W = 2 * R, TILE_H = Math.sqrt(3) * R, MARGIN = 7;

export class WeatherEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async show() {
    if (!game.user.isGM) return;
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  static DEFAULT_OPTIONS = {
    id: "glct-weather-editor",
    classes: ["glct", "glct-wxeditor"],
    tag: "form",
    window: { title: "GLCT.weather.editor.title", icon: "fa-solid fa-cloud-bolt", resizable: true },
    position: { width: 760, height: "auto" },
    actions: {
      loadPreset: WeatherEditor.prototype._onLoadPreset,
      importJson: WeatherEditor.prototype._onImport,
      exportJson: WeatherEditor.prototype._onExport,
      resetWalk: WeatherEditor.prototype._onResetWalk,
      saveWeather: WeatherEditor.prototype._onSave,
      regionNew: WeatherEditor.prototype._onRegionNew,
      regionDup: WeatherEditor.prototype._onRegionDup,
      regionRename: WeatherEditor.prototype._onRegionRename,
      regionDelete: WeatherEditor.prototype._onRegionDelete
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/weather-editor.hbs` } };

  _working = null;     // working copy of the EDITED region's climate
  _regionKey = null;   // which region this editor session is editing
  _seasonKey = null;   // active season tab
  _selected = 0;       // selected hex index
  _preview = null;     // hex-form Pixi preview
  _tiles = new Map();

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      presets: Object.entries(WEATHER_PRESETS).map(([id, build]) => ({ id, name: build().name }))
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    // Wire the static climate fields once (handlers read this._working live).
    const startEl = this.element.querySelector("[name=startHex]");
    const nameEl = this.element.querySelector("[name=climateName]");
    const seasonalEl = this.element.querySelector("[name=seasonal]");
    nameEl?.addEventListener("input", ev => { this._working.name = ev.target.value; this._buildRegionBar(); });
    startEl?.addEventListener("change", ev => { this._working.startHexIndex = this._clampIdx(ev.target.value); this._refreshFlower(); });
    seasonalEl?.addEventListener("change", ev => { this._working.seasonal = ev.target.checked; this._updateSeasonalHint(); });

    if (this._regionKey == null || !WeatherStore.regionByKey(this._regionKey)) this._regionKey = WeatherStore.activeRegionKey();
    if (!this._working) this._working = foundry.utils.deepClone(WeatherStore.regionByKey(this._regionKey)?.climate ?? WEATHER_PRESETS.temperate());
    this._seasonKey = this._seasonKey ?? Object.keys(this._working.seasons ?? {})[0] ?? "0";
    this._selected = this._working.startHexIndex ?? 0;

    this._syncClimateFields();
    this._buildRegionBar();
    this._buildTabs();
    this._rebuildSeason();
  }

  /* ------------------------------ regions ------------------------------ */

  /** Reflect the working climate into the static name/start/seasonal fields. */
  _syncClimateFields() {
    const nameEl = this.element.querySelector("[name=climateName]");
    const startEl = this.element.querySelector("[name=startHex]");
    const seasonalEl = this.element.querySelector("[name=seasonal]");
    if (nameEl) nameEl.value = this._working.name ?? "";
    if (startEl) startEl.value = this._working.startHexIndex ?? 0;
    if (seasonalEl) seasonalEl.checked = isClimateSeasonal(this._working);
    this._updateSeasonalHint();
  }

  _updateSeasonalHint() {
    const hint = this.element.querySelector("[data-seasonalhint]");
    if (!hint) return;
    hint.textContent = game.i18n.localize(
      isClimateSeasonal(this._working) ? "GLCT.weather.editor.seasonalOnHint" : "GLCT.weather.editor.seasonalOffHint"
    );
  }

  /** Populate the region <select> + toggle Delete when only one region exists. */
  _buildRegionBar() {
    const sel = this.element.querySelector("[data-regionsel]");
    if (!sel) return;
    const list = WeatherStore.regionList();
    sel.replaceChildren();
    for (const r of list) {
      const o = document.createElement("option");
      o.value = r.key;
      o.textContent = r.name + (r.active ? " ●" : "");
      if (r.key === this._regionKey) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = ev => this._switchRegion(ev.target.value);
    const del = this.element.querySelector("[data-action=regionDelete]");
    if (del) del.disabled = list.length <= 1;
  }

  /** Load a region's climate into the editor (persisting valid pending edits). */
  _loadRegion(key) {
    const region = WeatherStore.regionByKey(key);
    if (!region) return;
    this._regionKey = key;
    this._working = foundry.utils.deepClone(region.climate ?? WEATHER_PRESETS.temperate());
    this._seasonKey = Object.keys(this._working.seasons ?? {})[0] ?? "0";
    this._selected = this._working.startHexIndex ?? 0;
    this._syncClimateFields();
    this._buildRegionBar();
    this._buildTabs();
    this._rebuildSeason();
  }

  async _switchRegion(key) {
    if (!key || key === this._regionKey) return;
    await this._commitWorking();
    this._loadRegion(key);
  }

  /** Persist the working climate into the edited region (only if it validates). */
  async _commitWorking() {
    if (!this._working || this._validate(this._working)) return;
    this._working.name = this.element.querySelector("[name=climateName]")?.value || this._working.name;
    this._working.startHexIndex = this._clampIdx(this.element.querySelector("[name=startHex]")?.value);
    this._working.seasonal = !!this.element.querySelector("[name=seasonal]")?.checked;
    this._working.id = this._working.id && WEATHER_PRESETS[this._working.id] ? this._working.id : "custom";
    const key = this._regionKey;
    const working = foundry.utils.deepClone(this._working);
    await WeatherStore.update(data => {
      const region = data.regions?.[key];
      if (!region) return null;
      region.activePresetId = working.id;
      region.climate = working;
      if (!region.state || !Number.isInteger(region.state.currentIndex)) region.state = freshState(working);
      return { reason: "climate" };
    });
  }

  async _onRegionNew() {
    await this._commitWorking();
    const key = await WeatherStore.addRegion({ name: game.i18n.localize("GLCT.weather.region.defaultName"), activate: false });
    if (key) { this._loadRegion(key); ui.notifications?.info(game.i18n.localize("GLCT.weather.region.added")); }
  }

  async _onRegionDup() {
    await this._commitWorking();
    const key = await WeatherStore.duplicateRegion(this._regionKey);
    if (key) this._loadRegion(key);
  }

  async _onRegionRename() {
    const region = WeatherStore.regionByKey(this._regionKey);
    let name;
    try {
      name = await DialogV2.prompt({
        window: { title: game.i18n.localize("GLCT.weather.region.renameTitle") },
        content: `<input type="text" name="rn" value="${foundry.utils.escapeHTML(region?.name ?? "")}" style="width:100%" autofocus>`,
        ok: { label: game.i18n.localize("GLCT.weather.region.rename"), callback: (ev, btn) => btn.form.elements.rn.value }
      });
    } catch { return; }
    if (name == null) return;
    await WeatherStore.renameRegion(this._regionKey, name);
    this._buildRegionBar();
  }

  async _onRegionDelete() {
    if (WeatherStore.regionList().length <= 1) return;
    const region = WeatherStore.regionByKey(this._regionKey);
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("GLCT.weather.region.deleteTitle") },
      content: `<p>${game.i18n.format("GLCT.weather.region.deleteConfirm", { name: foundry.utils.escapeHTML(region?.name ?? "") })}</p>`
    });
    if (!ok) return;
    await WeatherStore.deleteRegion(this._regionKey);
    this._loadRegion(WeatherStore.activeRegionKey());
  }

  async _onClose(options) {
    this._preview?.destroy(); this._preview = null;
    return super._onClose(options);
  }

  _clampIdx(v) { const n = Math.trunc(Number(v)); return Number.isInteger(n) && n >= 0 && n < HEX_COUNT ? n : 0; }
  get _season() { return this._working.seasons?.[this._seasonKey]; }

  /* ------------------------------ tabs ------------------------------ */

  _buildTabs() {
    const host = this.element.querySelector("[data-tabs]");
    host.replaceChildren();
    for (const [key, s] of Object.entries(this._working.seasons ?? {})) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "wxe-tab" + (key === this._seasonKey ? " on" : "");
      tab.textContent = s.name || `#${key}`;
      tab.addEventListener("click", () => { this._seasonKey = key; this._buildTabs(); this._rebuildSeason(); });
      host.appendChild(tab);
    }
  }

  _rebuildSeason() {
    this._buildFlower();
    this._buildHexForm();
    this._buildNav();
  }

  /* ------------------------------ flower ------------------------------ */

  _centerPx(index) {
    const h = HEX_LAYOUT[index];
    return { x: h.center.x * R + (-HEX_BOUNDS.minX * R + TILE_W / 2 + MARGIN), y: h.center.y * R + (-HEX_BOUNDS.minY * R + TILE_H / 2 + MARGIN) };
  }

  _buildFlower() {
    const host = this.element.querySelector("[data-flower]");
    host.replaceChildren();
    this._tiles.clear();
    host.style.width = `${Math.round((HEX_BOUNDS.maxX - HEX_BOUNDS.minX) * R + TILE_W + MARGIN * 2)}px`;
    host.style.height = `${Math.round((HEX_BOUNDS.maxY - HEX_BOUNDS.minY) * R + TILE_H + MARGIN * 2)}px`;
    const hexes = this._season?.hexes ?? [];
    for (const h of HEX_LAYOUT) {
      const hex = hexes[h.index]; const e = hex?.effect ?? {};
      const c = this._centerPx(h.index);
      const tile = document.createElement("div");
      tile.className = "wx-hex clickable" + (e.ominous ? " ominous" : "") + (h.index === this._working.startHexIndex ? " start" : "") + (h.index === this._selected ? " sel" : "");
      tile.style.left = `${c.x}px`; tile.style.top = `${c.y}px`;
      tile.style.width = `${TILE_W}px`; tile.style.height = `${TILE_H}px`;
      tile.style.setProperty("--glct-weather-tint", e.tintParticle ?? "#3a4250");
      tile.style.setProperty("--glct-weather-glow", e.tintGlow ?? "#7fb4e6");
      tile.title = hex?.label ?? "";
      const ic = document.createElement("i"); ic.className = hex?.icon ?? "fa-solid fa-cloud"; tile.appendChild(ic);
      // a green flag tag on the start hex makes "the walk begins here" unmistakable
      if (h.index === this._working.startHexIndex) {
        tile.appendChild(Object.assign(document.createElement("span"), {
          className: "wx-tag wx-tag-start", innerHTML: '<i class="fa-solid fa-flag"></i>',
          title: game.i18n.localize("GLCT.weather.editor.startHex")
        }));
      }
      // a red ✕ on each blocked face — clearer than one corner Ø badge
      if (hex?.disallow?.length) {
        tile.classList.add("blocked");
        for (const dir of hex.disallow) {
          if (!WEATHER_DIRECTIONS.includes(dir)) continue;
          tile.appendChild(Object.assign(document.createElement("span"), {
            className: `wx-dir-x wx-dir-x-${dir}`, textContent: "✕",
            title: game.i18n.localize(`GLCT.weather.dir.${dir}`)
          }));
        }
      }
      tile.addEventListener("click", () => { this._selected = h.index; this._buildFlower(); this._buildHexForm(); });
      host.appendChild(tile);
      this._tiles.set(h.index, tile);
    }
  }

  _refreshFlower() {
    // cheap repaint of one tile + start markers
    this._buildFlower();
  }

  /* ------------------------------ hex form ------------------------------ */

  _buildHexForm() {
    const host = this.element.querySelector("[data-hexform]");
    host.replaceChildren();
    // the preview host is recreated below, so drop the old Pixi canvas first
    this._preview?.destroy(); this._preview = null;
    const hex = this._season?.hexes?.[this._selected];
    if (!hex) return;
    hex.effect = hex.effect ?? effectFromKind("clear");
    const e = hex.effect;

    const L = k => game.i18n.localize(k);
    const row = (labelKey, control) => {
      const r = document.createElement("label"); r.className = "wxe-frow";
      r.appendChild(Object.assign(document.createElement("span"), { className: "wxe-flabel", textContent: L(labelKey) }));
      r.appendChild(control);
      return r;
    };
    const input = (val, oninput, attrs = {}) => {
      const i = document.createElement("input"); i.type = attrs.type ?? "text"; i.value = val ?? "";
      Object.assign(i, attrs); i.addEventListener(attrs.type === "range" || attrs.type === "color" ? "input" : "change", oninput);
      return i;
    };
    const select = (options, val, onchange) => {
      const s = document.createElement("select");
      for (const o of options) { const op = document.createElement("option"); op.value = o.value; op.textContent = o.label; if (o.value === val) op.selected = true; s.appendChild(op); }
      s.addEventListener("change", onchange); return s;
    };

    // header: live preview + selected index
    const head = document.createElement("div"); head.className = "wxe-fhead";
    const stage = document.createElement("div"); stage.className = "wxe-preview"; stage.dataset.preview = "1";
    const icoOverlay = document.createElement("i"); icoOverlay.className = hex.icon ?? "fa-solid fa-cloud"; icoOverlay.dataset.previco = "1";
    stage.appendChild(icoOverlay);
    head.appendChild(stage);
    head.appendChild(Object.assign(document.createElement("span"), { className: "wxe-fidx", textContent: `${L("GLCT.weather.editor.hex")} #${this._selected}` }));
    host.appendChild(head);

    // kind library picker — sets the whole effect from a named preset
    host.appendChild(row("GLCT.weather.editor.kind", select(
      [{ value: "", label: "—" }, ...KIND_LIST.map(k => ({ value: k.key, label: k.label }))],
      e.kind || "",
      ev => {
        if (!ev.target.value) return;
        const fresh = effectFromKind(ev.target.value);
        Object.assign(hex.effect, fresh);
        // pull the kind's default label/icon if the hex is still blank/default
        const lib = KIND_LIST.find(k => k.key === ev.target.value);
        if (lib && (!hex.label)) hex.label = lib.label;
        this._buildHexForm(); this._buildFlower();
      }
    )));

    host.appendChild(row("GLCT.weather.field.name", input(hex.label, ev => { hex.label = ev.target.value; this._tiles.get(this._selected) && (this._tiles.get(this._selected).title = ev.target.value); })));
    host.appendChild(row("GLCT.weather.editor.icon", input(hex.icon, ev => { hex.icon = ev.target.value; icoOverlay.className = ev.target.value; this._buildFlower(); })));
    host.appendChild(row("GLCT.weather.editor.temperature", input(hex.temperature, ev => { hex.temperature = ev.target.value; })));

    const desc = document.createElement("textarea"); desc.rows = 2; desc.value = hex.description ?? "";
    desc.addEventListener("change", ev => { hex.description = ev.target.value; });
    host.appendChild(row("GLCT.weather.editor.description", desc));

    const note = document.createElement("textarea"); note.rows = 2; note.value = hex.effectNote ?? "";
    note.addEventListener("change", ev => { hex.effectNote = ev.target.value; });
    host.appendChild(row("GLCT.weather.editor.effectNote", note));

    // effect spec
    const sec = document.createElement("div"); sec.className = "wxe-fsubtitle"; sec.textContent = L("GLCT.weather.editor.effect");
    host.appendChild(sec);

    host.appendChild(row("GLCT.weather.editor.archetype", select(
      WEATHER_ARCHETYPES.map(a => ({ value: a, label: L(`GLCT.weather.arch.${a}`) })), e.archetype,
      ev => { e.archetype = ev.target.value; this._updatePreview(); }
    )));
    host.appendChild(row("GLCT.weather.editor.drift", select(
      WEATHER_DRIFTS.map(d => ({ value: d, label: L(`GLCT.weather.drift.${d}`) })), e.drift,
      ev => { e.drift = ev.target.value; this._updatePreview(); }
    )));

    const intens = input(e.intensity, ev => { e.intensity = Number(ev.target.value); this._updatePreview(); }, { type: "range", min: 0, max: 1, step: 0.05 });
    host.appendChild(row("GLCT.weather.editor.intensity", intens));

    const cp = input(e.tintParticle, ev => { e.tintParticle = ev.target.value; this._updatePreview(); this._buildFlower(); }, { type: "color" });
    host.appendChild(row("GLCT.weather.editor.tintParticle", cp));
    const cg = input(e.tintGlow, ev => { e.tintGlow = ev.target.value; this._updatePreview(); this._buildFlower(); }, { type: "color" });
    host.appendChild(row("GLCT.weather.editor.tintGlow", cg));

    const omWrap = document.createElement("label"); omWrap.className = "wxe-frow checkbox";
    const om = document.createElement("input"); om.type = "checkbox"; om.checked = !!e.ominous;
    om.addEventListener("change", ev => { e.ominous = ev.target.checked; this._buildFlower(); });
    omWrap.appendChild(om);
    omWrap.appendChild(Object.assign(document.createElement("span"), { textContent: L("GLCT.weather.editor.ominous") }));
    host.appendChild(omWrap);

    // Disallowed faces (cookbook red Ø): rolling into a checked direction keeps
    // the walk in this hex. Defaults cap the extreme (7) and start (11) hexes.
    hex.disallow = Array.isArray(hex.disallow) ? hex.disallow : [];
    const dsec = document.createElement("div"); dsec.className = "wxe-fsubtitle"; dsec.textContent = L("GLCT.weather.editor.disallow");
    host.appendChild(dsec);
    const dwrap = document.createElement("div"); dwrap.className = "wxe-disallow";
    for (const dir of WEATHER_DIRECTIONS) {
      const chip = document.createElement("label"); chip.className = "wxe-dchip";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = hex.disallow.includes(dir);
      cb.addEventListener("change", ev => {
        const set = new Set(hex.disallow);
        if (ev.target.checked) set.add(dir); else set.delete(dir);
        hex.disallow = [...set];
        this._buildFlower();
      });
      chip.appendChild(cb);
      chip.appendChild(Object.assign(document.createElement("span"), { textContent: L(`GLCT.weather.dir.${dir}`) }));
      dwrap.appendChild(chip);
    }
    host.appendChild(dwrap);
    host.appendChild(Object.assign(document.createElement("p"), { className: "wxe-hint", textContent: L("GLCT.weather.editor.disallowHint") }));

    this._updatePreview();
  }

  _updatePreview() {
    const host = this.element.querySelector("[data-preview]");
    const hex = this._season?.hexes?.[this._selected];
    if (!host || !hex) return;
    if (!this._preview) this._preview = WeatherEffect.create(host, hex.effect);
    else this._preview.setSpec(hex.effect);
    this._preview?.resume();
    host.style.setProperty("--glct-weather-glow", hex.effect?.tintGlow ?? "#7fb4e6");
  }

  /* ------------------------------ Navigation Hex ------------------------------ */

  _buildNav() {
    const host = this.element.querySelector("[data-nav]");
    host.replaceChildren();
    const season = this._season;
    if (!season) return;
    const nav = season.nav ?? (season.nav = foundry.utils.deepClone(this._working.defaultNav));
    const L = k => game.i18n.localize(k);

    // dice selector
    const top = document.createElement("div"); top.className = "wxe-navtop";
    const diceLbl = Object.assign(document.createElement("span"), { className: "wxe-flabel", textContent: L("GLCT.weather.editor.dice") });
    const diceSel = document.createElement("select");
    for (const d of WEATHER_DICE) { const o = document.createElement("option"); o.value = d; o.textContent = d.toUpperCase(); if (d === nav.dice) o.selected = true; diceSel.appendChild(o); }
    diceSel.addEventListener("change", ev => { nav.dice = ev.target.value; this._buildNav(); });
    top.append(diceLbl, diceSel);
    host.appendChild(top);

    const grid = document.createElement("div"); grid.className = "wxe-navgrid";

    // direction-map column: one select per reachable total
    const mapCol = document.createElement("div"); mapCol.className = "wxe-navmap";
    mapCol.appendChild(Object.assign(document.createElement("div"), { className: "wxe-navcol-h", textContent: L("GLCT.weather.editor.directionMap") }));
    const dist = this._diceDist(nav.dice);
    const dirOptions = [{ value: "stay", label: L("GLCT.weather.dir.stay") }, ...WEATHER_DIRECTIONS.map(d => ({ value: d, label: L(`GLCT.weather.dir.${d}`) }))];
    for (const total of Object.keys(dist).map(Number).sort((a, b) => a - b)) {
      const r = document.createElement("div"); r.className = "wxe-maprow";
      r.appendChild(Object.assign(document.createElement("span"), { className: "wxe-mtotal", textContent: total }));
      const pct = Math.round(dist[total] * 1000) / 10;
      r.appendChild(Object.assign(document.createElement("span"), { className: "wxe-mpct", textContent: `${pct}%` }));
      const sel = document.createElement("select");
      for (const o of dirOptions) { const op = document.createElement("option"); op.value = o.value; op.textContent = o.label; if ((nav.directionMap?.[String(total)] ?? "stay") === o.value) op.selected = true; sel.appendChild(op); }
      sel.addEventListener("change", ev => { (nav.directionMap ??= {})[String(total)] = ev.target.value; this._renderTrend(host, nav); });
      r.appendChild(sel);
      mapCol.appendChild(r);
    }
    grid.appendChild(mapCol);

    // edge-rule column: per-direction wrap/stay/divert
    const edgeCol = document.createElement("div"); edgeCol.className = "wxe-navedge";
    edgeCol.appendChild(Object.assign(document.createElement("div"), { className: "wxe-navcol-h", textContent: L("GLCT.weather.editor.edgeRules") }));
    nav.edgeRules ??= {};
    for (const dir of WEATHER_DIRECTIONS) {
      const r = document.createElement("div"); r.className = "wxe-edgerow";
      r.appendChild(Object.assign(document.createElement("span"), { className: "wxe-edgelbl", textContent: L(`GLCT.weather.dir.${dir}`) }));
      const cur = nav.edgeRules[dir];
      const isDivert = cur && typeof cur === "object";
      const sel = document.createElement("select");
      for (const o of [{ value: "wrap", label: L("GLCT.weather.edge.wrap") }, { value: "stay", label: L("GLCT.weather.edge.stay") }, { value: "divert", label: L("GLCT.weather.edge.divert") }]) {
        const op = document.createElement("option"); op.value = o.value; op.textContent = o.label;
        if ((isDivert ? "divert" : cur) === o.value) op.selected = true; sel.appendChild(op);
      }
      const divInput = document.createElement("input"); divInput.type = "number"; divInput.min = 0; divInput.max = 18; divInput.className = "wxe-divert";
      divInput.value = isDivert ? cur.divert : 0; divInput.style.display = isDivert ? "" : "none";
      sel.addEventListener("change", ev => {
        if (ev.target.value === "divert") { nav.edgeRules[dir] = { divert: this._clampIdx(divInput.value) }; divInput.style.display = ""; }
        else { nav.edgeRules[dir] = ev.target.value; divInput.style.display = "none"; }
      });
      divInput.addEventListener("change", () => { nav.edgeRules[dir] = { divert: this._clampIdx(divInput.value) }; });
      r.append(sel, divInput);
      edgeCol.appendChild(r);
    }
    grid.appendChild(edgeCol);

    // trend preview column
    const trendCol = document.createElement("div"); trendCol.className = "wxe-navtrend"; trendCol.dataset.trend = "1";
    grid.appendChild(trendCol);

    host.appendChild(grid);
    this._renderTrend(host, nav);
  }

  /** Probability per total for a dice system. */
  _diceDist(dice) {
    const faces = dice === "d6+d8" ? [6, 8] : [6, 6];
    let dist = { 0: 1 };
    for (const f of faces) {
      const next = {};
      for (const [s, p] of Object.entries(dist)) {
        for (let v = 1; v <= f; v++) { const k = Number(s) + v; next[k] = (next[k] ?? 0) + p / f; }
      }
      dist = next;
    }
    delete dist[0];
    return dist;
  }

  /** Render the live trend bars: probability mass per direction (+ stay). */
  _renderTrend(host, nav) {
    const col = host.querySelector("[data-trend]");
    if (!col) return;
    col.replaceChildren();
    col.appendChild(Object.assign(document.createElement("div"), { className: "wxe-navcol-h", textContent: game.i18n.localize("GLCT.weather.editor.trend") }));
    const dist = this._diceDist(nav.dice);
    const byDir = { up: 0, upperRight: 0, lowerRight: 0, down: 0, lowerLeft: 0, upperLeft: 0, stay: 0 };
    for (const [total, p] of Object.entries(dist)) {
      const dir = nav.directionMap?.[total] ?? "stay";
      byDir[dir] = (byDir[dir] ?? 0) + p;
    }
    const max = Math.max(...Object.values(byDir), 0.0001);
    for (const dir of [...WEATHER_DIRECTIONS, "stay"]) {
      const p = byDir[dir] ?? 0;
      const r = document.createElement("div"); r.className = "wxe-trendrow";
      r.appendChild(Object.assign(document.createElement("span"), { className: "wxe-tdir", textContent: game.i18n.localize(`GLCT.weather.dir.${dir}`) }));
      const bar = document.createElement("span"); bar.className = "wxe-tbar";
      const fill = document.createElement("i"); fill.style.width = `${(p / max) * 100}%`;
      bar.appendChild(fill);
      r.appendChild(bar);
      r.appendChild(Object.assign(document.createElement("span"), { className: "wxe-tpct", textContent: `${Math.round(p * 100)}%` }));
      col.appendChild(r);
    }
  }

  /* ------------------------------ JSON I/O + presets ------------------------------ */

  _onLoadPreset() {
    const id = this.element.querySelector("[name=presetSelect]")?.value;
    const build = WEATHER_PRESETS[id];
    if (!build) return;
    this._working = build();
    this._seasonKey = Object.keys(this._working.seasons)[0];
    this._selected = this._working.startHexIndex ?? 0;
    this._syncClimateFields();
    this._buildTabs(); this._rebuildSeason();
  }

  async _onImport() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const climate = JSON.parse(await file.text());
        const err = this._validate(climate);
        if (err) { ui.notifications.error(err); return; }
        this._working = climate;
        this._seasonKey = Object.keys(climate.seasons)[0];
        this._selected = climate.startHexIndex ?? 0;
        this._syncClimateFields();
        this._buildTabs(); this._rebuildSeason();
        ui.notifications.info(game.i18n.localize("GLCT.weather.editor.imported"));
      } catch (e) { ui.notifications.error(`Invalid weather file: ${e.message}`); }
    });
    input.click();
  }

  _onExport() {
    const name = (this._working?.name ?? "weather").replace(/[^\w-]+/g, "_");
    const blob = new Blob([JSON.stringify(this._working, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${name}.json`; a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Validate an imported climate (decision #13): 19 hexes per season, valid indices/dirs. */
  _validate(climate) {
    if (!climate || typeof climate !== "object" || !climate.seasons) return game.i18n.localize("GLCT.weather.editor.invalidShape");
    for (const [key, s] of Object.entries(climate.seasons)) {
      if (!Array.isArray(s.hexes) || s.hexes.length !== HEX_COUNT) return game.i18n.format("GLCT.weather.editor.invalidHexCount", { season: s.name ?? key, n: HEX_COUNT });
      const seen = new Set();
      for (const h of s.hexes) {
        if (!Number.isInteger(h.index) || h.index < 0 || h.index >= HEX_COUNT || seen.has(h.index)) return game.i18n.format("GLCT.weather.editor.invalidIndex", { season: s.name ?? key });
        seen.add(h.index);
        if (h.disallow != null && (!Array.isArray(h.disallow) || h.disallow.some(d => !WEATHER_DIRECTIONS.includes(d))))
          return game.i18n.format("GLCT.weather.editor.invalidDisallow", { season: s.name ?? key });
      }
      const nav = s.nav;
      if (nav?.directionMap) {
        for (const dir of Object.values(nav.directionMap)) if (dir !== "stay" && !WEATHER_DIRECTIONS.includes(dir)) return game.i18n.format("GLCT.weather.editor.invalidDir", { season: s.name ?? key });
      }
    }
    return null;
  }

  async _onResetWalk() {
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("GLCT.weather.resetTitle") },
      content: `<p>${game.i18n.localize("GLCT.weather.resetConfirm")}</p>`
    });
    if (ok) await WeatherStore.resetWalk();
  }

  async _onSave() {
    const err = this._validate(this._working);
    if (err) { ui.notifications.error(err); return; }
    this._working.name = this.element.querySelector("[name=climateName]").value || this._working.name;
    this._working.startHexIndex = this._clampIdx(this.element.querySelector("[name=startHex]").value);
    this._working.seasonal = !!this.element.querySelector("[name=seasonal]")?.checked;
    // mark as a custom climate so the store labels it correctly
    this._working.id = this._working.id && WEATHER_PRESETS[this._working.id] ? this._working.id : "custom";

    const key = this._regionKey;
    const working = foundry.utils.deepClone(this._working);
    await WeatherStore.update(data => {
      const region = data.regions?.[key] ?? WeatherStore.region(data);
      if (!region) return null;
      region.activePresetId = working.id;
      region.climate = working;
      // keep the live position if it's still valid, else reseat at the start hex
      if (!region.state || !Number.isInteger(region.state.currentIndex)) region.state = freshState(working);
      return { reason: "climate" };
    });
    this._buildRegionBar();   // the region's display name may have changed
    ui.notifications.info(game.i18n.localize("GLCT.weather.editor.saved"));
  }
}

/** Register the Weather settings menu (alongside Calendar / Events / Shift Names). */
export function registerWeatherMenu() {
  game.settings.registerMenu(MODULE_ID, "weatherEditor", {
    name: "GLCT.weather.editor.title",
    label: "GLCT.weather.editor.menuLabel",
    hint: "GLCT.weather.editor.menuHint",
    icon: "fa-solid fa-cloud-bolt",
    type: WeatherEditor,
    restricted: true
  });
}
