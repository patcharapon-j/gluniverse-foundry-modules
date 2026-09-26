/**
 * The Stage Director's Grade tab — the GM's controls for the scene grade.
 *
 * Edits a *draft* of the grade of the scene the GM is viewing. Dragging a
 * control previews the draft on this screen only, immediately; releasing it
 * saves the draft to the scene, and every client viewing that scene eases into
 * it. Nothing here changes a value on its own: the one automatic step — the
 * background sample — runs only when the GM presses "Re-sample background" (or
 * the first time a scene is used, in StageOverlay).
 *
 * Kept out of GMPanel.js so the panel stays a list of tabs. GMPanel calls
 * `buildGradeTab` to draw and `bindGradeTab` to wire it.
 */

import { MODULE_ID, getSetting, setSetting } from './settings.js';
import { escapeHTML, escapeAttr } from '../../core/util.mjs';
import {
    SECTIONS,
    COLORS,
    MAX_LOOKS,
    LOOK_OPACITY,
    normalizeGrade,
    NEUTRAL_GRADE,
} from './postfx/grade-model.mjs';
import {
    readSceneGrade,
    writeSceneGrade,
    readWorldDefaults,
    writeWorldDefaults,
    hasSceneGrade,
    importCubeLook,
    removeCustomLook,
} from './postfx/grade-store.mjs';

const i18n = (key) => game.i18n.localize(`GLSTAGE.grade.${key}`);
const fmt = (key, data) => game.i18n.format(`GLSTAGE.grade.${key}`, data);

/**
 * The tab's sections, in stack order, and the controls in each. `key` is the
 * dial or colour inside the grade section; the label key is
 * `GLSTAGE.grade.<section>.<key>` — built at runtime, so every entry here must
 * have one (the check tool walks this list).
 */
export const GRADE_UI = Object.freeze([
    { section: 'basic', controls: ['exposure', 'brightness', 'contrast', 'gamma', 'saturation', 'hue'] },
    { section: 'light', controls: ['angle', 'softness'], pad: true },
    { section: 'gradient', controls: ['amount', 'color'] },
    { section: 'wash', controls: ['amount', 'color', 'darkness'] },
    { section: 'rim', controls: ['amount', 'width', 'softness', 'color'] },
    { section: 'backShadow', controls: ['amount'] },
    { section: 'glow', controls: ['amount', 'radius', 'threshold'] },
    { section: 'looks', looks: true },
    { section: 'skin', controls: ['guard'] },
]);

/** The 3×3 direction pad: an angle per button (0 right, 90 up), centre empty. */
export const DIRECTION_PAD = Object.freeze([135, 90, 45, 180, null, 0, -135, -90, -45]);

const ARROWS = ['↖', '↑', '↗', '←', '☀', '→', '↙', '↓', '↘'];

function viewedScene() {
    return canvas?.scene ?? game.scenes?.current ?? null;
}

function overlay() {
    return game.modules.get(MODULE_ID)?.stageOverlay ?? null;
}

function formatValue(section, key, value) {
    const spec = SECTIONS[section][key];
    if (section === 'light' && key === 'angle') return `${Math.round(value)}°`;
    if (section === 'basic' && key === 'hue') return `${Math.round(value)}°`;
    if (section === 'basic' && key === 'exposure') return `${value > 0 ? '+' : ''}${Number(value).toFixed(2)}`;
    if (section === 'basic' && key === 'gamma') return Number(value).toFixed(2);
    return spec.step < 1 ? Number(value).toFixed(2) : `${Math.round(value)}`;
}

/**
 * Per-panel state: the draft and which scene it belongs to, and which
 * sections are open. Lives on the panel instance so a re-render keeps both.
 */
export function gradeState(panel) {
    const scene = viewedScene();
    const id = scene?.id ?? null;
    if (!panel._grade || panel._grade.sceneId !== id) {
        panel._grade = {
            sceneId: id,
            draft: readSceneGrade(scene),
            open: panel._grade?.open ?? new Set(['basic', 'light']),
        };
    }
    return panel._grade;
}

function dialRow(section, key, value) {
    const spec = SECTIONS[section][key];
    const id = `${section}.${key}`;
    return `<div class="glstage-grade-row">
        <label for="glstage-grade-${escapeAttr(id)}">${i18n(`${section}.${key}`)}</label>
        <input type="range" id="glstage-grade-${escapeAttr(id)}" data-grade="${escapeAttr(id)}"
            min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" />
        <span class="glstage-grade-value" data-grade-value="${escapeAttr(id)}">${formatValue(section, key, value)}</span>
    </div>`;
}

