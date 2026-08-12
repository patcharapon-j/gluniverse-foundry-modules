import { ThemeManager } from './ThemeManager.js';
import { featurePath } from '../../core/const.mjs';

export const FEATURE_ID = 'stream-pacer';

// Ported into GLUniverse Suite: the package id is the suite, and every setting
// key is prefixed with the feature prefix "sp." to avoid cross-feature
// collisions on the shared namespace.
export const MODULE_ID = 'gluniverse-foundry-modules';

export const PLAYER_STATUS = {
  ENGAGED: 'engaged',
  HAND_RAISED: 'hand_raised',
  NEED_TIME: 'need_time',
  READY: 'ready'
};

export const GM_SIGNAL = {
  NONE: 'none',
  SOFT: 'soft',
  COUNTDOWN: 'countdown',
  FLOOR_OPEN: 'floor_open'
};

// A short-lived, GM-initiated table check-in. These values deliberately live
// outside the normal pacing statuses: they are private, session-only safety
// responses and must never be persisted with the player's public HUD status.
export const SAFETY_STATUS = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red'
};

// Configuration app for selecting exempt users.
// Defined before registerSettings() so registerMenu can reference it without
// hitting the class-declaration temporal dead zone.
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

async function saveExemptUsers(_event, _form, formData) {
  const data = formData?.object ?? {};
  // Three independent exemption lists share one form. "bars-" checkboxes drive
  // the general pacer UI; "peril-" the Dire Peril splash; "safety-" the whole
  // traffic-light safety tool. A prefix added here without a matching column in
  // exempt-users.hbs (or vice versa) stores nothing and fails silently, so
  // tools/stream-pacer-safety-check.mjs asserts the four sites agree.
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

/**
 * Is this user hidden from every part of the traffic-light safety tool?
 *
 * The setting is read on EVERY call, deliberately. This is the "is user X
 * exempt?" question, asked by a GM client about someone else while building the
 * safety roster — a GM that connected before the list changed has no reload of
 * its own to refresh a snapshot, and would otherwise count a capture login as
 * an unanswered player forever. `game.settings.get` is an in-memory map lookup
 * and the roster is table-sized; a cache here is exactly what would reintroduce
 * the staleness. See design.md — "Two questions, one setting".
 */
export function isSafetyExempt(userId) {
  const list = game.settings.get(MODULE_ID, 'sp.safetyExemptUsers');
  return Array.isArray(list) && list.includes(userId);
}

// The local client's own answer to "am *I* exempt?", captured once during
// onReady. Deliberately a snapshot rather than a live read: it decides whether
// imperative DOM surfaces are ever constructed, so every consumer must agree on
// one boundary — that client's next reload — exactly like the two sibling
// exemptions. See design.md — "Two questions, one setting".
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

class ExemptUsersConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'stream-pacer-exempt-users',
    classes: ['stream-pacer-exempt-users'],
    tag: 'form',
    window: {
      title: 'STREAM_PACER.Settings.ExemptUsers',
      icon: 'fas fa-users-slash'
    },
    position: {
      // Three exemption columns need more room than the original two.
      width: 480,
      height: 'auto'
    },
    form: {
      handler: saveExemptUsers,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: {
      template: featurePath(FEATURE_ID, 'templates/exempt-users.hbs')
    }
  };

  async _prepareContext() {
    const exemptUsers = game.settings.get(MODULE_ID, 'sp.exemptUsers');
    const perilExemptUsers = game.settings.get(MODULE_ID, 'sp.perilExemptUsers');
    const safetyExemptUsers = game.settings.get(MODULE_ID, 'sp.safetyExemptUsers');
    const users = game.users.map(u => ({
      id: u.id,
      name: u.name,
      isExempt: exemptUsers.includes(u.id),
      isPerilExempt: perilExemptUsers.includes(u.id),
      isSafetyExempt: safetyExemptUsers.includes(u.id)
    }));
    return { users };
  }
}

async function saveAppearance(_event, _form, formData) {
  const data = formData?.object ?? {};
  await game.settings.set(MODULE_ID, 'sp.perilWebGLEnabled', data.perilWebGLEnabled === true);

  // Dire Peril text is world-scoped — only GMs may write it.
  if (game.user.isGM) {
    await game.settings.set(MODULE_ID, 'sp.perilTextDire', (data.perilTextDire ?? '').trim());
    await game.settings.set(MODULE_ID, 'sp.perilTextPeril', (data.perilTextPeril ?? '').trim());
    await game.settings.set(MODULE_ID, 'sp.perilTextTag', (data.perilTextTag ?? '').trim());
    await game.settings.set(MODULE_ID, 'sp.perilTextSubtitle', (data.perilTextSubtitle ?? '').trim());
  }

  ThemeManager.apply();
}

class AppearanceConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'stream-pacer-appearance',
    classes: ['stream-pacer-appearance'],
    tag: 'form',
    window: {
      title: 'STREAM_PACER.Settings.Appearance',
      icon: 'fas fa-palette'
    },
    position: {
      width: 460,
      height: 'auto'
    },
    form: {
      handler: saveAppearance,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: {
      template: featurePath(FEATURE_ID, 'templates/appearance-config.hbs')
    }
  };

  async _prepareContext() {
    return {
      perilWebGLEnabled: game.settings.get(MODULE_ID, 'sp.perilWebGLEnabled'),
      isGM: game.user.isGM,
      perilTextDire: game.settings.get(MODULE_ID, 'sp.perilTextDire'),
      perilTextPeril: game.settings.get(MODULE_ID, 'sp.perilTextPeril'),
      perilTextTag: game.settings.get(MODULE_ID, 'sp.perilTextTag'),
      perilTextSubtitle: game.settings.get(MODULE_ID, 'sp.perilTextSubtitle'),
      perilTextDirePlaceholder: game.i18n.localize('STREAM_PACER.DirePerilTitleDire'),
      perilTextPerilPlaceholder: game.i18n.localize('STREAM_PACER.DirePerilTitlePeril'),
      perilTextTagPlaceholder: game.i18n.localize('STREAM_PACER.DirePerilTag'),
      perilTextSubtitlePlaceholder: game.i18n.localize('STREAM_PACER.DirePerilSubtitle')
    };
  }
}

