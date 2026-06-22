import { FEATURE_ID } from './settings.js';
import { PacerManager } from './PacerManager.js';
import { CampfireWebGL } from './CampfireWebGL.js';
import { featurePath } from '../../core/const.mjs';

const BAR_TEMPLATE = featurePath(FEATURE_ID, 'templates/campfire-bar.hbs');

function renderHbs(path, ctx) {
  return foundry.applications.handlebars.renderTemplate(path, ctx);
}

/** Format a remaining-seconds value as m:ss for the bar timer. */
function formatRemaining(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Campfire Scene — a prominent, flame-pulsing bottom bar. A calm counterpart to
 * the Dire Peril splash: it tells the table to slow down, roleplay, and explore
 * their characters. The bar slides up from the bottom edge, pulses like a hearth
 * for the whole scene, and carries the optional countdown — ticked locally so
 * the manager never has to re-render the GM HUD each second.
 */
export class CampfireOverlay {
  constructor() {
    this._barEl = null;
    this._tickInterval = null;
    this._unsubscribe = null;
    // Premium WebGL fire; a no-op when WebGL is unavailable, in which case the
    // CSS fallback flames remain.
    this._webgl = new CampfireWebGL();
    // Bumped whenever the scene ends; in-flight async renders check this token
    // before writing DOM so a dismiss can cancel a pending show.
    this._token = 0;
  }

  initialize() {
    this._createBar();

    // The bar always slides in the same way, so the reveal-vs-late-join
    // distinction the manager passes doesn't change anything here.
    this._unsubscribe = PacerManager.onCampfire(({ active }) => {
      if (active) this._show();
      else this._hide();
    });
  }

  /**
   * Late-join helper — show the bar for an already-running scene.
   * Safe to call multiple times; no-ops if the bar is already visible.
   */
  showIndicatorOnly() {
    if (this._barEl?.classList.contains('visible')) return;
    this._show();
  }

  _createBar() {
    if (this._barEl) return;
    const el = document.createElement('div');
    el.className = 'stream-pacer-campfire-bar-wrap';
    document.body.appendChild(el);
    this._barEl = el;
  }

  async _show() {
    if (!this._barEl) this._createBar();
    const token = ++this._token;

    const hasTimer = PacerManager.getCampfireRemaining() !== null;
    const context = {
      isGM: game.user.isGM,
      title: game.i18n.localize('STREAM_PACER.Campfire.Title'),
      subtitle: game.i18n.localize('STREAM_PACER.Campfire.Subtitle'),
      hasTimer,
      timer: hasTimer ? formatRemaining(PacerManager.getCampfireRemaining()) : '',
      dismissTooltip: game.i18n.localize('STREAM_PACER.Campfire.Dismiss')
    };

    const html = await renderHbs(BAR_TEMPLATE, context);
    if (token !== this._token) return;
    this._barEl.innerHTML = html;

    const dismissBtn = this._barEl.querySelector('[data-action="dismiss-campfire"]');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => PacerManager.dismissCampfire());
    }

    // Light the premium WebGL fire inside the freshly rendered bar. When it
    // mounts, flag the bar so the CSS fallback flames step aside.
    const barEl = this._barEl.querySelector('.stream-pacer-campfire-bar');
    if (barEl && this._webgl.mount(barEl)) {
      barEl.classList.add('webgl-active');
    }

    void this._barEl.offsetWidth;
    this._barEl.classList.add('visible');

    this._startTicking();
  }

  // Drive the bar's countdown text locally, once a second, so the manager
  // doesn't have to broadcast or re-render anything per tick. No-op when the
  // scene has no timer.
  _startTicking() {
    this._stopTicking();
    if (PacerManager.getCampfireRemaining() === null) return;

    this._tickInterval = setInterval(() => {
      const remaining = PacerManager.getCampfireRemaining();
      if (remaining === null) {
        this._stopTicking();
        return;
      }
      const timerEl = this._barEl?.querySelector('.cf-bar-timer');
      if (timerEl) timerEl.textContent = formatRemaining(remaining);
      // Soft warning tint + hotter, taller fire in the final stretch.
      const bar = this._barEl?.querySelector('.stream-pacer-campfire-bar');
      const ending = remaining <= 30;
      if (bar) bar.classList.toggle('is-ending', ending);
      this._webgl.setEnding(ending);
    }, 1000);
  }

  _stopTicking() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  _hide() {
    this._token++;
    this._stopTicking();
    this._webgl.stop();
    if (!this._barEl) return;
    this._barEl.classList.remove('visible');
    // Clear after the slide-out transition so a re-light starts clean.
    setTimeout(() => {
      if (this._barEl && !this._barEl.classList.contains('visible')) {
        this._barEl.innerHTML = '';
      }
    }, 500);
  }

  destroy() {
    this._stopTicking();
    this._webgl.destroy();
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._barEl) {
      this._barEl.remove();
      this._barEl = null;
    }
  }
}