function colorRow(section, key, value) {
    const id = `${section}.${key}`;
    return `<div class="glstage-grade-row">
        <label for="glstage-grade-${escapeAttr(id)}">${i18n(`${section}.${key}`)}</label>
        <input type="color" id="glstage-grade-${escapeAttr(id)}" data-grade="${escapeAttr(id)}" value="${escapeAttr(value)}" />
        <span class="glstage-grade-value" data-grade-value="${escapeAttr(id)}">${escapeHTML(value)}</span>
    </div>`;
}

function padHTML(angle) {
    return `<div class="glstage-grade-pad" role="group" aria-label="${escapeAttr(i18n('light.pad'))}">
        ${DIRECTION_PAD.map((a, i) => a === null
            ? `<span class="glstage-grade-pad-sun" aria-hidden="true">${ARROWS[i]}</span>`
            : `<button type="button" class="glstage-grade-pad-btn ${Math.round(angle) === a ? 'active' : ''}"
                data-grade-angle="${a}" title="${a}°">${ARROWS[i]}</button>`).join('')}
    </div>`;
}

function looksHTML(draft) {
    const library = overlay()?.lookLibrary?.list() ?? [];
    const options = (selected) => library.map((l) =>
        `<option value="${escapeAttr(l.id)}" ${l.id === selected ? 'selected' : ''}>${escapeHTML(l.name)}${l.builtin ? '' : ' ★'}</option>`
    ).join('');
    const rows = draft.looks.map((look, i) => `<div class="glstage-grade-look" data-look-index="${i}">
            <select data-look-id="${i}" aria-label="${escapeAttr(i18n('looks.look'))}">${options(look.id)}</select>
            <input type="range" data-look-opacity="${i}" min="${LOOK_OPACITY.min}" max="${LOOK_OPACITY.max}"
                step="${LOOK_OPACITY.step}" value="${look.opacity}" aria-label="${escapeAttr(i18n('looks.opacity'))}" />
            <span class="glstage-grade-value" data-look-value="${i}">${Math.round(look.opacity)}%</span>
            <button type="button" class="glstage-btn-icon" data-look-remove="${i}" title="${escapeAttr(i18n('looks.remove'))}">
                <i class="fas fa-xmark"></i>
            </button>
        </div>`).join('');
    const customs = library.filter((l) => !l.builtin);
    return `${rows || `<div class="glstage-grade-hint">${i18n('looks.none')}</div>`}
        <div class="glstage-grade-actions">
            <button type="button" class="glstage-btn" data-grade-action="add-look" ${draft.looks.length >= MAX_LOOKS ? 'disabled' : ''}>
                <i class="fas fa-plus"></i> ${i18n('looks.add')}
            </button>
        </div>
        <div class="glstage-grade-import">
            <div class="glstage-grade-subhead">${i18n('looks.importTitle')}</div>
            <div class="glstage-grade-hint">${i18n('looks.importHint')}</div>
            <div class="glstage-grade-import-row">
                <input type="file" accept=".cube" data-grade-cube-file aria-label="${escapeAttr(i18n('looks.importFile'))}" />
                <input type="text" data-grade-cube-name placeholder="${escapeAttr(i18n('looks.importName'))}" />
                <button type="button" class="glstage-btn" data-grade-action="import-cube">
                    <i class="fas fa-file-import"></i> ${i18n('looks.import')}
                </button>
            </div>
            ${customs.length ? `<div class="glstage-grade-custom-list">${customs.map((l) => `<span class="glstage-grade-custom">
                ${escapeHTML(l.name)}
                <button type="button" class="glstage-btn-icon" data-grade-remove-custom="${escapeAttr(l.id)}" title="${escapeAttr(i18n('looks.removeCustom'))}">
                    <i class="fas fa-trash"></i>
                </button></span>`).join('')}</div>` : ''}
        </div>`;
}

