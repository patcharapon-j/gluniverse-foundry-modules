import { PacerManager } from './PacerManager.js';
import { SAFETY_STATUS } from './settings.js';

/** The player's traffic light, docked to the flank of the Pacer HUD. */
const LIGHT_SELECTOR = '#stream-pacer-safety-light.is-mounted';

/** One icon per light, shared with the GM's alert chips. */
const LIGHT_ICON = {
  [SAFETY_STATUS.GREEN]: 'fa-solid fa-check',
  [SAFETY_STATUS.YELLOW]: 'fa-solid fa-triangle-exclamation',
  [SAFETY_STATUS.RED]: 'fa-solid fa-hand'
};

/**
 * Player-side surface for a GM safety request.
 *
 * Two pieces, both non-blocking:
 *   - a solid card sitting just above the centre line (the pacing panels'
 *     Dossier style), which never takes the pointer except on its own lamps;
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
    this._cardEl = null;
    this._lampsEl = null;
    this._lampButtons = new Map();
    this._light = null;
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
    this._element.className = 'stream-pacer-safety-request gl-type';
    this._element.setAttribute('role', 'status');
    this._element.setAttribute('aria-live', 'polite');
    this._element.setAttribute('aria-hidden', 'true');

    // Static markup, localised text only — no player names are ever drawn here.
    this._cardEl = document.createElement('div');
    this._cardEl.className = 'sp-sr-card';
    this._cardEl.innerHTML = `
      <header class="sp-sr-hd">
        <span class="sp-sr-hd-label"><i class="sp-sr-hd-icon" aria-hidden="true"></i><span class="sp-sr-label"></span></span>
        <span class="sp-sr-code"></span>
      </header>
      <div class="sp-sr-hazard" aria-hidden="true"></div>
      <div class="sp-sr-bd">
        <div class="sp-sr-title"></div>
        <div class="sp-sr-guide"></div>
      </div>`;
    this._cardEl.querySelector('.sp-sr-code').textContent = game.i18n.localize('STREAM_PACER.SafetyCheck.Card.Code');

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
      lamp.setAttribute('aria-pressed', 'false');
      lamp.title = label;
      const icon = document.createElement('i');
      icon.className = LIGHT_ICON[status];
      icon.setAttribute('aria-hidden', 'true');
      const word = document.createElement('span');
      word.textContent = game.i18n.localize(`STREAM_PACER.SafetyCheck.Word.${status}`);
      lamp.append(icon, word);
      this._lampsEl.appendChild(lamp);
      this._lampButtons.set(status, lamp);
    }
    this._cardEl.appendChild(this._lampsEl);
    this._element.appendChild(this._cardEl);
    this._element.addEventListener('click', this._clickHandler);
    document.body.appendChild(this._element);

    this._pointerEl = document.createElement('div');
    this._pointerEl.className = 'stream-pacer-safety-pointer gl-type';
    this._pointerEl.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'sp-sp-label';
    label.textContent = game.i18n.localize('STREAM_PACER.SafetyCheck.PointerLabel');
    const light = document.createElement('i');
    light.className = 'fa-solid fa-traffic-light sp-sp-icon';
    light.setAttribute('aria-hidden', 'true');
    const arrow = document.createElement('i');
    arrow.className = 'fa-solid fa-arrow-right-long sp-sp-arrow';
    this._pointerEl.append(light, label, arrow);
    document.body.appendChild(this._pointerEl);
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

    // The fallback lamps show which light is standing, as the HUD fixture does.
    if (state.mySafetyLight !== this._light) {
      this._light = state.mySafetyLight;
      for (const [status, lamp] of this._lampButtons) {
        const lit = status === this._light;
        lamp.classList.toggle('is-lit', lit);
        lamp.setAttribute('aria-pressed', lit ? 'true' : 'false');
      }
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

  /** Banner lamps appear only when there is no docked light to point at. */
  _syncHudPresence() {
    const hasLight = !!document.querySelector(LIGHT_SELECTOR);
    if (this._element && this._element.classList.contains('no-hud') === hasLight) {
      this._element.classList.toggle('no-hud', !hasLight);
      this._applyMessage();
    }
    return hasLight;
  }

  /** Amber "Set your light" until answered, then green "Light set". */
  _applyMessage() {
    if (!this._cardEl) return;
    const t = (key) => game.i18n.localize(`STREAM_PACER.SafetyCheck.Card.${key}`);
    const ack = this._acknowledged;
    const noHud = this._element.classList.contains('no-hud');
    this._element.dataset.tone = ack ? 'green' : 'amber';
    this._cardEl.querySelector('.sp-sr-hd-icon').className =
      `sp-sr-hd-icon fa-solid ${ack ? 'fa-circle-check' : 'fa-traffic-light'}`;
    this._cardEl.querySelector('.sp-sr-label').textContent = t(ack ? 'AckLabel' : 'Label');
    this._cardEl.querySelector('.sp-sr-title').textContent = t(ack ? 'AckTitle' : 'Title');
    this._cardEl.querySelector('.sp-sr-guide').textContent = t(ack ? 'AckGuide' : noHud ? 'GuideNoHud' : 'Guide');
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
   * Park the arrow beside the traffic light. The HUD it docks to is draggable,
   * so this runs on a frame loop while the ask is open — cheap, and it keeps
   * the arrow glued to the light wherever the player parked the panel.
   */
  _syncAnchor() {
    if (!this._pointerEl) return;
    if (!this._syncHudPresence()) {
      // No light on this client — the banner carries its own lamps instead.
      this._pointerEl.classList.remove('active');
      return;
    }

    const light = document.querySelector(LIGHT_SELECTOR);
    const rect = light.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      this._pointerEl.classList.remove('active');
      return;
    }

    // Approach from the light's free flank — the HUD occupies the side the
    // light is docked to — and flip when that side has no room left.
    let fromLeft = light.classList.contains('dock-left');
    if (fromLeft && rect.left < 190) fromLeft = false;
    else if (!fromLeft && window.innerWidth - rect.right < 190) fromLeft = true;
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
    this._cardEl = null;
    this._lampsEl = null;
    this._lampButtons.clear();
    document.body.classList.remove('sp-safety-request');
  }
}
