import { PacerManager } from './PacerManager.js';
import { SAFETY_STATUS } from './settings.js';
import { escapeHTML } from '../../core/util.mjs';

/**
 * Player-only full-screen safety check-in. It is deliberately separate from
 * the normal Pacer HUD, so it still works for clients exempt from that HUD.
 */
export class SafetyCheckOverlay {
  constructor() {
    this._element = null;
    this._unsubscribe = null;
    this._active = false;
    this._previousFocus = null;
    this._settleTimer = null;
    this._clickHandler = this._onClick.bind(this);
    this._keyHandler = this._onKeyDown.bind(this);
  }

  initialize() {
    if (game.user.isGM) return;
    this._createElement();
    this._unsubscribe = PacerManager.subscribe(state => this._update(state));
    this._update(PacerManager.getState());
  }

  _createElement() {
    this._element = document.createElement('section');
    this._element.id = 'stream-pacer-safety-check';
    this._element.className = 'stream-pacer-safety-check';
    this._element.setAttribute('role', 'dialog');
    this._element.setAttribute('aria-modal', 'true');
    this._element.setAttribute('aria-hidden', 'true');
    this._element.setAttribute('aria-label', game.i18n.localize('STREAM_PACER.SafetyCheck.DialogLabel'));
    const greenLabel = escapeHTML(game.i18n.localize('STREAM_PACER.SafetyCheck.GreenLabel'));
    const yellowLabel = escapeHTML(game.i18n.localize('STREAM_PACER.SafetyCheck.YellowLabel'));
    const redLabel = escapeHTML(game.i18n.localize('STREAM_PACER.SafetyCheck.RedLabel'));
    this._element.innerHTML = `
      <div class="safety-check-frame">
        <i class="fa-solid fa-traffic-light safety-check-mark" aria-hidden="true"></i>
        <div class="safety-check-actions">
          <button type="button" class="safety-check-choice is-green" data-safety-status="green"
                  aria-label="${greenLabel}" title="${greenLabel}">
            <i class="fa-solid fa-check" aria-hidden="true"></i>
          </button>
          <button type="button" class="safety-check-choice is-yellow" data-safety-status="yellow"
                  aria-label="${yellowLabel}" title="${yellowLabel}">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          </button>
          <button type="button" class="safety-check-choice is-red" data-safety-status="red"
                  aria-label="${redLabel}" title="${redLabel}">
            <i class="fa-solid fa-hand" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
    this._element.addEventListener('click', this._clickHandler);
    this._element.addEventListener('keydown', this._keyHandler);
    document.body.appendChild(this._element);
  }

  _onClick(event) {
    const choice = event.target.closest('[data-safety-status]');
    if (!choice) return;
    const status = choice.dataset.safetyStatus;
    if (!Object.values(SAFETY_STATUS).includes(status)) return;
    if (!PacerManager.submitSafetyResponse(game.user.id, status)) return;

    choice.classList.add('is-selected');
    this._element.classList.add('is-answering', `answered-${status}`);
    this._element.querySelectorAll('.safety-check-choice').forEach(button => {
      button.disabled = true;
    });
  }

  _onKeyDown(event) {
    if (!this._active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Tab') return;

    const buttons = [...this._element.querySelectorAll('.safety-check-choice:not(:disabled)')];
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  _update(state) {
    if (!this._element) return;
    const safetyCheck = state.safetyCheck;
    const shouldShow = safetyCheck.active
      && safetyCheck.targetUserIds.includes(game.user.id)
      && !safetyCheck.responses[game.user.id];

    clearTimeout(this._settleTimer);
    if (shouldShow && !this._active) {
      this._previousFocus = document.activeElement;
      this._element.classList.remove('is-answering', 'answered-green', 'answered-yellow', 'answered-red');
      this._element.querySelectorAll('.safety-check-choice').forEach(button => {
        button.disabled = false;
        button.classList.remove('is-selected');
      });
      requestAnimationFrame(() => this._element?.querySelector('.safety-check-choice')?.focus());
    } else if (!shouldShow && this._active) {
      this._settleTimer = setTimeout(() => {
        this._element?.classList.remove('is-answering', 'answered-green', 'answered-yellow', 'answered-red');
      }, 560);
      if (this._previousFocus?.isConnected) this._previousFocus.focus();
      this._previousFocus = null;
    }

    this._active = shouldShow;
    this._element.classList.toggle('active', shouldShow);
    this._element.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  }

  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._element) {
      this._element.removeEventListener('click', this._clickHandler);
      this._element.removeEventListener('keydown', this._keyHandler);
      this._element.remove();
      this._element = null;
    }
    clearTimeout(this._settleTimer);
  }
}
