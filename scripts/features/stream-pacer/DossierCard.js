import { escapeHTML } from '../../core/util.mjs';

/**
 * DossierCard — the solid, centred pacing panel.
 *
 * One card per owner (the signal overlay has one, the campfire has its own for
 * its arrival). It knows how to draw a spec and how to arrive, dock and leave;
 * it knows nothing about pacer state. Every beat of the arrival is CSS driven
 * off `.is-arriving` (see styles/stream-pacer.css, "Dossier"), so the JS only
 * has to restart that class.
 *
 * Spec:
 *   tone     'amber' | 'cyan' | 'hazard' | 'green' | 'ember'
 *   icon     optional Font Awesome class for the header strip
 *   label    header strip text ("Ready check")
 *   code     mono header code ("SIG-02 // GM") — typed in on arrival
 *   kicker   mono line above the title — typed in on arrival
 *   title    the one line the table has to read
 *   timer    optional big mono clock (countdown)
 *   guide    optional HTML (callers escape; <em> marks the button words)
 *   actions  optional [{ id, label, icon, variant: 'go'|'hand'|'ghost' }]
 *   tally    optional [{ name, initials, avatar, isReady, isHand }]
 *   footer   optional [left, right] mono strings
 */
export class DossierCard {
  constructor({ onAction = null } = {}) {
    this._onAction = onAction;

    this.stage = document.createElement('div');
    this.stage.className = 'sp-dz-stage gl-type';

    this.card = document.createElement('section');
    this.card.className = 'sp-dz';
    this.card.setAttribute('role', 'status');
    this.card.setAttribute('aria-live', 'polite');
    this.stage.appendChild(this.card);

    this.card.addEventListener('click', (event) => {
      const button = event.target.closest('[data-dz-action]');
      if (!button || !this.card.contains(button)) return;
      event.preventDefault();
      this._onAction?.(button.dataset.dzAction);
    });

    document.body.appendChild(this.stage);
  }

  /** Redraw the card from a spec. Cheap enough to call on every state change. */
  render(spec) {
    this.card.dataset.tone = spec.tone || 'amber';

    const typed = (cls, text) => text
      ? `<span class="${cls} sp-dz-typed" style="--sp-dz-chars:${[...text].length}">${escapeHTML(text)}</span>`
      : '';

    const actions = (spec.actions || []).map(a => `
      <button type="button" class="sp-dz-btn sp-dz-btn--${a.variant || 'ghost'}" data-dz-action="${escapeHTML(a.id)}">
        ${a.icon ? `<i class="${escapeHTML(a.icon)}" aria-hidden="true"></i>` : ''}<span>${escapeHTML(a.label)}</span>
      </button>`).join('');

    // Each pip carries a status badge, so the answer reads from the icon alone
    // (a tick, a hand, or still waiting) and never from colour by itself.
    const tally = (spec.tally || []).map(p => {
      const state = p.isReady ? 'is-ready' : p.isHand ? 'is-hand' : 'is-waiting';
      const badge = p.isReady ? 'fa-check' : p.isHand ? 'fa-hand' : 'fa-ellipsis';
      const face = p.avatar
        ? `<img src="${escapeHTML(p.avatar)}" alt="">`
        : `<span>${escapeHTML(p.initials)}</span>`;
      return `<span class="sp-dz-pip ${state}" title="${escapeHTML(p.name)}">${face}`
        + `<i class="sp-dz-pip-badge fa-solid ${badge}" aria-hidden="true"></i></span>`;
    }).join('');

    const footer = spec.footer
      ? `<footer class="sp-dz-ft"><span>${escapeHTML(spec.footer[0] ?? '')}</span><span>${escapeHTML(spec.footer[1] ?? '')}</span></footer>`
      : '';

    this.card.innerHTML = `
      <header class="sp-dz-hd">
        <span class="sp-dz-hd-label">${spec.icon ? `<i class="${escapeHTML(spec.icon)}" aria-hidden="true"></i>` : ''}${escapeHTML(spec.label)}</span>
        ${typed('sp-dz-hd-code', spec.code)}
      </header>
      <div class="sp-dz-hazard" aria-hidden="true"></div>
      <div class="sp-dz-bd">
        ${typed('sp-dz-kicker', spec.kicker)}
        <div class="sp-dz-title">${escapeHTML(spec.title)}</div>
        ${spec.timer != null ? `<div class="sp-dz-timer">${escapeHTML(spec.timer)}</div>` : ''}
        ${spec.guide ? `<div class="sp-dz-guide">${spec.guide}</div>` : ''}
      </div>
      ${actions ? `<div class="sp-dz-acts">${actions}</div>` : ''}
      ${tally ? `<div class="sp-dz-tally">${tally}</div>` : ''}
      ${footer}`;
  }

  /** Update only the clock, so a per-second tick never restarts the arrival. */
  setTimer(text) {
    const el = this.card.querySelector('.sp-dz-timer');
    if (el) el.textContent = text;
  }

  setFlag(name, on) {
    this.card.classList.toggle(name, !!on);
  }

  /** Show centred. `animate` replays the full arrival; otherwise it just appears. */
  open({ animate = true } = {}) {
    this.stage.classList.remove('is-docking', 'is-leaving', 'is-sinking');
    this.card.classList.remove('is-arriving');
    if (animate) {
      // Force a reflow so the arrival keyframes restart from their first frame.
      void this.card.offsetWidth;
      this.card.classList.add('is-arriving');
    }
    this.stage.classList.add('is-open');
  }

  /** Shrink up and away towards the top-centre dock. */
  dock() {
    if (!this.isOpen) return;
    this.stage.classList.add('is-docking');
    this.stage.classList.remove('is-open');
  }

  /** Drop down and away towards a bottom-edge bar (the campfire). */
  sink() {
    if (!this.isOpen) return;
    this.stage.classList.add('is-sinking');
    this.stage.classList.remove('is-open');
  }

  /** Fade out in place (signal cancelled). */
  close() {
    if (!this.isOpen) return;
    this.stage.classList.add('is-leaving');
    this.stage.classList.remove('is-open');
  }

  get isOpen() {
    return this.stage.classList.contains('is-open');
  }

  destroy() {
    this.stage.remove();
  }
}
