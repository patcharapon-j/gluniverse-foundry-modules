import { FEATURE_ID } from './settings.js';
import { PacerManager } from './PacerManager.js';
import { featurePath } from '../../core/const.mjs';

const STAGE_TEMPLATE = featurePath(FEATURE_ID, 'templates/campfire-stage.hbs');
const INDICATOR_TEMPLATE = featurePath(FEATURE_ID, 'templates/campfire-indicator.hbs');

/** Full animation duration (ms) from declare to indicator handoff. */
const STAGE_DURATION_MS = 4200;
/** Offset (ms) before end at which the indicator appears. */
const INDICATOR_LEAD_MS = 900;
/** Floating ember count rendered behind the title. */
const EMBER_COUNT = 28;

function renderHbs(path, ctx) {
  return foundry.applications.handlebars.renderTemplate(path, ctx);
}

/** Format a remaining-seconds value as m:ss for the indicator timer. */
function formatRemaining(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Campfire Scene reveal + persistent indicator. A calm counterpart to the Dire
 * Peril splash: a warm hearth glow with drifting embers tells the table to
 * relax, roleplay, and explore their characters. The persistent indicator can
 * carry a soft countdown, ticked here so the manager never has to re-render the
 * GM HUD each second.
 */
export class CampfireOverlay {
  constructor() {
    this._stageEl = null;
    this._indicatorEl = null;
    this._stageTimer = null;
    this._indicatorTimer = null;
    this._tickInterval = null;
    this._unsubscribe = null;
    // Incremented whenever the scene ends; in-flight async renders check this
    // token before writing DOM so a dismiss can cancel them.
    this._activationToken = 0;
  }

  initialize() {
    this._createStageContainer();
    this._createIndicatorContainer();

    this._unsubscribe = PacerManager.onCampfire(({ active, animate }) => {
      if (active) {
        if (animate) {
          this._playStageAndShowIndicator();
        } else {
          this._renderIndicator();
        }
      } else {
        this._hide();
      }
    });
  }

  /**
   * Late-join helper — render just the indicator with no reveal animation.
   * Safe to call multiple times; no-ops if already rendered.
   */
  showIndicatorOnly() {
    if (this._indicatorEl && this._indicatorEl.childElementCount > 0) return;
    this._renderIndicator();
  }

  _createStageContainer() {
    if (this._stageEl) return;
    const el = document.createElement('div');
    el.className = 'stream-pacer-campfire-stage';
    document.body.appendChild(el);
    this._stageEl = el;
  }

  _createIndicatorContainer() {
    if (this._indicatorEl) return;
    const el = document.createElement('div');
    el.className = 'stream-pacer-campfire-indicator-wrap';
    document.body.appendChild(el);
    this._indicatorEl = el;
  }

  async _playStageAndShowIndicator() {
    const token = ++this._activationToken;
    await this._renderStage(token);
    if (token !== this._activationToken) return;
    this._scheduleHandoff(token);
  }

  _resolveText() {
    return {
      tag: game.i18n.localize('STREAM_PACER.Campfire.Tag'),
      title: game.i18n.localize('STREAM_PACER.Campfire.Title'),
      subtitle: game.i18n.localize('STREAM_PACER.Campfire.Subtitle')
    };
  }

  async _renderStage(token) {
    if (!this._stageEl) this._createStageContainer();

    const text = this._resolveText();
    // Each ember gets randomized drift so the field never looks gridded.
    const embers = Array.from({ length: EMBER_COUNT }, (_, i) => ({
      i,
      left: Math.round(Math.random() * 100),
      delay: (Math.random() * 3.6).toFixed(2),
      dur: (3.4 + Math.random() * 3.2).toFixed(2),
      drift: Math.round((Math.random() - 0.5) * 80),
      scale: (0.5 + Math.random() * 1.1).toFixed(2)
    }));

    const context = {
      tag: text.tag,
      title: text.title,
      subtitle: text.subtitle,
      embers
    };

    const html = await renderHbs(STAGE_TEMPLATE, context);
    if (token !== this._activationToken) return;
    this._stageEl.innerHTML = html;
    void this._stageEl.offsetWidth;
    this._stageEl.classList.add('playing');
  }

  _scheduleHandoff(token) {
    clearTimeout(this._indicatorTimer);
    clearTimeout(this._stageTimer);

    this._indicatorTimer = setTimeout(() => {
      if (token !== this._activationToken) return;
      this._renderIndicator();
    }, STAGE_DURATION_MS - INDICATOR_LEAD_MS);

    this._stageTimer = setTimeout(() => {
      if (token !== this._activationToken) return;
      this._unmountStage();
    }, STAGE_DURATION_MS);
  }

  _unmountStage() {
    if (!this._stageEl) return;
    this._stageEl.classList.remove('playing');
    setTimeout(() => {
      if (this._stageEl) this._stageEl.innerHTML = '';
    }, 350);
  }

  async _renderIndicator() {
    if (!this._indicatorEl) this._createIndicatorContainer();
    const token = this._activationToken || 1;
    if (!this._activationToken) this._activationToken = token;

    const hasTimer = PacerManager.getCampfireRemaining() !== null;
    const context = {
      isGM: game.user.isGM,
      header: game.i18n.localize('STREAM_PACER.Campfire.IndicatorHeader'),
      label: game.i18n.localize('STREAM_PACER.Campfire.Title'),
      hasTimer,
      timer: hasTimer ? formatRemaining(PacerManager.getCampfireRemaining()) : '',
      dismissTooltip: game.i18n.localize('STREAM_PACER.Campfire.Dismiss')
    };

    const html = await renderHbs(INDICATOR_TEMPLATE, context);
    if (token !== this._activationToken) return;
    this._indicatorEl.innerHTML = html;

    const dismissBtn = this._indicatorEl.querySelector('[data-action="dismiss-campfire"]');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => PacerManager.dismissCampfire());
    }

    void this._indicatorEl.offsetWidth;
    this._indicatorEl.classList.add('visible');

    this._startTicking();
  }

  // Drive the indicator's countdown text locally, once a second, so the manager
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
      const timerEl = this._indicatorEl?.querySelector('.campfire-ind-timer');
      if (timerEl) timerEl.textContent = formatRemaining(remaining);
      // Soft warning tint in the final stretch.
      const indicator = this._indicatorEl?.querySelector('.stream-pacer-campfire-indicator');
      if (indicator) indicator.classList.toggle('is-ending', remaining <= 30);
    }, 1000);
  }

  _stopTicking() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  _hide() {
    this._activationToken++;
    clearTimeout(this._indicatorTimer);
    clearTimeout(this._stageTimer);
    this._stopTicking();
    this._unmountStage();
    if (!this._indicatorEl) return;
    this._indicatorEl.classList.remove('visible');
    setTimeout(() => {
      if (this._indicatorEl) this._indicatorEl.innerHTML = '';
    }, 400);
  }

  destroy() {
    clearTimeout(this._stageTimer);
    clearTimeout(this._indicatorTimer);
    this._stopTicking();
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._stageEl) {
      this._stageEl.remove();
      this._stageEl = null;
    }
    if (this._indicatorEl) {
      this._indicatorEl.remove();
      this._indicatorEl = null;
    }
  }
}
