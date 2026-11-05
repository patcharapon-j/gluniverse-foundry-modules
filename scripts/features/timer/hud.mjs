/**
 * GLUniverse Suite — Timer feature: the shared countdown HUD.
 *
 * One ink plate, fixed top-center, shown to everyone, in the suite's Ink and
 * Signal (DESIGN.md). It self-ticks via requestAnimationFrame from the
 * authoritative state's `anchor`+`remainingMs`, re-anchoring whenever new state
 * arrives, so the DOM is updated in place (text and attributes only) and no
 * CSS animation restarts on a tick.
 *
 * Display: `M:SS` above 60 s, flipping to frantic `SS.cc` hundredths below it.
 * The plate carries one tone (paper, then amber in the last minute, red in the
 * last ten and at zero, steel while held), a tag that says what the number is
 * doing, and a drain that empties left to right on the compositor. The GM
 * additionally sees a control strip (pause/resume, ±time, edit, stop). Freezes
 * on world pause OR the timer's own pause. What to draw is `view.mjs`'s.
 */

import {
  getState, remainingOf, isLive, TimerCtrl, CHECKPOINT_MS, URGENT_MS,
} from "./state.mjs";
import * as Audio from "./audio.mjs";
import { TimerMotion } from "./motion.mjs";
import {
  formatParts, tierOf, toneOf, tagKeyOf, tagIconOf, drainOf, knockSecondOf, hudHTML, STRIP, FINE_TICK_MS,
} from "./view.mjs";
import { warn } from "../../core/const.mjs";

const L = (k) => game.i18n.localize(k);

class TimerHUDClass {
  constructor() {
    this.el = null;
    this._raf = null;
    this._timeout = null;
    this._state = null;
    this._lastRem = null;       // last computed remaining (held while frozen)
    this._lastMain = null;
    this._lastFrac = null;
    this._lastTier = null;
    this._lastTone = null;
    this._lastTag = null;
    this._lastPaused = null;
    this._lastShowPause = null;
    this._lastWholeSec = null;
    this._firedExpire = false;
    this._gmExpiredSent = false;
    this._lastCheckpoint = 0;
    this._drainDirty = true;
    /** The wall clock. The preview swaps it to hold a frame still. */
    this.now = () => Date.now();
  }

  /** Create the overlay (idempotent). Call once at ready on every client. */
  mount(parent = document.body) {
    if (this.el) return;
    const gm = !!game.user?.isGM;
    const el = document.createElement("div");
    el.id = "gltimer-hud";
    el.className = "gltimer-hud gl-type";
    el.setAttribute("data-tier", "calm");
    el.setAttribute("data-tone", "paper");
    el.style.display = "none";
    el.innerHTML = hudHTML(L, { gm });
    parent.appendChild(el);
    this.el = el;
    this._motion = new TimerMotion(el);
    // Text nodes, written by `.data`: a digit change touches one node and
    // nothing above it.
    const mainEl = el.querySelector(".gltimer-main");
    mainEl.textContent = "";
    this._mainNode = mainEl.appendChild(document.createTextNode(""));
    this._fracNode = el.querySelector(".gltimer-frac").appendChild(document.createTextNode(""));
    this._faceEl = el.querySelector(".gltimer-face");
    this._tagTextEl = el.querySelector(".gltimer-tag-text");
    this._tagIconEl = el.querySelector(".gltimer-tag-icon");
    this._drainEl = el.querySelector(".gltimer-drain");
    if (gm) this._wireStrip();
    this._state = getState();
    this._lastRem = null;
    this._loop();
  }

