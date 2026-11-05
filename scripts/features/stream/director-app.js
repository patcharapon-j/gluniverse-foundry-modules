import { getActiveSceneCombat, getCombatants, getRunningSceneCombat } from "./combat-utils.js";
import { featurePath } from "../../core/const.mjs";
import { ensureSuiteGroup } from "../../core/scene-controls.mjs";
import {
  CAMERA_MODES,
  CARD_SCALE_RANGE,
  CHAT_POSITIONS,
  FEATURE_ID,
  MODULE_ID,
  SCENE_VIEW_MODES,
  STREAM_COMMANDS
} from "./constants.js";
import {
  canEditDirectorSettings,
  canEditStreamAdmin,
  getCameraSettings,
  getChatSettings,
  getDialogSettings,
  getSetting,
  getUiRules,
  isDirectorUser,
  setSetting
} from "./settings.js";
import { delegationUnavailable, requestCommand } from "./director-auth.mjs";
import { PANEL_TABS, offerPanelAction, offerPanelChange, renderPanelSectionsByTab } from "./extensions.mjs";
import { CHAT_LIMITS } from "./chat-settings.mjs";
import { OUT_OF_COMBAT_MODES, TAB_ICONS, onAirState } from "./room-model.mjs";
import { getStreamClientStatus, requestStreamClientStatus } from "./socket.js";
import { openChatFilterApp, summarizeChatFilter } from "./chat-filter-app.js";

let services = {};
let instance = null;

/**
 * The structured settings this feature owns. `targeting` is deliberately absent
 * — it belongs to `stream-targets`, which contributes its own panel section and
 * writes its own keys. The panel never reaches across a feature boundary to
 * write somebody else's setting.
 */
const OBJECT_SETTINGS = {
  camera: { key: "cameraSettings", get: getCameraSettings },
  chat: { key: "chatSettings", get: getChatSettings },
  dialog: { key: "dialogSettings", get: getDialogSettings }
};

export function configureDirectorApp(nextServices) {
  services = nextServices;
}

export function openDirectorApp() {
  if (!isDirectorUser()) return ui.notifications?.warn(game.i18n.localize("GLUNIVERSE_STREAM.notifications.notDirector"));
  requestStreamClientStatus();
  instance ??= new StreamDirectorApp();
  instance.render({ force: true });
}

export function renderDirectorApp() {
  if (instance?.rendered) instance.renderPreservingScroll();
}

/** Scene-control tool name; shared with `main.js`, which binds its clicks. */
export const CONTROL_ROOM_TOOL = "stream-control-room";

/**
 * The standalone module created its own top-level scene-control group. In the
 * suite every feature's tool goes in the one shared `gluniverse` group — gate
 * first, then `ensureSuiteGroup`, per the feature contract.
 *
 * The tool name is exported because `main.js` has to bind its clicks directly:
 * a `button` tool resolves through `onChange`, which fires only when the active
 * tool changes, so repeat clicks are swallowed.
 */
