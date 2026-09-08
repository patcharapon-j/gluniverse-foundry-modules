/**
 * DiceSlot — a slot-machine reveal for a delving pool roll, played INSIDE the
 * chat card. No WebGL or physics: each die is a vertical
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
 * A build failure makes `mount` return null and the caller both skips the
 * animation and settles the HUD immediately.
 */

const CAP = 24;            // max reels spun; any extras live in the static spans
const FILL = 18;           // base reel length (random fillers before the result)
const BASE = 820;          // first reel's spin duration (ms)
const STEP = 130;          // extra spin per subsequent reel (the cascade)
const REVEAL_DELAY = 300;  // pause after the last reel lands, before discards show
const DISCARD_HOLD = 640;  // how long the revealed discards are held
const FADE = 360;          // overlay fade-out (ms), revealing the static spans

import { createTimeline, createMotionOwner, motionDuration } from "../../../core/motion.mjs";

// Like hex6 but tolerates a missing leading '#' and supplies a delving-orange default.
const hexCss = s => (/^#?[0-9a-f]{6}$/i.test(String(s ?? "")) ? (String(s)[0] === "#" ? s : "#" + s) : "#ff9a3c");

export class DiceSlot {
  /**
   * Spin a slot-machine roll over a `.glct-cc-dice` host. Returns the instance,
   * or null when it can't run (no faces / failure) — the caller then settles the
   * HUD itself. `onSettle` fires once the whole sequence ends.
   */
  static mount(host, { faces = [], size = 6, discard = 0, tint = "#ff9a3c" } = {}, onSettle = null) {
    if (!host || host.dataset.tumbled || !faces.length) return null;
    host.dataset.tumbled = "1";
    try { return new DiceSlot(host, { faces, size, discard, tint }, onSettle); }
    catch (err) {
      console.warn("gluniverse-foundry-modules | clocks-tracker | DiceSlot init failed", err);
      delete host.dataset.tumbled;
      return null;
    }
  }

  constructor(host, { faces, size, discard, tint }, onSettle) {
    this.host = host;
    this.onSettle = onSettle;
    this._settled = false;
    this._motion = createMotionOwner();
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
    wrap.className = "glct-slot anime-motion";
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
    this._frame = requestAnimationFrame(() => this._spin());
  }

  _spin() {
    if (this._settled) return;
    const ms = value => motionDuration(value, this.host);
    const timeline = this._motion.add(createTimeline({ autoplay: false }));
    let landing = 0;
    this.reels.forEach((r, i) => {
      const duration = ms(BASE + i * STEP);
      landing = Math.max(landing, duration);
      timeline.add(r.strip, { y: [0, -(r.total - 1) * r.cell], duration, ease: "outQuart" }, 0);
      timeline.call(() => r.reel.classList.remove("spinning"), Math.max(0, duration - ms(90)));
      // A restrained mechanical compression makes each stop readable without
      // overshooting into the adjacent (incorrect) face of the reel.
      timeline.add(r.reel, { scale: [0.96, 1], duration: ms(160), ease: "outCubic" }, duration);
    });
    const reveal = landing + ms(REVEAL_DELAY);
    timeline.call(() => {
      for (const r of this.reels) if (r.dropped) r.reel.classList.add("drop");
      this.row?.classList.remove("dx-rolling");
    }, reveal);
    for (const r of this.reels) if (r.dropped) {
      timeline.add(r.reel, { opacity: [1, 0.5], y: [0, 2], scale: [1, 0.9],
        duration: ms(260), ease: "outCubic" }, reveal);
    }
    timeline.add(this.wrap, { opacity: [1, 0], duration: ms(FADE), ease: "inOutSine" }, reveal + ms(DISCARD_HOLD));
    timeline.call(() => this.destroy(), reveal + ms(DISCARD_HOLD + FADE));
    timeline.play();
  }

  destroy() {
    if (this._settled) return;
    this._settled = true;
    cancelAnimationFrame(this._frame);
    this._motion.clear();
    this.row?.classList.remove("dx-rolling");   // ensure the outcome is shown
    this.wrap?.remove();
    this.wrap = null;
    this.host?.classList.remove("dx-tumbling");
    // The animation is finalised — now let the HUD catch up to the new pool state.
    try { this.onSettle?.(); } catch (err) { console.warn("gluniverse-foundry-modules | clocks-tracker | DiceSlot onSettle failed", err); }
  }
}
