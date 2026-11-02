// Stream Pacer — settings, the exemption form and the Dire Peril wording form.
//
// Reaches `foundry.applications.api` at module scope, so this file is never
// imported by the pure modules or the check tools (which read it as text).

import { featurePath } from '../../core/const.mjs';
import { FEATURE_ID, MODULE_ID } from './const.js';

export { FEATURE_ID, MODULE_ID };

/** The controller registers here so a world setting changing redraws every screen. */
let refresher = null;
export function setRefresher(fn) { refresher = fn; }
const refresh = () => refresher?.();

/**
 * Is this user hidden from the pacer UI (the band and the HUD)? Read live: the
 * GM asks it about other people while counting a ready check, and a capture
 * login that never sees the band can never answer one.
 */
export function isBarsExempt(userId) {
  const list = game.settings.get(MODULE_ID, 'sp.exemptUsers');
  return Array.isArray(list) && list.includes(userId);
}

/** Is this user hidden from the Dire Peril splash and its lane? Read live. */
export function isPerilExempt(userId) {
  const list = game.settings.get(MODULE_ID, 'sp.perilExemptUsers');
  return Array.isArray(list) && list.includes(userId);
}

/**
 * Is this user hidden from every part of the traffic-light safety tool?
 *
 * The setting is read on EVERY call, deliberately. This is the "is user X
 * exempt?" question, asked by a GM client about someone else while building the
 * safety roster: a GM that connected before the list changed has no reload of
 * its own to refresh a snapshot, and would otherwise count a capture login as
 * an unanswered player forever. `game.settings.get` is an in-memory lookup and
 * the roster is table-sized; a cache here is exactly what would bring the
 * staleness back.
 */
export function isSafetyExempt(userId) {
  const list = game.settings.get(MODULE_ID, 'sp.safetyExemptUsers');
  return Array.isArray(list) && list.includes(userId);
}

// The local client's own answer to "am *I* exempt?", captured once during
// onReady. Deliberately a snapshot rather than a live read: it decides whether
// the safety surfaces are ever constructed, so every consumer must agree on one
// boundary, which is that client's next reload.
let localSafetyExempt = false;

/** Called once from onReady, before any safety surface is constructed. */
export function captureLocalSafetyExemption() {
  localSafetyExempt = isSafetyExempt(game.user.id);
  return localSafetyExempt;
}

/** The snapshot taken by captureLocalSafetyExemption(). */
export function isLocallySafetyExempt() {
  return localSafetyExempt;
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

async function saveExemptUsers(_event, _form, formData) {
  const data = formData?.object ?? {};
  // Three independent exemption lists share one form. "bars-" checkboxes hide
  // the band and the HUD; "peril-" the Dire Peril splash; "safety-" the whole
  // traffic-light tool. A prefix added here without a matching column in
  // exempt-users.hbs (or the reverse) stores nothing and fails silently, so
  // tools/stream-pacer-check.mjs asserts the four sites agree.
  const exemptUsers = [];
  const perilExemptUsers = [];
  const safetyExemptUsers = [];
  for (const [key, value] of Object.entries(data)) {
    if (!value) continue;
    if (key.startsWith('bars-')) {
      exemptUsers.push(key.replace('bars-', ''));
    } else if (key.startsWith('peril-')) {
      perilExemptUsers.push(key.replace('peril-', ''));
    } else if (key.startsWith('safety-')) {
      safetyExemptUsers.push(key.replace('safety-', ''));
    }
  }
  await game.settings.set(MODULE_ID, 'sp.exemptUsers', exemptUsers);
  await game.settings.set(MODULE_ID, 'sp.perilExemptUsers', perilExemptUsers);
  await game.settings.set(MODULE_ID, 'sp.safetyExemptUsers', safetyExemptUsers);
}

class ExemptUsersConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'stream-pacer-exempt-users',
    classes: ['stream-pacer-exempt-users'],
    tag: 'form',
    window: { title: 'STREAM_PACER.Settings.ExemptUsers', icon: 'fas fa-users-slash' },
    position: { width: 480, height: 'auto' },
    form: { handler: saveExemptUsers, closeOnSubmit: true }
  };

  static PARTS = {
    form: { template: featurePath(FEATURE_ID, 'templates/exempt-users.hbs') }
  };

  async _prepareContext() {
    const exemptUsers = game.settings.get(MODULE_ID, 'sp.exemptUsers');
    const perilExemptUsers = game.settings.get(MODULE_ID, 'sp.perilExemptUsers');
    const safetyExemptUsers = game.settings.get(MODULE_ID, 'sp.safetyExemptUsers');
    const users = game.users.map((u) => ({
      id: u.id,
      name: u.name,
      isExempt: exemptUsers.includes(u.id),
      isPerilExempt: perilExemptUsers.includes(u.id),
      isSafetyExempt: safetyExemptUsers.includes(u.id)
    }));
    return { users };
  }
}