  _wireStrip() {
    this._pauseBtn = this.el.querySelector(".gltimer-pause");
    this._pauseIcon = this._pauseBtn?.querySelector("i");
    const byAct = Object.fromEntries(STRIP.map((b) => [b.act, b]));
    this._takeBtns = STRIP.filter((b) => b.ms < 0).map((b) => this.el.querySelector(`[data-act="${b.act}"]`)).filter(Boolean);
    this.el.querySelector(".gltimer-strip").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-act]");
      if (!btn) return;
      const s = getState();
      const act = btn.dataset.act;
      if (act === "pause") (s.running ? TimerCtrl.pause() : TimerCtrl.resume());
      else if (act === "edit") import("./panel.mjs").then((m) => m.TimerPanel.open()).catch((e) => warn("Timer | panel failed to open:", e));
      else if (act === "stop") TimerCtrl.clear();
      else if (byAct[act]?.ms) TimerCtrl.adjust(byAct[act].ms);
    });
  }

  /** Receive a fresh authoritative state (from the setting's onChange). */
  onState(state) {
    const next = { ...state };
    this._state = next;
    this._lastRem = null;            // force re-anchor on the next frame
    this._drainDirty = true;         // and restart the drain from the new value
    if (!next.expired) { this._firedExpire = false; this._gmExpiredSent = false; }
    if (isLive(next)) this._lastCheckpoint = this.now();
    if (!next.active) this._motion?.clear();
    // The loop sleeps while no timer exists; new state wakes it. The pass runs
    // now rather than on the next frame: a browser that has had nothing
    // scheduled can take a while to hand out that first frame, and the plaque
    // should show the new value the moment it arrives. An inactive state still
    // gets this one pass, which is what hides the plaque.
    this.wake();
  }

  /** Run a pass now. New state, and the world pausing or resuming on this
   *  client (index.mjs's `pauseGame`), wake a loop that is sleeping. */
  wake() {
    if (!this.el) return;
    this._cancel();
    try { this._loop(); } catch (e) { warn("Timer | HUD update failed:", e); }
  }

  _cancel() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._timeout) clearTimeout(this._timeout);
    this._raf = this._timeout = null;
  }

  /** null: sleep until woken; 0: the next frame; otherwise ms. */
  _schedule(delay) {
    if (delay === null) return;
    if (delay === 0) this._raf = requestAnimationFrame(() => this._loop());
    else this._timeout = setTimeout(() => this._loop(), delay);
  }

  /**
   * When the clock next needs a pass. Held or over, nothing on it moves until
   * new state or a pause change wakes it. Above the last minute it shows whole
   * seconds, so it wakes once a second, just after the second turns (and on
   * the threshold into the last minute). The hundredths redraw every
   * FINE_TICK_MS, and the pass that reaches zero is never late. At zero the
   * hit has played and the GM has written time up, which wakes it again.
   */
  _nextWake(rem, live) {
    if (!live || rem <= 0) return null;
    if (rem < URGENT_MS) return Math.min(FINE_TICK_MS, rem + 1);
    return Math.min((rem % 1000) + 1, rem - URGENT_MS + 1);
  }

  /* Runs only while a timer is active, and only as often as the clock can
     change (`_nextWake`). With no timer at all it stops rather than waking
     sixty times a second for a whole session to confirm there is still
     nothing to show. */
  _loop() {
    this._raf = this._timeout = null;
    const el = this.el;
    if (!el) return;
    const s = this._state || (this._state = getState());

    if (!s.active) {
      if (el.style.display !== "none") {
        el.style.display = "none";
        el.classList.remove("is-paused");
        this._lastMain = this._lastFrac = this._lastTier = this._lastTone = this._lastTag = null;
        this._lastWholeSec = null;
        this._lastPaused = this._lastShowPause = null;
        this._motion?.clear();
        this._firedExpire = false;
      }
      return;
    }
    // The next pass is scheduled even if this one throws, so a throw cannot
    // stop the countdown; a pass that throws retries on the next frame.
    let next = 0;
    try { next = this._pass(el, s); } finally { this._schedule(next); }
  }

  /** One pass: read the clock, draw it, play its beats. Returns `_nextWake`. */
  _pass(el, s) {
    let revealed = false;
    if (el.style.display === "none") {
      el.style.display = "";
      revealed = true;
    }

    const now = this.now();
    // Local game.paused is layered on for an instant freeze; the GM also
    // persists worldPaused so late joiners see the frozen value.
    const live = !!(s.running && !s.worldPaused && !game.paused && !s.expired);
    let rem;
    if (live) {
      rem = Math.max(0, Number(s.remainingMs) - (now - (Number(s.anchor) || 0)));
      this._lastRem = rem;
    } else {
      rem = this._lastRem != null ? this._lastRem : remainingOf(s, now);
    }

    this._render(el, rem, s);
    if (this._drainDirty) this._syncDrain(rem, s);
    if (revealed) this._motion?.reveal();
    this._beats(rem, live, s);

    if (game.user?.isGM && live) {
      if (rem <= 0 && !this._gmExpiredSent) {
        this._gmExpiredSent = true;
        TimerCtrl.markExpired();
      } else if (rem > 0 && now - this._lastCheckpoint > CHECKPOINT_MS) {
        this._lastCheckpoint = now;
        TimerCtrl.checkpoint();
      }
    }
    return this._nextWake(rem, live);
  }

  /** Per frame: text nodes and attributes only, each written only when it changes. */
  _render(el, rem, s) {
    const { main, frac } = formatParts(rem);
    if (main !== this._lastMain) {
      this._mainNode.data = main;
      if ((main.length > 5) !== (this._lastMain?.length > 5)) this._faceEl.classList.toggle("is-long", main.length > 5);
      this._lastMain = main;
    }
    if (frac !== this._lastFrac) { this._fracNode.data = frac; this._lastFrac = frac; }

    const pausedView = !s.expired && rem > 0 && !(s.running && !s.worldPaused && !game.paused);
    if (pausedView !== this._lastPaused) {
      el.classList.toggle("is-paused", pausedView);
      this._lastPaused = pausedView;
    }

    const tier = tierOf(rem, s.expired);
    if (tier !== this._lastTier) {
      el.setAttribute("data-tier", tier);
      if (this._lastTier != null && tier !== "expired") this._motion?.emphasize();
      this._lastTier = tier;
    }

    const tone = toneOf(tier, pausedView);
    if (tone !== this._lastTone) { el.setAttribute("data-tone", tone); this._lastTone = tone; }

    const tag = tagKeyOf(tier, pausedView);
    if (tag !== this._lastTag) {
      this._tagTextEl.textContent = L(tag);
      this._tagIconEl.className = `gltimer-tag-icon ${tagIconOf(tier, pausedView)}`;
      this._lastTag = tag;
    }

    if (this._pauseBtn) {
      const showPause = s.running && !s.expired;
      if (showPause !== this._lastShowPause) {
        this._pauseIcon.className = showPause ? "fa-solid fa-pause" : "fa-solid fa-play";
        const label = L(showPause ? "GLTIMER.strip.pause" : "GLTIMER.strip.resume");
        this._pauseBtn.title = label;
        this._pauseBtn.setAttribute("aria-label", label);
        this._lastShowPause = showPause;
      }
      // At time up there is nothing to resume (TimerCtrl.resume refuses an
      // expired timer); adding time is what re-arms it.
      // Taking time off a clock at zero does nothing either.
      const expired = tier === "expired";
      if (this._pauseBtn.disabled !== expired) {
        this._pauseBtn.disabled = expired;
        for (const b of this._takeBtns) b.disabled = expired;
      }
    }
  }

  /**
   * Restart the drain from this value. Runs once per authoritative state, never
   * per frame: the bar is one CSS animation on `transform`, so it empties on the
   * compositor while the main thread only writes digits. A fresh element is the
   * reliable way to restart a CSS animation from a new point. A held timer's
   * bar is paused by the root's `is-paused`, which `_render` set just before.
   */
  _syncDrain(rem, s) {
    this._drainDirty = false;
    const { total, elapsed } = drainOf(rem, s.totalMs);
    const bar = document.createElement("i");
    bar.style.setProperty("--gltimer-drain-total", `${total}ms`);
    bar.style.setProperty("--gltimer-drain-elapsed", `${elapsed}ms`);
    this._drainEl.replaceChildren(bar);
  }

  /** The beats a whole second and zero land on: the tick and the knock, the alarm and the hit. */
  _beats(rem, live, s) {
    // Ticks and knocks: every whole-second crossing in the final 10 s while advancing.
    const wsec = live ? knockSecondOf(rem) : null;
    if (wsec != null) {
      if (this._lastWholeSec == null) this._lastWholeSec = wsec;
      else if (wsec < this._lastWholeSec) {
        this._lastWholeSec = wsec;
        Audio.playTick(wsec);
        this._motion?.knock();
      }
    } else {
      this._lastWholeSec = null;
    }

    // Alarm + hit, once, when this client first reaches zero (locally or on
    // receiving the expired state).
    if (rem <= 0 && (s.expired || live) && !this._firedExpire) {
      this._firedExpire = true;
      Audio.playAlarm();
      this._motion?.emphasize(true);
    }
  }

  destroy() {
    this._motion?.clear();
    this._motion = null;
    this._cancel();
    this.el?.remove();
    this.el = null;
  }
}

export const TimerHUD = new TimerHUDClass();
