/**
 * WeatherEngine — the Hex Flower Game Engine rules (mirrors TimeEngine's shape:
 * a static class, world state is the source of truth, all mutations are GM-only).
 *
 * One "step" rolls the active Navigation Hex, maps the total to a hex-face
 * direction, walks one cell (applying edge rules at the flower's rim), and logs
 * the move. The walk auto-advances as in-game time passes (cadence, §5.2) and
 * remaps by coordinate across calendar seasons (§5.3). See docs/weather-system-spec.md.
 */

import { MODULE_ID, FLAG_NS, SETTINGS, HOOKS, WEATHER_HISTORY_CAP, WEATHER_STEP_CAP, WEATHER_DIRECTIONS } from "../const.js";
import { SECONDS_PER_DAY, SECONDS_PER_SHIFT } from "../time-math.js";
import { resolveMove, rotateDirection, moveFlowerSvg } from "./hex-geometry.js";
import { WeatherStore } from "./weather-store.js";

export class WeatherEngine {
  /* ------------------------------ resolvers ------------------------------ */

  /** The calendar season index as a string key (decision #10 season keying). */
  static currentSeasonKey() {
    try {
      const s = game.time?.components?.season;
      if (Number.isInteger(s)) return String(s);
    } catch { /* ignore */ }
    return "0";
  }

  /**
   * The season entry to use for `key`: an exact match, else the first defined
   * season (documented fallback for climates without a full per-season set).
   */
  static resolveSeason(climate, key) {
    const seasons = climate?.seasons ?? {};
    if (Array.isArray(seasons[key]?.hexes)) return seasons[key];
    const firstKey = Object.keys(seasons)[0];
    return firstKey ? seasons[firstKey] : null;
  }

  /** The active Navigation Hex: the season override, else climate.defaultNav. */
  static activeNav(climate, key) {
    const season = this.resolveSeason(climate, key);
    return season?.nav ?? climate?.defaultNav ?? null;
  }

  /** First defined season key (the only flower for a non-seasonal climate). */
  static firstSeasonKey(climate) {
    return Object.keys(climate?.seasons ?? {})[0] ?? "0";
  }

  /**
   * The season key a region should use: the live calendar season for seasonal
   * climates, or the region's single fixed flower when `climate.seasonal` is off
   * (a "single flower for all time" region, decision: per-region seasonal toggle).
   */
  static seasonKeyForRegion(region) {
    const climate = region?.climate;
    if (climate && climate.seasonal === false) return this.firstSeasonKey(climate);
    return this.currentSeasonKey();
  }

  /**
   * Current condition snapshot for the chip + window (decision #5.5). Always
   * available to every viewer — the current weather is never hidden.
   */
  static getCurrent() {
    const data = WeatherStore.data;
    const region = WeatherStore.region(data);
    if (!region) return null;
    const { climate, state } = region;
    const seasonKey = this.seasonKeyForRegion(region);
    const season = this.resolveSeason(climate, seasonKey);
    const hex = season?.hexes?.[state.currentIndex] ?? null;
    return {
      hex,
      index: state.currentIndex,
      seasonKey,
      seasonName: season?.name ?? "",
      regionKey: WeatherStore.activeRegionKey(data),
      regionName: region.name ?? "",
      seasonal: climate?.seasonal !== false,
      climate,
      season,
      nav: this.activeNav(climate, seasonKey),
      history: state.history ?? []
    };
  }

  /* ------------------------------ cadence math ------------------------------ */

  /** Seconds per cadence period (decision #2 period setting). */
  static periodSeconds() {
    const p = WeatherStore.cadencePeriod;
    if (p === "shift") return SECONDS_PER_SHIFT;
    const m = /^days:(\d+)$/.exec(p);
    if (m) return Math.max(1, parseInt(m[1], 10)) * SECONDS_PER_DAY;
    return SECONDS_PER_DAY;
  }

  /** The absolute period index of a world time (cadence/skip math). */
  static currentPeriodIndex(worldTime = game.time.worldTime) {
    return Math.floor(worldTime / this.periodSeconds());
  }

  /* ------------------------------ rolling ------------------------------ */

