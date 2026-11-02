// Stream Pacer — the HUD: a small black panel the GM drives the table from, and
// the player raises a hand or a light from.
//
// A plain DOM component over model.hudModel(). It redraws only when what it
// would draw changes, so a hover, an open tooltip or keyboard focus survives the
// constant trickle of presence and flag updates. Reads no `game`.

import { hudHTML } from './render.js';

export class PacerHud {
  /**
   * @param {object} o
   * @param {(k:string, d?:object) => string} o.L
   * @param {(action:string, data:DOMStringMap, ev:Event) => void} o.onAction
   * @param {{left:number|null, top:number|null}} [o.position]
   * @param {(pos:{left:number, top:number}) => void} [o.onMove]
   * @param {HTMLElement} [o.parent]
   */
  constructor({ L, onAction, position = null, onMove = null, parent = document.body }) {
    this.L = L;
    this.onAction = onAction;
    this.onMove = onMove;
    this.root = document.createElement('aside');
    this.root.id = 'stream-pacer-hud';
    this.root.className = 'sp-root sp-hud gl-type';
    this.root.setAttribute('aria-label', L('STREAM_PACER.Hud.Title'));
    parent.appendChild(this.root);
    this._html = '';
    if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) this._place(position.left, position.top);

    this._onClick = (ev) => {
      const btn = ev.target.closest('[data-sp-action]');
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      this.onAction(btn.dataset.spAction, btn.dataset, ev);
    };
    this._onContext = (ev) => {
      const btn = ev.target.closest('[data-sp-action="mark"]');
      if (!btn) return;
      ev.preventDefault();
      this.onAction('unmark', btn.dataset, ev);
    };
    this._onDown = (ev) => this._dragStart(ev);
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('contextmenu', this._onContext);
    this.root.addEventListener('pointerdown', this._onDown);
    this._onResize = () => this._clamp();
    window.addEventListener('resize', this._onResize);
  }

  update(vm) {
    const html = hudHTML(vm, this.L);
    this.root.classList.toggle('is-gm', !!vm.gm);
    this.root.classList.toggle('is-collapsed', !!vm.collapsed);
    if (html === this._html) return;
    const focusKey = document.activeElement && this.root.contains(document.activeElement) ? focusId(document.activeElement) : null;
    this.root.innerHTML = html;
    this._html = html;
    if (focusKey) this.root.querySelector(focusKey)?.focus({ preventScroll: true });
    this._clamp();
  }

  destroy() {
    this.root.removeEventListener('click', this._onClick);
    this.root.removeEventListener('contextmenu', this._onContext);
    this.root.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('resize', this._onResize);
    this.root.remove();
  }

  /* ── dragging by the header ── */

  _dragStart(ev) {
    if (ev.button !== 0 || !ev.target.closest('[data-sp-drag]') || ev.target.closest('button')) return;
    const rect = this.root.getBoundingClientRect();
    const dx = ev.clientX - rect.left;
    const dy = ev.clientY - rect.top;
    this.root.classList.add('is-dragging');
    this.root.setPointerCapture?.(ev.pointerId);
    const move = (e) => this._place(e.clientX - dx, e.clientY - dy);
    const up = (e) => {
      this.root.releasePointerCapture?.(e.pointerId);
      this.root.removeEventListener('pointermove', move);
      this.root.removeEventListener('pointerup', up);
      this.root.removeEventListener('pointercancel', up);
      this.root.classList.remove('is-dragging');
      const r = this.root.getBoundingClientRect();
      this.onMove?.({ left: Math.round(r.left), top: Math.round(r.top) });
    };
    this.root.addEventListener('pointermove', move);
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
  }

  _place(left, top) {
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
    this._clamp();
  }

  /** Keep the panel on screen after a resize or a taller redraw. */
  _clamp() {
    if (!this.root.style.left) return;
    const r = this.root.getBoundingClientRect();
    const maxL = Math.max(0, window.innerWidth - r.width - 4);
    const maxT = Math.max(0, window.innerHeight - Math.min(r.height, 120) - 4);
    const left = Math.min(Math.max(4, r.left), maxL);
    const top = Math.min(Math.max(4, r.top), maxT);
    if (left !== r.left) this.root.style.left = `${Math.round(left)}px`;
    if (top !== r.top) this.root.style.top = `${Math.round(top)}px`;
  }
}

/** A selector that finds the same control after a redraw. */
function focusId(el) {
  const btn = el.closest('[data-sp-action]');
  if (!btn) return null;
  const parts = [`[data-sp-action="${btn.dataset.spAction}"]`];
  for (const k of ['user', 'light', 'status', 'seconds']) if (btn.dataset[k]) parts.push(`[data-${k}="${btn.dataset[k]}"]`);
  return parts.join('');
}
