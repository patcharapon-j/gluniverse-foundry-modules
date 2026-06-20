import {
  FACE_NUMBERS,
  FATE_KINDS,
  FATE_PRESETS,
  FEATURE_ID,
  KIND_ALIASES,
  KIND_BLANK,
  KIND_OPPORTUNITY,
  MODULE_ID,
  PRESET_AEGIS_FALLEN,
  PRESET_DEFAULT,
  PRESET_FATE_FACES,
  PRESET_TIDES_OF_DESTINY,
} from "./constants.mjs";

// Every setting key registered under the shared suite namespace is prefixed
// with this so destiny-dice keys never collide with other features' keys.
export const DD_PREFIX = "dd.";

export const SETTINGS = {
  preset: `${DD_PREFIX}preset`,
  emissiveIntensity: `${DD_PREFIX}emissiveIntensity`,
  motionTier: `${DD_PREFIX}motionTier`,
};

// Motion tiers (§6.4). `prefers-reduced-motion` force-clamps to "reduced".
export const MOTION_TIERS = ["reduced", "default", "cinematic"];
export const MOTION_TIER_DEFAULT = "default";

const MOTION_TIER_CHOICES = {
  reduced: "GLDDF.Settings.MotionTier.Reduced",
  default: "GLDDF.Settings.MotionTier.Default",
  cinematic: "GLDDF.Settings.MotionTier.Cinematic",
};

export const EMISSIVE_INTENSITY_DEFAULT = 1.0;
export const EMISSIVE_INTENSITY_MIN = 0;
export const EMISSIVE_INTENSITY_MAX = 2;
export const EMISSIVE_INTENSITY_STEP = 0.05;

for (const face of FACE_NUMBERS) {
  SETTINGS[`face${face}Kind`] = `${DD_PREFIX}face${face}Kind`;
  SETTINGS[`face${face}Bonus`] = `${DD_PREFIX}face${face}Bonus`;
  SETTINGS[`face${face}Image`] = `${DD_PREFIX}face${face}Image`;
}

// Map old loose filenames the previous version stored to a current asset path.
const LEGACY_FACE_IMAGE_PATHS = {
  "tyranny-4": PRESET_FATE_FACES[PRESET_DEFAULT][1].image,
  "tyranny-2": PRESET_FATE_FACES[PRESET_DEFAULT][2].image,
  defiance: PRESET_FATE_FACES[PRESET_DEFAULT][5].image,
  "defiance-2": PRESET_FATE_FACES[PRESET_DEFAULT][5].image,
};

// Set of paths that are "built-in" defaults for any preset — used to decide
// whether a stored image setting is a customization or just an old default.
const BUILTIN_IMAGE_PATHS = new Set();
for (const preset of Object.values(PRESET_FATE_FACES)) {
  for (const face of Object.values(preset)) {
    if (face.image) BUILTIN_IMAGE_PATHS.add(face.image);
  }
}
// Historical default paths that no longer exist as current preset defaults but
// were shipped by earlier module versions; migration treats them the same as
// current built-ins (clear → follow active preset). Cover both the new suite
// install path and the old standalone-module path, since values stored by the
// previous standalone module still reference `modules/gluniverse-destiny-dice/`.
for (const legacy of ["defiance.png", "defiance-2.png", "tyranny-2.png", "tyranny-4.png"]) {
  BUILTIN_IMAGE_PATHS.add(`modules/${MODULE_ID}/features/${FEATURE_ID}/assets/dice/${legacy}`);
  BUILTIN_IMAGE_PATHS.add(`modules/gluniverse-destiny-dice/assets/dice/${legacy}`);
}

const PRESET_CHOICES = {
  [PRESET_DEFAULT]: "GLDDF.Settings.Preset.Default",
  [PRESET_AEGIS_FALLEN]: "GLDDF.Settings.Preset.AegisFallen",
  [PRESET_TIDES_OF_DESTINY]: "GLDDF.Settings.Preset.TidesOfDestiny",
};