  /**
   * Roll the NH dice as a real Foundry Roll. When `show` is requested AND the GM
   * has the "3D dice" setting on AND Dice So Nice is installed, animate the dice
   * for everyone (synchronized) before returning the total.
   */
  static async rollDie(nav, { show = false } = {}) {
    const formula = nav?.dice === "d6+d8" ? "1d6 + 1d8" : "2d6";
    const roll = await new Roll(formula).evaluate();
    if (show && WeatherStore.showDice && game.dice3d) {
      try { await game.dice3d.showForRoll(roll, game.user, true); }
      catch (err) { console.warn(`${MODULE_ID} | Weather: Dice So Nice roll failed`, err); }
    }
    return { roll, total: roll.total };
  }

  /**
   * Resolve one walk from `from` given a roll total: map total → direction,
   * apply the optional ±N modifier (decision #15), then walk a cell honouring
   * the edge rule. Returns { to, dir, edge }.
   */
  static resolveStep(climate, seasonKey, from, total, directionModifier = 0) {
    const nav = this.activeNav(climate, seasonKey);
    let dir = nav?.directionMap?.[String(total)] ?? "stay";
    if (dir !== "stay" && directionModifier) dir = rotateDirection(dir, directionModifier);
    if (dir === "stay") return { to: from, dir: "stay", edge: false };
    // Per-hex disallowed faces (the cookbook's red Ø, §"Edge Rules"): rolling into
    // a blocked face keeps you in the current hex. Takes precedence over the NH's
    // edge rule, and applies whether or not the face actually leaves the flower.
    const fromHex = this.resolveSeason(climate, seasonKey)?.hexes?.[from];
    if (Array.isArray(fromHex?.disallow) && fromHex.disallow.includes(dir)) {
      return { to: from, dir: "stay", edge: true, blocked: dir };
    }
    const r = resolveMove(from, dir, nav?.edgeRules?.[dir] ?? "wrap");
    return { to: r.to, dir, edge: r.edge };
  }

  /** Mutate `state` by one step in-memory; returns the history record. */
  static async _applyStep(climate, state, seasonKey, { show = false, directionModifier = 0 } = {}) {
    const nav = this.activeNav(climate, seasonKey);
    const from = state.currentIndex;
    const { total } = await this.rollDie(nav, { show });
    const { to, dir } = this.resolveStep(climate, seasonKey, from, total, directionModifier);
    const rec = { worldTime: game.time.worldTime, from, to, roll: total, dir, seasonKey };
    state.history.push(rec);
    if (state.history.length > WEATHER_HISTORY_CAP) state.history.shift();
    state.currentIndex = to;
    state.lastSeasonKey = seasonKey;
    return rec;
  }

  /* ------------------------------ forecast (next-step odds) ------------------------------ */

  /**
   * Every equally-likely roll total for a dice formula, as a flat array (so its
   * length is the denominator and each entry's frequency is its weight). 2d6 →
   * 36 totals (2..12), d6+d8 → 48 totals (2..14).
   */
  static _diceTotals(dice) {
    const faces = dice === "d6+d8" ? [6, 8] : [6, 6];
    let totals = [0];
    for (const f of faces) {
      const next = [];
      for (const t of totals) for (let i = 1; i <= f; i++) next.push(t + i);
      totals = next;
    }
    return totals;
  }