export function registerSettings() {
  // --- Appearance ---
  game.settings.register(MODULE_ID, 'sp.perilWebGLEnabled', {
    scope: 'client',
    config: false,
    type: Boolean,
    default: true
  });

  // Dire Peril display text — world-scoped so the whole table sees the same
  // reveal. Empty string falls back to the localized default at render time.
  for (const key of ['sp.perilTextDire', 'sp.perilTextPeril', 'sp.perilTextTag', 'sp.perilTextSubtitle']) {
    game.settings.register(MODULE_ID, key, {
      scope: 'world',
      config: false,
      type: String,
      default: ''
    });
  }

  game.settings.registerMenu(MODULE_ID, 'sp.appearanceMenu', {
    name: 'STREAM_PACER.Settings.Appearance',
    label: 'STREAM_PACER.Settings.AppearanceLabel',
    hint: 'STREAM_PACER.Settings.AppearanceHint',
    icon: 'fas fa-palette',
    type: AppearanceConfig,
    restricted: false
  });


  // Hidden state storage for persistence
  game.settings.register(MODULE_ID, 'sp.pacerState', {
    name: 'Pacer State',
    scope: 'world',
    config: false,
    type: Object,
    default: {
      playerStates: {},
      gmSignal: GM_SIGNAL.NONE,
      countdownEnd: null,
      direPerilActive: false
    }
  });

  // Spotlight tracker state — world-scoped so totals survive a reload and are
  // shared between co-GMs. Kept separate from pacerState so the pacer's
  // "Reset all" and scene changes never wipe a session's spotlight tracking.
  game.settings.register(MODULE_ID, 'sp.spotlightState', {
    name: 'Spotlight State',
    scope: 'world',
    config: false,
    type: Object,
    default: { players: {} }
  });

  // Spotlight tracker on/off. World-scoped so the GM team shares one decision.
  // When OFF the fairness panel is hidden entirely from the HUD.
  game.settings.register(MODULE_ID, 'sp.spotlightEnabled', {
    name: 'STREAM_PACER.Settings.SpotlightEnabled',
    hint: 'STREAM_PACER.Settings.SpotlightEnabledHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      // Re-render the HUD and start/stop the live timer for the new state.
      game.streamPacer?.manager?._updateSpotlightInterval();
      game.streamPacer?.hud?.render(false);
    }
  });

  // Spotlight tracking mode. "time" accrues seconds in the light; "count" is a
  // more abstract tally the GM clicks up/down (left-click add, right-click
  // reduce) when a PC takes a spotlight moment.
  game.settings.register(MODULE_ID, 'sp.spotlightMode', {
    name: 'STREAM_PACER.Settings.SpotlightMode',
    hint: 'STREAM_PACER.Settings.SpotlightModeHint',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      time: 'STREAM_PACER.Settings.SpotlightModeTime',
      count: 'STREAM_PACER.Settings.SpotlightModeCount'
    },
    default: 'time',
    onChange: () => {
      game.streamPacer?.manager?._updateSpotlightInterval();
      game.streamPacer?.hud?.render(false);
    }
  });

  // Default countdown duration (1-10 minutes)
  // Pass raw i18n keys — Foundry localizes them lazily when the settings
  // sheet is rendered. Calling game.i18n.localize() here (during 'init')
  // runs before language files are fully loaded and returns the raw key.
  game.settings.register(MODULE_ID, 'sp.defaultCountdown', {
    name: 'STREAM_PACER.Settings.DefaultCountdown',
    hint: 'STREAM_PACER.Settings.DefaultCountdownHint',
    scope: 'world',
    config: true,
    type: Number,
    default: 60,
    range: {
      min: 60,
      max: 600,
      step: 30
    }
  });

  // Auto-reset on scene change
  game.settings.register(MODULE_ID, 'sp.resetOnSceneChange', {
    name: 'STREAM_PACER.Settings.ResetOnSceneChange',
    hint: 'STREAM_PACER.Settings.ResetOnSceneChangeHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Exempt users (won't see the general pacer UI / bars - useful for streaming)
  game.settings.register(MODULE_ID, 'sp.exemptUsers', {
    name: 'STREAM_PACER.Settings.ExemptUsers',
    hint: 'STREAM_PACER.Settings.ExemptUsersHint',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  // Dire Peril exempt users (won't see the Dire Peril splash / indicator).
  // Tracked separately from exemptUsers so a user can be hidden from the
  // general bars while still seeing the Dire Peril reveal (or vice versa).
  game.settings.register(MODULE_ID, 'sp.perilExemptUsers', {
    name: 'STREAM_PACER.Settings.PerilExemptUsers',
    hint: 'STREAM_PACER.Settings.PerilExemptUsersHint',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  // Safety-light exempt users (see none of the traffic-light safety tool).
  // Tracked separately from the other two lists because it is answering a
  // different question: the bars and the Dire Peril splash are presentation, so
  // hiding them costs nothing, whereas this one removes a channel. A capture or
  // overlay login is a puppet and must never broadcast the table's private
  // safety signals; a real person exempted here loses their only way to signal
  // distress, which is why it is opt-in, empty by default, and spelled out in
  // the hint rather than folded into either sibling.
  game.settings.register(MODULE_ID, 'sp.safetyExemptUsers', {
    name: 'STREAM_PACER.Settings.SafetyExemptUsers',
    hint: 'STREAM_PACER.Settings.SafetyExemptUsersHint',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  // Register menu for exempt users
  game.settings.registerMenu(MODULE_ID, 'sp.exemptUsersMenu', {
    name: 'STREAM_PACER.Settings.ExemptUsers',
    label: 'STREAM_PACER.Settings.ExemptUsersLabel',
    hint: 'STREAM_PACER.Settings.ExemptUsersHint',
    icon: 'fas fa-users-slash',
    type: ExemptUsersConfig,
    restricted: true
  });

  // Client-side HUD position memory
  game.settings.register(MODULE_ID, 'sp.hudPosition', {
    name: 'HUD Position',
    scope: 'client',
    config: false,
    type: Object,
    default: { left: null, top: null }
  });

  // Hand raise audio notification enabled (GM only setting)
  game.settings.register(MODULE_ID, 'sp.handRaiseAudioEnabled', {
    name: 'STREAM_PACER.Settings.HandRaiseAudioEnabled',
    hint: 'STREAM_PACER.Settings.HandRaiseAudioEnabledHint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });

  // Safety-light escalation cue (GM-facing, shares the volume slider below).
  game.settings.register(MODULE_ID, 'sp.safetyAudioEnabled', {
    name: 'STREAM_PACER.Settings.SafetyAudioEnabled',
    hint: 'STREAM_PACER.Settings.SafetyAudioEnabledHint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });

  // Hand raise audio volume (0-1)
  game.settings.register(MODULE_ID, 'sp.handRaiseAudioVolume', {
    name: 'STREAM_PACER.Settings.HandRaiseAudioVolume',
    hint: 'STREAM_PACER.Settings.HandRaiseAudioVolumeHint',
    scope: 'client',
    config: true,
    type: Number,
    default: 0.5,
    range: {
      min: 0,
      max: 1,
      step: 0.1
    }
  });
}