const FATE_KIND_CHOICES = {
  opportunity: "GLDDF.Fate.Kind.opportunity",
  complication: "GLDDF.Fate.Kind.complication",
  blank: "GLDDF.Fate.Kind.blank",
};

const FACE_CONFIG_TEMPLATE = `modules/${MODULE_ID}/templates/${FEATURE_ID}/face-config.hbs`;

export function registerSettings() {
  const reg = (key, opts) => game.settings.register(MODULE_ID, key, {
    scope: "world",
    config: true,
    ...opts,
  });

  reg(SETTINGS.preset, {
    name: "GLDDF.Settings.Preset.Name",
    hint: "GLDDF.Settings.Preset.Hint",
    type: String,
    choices: PRESET_CHOICES,
    default: PRESET_DEFAULT,
    requiresReload: true,
    onChange: applyThemeFromSettings,
  });

  reg(SETTINGS.emissiveIntensity, {
    name: "GLDDF.Settings.EmissiveIntensity.Name",
    hint: "GLDDF.Settings.EmissiveIntensity.Hint",
    type: Number,
    range: {
      min: EMISSIVE_INTENSITY_MIN,
      max: EMISSIVE_INTENSITY_MAX,
      step: EMISSIVE_INTENSITY_STEP,
    },
    default: EMISSIVE_INTENSITY_DEFAULT,
    requiresReload: true,
  });

  // Motion is an accessibility/preference concern → per-client scope.
  reg(SETTINGS.motionTier, {
    name: "GLDDF.Settings.MotionTier.Name",
    hint: "GLDDF.Settings.MotionTier.Hint",
    scope: "client",
    type: String,
    choices: MOTION_TIER_CHOICES,
    default: MOTION_TIER_DEFAULT,
    onChange: applyMotionTier,
  });

  game.settings.registerMenu(MODULE_ID, `${DD_PREFIX}faceConfig`, {
    name: "GLDDF.Settings.FaceConfig.Name",
    label: "GLDDF.Settings.FaceConfig.Label",
    hint: "GLDDF.Settings.FaceConfig.Hint",
    icon: "fa-solid fa-dice-d6",
    type: DestinyFaceConfig,
    restricted: true,
  });

  for (const face of FACE_NUMBERS) {
    const defaults = PRESET_FATE_FACES[PRESET_DEFAULT][face];
    reg(getFaceKindSetting(face), {
      type: String,
      choices: FATE_KIND_CHOICES,
      default: defaults.kind,
      config: false,
    });
    reg(getFaceBonusSetting(face), {
      type: Number,
      default: defaults.bonus,
      config: false,
    });
    reg(getFaceImageSetting(face), {
      type: String,
      default: "",
      filePicker: "image",
      requiresReload: true,
      config: false,
    });
  }
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function normalizeKind(kind) {
  if (typeof kind !== "string") return KIND_BLANK;
  const aliased = KIND_ALIASES[kind] ?? kind;
  return FATE_KINDS.includes(aliased) ? aliased : KIND_BLANK;
}

export function getActivePresetId() {
  const value = getSetting(SETTINGS.preset);
  return FATE_PRESETS[value] ? value : PRESET_DEFAULT;
}

export function getEmissiveIntensity() {
  const raw = Number(getSetting(SETTINGS.emissiveIntensity));
  if (!Number.isFinite(raw)) return EMISSIVE_INTENSITY_DEFAULT;
  return Math.min(EMISSIVE_INTENSITY_MAX, Math.max(EMISSIVE_INTENSITY_MIN, raw));
}

export function getActivePreset() {
  return FATE_PRESETS[getActivePresetId()];
}

function getPresetFace(face) {
  const presetId = getActivePresetId();
  return PRESET_FATE_FACES[presetId]?.[face] ?? PRESET_FATE_FACES[PRESET_DEFAULT][face];
}

export async function migrateLegacySettings() {
  if (!game.user?.isGM) return;
  for (const face of FACE_NUMBERS) {
    const imageSetting = getFaceImageSetting(face);
    const rawImage = getSetting(imageSetting);
    const migratedImage = normalizeImagePath(rawImage);

    // Clear stored image if it matches any built-in preset default — the
    // resolved path now comes from the active preset.
    if (migratedImage && BUILTIN_IMAGE_PATHS.has(migratedImage)) {
      if (rawImage !== "") await game.settings.set(MODULE_ID, imageSetting, "");
    } else if (migratedImage !== rawImage) {
      await game.settings.set(MODULE_ID, imageSetting, migratedImage);
    }

    const kindSetting = getFaceKindSetting(face);
    const kindValue = getSetting(kindSetting);
    const migratedKind = KIND_ALIASES[kindValue];
    if (migratedKind && migratedKind !== kindValue) {
      await game.settings.set(MODULE_ID, kindSetting, migratedKind);
    }

    // Opportunity faces no longer carry numeric bonuses.
    const resolvedKind = normalizeKind(getSetting(kindSetting));
    if (resolvedKind === KIND_OPPORTUNITY) {
      const bonusSetting = getFaceBonusSetting(face);
      if (Number(getSetting(bonusSetting)) !== 0) {
        await game.settings.set(MODULE_ID, bonusSetting, 0);
      }
    }
  }
}

export function getKindLabel(kind) {
  const normalized = normalizeKind(kind);
  return getActivePreset().labels[normalized] ?? normalized;
}

export function getKindColor(kind) {
  const normalized = normalizeKind(kind);
  return getActivePreset().colors[normalized] ?? "#cccccc";
}

export function getFateFace(face) {
  if (!FACE_NUMBERS.includes(face)) return null;
  const defaults = getPresetFace(face);
  const kind = getFaceKind(face, defaults.kind);
  const bonus = kind === KIND_OPPORTUNITY ? 0 : getFaceBonus(face, defaults.bonus);
  return { kind, bonus };
}

export function getConfiguredFateFaces() {
  return Object.fromEntries(FACE_NUMBERS.map((face) => [face, getFateFace(face)]));
}

export function getFaceImagePath(face) {
  const stored = normalizeImagePath(getSetting(getFaceImageSetting(face)));
  if (stored) return stored;
  return getPresetFace(face)?.image ?? "";
}

export function getFaceImagePaths(face) {
  const stored = normalizeImagePath(getSetting(getFaceImageSetting(face)));
  if (stored) {
    const builtIn = findBuiltInFace(stored);
    if (builtIn) return { image: builtIn.image, bump: builtIn.bump, emissive: builtIn.emissive };
    const root = stored.replace(/\.png$/i, "");
    return { image: stored, bump: `${root}-bump.png`, emissive: `${root}-emissive.png` };
  }
  const presetFace = getPresetFace(face);
  if (!presetFace?.image) return null;
  return {
    image: presetFace.image,
    bump: presetFace.bump || presetFace.image,
    emissive: presetFace.emissive || presetFace.image,
  };
}

function findBuiltInFace(image) {
  for (const preset of Object.values(PRESET_FATE_FACES)) {
    for (const face of Object.values(preset)) {
      if (face.image === image) return face;
    }
  }
  return null;
}

function getFaceKind(face, fallback) {
  return normalizeKind(getSetting(getFaceKindSetting(face))) || fallback;
}

function getFaceBonus(face, fallback) {
  const value = Number(getSetting(getFaceBonusSetting(face)));
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function getFaceKindSetting(face) {
  return SETTINGS[`face${face}Kind`];
}

function getFaceBonusSetting(face) {
  return SETTINGS[`face${face}Bonus`];
}

function getFaceImageSetting(face) {
  return SETTINGS[`face${face}Image`];
}

function normalizeImagePath(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return LEGACY_FACE_IMAGE_PATHS[trimmed] ?? trimmed;
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class DestinyFaceConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "glddf-face-config",
    tag: "form",
    classes: ["glddf-face-config"],
    window: {
      title: "GLDDF.Settings.FaceConfig.Title",
      icon: "fa-solid fa-dice-d6",
      contentClasses: ["standard-form"],
    },
    position: { width: 760, height: "auto" },
    form: {
      handler: DestinyFaceConfig.#onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      browseImage: DestinyFaceConfig.#onBrowseImage,
    },
  };

  static PARTS = {
    form: { template: FACE_CONFIG_TEMPLATE },
  };

  async _prepareContext() {
    const kinds = Object.entries(FATE_KIND_CHOICES).map(([value, label]) => ({
      value,
      label: game.i18n.localize(label),
    }));

    return {
      reloadHint: game.i18n.localize("GLDDF.Settings.FaceConfig.ReloadHint"),
      faces: FACE_NUMBERS.map((face) => {
        const fateFace = getFateFace(face);
        const storedImage = normalizeImagePath(getSetting(getFaceImageSetting(face)));
        const resolvedImage = getFaceImagePath(face);
        const isOpportunity = fateFace.kind === KIND_OPPORTUNITY;
        return {
          face,
          kind: fateFace.kind,
          bonus: fateFace.bonus,
          bonusReadOnly: isOpportunity,
          image: storedImage,
          previewImage: resolvedImage,
          imagePlaceholder: getPresetFace(face)?.image ?? "",
          kinds: kinds.map((kind) => ({ ...kind, selected: kind.value === fateFace.kind })),
        };
      }),
    };
  }

  static async #onBrowseImage(_event, target) {
    const face = target.dataset.face;
    const input = this.element.querySelector(`input[name="face.${face}.image"]`);
    const preview = this.element.querySelector(`[data-preview-face="${face}"]`);
    const FilePickerImpl = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;
    new FilePickerImpl({
      type: "image",
      current: input?.value ?? "",
      callback: (path) => {
        if (input) input.value = path;
        if (preview) preview.src = path;
      },
    }).render(true);
  }

  static async #onSubmit(_event, _form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    for (const face of FACE_NUMBERS) {
      const data = expanded.face?.[face] ?? {};
      const defaults = PRESET_FATE_FACES[PRESET_DEFAULT][face];
      const kind = normalizeKind(data.kind) || defaults.kind;
      const bonus = kind === KIND_OPPORTUNITY ? 0 : (Number(data.bonus) || 0);
      await game.settings.set(MODULE_ID, getFaceKindSetting(face), kind);
      await game.settings.set(MODULE_ID, getFaceBonusSetting(face), bonus);
      await game.settings.set(MODULE_ID, getFaceImageSetting(face), normalizeImagePath(data.image));
    }
    ui.notifications?.info(game.i18n.localize("GLDDF.Settings.FaceConfig.Saved"));
  }
}

