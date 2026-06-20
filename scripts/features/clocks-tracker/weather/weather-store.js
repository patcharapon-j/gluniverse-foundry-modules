/**
 * WeatherStore — the data layer for the weather feature (mirrors TrackerStore).
 *
 * All weather state lives in one world-scope setting (`weather`): the climate
 * definition AND the live walk. Every GM edit or step propagates to all clients
 * via the setting's onChange → repaint + HOOKS.weatherChanged pipeline. Players
 * read the object but never write it (weather is GM-authoritative, decision #16);
 * the engine guards every mutation with an isGM check.
 */

import { MODULE_ID, SETTINGS, HOOKS, WEATHER_HISTORY_CAP, WEATHER_DIRECTIONS, WEATHER_ARCHETYPES, WEATHER_DICE } from "../const.js";
import { makeDefaultWeather, freshState, makeRegion, buildTemperate, isClimateSeasonal } from "./presets.js";
import { HEX_COUNT } from "./hex-geometry.js";

const FALLBACK_REGION = "default";   // the always-present seed region

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(+n) ? +n : 0));
const idx = (v, fallback = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isInteger(n) && n >= 0 && n < HEX_COUNT ? n : fallback;
};
const hex6 = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fallback);

export class WeatherStore {
  /* ------------------------------- reads ------------------------------- */

  static get enabled() {
    try { return !!game.settings.get(MODULE_ID, SETTINGS.weatherEnabled); } catch { return false; }
  }

  static get playerFlowerVisible() {
    try { return !!game.settings.get(MODULE_ID, SETTINGS.weatherPlayerFlowerVisible); } catch { return false; }
  }

  static get cadenceMode() {
    try { return game.settings.get(MODULE_ID, SETTINGS.weatherCadenceMode) || "auto"; } catch { return "auto"; }
  }

  static get cadencePeriod() {
    try { return game.settings.get(MODULE_ID, SETTINGS.weatherCadencePeriod) || "day"; } catch { return "day"; }
  }

  /** GM toggle: animate Dice So Nice 3D dice on weather Navigation-Hex rolls. */
  static get showDice() {
    try { return !!game.settings.get(MODULE_ID, SETTINGS.weatherShowDice); } catch { return false; }
  }

  /** Who sees the weather-change chat card: "public" (everyone) or "gm" (whispered to GMs). */
  static get cardVisibility() {
    try { return game.settings.get(MODULE_ID, SETTINGS.weatherCardVisibility) || "public"; } catch { return "public"; }
  }

  /** The full config object (deep-cloned), guaranteed structurally valid. */
  static get data() {
    let raw = null;
    try { raw = game.settings.get(MODULE_ID, SETTINGS.weather); } catch { /* ignore */ }
    if (!raw || typeof raw !== "object" || !raw.regions || !Object.keys(raw.regions).length) return makeDefaultWeather();
    return foundry.utils.deepClone(raw);
  }

  /** The key of the region that drives the HUD + chat cards (validated). */
  static activeRegionKey(data = this.data) {
    const keys = Object.keys(data?.regions ?? {});
    if (!keys.length) return FALLBACK_REGION;
    return keys.includes(data.activeRegion) ? data.activeRegion : keys[0];
  }

  /** The active region entry (the one currently shown / driven manually). */
  static region(data = this.data) {
    return data.regions?.[this.activeRegionKey(data)] ?? null;
  }

  /** A specific region by key (for ticking every region independently). */
  static regionByKey(key, data = this.data) {
    return data?.regions?.[key] ?? null;
  }

  /** Lightweight list of all regions for switcher/management UIs. */
  static regionList(data = this.data) {
    const active = this.activeRegionKey(data);
    return Object.entries(data?.regions ?? {}).map(([key, r]) => ({
      key,
      name: r?.name || r?.climate?.name || key,
      active: key === active,
      seasonal: isClimateSeasonal(r?.climate),
      configured: this.regionConfigured(r)
    }));
  }

  static climate(data = this.data) {
    return this.region(data)?.climate ?? null;
  }

  static state(data = this.data) {
    return this.region(data)?.state ?? null;
  }

  /** True once a region's climate has at least one full season of hexes. */
  static regionConfigured(region) {
    const c = region?.climate;
    if (!c?.seasons) return false;
    return Object.values(c.seasons).some(s => Array.isArray(s?.hexes) && s.hexes.length === HEX_COUNT);
  }

