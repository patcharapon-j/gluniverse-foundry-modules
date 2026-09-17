import { getActiveSceneCombat, getCombatants } from "./combat-utils.js";
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
import { offerPanelAction, offerPanelChange, renderPanelSections } from "./extensions.mjs";
import { getStreamClientStatus, requestStreamClientStatus } from "./socket.js";

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

/**
 * The standalone module created its own top-level scene-control group. In the
 * suite every feature's tool goes in the one shared `gluniverse` group — gate
 * first, then `ensureSuiteGroup`, per the feature contract.
 */
export function addStreamSceneControl(controls) {
  if (!isDirectorUser()) return;
  const group = ensureSuiteGroup(controls);
  group.tools["stream-control-room"] = {
    name: "stream-control-room",
    title: game.i18n.localize("GLUNIVERSE_STREAM.controls.director"),
    icon: "fas fa-broadcast-tower",
    button: true,
    visible: true,
    onClick: () => openDirectorApp(),
    onChange: () => openDirectorApp()
  };
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class StreamDirectorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  restoreScroll = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-stream-control-room`,
    classes: ["gluniverse-stream-director"],
    tag: "form",
    window: {
      // Not "Stream Director": `features/stage/` already ships a "GLUniverse
      // Stage Director" in the same scene-control group, and two Directors side
      // by side is the one thing a new GM is guaranteed to misread.
      title: "GLUniverse Stream Control Room",
      icon: "fas fa-video"
    },
    position: { width: 720, height: 760 },
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
    return {
      ...(await super._prepareContext(options)),
      status: {
        stream: status ? (status.active ? "Active" : "Inactive") : "No report yet",
        restore: status ? (status.restoreVisible ? "Temporarily visible" : "Hidden") : "No report yet",
        connected: streamConnected,
        stopDisabled: streamActive ? "" : "disabled",
        restoreDisabled: streamActive ? "" : "disabled",
        reframeDisabled: streamActive ? "" : "disabled",
        autoStart: streamUserId && autoStartIds.includes(streamUserId) ? "Enabled" : "Disabled",
        autoStartEnabled: Boolean(streamUserId && autoStartIds.includes(streamUserId)),
        autoStartCanEnable: Boolean(streamUserId && !autoStartIds.includes(streamUserId)),
        scene: canvas?.scene?.name ?? game.i18n.localize("GLUNIVERSE_STREAM.common.none"),
        mode: cameraModeLabel(activeMode),
        combat: getActiveSceneCombat() ? "Yes" : "No"
      },
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
      cardScale: { ...CARD_SCALE_RANGE, percent: Math.round(chat.cardScale * 100) },
      dialog,
      // Sections contributed by sibling features (targeting arcs, roll cards).
      // Empty when neither is enabled, which is what makes this panel work with
      // `stream` alone installed.
      extraSections: await renderPanelSections(),
      // Reading the panel and editing it are different questions: a director
      // whose delegated channel Foundry refused still sees the live shot.
      canEdit: canEditDirectorSettings(),
      canEditAdmin: canEditStreamAdmin(),
      readOnlyNotice: !canEditDirectorSettings() && delegationUnavailable(),
      tokenRows: services.tokenTracking?.getTokenRows() ?? [],
      combatRows: getCombatRows(),
      detectedUi: services.uiDetector?.getEntries() ?? [],
      selectorRules: uiRules.selectorRules,
      outOfCombatModeOptions: optionsFor({
        [CAMERA_MODES.manual]: "Manual/free camera",
        [CAMERA_MODES.scene]: "Scene/full background",
        [CAMERA_MODES.trackedToken]: "Tracked token(s)",
        [CAMERA_MODES.party]: "Party only (visible PCs)"
      }, camera.outOfCombatMode),
      combatModeOptions: optionsFor({
        [CAMERA_MODES.manual]: "Manual/free camera",
        [CAMERA_MODES.scene]: "Scene/full background",
        [CAMERA_MODES.trackedToken]: "Tracked token(s)",
        [CAMERA_MODES.party]: "Party only (visible PCs)",
        [CAMERA_MODES.combatants]: "Visible combatants",
        [CAMERA_MODES.activeTurn]: "Active turn only",
        [CAMERA_MODES.spotlight]: "Spotlight active token"
      }, camera.combatMode),
      sceneViewOptions: optionsFor({
        [SCENE_VIEW_MODES.fitBackground]: "Fit background",
        [SCENE_VIEW_MODES.fillBackground]: "Fill background"
      }, camera.sceneViewMode),
      chatPositionOptions: optionsFor(Object.fromEntries(CHAT_POSITIONS.map(position => [position, labelize(position)])), chat.position)
    };
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
      content: content?.scrollTop ?? 0
    };
    this.restoreScroll = this.restoreScroll
      ? { body: Math.max(this.restoreScroll.body, next.body), content: Math.max(this.restoreScroll.content, next.content) }
      : next;
  }

  #restoreScroll(scroll) {
    const body = this.element?.querySelector(".gluniverse-stream-director-body");
    const content = this.#windowContentElement();
    if (body) body.scrollTop = scroll.body;
    if (content) content.scrollTop = scroll.content;
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
  return getActiveSceneCombat() ? camera.combatMode : camera.outOfCombatMode;
}

function cameraModeLabel(mode) {
  const labels = {
    [CAMERA_MODES.manual]: "Manual/free camera",
    [CAMERA_MODES.scene]: "Scene/full background",
    [CAMERA_MODES.trackedToken]: "Tracked token(s)",
    [CAMERA_MODES.party]: "Party only",
    [CAMERA_MODES.combatants]: "Visible combatants",
    [CAMERA_MODES.activeTurn]: "Active turn only",
    [CAMERA_MODES.spotlight]: "Spotlight active token"
  };
  return labels[mode] ?? mode;
}

function optionsFor(labels, selected) {
  return Object.entries(labels).map(([value, label]) => ({ value, label, selected: value === selected ? "selected" : "" }));
}

function labelize(value) {
  return value.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
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
