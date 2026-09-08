import { MODULE_ID, getSetting } from './settings.js';
import { clampNumber, escapeAttr, escapeHTML } from '../../core/util.mjs';
import { animate, createTimeline, motionDuration } from '../../core/motion.mjs';
import { StagePostFX } from './postfx/index.mjs';

const SHOW_DURATION = 400;
const HIDE_DURATION = 350;
const DEFAULT_ACTOR_IMAGE = 'icons/svg/mystery-man.svg';

function actorImage(actor) {
    return actor?.image || DEFAULT_ACTOR_IMAGE;
}

/**
 * The markup for a slot's contents.
 *
 * Single source of truth on purpose: this used to be written out in three
 * places (fresh slot, previously-empty slot, and the crossfade swap), which is
 * exactly the kind of triplication where an overlay layer gets added to two of
 * them and silently vanishes on the third.
 *
 * @param {object} actor
 * @param {boolean} isHighlighted
 * @param {{hidden?: boolean}} [options]  `hidden` starts the content at zero
 *                                        opacity for the crossfade to raise.
 */
function slotContentHTML(actor, isHighlighted, { hidden = false } = {}) {
    const scale = clampNumber(actor.scale, 0.1, 5, 1.0);
    const offsetX = clampNumber(actor.offsetX, -500, 500, 0);
    const offsetY = clampNumber(actor.offsetY, -500, 500, 0);
    const image = escapeAttr(actorImage(actor));
    const nameAttr = escapeAttr(actor.name || '');
    const nameHTML = escapeHTML(actor.name || '');
    const hide = hidden ? 'opacity: 0; ' : '';
    const nameStyle = hidden ? ' style="opacity: 0;"' : '';

    return `
            <div class="stage-actor-img-wrap" style="${hide}transform: scale(${scale}) translate(${offsetX}%, ${offsetY}%);">
                <img class="stage-actor-img" src="${image}" alt="${nameAttr}" draggable="false"/>
            </div>
            <div class="stage-actor-name ${isHighlighted ? 'highlighted' : ''}"${nameStyle}>${nameHTML}</div>
        `;
}

/**
 * The visual novel stage overlay rendered at the bottom of the screen.
 * Visible to all players when the GM activates the stage.
 *
 * Uses DOM reconciliation (keyed by slotId) instead of innerHTML
 * so that enter, exit, and FLIP reorder animations work smoothly.
 * Show/hide and slot choreography share owned Anime.js animations.
 */
export class StageOverlay {
    constructor() {
        this._element = null;
        this._charactersEl = null;
        this._state = {
            visible: false,
            slots: [],
            highlightedSlot: -1,
            stageHeight: 40
        };
        /** @type {Set<Element>} Elements currently animating out */
        this._exitingElements = new Set();
        /** True when the overlay is currently hidden */
        this._isHidden = true;
        /** @type {StagePostFX|null} Created on first show, never before. */
        this._postfx = null;
        this._motions = new Map();
    }

    // ─── Character art post-processing ───

    /**
     * Create the post-processing pipeline. Deliberately lazy: it allocates a
     * WebGL context, and a stage nobody has opened should cost nothing.
     */
    _ensurePostFX() {
        if (this._postfx) return this._postfx;
        this._postfx = new StagePostFX();
        this.updatePostFXConfig();
        return this._postfx;
    }

    /** Read the current settings into the effect and re-sample the scene. */
    updatePostFXConfig() {
        if (!this._postfx) return;
        this._postfx.setConfig({
            enabled: getSetting('ppEnabled') !== false,
            intensity: (Number(getSetting('ppIntensity')) || 0) / 100,
            quality: getSetting('ppQuality') || 'auto',
            style: getSetting('ppStyle') || 'realistic'
        });
        this.refreshPostFXScene();
    }

    /**
     * Re-derive the grade from the scene the *viewing client* is looking at.
     * Each client computes this locally: the point is to match the background
     * actually behind the art, which is a per-client fact, so there is nothing
     * to broadcast.
     */
    refreshPostFXScene() {
        if (!this._postfx) return;
        this._postfx.refreshScene(canvas?.scene ?? game.scenes?.current ?? null);
    }