  /**
   * Probability of each possible next condition from the current hex, under the
   * active Navigation Hex (decision #15 modifier defaults to 0). Enumerates every
   * equally-likely roll total, resolves the walk (honouring blocked faces + edge
   * rules), then groups the landing hexes by condition (label+icon).
   *
   * Returns a list sorted by descending probability:
   *   { label, icon, prob (0..1), ominous, tintGlow, stay (includes current hex) }
   */
  static forecast(cur = this.getCurrent()) {
    if (!cur?.season || !cur.nav) return null;
    const { climate, seasonKey, index, season } = cur;
    const totals = this._diceTotals(cur.nav.dice);
    const denom = totals.length || 1;

    // roll total → landing index, accumulated as a hit count per destination.
    const byIndex = new Map();
    for (const total of totals) {
      const { to } = this.resolveStep(climate, seasonKey, index, total, 0);
      byIndex.set(to, (byIndex.get(to) ?? 0) + 1);
    }

    // collapse destinations that share a condition (same label + icon) so the
    // reading is "X% Storm" rather than one row per identical hex.
    const groups = new Map();
    for (const [to, count] of byIndex) {
      const hex = season.hexes?.[to] ?? null;
      const key = `${hex?.label ?? "?"}|${hex?.icon ?? ""}`;
      const g = groups.get(key) ?? {
        label: hex?.label ?? "?",
        icon: hex?.icon ?? "fa-solid fa-cloud",
        count: 0,
        ominous: !!hex?.effect?.ominous,
        tintGlow: hex?.effect?.tintGlow ?? "#7fb4e6",
        stay: false
      };
      g.count += count;
      if (to === index) g.stay = true;
      groups.set(key, g);
    }

    return [...groups.values()]
      .map(g => ({ ...g, prob: g.count / denom }))
      .sort((a, b) => b.prob - a.prob || b.stay - a.stay);
  }

  /* ------------------------------ public mutations (GM) ------------------------------ */

  /**
   * One manual step (decision #15: accepts a directionModifier nudge — no UI in
   * v1, the parameter is the documented extension point for player-nudge). Shows
   * Dice So Nice, fires the change hook (the window animates), and posts a card.
   */
  static async step({ directionModifier = 0, manual = true } = {}) {
    if (!game.user.isGM || !WeatherStore.configured) return null;
    const data = WeatherStore.data;
    const region = WeatherStore.region(data);
    const { climate, state } = region;
    const seasonKey = this.seasonKeyForRegion(region);

    const rec = await this._applyStep(climate, state, seasonKey, { show: manual, directionModifier });
    // keep the cadence counter in step so an auto-tick doesn't double-fire now
    state.lastDayIndex = this.currentPeriodIndex();

    await WeatherStore.save(data, { payload: { reason: "step", rec, manual } });
    if (rec.to !== rec.from) await this.postConditionCard(climate, seasonKey, rec.to, { roll: rec.roll, dir: rec.dir, from: rec.from });
    return rec;
  }

  /** Pop the last `n` history entries from a state in-place; returns # popped. */
  static _popState(state, n) {
    let popped = 0;
    for (let i = 0; i < n && state.history.length; i++) {
      const rec = state.history.pop();
      state.currentIndex = rec.from;
      if (rec.seasonKey != null) state.lastSeasonKey = rec.seasonKey;
      popped++;
    }
    return popped;
  }

  /** Pop the last `n` history entries on the active region (decision #5.4). */
  static async rewind(n = 1, { data = null } = {}) {
    if (!game.user.isGM) return null;
    const d = data ?? WeatherStore.data;
    const region = WeatherStore.region(d);
    const state = region?.state;
    if (!state) return null;
    const popped = this._popState(state, n);
    state.lastDayIndex = this.currentPeriodIndex();
    await WeatherStore.save(d, { payload: { reason: "rewind", count: popped } });
    return popped;
  }

  /** GM force-set the current hex (window control); logs a step for rewind. */
  static async setCurrent(index) {
    if (!game.user.isGM || !WeatherStore.configured) return null;
    const data = WeatherStore.data;
    const region = WeatherStore.region(data);
    const { climate, state } = region;
    const seasonKey = this.seasonKeyForRegion(region);
    const from = state.currentIndex;
    const to = Math.trunc(Number(index));
    if (!(to >= 0 && to < 19) || to === from) return null;
    state.history.push({ worldTime: game.time.worldTime, from, to, roll: null, dir: "set", seasonKey });
    if (state.history.length > WEATHER_HISTORY_CAP) state.history.shift();
    state.currentIndex = to;
    state.lastSeasonKey = seasonKey;
    state.lastDayIndex = this.currentPeriodIndex();
    await WeatherStore.save(data, { payload: { reason: "set", from, to } });
    await this.postConditionCard(climate, seasonKey, to, { dir: "set", from });
    return to;
  }

  /* ------------------------------ cadence driver ------------------------------ */

