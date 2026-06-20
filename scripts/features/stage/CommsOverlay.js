import { getSetting } from './settings.js';
import { escapeHTML } from '../../core/util.mjs';

const SHOW_DURATION = 350;
const HIDE_DURATION = 300;
const CONNECT_DURATION = 1100; // connecting → live handoff (matches CSS connect keyframes)
const DEFAULT_ACTOR_IMAGE = 'icons/svg/mystery-man.svg';

function actorImage(actor) {
    return actor?.image || DEFAULT_ACTOR_IMAGE;
}

function finiteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function framingTransform(actor) {
    const s = finiteNumber(actor?.commsScale, 1);
    const x = finiteNumber(actor?.commsOffsetX, 0);
    const y = finiteNumber(actor?.commsOffsetY, 0);
    return `translate(${x}%, ${y}%) scale(${s})`;
}

/**
 * Guarantee comms.css is actually loaded.
 *
 * Foundry only injects newly-added `styles` manifest entries on a full world
 * relaunch — a browser refresh re-runs the esmodules (so the comms feature
 * appears) but can leave the new stylesheet uninjected. Without it the overlay
 * has no `position: fixed` (so it shoves Foundry's sidebar out of flow) and
 * none of the themed effects apply. Detect that case and inject the link
 * ourselves so the feature works without requiring a server restart.
 */
