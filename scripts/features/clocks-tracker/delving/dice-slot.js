/**
 * DiceSlot — a slot-machine reveal for a delving pool roll, played INSIDE the
 * chat card. No WebGL, no physics, no external libraries: each die is a vertical
 * reel of numbers that spins up to speed and decelerates onto its rolled value,
 * the reels landing left-to-right in a satisfying cascade.
 *
 * Two deliberate rules from the brief:
 *   1. Discards are revealed ONLY AFTER the result is shown — every reel spins and
 *      lands looking "live"; once they've all settled we then dim + strike the
 *      dice that fell at or below the discard range.
 *   2. The HUD must update only AFTER this animation is finalised — so when the
 *      whole sequence (spin → land → reveal discards → fade) completes we call the
 *      `onSettle` callback, which is what releases the HUD's held pool readout.
 *
 * The card already contains the baked static result spans (with the discarded
 * dice pre-marked); they're hidden under `.dx-tumbling` while the reels play and
 * revealed as the overlay fades, so scrollback / re-renders just show the result.
 * Reduced-motion / a build failure makes `mount` return null and the caller both
 * skips the animation and settles the HUD immediately.
 */

const CAP = 24;            // max reels spun; any extras live in the static spans
const FILL = 18;           // base reel length (random fillers before the result)
const BASE = 820;          // first reel's spin duration (ms)
const STEP = 130;          // extra spin per subsequent reel (the cascade)
const REVEAL_DELAY = 300;  // pause after the last reel lands, before discards show
const DISCARD_HOLD = 640;  // how long the revealed discards are held
const FADE = 360;          // overlay fade-out (ms), revealing the static spans

const rand = (a, b) => a + Math.random() * (b - a);
const hexCss = s => (/^#?[0-9a-f]{6}$/i.test(String(s ?? "")) ? (String(s)[0] === "#" ? s : "#" + s) : "#ff9a3c");

export class DiceSlot {
  /**
   * Spin a slot-machine roll over a `.glct-cc-dice` host. Returns the instance,
   * or null when it can't run (reduced motion / no faces / failure) — the caller
   * then settles the HUD itself. `onSettle` fires once the whole sequence ends.
   */
  static mount(host, { faces = [], size = 6, discard = 0, tint = "#ff9a3c" } = {}, onSettle = null) {
    if (!host || host.dataset.tumbled || !faces.length) return null;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return null;
    host.dataset.tumbled = "1";
    try { return new DiceSlot(host, { faces, size, discard, tint }, onSettle); }
    catch (err) {
      console.warn("gluniverse-clocks-and-tracker | DiceSlot init failed", err);
      delete host.dataset.tumbled;
      return null;
    }
  }

  constructor(host, { faces, size, discard, tint }, onSettle) {
    this.host = host;
    this.onSettle = onSettle;
    this._settled = false;
    this._timers = [];
    host.classList.add("dx-tumbling");          // grows the host + hides static spans
    // Hide this row's outcome (the "N left" / stage-shift badge) until the reels
    // resolve, so the card never spoils the result before the animation lands.
    this.row = host.closest(".dx-row");
    this.row?.classList.add("dx-rolling");

    const w = Math.max(40, host.clientWidth || 200);
    const h = Math.max(40, host.clientHeight || 56);
    const n = Math.min(faces.length, CAP);
    const gap = 4;
    const cell = Math.max(16, Math.min(40, Math.floor((w - gap * (n + 1)) / n), h - 8));

    const wrap = document.createElement("div");
    wrap.className = "glct-slot";
    wrap.style.setProperty("--slot-tint", hexCss(tint));
    wrap.style.gap = `${gap}px`;

    this.reels = [];
    for (let i = 0; i < n; i++) {
      const val = faces[i];
      const dropped = val <= discard;

      const reel = document.createElement("div");
      reel.className = "reel spinning";
      reel.style.width = `${cell}px`;
      reel.style.height = `${cell}px`;

      const strip = document.createElement("div");
      strip.className = "strip";

      // random fillers, then the true rolled value as the final (landing) cell
      const len = FILL + i * 3;
      const cells = [];
      for (let k = 0; k < len; k++) cells.push(1 + Math.floor(Math.random() * size));
      cells.push(val);                       // the cell the reel lands on
      for (const v of cells) {
        const c = document.createElement("span");
        c.className = "cell";
        c.style.height = `${cell}px`;
        c.style.fontSize = `${Math.round(cell * 0.56)}px`;
        c.textContent = String(v);
        strip.appendChild(c);
      }

      reel.appendChild(strip);
      wrap.appendChild(reel);
      this.reels.push({ reel, strip, val, dropped, total: cells.length, cell });
    }

    host.appendChild(wrap);
    this.wrap = wrap;

    // kick the spin next frame so the initial transform commits first
    requestAnimationFrame(() => this._spin());
  }

  _spin() {
    if (this._settled) return;
    let maxDur = 0;
    this.reels.forEach((r, i) => {
      const dur = BASE + i * STEP;
      maxDur = Math.max(maxDur, dur);
      const dist = (r.total - 1) * r.cell;     // land on the final cell (the result)
      r.strip.style.transition = `transform ${dur}ms cubic-bezier(.13,.62,.16,1)`;
      r.strip.style.transform = `translateY(-${dist}px)`;
      // drop the motion blur a touch before the reel fully stops
      this._after(dur - 90, () => r.reel.classList.remove("spinning"));
    });
    // once every reel has landed, reveal discards, hold, then fade to the result
    this._after(maxDur + REVEAL_DELAY, () => this._revealDiscards());
  }

  _revealDiscards() {
    if (this._settled) return;
    for (const r of this.reels) if (r.dropped) r.reel.classList.add("drop");
    // the dice have landed — now it's safe to reveal the row's outcome text
    this.row?.classList.remove("dx-rolling");
    this._after(DISCARD_HOLD, () => this._fade());
  }

  _fade() {
    if (this._settled) return;
    this.wrap?.classList.add("fade");
    this._after(FADE, () => this.destroy());
  }

  _after(ms, fn) { this._timers.push(setTimeout(fn, ms)); }

  destroy() {
    if (this._settled) return;
    this._settled = true;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    this.row?.classList.remove("dx-rolling");   // ensure the outcome is shown
    this.wrap?.remove();
    this.wrap = null;
    this.host?.classList.remove("dx-tumbling");
    // The animation is finalised — now let the HUD catch up to the new pool state.
    try { this.onSettle?.(); } catch (err) { console.warn("gluniverse-clocks-and-tracker | DiceSlot onSettle failed", err); }
  }
}
