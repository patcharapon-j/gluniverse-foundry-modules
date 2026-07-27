import { PacerManager } from './PacerManager.js';
import { SAFETY_STATUS } from './settings.js';

/**
 * Player-side surface for a GM safety request.
 *
 * Two pieces, both non-blocking:
 *   - a reduced-opacity banner running across the middle of the screen, so the
 *     ask is visible without stealing the table's attention or the pointer;
 *   - an arrow anchored beside the traffic light in the Pacer HUD, telling the
 *     player exactly where to answer.
 *
 * Players who are exempt from the pacer HUD have no light to point at, so the
 * banner grows its own set of lamps — a safety ask must reach every player.
 */
export class SafetyRequestOverlay {
  constructor() {
    this._element = null;
    this._pointerEl = null;
    this._trackEl = null;
    this._messageEls = [];
    this._lampsEl = null;
    this._unsubscribe = null;
    this._active = false;
    this._acknowledged = false;
    this._anchorFrame = null;
    this._lastAnchor = '';
    this._clickHandler = this._onClick.bind(this);
    this._boundSyncAnchor = () => this._syncAnchor();
  }

  initialize() {
    // The GM drives the request from their HUD button; they never see it.
    if (game.user.isGM) return;
    this._createElements();
    this._unsubscribe = PacerManager.subscribe(state => this._update(state));
    this._update(PacerManager.getState());
  }

  _createElements() {
    this._element = document.createElement('aside');
    this._element.id = 'stream-pacer-safety-request';
    this._element.className = 'stream-pacer-safety-request';
    this._element.setAttribute('role', 'status');
    this._element.setAttribute('aria-live', 'polite');
    this._element.setAttribute('aria-hidden', 'true');

    const band = document.createElement('div');
    band.className = 'sp-sr-band';

    this._trackEl = document.createElement('div');
    this._trackEl.className = 'sp-sr-track';
    // Two identical halves so a -50% scroll loops seamlessly.
    for (let i = 0; i < 12; i++) this._trackEl.appendChild(this._createSegment());
    band.appendChild(this._trackEl);

    // Fallback answer surface for players with no HUD to point at.
    this._lampsEl = document.createElement('div');
    this._lampsEl.className = 'sp-sr-lamps';
    this._lampsEl.setAttribute('role', 'group');
    this._lampsEl.setAttribute('aria-label', game.i18n.localize('STREAM_PACER.SafetyCheck.LightGroupLabel'));
    for (const status of Object.values(SAFETY_STATUS)) {
      const label = game.i18n.localize(`STREAM_PACER.SafetyCheck.${status}`);
      const lamp = document.createElement('button');
      lamp.type = 'button';
      lamp.className = `sp-sr-lamp lamp-${status}`;
      lamp.dataset.light = status;
      lamp.setAttribute('aria-label', label);
      lamp.title = label;
      this._lampsEl.appendChild(lamp);
    }
    band.appendChild(this._lampsEl);
    this._element.appendChild(band);
    this._element.addEventListener('click', this._clickHandler);
    document.body.appendChild(this._element);

    this._pointerEl = document.createElement('div');
    this._pointerEl.className = 'stream-pacer-safety-pointer';
    this._pointerEl.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'sp-sp-label';
    label.textContent = game.i18n.localize('STREAM_PACER.SafetyCheck.PointerLabel');
    const arrow = document.createElement('i');
    arrow.className = 'fa-solid fa-arrow-right-long sp-sp-arrow';
    this._pointerEl.append(label, arrow);
    document.body.appendChild(this._pointerEl);

    // Player names are never rendered here, so textContent-only is enough.
    this._messageEls = [...this._trackEl.querySelectorAll('.sp-sr-message')];
  }

  _createSegment() {
    const segment = document.createElement('span');
    segment.className = 'sp-sr-segment';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-traffic-light sp-sr-icon';

    const message = document.createElement('span');
    message.className = 'sp-sr-message';

    const sep = document.createElement('span');
    sep.className = 'sp-sr-sep';

    segment.append(icon, message, sep);
    return segment;
  }