const PERIL_TEXT = ['sp.perilTextDire', 'sp.perilTextPeril', 'sp.perilTextTag', 'sp.perilTextSubtitle'];

async function savePerilText(_event, _form, formData) {
  if (!game.user.isGM) return;
  const data = formData?.object ?? {};
  for (const key of PERIL_TEXT) {
    const field = key.slice('sp.'.length);
    await game.settings.set(MODULE_ID, key, String(data[field] ?? '').trim().slice(0, 80));
  }
}

class PerilTextConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'stream-pacer-peril-text',
    classes: ['stream-pacer-peril-text'],
    tag: 'form',
    window: { title: 'STREAM_PACER.Settings.PerilText', icon: 'fas fa-skull' },
    position: { width: 440, height: 'auto' },
    form: { handler: savePerilText, closeOnSubmit: true }
  };

  static PARTS = {
    form: { template: featurePath(FEATURE_ID, 'templates/peril-text.hbs') }
  };

  async _prepareContext() {
    const L = (k) => game.i18n.localize(k);
    return {
      fields: [
        { name: 'perilTextDire', label: L('STREAM_PACER.Settings.PerilTextDire'), value: game.settings.get(MODULE_ID, 'sp.perilTextDire'), placeholder: L('STREAM_PACER.Peril.Dire') },
        { name: 'perilTextPeril', label: L('STREAM_PACER.Settings.PerilTextPeril'), value: game.settings.get(MODULE_ID, 'sp.perilTextPeril'), placeholder: L('STREAM_PACER.Peril.Peril') },
        { name: 'perilTextTag', label: L('STREAM_PACER.Settings.PerilTextTag'), value: game.settings.get(MODULE_ID, 'sp.perilTextTag'), placeholder: L('STREAM_PACER.Peril.Tag') },
        { name: 'perilTextSubtitle', label: L('STREAM_PACER.Settings.PerilTextSubtitle'), value: game.settings.get(MODULE_ID, 'sp.perilTextSubtitle'), placeholder: L('STREAM_PACER.Peril.Subtitle') }
      ]
    };
  }
}