function ensureCommsStylesheet() {
    const href = new URL('../styles/comms.css', import.meta.url).href;
    const already = [...document.styleSheets].some(s => s.href === href)
        || !!document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
    if (already) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

/**
 * The "call-in" / Comms overlay — a vertical stack of themed portrait cards
 * anchored to a screen edge, shown to all players when the GM rings someone in.
 *
 * Mirrors StageOverlay: mounted inside Foundry's #interface layer (below all
 * UI), DOM-reconciling keyed by callId so connect/hangup/restack animations
 * stay smooth, with WAAPI show/hide and CSS-driven per-theme effects.
 */
export class CommsOverlay {
    constructor() {
        this._element = null;
        this._cardsEl = null;
        this._state = { visible: false, calls: [], speakingCall: null };
        /** @type {Set<Element>} Cards currently animating out (hangup) */
        this._exiting = new Set();
        this._isHidden = true;
        this._visibilityAnim = null;
        /** When hiding, hide the container only after all cards finish exiting. */
        this._pendingHideAfterExit = false;
    }

    render() {
        if (this._element) this._element.remove();

        // Make sure the stylesheet exists even after a plain browser refresh.
        ensureCommsStylesheet();

        const el = document.createElement('div');
        el.id = 'gluniverse-comms-overlay';
        el.classList.add('gluniverse-comms-overlay', 'hidden');

        // Fixed on <body> at a low z-index — above the canvas but below all
        // Foundry/system UI, identical strategy to StageOverlay (see comms.css).
        // Critical positioning is also set inline as a defensive fallback: if
        // comms.css is momentarily absent, this still keeps the overlay out of
        // document flow so it can never push Foundry's sidebar/layout.
        el.style.position = 'fixed';
        el.style.zIndex = '1';
        el.style.pointerEvents = 'none';
        document.body.appendChild(el);
        this._element = el;

        const cards = document.createElement('div');
        cards.classList.add('glcomms-cards');
        el.appendChild(cards);
        this._cardsEl = cards;

        this._isHidden = true;
        this.updateLayout();
        this._renderContent();
    }

    updateLayout() {
        if (!this._element) return;
        const edge = getSetting('commsEdge') || 'right';
        const vAlign = getSetting('commsVAlign') || 'centered';
        const width = getSetting('commsFrameWidth') || 170;
        const vOffset = getSetting('commsTopOffset') ?? 0;
        const edgeOffset = getSetting('commsEdgeOffset') ?? 18;

        // Theme is applied per-card (each actor may override it), not on the
        // container — only edge/size/anchoring live here.
        this._element.classList.remove('edge-left', 'edge-right');
        this._element.classList.add(`edge-${edge}`);
        this._element.classList.remove('valign-centered', 'valign-top', 'valign-bottom');
        this._element.classList.add(`valign-${vAlign}`);
        this._element.style.setProperty('--comms-width', `${width}px`);
        this._element.style.setProperty('--comms-edge-offset', `${edgeOffset}px`);
        // Vertical offset relative to the anchor: nudges up/down from centre, or
        // sets the gap from the top/bottom edge when anchored there.
        this._element.style.setProperty('--comms-voffset', `${vOffset}vh`);

        // The world-default theme may have changed; refresh cards that inherit it.
        if (this._cardsEl) {
            for (const call of this._state.calls || []) {
                const card = this._cardsEl.querySelector(`:scope > [data-call-id="${call.callId}"]`);
                if (card) this._applyCardTheme(card, call.actor);
            }
        }
    }

    /** Resolve an actor's effective comms theme: own override or world default. */
    _resolveTheme(actor) {
        const t = actor?.commsTheme;
        if (t === 'scifi' || t === 'ethereal' || t === 'minimal') return t;
        return getSetting('commsTheme') || 'scifi';
    }

    /** Apply theme class + tint variable to a single card. */
    _applyCardTheme(el, actor) {
        const theme = this._resolveTheme(actor);
        el.classList.remove('theme-scifi', 'theme-ethereal', 'theme-minimal');
        el.classList.add(`theme-${theme}`);

        const tint = actor?.commsTint;
        if (tint) {
            el.style.setProperty('--comms-tint', tint);
            el.classList.add('has-tint');
        } else {
            el.style.removeProperty('--comms-tint');
            el.classList.remove('has-tint');
        }
    }

    applyState(state) {
        this._state = { ...this._state, ...state };
        if (!Array.isArray(this._state.calls)) this._state.calls = [];
        this._renderContent();
    }

    // ─── Show / Hide ───

    /**
     * Fade the whole overlay container in. Per-card "connect" and "hang-up"
     * animations carry the personality, so the container itself only does a
     * plain opacity fade — no translateX slide (which read as a weird "move").
     */
    _showOverlay() {
        if (!this._element) return;
        if (this._visibilityAnim) { this._visibilityAnim.cancel(); this._visibilityAnim = null; }
        // Showing cancels any in-flight hide.
        this._pendingHideAfterExit = false;

        this._element.classList.remove('hidden');
        this._element.style.transform = '';
        this._element.style.opacity = '0';

        const anim = this._element.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: SHOW_DURATION, easing: 'ease', fill: 'forwards' }
        );
        this._visibilityAnim = anim;
        anim.finished.then(() => {
            if (this._visibilityAnim === anim) {
                this._visibilityAnim = null;
                this._element.style.opacity = '';
            }
        }).catch(() => {});
    }

    /**
     * Hide by exiting every live card with its own per-theme hang-up animation
     * (e.g. the sci-fi CRT collapse), then hiding the empty container once the
     * last one is gone. This means even hanging up the final call plays the
     * proper turn-off effect, and no stale card lingers to double up on the
     * next call.
     */
    _hideAll() {
        if (!this._element || !this._cardsEl) return;
        if (this._visibilityAnim) { this._visibilityAnim.cancel(); this._visibilityAnim = null; }
        this._element.style.opacity = '';
        this._element.style.transform = '';

        const live = [...this._cardsEl.children].filter(c => !this._exiting.has(c));
        if (live.length === 0) {
            this._element.classList.add('hidden');
            return;
        }
        this._pendingHideAfterExit = true;
        for (const child of live) this._animateCardExit(child);
    }

    _maybeFinishHide() {
        if (!this._pendingHideAfterExit) return;
        const liveLeft = [...this._cardsEl.children].some(c => !this._exiting.has(c));
        if (liveLeft || this._exiting.size > 0) return;
        this._pendingHideAfterExit = false;
        this._element.classList.add('hidden');
        this._element.style.opacity = '';
    }

    // ─── Reconcile ───

    _renderContent() {
        if (!this._element || !this._cardsEl) return;
        const wasHidden = this._isHidden;

        const calls = this._state.calls || [];
        if (!this._state.visible || calls.length === 0) {
            if (!this._isHidden) {
                this._isHidden = true;
                this._hideAll();
            }
            return;
        }

        this._isHidden = false;
        if (wasHidden) this._showOverlay();
        this._reconcile(wasHidden);
    }

    _reconcile(wasHidden) {
        const calls = this._state.calls || [];
        const container = this._cardsEl;
        const speakingId = this._state.speakingCall;
        const hasSpeaker = !!speakingId && calls.some(c => c.callId === speakingId);

        // ── FLIP snapshot ──
        const oldRects = new Map();
        for (const child of container.children) {
            if (this._exiting.has(child)) continue;
            const id = child.dataset.callId;
            if (id) oldRects.set(id, child.getBoundingClientRect());
        }

        // ── Desired map ──
        const desired = new Map();
        for (let i = 0; i < calls.length; i++) {
            const c = calls[i];
            if (c.callId) desired.set(c.callId, { call: c, index: i });
        }

        // ── Hang up cards no longer present ──
        for (const child of [...container.children]) {
            if (this._exiting.has(child)) continue;
            const id = child.dataset.callId;
            if (!id || !desired.has(id)) this._animateCardExit(child);
        }

        // ── Create / update ──
        const cardEls = new Map();
        for (const [callId, { call }] of desired) {
            let el = container.querySelector(`:scope > [data-call-id="${callId}"]`);
            const isNew = !el;
            if (isNew) {
                el = this._createCard(callId, call);
                container.appendChild(el);
                // Every incoming card plays its per-theme connect sequence
                // (sci-fi signal-acquire flicker / ethereal coalesce).
                this._playConnect(el);
            } else {
                this._updateCard(el, call);
            }

            const speaking = speakingId === callId;
            el.classList.toggle('speaking', speaking);
            el.classList.toggle('dimmed', hasSpeaker && !speaking);
            cardEls.set(callId, el);
        }

        // ── Reorder DOM to match ──
        const orderedIds = calls.map(c => c.callId).filter(Boolean);
        let prev = null;
        for (const id of orderedIds) {
            const el = cardEls.get(id);
            if (!el) continue;
            if (prev) {
                if (prev.nextElementSibling !== el) prev.after(el);
            } else {
                const first = [...container.children].find(c => !this._exiting.has(c));
                if (first !== el) container.insertBefore(el, first || null);
            }
            prev = el;
        }

        // ── FLIP reposition ──
        for (const [id, el] of cardEls) {
            const oldRect = oldRects.get(id);
            if (!oldRect) continue;
            const newRect = el.getBoundingClientRect();
            const dx = oldRect.left - newRect.left;
            const dy = oldRect.top - newRect.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            el.style.transition = 'none';
            void el.offsetWidth;
            el.style.transition = 'transform 0.4s ease';
            el.style.transform = '';
            el.addEventListener('transitionend', function handler(e) {
                if (e.propertyName === 'transform') {
                    el.style.transition = '';
                    el.removeEventListener('transitionend', handler);
                }
            });
        }
    }

    _playConnect(el) {
        el.classList.add('glcomms-connecting');
        window.setTimeout(() => el.classList.remove('glcomms-connecting'), CONNECT_DURATION);
    }

    _animateCardExit(el) {
        this._exiting.add(el);
        el.classList.remove('speaking', 'dimmed');

        // Snapshot the cards that will fill the gap so we can FLIP them up once
        // this one is actually removed from layout (transforms don't reflow).
        const container = this._cardsEl;
        const rects = new Map();
        for (const sib of container.children) {
            if (sib === el || this._exiting.has(sib)) continue;
            rects.set(sib, sib.getBoundingClientRect());
        }

        el.classList.add('glcomms-leaving');

        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            el.removeEventListener('animationend', onAnim);
            el.remove();
            this._exiting.delete(el);
            this._flipFrom(rects);
            this._maybeFinishHide();
        };
        const onAnim = (e) => { if (e.target === el) finish(); };
        el.addEventListener('animationend', onAnim);
        window.setTimeout(finish, 900); // fallback if animationend never fires
    }

    _flipFrom(rects) {
        for (const [el, oldRect] of rects) {
            if (!el.isConnected) continue;
            const newRect = el.getBoundingClientRect();
            const dx = oldRect.left - newRect.left;
            const dy = oldRect.top - newRect.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            el.style.transition = 'none';
            void el.offsetWidth;
            el.style.transition = 'transform 0.35s ease';
            el.style.transform = '';
            el.addEventListener('transitionend', function handler(e) {
                if (e.propertyName === 'transform') {
                    el.style.transition = '';
                    el.removeEventListener('transitionend', handler);
                }
            });
        }
    }

    _createCard(callId, call) {
        const el = document.createElement('div');
        el.classList.add('glcomms-card');
        el.dataset.callId = callId;
        el.innerHTML = this._cardInner(call);
        this._applyCardTheme(el, call.actor);
        this._applyPortraitVars(el, call.actor);
        return el;
    }

    /**
     * Portrait framing transform + source image as card-level CSS vars, shared
     * by the portrait image AND the masked rim-light layer so they stay aligned.
     */
    _applyPortraitVars(el, actor) {
        el.style.setProperty('--gp-transform', framingTransform(actor));
        el.style.setProperty('--portrait-src', `url("${actorImage(actor)}")`);
    }

    _updateCard(el, call) {
        const actor = call.actor;
        const src = actorImage(actor);
        const name = actor?.name || '';

        const img = el.querySelector('.glcomms-portrait');
        if (img) {
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
            if (img.alt !== name) img.alt = name;
        }
        const nameEl = el.querySelector('.glcomms-name');
        if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;

        // Framing + source (drives portrait and rim), theme/tint may have changed.
        this._applyPortraitVars(el, actor);
        this._applyCardTheme(el, actor);
        const labels = this._statusLabels(this._resolveTheme(actor));
        const statusText = el.querySelector('.glcomms-status-text');
        if (statusText) {
            statusText.dataset.connecting = labels.connecting;
            statusText.dataset.live = labels.live;
        }
    }

    /**
     * Live-preview comms theme + tint for cards showing the given actor, with no
     * state/socket round-trip — used while the GM tweaks the presentation
     * controls. (Persisted + broadcast to players on commit.)
     */
    previewPresentation(actorId, presentation) {
        if (!this._cardsEl) return;
        for (const call of this._state.calls || []) {
            if (call.actorId !== actorId) continue;
            const card = this._cardsEl.querySelector(`:scope > [data-call-id="${call.callId}"]`);
            if (card) this._applyCardTheme(card, presentation);
        }
    }

    /**
     * Live-preview comms framing (scale / x / y) for every card showing the
     * given actor, without going through state/socket — used while the GM drags
     * the framing number inputs for instant local feedback.
     */
    previewFraming(actorId, framing) {
        if (!this._cardsEl) return;
        const transform = framingTransform(framing);
        for (const call of this._state.calls || []) {
            if (call.actorId !== actorId) continue;
            const card = this._cardsEl.querySelector(`:scope > [data-call-id="${call.callId}"]`);
            if (card) card.style.setProperty('--gp-transform', transform);
        }
    }

    _cardInner(call) {
        const actor = call.actor;
        const src = escapeHTML(actorImage(actor));
        const name = escapeHTML(actor?.name || '');
        const labels = this._statusLabels(this._resolveTheme(actor));

        return `
            <div class="glcomms-frame">
                <div class="glcomms-portrait-wrap">
                    <img class="glcomms-portrait" src="${src}" alt="${name}" draggable="false"/>
                </div>
                <div class="glcomms-rim"></div>
                <div class="glcomms-fx glcomms-fx-tint"></div>
                <div class="glcomms-fx glcomms-fx-scanlines"></div>
                <div class="glcomms-fx glcomms-fx-grain"></div>
                <div class="glcomms-fx glcomms-fx-glow"></div>
                <div class="glcomms-status">
                    <span class="glcomms-status-dot"></span>
                    <span class="glcomms-status-text"
                          data-connecting="${escapeHTML(labels.connecting)}"
                          data-live="${escapeHTML(labels.live)}"></span>
                </div>
            </div>
            <div class="glcomms-name">${name}</div>
        `;
    }

    _statusLabels(theme) {
        const L = (key) => game.i18n.localize(`GLSTAGE.comms.${key}`);
        if (theme === 'ethereal') return { connecting: L('sending'), live: L('attuned') };
        return { connecting: L('connecting'), live: L('live') };
    }

    close() {
        if (this._visibilityAnim) { this._visibilityAnim.cancel(); this._visibilityAnim = null; }
        if (this._element) {
            this._element.remove();
            this._element = null;
            this._cardsEl = null;
        }
    }
}