  _onClick(event) {
    const lamp = event.target.closest('[data-light]');
    if (!lamp) return;
    PacerManager.setSafetyLight(game.user.id, lamp.dataset.light);
  }

  _update(state) {
    if (!this._element) return;

    const request = state.safetyRequest;
    const active = request.active === true;
    // Answering doesn't dismiss the banner — only the GM's button does — but it
    // does drop the nagging tone and the arrow.
    const acknowledged = active && request.acknowledged[game.user.id] === true;

    if (active !== this._active || acknowledged !== this._acknowledged) {
      this._active = active;
      this._acknowledged = acknowledged;
      this._applyMessage();
    }

    this._element.classList.toggle('active', active);
    this._element.classList.toggle('is-acknowledged', acknowledged);
    this._element.setAttribute('aria-hidden', active ? 'false' : 'true');
    document.body.classList.toggle('sp-safety-request', active);

    if (active && !acknowledged) {
      this._startAnchor();
    } else {
      this._stopAnchor();
      // Still decide whether this client needs the banner's own lamps: a
      // player with no HUD must be able to change their mind afterwards.
      if (active) this._syncHudPresence();
    }
  }

  /** Banner lamps appear only when there is no HUD light to point at. */
  _syncHudPresence() {
    const hasLight = !!document.querySelector('#stream-pacer-hud .sp-light');
    this._element?.classList.toggle('no-hud', !hasLight);
    return hasLight;
  }

  _applyMessage() {
    const text = this._acknowledged
      ? game.i18n.localize('STREAM_PACER.SafetyCheck.BannerAcknowledged')
      : game.i18n.localize('STREAM_PACER.SafetyCheck.BannerMessage');
    this._messageEls.forEach(el => { el.textContent = text; });
  }

  // --- Arrow anchoring ---

  _startAnchor() {
    if (this._anchorFrame !== null) return;
    window.addEventListener('resize', this._boundSyncAnchor);
    const tick = () => {
      this._syncAnchor();
      this._anchorFrame = requestAnimationFrame(tick);
    };
    this._anchorFrame = requestAnimationFrame(tick);
  }

  _stopAnchor() {
    if (this._anchorFrame === null) return;
    cancelAnimationFrame(this._anchorFrame);
    this._anchorFrame = null;
    window.removeEventListener('resize', this._boundSyncAnchor);
    this._pointerEl?.classList.remove('active');
    this._lastAnchor = '';
  }

  /**
   * Park the arrow beside the HUD's traffic light. The HUD is draggable, so
   * this runs on a frame loop while the ask is open — cheap, and it keeps the
   * arrow glued to the light wherever the player parked the panel.
   */
  _syncAnchor() {
    if (!this._pointerEl) return;
    if (!this._syncHudPresence()) {
      // No HUD on this client — the banner carries its own lamps instead.
      this._pointerEl.classList.remove('active');
      return;
    }

    const light = document.querySelector('#stream-pacer-hud .sp-light');
    const rect = light.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      this._pointerEl.classList.remove('active');
      return;
    }

    // Point inward from whichever side has room, so the arrow never runs off
    // screen when the HUD is parked against an edge.
    const fromLeft = rect.left > 190;
    const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${fromLeft ? 'l' : 'r'}`;
    if (key === this._lastAnchor) return;
    this._lastAnchor = key;

    this._pointerEl.classList.toggle('from-right', !fromLeft);
    this._pointerEl.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
    this._pointerEl.style.left = fromLeft
      ? `${Math.round(rect.left - 12)}px`
      : `${Math.round(rect.right + 12)}px`;
    this._pointerEl.classList.add('active');
  }

  destroy() {
    this._stopAnchor();
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._element) {
      this._element.removeEventListener('click', this._clickHandler);
      this._element.remove();
      this._element = null;
    }
    if (this._pointerEl) {
      this._pointerEl.remove();
      this._pointerEl = null;
    }
    this._trackEl = null;
    this._lampsEl = null;
    this._messageEls = [];
    document.body.classList.remove('sp-safety-request');
  }
}