export function registerSettings() {
  /* ── the table's shared state: world settings only a GM can write ── */

  // The GM's current call: { id, kind, at, ends?, targets? } or {}.
  game.settings.register(MODULE_ID, 'sp.call', {
    scope: 'world', config: false, type: Object, default: {}, onChange: refresh
  });
  // The room's mood: { id, kind, at } or {}.
  game.settings.register(MODULE_ID, 'sp.mood', {
    scope: 'world', config: false, type: Object, default: {}, onChange: refresh
  });
  // Spotlight marks: { marks: { userId: n } }. Never cleared by a reset or a
  // scene change; only the GM's "Reset marks" clears it.
  game.settings.register(MODULE_ID, 'sp.spotlight', {
    scope: 'world', config: false, type: Object, default: { marks: {} }, onChange: refresh
  });

  // Pass raw i18n keys: Foundry localizes them when the sheet renders.
  game.settings.register(MODULE_ID, 'sp.defaultCountdown', {
    name: 'STREAM_PACER.Settings.DefaultCountdown',
    hint: 'STREAM_PACER.Settings.DefaultCountdownHint',
    scope: 'world', config: true, type: Number, default: 60,
    range: { min: 30, max: 600, step: 30 }
  });

  game.settings.register(MODULE_ID, 'sp.resetOnSceneChange', {
    name: 'STREAM_PACER.Settings.ResetOnSceneChange',
    hint: 'STREAM_PACER.Settings.ResetOnSceneChangeHint',
    scope: 'world', config: true, type: Boolean, default: true
  });

  // Dire Peril wording, world-scoped so the whole table sees the same reveal.
  // Empty falls back to the localized default at render time.
  for (const key of PERIL_TEXT) {
    game.settings.register(MODULE_ID, key, { scope: 'world', config: false, type: String, default: '', onChange: refresh });
  }
  game.settings.registerMenu(MODULE_ID, 'sp.perilTextMenu', {
    name: 'STREAM_PACER.Settings.PerilText',
    label: 'STREAM_PACER.Settings.PerilTextLabel',
    hint: 'STREAM_PACER.Settings.PerilTextHint',
    icon: 'fas fa-skull',
    type: PerilTextConfig,
    restricted: true
  });

  /* ── exemptions ── */

  // Hidden from the band and the HUD (a stream capture or overlay login).
  game.settings.register(MODULE_ID, 'sp.exemptUsers', {
    name: 'STREAM_PACER.Settings.ExemptUsers',
    hint: 'STREAM_PACER.Settings.ExemptUsersHint',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: refresh
  });

  // Hidden from the Dire Peril splash and lane. Separate from the list above so
  // a capture login can show the peril reveal and nothing else (or the reverse).
  game.settings.register(MODULE_ID, 'sp.perilExemptUsers', {
    name: 'STREAM_PACER.Settings.PerilExemptUsers',
    hint: 'STREAM_PACER.Settings.PerilExemptUsersHint',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: refresh
  });

  // Hidden from the whole traffic-light tool. A different question from the two
  // above: those are presentation, this one removes a channel. A capture login
  // must never broadcast the table's private safety signals; a real person
  // exempted here loses their only way to signal distress, which is why it is
  // empty by default and spelled out in the hint.
  game.settings.register(MODULE_ID, 'sp.safetyExemptUsers', {
    name: 'STREAM_PACER.Settings.SafetyExemptUsers',
    hint: 'STREAM_PACER.Settings.SafetyExemptUsersHint',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: refresh
  });

  game.settings.registerMenu(MODULE_ID, 'sp.exemptUsersMenu', {
    name: 'STREAM_PACER.Settings.ExemptUsers',
    label: 'STREAM_PACER.Settings.ExemptUsersLabel',
    hint: 'STREAM_PACER.Settings.ExemptUsersHint',
    icon: 'fas fa-users-slash',
    type: ExemptUsersConfig,
    restricted: true
  });

  /* ── this client's own preferences ── */

  game.settings.register(MODULE_ID, 'sp.hudPosition', {
    scope: 'client', config: false, type: Object, default: { left: null, top: null }
  });
  game.settings.register(MODULE_ID, 'sp.hudCollapsed', {
    scope: 'client', config: false, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, 'sp.sound', {
    name: 'STREAM_PACER.Settings.Sound',
    hint: 'STREAM_PACER.Settings.SoundHint',
    scope: 'client', config: true, type: Boolean, default: true, onChange: refresh
  });
  game.settings.register(MODULE_ID, 'sp.volume', {
    name: 'STREAM_PACER.Settings.Volume',
    hint: 'STREAM_PACER.Settings.VolumeHint',
    scope: 'client', config: true, type: Number, default: 0.7,
    range: { min: 0, max: 1, step: 0.05 }
  });
  game.settings.register(MODULE_ID, 'sp.titleFlash', {
    name: 'STREAM_PACER.Settings.TitleFlash',
    hint: 'STREAM_PACER.Settings.TitleFlashHint',
    scope: 'client', config: true, type: Boolean, default: true
  });
  // Toggled from the HUD, because turning it on needs the browser's permission
  // prompt, which only a click can open.
  game.settings.register(MODULE_ID, 'sp.desktopAlerts', {
    scope: 'client', config: false, type: Boolean, default: false, onChange: refresh
  });
}
