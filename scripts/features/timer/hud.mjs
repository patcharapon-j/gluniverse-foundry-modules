/**
 * GLUniverse Suite — Timer feature: the shared countdown HUD.
 *
 * A single fixed top-center liquid-glass, edge-lit plaque shown to everyone. It
 * self-ticks via requestAnimationFrame from the authoritative state's
 * `anchor`+`remainingMs`, re-anchoring whenever new state arrives, so the DOM is
 * updated in place (text only) and the CSS urgency animations never restart.
 *
 * Display: `M:SS` above 60 s, flipping to frantic `SS.cc` hundredths below it,
 * with a calm → urgent (amber) → critical (red, pulse+jitter) ramp and a gold
 * expire flash. The GM additionally sees an inline control strip (pause/resume,
 * ±time, edit, stop). Freezes on world pause OR the timer's own pause.
 */

import {
  getState, remainingOf, isLive, TimerCtrl,
  URGENT_MS, CRITICAL_MS, CHECKPOINT_MS,
} from "./state.mjs";
import * as Audio from "./audio.mjs";
import { TimerPanel } from "./panel.mjs";

/** Split a remaining-ms into the large main field and the small fractional tail. */
function formatParts(remMs) {
  const rem = Math.max(0, remMs);
  if (rem >= URGENT_MS) {
    const total = Math.ceil(rem / 1000); // linger on the round value
    const m = Math.floor(total / 60);
    const s = total % 60;
    return { main: `${m}:${String(s).padStart(2, "0")}`, frac: "" };
  }
  const s = Math.floor(rem / 1000);
  const cc = Math.floor((rem % 1000) / 10);
  return { main: String(s).padStart(2, "0"), frac: `.${String(cc).padStart(2, "0")}` };
}

function tierOf(remMs, expired) {
  if (expired || remMs <= 0) return "expired";
  if (remMs >= URGENT_MS) return "calm";
  if (remMs > CRITICAL_MS) return "urgent";
  return "critical";
}

class TimerHUDClass {
  constructor() {
    this.el = null;
    this._raf = null;
    this._state = null;
    this._lastRem = null;       // last computed remaining (held while frozen)
    this._prevActive = false;
    this._lastMain = null;
    this._lastFrac = null;
    this._lastTier = null;
    this._lastPaused = null;
    this._lastShowPause = null;
    this._lastWholeSec = null;
    this._firedExpire = false;
    this._gmExpiredSent = false;
    this._lastCheckpoint = 0;
  }

  /** Create the overlay (idempotent). Call once at ready on every client. */
  mount() {
    if (this.el) return;
    const gm = game.user?.isGM;
    const el = document.createElement("div");
    el.id = "gltimer-hud";
    el.className = "gltimer-hud gl-glass";
    el.setAttribute("data-tier", "calm");
    el.style.display = "none";
    el.innerHTML = `
      <div class="gltimer-rim" aria-hidden="true"></div>
      <div class="gltimer-sheen" aria-hidden="true"></div>
      <div class="gltimer-face">
        <span class="gltimer-main">0:00</span><span class="gltimer-frac"></span>
      </div>
      ${gm ? this._stripHTML() : ""}`;
    document.body.appendChild(el);
    this.el = el;
    this._mainEl = el.querySelector(".gltimer-main");
    this._fracEl = el.querySelector(".gltimer-frac");
    if (gm) this._wireStrip();
    this._state = getState();
    this._prevActive = !!this._state.active;
    this._lastRem = null;
    this._loop();
  }

