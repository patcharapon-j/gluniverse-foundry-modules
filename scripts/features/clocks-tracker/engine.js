/**
 * TimeEngine — the bridge between Foundry's native GameTime/CalendarData and
 * the module's Year Zero–style shift/stretch presentation.
 *
 * worldTime (seconds) is the single source of truth. Date fields come from the
 * native calendar components; the shift/stretch breakdown is derived from the
 * intra-day seconds so the two can never drift.
 */

import * as M from "./time-math.js";
import { WATCHES, DEFAULT_SHIFT_NAMES, SETTINGS, MODULE_ID } from "./const.js";

function getSetting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); }
  catch { return fallback; }
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

export class TimeEngine {
  static get worldTime() { return game.time.worldTime; }
  static get calendar() { return game.time.calendar; }
  static get components() { return game.time.components; }

  /** Customizable watch names, falling back to defaults. */
  static get shiftNames() {
    const custom = getSetting(SETTINGS.shiftNames, null);
    if (Array.isArray(custom) && custom.length === WATCHES.length) return custom;
    return DEFAULT_SHIFT_NAMES;
  }

  /**
   * Current mission countdown config (world setting). A "mission" pins a target
   * world time; the HUD then counts the stretches remaining until it. `target`
   * is an absolute world time in seconds, snapped to a stretch boundary.
   */
  static get mission() {
    const m = getSetting(SETTINGS.mission, null);
    if (!m || typeof m !== "object") return { active: false, target: 0, label: "", kind: "goal" };
    return {
      active: !!m.active,
      target: Number(m.target) || 0,
      label: typeof m.label === "string" ? m.label : "",
      // "goal" = count down to reaching a target; "deadline" = a time limit.
      kind: m.kind === "deadline" ? "deadline" : "goal"
    };
  }

  /** Resolve calendar components to a stretch-snapped world time (no mutation). */
  static componentsToWorldTime(components) {
    const cal = this.calendar;
    if (typeof cal?.componentsToTime !== "function") return null;
    const month = components.month ?? 0;
    const dayOfMonth = components.dayOfMonth ?? 0;
    const resolved = { ...components, month, dayOfMonth, day: this.dayOfYear(month, dayOfMonth) };
    return M.snapToStretch(cal.componentsToTime(resolved));
  }

  /** Day-of-year (0-based) for a calendar position, using month lengths. */
  static dayOfYear(monthIndex, dayOfMonth0) {
    const months = this.calendar?.months?.values ?? [];
    let doy = 0;
    for (let i = 0; i < monthIndex && i < months.length; i++) doy += months[i].days ?? 0;
    return doy + dayOfMonth0;
  }

  /**
   * Weekday index for a calendar position, treating intercalary days as
   * sitting *outside* the weekday cycle.
   *
   * Foundry's native `dayOfWeek` counts every elapsed day, including
   * intercalary ones. For a calendar like Ourolyn — whose year is 12 × 32 days
   * plus a single intercalary "Day of Renewal" — that extra day shifts the
   * starting weekday by one every year, so months drift away from always
   * beginning on Earthday. By excluding intercalary days from the count we
   * honour the design intent: every year (and every 4-week month) begins on the
   * same weekday. Calendars whose months all align to the week defer to
   * Foundry's native computation, which already handles leap years correctly.
   *
   * A month counts as "outside the cycle" if it's flagged `intercalary` or is
   * shorter than a full week (e.g. festival days) — the flag alone is not
   * reliable because Foundry can drop it from the live calendar data.
   */
  static weekdayOf(year, monthIndex, dayOfMonth0 = 0) {
    const cal = this.calendar;
    const days = cal?.days?.values ?? [];
    const wdCount = days.length || 7;
    const months = cal?.months?.values ?? [];
    const outOfCycle = m => m.intercalary || (m.days ?? 0) < wdCount;
    const hasOutOfCycle = months.some(outOfCycle);

    if (!hasOutOfCycle) {
      // Native handles leap years; pass an explicit day-of-year because
      // componentsToTime resolves position from `day`, not month/dayOfMonth.
      try {
        const day = this.dayOfYear(monthIndex, dayOfMonth0);
        const t = cal.componentsToTime({ year, month: monthIndex, dayOfMonth: dayOfMonth0, day, hour: 0, minute: 0, second: 0 });
        const wd = cal.timeToComponents(t).dayOfWeek;
        if (Number.isInteger(wd)) return ((wd % wdCount) + wdCount) % wdCount;
      } catch { /* fall through to arithmetic */ }
    }

    const firstWeekday = cal?.years?.firstWeekday ?? 0;
    const yearZero = cal?.years?.yearZero ?? 0;
    const perYear = months.reduce((a, m) => a + (outOfCycle(m) ? 0 : (m.days ?? 0)), 0) || wdCount;
    let before = 0;
    for (let i = 0; i < monthIndex && i < months.length; i++) {
      if (!outOfCycle(months[i])) before += months[i].days ?? 0;
    }
    const inMonth = outOfCycle(months[monthIndex] ?? {}) ? 0 : dayOfMonth0;
    const total = (year - yearZero) * perYear + before + inMonth;
    return ((firstWeekday + total) % wdCount + wdCount) % wdCount;
  }