  /**
   * Called from the updateWorldTime hook on the primary GM only. Handles season
   * remap (§5.3), auto stepping forward (§5.2), and backward rewind across a
   * period boundary. Manual mode never auto-steps.
   */
  static async evaluate() {
    if (!WeatherStore.enabled || !WeatherStore.configured) return;
    if (!game.user.isGM) return;
    if (game.users.activeGM?.id !== game.user.id) return;   // primary GM only (no double-stepping)
    if (this._busy) return;                                  // re-entrancy guard (rapid updateWorldTime)
    this._busy = true;
    try { await this._evaluate(); }
    finally { this._busy = false; }
  }

  /** While delving mode is live, weather is turn-driven — the time-period
   *  auto-cadence steps aside (read via settings to avoid a circular import). */
  static _delvingSuspendsCadence() {
    try {
      if (!game.settings.get(MODULE_ID, SETTINGS.delvingEnabled)) return false;
      return !!game.settings.get(MODULE_ID, SETTINGS.delving)?.active;
    } catch { return false; }
  }

  /**
   * Re-seed every region's cadence counter to "now" without walking. Used when
   * delving mode releases control back to the time-period engine, so resuming
   * normal time doesn't make the weather retroactively walk for the elapsed delve.
   */
  static async reseedCadence() {
    if (!game.user.isGM) return;
    if (!WeatherStore.enabled || !WeatherStore.configured) return;
    const data = WeatherStore.data;
    const periodIdx = this.currentPeriodIndex();
    let dirty = false;
    for (const region of Object.values(data.regions ?? {})) {
      if (!region?.state) continue;
      region.state.lastDayIndex = periodIdx;
      region.state.lastSeasonKey = this.seasonKeyForRegion(region);
      dirty = true;
    }
    if (dirty) await WeatherStore.save(data, { payload: { reason: "reseed" } });
  }

  static async _evaluate() {
    if (this._delvingSuspendsCadence()) return;
    const data = WeatherStore.data;
    const activeKey = WeatherStore.activeRegionKey(data);
    const periodIdx = this.currentPeriodIndex();

    // Every region keeps its own living walk (decision: regions tick independently).
    // Only the active region announces in chat; the rest evolve silently so a swap
    // reveals that locale's own weather.
    let dirty = false;
    let activeCard = null;
    for (const [key, region] of Object.entries(data.regions ?? {})) {
      if (!region?.state || !WeatherStore.regionConfigured(region)) continue;
      const res = await this._evaluateRegion(region, periodIdx, key === activeKey);
      if (res.dirty) dirty = true;
      if (key === activeKey && res.card) activeCard = res.card;
    }

    if (dirty) await WeatherStore.save(data, { payload: { reason: "auto" } });
    if (activeCard) await this._postEvalCard(activeCard);
  }

  /**
   * Advance ONE region in-memory (no save, no chat). Returns { dirty, card };
   * `card` is the announcement to post, honoured only for the active region.
   * Mirrors §5.2 (cadence) + §5.3 (season remap), per region.
   */
  static async _evaluateRegion(region, periodIdx, isActive) {
    const { climate, state } = region;
    const seasonKey = this.seasonKeyForRegion(region);

    // First run after enabling: seed counters without walking.
    if (state.lastDayIndex === null || state.lastDayIndex === undefined) {
      state.lastDayIndex = periodIdx;
      state.lastSeasonKey = seasonKey;
      return { dirty: true };
    }

    // Season remap (decision #10) — only for season-following regions.
    let seasonChanged = false;
    if (climate?.seasonal !== false && state.lastSeasonKey !== seasonKey) {
      state.lastSeasonKey = seasonKey;
      seasonChanged = true;
    }

    const manualMode = WeatherStore.cadenceMode === "manual";
    const elapsed = periodIdx - state.lastDayIndex;

    if (manualMode || elapsed === 0) {
      state.lastDayIndex = periodIdx;          // keep counter synced
      if (seasonChanged) return { dirty: true, card: { kind: "season", climate, seasonKey, index: state.currentIndex } };
      return { dirty: false };
    }

    if (elapsed < 0) {
      // GM rewound time across a boundary → pop that many steps.
      this._popState(state, Math.min(-elapsed, state.history.length));
      state.lastDayIndex = periodIdx;
      return { dirty: true };
    }

    // Forward: run min(elapsed, cap) silent steps, then one card or a digest.
    const steps = Math.min(elapsed, WEATHER_STEP_CAP);
    const startIndex = state.currentIndex;
    const records = [];
    // Animate the dice only for the common single-period advance, and only for the
    // active region — a multi-day skip or a background region must not flood the
    // table with sequential 3D rolls.
    const showDice = isActive && steps === 1;
    for (let i = 0; i < steps; i++) {
      records.push(await this._applyStep(climate, state, seasonKey, { show: showDice }));
    }
    state.lastDayIndex = periodIdx;

    if (!isActive) return { dirty: true };

    const changed = records.filter(r => r.to !== r.from);
    if (steps === 1 && changed.length === 1) {
      return { dirty: true, card: { kind: "condition", climate, seasonKey, index: state.currentIndex, from: records[0].from, roll: records[0].roll, dir: records[0].dir } };
    }
    if (changed.length > 0 || startIndex !== state.currentIndex) {
      return { dirty: true, card: { kind: "digest", climate, seasonKey, fromIndex: startIndex, toIndex: state.currentIndex, records, elapsed } };
    }
    return { dirty: true };
  }

