import { onSocket, emitSocket } from "../../core/socket.mjs";

const MODULE_ID = "gluniverse-suite";
const FEATURE_ID = "critical";
const FLAG_SCOPE = MODULE_ID;
const SCHEMA_VERSION = 2;
const DURATION_MIN_MS = 600;
const DURATION_MAX_MS = 3e3;
const DURATION_DEFAULT_MS = 1e3;
const EASE_IN_FRACTION = 0.15;
const EASE_OUT_FRACTION = 0.2;
const QUEUE_MAX = 3;
const DEDUPE_WINDOW_MS = 500;
const OVERLAY_Z_INDEX = 99999;
const OVERLAY_CONTAINER_ID = "gls-critical-overlay";
const SETTINGS = {
  GM_AVATAR: "crit.gmAvatar",
  PC_CRITICAL_SFX: "crit.pcCriticalSfx",
  GM_CRITICAL_SFX: "crit.gmCriticalSfx",
  CINEMATIC_DURATION: "crit.cinematicDuration",
  TRIGGER_MODE: "crit.triggerMode",
  ENABLE_SKILL_CRITS: "crit.enableSkillCrits",
  ENABLE_PERCEPTION_CRITS: "crit.enablePerceptionCrits",
  ALLOW_PLAYER_OPT_OUT: "crit.allowPlayerOptOut",
  SHOW_CINEMATICS: "crit.showCinematics",
  AUDIO_ENABLED: "crit.audioEnabled",
  VOLUME: "crit.volume"
};
const TRIGGER_MODES = {
  PF2E_DEGREE_OF_SUCCESS: "pf2e",
  DND5E_CRITICAL_HIT: "dnd5e",
  NAT20_ONLY: "nat20"
};
const ACTOR_FLAGS = {
  SCHEMA_VERSION: "crit.schemaVersion",
  ENABLED: "crit.enabled",
  PORTRAIT_OVERRIDE: "crit.portraitOverride"
};
const LEGACY_ACTOR_FLAG_KEYS = [
  "crit.templateSlug",
  "crit.colorPrimary",
  "crit.colorAccent",
  "crit.colorBg"
];
const PF2E_SYSTEM_ID$1 = "pf2e";
const DND5E_SYSTEM_ID = "dnd5e";
const SUPPORTED_SYSTEM_IDS = [PF2E_SYSTEM_ID$1, DND5E_SYSTEM_ID];
const DND5E_PERCEPTION_SKILL_ID = "prc";
let app = null;
let container = null;
let resizeHandler = null;
function mountOverlay() {
  if (app) return;
  if (typeof PIXI === "undefined") {
    console.warn(`${MODULE_ID} | ${FEATURE_ID} | PIXI not available on globalThis; overlay not mounted.`);
    return;
  }
  container = document.createElement("div");
  container.id = OVERLAY_CONTAINER_ID;
  Object.assign(container.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: String(OVERLAY_Z_INDEX)
  });
  document.body.appendChild(container);
  app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1
  });
  container.appendChild(app.view);
  app.stop();
  resizeHandler = () => {
    if (!app) return;
    app.renderer.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", resizeHandler);
}
function getOverlayApp() {
  return app;
}
const Base$1 = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);
class GMConfigMenu extends Base$1 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-${FEATURE_ID}-gm-config`,
    tag: "form",
    classes: ["gluc-gm-config"],
    window: { title: "GLUC.Settings.MenuName", icon: "fa-solid fa-cog" },
    position: { width: 520, height: "auto" },
    form: {
      handler: GMConfigMenu.#onSubmit,
      closeOnSubmit: true,
      submitOnChange: false
    }
  };
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/features/${FEATURE_ID}/templates/gm-config.html` }
  };
  async _prepareContext() {
    return {
      data: {
        gmAvatar: getSetting(SETTINGS.GM_AVATAR),
        pcCriticalSfx: getSetting(SETTINGS.PC_CRITICAL_SFX),
        gmCriticalSfx: getSetting(SETTINGS.GM_CRITICAL_SFX),
        cinematicDuration: getSetting(SETTINGS.CINEMATIC_DURATION)
      },
      durationMin: DURATION_MIN_MS,
      durationMax: DURATION_MAX_MS
    };
  }
  static async #onSubmit(_event, _form, formData) {
    const data = formData.object;
    await Promise.all([
      setSetting(SETTINGS.GM_AVATAR, String(data.gmAvatar ?? "")),
      setSetting(SETTINGS.PC_CRITICAL_SFX, String(data.pcCriticalSfx ?? "")),
      setSetting(SETTINGS.GM_CRITICAL_SFX, String(data.gmCriticalSfx ?? "")),
      setSetting(SETTINGS.CINEMATIC_DURATION, Number(data.cinematicDuration))
    ]);
  }
}
function triggerModeConfig() {
  if (game.system.id === DND5E_SYSTEM_ID) {
    return {
      choices: {
        [TRIGGER_MODES.DND5E_CRITICAL_HIT]: "GLUC.Settings.TriggerModeChoiceDnd5e",
        [TRIGGER_MODES.NAT20_ONLY]: "GLUC.Settings.TriggerModeChoiceNat20"
      },
      default: TRIGGER_MODES.DND5E_CRITICAL_HIT
    };
  }
  return {
    choices: {
      [TRIGGER_MODES.PF2E_DEGREE_OF_SUCCESS]: "GLUC.Settings.TriggerModeChoicePF2e",
      [TRIGGER_MODES.NAT20_ONLY]: "GLUC.Settings.TriggerModeChoiceNat20"
    },
    default: TRIGGER_MODES.PF2E_DEGREE_OF_SUCCESS
  };
}
function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "crit.gmConfigMenu", {
    name: "GLUC.Settings.MenuName",
    label: "GLUC.Settings.MenuLabel",
    hint: "GLUC.Settings.MenuHint",
    icon: "fas fa-cog",
    type: GMConfigMenu,
    restricted: true
  });
  game.settings.register(MODULE_ID, SETTINGS.GM_AVATAR, {
    name: "GLUC.Settings.GMAvatar",
    hint: "GLUC.Settings.GMAvatarHint",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register(MODULE_ID, SETTINGS.PC_CRITICAL_SFX, {
    name: "GLUC.Settings.PCCriticalSFX",
    hint: "GLUC.Settings.PCCriticalSFXHint",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register(MODULE_ID, SETTINGS.GM_CRITICAL_SFX, {
    name: "GLUC.Settings.GMCriticalSFX",
    hint: "GLUC.Settings.GMCriticalSFXHint",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register(MODULE_ID, SETTINGS.CINEMATIC_DURATION, {
    name: "GLUC.Settings.CinematicDuration",
    hint: "GLUC.Settings.CinematicDurationHint",
    scope: "world",
    config: false,
    type: Number,
    default: DURATION_DEFAULT_MS,
    range: { min: DURATION_MIN_MS, max: DURATION_MAX_MS, step: 50 }
  });
  const triggerMode = triggerModeConfig();
  game.settings.register(MODULE_ID, SETTINGS.TRIGGER_MODE, {
    name: "GLUC.Settings.TriggerMode",
    hint: "GLUC.Settings.TriggerModeHint",
    scope: "world",
    config: true,
    type: String,
    choices: triggerMode.choices,
    default: triggerMode.default
  });
  game.settings.register(MODULE_ID, SETTINGS.ENABLE_SKILL_CRITS, {
    name: "GLUC.Settings.EnableSkillCrits",
    hint: "GLUC.Settings.EnableSkillCritsHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.ENABLE_PERCEPTION_CRITS, {
    name: "GLUC.Settings.EnablePerceptionCrits",
    hint: "GLUC.Settings.EnablePerceptionCritsHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, SETTINGS.ALLOW_PLAYER_OPT_OUT, {
    name: "GLUC.Settings.AllowPlayerOptOut",
    hint: "GLUC.Settings.AllowPlayerOptOutHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.SHOW_CINEMATICS, {
    name: "GLUC.Settings.ShowCinematics",
    hint: "GLUC.Settings.ShowCinematicsHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.AUDIO_ENABLED, {
    name: "GLUC.Settings.AudioEnabled",
    hint: "GLUC.Settings.AudioEnabledHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.VOLUME, {
    name: "GLUC.Settings.Volume",
    hint: "GLUC.Settings.VolumeHint",
    scope: "client",
    config: true,
    type: Number,
    default: 0.8,
    range: { min: 0, max: 1, step: 0.05 }
  });
}
function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}
const audioCache = /* @__PURE__ */ new Map();
function playSfx(kind) {
  if (!getSetting(SETTINGS.AUDIO_ENABLED)) return;
  const path = getSetting(
    kind === "pc" ? SETTINGS.PC_CRITICAL_SFX : SETTINGS.GM_CRITICAL_SFX
  );
  if (!path) return;
  let el = audioCache.get(path);
  if (!el) {
    el = new Audio(path);
    el.preload = "auto";
    audioCache.set(path, el);
  }
  const volume = clamp01(getSetting(SETTINGS.VOLUME));
  const globalVolume = readGlobalInterfaceVolume();
  el.volume = clamp01(volume * globalVolume);
  el.currentTime = 0;
  el.play().catch((err) => {
    console.warn(`${MODULE_ID} | ${FEATURE_ID} | sfx play failed:`, err);
  });
}
function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function readGlobalInterfaceVolume() {
  try {
    const v = game.settings.get("core", "globalInterfaceVolume");
    if (typeof v === "number") return clamp01(v);
  } catch {
  }
  return 1;
}
const FALLBACK_IMAGE$1 = "icons/svg/mystery-man.svg";
const BG_FADE_IN_FRACTION = 0.2;
const BG_FADE_OUT_FRACTION = 0.28;
const BG_PEAK_ALPHA = 0.85;
async function runCinematic(event) {
  const app2 = getOverlayApp();
  if (!app2) {
    console.warn(`${MODULE_ID} | ${FEATURE_ID} | no overlay app; skipping cinematic`);
    return;
  }
  const texture = await loadImage(event.imagePath);
  if (!texture) {
    console.warn(`${MODULE_ID} | ${FEATURE_ID} | could not load image:`, event.imagePath);
    return;
  }
  const stage = new PIXI.Container();
  app2.stage.addChild(stage);
  const { sw, sh } = screenSize();
  const backdrop = new PIXI.Graphics();
  backdrop.beginFill(0, 1).drawRect(0, 0, sw, sh).endFill();
  backdrop.alpha = 0;
  stage.addChild(backdrop);
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.position.set(sw * 0.5, sh * 0.5);
  const baseScale = aspectFitScale(texture, sw, sh);
  sprite.scale.set(baseScale);
  sprite.alpha = 0;
  stage.addChild(sprite);
  const tw = texture.baseTexture?.realWidth ?? texture.width ?? 0;
  const th = texture.baseTexture?.realHeight ?? texture.height ?? 0;
  const fitW = tw * baseScale;
  const fitH = th * baseScale;
  const mask = new PIXI.Graphics();
  stage.addChild(mask);
  sprite.mask = mask;
  const drawMask = (frac) => {
    const clamped = Math.max(0, Math.min(1, frac));
    const h = fitH * clamped;
    const x = sw * 0.5 - fitW * 0.5;
    const y = sh * 0.5 - h * 0.5;
    mask.clear().beginFill(16777215, 1).drawRect(x, y, fitW, h).endFill();
  };
  drawMask(0);
  playSfx(event.isPC ? "pc" : "gm");
  app2.start();
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / event.durationMs);
      const frame = animate(t);
      backdrop.alpha = frame.bgAlpha;
      sprite.alpha = frame.imgAlpha;
      sprite.scale.set(baseScale * frame.scaleMul);
      drawMask(frame.wipe);
      if (t >= 1) {
        app2.ticker.remove(tick);
        resolve();
      }
    };
    app2.ticker.add(tick);
  });
  sprite.mask = null;
  stage.removeChildren();
  app2.stage.removeChildren();
  sprite.destroy?.({ children: true });
  backdrop.destroy?.({ children: true });
  mask.destroy?.({ children: true });
  stage.destroy?.({ children: true });
  app2.stop();
}
const HOLD_DRIFT = 0.04;
const OUT_SCALE_BOOST = 0.16;
function animate(t) {
  let bgAlpha;
  if (t < BG_FADE_IN_FRACTION) {
    bgAlpha = easeOutCubic(t / BG_FADE_IN_FRACTION) * BG_PEAK_ALPHA;
  } else if (t > 1 - BG_FADE_OUT_FRACTION) {
    const k = (t - (1 - BG_FADE_OUT_FRACTION)) / BG_FADE_OUT_FRACTION;
    bgAlpha = BG_PEAK_ALPHA * (1 - easeInCubic(k));
  } else {
    bgAlpha = BG_PEAK_ALPHA;
  }
  let imgAlpha = 1;
  let scaleMul = 1;
  let wipe = 1;
  if (t < EASE_IN_FRACTION) {
    const k = t / EASE_IN_FRACTION;
    imgAlpha = easeOutCubic(k);
    scaleMul = 0.92 + 0.08 * easeOutQuint(k);
    wipe = easeOutQuart(k);
  } else if (t > 1 - EASE_OUT_FRACTION) {
    const k = (t - (1 - EASE_OUT_FRACTION)) / EASE_OUT_FRACTION;
    imgAlpha = 1 - easeInCubic(k);
    scaleMul = 1 + HOLD_DRIFT + OUT_SCALE_BOOST * easeOutCubic(k);
  } else {
    const holdLen = 1 - EASE_IN_FRACTION - EASE_OUT_FRACTION;
    const k = (t - EASE_IN_FRACTION) / holdLen;
    scaleMul = 1 + HOLD_DRIFT * easeInOutSine(k);
  }
  return { bgAlpha, imgAlpha, scaleMul, wipe };
}
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}
function easeInCubic(t) {
  return t ** 3;
}
function easeOutQuart(t) {
  return 1 - (1 - t) ** 4;
}
function easeOutQuint(t) {
  return 1 - (1 - t) ** 5;
}
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
function screenSize() {
  return { sw: window.innerWidth, sh: window.innerHeight };
}
function aspectFitScale(texture, sw, sh) {
  const tw = texture.baseTexture?.realWidth ?? texture.width ?? 0;
  const th = texture.baseTexture?.realHeight ?? texture.height ?? 0;
  if (!tw || !th) return 1;
  return Math.min(sw / tw, sh / th);
}
async function loadImage(src) {
  try {
    const namespaced = globalThis.foundry?.canvas?.loadTexture;
    const fromGlobal = namespaced ?? globalThis.loadTexture;
    if (typeof fromGlobal === "function") {
      const t = await fromGlobal(src, { fallback: FALLBACK_IMAGE$1 });
      if (t) return t;
    }
    if (typeof PIXI?.Texture?.from === "function") {
      return PIXI.Texture.from(src);
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | ${FEATURE_ID} | image load failed:`, src, err);
  }
  return null;
}
const queue = [];
const recentMessages = /* @__PURE__ */ new Map();
let playing = false;
function enqueue(event) {
  if (!getSetting(SETTINGS.SHOW_CINEMATICS)) return;
  const now = performance.now();
  const seen = recentMessages.get(event.messageId);
  if (seen !== void 0 && now - seen < DEDUPE_WINDOW_MS) return;
  recentMessages.set(event.messageId, now);
  pruneSeen(now);
  if (queue.length >= QUEUE_MAX) {
    const dropped = queue.shift();
    console.debug(`${MODULE_ID} | ${FEATURE_ID} | queue full, dropped:`, dropped?.event.messageId);
  }
  queue.push({ event, enqueuedAt: now });
  if (!playing) void drain();
}
async function drain() {
  if (playing) return;
  playing = true;
  try {
    while (queue.length > 0) {
      const slot = queue.shift();
      if (!slot) break;
      try {
        await runCinematic(slot.event);
      } catch (err) {
        console.error(`${MODULE_ID} | ${FEATURE_ID} | cinematic failed:`, err);
      }
    }
  } finally {
    playing = false;
  }
}
function pruneSeen(now) {
  for (const [id, ts] of recentMessages) {
    if (now - ts > DEDUPE_WINDOW_MS * 4) recentMessages.delete(id);
  }
}
const FALLBACK_IMAGE = "icons/svg/mystery-man.svg";
function resolveCritEvent(input) {
  const actor = game.actors.get(input.actorId);
  if (!actor) return null;
  return {
    messageId: input.messageId,
    actorId: input.actorId,
    actorName: actor.name ?? "Unknown",
    isPC: input.isPC,
    imagePath: resolveImage(actor, input.isPC),
    durationMs: getSetting(SETTINGS.CINEMATIC_DURATION),
    startTimestamp: Date.now(),
    originUserId: input.originUserId
  };
}
function resolveImage(actor, isPC) {
  const override = actor.getFlag(FLAG_SCOPE, ACTOR_FLAGS.PORTRAIT_OVERRIDE);
  if (override) return override;
  if (isPC) return actor.img ?? FALLBACK_IMAGE;
  const gmAvatar = getSetting(SETTINGS.GM_AVATAR);
  if (gmAvatar) return gmAvatar;
  return actor.img ?? FALLBACK_IMAGE;
}
function registerSockets() {
  onSocket(FEATURE_ID, (raw) => {
    const payload = raw;
    if (!payload || payload.type !== "critical") return;
    if (payload.event.originUserId === game.user.id) return;
    enqueue(payload.event);
  });
  console.debug(`${MODULE_ID} | ${FEATURE_ID} | socket listener registered`);
}
function broadcastCrit(event) {
  emitSocket(FEATURE_ID, { type: "critical", event });
}
function activeResults(die) {
  const results = die.results ?? [];
  return results.filter((r) => r.discarded !== true && r.active !== false);
}
function hasNat20Result(message) {
  const rolls = message.rolls;
  if (!Array.isArray(rolls)) return false;
  for (const roll of rolls) {
    const dice = roll.dice;
    if (!Array.isArray(dice)) continue;
    for (const die of dice) {
      if (die.faces !== 20) continue;
      if (activeResults(die).some((r) => r.result === 20)) return true;
    }
  }
  return false;
}
function getAttackCriticalHit(message) {
  const rolls = message.rolls;
  if (!Array.isArray(rolls)) return void 0;
  let sawD20 = false;
  for (const roll of rolls) {
    if (roll.isCritical === true) return true;
    const dice = roll.dice;
    if (!Array.isArray(dice)) continue;
    for (const die of dice) {
      if (die.faces !== 20) continue;
      sawD20 = true;
      const threshold = die.options?.criticalSuccess ?? 20;
      if (activeResults(die).some((r) => typeof r.result === "number" && r.result >= threshold)) {
        return true;
      }
    }
  }
  return sawD20 ? false : void 0;
}
const NEVER_FIRES = /* @__PURE__ */ new Set(["damage", "initiative"]);
function isPerceptionSkill(skillId) {
  return skillId === DND5E_PERCEPTION_SKILL_ID || skillId === "perception";
}
function detectDnd5e(input) {
  if (input.systemId !== DND5E_SYSTEM_ID) return { fire: false, reason: "wrong-system" };
  if (input.rollMode === "blindroll" || input.blind) {
    return { fire: false, reason: "secret-or-blind-roll" };
  }
  if (!input.hasActor) return { fire: false, reason: "no-actor" };
  if (input.triggerMode === "nat20") {
    if (!input.nat20Detected) return { fire: false, reason: "not-nat20" };
    if (!input.actorHasPlayerOwner && !input.npcEnabled) {
      return { fire: false, reason: "npc-not-enabled" };
    }
    return { fire: true, reason: "nat20" };
  }
  const roll = input.dnd5eRoll;
  const type = roll?.type;
  if (!type) return { fire: false, reason: "no-context" };
  if (NEVER_FIRES.has(type)) {
    return { fire: false, reason: "damage-or-initiative-blocked" };
  }
  let fireReason;
  if (type === "attack") {
    const isCrit = input.criticalHit ?? input.nat20Detected;
    if (!isCrit) return { fire: false, reason: "not-critical-hit" };
    fireReason = "dnd5e-critical-hit";
  } else if (type === "skill" || type === "tool") {
    if (type === "skill" && isPerceptionSkill(roll?.skillId)) {
      if (!input.perceptionCritsEnabled) {
        return { fire: false, reason: "perception-crits-disabled" };
      }
    } else if (!input.skillCritsEnabled) {
      return { fire: false, reason: "skill-crits-disabled" };
    }
    if (!input.nat20Detected) return { fire: false, reason: "not-critical-hit" };
    fireReason = "nat20";
  } else if (type === "ability") {
    if (!input.skillCritsEnabled) return { fire: false, reason: "skill-crits-disabled" };
    if (!input.nat20Detected) return { fire: false, reason: "not-critical-hit" };
    fireReason = "nat20";
  } else if (type === "save" || type === "death") {
    if (!input.nat20Detected) return { fire: false, reason: "not-critical-hit" };
    fireReason = "nat20";
  } else {
    return { fire: false, reason: "unsupported-roll-type" };
  }
  if (!input.actorHasPlayerOwner && !input.npcEnabled) {
    return { fire: false, reason: "npc-not-enabled" };
  }
  return { fire: true, reason: fireReason };
}
function buildInputFromMessage$1(message) {
  const actorId = message.speaker?.actor;
  const actor = actorId ? game.actors.get(actorId) : void 0;
  const rollFlag = message.flags?.dnd5e?.roll ?? null;
  return {
    systemId: game.system.id,
    context: null,
    dnd5eRoll: rollFlag ? { type: rollFlag.type, skillId: rollFlag.skillId, ability: rollFlag.ability } : null,
    criticalHit: getAttackCriticalHit(message),
    rollMode: message.rollMode ?? "publicroll",
    whisperLength: message.whisper?.length ?? 0,
    blind: message.blind ?? false,
    hasActor: !!actor,
    actorHasPlayerOwner: actor?.hasPlayerOwner ?? false,
    npcEnabled: actor ? actor.getFlag(FLAG_SCOPE, ACTOR_FLAGS.ENABLED) ?? false : false,
    triggerMode: getSetting(SETTINGS.TRIGGER_MODE),
    nat20Detected: hasNat20Result(message),
    skillCritsEnabled: getSetting(SETTINGS.ENABLE_SKILL_CRITS),
    perceptionCritsEnabled: getSetting(SETTINGS.ENABLE_PERCEPTION_CRITS)
  };
}
const dnd5eAdapter = {
  systemId: DND5E_SYSTEM_ID,
  buildInput: buildInputFromMessage$1,
  detect: detectDnd5e
};
const SUPPORTED_ROLL_TYPES = /* @__PURE__ */ new Set([
  "attack-roll",
  "spell-attack-roll",
  "saving-throw",
  "skill-check",
  "perception-check"
]);
const HARD_BLOCK = /* @__PURE__ */ new Set(["flat-check", "damage-roll", "initiative"]);
const PF2E_SYSTEM_ID = "pf2e";
function detect(input) {
  if (input.systemId !== PF2E_SYSTEM_ID) return { fire: false, reason: "wrong-system" };
  if (input.rollMode === "blindroll" || input.blind) {
    return { fire: false, reason: "secret-or-blind-roll" };
  }
  if (!input.hasActor) return { fire: false, reason: "no-actor" };
  if (input.triggerMode === "nat20") {
    if (!input.nat20Detected) return { fire: false, reason: "not-nat20" };
    if (!input.actorHasPlayerOwner && !input.npcEnabled) {
      return { fire: false, reason: "npc-not-enabled" };
    }
    return { fire: true, reason: "nat20" };
  }
  if (!input.context) return { fire: false, reason: "no-context" };
  const type = input.context.type;
  if (!type) return { fire: false, reason: "no-context" };
  if (HARD_BLOCK.has(type)) {
    return {
      fire: false,
      reason: type === "flat-check" ? "flat-check-blocked" : "damage-or-initiative-blocked"
    };
  }
  if (!SUPPORTED_ROLL_TYPES.has(type)) {
    return { fire: false, reason: "unsupported-roll-type" };
  }
  const isCriticalSuccess = input.context.outcome === "criticalSuccess";
  const isUngradedNat20 = !input.context.outcome && input.nat20Detected;
  if (!isCriticalSuccess && !isUngradedNat20) {
    return { fire: false, reason: "not-critical-success" };
  }
  if (type === "skill-check" && !input.skillCritsEnabled) {
    return { fire: false, reason: "skill-crits-disabled" };
  }
  if (type === "perception-check" && !input.perceptionCritsEnabled) {
    return { fire: false, reason: "perception-crits-disabled" };
  }
  if (!input.actorHasPlayerOwner && !input.npcEnabled) {
    return { fire: false, reason: "npc-not-enabled" };
  }
  return { fire: true, reason: isCriticalSuccess ? "pf2e-critical-success" : "nat20" };
}
function buildInputFromMessage(message) {
  const actorId = message.speaker?.actor;
  const actor = actorId ? game.actors.get(actorId) : void 0;
  return {
    systemId: game.system.id,
    context: message.flags?.pf2e?.context ?? null,
    dnd5eRoll: null,
    rollMode: message.rollMode ?? "publicroll",
    whisperLength: message.whisper?.length ?? 0,
    blind: message.blind ?? false,
    hasActor: !!actor,
    actorHasPlayerOwner: actor?.hasPlayerOwner ?? false,
    npcEnabled: actor ? actor.getFlag(FLAG_SCOPE, ACTOR_FLAGS.ENABLED) ?? false : false,
    triggerMode: getSetting(SETTINGS.TRIGGER_MODE),
    nat20Detected: hasNat20Result(message),
    skillCritsEnabled: getSetting(SETTINGS.ENABLE_SKILL_CRITS),
    perceptionCritsEnabled: getSetting(SETTINGS.ENABLE_PERCEPTION_CRITS)
  };
}
const pf2eAdapter = {
  systemId: PF2E_SYSTEM_ID$1,
  buildInput: buildInputFromMessage,
  detect
};
const ADAPTERS = [pf2eAdapter, dnd5eAdapter];
function getAdapter(systemId) {
  return ADAPTERS.find((a) => a.systemId === systemId);
}
let lastDiceSoNiceMessageId = null;
let lastDiceSoNiceTimestamp = 0;
function registerDetector() {
  const adapter = getAdapter(game.system.id);
  if (!adapter) return;
  const dsnActive = !!game.dice3d;
  if (dsnActive) {
    Hooks.on("diceSoNiceRollComplete", (messageId) => {
      const id = messageId;
      lastDiceSoNiceMessageId = id;
      lastDiceSoNiceTimestamp = performance.now();
      const message = getChatMessageById(id);
      if (message) processMessage(adapter, message);
    });
  }
  Hooks.on("createChatMessage", (raw) => {
    const message = raw;
    if (dsnActive && message.id && lastDiceSoNiceMessageId === message.id && performance.now() - lastDiceSoNiceTimestamp < 5e3) {
      return;
    }
    if (!dsnActive) processMessage(adapter, message);
  });
}
function getChatMessageById(messageId) {
  const fromCollection = game.messages?.get(messageId);
  if (fromCollection) return fromCollection;
  const ChatMessage = globalThis.ChatMessage;
  return ChatMessage?.get(messageId);
}
function messageAuthorId(message) {
  return message.author?.id ?? (typeof message.user === "string" ? message.user : message.user?.id);
}
function looksLikeCrit(input) {
  return input.context?.outcome === "criticalSuccess" || input.criticalHit === true || input.nat20Detected;
}
function processMessage(adapter, message) {
  if (messageAuthorId(message) !== game.user.id) return;
  const input = adapter.buildInput(message);
  const result = adapter.detect(input);
  if (!result.fire) {
    if (looksLikeCrit(input)) {
      console.debug(`${MODULE_ID} | ${FEATURE_ID} | crit suppressed:`, result.reason);
    }
    return;
  }
  const event = resolveCritEvent({
    messageId: message.id ?? `${Date.now()}-${Math.random()}`,
    actorId: message.speaker?.actor ?? "",
    isPC: input.actorHasPlayerOwner,
    originUserId: game.user.id
  });
  if (!event) return;
  enqueue(event);
  if (input.whisperLength === 0 && input.rollMode === "publicroll") {
    broadcastCrit(event);
  }
}
function readActorFlags(actor) {
  return {
    schemaVersion: actor.getFlag(FLAG_SCOPE, ACTOR_FLAGS.SCHEMA_VERSION) ?? 0,
    enabled: actor.getFlag(FLAG_SCOPE, ACTOR_FLAGS.ENABLED) ?? false,
    portraitOverride: actor.getFlag(FLAG_SCOPE, ACTOR_FLAGS.PORTRAIT_OVERRIDE) ?? null
  };
}
async function writeActorFlags(actor, patch) {
  const writes = [];
  if (patch.schemaVersion !== void 0) {
    writes.push(actor.setFlag(FLAG_SCOPE, ACTOR_FLAGS.SCHEMA_VERSION, patch.schemaVersion));
  }
  if (patch.enabled !== void 0) {
    writes.push(actor.setFlag(FLAG_SCOPE, ACTOR_FLAGS.ENABLED, patch.enabled));
  }
  if (patch.portraitOverride !== void 0) {
    writes.push(actor.setFlag(FLAG_SCOPE, ACTOR_FLAGS.PORTRAIT_OVERRIDE, patch.portraitOverride));
  }
  await Promise.all(writes);
}
function migrateActorFlags(actor) {
  const current = actor.getFlag(FLAG_SCOPE, ACTOR_FLAGS.SCHEMA_VERSION) ?? 0;
  if (current === SCHEMA_VERSION) return null;
  return (async () => {
    if (current < 2) {
      for (const key of LEGACY_ACTOR_FLAG_KEYS) {
        const v = actor.getFlag(FLAG_SCOPE, key);
        if (v !== void 0) await actor.unsetFlag(FLAG_SCOPE, key);
      }
    }
    await actor.setFlag(FLAG_SCOPE, ACTOR_FLAGS.SCHEMA_VERSION, SCHEMA_VERSION);
  })();
}
async function runMigrations() {
  const actors = game.actors?.contents ?? (game.actors?.values ? [...game.actors.values()] : []);
  if (!actors.length) return;
  const pending = [];
  for (const actor of actors) {
    const job = migrateActorFlags(actor);
    if (job) pending.push(job);
  }
  if (pending.length) {
    console.log(`${MODULE_ID} | ${FEATURE_ID} | Migrating ${pending.length} actor flag record(s)`);
    await Promise.all(pending);
  }
}
function buildManualEvent(actorId) {
  const actor = game.actors.get(actorId);
  const isPC = actor?.hasPlayerOwner ?? true;
  return resolveCritEvent({
    messageId: `manual-${Date.now()}`,
    actorId,
    isPC,
    originUserId: game.user.id
  });
}
function createPublicAPI(version) {
  return {
    version,
    async triggerLocal(actorId) {
      const event = buildManualEvent(actorId);
      if (!event) return;
      await runCinematic(event);
    },
    async triggerBroadcast(actorId) {
      if (!game.user.isGM) {
        console.warn(`${MODULE_ID} | ${FEATURE_ID} | triggerBroadcast is GM-only; ignoring call.`);
        return;
      }
      const event = buildManualEvent(actorId);
      if (!event) return;
      broadcastCrit(event);
      await runCinematic(event);
    }
  };
}
const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);
class ActorConfigModal extends Base {
  #actor;
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-${FEATURE_ID}-actor-config`,
    tag: "form",
    classes: ["gluc-actor-config"],
    window: { title: "GLUC.Actor.HeaderButton", icon: "fa-solid fa-bolt" },
    position: { width: 480, height: "auto" },
    form: {
      handler: ActorConfigModal.#onSubmit,
      closeOnSubmit: true,
      submitOnChange: false
    },
    actions: {
      test: ActorConfigModal.#onTest,
      broadcast: ActorConfigModal.#onBroadcast
    }
  };
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/features/${FEATURE_ID}/templates/actor-config.html` }
  };
  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
  }
  get actor() {
    return this.#actor;
  }
  /**
   * Always operate on the world (base) actor, not a synthetic token-actor.
   * Synthetic actors write flags to the token's delta — those overrides
   * are invisible to the detector, which resolves speakers via
   * `game.actors.get(speaker.actor)` (always the base).
   */
  get #baseActor() {
    const a = this.#actor;
    return game.actors.get(a.id) ?? a;
  }
  get title() {
    const isNPC = !this.#actor.hasPlayerOwner;
    const key = isNPC ? "GLUC.Actor.ModalTitleNPC" : "GLUC.Actor.ModalTitlePC";
    return game.i18n.format(key, { name: this.#actor.name ?? "Actor" });
  }
  async _prepareContext() {
    const flags = readActorFlags(this.#baseActor);
    const isNPC = !this.#actor.hasPlayerOwner;
    return {
      isNPC,
      isGM: game.user.isGM,
      data: {
        enabled: flags.enabled ?? false,
        portraitOverride: flags.portraitOverride ?? ""
      }
    };
  }
  static async #onSubmit(_event, _form, formData) {
    const base = this.#baseActor;
    const isNPC = !base.hasPlayerOwner;
    const data = formData.object;
    const enabled = isNPC ? Boolean(data.enabled) : true;
    await writeActorFlags(base, {
      enabled,
      portraitOverride: String(data.portraitOverride ?? "") || null
    });
  }
  static #onTest() {
    void this.#runTest(false);
  }
  static #onBroadcast() {
    void this.#runTest(true);
  }
  async #runTest(broadcast) {
    const base = this.#baseActor;
    const event = resolveCritEvent({
      messageId: `${broadcast ? "manual" : "test"}-${Date.now()}`,
      actorId: base.id,
      isPC: base.hasPlayerOwner,
      originUserId: game.user.id
    });
    if (!event) return;
    if (broadcast) broadcastCrit(event);
    try {
      await runCinematic(event);
    } catch (err) {
      console.error(`${MODULE_ID} | ${FEATURE_ID} | ${broadcast ? "broadcast" : "test"} cinematic failed:`, err);
    }
  }
}
const ACTION = `${MODULE_ID}-${FEATURE_ID}-open-config`;
const HEADER_BTN_CLASS = `${MODULE_ID}-${FEATURE_ID}-header-btn`;
const WIRED_ATTR = "glucWired";
function canConfigure(actor) {
  return Boolean(actor.isOwner) || game.user.isGM;
}
function openConfig(actor, event) {
  event?.preventDefault();
  event?.stopPropagation();
  new ActorConfigModal(actor).render(true);
}
const TIDY_MODULE_ID = "tidy5e-sheet";
function isTidySheet(app2) {
  const a = app2;
  if (a?.constructor?.name?.includes("Tidy")) return true;
  const classes = a?.options?.classes;
  return Array.isArray(classes) && classes.includes(TIDY_MODULE_ID);
}
function getTidyApi() {
  return game.modules?.get(TIDY_MODULE_ID)?.api;
}
let tidyControlsRegistered = false;
function registerTidyHeaderControls(api) {
  if (tidyControlsRegistered || typeof api?.registerActorHeaderControls !== "function") return;
  tidyControlsRegistered = true;
  api.registerActorHeaderControls({
    controls: [
      {
        icon: "fa-solid fa-bolt",
        // Tidy localizes header-control labels; passing the already-localized
        // string is a no-op if it tries again, so this is safe either way.
        label: game.i18n.localize("GLUC.Actor.HeaderButton"),
        position: "header",
        visible() {
          const actor = this?.document ?? this?.actor;
          return !!actor && canConfigure(actor);
        },
        onClickAction(event) {
          const actor = this?.document ?? this?.actor;
          if (actor) openConfig(actor, event);
        }
      }
    ]
  });
}
function registerActorSheetHooks() {
  registerTidyHeaderControls(getTidyApi());
  Hooks.once("tidy5e-sheet.ready", (api) => registerTidyHeaderControls(api));
  Hooks.on("getActorSheetHeaderButtons", (app2, buttons) => {
    const actor = app2.actor ?? app2.document;
    if (!actor) return;
    if (!canConfigure(actor)) return;
    if (buttons.some((b) => b.class === HEADER_BTN_CLASS)) return;
    buttons.unshift({
      class: HEADER_BTN_CLASS,
      icon: "fa-solid fa-bolt",
      label: game.i18n.localize("GLUC.Actor.HeaderButton"),
      onclick: (event) => openConfig(actor, event)
    });
  });
  Hooks.on(
    "getHeaderControlsActorSheetV2",
    (app2, controls) => {
      if (isTidySheet(app2)) return;
      const actor = app2.actor ?? app2.document;
      if (!actor) return;
      if (!canConfigure(actor)) return;
      if (controls.some((c) => c.action === ACTION)) return;
      controls.push({
        action: ACTION,
        icon: "fa-solid fa-bolt",
        label: "GLUC.Actor.HeaderButton",
        visible: true
      });
    }
  );
  Hooks.on("renderActorSheetV2", (sheet, element) => {
    if (isTidySheet(sheet)) return;
    const actor = sheet.actor ?? sheet.document;
    if (!actor) return;
    if (!canConfigure(actor)) return;
    const existing = element.querySelector(`[data-action="${ACTION}"]`);
    if (existing) {
      if (existing.dataset[WIRED_ATTR] !== "1") {
        existing.dataset[WIRED_ATTR] = "1";
        existing.addEventListener("click", (event) => openConfig(actor, event));
      }
      return;
    }
    const header = element.querySelector(".window-header");
    if (!header || header.querySelector(`.${HEADER_BTN_CLASS}`)) return;
    const label = game.i18n.localize("GLUC.Actor.HeaderButton");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `header-control icon fa-solid fa-bolt ${HEADER_BTN_CLASS}`;
    btn.dataset.action = ACTION;
    btn.dataset[WIRED_ATTR] = "1";
    btn.dataset.tooltip = label;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", (event) => openConfig(actor, event));
    const closeBtn = header.querySelector('[data-action="close"]');
    if (closeBtn) header.insertBefore(btn, closeBtn);
    else header.appendChild(btn);
  });
}
function isSupportedSystem() {
  return SUPPORTED_SYSTEM_IDS.includes(game.system.id);
}

/**
 * Suite lifecycle: settings registration. Always runs at init so the toggles
 * and the GM config menu exist even when the feature is disabled.
 */
export function featureRegisterSettings() {
  registerSettings();
}

/**
 * Suite lifecycle: init phase. Runs only when the feature is enabled & the
 * system is supported. Registers Foundry hooks; nothing happens at import time.
 */
export function onInit() {
  if (!isSupportedSystem()) {
    console.warn(
      `${MODULE_ID} | ${FEATURE_ID} | Unsupported system detected (${game.system.id}). Supported systems: ${SUPPORTED_SYSTEM_IDS.join(", ")}. Feature disabled.`
    );
    return;
  }
  console.log(`${MODULE_ID} | ${FEATURE_ID} | init (system: ${game.system.id})`);
  registerDetector();
  registerActorSheetHooks();
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api ??= {};
    mod.api.features ??= {};
    mod.api.features[FEATURE_ID] = createPublicAPI(mod.version);
  }
}

/**
 * Suite lifecycle: ready phase. Runs only when enabled & available. Mounts the
 * overlay, wires the socket handler, and runs actor-flag migrations.
 */
export async function onReady() {
  if (!isSupportedSystem()) return;
  console.log(`${MODULE_ID} | ${FEATURE_ID} | ready`);
  await runMigrations();
  mountOverlay();
  registerSockets();
}

export { createPublicAPI };