  static get daysPerYear() {
    return this.calendar?.days?.daysPerYear
      ?? (this.calendar?.months?.values ?? []).reduce((a, m) => a + (m.days ?? 0), 0)
      ?? 365;
  }

  /** Full HUD state snapshot at the current world time. */
  static getState() {
    return this.getStateAt(this.worldTime);
  }

  /** Full HUD state snapshot at an arbitrary world time (used for animation tweens). */
  static getStateAt(worldTime) {
    const c = this.calendar?.timeToComponents?.(worldTime) ?? this.components;
    const cal = this.calendar;
    const second = c.second ?? 0;
    const secOfDay = (c.hour ?? 0) * 3600 + (c.minute ?? 0) * 60 + second;
    const t = M.decompose(secOfDay); // intra-day shift/stretch (dayOffset always 0 here)

    const watch = WATCHES[t.shiftIndex] ?? WATCHES[0];
    const names = this.shiftNames;

    const months = cal?.months?.values ?? [];
    const days = cal?.days?.values ?? [];
    const seasons = cal?.seasons?.values ?? [];
    const month = months[c.month] ?? null;
    const weekday = days[this.weekdayOf(c.year, c.month, c.dayOfMonth ?? 0)] ?? days[c.dayOfWeek] ?? null;
    const season = seasons[c.season] ?? null;

    const dayNum = (c.dayOfMonth ?? 0) + 1;
    const absDay = Math.floor(worldTime / M.SECONDS_PER_DAY);
    const moonPhase = ((Math.floor(((absDay % 28) / 28) * 8)) % 8 + 8) % 8;

    // Mission countdown: stretches remaining until the pinned target, plus where
    // the target falls within the current shift (so the meter can flag it). All
    // derived from absolute stretch indices so it's day/shift-agnostic.
    const mission = this.mission;
    let missionState = { active: false, kind: "goal", label: "", stretchesLeft: 0, reached: false, targetStretchInShift: -1 };
    if (mission.active) {
      const absStretch = M.stretchIndexFromSeconds(worldTime);
      const targetAbs = M.stretchIndexFromSeconds(mission.target);
      const left = targetAbs - absStretch;
      const shiftStartAbs = absStretch - t.stretchInShift;
      missionState = {
        active: true,
        kind: mission.kind,
        label: mission.label,
        target: mission.target,
        stretchesLeft: Math.max(0, left),
        reached: left <= 0,
        targetStretchInShift: targetAbs - shiftStartAbs
      };
    }

    return {
      worldTime,
      isGM: game.user?.isGM ?? false,
      inCombat: !!game.combat?.started,

      shiftIndex: t.shiftIndex,
      stretchOfDay: t.stretchOfDay,
      stretchInShift: t.stretchInShift,
      hourOfShift: t.hourOfShift,
      stretchInHour: t.stretchInHour,
      stretchesLeftInShift: t.stretchesLeftInShift,
      shiftProgress: t.shiftProgress,
      clock: M.formatClock(t),

      watch: { key: watch.key, name: names[t.shiftIndex] ?? watch.key, ...watch },

      mission: missionState,

      date: {
        day: dayNum,
        ordinal: ordinal(dayNum),
        weekday: weekday?.name ?? "",
        monthName: month?.name ?? "",
        monthAbbr: month?.abbreviation ?? month?.name ?? "",
        year: c.year,
        yearLabel: getSetting(SETTINGS.yearLabel, ""),
        dayOfYear: c.day
      },
      seasonName: season?.name ?? "",
      moonPhase,

      events: this.resolveEvents(c)
    };
  }

