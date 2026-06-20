import { MODULE_ID, PLAYER_STATUS } from './settings.js';
import { PacerManager } from './PacerManager.js';

/**
 * HandRaiseBar - Horizontal scrolling ticker at the bottom for GM
 * Shows players who have raised their hands prominently
 * Positioned ABOVE the existing GM signal overlay bar
 * Auto-shows when hands are raised, auto-hides when none
 */
export class HandRaiseSidebar {
  constructor() {
    this._element = null;
    this._auraEl = null;
    this._contentEl = null;
    this._unsubscribe = null;
    this._isVisible = false;
    this._currentPlayers = [];
  }

  /**
   * Initialize the bar (GM only)
   */
  initialize() {
    // Only for GM
    if (!game.user.isGM) return;

    this._createElement();

    // Subscribe to state updates
    this._unsubscribe = PacerManager.subscribe((state) => {
      this._update(state);
    });

    // Initial update
    this._update(PacerManager.getState());
  }

  /**
   * Create the bar DOM structure - horizontal ticker at bottom
   */
  _createElement() {
    // Aura sibling — sits directly below the hand-raise bar and fades downward.
    // Lives outside the bar's overflow box so the gradient can extend ~3x the
    // bar height. Always tinted with the hand-raise blue.
    this._auraEl = document.createElement('div');
    this._auraEl.className = 'stream-pacer-bar-aura aura-top hand-raise';
    document.body.appendChild(this._auraEl);

    this._element = document.createElement('div');
    this._element.id = 'stream-pacer-hand-bar';
    this._element.className = 'stream-pacer-hand-bar';

    // Content container for scrolling
    this._contentEl = document.createElement('div');
    this._contentEl.className = 'hand-bar-content';
    this._element.appendChild(this._contentEl);

    document.body.appendChild(this._element);
  }

  /**
   * Update bar based on current state
   */
  _update(state) {
    // Get players with raised hands
    const allPlayerStates = PacerManager.getAllPlayerStates();
    const handRaisedPlayers = Object.values(allPlayerStates)
      .filter(p => p.status === PLAYER_STATUS.HAND_RAISED);

    // Check if we need to update content
    const playerIds = handRaisedPlayers.map(p => p.userId).sort().join(',');
    const currentIds = this._currentPlayers.map(p => p.userId).sort().join(',');

    if (playerIds !== currentIds) {
      this._currentPlayers = handRaisedPlayers;
      this._rebuildContent();
    }

    // Show/hide based on count
    if (handRaisedPlayers.length > 0 && !this._isVisible) {
      this._show();
    } else if (handRaisedPlayers.length === 0 && this._isVisible) {
      this._hide();
    }
  }

  /**
   * Rebuild the content - static centered display
   */
  _rebuildContent() {
    if (!this._contentEl) return;

    if (this._currentPlayers.length === 0) {
      this._contentEl.replaceChildren();
      return;
    }

    // Edge rules for decorative horizontal lines
    const edgeT = document.createElement('span');
    edgeT.className = 'hb-edge hb-edge-t';
    const edgeB = document.createElement('span');
    edgeB.className = 'hb-edge hb-edge-b';

    // Content row
    const row = document.createElement('span');
    row.className = 'hb-row';

    // PRIORITY / 01 index chip
    const ix = document.createElement('span');
    ix.className = 'hb-ix';
    ix.textContent = game.i18n.format('STREAM_PACER.PriorityIndex', { n: '01' });

    // Hand icon
    const icon = document.createElement('span');
    icon.className = 'hb-icon';
    const iconI = document.createElement('i');
    iconI.className = 'fa-solid fa-hand';
    icon.appendChild(iconI);

    // Names (textContent only — player names are untrusted strings)
    const names = document.createElement('span');
    names.className = 'hb-names';
    names.textContent = this._currentPlayers.map(p => p.name).join(', ');

    // Trailing tag
    const tag = document.createElement('span');
    tag.className = 'hb-tag';
    tag.textContent = game.i18n.localize('STREAM_PACER.HandRaisedTag');

    row.append(ix, icon, names, tag);
    this._contentEl.replaceChildren(edgeT, edgeB, row);
  }

  /**
   * Show the bar with animation
   */
  _show() {
    if (!this._element) return;
    this._isVisible = true;
    this._element.classList.add('active');
    if (this._auraEl) this._auraEl.classList.add('active');

    // Notify the main overlay to adjust its position
    document.body.classList.add('hand-bar-visible');
  }

  /**
   * Hide the bar with animation
   */
  _hide() {
    if (!this._element) return;
    this._isVisible = false;
    this._element.classList.remove('active');
    if (this._auraEl) this._auraEl.classList.remove('active');

    // Notify the main overlay to reset its position
    document.body.classList.remove('hand-bar-visible');
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._element) {
      this._element.remove();
      this._element = null;
      this._contentEl = null;
    }
    if (this._auraEl) {
      this._auraEl.remove();
      this._auraEl = null;
    }
    this._currentPlayers = [];
    document.body.classList.remove('hand-bar-visible');
  }
}
