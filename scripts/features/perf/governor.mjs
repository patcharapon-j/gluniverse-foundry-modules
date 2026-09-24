/**
 * Performance — the Auto governor.
 *
 * Pure: `tools/perf-check.mjs` drives it with synthetic frame streams.
 *
 * The governor answers one question on a slow cadence: should this client run
 * one tier cheaper, one tier better, or stay? It is deliberately asymmetric —
 * quick to step down, slow to step back — because the two mistakes cost very
 * different amounts. Stepping down a second late is a second of stutter;
 * stepping up a second early is a sawtooth that never ends, every effect
 * flickering in and out on a ten-second beat.
 *
 * Down is judged on INTERVALS (what the player feels). Up is judged on WORK
 * (main-thread time inside the canvas frame), because intervals are quantised
 * to the display's refresh and can never show headroom. See core/budget.mjs.
 */

import { AUTO_RANGE } from "./tiers.mjs";

export const GOVERNOR = Object.freeze({
  /** How often the governor evaluates, ms. */
  cadenceMs: 250,
  /** Sustained over-budget time before a step down. */
  downAfterMs: 2000,
  /** Sustained headroom before a step up. */
  upAfterMs: 10000,
  /** Interval p95 must exceed budget × this to count as over. The margin eats
   *  the ±1 ms rAF jitter that a display at exactly the target always shows. */
  overRatio: 1.2,
  /** Work p95 must be under budget × this to count as headroom. */
  upRatio: 0.7,
  /** Quiet period after a scene change or a policy change. */
  settleMs: 3000,
  /** Minimum work samples before headroom is believed at all. */
  minWorkSamples: 60,
});

export class Governor {
  /**
   * @param {{ budgetMs: number }} opts
   */
  constructor({ budgetMs }) {
    this.budgetMs = budgetMs;
    this.index = 0;
    this.overFor = 0;
    this.underFor = 0;
    this.settleUntil = 0;
    this.lastAt = 0;
  }

  get tier() {
    return AUTO_RANGE[this.index];
  }

  setBudget(ms) {
    this.budgetMs = ms;
  }

  /** Start a quiet period: loads are not a slow machine. */
  settle(now) {
    this.settleUntil = now + GOVERNOR.settleMs;
    this.overFor = 0;
    this.underFor = 0;
  }

  /**
   * Evaluate once. Returns -1 (step up), +1 (step down) or 0.
   *
   * @param {number} now  ms timestamp
   * @param {{ intervalP95: number, workP95: number, workSamples: number }} m
   */
  step(now, { intervalP95, workP95, workSamples }) {
    const dt = this.lastAt ? Math.min(1000, now - this.lastAt) : GOVERNOR.cadenceMs;
    this.lastAt = now;
    if (now < this.settleUntil) return 0;

    const over = intervalP95 > this.budgetMs * GOVERNOR.overRatio;
    const room = workSamples >= GOVERNOR.minWorkSamples && workP95 < this.budgetMs * GOVERNOR.upRatio && !over;

    if (over) {
      this.overFor += dt;
      this.underFor = 0;
      if (this.overFor >= GOVERNOR.downAfterMs && this.index < AUTO_RANGE.length - 1) {
        this.index++;
        this.settle(now);
        return 1;
      }
    } else if (room) {
      this.underFor += dt;
      this.overFor = 0;
      if (this.underFor >= GOVERNOR.upAfterMs && this.index > 0) {
        this.index--;
        this.settle(now);
        return -1;
      }
    } else {
      this.overFor = 0;
      this.underFor = 0;
    }
    return 0;
  }
}

/**
 * The frame-rate target a client aims for.
 * @param {string} setting  "display" | "30" | "45" | "60"
 * @param {number} displayHz  measured refresh rate
 * @param {number} cap  display cap
 */
export function targetFpsFor(setting, displayHz, cap = 60) {
  if (setting === "display") {
    const hz = Number.isFinite(displayHz) && displayHz > 0 ? displayHz : cap;
    return Math.min(cap, Math.round(hz));
  }
  const n = Number(setting);
  return Number.isFinite(n) && n > 0 ? Math.min(cap, n) : cap;
}