  /** Resolve today's events and the nearest upcoming one for the viewer. */
  static resolveEvents(components) {
    const all = getSetting(SETTINGS.events, []) ?? [];
    const isGM = game.user?.isGM ?? false;
    const visible = all.filter(e => isGM || e.visibleToPlayers);

    const curMonth = components.month;
    const curDay = (components.dayOfMonth ?? 0) + 1;
    const curDOY = components.day;
    const yearLen = this.daysPerYear;

    const today = [];
    const pinned = [];   // events the GM flagged to always show, ordered by nearness
    let next = null;

    for (const e of visible) {
      const isToday = this.matchesToday(e, curMonth, curDay);
      if (isToday) { today.push(e); continue; }

      // distance (in days) to this event's start, wrapping across the year
      const startDOY = this.dayOfYear(e.month ?? 0, (e.day ?? 1) - 1);
      const delta = ((startDOY - curDOY) % yearLen + yearLen) % yearLen;
      if (delta <= 0) continue;
      if (e.pinned) pinned.push({ name: e.name, days: delta });
      if (!next || delta < next.days) next = { name: e.name, days: delta };
    }

    pinned.sort((a, b) => a.days - b.days);
    return { today, next, pinned };
  }

  static matchesToday(e, curMonth, curDay) {
    switch (e.scope) {
      case "month": return e.month === curMonth;
      case "range": {
        if (e.month === e.endMonth) return curMonth === e.month && curDay >= e.day && curDay <= e.endDay;
        if (curMonth === e.month) return curDay >= e.day;
        if (curMonth === e.endMonth) return curDay <= e.endDay;
        return curMonth > e.month && curMonth < e.endMonth;
      }
      case "day":
      default: return e.month === curMonth && e.day === curDay;
    }
  }

  /* ----------------------------- mutations ----------------------------- */

  /** Advance (or rewind) by a named step, snapped to clean stretch boundaries. */
  static async advanceStep(step, { rewind = false } = {}) {
    let seconds = M.stepToSeconds(step);
    if (!seconds) return this.worldTime;
    if (rewind) seconds = -seconds;
    return game.time.advance(seconds);
  }

  /** Advance an arbitrary number of seconds (kept on a stretch boundary). */
  static async advanceSeconds(seconds) {
    return game.time.advance(Math.round(seconds / M.SECONDS_PER_STRETCH) * M.SECONDS_PER_STRETCH);
  }

  /** Jump forward to the start of the next watch/shift. */
  static async nextShift() {
    return game.time.advance(M.secondsToNextShift(this.worldTime));
  }

  /** Set an absolute time from calendar components (used by the set-time dialog). */
  static async setExact(components) {
    const cal = this.calendar;
    if (typeof cal?.componentsToTime !== "function") return game.time.set(components);

    // Foundry resolves a calendar position from `day` (the 0-based day-of-year),
    // which is the authoritative field produced by timeToComponents. Passing
    // only month + dayOfMonth is not honored — componentsToTime falls back to
    // day 0, landing on the first day of the year regardless of the chosen
    // month. Compute the day-of-year ourselves and pass a fully consistent set
    // of components so the resulting date matches what the GM selected.
    const month = components.month ?? 0;
    const dayOfMonth = components.dayOfMonth ?? 0;
    const resolved = {
      ...components,
      month,
      dayOfMonth,
      day: this.dayOfYear(month, dayOfMonth)
    };
    return game.time.set(cal.componentsToTime(resolved));
  }
}
