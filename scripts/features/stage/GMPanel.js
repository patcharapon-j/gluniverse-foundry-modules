import { MODULE_ID, getSetting, setSetting } from './settings.js';
import { StageManager } from './StageManager.js';

const i18n = (key) => game.i18n.localize(`GLSTAGE.${key}`);
const DEFAULT_ACTOR_IMAGE = 'icons/svg/mystery-man.svg';

const HTML_ESCAPE = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPE[ch]);
}

function escapeAttr(value) {
    return escapeHTML(value);
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function actorDisplayImage(actor) {
    return actor?.image || DEFAULT_ACTOR_IMAGE;
}

function foundryActorImage(actor) {
    return actor?.prototypeToken?.texture?.src || actor?.img || DEFAULT_ACTOR_IMAGE;
}

function tokenDisplayImage(tokenDocument) {
    return tokenDocument?.texture?.src || foundryActorImage(tokenDocument?.actor);
}

/**
 * GM-only control panel for managing actors and the visual novel stage.
 */
export class GMPanel extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: 'gluniverse-stage-panel',
        classes: ['gluniverse-stage-panel'],
        tag: 'div',
        window: {
            title: 'GLSTAGE.panel.title',
            icon: 'fas fa-theater-masks',
            resizable: true,
            minimizable: true
        },
        position: {
            width: 520,
            height: 600
        }
    };

    constructor(options = {}) {
        super(options);
        this._tab = 'actors'; // 'actors' | 'stage' | 'measure' | 'guide'
        this._onManagerChange = () => this.render({ force: false });
        StageManager.getInstance().subscribe(this._onManagerChange);
    }

    async close(options = {}) {
        StageManager.getInstance().unsubscribe(this._onManagerChange);
        return super.close(options);
    }

    async _prepareContext(options) {
        const mgr = StageManager.getInstance();
        return {
            tab: this._tab,
            actors: mgr.getActors(),
            stageState: mgr.getFullState(),
            commsState: mgr.getFullCommsState(),
            isGM: game.user.isGM,
            foundryActors: [...(game.actors?.contents ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
            animations: ['none', 'bounce', 'shake', 'flip', 'nod', 'jiggle', 'fadeIn', 'slideIn']
        };
    }

    async _renderHTML(context, options) {
        const el = document.createElement('div');
        el.classList.add('glstage-panel-inner');
        el.innerHTML = this._buildTabs(context) + this._buildTabContent(context);
        return el;
    }

    _replaceHTML(result, content, options) {
        // A value change anywhere in the panel re-renders the whole window via
        // the StageManager subscription. Replacing the DOM wholesale resets
        // scroll position and drops input focus, which jumps the user back to
        // the top mid-edit. Capture and restore that UI state around the swap.
        const restore = this._captureUIState(content);
        content.replaceChildren(result);
        restore();
    }

    // Selectors for the scrollable regions in the panel that should keep their
    // position across re-renders.
    static SCROLL_SELECTORS = ['.glstage-tab-content', '.glstage-slot-list', '.glstage-measure-settings'];

    _cardSelector(card) {
        const base = card.classList[0] ? `.${card.classList[0]}` : '';
        if (card.dataset.slotIndex != null) return `${base}[data-slot-index="${card.dataset.slotIndex}"]`;
        if (card.dataset.callIndex != null) return `${base}[data-call-index="${card.dataset.callIndex}"]`;
        if (card.dataset.actorId) return `${base}[data-actor-id="${card.dataset.actorId}"]`;
        return null;
    }

    /**
     * Snapshot scroll offsets and the focused field, returning a function that
     * reapplies them to the freshly rendered DOM inside `content`.
     */
    _captureUIState(content) {
        const scrolls = [];
        for (const sel of GMPanel.SCROLL_SELECTORS) {
            const node = content.querySelector(sel);
            if (node) scrolls.push({ sel, top: node.scrollTop, left: node.scrollLeft });
        }

        let focusInfo = null;
        const active = content.contains(document.activeElement) ? document.activeElement : null;
        if (active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) {
            const fieldKey = active.dataset.field ? `[data-field="${active.dataset.field}"]`
                : active.dataset.action ? `[data-action="${active.dataset.action}"]` : null;
            if (fieldKey) {
                const card = active.closest('[data-actor-id],[data-slot-index],[data-call-index]');
                let selectionStart = null;
                let selectionEnd = null;
                // selectionStart is only readable on text-like inputs.
                try { selectionStart = active.selectionStart; selectionEnd = active.selectionEnd; } catch (_) {}
                focusInfo = {
                    cardSelector: card ? this._cardSelector(card) : null,
                    fieldKey,
                    selectionStart,
                    selectionEnd
                };
            }
        }

        return () => {
            for (const { sel, top, left } of scrolls) {
                const node = content.querySelector(sel);
                if (node) { node.scrollTop = top; node.scrollLeft = left; }
            }
            if (focusInfo) {
                const scope = focusInfo.cardSelector ? content.querySelector(focusInfo.cardSelector) : content;
                const field = scope?.querySelector(focusInfo.fieldKey);
                if (field) {
                    field.focus();
                    if (focusInfo.selectionStart != null) {
                        try { field.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd); } catch (_) {}
                    }
                }
            }
        };
    }

    _onRender(context, options) {
        const el = this.element;
        if (!el) return;

        // Tab clicks
        el.querySelectorAll('.glstage-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this._tab = e.currentTarget.dataset.tab;
                this.render({ force: false });
            });
        });

        // Actor tab listeners
        this._bindActorListeners(el);
        // Stage tab listeners
        this._bindStageListeners(el);
        // Comms tab listeners
        this._bindCommsListeners(el);
        // Drag-and-drop reordering on stage tab
        this._bindDragListeners(el);
        // Stage height/width/offset sliders
        this._bindHeightSlider(el);
        // Measure tab listeners
        this._bindMeasureListeners(el);
    }

    // ─── HTML Builders ───

    _buildTabs(ctx) {
        const tabs = [
            { id: 'actors', label: i18n('panel.actors'), icon: 'fas fa-users' },
            { id: 'stage', label: i18n('panel.stage'), icon: 'fas fa-tv' },
            { id: 'comms', label: i18n('panel.comms'), icon: 'fas fa-satellite-dish' },
            { id: 'measure', label: i18n('panel.measure'), icon: 'fas fa-ruler-vertical' },
            { id: 'guide', label: i18n('panel.guide'), icon: 'fas fa-question-circle' }
        ];
        return `<div class="glstage-tabs">${tabs.map(t =>
            `<button class="glstage-tab-btn ${this._tab === t.id ? 'active' : ''}" data-tab="${t.id}">
                <i class="${t.icon}"></i> ${t.label}
            </button>`
        ).join('')}</div>`;
    }

    _buildTabContent(ctx) {
        switch (this._tab) {
            case 'actors': return this._buildActorsTab(ctx);
            case 'stage': return this._buildStageTab(ctx);
            case 'comms': return this._buildCommsTab(ctx);
            case 'measure': return this._buildMeasureTab(ctx);
            case 'guide': return this._buildGuideTab(ctx);
            default: return '';
        }
    }

    _buildActorsTab(ctx) {
        let html = `<div class="glstage-tab-content glstage-actors-tab">`;
        html += `<div class="glstage-toolbar">
            <button class="glstage-btn glstage-btn-add" data-action="add-actor">
                <i class="fas fa-plus"></i> ${i18n('panel.addActor')}
            </button>
            <button class="glstage-btn" data-action="import-selected-token">
                <i class="fas fa-user-plus"></i> ${i18n('panel.importSelectedToken')}
            </button>
            <select class="glstage-import-actor-select" data-action="foundry-actor-select">
                <option value="">${i18n('panel.selectFoundryActor')}</option>
                ${(ctx.foundryActors || []).map(actor =>
                    `<option value="${escapeAttr(actor.id)}">${escapeHTML(actor.name)}</option>`
                ).join('')}
            </select>
            <button class="glstage-btn" data-action="import-foundry-actor">
                <i class="fas fa-file-import"></i> ${i18n('panel.importFoundryActor')}
            </button>
        </div>`;

        if (ctx.actors.length === 0) {
            html += `<div class="glstage-empty">${i18n('panel.noActorsConfigured')}</div>`;
        } else {
            html += `<div class="glstage-actor-list">`;
            for (const actor of ctx.actors) {
                html += this._buildActorCard(actor);
            }
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    _buildActorCard(actor) {
        const actorId = escapeAttr(actor.id);
        const actorName = escapeAttr(actor.name || '');
        const actorImage = escapeAttr(actorDisplayImage(actor));
        const scale = finiteNumber(actor.scale, 1.0);
        const offsetX = finiteNumber(actor.offsetX, 0);
        const offsetY = finiteNumber(actor.offsetY, 0);

        return `
        <div class="glstage-actor-card" data-actor-id="${actorId}">
            <div class="glstage-actor-preview">
                <img src="${actorImage}" alt="${actorName}"/>
                <button class="glstage-actor-callin glstage-btn-icon" data-action="call-in" title="${i18n('panel.callIn')}">
                    <i class="fas fa-satellite-dish"></i>
                </button>
                <button class="glstage-actor-remove glstage-btn-icon glstage-btn-danger" data-action="remove-actor" title="${i18n('panel.removeActor')}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="glstage-actor-fields">
                <div class="glstage-field">
                    <input type="text" data-field="name" value="${actorName}" placeholder="${i18n('panel.name')}" />
                </div>
                <div class="glstage-field glstage-field-row">
                    <input type="text" data-field="image" value="${escapeAttr(actor.image || '')}" placeholder="${i18n('panel.image')}" />
                    <button class="glstage-btn-icon" data-action="browse-image" title="${i18n('panel.browse')}">
                        <i class="fas fa-folder-open"></i>
                    </button>
                </div>
                <div class="glstage-field-group">
                    <div class="glstage-field">
                        <label>${i18n('panel.scale')}</label>
                        <input type="number" data-field="scale" value="${scale}" step="0.05" min="0.1" max="5" />
                    </div>
                    <div class="glstage-field">
                        <label>X</label>
                        <input type="number" data-field="offsetX" value="${offsetX}" step="1" />
                    </div>
                    <div class="glstage-field">
                        <label>Y</label>
                        <input type="number" data-field="offsetY" value="${offsetY}" step="1" />
                    </div>
                </div>
            </div>
        </div>`;
    }

    _buildStageTab(ctx) {
        const state = ctx.stageState;
        const actors = ctx.actors;
        const isVisible = state.visible;

        let html = `<div class="glstage-tab-content glstage-stage-tab">`;
        const currentHeight = finiteNumber(state.stageHeight || getSetting('stageHeight'), 40);
        const currentWidth = finiteNumber(state.stageWidth || getSetting('stageWidth'), 100);
        const currentXOffset = finiteNumber(state.stageXOffset ?? getSetting('stageXOffset'), 0);
        const currentYOffset = finiteNumber(state.stageYOffset ?? getSetting('stageYOffset'), 0);
        html += `<div class="glstage-toolbar">
            <button class="glstage-btn ${isVisible ? 'glstage-btn-active' : ''}" data-action="toggle-visibility">
                <i class="fas fa-${isVisible ? 'eye' : 'eye-slash'}"></i>
                ${isVisible ? i18n('panel.hideStage') : i18n('panel.showStage')}
            </button>
            <button class="glstage-btn" data-action="add-slot">
                <i class="fas fa-plus"></i> ${i18n('panel.addSlot')}
            </button>
            <button class="glstage-btn glstage-btn-danger" data-action="clear-stage">
                <i class="fas fa-broom"></i> ${i18n('panel.clearStage')}
            </button>
        </div>
        <div class="glstage-toolbar glstage-toolbar-sliders">
            <div class="glstage-height-control">
                <label>${i18n('panel.stageHeight')}</label>
                <input type="range" min="20" max="100" step="5" value="${currentHeight}" data-action="stage-height"/>
                <span class="glstage-height-value">${currentHeight}%</span>
            </div>
            <div class="glstage-height-control">
                <label>${i18n('panel.stageWidth')}</label>
                <input type="range" min="30" max="100" step="5" value="${currentWidth}" data-action="stage-width"/>
                <span class="glstage-width-value">${currentWidth}%</span>
            </div>
            <div class="glstage-height-control">
                <label>${i18n('panel.stageXOffset')}</label>
                <input type="range" min="-50" max="50" step="1" value="${currentXOffset}" data-action="stage-x-offset"/>
                <span class="glstage-xoffset-value">${currentXOffset}vw</span>
            </div>
            <div class="glstage-height-control">
                <label>${i18n('panel.stageYOffset')}</label>
                <input type="range" min="0" max="50" step="1" value="${currentYOffset}" data-action="stage-y-offset"/>
                <span class="glstage-yoffset-value">${currentYOffset}%</span>
            </div>
        </div>`;

        const slots = state.slots || [];
        if (slots.length === 0) {
            html += `<div class="glstage-empty">${i18n('panel.noSlotsConfigured')}</div>`;
        } else {
            html += `<div class="glstage-slot-list">`;
            for (let i = 0; i < slots.length; i++) {
                html += this._buildSlotCard(i, slots[i], actors, state.highlightedSlot);
            }
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    _buildSlotCard(index, slot, actors, highlightedSlot) {
        const isHighlighted = highlightedSlot === index;
        const actorId = slot.actorId || '';
        const actor = slot.actor;

        // Build actor <option> list
        let actorOptions = `<option value="">${i18n('panel.emptySlot')}</option>`;
        for (const a of actors) {
            actorOptions += `<option value="${escapeAttr(a.id)}" ${a.id === actorId ? 'selected' : ''}>${escapeHTML(a.name)}</option>`;
        }

        // Animation select
        const anims = ['none', 'bounce', 'shake', 'flip', 'nod', 'jiggle', 'fadeIn', 'slideIn'];
        let animOptions = anims.map(a =>
            `<option value="${a}">${i18n(`animations.${a}`)}</option>`
        ).join('');

        const zIndex = finiteNumber(slot.zIndex, 0);
        const actorImage = actor ? escapeAttr(actorDisplayImage(actor)) : '';
        const actorName = actor ? escapeAttr(actor.name || '') : '';

        return `
        <div class="glstage-slot-card ${isHighlighted ? 'highlighted' : ''}" data-slot-index="${index}" draggable="true">
            <div class="glstage-slot-preview">
                ${actor
                    ? `<img class="glstage-slot-thumb" src="${actorImage}" alt="${actorName}"/>`
                    : `<div class="glstage-slot-empty-preview"><i class="fas fa-user-plus"></i></div>`}
                <span class="glstage-slot-number">#${index + 1}</span>
            </div>
            <select class="glstage-slot-actor-select" data-action="assign-actor">${actorOptions}</select>
            <div class="glstage-slot-actions">
                <button class="glstage-btn-sm ${isHighlighted ? 'glstage-btn-active' : ''}"
                        data-action="toggle-highlight"
                        title="${isHighlighted ? i18n('panel.unhighlight') : i18n('panel.highlight')}">
                    <i class="fas fa-star"></i>
                </button>
                <select class="glstage-anim-select" data-action="select-animation">${animOptions}</select>
                <button class="glstage-btn-sm" data-action="play-animation" title="${i18n('panel.triggerAnimation')}">
                    <i class="fas fa-play"></i>
                </button>
                <span class="glstage-slot-zindex" title="${i18n('panel.zIndex')}">
                    <i class="fas fa-layer-group"></i>
                    <input type="number" data-action="set-zindex" value="${zIndex}" step="1" min="-10" max="10"/>
                </span>
                <button class="glstage-btn-sm glstage-btn-danger" data-action="remove-slot" title="${i18n('panel.removeSlot')}">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>`;
    }

    _buildCommsTab(ctx) {
        const comms = ctx.commsState;
        const actors = ctx.actors;
        const isVisible = comms.visible;
        const calls = comms.calls || [];

        let html = `<div class="glstage-tab-content glstage-comms-tab">`;

        html += `<div class="glstage-toolbar">
            <button class="glstage-btn ${isVisible ? 'glstage-btn-active' : ''}" data-action="toggle-comms">
                <i class="fas fa-${isVisible ? 'eye' : 'eye-slash'}"></i>
                ${isVisible ? i18n('panel.hideComms') : i18n('panel.showComms')}
            </button>
            <button class="glstage-btn glstage-btn-danger" data-action="clear-comms">
                <i class="fas fa-phone-slash"></i> ${i18n('panel.clearComms')}
            </button>
        </div>`;

        // Add-call row
        html += `<div class="glstage-toolbar">
            <select class="glstage-import-actor-select" data-action="call-actor-select">
                <option value="">${i18n('panel.selectActorToCall')}</option>
                ${actors.map(a => `<option value="${escapeAttr(a.id)}">${escapeHTML(a.name)}</option>`).join('')}
            </select>
            <button class="glstage-btn" data-action="add-call">
                <i class="fas fa-satellite-dish"></i> ${i18n('panel.callIn')}
            </button>
        </div>`;

        if (calls.length === 0) {
            html += `<div class="glstage-empty">${i18n('panel.noCalls')}</div>`;
        } else {
            html += `<div class="glcomms-call-list">`;
            for (let i = 0; i < calls.length; i++) {
                html += this._buildCallCard(i, calls[i], comms.speakingCall, calls.length);
            }
            html += `</div>`;
        }

        html += `</div>`;
        return html;
    }

    _buildCallCard(index, call, speakingCallId, total) {
        const actor = call.actor;
        const speaking = call.callId === speakingCallId;
        const name = actor ? escapeHTML(actor.name || '') : i18n('panel.unknownActor');
        const image = escapeAttr(actor ? actorDisplayImage(actor) : DEFAULT_ACTOR_IMAGE);
        const actorId = escapeAttr(call.actorId || '');
        const cScale = finiteNumber(actor?.commsScale, 1.0);
        const cX = finiteNumber(actor?.commsOffsetX, 0);
        const cY = finiteNumber(actor?.commsOffsetY, 0);
        const cTheme = actor?.commsTheme || '';
        const cTint = actor?.commsTint || '';
        const themeOpts = [
            ['', i18n('panel.themeDefault')],
            ['scifi', i18n('settings.commsTheme.scifi')],
            ['ethereal', i18n('settings.commsTheme.ethereal')],
            ['minimal', i18n('settings.commsTheme.minimal')]
        ].map(([v, label]) => `<option value="${v}" ${v === cTheme ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('');

        return `
        <div class="glcomms-call-card ${speaking ? 'speaking' : ''}" data-call-index="${index}" data-call-id="${escapeAttr(call.callId)}" data-actor-id="${actorId}">
            <div class="glcomms-call-main">
                <img class="glcomms-call-thumb" src="${image}" alt="${escapeAttr(actor?.name || '')}"/>
                <span class="glcomms-call-name">${name}</span>
                <div class="glcomms-call-actions">
                    <button class="glstage-btn-sm ${speaking ? 'glstage-btn-active' : ''}" data-action="set-speaker" title="${i18n('panel.setSpeaker')}">
                        <i class="fas fa-volume-high"></i>
                    </button>
                    <button class="glstage-btn-sm" data-action="call-up" title="${i18n('panel.moveUp')}" ${index === 0 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-up"></i>
                    </button>
                    <button class="glstage-btn-sm" data-action="call-down" title="${i18n('panel.moveDown')}" ${index === total - 1 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-down"></i>
                    </button>
                    <button class="glstage-btn-sm glstage-btn-danger" data-action="hang-up" title="${i18n('panel.hangUp')}">
                        <i class="fas fa-phone-slash"></i>
                    </button>
                </div>
            </div>
            <div class="glcomms-call-framing" title="${i18n('panel.commsFraming')}">
                <i class="fas fa-crop-simple glcomms-call-framing-icon"></i>
                <div class="glstage-field">
                    <label>${i18n('panel.scale')}</label>
                    <input type="number" data-field="commsScale" value="${cScale}" step="0.05" min="0.1" max="10" />
                </div>
                <div class="glstage-field">
                    <label>X</label>
                    <input type="number" data-field="commsOffsetX" value="${cX}" step="1" />
                </div>
                <div class="glstage-field">
                    <label>Y</label>
                    <input type="number" data-field="commsOffsetY" value="${cY}" step="1" />
                </div>
                <button class="glstage-btn-sm" data-action="reset-framing" title="${i18n('panel.resetFraming')}">
                    <i class="fas fa-rotate-left"></i>
                </button>
            </div>
            <div class="glcomms-call-presentation">
                <i class="fas fa-palette glcomms-call-framing-icon" title="${i18n('panel.presentation')}"></i>
                <select class="glcomms-call-theme" data-field="commsTheme" title="${i18n('panel.commsThemeOverride')}">
                    ${themeOpts}
                </select>
                <label class="glcomms-tint-toggle" title="${i18n('panel.commsTintOverride')}">
                    <input type="checkbox" data-action="tint-enabled" ${cTint ? 'checked' : ''}/>
                    <i class="fas fa-droplet"></i>
                </label>
                <input type="color" class="glcomms-tint-color" data-field="commsTint" value="${escapeAttr(cTint || '#c1121f')}" ${cTint ? '' : 'disabled'}/>
            </div>
        </div>`;
    }

    _buildMeasureTab(ctx) {
        const actors = ctx.actors;
        const stageYOffset = finiteNumber(ctx.stageState.stageYOffset ?? getSetting('stageYOffset'), 0);

        let html = `<div class="glstage-tab-content glstage-measure-tab">`;
        html += `<div class="glstage-measure-info">${i18n('panel.measureInfo')}</div>`;

        if (actors.length === 0) {
            html += `<div class="glstage-empty">${i18n('panel.noActorsToMeasure')}</div>`;
        } else {
            // Preview area — scales with window
            const cropPct = Math.max(0, Math.min(50, stageYOffset));
            html += `<div class="glstage-measure-preview">
                <div class="glstage-measure-floor-line">
                    <span class="glstage-measure-floor-label">${i18n('panel.floorLine')}</span>
                </div>
                <div class="glstage-measure-screen-line" style="bottom: ${cropPct}%;">
                    <span class="glstage-measure-screen-label">${i18n('panel.screenLine')}</span>
                </div>
                <div class="glstage-measure-crop-zone" style="height: ${cropPct}%;"></div>
                <div class="glstage-measure-characters">`;

            for (const actor of actors) {
                if (actor.measureHidden) continue;
                const scale = finiteNumber(actor.scale, 1.0);
                const offsetX = finiteNumber(actor.offsetX, 0);
                const offsetY = finiteNumber(actor.offsetY, 0);
                const actorId = escapeAttr(actor.id);
                const actorName = escapeAttr(actor.name || '');
                const actorImage = escapeAttr(actorDisplayImage(actor));
                html += `
                <div class="glstage-measure-actor" data-actor-id="${actorId}">
                    <div class="glstage-measure-img-wrap" style="transform: scale(${scale}) translate(${offsetX}%, ${offsetY}%);">
                        <img src="${actorImage}" alt="${actorName}" draggable="false"/>
                    </div>
                    <div class="glstage-measure-name">${escapeHTML(actor.name)}</div>
                </div>`;
            }

            html += `</div></div>`;

            // Bottom half: scrollable settings
            html += `<div class="glstage-measure-settings">`;

            // Screen line / crop slider
            html += `<div class="glstage-measure-slider-row">
                <div class="glstage-height-control">
                    <label>${i18n('panel.screenLine')}</label>
                    <input type="range" min="0" max="50" step="1" value="${cropPct}" data-action="measure-screen-line"/>
                    <span class="glstage-measure-screenline-value">${cropPct}%</span>
                </div>
            </div>`;

            // Per-actor controls below the preview
            html += `<div class="glstage-measure-controls">`;
            for (const actor of actors) {
                const isHidden = actor.measureHidden === true;
                const actorId = escapeAttr(actor.id);
                const actorName = escapeAttr(actor.name || '');
                const actorImage = escapeAttr(actorDisplayImage(actor));
                const scale = finiteNumber(actor.scale, 1.0);
                const offsetX = finiteNumber(actor.offsetX, 0);
                const offsetY = finiteNumber(actor.offsetY, 0);
                html += `
                <div class="glstage-measure-control-row ${isHidden ? 'is-hidden' : ''}" data-actor-id="${actorId}">
                    <img class="glstage-measure-control-thumb" src="${actorImage}" alt="${actorName}"/>
                    <span class="glstage-measure-control-name">${escapeHTML(actor.name)}</span>
                    <button class="glstage-btn-sm ${isHidden ? 'glstage-btn-active' : ''}" data-action="toggle-measure-hidden" title="${isHidden ? i18n('panel.showInMeasure') : i18n('panel.hideInMeasure')}">
                        <i class="fas fa-${isHidden ? 'eye-slash' : 'eye'}"></i>
                    </button>
                    <div class="glstage-measure-control-field">
                        <label>${i18n('panel.scale')}</label>
                        <input type="number" data-field="scale" value="${scale}" step="0.05" min="0.1" max="5" />
                    </div>
                    <div class="glstage-measure-control-field">
                        <label>${i18n('panel.offsetX')}</label>
                        <input type="number" data-field="offsetX" value="${offsetX}" step="1" />
                    </div>
                    <div class="glstage-measure-control-field">
                        <label>${i18n('panel.offsetY')}</label>
                        <input type="number" data-field="offsetY" value="${offsetY}" step="1" />
                    </div>
                </div>`;
            }
            html += `</div>`;

            html += `</div>`; // end .glstage-measure-settings
        }

        html += `</div>`;
        return html;
    }

    _buildGuideTab(ctx) {
        return `
        <div class="glstage-tab-content glstage-guide-tab">
            <h2>${i18n('guide.title')}</h2>
            <p>${i18n('guide.intro')}</p>
            <h3>${i18n('guide.step1title')}</h3>
            <p>${i18n('guide.step1')}</p>
            <h3>${i18n('guide.step2title')}</h3>
            <p>${i18n('guide.step2')}</p>
            <h3>${i18n('guide.step3title')}</h3>
            <p>${i18n('guide.step3')}</p>
            <h3>${i18n('guide.step4title')}</h3>
            <p>${i18n('guide.step4')}</p>
            <div class="glstage-guide-tip">${i18n('guide.tip')}</div>
        </div>`;
    }

    // ─── Event Binding ───

    _bindActorListeners(el) {
        const mgr = StageManager.getInstance();

        // Add actor
        el.querySelector('[data-action="add-actor"]')?.addEventListener('click', async () => {
            await mgr.addActor({ name: i18n('panel.newActor'), image: DEFAULT_ACTOR_IMAGE });
        });

        // Import selected canvas tokens
        el.querySelector('[data-action="import-selected-token"]')?.addEventListener('click', async () => {
            await this._importSelectedTokens();
        });

        // Import from Foundry Actor directory
        el.querySelector('[data-action="import-foundry-actor"]')?.addEventListener('click', async () => {
            const select = el.querySelector('[data-action="foundry-actor-select"]');
            await this._importFoundryActor(select?.value);
        });

        // Actor field changes
        el.querySelectorAll('.glstage-actor-card').forEach(card => {
            const actorId = card.dataset.actorId;

            card.querySelectorAll('input[data-field]').forEach(input => {
                input.addEventListener('change', async () => {
                    let value = input.value;
                    if (input.type === 'number') value = parseFloat(value) || 0;
                    await mgr.updateActor(actorId, { [input.dataset.field]: value });
                });
            });

            // Browse image
            card.querySelector('[data-action="browse-image"]')?.addEventListener('click', async () => {
                const fp = new foundry.applications.apps.FilePicker.implementation({
                    type: 'image',
                    current: card.querySelector('[data-field="image"]')?.value || '',
                    callback: async (path) => {
                        await mgr.updateActor(actorId, { image: path });
                    }
                });
                fp.render(true);
            });

            // Call in (ring this actor into the comms overlay)
            card.querySelector('[data-action="call-in"]')?.addEventListener('click', async () => {
                await mgr.addCall(actorId);
                this._tab = 'comms';
                this.render({ force: false });
            });

            // Remove actor
            card.querySelector('[data-action="remove-actor"]')?.addEventListener('click', async () => {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: i18n('panel.removeActor') },
                    content: `<p>Remove this actor? It will also be removed from the stage.</p>`
                });
                if (confirmed) await mgr.removeActor(actorId);
            });
        });
    }

    async _importSelectedTokens() {
        const tokens = canvas?.tokens?.controlled ?? [];
        if (!tokens.length) {
            ui.notifications.warn(i18n('panel.noSelectedToken'));
            return;
        }

        const mgr = StageManager.getInstance();
        for (const token of tokens) {
            const document = token.document;
            await mgr.addActor({
                name: document?.name || document?.actor?.name || i18n('panel.newActor'),
                image: tokenDisplayImage(document)
            });
        }

        ui.notifications.info(tokens.length === 1
            ? i18n('panel.actorImported')
            : game.i18n.format('GLSTAGE.panel.actorsImported', { count: tokens.length }));
    }

    async _importFoundryActor(actorId) {
        if (!actorId) {
            ui.notifications.warn(i18n('panel.noFoundryActorSelected'));
            return;
        }

        const actor = game.actors?.get(actorId);
        if (!actor) {
            ui.notifications.warn(i18n('panel.noFoundryActorSelected'));
            return;
        }

        await StageManager.getInstance().addActor({
            name: actor.name || i18n('panel.newActor'),
            image: foundryActorImage(actor)
        });
        ui.notifications.info(i18n('panel.actorImported'));
    }

    _bindStageListeners(el) {
        const mgr = StageManager.getInstance();

        // Toggle stage visibility
        el.querySelector('[data-action="toggle-visibility"]')?.addEventListener('click', async () => {
            const state = mgr.getStageState();
            await mgr.setStageVisible(!state.visible);
        });

        // Add slot
        el.querySelector('[data-action="add-slot"]')?.addEventListener('click', async () => {
            await mgr.addSlot();
        });

        // Clear stage
        el.querySelector('[data-action="clear-stage"]')?.addEventListener('click', async () => {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: i18n('panel.clearStage') },
                content: `<p>Remove all slots from the stage?</p>`
            });
            if (confirmed) await mgr.clearStage();
        });

        // Slot-level controls
        el.querySelectorAll('.glstage-slot-card').forEach(card => {
            const slotIndex = parseInt(card.dataset.slotIndex);

            // Assign actor to slot
            card.querySelector('[data-action="assign-actor"]')?.addEventListener('change', async (e) => {
                const actorId = e.target.value || null;
                await mgr.assignActorToSlot(slotIndex, actorId);
            });

            // Toggle highlight
            card.querySelector('[data-action="toggle-highlight"]')?.addEventListener('click', async () => {
                const state = mgr.getStageState();
                const newHighlight = state.highlightedSlot === slotIndex ? -1 : slotIndex;
                await mgr.setHighlight(newHighlight);
            });

            // Play animation
            card.querySelector('[data-action="play-animation"]')?.addEventListener('click', () => {
                const animSelect = card.querySelector('[data-action="select-animation"]');
                const animation = animSelect?.value || 'none';
                if (animation !== 'none') {
                    mgr.triggerAnimation(slotIndex, animation);
                }
            });

            // Remove slot
            card.querySelector('[data-action="remove-slot"]')?.addEventListener('click', async () => {
                await mgr.removeSlot(slotIndex);
            });

            // Z-index
            card.querySelector('[data-action="set-zindex"]')?.addEventListener('change', async (e) => {
                const val = parseInt(e.target.value) || 0;
                await mgr.updateSlot(slotIndex, { zIndex: val });
            });
        });
    }

    _bindCommsListeners(el) {
        const mgr = StageManager.getInstance();

        // Toggle comms overlay visibility
        el.querySelector('[data-action="toggle-comms"]')?.addEventListener('click', async () => {
            const state = mgr.getCommsState();
            await mgr.setCommsVisible(!state.visible);
        });

        // Clear all calls
        el.querySelector('[data-action="clear-comms"]')?.addEventListener('click', async () => {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: i18n('panel.clearComms') },
                content: `<p>${i18n('panel.clearCommsConfirm')}</p>`
            });
            if (confirmed) await mgr.clearComms();
        });

        // Add a call from the dropdown
        el.querySelector('[data-action="add-call"]')?.addEventListener('click', async () => {
            const select = el.querySelector('[data-action="call-actor-select"]');
            const actorId = select?.value;
            if (!actorId) {
                ui.notifications.warn(i18n('panel.selectActorToCall'));
                return;
            }
            await mgr.addCall(actorId);
        });

        // Per-call controls
        el.querySelectorAll('.glcomms-call-card').forEach(card => {
            const index = parseInt(card.dataset.callIndex);
            const callId = card.dataset.callId;
            const actorId = card.dataset.actorId;

            card.querySelector('[data-action="set-speaker"]')?.addEventListener('click', async () => {
                await mgr.setSpeaker(callId);
            });
            card.querySelector('[data-action="hang-up"]')?.addEventListener('click', async () => {
                await mgr.hangUp(callId);
            });
            card.querySelector('[data-action="call-up"]')?.addEventListener('click', async () => {
                await mgr.reorderCalls(index, index - 1);
            });
            card.querySelector('[data-action="call-down"]')?.addEventListener('click', async () => {
                await mgr.reorderCalls(index, index + 1);
            });

            // ── Comms framing (scale / x / y) ──
            const framingInputs = card.querySelectorAll('.glcomms-call-framing input[data-field]');
            const readFraming = () => {
                const f = {};
                framingInputs.forEach(inp => { f[inp.dataset.field] = finiteNumber(inp.value, inp.dataset.field === 'commsScale' ? 1 : 0); });
                return f;
            };
            framingInputs.forEach(input => {
                // Live local preview while dragging/typing — no socket churn.
                input.addEventListener('input', () => {
                    if (!actorId) return;
                    game.modules.get(MODULE_ID)?.commsOverlay?.previewFraming(actorId, readFraming());
                });
                // Persist + broadcast to players on commit.
                input.addEventListener('change', async () => {
                    if (!actorId) return;
                    await mgr.updateActor(actorId, { [input.dataset.field]: finiteNumber(input.value, input.dataset.field === 'commsScale' ? 1 : 0) });
                });
            });
            card.querySelector('[data-action="reset-framing"]')?.addEventListener('click', async () => {
                if (!actorId) return;
                await mgr.updateActor(actorId, { commsScale: 1, commsOffsetX: 0, commsOffsetY: 0 });
            });

            // ── Presentation: theme override + tint ──
            const themeSelect = card.querySelector('[data-field="commsTheme"]');
            const tintToggle = card.querySelector('[data-action="tint-enabled"]');
            const tintColor = card.querySelector('[data-field="commsTint"]');
            const overlay = () => game.modules.get(MODULE_ID)?.commsOverlay;
            const currentPresentation = () => ({
                commsTheme: themeSelect?.value || '',
                commsTint: (tintToggle?.checked && tintColor) ? tintColor.value : ''
            });

            themeSelect?.addEventListener('change', async () => {
                if (!actorId) return;
                overlay()?.previewPresentation(actorId, currentPresentation());
                await mgr.updateActor(actorId, { commsTheme: themeSelect.value });
            });

            tintToggle?.addEventListener('change', async () => {
                if (!actorId) return;
                if (tintColor) tintColor.disabled = !tintToggle.checked;
                const tint = tintToggle.checked && tintColor ? tintColor.value : '';
                overlay()?.previewPresentation(actorId, currentPresentation());
                await mgr.updateActor(actorId, { commsTint: tint });
            });

            tintColor?.addEventListener('input', () => {
                if (!actorId || !tintToggle?.checked) return;
                overlay()?.previewPresentation(actorId, currentPresentation());
            });
            tintColor?.addEventListener('change', async () => {
                if (!actorId || !tintToggle?.checked) return;
                await mgr.updateActor(actorId, { commsTint: tintColor.value });
            });
        });
    }

    _bindDragListeners(el) {
        const cards = el.querySelectorAll('.glstage-slot-card[draggable]');
        if (!cards.length) return;

        let dragFromIndex = null;

        for (const card of cards) {
            card.addEventListener('dragstart', (e) => {
                dragFromIndex = parseInt(card.dataset.slotIndex);
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(dragFromIndex));
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                dragFromIndex = null;
                // Clean up any lingering drag-over indicators
                el.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
            });

            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                card.classList.add('drag-over');
            });

            card.addEventListener('dragleave', () => {
                card.classList.remove('drag-over');
            });

            card.addEventListener('drop', async (e) => {
                e.preventDefault();
                card.classList.remove('drag-over');
                const toIndex = parseInt(card.dataset.slotIndex);
                if (dragFromIndex !== null && dragFromIndex !== toIndex) {
                    await StageManager.getInstance().reorderSlots(dragFromIndex, toIndex);
                }
            });
        }
    }

    _bindHeightSlider(el) {
        // Height slider
        const heightSlider = el.querySelector('[data-action="stage-height"]');
        if (heightSlider) {
            const heightLabel = el.querySelector('.glstage-height-value');
            heightSlider.addEventListener('input', () => {
                if (heightLabel) heightLabel.textContent = `${heightSlider.value}%`;
                const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
                if (overlay) overlay.applyState({ stageHeight: parseInt(heightSlider.value) });
            });
            heightSlider.addEventListener('change', async () => {
                await setSetting('stageHeight', parseInt(heightSlider.value));
            });
        }

        // Width slider
        const widthSlider = el.querySelector('[data-action="stage-width"]');
        if (widthSlider) {
            const widthLabel = el.querySelector('.glstage-width-value');
            widthSlider.addEventListener('input', () => {
                if (widthLabel) widthLabel.textContent = `${widthSlider.value}%`;
                const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
                if (overlay) overlay.applyState({ stageWidth: parseInt(widthSlider.value) });
            });
            widthSlider.addEventListener('change', async () => {
                await setSetting('stageWidth', parseInt(widthSlider.value));
            });
        }

        // X Offset slider
        const xOffsetSlider = el.querySelector('[data-action="stage-x-offset"]');
        if (xOffsetSlider) {
            const xOffsetLabel = el.querySelector('.glstage-xoffset-value');
            xOffsetSlider.addEventListener('input', () => {
                if (xOffsetLabel) xOffsetLabel.textContent = `${xOffsetSlider.value}vw`;
                const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
                if (overlay) overlay.applyState({ stageXOffset: parseInt(xOffsetSlider.value) });
            });
            xOffsetSlider.addEventListener('change', async () => {
                await setSetting('stageXOffset', parseInt(xOffsetSlider.value));
            });
        }

        // Y Offset slider
        const yOffsetSlider = el.querySelector('[data-action="stage-y-offset"]');
        if (yOffsetSlider) {
            const yOffsetLabel = el.querySelector('.glstage-yoffset-value');
            yOffsetSlider.addEventListener('input', () => {
                if (yOffsetLabel) yOffsetLabel.textContent = `${yOffsetSlider.value}%`;
                const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
                if (overlay) overlay.applyState({ stageYOffset: parseInt(yOffsetSlider.value) });
            });
            yOffsetSlider.addEventListener('change', async () => {
                await setSetting('stageYOffset', parseInt(yOffsetSlider.value));
            });
        }
    }

    _bindMeasureListeners(el) {
        const mgr = StageManager.getInstance();

        // Screen line slider (controls stage crop percentage)
        const screenSlider = el.querySelector('[data-action="measure-screen-line"]');
        if (screenSlider) {
            const screenLabel = el.querySelector('.glstage-measure-screenline-value');
            const screenLine = el.querySelector('.glstage-measure-screen-line');
            const cropZone = el.querySelector('.glstage-measure-crop-zone');

            screenSlider.addEventListener('input', () => {
                const val = parseInt(screenSlider.value);
                if (screenLabel) screenLabel.textContent = `${val}%`;
                if (screenLine) screenLine.style.bottom = `${val}%`;
                if (cropZone) cropZone.style.height = `${val}%`;
                // Live preview on stage
                const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
                if (overlay) overlay.applyState({ stageYOffset: val });
            });
            screenSlider.addEventListener('change', async () => {
                await setSetting('stageYOffset', parseInt(screenSlider.value));
            });
        }

        // Per-actor controls
        el.querySelectorAll('.glstage-measure-control-row').forEach(row => {
            const actorId = row.dataset.actorId;

            row.querySelector('[data-action="toggle-measure-hidden"]')?.addEventListener('click', async () => {
                const actor = mgr.getActorById(actorId);
                await mgr.updateActor(actorId, { measureHidden: !actor?.measureHidden });
            });

            row.querySelectorAll('input[data-field]').forEach(input => {
                input.addEventListener('change', async () => {
                    let value = input.value;
                    if (input.type === 'number') value = parseFloat(value) || 0;
                    await mgr.updateActor(actorId, { [input.dataset.field]: value });
                });
            });
        });
    }
}
