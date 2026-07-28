import { PacerManager } from './PacerManager.js';
import { SAFETY_STATUS } from './settings.js';

const HUD_SELECTOR = '#stream-pacer-hud';

/**
 * The player's traffic light — a small standalone fixture docked to the flank
 * of the Pacer HUD rather than living inside it.
 *
 * Keeping it out of the HUD panel is deliberate: inside, it had to share the
 * status row's box and stretched to whatever height that row happened to be.
 * As its own element it stays the size of three lamps and nothing else, and it
 * follows the HUD wherever the player drags it.
 *
 * Only the player who owns it ever sees it; the GM reads the same lights off
 * their roster and the alert layer.
 */
export class SafetyLightPanel {
  constructor() {
    this._element = null;
    this._lamps = new Map();
    this._unsubscribe = null;
    this._resizeObserver = null;
    this._mutationObserver = null;
    this._observedHud = null;
    this._light = null;
    this._requested = null;
    this._lastGeometry = '';
    this._findFrame = null;
    this._clickHandler = this._onClick.bind(this);
    this._boundReposition = () => this._reposition();
  }

  initialize() {
    // The GM drives the ask and reads the answers; they have no light of their own.
    if (game.user.isGM) return;
    this._createElement();
    this._unsubscribe = PacerManager.subscribe(state => this._update(state));
    this._update(PacerManager.getState());
    window.addEventListener('resize', this._boundReposition);
    this._awaitHud();
  }

  _createElement() {
    this._element = document.createElement('aside');
    this._element.id = 'stream-pacer-safety-light';
    this._element.className = 'stream-pacer-safety-light dock-right';
    this._element.setAttribute('role', 'group');
    this._element.setAttribute('aria-label', game.i18n.localize('STREAM_PACER.SafetyCheck.LightGroupLabel'));

    const hood = document.createElement('span');
    hood.className = 'sp-sl-hood';
    hood.setAttribute('aria-hidden', 'true');
    this._element.appendChild(hood);

    for (const status of Object.values(SAFETY_STATUS)) {
      const label = game.i18n.localize(`STREAM_PACER.SafetyCheck.${status}`);
      const lamp = document.createElement('button');
      lamp.type = 'button';
      lamp.className = `sp-sl-lamp lamp-${status}`;
      lamp.dataset.light = status;
      lamp.setAttribute('aria-label', label);
      lamp.setAttribute('aria-pressed', 'false');
      lamp.title = label;

      const lens = document.createElement('span');
      lens.className = 'sp-sl-lens';
      lens.setAttribute('aria-hidden', 'true');
      lamp.appendChild(lens);

      this._element.appendChild(lamp);
      this._lamps.set(status, lamp);
    }

    this._element.addEventListener('click', this._clickHandler);
    document.body.appendChild(this._element);
  }

  _onClick(event) {
    const lamp = event.target.closest('[data-light]');
    if (!lamp) return;
    PacerManager.setSafetyLight(game.user.id, lamp.dataset.light);
  }

  // --- State ---

  _update(state) {
    if (!this._element) return;

    const light = state.mySafetyLight;
    const requested = state.safetyRequest.active === true;
    if (light === this._light && requested === this._requested) return;
    this._light = light;
    this._requested = requested;

    for (const [status, lamp] of this._lamps) {
      const lit = status === light;
      lamp.classList.toggle('is-lit', lit);
      lamp.setAttribute('aria-pressed', lit ? 'true' : 'false');
    }

    this._element.classList.remove('light-green', 'light-yellow', 'light-red');
    this._element.classList.add(`light-${light}`);
    this._element.classList.toggle('is-asking', requested);
    // The words the lamps can't say: hovering the housing reads out the
    // standing light, or the GM's ask while one is open.
    this._element.title = requested
      ? game.i18n.localize('STREAM_PACER.SafetyCheck.RequestPrompt')
      : game.i18n.format('STREAM_PACER.SafetyCheck.Readout', {
          status: game.i18n.localize(`STREAM_PACER.SafetyCheck.Word.${light}`)
        });
  }

  // --- Docking ---

  /**
   * The HUD renders asynchronously, so wait for its element before observing
   * it. Cheap frame poll, and it stops the moment the HUD appears.
   */
  _awaitHud() {
    const tick = () => {
      const hud = document.querySelector(HUD_SELECTOR);
      if (hud) {
        this._findFrame = null;
        this._observe(hud);
        this._reposition();
        return;
      }
      this._findFrame = requestAnimationFrame(tick);
    };
    this._findFrame = requestAnimationFrame(tick);
  }

  /**
   * Follow the HUD without a permanent frame loop: dragging rewrites the app
   * element's inline `style`, and every other move (re-render, content growth)
   * changes its box.
   */
  _observe(hud) {
    this._observedHud = hud;

    this._mutationObserver = new MutationObserver(this._boundReposition);
    this._mutationObserver.observe(hud, { attributes: true, attributeFilter: ['style', 'class'] });

    this._resizeObserver = new ResizeObserver(this._boundReposition);
    this._resizeObserver.observe(hud);
  }

  _reposition() {
    if (!this._element) return;
    const hud = this._observedHud ?? document.querySelector(HUD_SELECTOR);
    if (!hud) {
      this._element.classList.remove('is-mounted');
      return;
    }

    const rect = hud.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      this._element.classList.remove('is-mounted');
      return;
    }

    // Measure once mounted — the housing is sized by its own content.
    const self = this._element.getBoundingClientRect();
    const width = self.width || 22;
    const height = self.height || 54;

    // Dock to the right flank, and flip to the left one when the HUD is parked
    // hard against the right edge so the light never runs off screen.
    const dockRight = rect.right + width <= window.innerWidth - 4;
    const left = dockRight ? rect.right - 1 : rect.left - width + 1;
    const top = Math.max(2, Math.min(
      window.innerHeight - height - 2,
      rect.top + (rect.height - height) / 2
    ));

    // Ride the HUD's stacking order so the light never slips behind it or in
    // front of a window the HUD itself sits behind.
    const zIndex = getComputedStyle(hud).zIndex;
    const geometry = `${Math.round(left)}:${Math.round(top)}:${dockRight ? 'r' : 'l'}:${zIndex}`;
    if (geometry === this._lastGeometry) return;
    this._lastGeometry = geometry;

    this._element.style.left = `${Math.round(left)}px`;
    this._element.style.top = `${Math.round(top)}px`;
    this._element.style.zIndex = zIndex === 'auto' ? '' : zIndex;
    this._element.classList.toggle('dock-right', dockRight);
    this._element.classList.toggle('dock-left', !dockRight);
    this._element.classList.add('is-mounted');
  }

  destroy() {
    if (this._findFrame !== null) {
      cancelAnimationFrame(this._findFrame);
      this._findFrame = null;
    }
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._mutationObserver?.disconnect();
    this._mutationObserver = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._observedHud = null;
    window.removeEventListener('resize', this._boundReposition);
    if (this._element) {
      this._element.removeEventListener('click', this._clickHandler);
      this._element.remove();
      this._element = null;
    }
    this._lamps.clear();
  }
}