  /** True once the ACTIVE region is configured (gates the chip/window). */
  static get configured() {
    return this.regionConfigured(this.region());
  }

  /** True when the current viewer may see the flower/NH (GM, or revealed setting). */
  static get viewerSeesFlower() {
    return (game.user?.isGM ?? false) || this.playerFlowerVisible;
  }

  /* ------------------------------- writes (GM) ------------------------------- */

  /** Persist a whole config object; sanitize, save, fire the public hook. */
  static async save(data, { payload = null } = {}) {
    if (!game.user.isGM) return;
    this._sanitize(data);
    await game.settings.set(MODULE_ID, SETTINGS.weather, data);
    // onChange handles the local + broadcast repaint; fire the public hook too.
    Hooks.callAll(HOOKS.weatherChanged, payload ?? { reason: "save", data });
  }

  /** Read → mutate → save convenience. `mutator(data)` may return a payload. */
  static async update(mutator, opts = {}) {
    if (!game.user.isGM) return;
    const data = this.data;
    const payload = mutator(data) ?? null;
    await this.save(data, { payload, ...opts });
  }

  /** Reset the live walk to the climate's start hex (keeps the climate). */
  static async resetWalk() {
    if (!game.user.isGM) return;
    await this.update(data => {
      const region = this.region(data);
      if (region) region.state = freshState(region.climate);
      return { reason: "reset" };
    });
  }

  /** Replace the active region's climate (e.g. applying a preset) and reseat the walk. */
  static async applyClimate(climate) {
    if (!game.user.isGM) return;
    await this.update(data => {
      const key = this.activeRegionKey(data);
      const region = data.regions[key] ?? (data.regions[key] = {});
      region.activePresetId = climate?.id ?? "custom";
      region.climate = foundry.utils.deepClone(climate);
      region.state = freshState(region.climate);
      return { reason: "climate" };
    });
  }

  /* ------------------------------- regions (GM) ------------------------------- */

  /** Switch which region drives the HUD + chat cards. */
  static async setActiveRegion(key) {
    if (!game.user.isGM) return;
    await this.update(data => {
      if (!data.regions?.[key]) return null;
      data.activeRegion = key;
      return { reason: "region", regionKey: key };
    });
  }

  /** Add a region (defaults to a fresh Temperate climate); returns its new key. */
  static async addRegion({ name = "New Region", climate = null, activate = true } = {}) {
    if (!game.user.isGM) return null;
    const key = foundry.utils.randomID(12);
    await this.update(data => {
      data.regions ??= {};
      data.regions[key] = makeRegion(name, climate ?? buildTemperate());
      if (activate) data.activeRegion = key;
      return { reason: "regionAdd", regionKey: key };
    });
    return key;
  }

  /** Duplicate a region (climate + a fresh walk); returns the new key. */
  static async duplicateRegion(key) {
    if (!game.user.isGM) return null;
    const src = this.regionByKey(key);
    if (!src) return null;
    const newKey = foundry.utils.randomID(12);
    await this.update(data => {
      const s = data.regions?.[key];
      if (!s) return null;
      data.regions[newKey] = {
        name: `${s.name || s.climate?.name || "Region"} (copy)`,
        activePresetId: s.activePresetId ?? "custom",
        climate: foundry.utils.deepClone(s.climate),
        state: freshState(s.climate)
      };
      data.activeRegion = newKey;
      return { reason: "regionAdd", regionKey: newKey };
    });
    return newKey;
  }

  /** Rename a region (the GM-facing locale label). */
  static async renameRegion(key, name) {
    if (!game.user.isGM) return;
    await this.update(data => {
      const r = data.regions?.[key];
      if (!r) return null;
      r.name = String(name ?? "").slice(0, 60) || (r.climate?.name ?? "Region");
      return { reason: "regionRename", regionKey: key };
    });
  }

  /** Delete a region (never the last one); re-points the active region if needed. */
  static async deleteRegion(key) {
    if (!game.user.isGM) return;
    await this.update(data => {
      const keys = Object.keys(data.regions ?? {});
      if (keys.length <= 1 || !data.regions[key]) return null;
      delete data.regions[key];
      if (data.activeRegion === key) data.activeRegion = Object.keys(data.regions)[0];
      return { reason: "regionDelete", regionKey: key };
    });
  }