/** The tab's HTML. */
export function buildGradeTab(panel) {
    const scene = viewedScene();
    const state = gradeState(panel);
    const draft = state.draft;
    const intensity = Number(getSetting('ppIntensity')) || 0;
    const enabled = getSetting('ppEnabled') !== false;

    if (!scene) {
        return `<div class="glstage-tab-content glstage-grade-tab"><div class="glstage-empty">${i18n('noScene')}</div></div>`;
    }

    const own = hasSceneGrade(scene);
    const scenes = (game.scenes?.contents ?? []).filter((s) => s.id !== scene.id && hasSceneGrade(s));

    let html = `<div class="glstage-tab-content glstage-grade-tab">
        <div class="glstage-grade-header">
            <div class="glstage-grade-scene">
                <i class="fas fa-panorama"></i>
                <span>${fmt('editing', { scene: escapeHTML(scene.name) })}</span>
                <span class="glstage-grade-badge">${own ? i18n('ownGrade') : i18n('worldGrade')}</span>
            </div>
            <div class="glstage-grade-actions">
                <button type="button" class="glstage-btn" data-grade-action="resample" title="${escapeAttr(i18n('resampleHint'))}">
                    <i class="fas fa-eye-dropper"></i> ${i18n('resample')}
                </button>
                <button type="button" class="glstage-btn" data-grade-action="reset" title="${escapeAttr(i18n('resetHint'))}">
                    <i class="fas fa-rotate-left"></i> ${i18n('reset')}
                </button>
                <button type="button" class="glstage-btn" data-grade-action="save-default" title="${escapeAttr(i18n('saveDefaultHint'))}">
                    <i class="fas fa-bookmark"></i> ${i18n('saveDefault')}
                </button>
            </div>
            <div class="glstage-grade-actions">
                <select data-grade-copy-from aria-label="${escapeAttr(i18n('copyFrom'))}" ${scenes.length ? '' : 'disabled'}>
                    <option value="">${i18n('copyFrom')}</option>
                    ${scenes.map((s) => `<option value="${escapeAttr(s.id)}">${escapeHTML(s.name)}</option>`).join('')}
                </select>
                <button type="button" class="glstage-btn" data-grade-action="copy" ${scenes.length ? '' : 'disabled'}>
                    <i class="fas fa-copy"></i> ${i18n('copy')}
                </button>
            </div>
            <div class="glstage-grade-row glstage-grade-master">
                <label for="glstage-grade-intensity">${i18n('intensity')}</label>
                <input type="range" id="glstage-grade-intensity" data-grade-intensity min="0" max="100" step="5"
                    value="${intensity}" ${enabled ? '' : 'disabled'} />
                <span class="glstage-grade-value" data-grade-intensity-value>${intensity}%</span>
            </div>
            ${panel._buildPostFXNote?.() ?? ''}
        </div>`;

    for (const block of GRADE_UI) {
        const open = state.open.has(block.section);
        html += `<details class="glstage-grade-section" data-grade-section="${block.section}" ${open ? 'open' : ''}>
            <summary>${i18n(`${block.section}.title`)}</summary>
            <div class="glstage-grade-body">`;
        if (block.section !== 'looks') {
            html += `<div class="glstage-grade-hint">${i18n(`${block.section}.hint`)}</div>`;
        }
        if (block.pad) html += padHTML(draft.light.angle);
        if (block.looks) {
            html += looksHTML(draft);
        } else {
            for (const key of block.controls) {
                const isColor = key in (COLORS[block.section] ?? {});
                const value = draft[block.section][key];
                html += isColor ? colorRow(block.section, key, value) : dialRow(block.section, key, value);
            }
        }
        html += `</div></details>`;
    }
    html += `</div>`;
    return html;
}

// ─── Behaviour ───

function preview(state) {
    overlay()?.previewPostFXGrade?.(state.draft);
}

async function save(state) {
    const scene = viewedScene();
    if (!scene || scene.id !== state.sceneId) return;
    try {
        await writeSceneGrade(scene, state.draft);
    } catch (err) {
        console.error('gluniverse | stage: could not save the scene grade', err);
        ui.notifications?.error(i18n('saveFailed'));
    }
}