    /**
     * Live preview while the GM drags the strength slider. Local only — the
     * world setting is committed on release, which is what reaches other
     * clients, so dragging doesn't broadcast a value per frame.
     */
    previewPostFXIntensity(intensity) {
        this._postfx?.setConfig({ intensity });
    }

    /** Report degradation for the GM panel. Never surfaced to players. */
    getPostFXStatus() {
        return this._postfx?.getStatus() ?? null;
    }

    /** An actor's art changed — drop every cached derivative of the old asset. */
    invalidatePostFXArt(src) {
        this._postfx?.invalidateArt(src);
    }

    /** A background was re-uploaded to a path we have already sampled. */
    invalidatePostFXBackground(src) {
        this._postfx?.invalidateBackground(src);
    }

    /**
     * Attach the effect to every currently rendered character.
     * Called after any change that can replace a `.stage-actor-img-wrap`.
     */
    _syncPostFX() {
        const fx = this._postfx;
        const container = this._charactersEl;
        if (!fx || !container) return;

        fx.prune();

        const slots = this._state.slots || [];
        const total = Math.max(slots.length, 1);
        const hasHighlight = this._state.highlightedSlot >= 0;

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot?.slotId || !slot.actor) continue;

            const el = container.querySelector(`:scope > [data-slot-id="${slot.slotId}"]`);
            const wrap = el?.querySelector('.stage-actor-img-wrap');
            if (!wrap) continue;