  /* ------------------------------- sanitize ------------------------------- */

  static _sanitize(data) {
    if (!data || typeof data !== "object") return;
    data.schemaVersion = 2;
    if (!data.regions || typeof data.regions !== "object" || !Object.keys(data.regions).length) {
      // Recover an empty/corrupt config to the seed region rather than dropping out.
      Object.assign(data, makeDefaultWeather());
      return;
    }
    for (const [key, region] of Object.entries(data.regions)) {
      if (!region || typeof region !== "object") { delete data.regions[key]; continue; }
      this._sanitizeRegion(region, key);
    }
    // Ensure the active pointer names a real region (migration from schemaVersion 1).
    if (!data.regions[data.activeRegion]) data.activeRegion = Object.keys(data.regions)[0];
  }

  static _sanitizeRegion(region, key) {
    region.name = String(region.name ?? "").slice(0, 60) || region.climate?.name || (key === FALLBACK_REGION ? "Default" : "Region");
    if (typeof region.activePresetId !== "string") region.activePresetId = "custom";

    const climate = region.climate;
    if (climate) {
      climate.startHexIndex = idx(climate.startHexIndex, 11);
      // Seasonal flag (migration): default by whether the climate defines >1 season.
      climate.seasonal = typeof climate.seasonal === "boolean" ? climate.seasonal : isClimateSeasonal(climate);
      this._sanitizeNav(climate.defaultNav);
      for (const sKey of Object.keys(climate.seasons ?? {})) {
        const season = climate.seasons[sKey];
        if (!season) continue;
        if (Array.isArray(season.hexes)) season.hexes.forEach((h, i) => this._sanitizeHex(h, i));
        this._sanitizeNav(season.nav);
      }
    }

    const state = region.state;
    if (state) {
      state.currentIndex = idx(state.currentIndex, climate?.startHexIndex ?? 11);
      if (!Array.isArray(state.history)) state.history = [];
      if (state.history.length > WEATHER_HISTORY_CAP) {
        state.history = state.history.slice(state.history.length - WEATHER_HISTORY_CAP);
      }
    } else if (climate) {
      region.state = freshState(climate);
    }
  }

  static _sanitizeHex(h, fallbackIndex = 0) {
    if (!h || typeof h !== "object") return;
    h.index = idx(h.index, fallbackIndex);
    h.label = String(h.label ?? "").slice(0, 80);
    h.icon = String(h.icon ?? "fa-solid fa-cloud");
    h.description = String(h.description ?? "");
    h.temperature = String(h.temperature ?? "");
    h.effectNote = String(h.effectNote ?? "");
    // Disallowed faces (cookbook red Ø): keep only valid, de-duplicated directions.
    h.disallow = Array.isArray(h.disallow)
      ? [...new Set(h.disallow.filter(d => WEATHER_DIRECTIONS.includes(d)))]
      : [];
    const e = h.effect ?? (h.effect = {});
    e.archetype = WEATHER_ARCHETYPES.includes(e.archetype) ? e.archetype : "clear";
    e.intensity = clamp01(e.intensity ?? 0.5);
    e.tintParticle = hex6(e.tintParticle, "#cfe8ff");
    e.tintGlow = hex6(e.tintGlow, "#7fb4e6");
    e.drift = ["fall", "rise", "left", "right", "still"].includes(e.drift) ? e.drift : "fall";
    e.ominous = !!e.ominous;
    if (typeof e.kind !== "string") e.kind = "";
  }

  static _sanitizeNav(nav) {
    if (!nav || typeof nav !== "object") return;
    nav.dice = WEATHER_DICE.includes(nav.dice) ? nav.dice : "2d6";
    const map = nav.directionMap ?? (nav.directionMap = {});
    for (const [total, dir] of Object.entries(map)) {
      if (dir !== "stay" && !WEATHER_DIRECTIONS.includes(dir)) delete map[total];
    }
    const edges = nav.edgeRules ?? (nav.edgeRules = {});
    for (const dir of WEATHER_DIRECTIONS) {
      const rule = edges[dir];
      if (rule === "wrap" || rule === "stay") continue;
      if (rule && typeof rule === "object" && Number.isInteger(rule.divert)) { edges[dir] = { divert: idx(rule.divert, 0) }; continue; }
      edges[dir] = "wrap";
    }
  }
}