  /** Post the announcement chosen by _evaluateRegion (active region only). */
  static async _postEvalCard(c) {
    if (c.kind === "condition") return this.postConditionCard(c.climate, c.seasonKey, c.index, { roll: c.roll, dir: c.dir, from: c.from });
    if (c.kind === "season") return this.postConditionCard(c.climate, c.seasonKey, c.index, { dir: "season" });
    if (c.kind === "digest") return this.postDigestCard(c.climate, c.seasonKey, c.fromIndex, c.toIndex, c.records, c.elapsed);
  }

  /* ------------------------------ chat cards (§5.6) ------------------------------ */

  static _hexAt(climate, seasonKey, index) {
    return this.resolveSeason(climate, seasonKey)?.hexes?.[index] ?? null;
  }

  /** Compact, on-brand announcement card; tinted to the weather, dread when ominous. */
  static async postConditionCard(climate, seasonKey, index, meta = {}) {
    if (!game.user.isGM) return;
    const season = this.resolveSeason(climate, seasonKey);
    const hex = season?.hexes?.[index];
    if (!hex) return;
    const content = this._cardHtml({ hex, index, seasonName: season?.name ?? "", meta });
    return this._post(content);
  }

  /** One digest card for a multi-step skip (decision #3) — start → end + path. */
  static async postDigestCard(climate, seasonKey, fromIndex, toIndex, records, elapsed) {
    if (!game.user.isGM) return;
    const season = this.resolveSeason(climate, seasonKey);
    const fromHex = season?.hexes?.[fromIndex];
    const toHex = season?.hexes?.[toIndex];
    if (!toHex) return;
    const e = toHex.effect ?? {};
    const omin = e.ominous ? " ominous" : "";
    const steps = records.length;
    const trail = records.slice(-8).map(r => {
      const h = season?.hexes?.[r.to];
      return `<span class="wc-step"><i class="${foundry.utils.escapeHTML(h?.icon ?? "fa-solid fa-cloud")}"></i></span>`;
    }).join('<span class="wc-arrow">›</span>');

    const flower = moveFlowerSvg(fromIndex, toIndex);
    const content =
      `<div class="glct-chatcard glct-weathercard digest${omin}" style="--wtint:${e.tintParticle || "#cfe8ff"};--wglow:${e.tintGlow || "#7fb4e6"}">
        <div class="glct-cc-head">
          <span class="glct-cc-ico"><i class="${foundry.utils.escapeHTML(toHex.icon ?? "fa-solid fa-cloud")}"></i></span>
          <span class="glct-cc-title"><span class="n">${foundry.utils.escapeHTML(toHex.label ?? "")}</span>` +
          `<span class="s">${game.i18n.format("GLCT.weather.digestSub", { n: elapsed ?? steps })}</span></span>
        </div>
        <div class="glct-cc-body${flower ? " wc-body-move" : ""}">
          ${flower}
          <div class="wc-move-info">
            <div class="wc-from">${game.i18n.format("GLCT.weather.digestFrom", { from: foundry.utils.escapeHTML(fromHex?.label ?? "?") })}</div>
            <div class="wc-trail">${trail}</div>
            ${toHex.temperature ? `<div class="wc-temp"><i class="fa-solid fa-temperature-half"></i> ${foundry.utils.escapeHTML(toHex.temperature)}</div>` : ""}
          </div>
        </div>
      </div>`;
    return this._post(content);
  }