// Etched Glass drives every surface from ONE variable: --gl-accent (§2.5).
// The active preset's per-kind colors flow into that channel; all glass fills,
// rails, rims and glows are derived from it in CSS via color-mix. The Fated
// Roll toggle is a commit control and stays on the fixed signal-amber accent
// (§2.4), so it is intentionally not themed here.
export function applyThemeFromSettings() {
  if (typeof document === "undefined") return;

  const css = [
    accentRule(".glddf-fate-strip.glddf-opportunity", getKindColor("opportunity")),
    accentRule(".glddf-fate-strip.glddf-complication", getKindColor("complication")),
    accentRule(".glddf-fate-strip.glddf-blank", getKindColor("blank")),
  ].join("\n");

  let style = document.getElementById("glddf-theme-overrides");
  if (!style) {
    style = document.createElement("style");
    style.id = "glddf-theme-overrides";
    document.head.appendChild(style);
  }
  style.textContent = css;
}

function accentRule(selector, color) {
  return `${selector} { --gl-accent: ${color}; }`;
}

// Applies the motion-tier setting as a body class (§6.4). The CSS clamps to
// the reduced tier under `prefers-reduced-motion` regardless of this value.
export function applyMotionTier() {
  if (typeof document === "undefined" || !document.body) return;
  const tier = MOTION_TIERS.includes(getSetting(SETTINGS.motionTier))
    ? getSetting(SETTINGS.motionTier)
    : MOTION_TIER_DEFAULT;
  for (const candidate of MOTION_TIERS) {
    document.body.classList.toggle(`glddf-motion-${candidate}`, candidate === tier);
  }
}