  _stripHTML() {
    const t = (k) => game.i18n.localize(k);
    return `<div class="gltimer-strip">
      <button type="button" class="gl-btn gltimer-ctl gltimer-pause" data-act="pause" title="${t("GLTIMER.strip.pause")}"><i class="fa-solid fa-pause"></i></button>
      <button type="button" class="gl-btn gltimer-ctl" data-act="sub60" title="${t("GLTIMER.strip.sub")}">−1:00</button>
      <button type="button" class="gl-btn gltimer-ctl" data-act="sub10" title="${t("GLTIMER.strip.sub")}">−0:10</button>
      <button type="button" class="gl-btn gltimer-ctl" data-act="add10" title="${t("GLTIMER.strip.add")}">+0:10</button>
      <button type="button" class="gl-btn gltimer-ctl" data-act="add60" title="${t("GLTIMER.strip.add")}">+1:00</button>
      <button type="button" class="gl-btn gltimer-ctl" data-act="edit" title="${t("GLTIMER.strip.edit")}"><i class="fa-solid fa-pen"></i></button>
      <button type="button" class="gl-btn gltimer-ctl gltimer-stop" data-act="stop" title="${t("GLTIMER.strip.stop")}"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }

  _wireStrip() {
    this._pauseBtn = this.el.querySelector(".gltimer-pause");
    this.el.querySelector(".gltimer-strip").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-act]");
      if (!btn) return;
      const s = getState();
      switch (btn.dataset.act) {
        case "pause": (s.running ? TimerCtrl.pause() : TimerCtrl.resume()); break;
        case "sub60": TimerCtrl.adjust(-60_000); break;
        case "sub10": TimerCtrl.adjust(-10_000); break;
        case "add10": TimerCtrl.adjust(10_000); break;
        case "add60": TimerCtrl.adjust(60_000); break;
        case "edit": new TimerPanel().render({ force: true }); break;
        case "stop": TimerCtrl.clear(); break;
      }
    });
  }

  /** Receive a fresh authoritative state (from the setting's onChange). */
  onState(state) {
    const next = { ...state };
    const became = next.active && !this._prevActive;
    this._prevActive = !!next.active;
    this._state = next;
    this._lastRem = null;            // force re-anchor on the next frame
    if (!next.expired) { this._firedExpire = false; this._gmExpiredSent = false; }
    if (isLive(next)) this._lastCheckpoint = Date.now();
    if (became && this.el) {
      this.el.classList.remove("is-sheen");
      void this.el.offsetWidth;      // restart the entrance sheen
      this.el.classList.add("is-sheen");
    }
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const el = this.el;
    if (!el) return;
    const s = this._state || (this._state = getState());

    if (!s.active) {
      if (el.style.display !== "none") {
        el.style.display = "none";
        el.classList.remove("is-burst", "is-sheen", "is-paused");
        this._lastMain = this._lastFrac = this._lastTier = null;
        this._lastWholeSec = null;
        this._firedExpire = false;
      }
      return;
    }
    if (el.style.display === "none") el.style.display = "";

    const now = Date.now();
    // Local game.paused is layered on for an instant freeze; the GM also
    // persists worldPaused so late joiners see the frozen value.
    const live = !!(s.running && !s.worldPaused && !game.paused && !s.expired);
    let rem;
    if (live) {
      rem = Math.max(0, Number(s.remainingMs) - (now - (Number(s.anchor) || 0)));
      this._lastRem = rem;
    } else {
      rem = this._lastRem != null ? this._lastRem : remainingOf(s);
    }

    this._render(el, rem, s);
    this._handleSound(rem, live, s);

    if (game.user?.isGM && live) {
      if (rem <= 0 && !this._gmExpiredSent) {
        this._gmExpiredSent = true;
        TimerCtrl.markExpired();
      } else if (rem > 0 && now - this._lastCheckpoint > CHECKPOINT_MS) {
        this._lastCheckpoint = now;
        TimerCtrl.checkpoint();
      }
    }
  }

  _render(el, rem, s) {
    const { main, frac } = formatParts(rem);
    if (main !== this._lastMain) { this._mainEl.textContent = main; this._lastMain = main; }
    if (frac !== this._lastFrac) { this._fracEl.textContent = frac; this._lastFrac = frac; }

    const tier = tierOf(rem, s.expired);
    if (tier !== this._lastTier) {
      el.setAttribute("data-tier", tier);
      // Leaving the urgent ramp → drop the per-frame heat override so the
      // tier's stylesheet accent applies again.
      if (this._lastTier === "urgent") el.style.removeProperty("--gl-accent");
      this._lastTier = tier;
    }
    // Continuous amber→red heat across the urgent window (urgent tier only).
    if (tier === "urgent") {
      const pct = Math.round(((URGENT_MS - rem) / (URGENT_MS - CRITICAL_MS)) * 100);
      el.style.setProperty("--gl-accent", `color-mix(in srgb, var(--gl-hazard) ${pct}%, var(--gl-signal))`);
    }

    const pausedView = !s.expired && rem > 0 && !(s.running && !s.worldPaused && !game.paused);
    if (pausedView !== this._lastPaused) {
      el.classList.toggle("is-paused", pausedView);
      this._lastPaused = pausedView;
    }

    if (this._pauseBtn) {
      const showPause = s.running && !s.expired;
      if (showPause !== this._lastShowPause) {
        this._pauseBtn.innerHTML = showPause
          ? '<i class="fa-solid fa-pause"></i>'
          : '<i class="fa-solid fa-play"></i>';
        this._pauseBtn.title = game.i18n.localize(showPause ? "GLTIMER.strip.pause" : "GLTIMER.strip.resume");
        this._lastShowPause = showPause;
      }
    }
  }

  _handleSound(rem, live, s) {
    // Ticks: every whole-second crossing in the final 10 s while advancing.
    if (live && rem > 0 && rem <= 10_000) {
      const wsec = Math.ceil(rem / 1000);
      if (this._lastWholeSec == null) this._lastWholeSec = wsec;
      else if (wsec < this._lastWholeSec) { this._lastWholeSec = wsec; Audio.playTick(wsec); }
    } else {
      this._lastWholeSec = null;
    }

    // Alarm + burst flash once, when this client first reaches zero (locally or
    // on receiving the expired state).
    if (rem <= 0 && (s.expired || live) && !this._firedExpire) {
      this._firedExpire = true;
      Audio.playAlarm();
      this.el.classList.remove("is-burst");
      void this.el.offsetWidth;
      this.el.classList.add("is-burst");
    }
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.el?.remove();
    this.el = null;
  }
}

export const TimerHUD = new TimerHUDClass();