  static _cardHtml({ hex, index, seasonName, meta }) {
    const e = hex.effect ?? {};
    const omin = e.ominous ? " ominous" : "";
    const sub = [seasonName, hex.temperature].filter(Boolean).join(" · ");
    const note = hex.effectNote
      ? `<div class="wc-note"><i class="fa-solid fa-triangle-exclamation"></i> ${foundry.utils.escapeHTML(hex.effectNote)}</div>` : "";
    const desc = hex.description ? `<div class="wc-desc">${foundry.utils.escapeHTML(hex.description)}</div>` : "";
    const move = this._moveHtml(meta?.from, index, meta);
    return `<div class="glct-chatcard glct-weathercard${omin}" style="--wtint:${e.tintParticle || "#cfe8ff"};--wglow:${e.tintGlow || "#7fb4e6"}">
        <div class="glct-cc-head">
          <span class="glct-cc-ico"><i class="${foundry.utils.escapeHTML(hex.icon ?? "fa-solid fa-cloud")}"></i></span>
          <span class="glct-cc-title"><span class="n">${foundry.utils.escapeHTML(hex.label ?? "")}</span>` +
          `<span class="s">${foundry.utils.escapeHTML(sub)}</span></span>
          ${e.ominous ? '<span class="wc-haz"><i class="fa-solid fa-skull"></i></span>' : ""}
        </div>
        <div class="glct-cc-body">${move}${desc}${note}</div>
      </div>`;
  }

  /** Per-direction clockwise rotation (deg) for the caption's arrow glyph. */
  static _DIR_DEG = { up: 0, upperRight: 60, lowerRight: 120, down: 180, lowerLeft: 240, upperLeft: 300 };

  /**
   * The "how the weather moved this turn" element: a mini hex flower with an arrow
   * from the previous cell to the new one, plus a caption (compass direction + the
   * Navigation roll). Returns "" when there was no real move to depict.
   */
  static _moveHtml(fromIndex, toIndex, meta = {}) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return "";
    const svg = moveFlowerSvg(fromIndex, toIndex);
    if (!svg) return "";
    const dir = meta.dir;
    const dirLine = WEATHER_DIRECTIONS.includes(dir)
      ? `<span class="wc-move-dir"><i class="fa-solid fa-arrow-up" style="transform:rotate(${this._DIR_DEG[dir] ?? 0}deg)"></i>${game.i18n.localize("GLCT.weather.dir." + dir)}</span>`
      : "";
    const rollLine = (meta.roll != null && Number.isFinite(Number(meta.roll)))
      ? `<span class="wc-move-roll">${game.i18n.format("GLCT.weather.cardRoll", { roll: meta.roll })}</span>` : "";
    const cap = (dirLine || rollLine) ? `<div class="wc-move-cap">${dirLine}${rollLine}</div>` : "";
    return `<div class="wc-move">${svg}${cap}</div>`;
  }

  static _post(content) {
    // Card visibility is a GM setting (decision D3): "public" posts to everyone,
    // "gm" whispers to the GMs only so players discover the weather in-fiction.
    // The current condition itself is always readable on the HUD/window regardless.
    const speaker = ChatMessage.implementation.getSpeaker({ alias: game.i18n.localize("GLCT.weather.cardAlias") });
    const data = { speaker, content, flags: { [MODULE_ID]: { [FLAG_NS]: { weatherCard: true } } } };
    if (WeatherStore.cardVisibility === "gm") {
      data.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    }
    return ChatMessage.implementation.create(data);
  }
}