            const isHighlighted = this._state.highlightedSlot === i;
            fx.register(wrap, {
                src: actorImage(slot.actor),
                // Centre of this slot's share of the stage. Slot X maps straight
                // to background X — no camera transform — so every client lands
                // on the same value and panning never re-grades.
                position: (i + 0.5) / total,
                highlighted: isHighlighted,
                dimmed: hasHighlight && !isHighlighted,
                optOut: slot.actor.ppOptOut === true
            });
        }
    }

    render() {
        if (this._element) this.close();

        const container = document.createElement('div');
        container.id = 'gluniverse-stage-overlay';
        container.classList.add('gluniverse-stage-overlay', 'hidden');

        // Fixed on <body> with a low z-index: above the canvas (#board, z-index
        // 0) but below all Foundry/system chrome — scene controls, navigation,
        // players list, hotbar, the token HUD, and module HUDs like the PF2e
        // HUD — which all sit at much higher z-indexes. pointer-events: none
        // keeps every UI element clickable through the stage. (See main.css.)
        document.body.appendChild(container);
        this._element = container;

        // Persistent characters wrapper
        const chars = document.createElement('div');
        chars.classList.add('stage-characters');
        container.appendChild(chars);
        this._charactersEl = chars;

        this._isHidden = true;
        this.updateLayout();
        this._renderContent();
    }

    updateLayout() {
        if (!this._element) return;
        const height = this._state.stageHeight || getSetting('stageHeight') || 40;
        const width = this._state.stageWidth || getSetting('stageWidth') || 100;
        const xOffset = this._state.stageXOffset ?? getSetting('stageXOffset') ?? 0;
        const crop = this._state.stageYOffset ?? getSetting('stageYOffset') ?? 0;

        // crop is a percentage (0-50) of the character to hide from the bottom.
        // To keep the visible portion filling the stage, we scale the image up
        // and shift the container down so the overflow clips the feet.
        const fraction = Math.min(Math.max(crop, 0), 50) / 100; // 0.0 – 0.5
        const multiplier = 1 / (1 - fraction);
        const imgHeight = height * multiplier;                   // in vh
        const translateY = imgHeight - height;                   // in vh

        this._element.style.setProperty('--stage-height', `${height}vh`);
        this._element.style.setProperty('--stage-width', `${width}%`);
        this._element.style.setProperty('--stage-x-offset', `${xOffset}vw`);
        this._element.style.setProperty('--stage-img-height', `${imgHeight}vh`);
        this._element.style.setProperty('--stage-y-offset', `${translateY}vh`);
    }

    applyState(state) {
        this._state = { ...this._state, ...state };
        this.updateLayout();
        this._renderContent();
    }

    playAnimation(slotIndex, animation) {
        if (!this._element) return;
        const slotEl = this._element.querySelector(`[data-slot-index="${slotIndex}"]`);
        if (!slotEl) return;

        const imgWrap = slotEl.querySelector('.stage-actor-img-wrap');
        if (!imgWrap) return;

        imgWrap.classList.remove(
            'anim-bounce', 'anim-shake', 'anim-flip',
            'anim-nod', 'anim-jiggle', 'anim-fadeIn', 'anim-slideIn'
        );

        if (animation && animation !== 'none') {
            void imgWrap.offsetWidth;
            imgWrap.classList.add(`anim-${animation}`);
            imgWrap.addEventListener('animationend', () => {
                imgWrap.classList.remove(`anim-${animation}`);
            }, { once: true });
        }
    }

    // Each element owns independent visibility, layout and content channels.
    // Replacing one channel reverts its previous writes before a new sequence.
    _stopMotion(el, channel) {
        const channels = this._motions.get(el);
        channels?.get(channel)?.revert();
        channels?.delete(channel);
        if (!channels?.size) {
            this._motions.delete(el);
            el.classList.remove("glstage-anime-owned");
        }
    }

    _motion(el, channel, build) {
        this._stopMotion(el, channel);
        let channels = this._motions.get(el);
        if (!channels) this._motions.set(el, channels = new Map());
        el.classList.add("glstage-anime-owned");
        const animation = build(() => {
            if (channels.get(channel) !== animation) return;
            animation.revert();
            channels.delete(channel);
            if (!channels.size) {
                this._motions.delete(el);
                el.classList.remove("glstage-anime-owned");
            }
        });
        channels.set(channel, animation);
        animation.play();
        return animation;
    }

    _animateShow() { this._animateVisibility(true); }
    _animateHide() { this._animateVisibility(false); }

    _animateVisibility(show) {
        const el = this._element;
        if (!el) return;
        const opacity = this._isHidden && show && el.classList.contains('hidden')
            ? 0 : Number(getComputedStyle(el).opacity);
        const from = el.classList.contains('hidden') ? 0 : opacity;
        this._stopMotion(el, 'visibility');
        el.classList.remove('hidden');
        this._motion(el, 'visibility', done => animate(el, {
            autoplay: false,
            opacity: [from, show ? 1 : 0],
            duration: motionDuration(show ? SHOW_DURATION : HIDE_DURATION, el),
            ease: show ? 'outCubic' : 'inCubic',
            onComplete: () => { done(); el.classList.toggle('hidden', !show); }
        }));
    }

    // ─── DOM-Reconciling Render ───

    _renderContent() {
        if (!this._element || !this._charactersEl) return;

        const wasHidden = this._isHidden;

        // ── Hide ──
        if (!this._state.visible) {
            if (!this._isHidden) {
                this._isHidden = true;
                this._animateHide();
            }
            return;
        }

        // ── Show ──
        this._isHidden = false;
        this._ensurePostFX();
        this._reconcileSlots(wasHidden);
        this._syncPostFX();

        if (wasHidden) {
            this._animateShow();
        }
    }

    _reconcileSlots(wasHidden) {
        const slots = this._state.slots || [];
        const hasHighlight = this._state.highlightedSlot >= 0;
        const container = this._charactersEl;

        // ── 1. Snapshot current positions for FLIP ──
        const oldRects = new Map();
        for (const child of container.children) {
            if (this._exitingElements.has(child)) continue;
            const id = child.dataset.slotId;
            if (id) oldRects.set(id, child.getBoundingClientRect());
        }

        // ── 2. Build desired slotId → slot map ──
        const desired = new Map();
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.slotId) desired.set(slot.slotId, { slot, index: i });
        }

        // ── 3. Remove slots no longer present (exit animation) ──
        for (const child of [...container.children]) {
            if (this._exitingElements.has(child)) continue;
            const id = child.dataset.slotId;
            if (!id || !desired.has(id)) {
                this._animateSlotExit(child);
            }
        }

        // ── 4. Create / update slots ──
        const slotElements = new Map();
        for (const [slotId, { slot, index }] of desired) {
            let el = container.querySelector(`:scope > [data-slot-id="${slotId}"]`);
            if (el && this._exitingElements.has(el)) {
                this._stopMotion(el, 'exit');
                this._exitingElements.delete(el);
            }
            const isNew = !el;

            if (isNew) {
                el = this._createSlotElement(slotId, slot, index, hasHighlight);
                container.appendChild(el);
                // Enter animation — skip if stage was just shown (the show animation handles it)
                if (!wasHidden && slot.actor) {
                    this._enterContent(el);
                }
            } else {
                this._updateSlotElement(el, slot, index, hasHighlight);
            }

            slotElements.set(slotId, el);
        }

        // ── 5. Reorder DOM to match desired order ──
        const orderedIds = slots.map(s => s.slotId).filter(Boolean);
        let prevEl = null;
        for (const id of orderedIds) {
            const el = slotElements.get(id);
            if (!el) continue;
            if (prevEl) {
                if (prevEl.nextElementSibling !== el) {
                    prevEl.after(el);
                }
            } else {
                const firstNonExiting = [...container.children].find(c => !this._exitingElements.has(c));
                if (firstNonExiting !== el) {
                    container.insertBefore(el, firstNonExiting || null);
                }
            }
            prevEl = el;
        }

        // ── 6. FLIP animation for reordered elements ──
        if (!wasHidden) {
            this._flipAnimate(slotElements, oldRects);
        }
    }

    _flipAnimate(slotElements, oldRects) {
        // Capture the visible position before reverting an interrupted layout.
        for (const el of slotElements.values()) this._stopMotion(el, 'layout');
        const moves = [...slotElements].map(([id, el]) => ({
            el, old: oldRects.get(id), rect: el.getBoundingClientRect()
        }));
        for (const { el, old, rect } of moves) {
            if (!old) continue;
            const dx = old.left - rect.left, dy = old.top - rect.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
            this._motion(el, 'layout', done => animate(el, {
            autoplay: false,
                x: [dx, 0], y: [dy, 0], duration: motionDuration(400, el),
                ease: 'outQuint', onComplete: done
            }));
        }
    }

    _enterContent(el) {
        this._motion(el, 'content', done => animate(el.children, {
            autoplay: false,
            opacity: [0, 1], duration: motionDuration(360, el),
            delay: (_, i) => motionDuration(i * 55, el), ease: 'outCubic', onComplete: done
        }));
    }

    _createSlotElement(slotId, slot, index, hasHighlight) {
        const actor = slot.actor;
        const isHighlighted = this._state.highlightedSlot === index;
        const isDimmed = hasHighlight && !isHighlighted;

        const el = document.createElement('div');
        el.classList.add('stage-slot');
        el.dataset.slotId = slotId;
        el.dataset.slotIndex = index;
        if (slot.zIndex != null) el.style.zIndex = slot.zIndex;

        if (!actor) {
            el.classList.add('stage-slot-empty');
            return el;
        }

        if (isHighlighted) el.classList.add('highlighted');
        if (isDimmed) el.classList.add('dimmed');

        el.innerHTML = slotContentHTML(actor, isHighlighted);
        return el;
    }

    _updateSlotElement(el, slot, index, hasHighlight) {
        this._stopMotion(el, 'content');
        const actor = slot.actor;
        const isHighlighted = this._state.highlightedSlot === index;
        const isDimmed = hasHighlight && !isHighlighted;

        el.dataset.slotIndex = index;
        el.style.zIndex = slot.zIndex != null ? slot.zIndex : '';

        if (!actor) {
            // Actor was removed from this slot — animate content out
            const existingWrap = el.querySelector('.stage-actor-img-wrap');
            if (existingWrap) {
                this._animateContentExit(el);
            } else {
                el.classList.add('stage-slot-empty');
                el.classList.remove('highlighted', 'dimmed');
            }
            return;
        }

        el.classList.remove('stage-slot-empty');
        el.classList.toggle('highlighted', isHighlighted);
        el.classList.toggle('dimmed', isDimmed);

        const scale = clampNumber(actor.scale, 0.1, 5, 1.0);
        const offsetX = clampNumber(actor.offsetX, -500, 500, 0);
        const offsetY = clampNumber(actor.offsetY, -500, 500, 0);

        const imgWrap = el.querySelector('.stage-actor-img-wrap');
        const img = el.querySelector('.stage-actor-img');
        const nameEl = el.querySelector('.stage-actor-name');

        if (imgWrap && img) {
            const actorChanged = img.getAttribute('src') !== actorImage(actor);
            if (actorChanged) {
                this._crossfadeContent(el, actor, index, hasHighlight);
            } else {
                imgWrap.style.transform = `scale(${scale}) translate(${offsetX}%, ${offsetY}%)`;
                if (img.alt !== actor.name) img.alt = actor.name;
                if (nameEl) {
                    if (nameEl.textContent !== actor.name) nameEl.textContent = actor.name;
                    nameEl.classList.toggle('highlighted', isHighlighted);
                }
            }
        } else {
            // Actor was assigned to a previously empty slot — build content + enter anim
            el.classList.remove('stage-slot-empty');
            el.innerHTML = slotContentHTML(actor, isHighlighted);
            this._enterContent(el);
        }
    }

    /**
     * Crossfade from one character to another within the same slot.
     * Fades old character out, then fades new character in.
     */
    _crossfadeContent(el, actor, index, hasHighlight) {
        const highlighted = this._state.highlightedSlot === index;
        const outgoing = el.querySelector('.stage-actor-img-wrap');
        this._motion(el, 'content', done => {
            const timeline = createTimeline({ autoplay: false });
            timeline.add([...el.children], {
                opacity: [1, 0], duration: motionDuration(160, el), ease: 'inQuad'
            });
            timeline.call(() => {
                if (outgoing) this._postfx?.unregister(outgoing);
                el.innerHTML = slotContentHTML(actor, highlighted);
                this._syncPostFX();
                // Finish the old channel before attaching the new nodes.
                done();
                this._enterContent(el);
            });
            return timeline;
        });
    }

    _animateContentExit(el) {
        el.classList.remove('highlighted', 'dimmed');
        this._motion(el, 'content', done => animate(el.children, {
            autoplay: false,
            opacity: [1, 0], duration: motionDuration(240, el), ease: 'inQuad',
            onComplete: () => {
                done();
                const wrap = el.querySelector('.stage-actor-img-wrap');
                if (wrap) this._postfx?.unregister(wrap);
                el.replaceChildren();
                el.classList.add('stage-slot-empty');
            }
        }));
    }

    _animateSlotExit(el) {
        const visible = el.getBoundingClientRect();
        this._stopMotion(el, 'content');
        this._stopMotion(el, 'layout');
        const resting = el.getBoundingClientRect();
        const dx = visible.left - resting.left, dy = visible.top - resting.top;
        this._exitingElements.add(el);
        this._motion(el, 'exit', done => animate(el, {
            autoplay: false,
            opacity: [Number(getComputedStyle(el).opacity), 0], x: [dx, dx], y: [dy, dy + 18], duration: motionDuration(280, el), ease: 'inCubic',
            onComplete: () => {
                const remaining = new Map([...this._charactersEl.children]
                    .filter(child => !this._exitingElements.has(child))
                    .map(child => [child.dataset.slotId, child]));
                const rects = new Map([...remaining].map(([id, child]) => [id, child.getBoundingClientRect()]));
                done();
                const wrap = el.querySelector('.stage-actor-img-wrap');
                if (wrap) this._postfx?.unregister(wrap);
                el.remove();
                this._exitingElements.delete(el);
                this._flipAnimate(remaining, rects);
            }
        }));
    }

    close() {
        for (const channels of this._motions.values()) for (const animation of channels.values()) animation.revert();
        this._motions.clear();
        this._exitingElements.clear();
        // Releases the WebGL context and its textures. Without this a module
        // reload leaks one context per cycle until the browser starts evicting.
        this._postfx?.destroy();
        this._postfx = null;
        if (this._element) {
            this._element.remove();
            this._element = null;
            this._charactersEl = null;
        }
    }
}
