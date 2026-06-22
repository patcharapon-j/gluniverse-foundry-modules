import { MODULE_ID, FEATURE_ID } from './settings.js';
import { PacerManager } from './PacerManager.js';
import { PerilWebGL } from './PerilWebGL.js';
import { featurePath } from '../../core/const.mjs';

const STAGE_TEMPLATE = featurePath(FEATURE_ID, 'templates/peril-stage.hbs');
const INDICATOR_TEMPLATE = featurePath(FEATURE_ID, 'templates/peril-indicator.hbs');

/** Full animation duration (ms) from declare to indicator handoff. */
const STAGE_DURATION_MS = 4200;
/** Offset (ms) before end at which the indicator appears. */
const INDICATOR_LEAD_MS = 700;

function renderHbs(path, ctx) {
  return foundry.applications.handlebars.renderTemplate(path, ctx);
}

/** Read a world-scoped text setting, falling back to the localized default. */
function settingOrLocalized(key, i18nKey) {
  let value = '';
  try {
    value = (game.settings.get(MODULE_ID, key) || '').trim();
  } catch (e) {
    /* settings not ready */
  }
  return value || game.i18n.localize(i18nKey);
}

/** Split a word into { ch, i } entries for the staggered letter cascade. */
function toLetters(word) {
  return Array.from(String(word || '')).map((ch, i) => ({
    ch: ch === ' ' ? ' ' : ch,
    i
  }));
}

export class PerilOverlay {
  constructor() {
    this._stageEl = null;
    this._indicatorEl = null;
    this._stageTimer = null;
    this._indicatorTimer = null;
    this._unsubscribe = null;
    this._webgl = new PerilWebGL();
    // Incremented whenever peril becomes inactive; in-flight async renders
    // check this token before writing DOM so a dismiss can cancel them.
    this._activationToken = 0;
  }

  /** WebGL backdrop runs unless disabled in settings. */
  _webglEnabled() {
    try {
      if (!game.settings.get(MODULE_ID, 'sp.perilWebGLEnabled')) return false;
    } catch (e) {
      /* setting not ready — default to on */
    }
    return true;
  }

  initialize() {
    this._createStageContainer();
    this._createIndicatorContainer();

    this._unsubscribe = PacerManager.onDirePeril(({ active, animate }) => {
      if (active) {
        if (animate) {
          this._playStageAndShowIndicator();
        } else {
          this._renderIndicator();
        }
      } else {
        this._hideIndicator();
      }
    });
  }

  /**
   * Late-join helper — render just the indicator with no animation.
   * Safe to call multiple times; no-ops if already rendered.
   */
  showIndicatorOnly() {
    if (this._indicatorEl && this._indicatorEl.childElementCount > 0) return;
    this._renderIndicator();
  }

  _createStageContainer() {
    if (this._stageEl) return;
    const el = document.createElement('div');
    el.className = 'stream-pacer-peril-stage';
    document.body.appendChild(el);
    this._stageEl = el;
  }

  _createIndicatorContainer() {
    if (this._indicatorEl) return;
    const el = document.createElement('div');
    el.className = 'stream-pacer-peril-indicator-wrap';
    document.body.appendChild(el);
    this._indicatorEl = el;
  }

  async _playStageAndShowIndicator() {
    const token = ++this._activationToken;
    if (this._webglEnabled()) this._webgl.play(STAGE_DURATION_MS);
    await this._renderStage(token);
    if (token !== this._activationToken) return;
    this._scheduleHandoff(token);
  }

  _resolveText() {
    const dire = settingOrLocalized('sp.perilTextDire', 'STREAM_PACER.DirePerilTitleDire');
    const peril = settingOrLocalized('sp.perilTextPeril', 'STREAM_PACER.DirePerilTitlePeril');
    return {
      dire,
      peril,
      title: `${dire} ${peril}`.trim(),
      tag: settingOrLocalized('sp.perilTextTag', 'STREAM_PACER.DirePerilTag'),
      subtitle: settingOrLocalized('sp.perilTextSubtitle', 'STREAM_PACER.DirePerilSubtitle')
    };
  }

  async _renderStage(token) {
    if (!this._stageEl) this._createStageContainer();

    const text = this._resolveText();
    const direLetters = toLetters(text.dire);
    const perilLetters = toLetters(text.peril);

    // Big center flash montage — every character (spaces dropped) in order.
    const flashLetters = Array.from(`${text.dire}${text.peril}`)
      .filter((ch) => ch !== ' ')
      .map((ch, i) => ({ ch, i }));

    const context = {
      tag: text.tag,
      subtitle: text.subtitle,
      marquee: text.title || 'DIRE PERIL',
      direLetters,
      perilLetters,
      direCount: direLetters.length,
      perilCount: perilLetters.length,
      flashLetters,
      flashCount: flashLetters.length,
      runTop: game.i18n.localize('STREAM_PACER.DirePerilRunTop'),
      runBottom: game.i18n.localize('STREAM_PACER.DirePerilRunBottom')
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
    }, 300);
  }

  async _renderIndicator() {
    if (!this._indicatorEl) this._createIndicatorContainer();
    const token = this._activationToken || 1;
    if (!this._activationToken) this._activationToken = token;

    const text = this._resolveText();
    const context = {
      isGM: game.user.isGM,
      label: text.title || game.i18n.localize('STREAM_PACER.DirePerilTitle'),
      header: game.i18n.localize('STREAM_PACER.DirePerilHazardActive'),
      dismissTooltip: game.i18n.localize('STREAM_PACER.DirePerilDismiss')
    };

    const html = await renderHbs(INDICATOR_TEMPLATE, context);
    if (token !== this._activationToken) return;
    this._indicatorEl.innerHTML = html;

    const dismissBtn = this._indicatorEl.querySelector('[data-action="dismiss-peril"]');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        PacerManager.dismissDirePeril();
      });
    }

    void this._indicatorEl.offsetWidth;
    this._indicatorEl.classList.add('visible');
  }

  _hideIndicator() {
    this._activationToken++;
    clearTimeout(this._indicatorTimer);
    clearTimeout(this._stageTimer);
    this._webgl.stop();
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
    if (this._webgl) {
      this._webgl.destroy();
      this._webgl = null;
    }
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