/** Wire the tab. Called from GMPanel._onRender on every render. */
export function bindGradeTab(el, panel) {
    const root = el.querySelector('.glstage-grade-tab');
    if (!root) return;
    const state = gradeState(panel);

    // Which sections are open survives a re-render.
    root.querySelectorAll('details[data-grade-section]').forEach((d) => {
        d.addEventListener('toggle', () => {
            if (d.open) state.open.add(d.dataset.gradeSection);
            else state.open.delete(d.dataset.gradeSection);
        });
    });

    // Dials and colours: `input` previews, `change` saves.
    root.querySelectorAll('input[data-grade]').forEach((input) => {
        const [section, key] = input.dataset.grade.split('.');
        const isColor = input.type === 'color';
        const read = () => (isColor ? input.value : Number(input.value));
        input.addEventListener('input', () => {
            state.draft = normalizeGrade({ ...state.draft, [section]: { ...state.draft[section], [key]: read() } }, state.draft);
            const label = root.querySelector(`[data-grade-value="${input.dataset.grade}"]`);
            if (label) label.textContent = isColor ? input.value : formatValue(section, key, state.draft[section][key]);
            if (section === 'light' && key === 'angle') {
                root.querySelectorAll('[data-grade-angle]').forEach((b) =>
                    b.classList.toggle('active', Number(b.dataset.gradeAngle) === Math.round(state.draft.light.angle)));
            }
            preview(state);
        });
        input.addEventListener('change', () => save(state));
    });

    // Direction pad: a shortcut that sets the angle and saves at once.
    root.querySelectorAll('[data-grade-angle]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            state.draft = normalizeGrade({ ...state.draft, light: { ...state.draft.light, angle: Number(btn.dataset.gradeAngle) } }, state.draft);
            preview(state);
            await save(state);
            panel.render({ force: false });
        });
    });

    // Master strength: a world setting, previewed locally while dragging.
    const master = root.querySelector('[data-grade-intensity]');
    if (master) {
        const label = root.querySelector('[data-grade-intensity-value]');
        master.addEventListener('input', () => {
            if (label) label.textContent = `${master.value}%`;
            overlay()?.previewPostFXIntensity?.(Number(master.value) / 100);
        });
        master.addEventListener('change', () => setSetting('ppIntensity', Number(master.value)));
    }

    // Looks.
    const setLooks = (looks) => {
        state.draft = normalizeGrade({ ...state.draft, looks }, state.draft);
    };
    root.querySelectorAll('[data-look-id]').forEach((select) => {
        select.addEventListener('change', async () => {
            const i = Number(select.dataset.lookId);
            setLooks(state.draft.looks.map((l, j) => (j === i ? { ...l, id: select.value } : l)));
            preview(state);
            await save(state);
        });
    });
    root.querySelectorAll('[data-look-opacity]').forEach((slider) => {
        const i = Number(slider.dataset.lookOpacity);
        slider.addEventListener('input', () => {
            setLooks(state.draft.looks.map((l, j) => (j === i ? { ...l, opacity: Number(slider.value) } : l)));
            const label = root.querySelector(`[data-look-value="${i}"]`);
            if (label) label.textContent = `${slider.value}%`;
            preview(state);
        });
        slider.addEventListener('change', () => save(state));
    });
    root.querySelectorAll('[data-look-remove]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const i = Number(btn.dataset.lookRemove);
            setLooks(state.draft.looks.filter((_, j) => j !== i));
            preview(state);
            await save(state);
            panel.render({ force: false });
        });
    });

    const action = (name, fn) => root.querySelector(`[data-grade-action="${name}"]`)?.addEventListener('click', fn);

    action('add-look', async () => {
        if (state.draft.looks.length >= MAX_LOOKS) return;
        const first = overlay()?.lookLibrary?.list()?.[0]?.id;
        if (!first) return;
        setLooks([...state.draft.looks, { id: first, opacity: LOOK_OPACITY.default }]);
        preview(state);
        await save(state);
        panel.render({ force: false });
    });

    action('import-cube', async () => {
        const file = root.querySelector('[data-grade-cube-file]')?.files?.[0];
        const name = root.querySelector('[data-grade-cube-name]')?.value?.trim() || file?.name?.replace(/\.cube$/i, '') || '';
        if (!file) {
            ui.notifications?.warn(i18n('looks.importNoFile'));
            return;
        }
        try {
            const { id } = await importCubeLook(file, name);
            ui.notifications?.info(fmt('looks.imported', { name: escapeHTML(name) }));
            if (state.draft.looks.length < MAX_LOOKS && !state.draft.looks.some((l) => l.id === id)) {
                setLooks([...state.draft.looks, { id, opacity: LOOK_OPACITY.default }]);
                await save(state);
            }
        } catch (err) {
            ui.notifications?.error(fmt('looks.importFailed', { reason: escapeHTML(err?.message ?? String(err)) }));
        }
        panel.render({ force: false });
    });

    root.querySelectorAll('[data-grade-remove-custom]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.gradeRemoveCustom;
            await removeCustomLook(id);
            setLooks(state.draft.looks.filter((l) => l.id !== id));
            await save(state);
            panel.render({ force: false });
        });
    });

    action('resample', async () => {
        const ov = overlay();
        const scene = viewedScene();
        if (!ov || !scene) return;
        // Save first, so the re-sample keeps whatever the GM has just set.
        await save(state);
        await ov.resampleSceneGrade();
        state.draft = readSceneGrade(scene);
        panel.render({ force: false });
    });

    action('reset', async () => {
        const scene = viewedScene();
        if (!scene) return;
        // Stored as the scene's own grade rather than cleared: a scene with no
        // grade is re-seeded from its background the next time it is staged.
        state.draft = normalizeGrade(readWorldDefaults(), NEUTRAL_GRADE);
        preview(state);
        await save(state);
        panel.render({ force: false });
    });

    action('save-default', async () => {
        await writeWorldDefaults({ ...state.draft, seeded: false });
        ui.notifications?.info(i18n('savedDefault'));
    });

    action('copy', async () => {
        const id = root.querySelector('[data-grade-copy-from]')?.value;
        const from = id ? game.scenes?.get(id) : null;
        if (!from) return;
        state.draft = readSceneGrade(from);
        preview(state);
        await save(state);
        panel.render({ force: false });
    });
}
