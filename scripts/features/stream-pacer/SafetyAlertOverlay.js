import { PacerManager } from './PacerManager.js';

/**
 * GM-only alert layer for raised safety lights.
 *
 * The HUD panel carries the full board; this is the part the GM cannot miss
 * while looking at the canvas. Yellow reads as a prominent amber pill at the
 * top of the screen; red escalates it and lights a hazard vignette around the
 * whole viewport until the light is lowered.
 */
export class SafetyAlertOverlay {
  constructor() {
    this._element = null;
    this._vignetteEl = null;
    this._listEl = null;
    this._unsubscribe = null;
    this._signature = null;
  }

  initialize() {
    if (!game.user.isGM) return;
    this._createElements();
    this._unsubscribe = PacerManager.subscribe(() => this._update());
    this._update();
  }

  _createElements() {
    this._vignetteEl = document.createElement('div');
    this._vignetteEl.className = 'stream-pacer-safety-vignette';
    this._vignetteEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this._vignetteEl);

    this._element = document.createElement('aside');
    this._element.id = 'stream-pacer-safety-alert';
    this._element.className = 'stream-pacer-safety-alert';
    this._element.setAttribute('role', 'status');
    this._element.setAttribute('aria-live', 'polite');
    this._element.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'sp-sa-title';
    const titleIcon = document.createElement('i');
    titleIcon.className = 'fa-solid fa-traffic-light';
    const titleText = document.createElement('span');
    titleText.textContent = game.i18n.localize('STREAM_PACER.SafetyCheck.AlertTitle');
    title.append(titleIcon, titleText);

    this._listEl = document.createElement('span');
    this._listEl.className = 'sp-sa-list';

    this._element.append(title, this._listEl);
    document.body.appendChild(this._element);
  }

  _update() {
    if (!this._element) return;

    const summary = PacerManager.getSafetySummary();
    const raised = summary.raised;
    const tier = summary.red > 0 ? 'red' : summary.yellow > 0 ? 'yellow' : null;

    // Rebuild only when the raised set actually changes — this runs on every
    // manager notification, including each countdown tick.
    const signature = raised.map(p => `${p.userId}:${p.status}`).sort().join('|');
    if (signature !== this._signature) {
      this._signature = signature;
      this._rebuild(raised);
    }

    this._element.classList.toggle('active', !!tier);
    this._element.classList.toggle('is-yellow', tier === 'yellow');
    this._element.classList.toggle('is-red', tier === 'red');
    this._element.setAttribute('aria-hidden', tier ? 'false' : 'true');

    this._vignetteEl?.classList.toggle('active', tier === 'red');
  }

  _rebuild(raised) {
    const chips = raised.map(p => {
      const chip = document.createElement('span');
      chip.className = `sp-sa-chip is-${p.status}`;

      const icon = document.createElement('i');
      icon.className = p.isRed ? 'fa-solid fa-hand' : 'fa-solid fa-triangle-exclamation';

      // Player names are untrusted strings — textContent only.
      const name = document.createElement('span');
      name.className = 'sp-sa-name';
      name.textContent = p.name;

      const word = document.createElement('span');
      word.className = 'sp-sa-word';
      word.textContent = game.i18n.localize(`STREAM_PACER.SafetyCheck.Word.${p.status}`);

      chip.append(icon, name, word);
      return chip;
    });
    this._listEl.replaceChildren(...chips);
  }

  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._element?.remove();
    this._vignetteEl?.remove();
    this._element = null;
    this._vignetteEl = null;
    this._listEl = null;
    this._signature = null;
  }
}