export function addStreamSceneControl(controls) {
  if (!isDirectorUser()) return;
  const group = ensureSuiteGroup(controls);
  group.tools[CONTROL_ROOM_TOOL] = {
    name: CONTROL_ROOM_TOOL,
    title: game.i18n.localize("GLUNIVERSE_STREAM.controls.director"),
    icon: "fas fa-broadcast-tower",
    button: true,
    visible: true,
    // `onChange` only — v13+ calls a deprecated `onClick` as well, and `bindSuiteToolClicks` binds the
    // node, so declaring both opened the panel up to three times per click.
    onChange: () => openDirectorApp()
  };
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class StreamDirectorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  restoreScroll = null;
  /** The tab the room is open on; survives re-renders, which a status report triggers every few seconds. */
  activeTab = PANEL_TABS[0];

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-stream-control-room`,
    classes: ["gluniverse-stream-director"],
    tag: "form",
    window: {
      // Not "Stream Director": `features/stage/` already ships a "GLUniverse
      // Stage Director" in the same scene-control group, and two Directors side
      // by side is the one thing a new GM is guaranteed to misread.
      // Localised by ApplicationV2 itself.
      title: "GLUNIVERSE_STREAM.controls.director",
      icon: "fas fa-broadcast-tower"
    },
    position: { width: 680, height: 720 },
    actions: {}
  };

  static PARTS = {
    main: { template: featurePath(FEATURE_ID, "templates/director.hbs") }
  };

  async _prepareContext(options) {
    const camera = getCameraSettings();
    const chat = getChatSettings();
    const dialog = getDialogSettings();
    const uiRules = getUiRules();
    const status = getStreamClientStatus();
    const activeMode = getActiveCameraMode(camera);
    const streamUserId = getSetting("streamUserId");
    const autoStartIds = getSetting("autoStartStreamUserIds") ?? [];
    const trusted = new Set(getSetting("trustedDirectorUserIds") ?? []);
    const streamConnected = Boolean(streamUserId && game.users?.get(streamUserId)?.active);
    const streamActive = Boolean(status?.active);
    // Reading the panel and editing it are different questions: a director
    // whose delegated channel Foundry refused, or who is alone in the world,
    // still sees the live shot.
    const canEdit = canEditDirectorSettings();
    const t = (key) => game.i18n.localize(`GLUNIVERSE_STREAM.room.${key}`);
    const state = onAirState({ streamUserId, connected: streamConnected, status });
    const streamUser = streamUserId ? game.users?.get(streamUserId) : null;
    const sections = await renderPanelSectionsByTab();
    const activeTab = PANEL_TABS.includes(this.activeTab) ? this.activeTab : PANEL_TABS[0];
    return {
      ...(await super._prepareContext(options)),
      onAir: {
        state,
        label: t(`state.${state}`),
        live: streamActive,
        uiShowing: Boolean(streamActive && status?.restoreVisible),
        login: streamUser
          ? `${streamUser.name} · ${t(streamConnected ? "access.connected" : "access.offline")}`
          : t("access.noLogin")
      },
      status: {
        connected: streamConnected,
        restoreDisabled: streamActive ? "" : "disabled",
        reframeDisabled: streamActive ? "" : "disabled",
        autoStartEnabled: Boolean(streamUserId && autoStartIds.includes(streamUserId)),
        autoStartCanEnable: Boolean(streamUserId && !autoStartIds.includes(streamUserId)),
        scene: canvas?.scene?.name ?? game.i18n.localize("GLUNIVERSE_STREAM.common.none"),
        mode: cameraModeLabel(activeMode),
        combat: t(getRunningSceneCombat() ? "combat.running" : (getActiveSceneCombat() ? "combat.prepared" : "combat.none"))
      },
      tab: { active: activeTab, ...Object.fromEntries(PANEL_TABS.map(id => [id, id === activeTab])) },
      tabs: PANEL_TABS.map(id => ({ id, label: t(`tabs.${id}`), icon: TAB_ICONS[id], active: id === activeTab })),
      labels: { connected: t("access.connected"), gm: t("access.gm") },
      chatLimits: CHAT_LIMITS,
      users: game.users?.map(user => ({
        id: user.id,
        name: user.name,
        active: user.active,
        isGM: user.isGM,
        isStream: user.id === streamUserId,
        trusted: trusted.has(user.id),
        selected: user.id === streamUserId ? "selected" : "",
        checked: trusted.has(user.id) ? "checked" : ""
      })) ?? [],
      camera,
      spotlightSelected: camera.combatMode === CAMERA_MODES.spotlight,
      chat,
      chatFilterSummary: summarizeChatFilter(),
      cardScale: { ...CARD_SCALE_RANGE, percent: Math.round(chat.cardScale * 100) },
      dialog,
      // Sections contributed by sibling features (targeting arcs, roll cards,
      // roleplay chat), grouped by the tab each one asked for. Empty when none is
      // enabled, which is what makes this panel work with `stream` alone installed.
      sections,
      canEdit,
      canEditAdmin: canEditStreamAdmin(),
      // `canEdit` used to be computed here and used nowhere, so a director who
      // could not save anything got a panel of live-looking controls that threw
      // their edits away in silence. It disables the form now, and the notice
      // says which of the two reasons applies — the "no GM connected" one is
      // the common case and had no message at all.
      readOnly: !canEdit,
      readOnlyMessage: readOnlyMessage(),
      tokenRows: services.tokenTracking?.getTokenRows() ?? [],
      combatRows: getCombatRows(),
      detectedUi: services.uiDetector?.getEntries() ?? [],
      selectorRules: uiRules.selectorRules,
      outOfCombatModeOptions: modeOptions(OUT_OF_COMBAT_MODES, camera.outOfCombatMode),
      combatModeOptions: modeOptions(Object.values(CAMERA_MODES), camera.combatMode),
      sceneViewOptions: optionsFor(Object.fromEntries(Object.values(SCENE_VIEW_MODES).map(view => [view, t(`view.${view}`)])), camera.sceneViewMode),
      chatPositionOptions: optionsFor(Object.fromEntries(CHAT_POSITIONS.map(position => [position, t(`corner.${position}`)])), chat.position)
    };
  }

  /**
   * Tabs switch in place, without a render: every panel is already in the form, so a tab change costs
   * nothing and leaves an input being typed into exactly as it was. The choice is kept on the instance
   * so the next render (a setting saved, a status report) opens on the same tab.
   */
  #showTab(id) {
    if (!PANEL_TABS.includes(id)) return;
    this.activeTab = id;
    const body = this.element?.querySelector(".gluniverse-stream-director-body");
    if (body) body.dataset.roomTab = id;
    for (const button of this.element?.querySelectorAll(".gluniverse-stream-tab") ?? []) {
      button.setAttribute("aria-selected", String(button.dataset.tab === id));
    }
    for (const panel of this.element?.querySelectorAll(".gluniverse-stream-tabpanel") ?? []) {
      const show = panel.dataset.tab === id;
      // Only a tab switch plays the panel's arrival. A render (a setting saved, a status report) rebuilds
      // the markup, and an arrival keyed on "not hidden" replayed the whole panel's fade on every one.
      if (show && panel.hidden) {
        panel.dataset.enter = "";
        panel.addEventListener("animationend", () => delete panel.dataset.enter, { once: true });
      }
      panel.hidden = !show;
    }
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", event => this.#onChange(event));
    // Sliders only commit on release, so mirror the value into its readout while it is dragged.
    this.element.addEventListener("input", event => updateRangeOutput(event.target));
    this.element.addEventListener("click", event => this.#onClick(event));
    this.element.addEventListener("submit", event => event.preventDefault());
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.restoreScroll) {
      const scroll = this.restoreScroll;
      this.restoreScroll = null;
      queueMicrotask(() => this.#restoreScroll(scroll));
      requestAnimationFrame(() => this.#restoreScroll(scroll));
      window.setTimeout(() => this.#restoreScroll(scroll), 0);
    }
  }

  renderPreservingScroll() {
    this.#captureScroll();
    return this.render({ force: true });
  }

  #captureScroll() {
    const content = this.#windowContentElement();
    const next = {
      body: this.element?.querySelector(".gluniverse-stream-director-body")?.scrollTop ?? 0,
      content: content?.scrollTop ?? 0,
      // Each tab scrolls on its own; the render reopens the same tab, so its offset is the one to keep.
      panel: this.#activePanel()?.scrollTop ?? 0
    };
    this.restoreScroll = this.restoreScroll
      ? {
        body: Math.max(this.restoreScroll.body, next.body),
        content: Math.max(this.restoreScroll.content, next.content),
        panel: Math.max(this.restoreScroll.panel, next.panel)
      }
      : next;
  }

  #restoreScroll(scroll) {
    const body = this.element?.querySelector(".gluniverse-stream-director-body");
    const content = this.#windowContentElement();
    const panel = this.#activePanel();
    if (body) body.scrollTop = scroll.body;
    if (content) content.scrollTop = scroll.content;
    if (panel) panel.scrollTop = scroll.panel;
  }

  #activePanel() {
    return this.element?.querySelector(".gluniverse-stream-tabpanel:not([hidden])");
  }

  #windowContentElement() {
    return this.element?.closest(".window-content") ?? this.element?.querySelector(".window-content");
  }

  async #onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const name = target.name;
    if (!name) return;

    if (name === "uiZIndex") {
      this.#captureScroll();
      return services.uiDetector?.setElementZIndex(target.dataset.ruleId, target.value);
    }
    // Which login is the stream, and who else may direct, are world
    // administration rather than directing — GM-only, and never delegated. The
    // template hides these controls from a non-GM; this is the second lock, so
    // a hand-crafted change event cannot reach them either.
    if (name === "streamUserId") {
      if (!canEditStreamAdmin()) return;
      return this.#setAndRender("streamUserId", target.value);
    }
    if (name === "trustedDirectorUserIds") {
      if (!canEditStreamAdmin()) return;
      const ids = Array.from(this.element.querySelectorAll("input[name='trustedDirectorUserIds']:checked")).map(input => input.value);
      return this.#setAndRender("trustedDirectorUserIds", ids);
    }

    const [group, ...field] = name.split(".");
    if (OBJECT_SETTINGS[group] && field.length) return this.#updateObject(OBJECT_SETTINGS[group], field.join("."), fieldValue(target));

    // Anything this feature does not own is offered to the contributed
    // sections, which write it through their own prefix and sanitizers.
    this.#captureScroll();
    await offerPanelChange(name, fieldValue(target));
  }

  async #onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.action;
    switch (action) {
      case "room-tab":
        return this.#showTab(button.dataset.tab);
      case "start":
        return requestCommand(STREAM_COMMANDS.start);
      case "stop":
        return requestCommand(STREAM_COMMANDS.stop);
      case "toggle-restore":
        return requestCommand(STREAM_COMMANDS.toggleRestore);
      case "enable-auto-start":
        return this.#setAutoStart(true);
      case "revoke-auto-start":
        return this.#setAutoStart(false);
      case "open-chat-filter":
        return openChatFilterApp();
      case "reframe":
        requestStreamClientStatus();
        return services.camera?.requestReframe({ force: true });
      case "toggle-token":
        this.#captureScroll();
        return services.tokenTracking?.toggleTokenById(button.dataset.tokenId);
      case "ui-allow":
      case "ui-block":
      case "ui-default":
        this.#captureScroll();
        return services.uiDetector?.setElementRule(button.dataset.ruleId, action.replace("ui-", ""));
      case "selector-add":
        return this.#addSelectorRule();
      case "selector-remove":
        this.#captureScroll();
        return services.uiDetector?.removeSelectorRule(button.dataset.ruleId);
      default: {
        // Roll-card actions (browse and frame the default GM art, open the
        // portrait framer) live in `stream-cards` now and arrive here.
        this.#captureScroll();
        await offerPanelAction(action, button);
      }
    }
  }

  async #setAndRender(key, value) {
    this.#captureScroll();
    await setSetting(key, value);
  }

  async #updateObject(setting, field, value) {
    this.#captureScroll();
    await setSetting(setting.key, { ...setting.get(), [field]: value });
  }

  async #addSelectorRule() {
    const selector = this.element.querySelector("input[name='selectorRule.selector']")?.value?.trim();
    const action = this.element.querySelector("select[name='selectorRule.action']")?.value;
    const zIndex = this.element.querySelector("input[name='selectorRule.zIndex']")?.value;
    if (!selector) return;
    try {
      this.#captureScroll();
      await services.uiDetector?.addSelectorRule(selector, action, zIndex);
    } catch (error) {
      ui.notifications?.warn(game.i18n.localize("GLUNIVERSE_STREAM.notifications.invalidSelector"));
    }
  }

  async #setAutoStart(enabled) {
    const streamUserId = getSetting("streamUserId");
    if (!streamUserId) return;
    this.#captureScroll();
    const ids = new Set(getSetting("autoStartStreamUserIds") ?? []);
    if (enabled) ids.add(streamUserId);
    else ids.delete(streamUserId);
    await setSetting("autoStartStreamUserIds", Array.from(ids));
  }
}

/**
 * Why this client cannot save. Delegation refused is the world's own
 * permission answer and cannot be waited out; no connected GM is temporary and
 * fixes itself, so the two must not read the same.
 */
function readOnlyMessage() {
  if (delegationUnavailable()) return game.i18n.localize("GLUNIVERSE_STREAM.notifications.readOnly");
  return game.i18n.localize("GLUNIVERSE_STREAM.notifications.readOnlyNoGm");
}

function getCombatRows() {
  return getCombatants(getActiveSceneCombat()).map(combatant => ({
    id: combatant.id,
    tokenId: combatant.tokenId,
    name: combatant.name,
    defeated: combatant.defeated,
    onScene: (combatant.scene?.id ?? combatant.sceneId) === canvas?.scene?.id
  }));
}

function getActiveCameraMode(camera) {
  return getRunningSceneCombat() ? camera.combatMode : camera.outOfCombatMode;
}

function cameraModeLabel(mode) {
  return Object.values(CAMERA_MODES).includes(mode) ? game.i18n.localize(`GLUNIVERSE_STREAM.room.mode.${mode}`) : String(mode ?? "");
}

function modeOptions(modes, selected) {
  return optionsFor(Object.fromEntries(modes.map(mode => [mode, cameraModeLabel(mode)])), selected);
}

function optionsFor(labels, selected) {
  return Object.entries(labels).map(([value, label]) => ({ value, label, selected: value === selected ? "selected" : "" }));
}

function updateRangeOutput(target) {
  if (!(target instanceof HTMLInputElement) || target.type !== "range" || !target.name) return;
  const output = target.closest("label")?.querySelector(`output[data-for="${target.name}"]`);
  if (output) output.textContent = `${Math.round(Number(target.value) * 100)}%`;
}

function fieldValue(target) {
  if (target.type === "checkbox") return target.checked;
  if (target.type === "number" || target.type === "range" || target.dataset.type === "number") return Number(target.value);
  return target.value;
}
