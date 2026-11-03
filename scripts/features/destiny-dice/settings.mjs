/**
 * Destiny Dice settings: registration, the one reader, and the face config app.
 *
 * Importable under plain Node. The config window's ApplicationV2 subclass is
 * built in a memoised factory, because `foundry.applications.api` does not exist
 * outside Foundry and this module is imported by the check tool and by the
 * shared motion checks (the old file reached for it at module scope).
 */

import {
  EMISSIVE_INTENSITY_DEFAULT,
  EMISSIVE_INTENSITY_MAX,
  EMISSIVE_INTENSITY_MIN,
  EMISSIVE_INTENSITY_STEP,
  FACE_NUMBERS,
  FATE_KINDS,
  KIND_ALIASES,
  KIND_OPPORTUNITY,
  MODULE_ID,
  MOTION_TIERS,
  MOTION_TIER_DEFAULT,
  PRESETS,
  PRESET_DEFAULT,
  DEFAULT_FACES,
} from "./constants.mjs";
import { bonusFor, faceKeys, normalizeImage, normalizeKind, presetId, resolveFace, resolveFaces } from "./faces.mjs";
import { faceConfigModel, facesFromForm, renderFaceConfig, renderFaceRow, renderSummary } from "./view.mjs";

export const DD_PREFIX = "dd.";

export const SETTINGS = Object.freeze({
  preset: `${DD_PREFIX}preset`,
  emissiveIntensity: `${DD_PREFIX}emissiveIntensity`,
  motionTier: `${DD_PREFIX}motionTier`,
  ...Object.fromEntries(FACE_NUMBERS.flatMap((face) => {
    const k = faceKeys(face);
    return [[`face${face}Kind`, k.kind], [`face${face}Bonus`, k.bonus], [`face${face}Image`, k.image]];
  })),
});
export const FACE_CONFIG_MENU = `${DD_PREFIX}faceConfig`;

const MOTION_TIER_CHOICES = Object.freeze({
  reduced: "GLDDF.Settings.MotionTier.Reduced",
  default: "GLDDF.Settings.MotionTier.Default",
  cinematic: "GLDDF.Settings.MotionTier.Cinematic",
});
const KIND_CHOICES = Object.freeze(Object.fromEntries(FATE_KINDS.map((k) => [k, `GLDDF.Fate.Kind.${k}`])));
const PRESET_CHOICES = Object.freeze(Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, p.name])));

/* The keys a reader may ask for. The check tool pins this against what
   registerSettings() registers, both ways. */
export const REGISTERED_KEYS = Object.freeze(Object.values(SETTINGS));

/* ── Reading ──────────────────────────────────────────────────────────── */

/** A setting, or undefined when Foundry has none (unregistered, no game). */
export function read(key) {
  try {
    return globalThis.game?.settings?.get?.(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

export const activePreset = () => presetId(read(SETTINGS.preset));
export const faces = () => resolveFaces(read);
export const face = (n) => resolveFace(n, read);

export function emissiveIntensity() {
  const raw = Number(read(SETTINGS.emissiveIntensity));
  if (!Number.isFinite(raw)) return EMISSIVE_INTENSITY_DEFAULT;
  return Math.min(EMISSIVE_INTENSITY_MAX, Math.max(EMISSIVE_INTENSITY_MIN, raw));
}

export function motionTier() {
  const tier = read(SETTINGS.motionTier);
  return MOTION_TIERS.includes(tier) ? tier : MOTION_TIER_DEFAULT;
}

/** game.i18n with a key fallback, so a Node fixture prints keys. */
export function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

/* ── Registration ─────────────────────────────────────────────────────── */

export function registerSettings() {
  const reg = (key, opts) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...opts });

  reg(SETTINGS.preset, {
    name: "GLDDF.Settings.Preset.Name",
    hint: "GLDDF.Settings.Preset.Hint",
    type: String,
    choices: PRESET_CHOICES,
    default: PRESET_DEFAULT,
    // The die's faces are baked from the preset's tones when Dice So Nice starts.
    requiresReload: true,
  });

  reg(SETTINGS.emissiveIntensity, {
    name: "GLDDF.Settings.EmissiveIntensity.Name",
    hint: "GLDDF.Settings.EmissiveIntensity.Hint",
    type: Number,
    range: { min: EMISSIVE_INTENSITY_MIN, max: EMISSIVE_INTENSITY_MAX, step: EMISSIVE_INTENSITY_STEP },
    default: EMISSIVE_INTENSITY_DEFAULT,
    requiresReload: true,
  });

  // An explicit, per-client choice of how much the result card moves.
  reg(SETTINGS.motionTier, {
    name: "GLDDF.Settings.MotionTier.Name",
    hint: "GLDDF.Settings.MotionTier.Hint",
    scope: "client",
    type: String,
    choices: MOTION_TIER_CHOICES,
    default: MOTION_TIER_DEFAULT,
  });

  game.settings.registerMenu(MODULE_ID, FACE_CONFIG_MENU, {
    name: "GLDDF.Settings.FaceConfig.Name",
    label: "GLDDF.Settings.FaceConfig.Label",
    hint: "GLDDF.Settings.FaceConfig.Hint",
    icon: "fa-solid fa-dice-d6",
    type: FaceConfigApp(),
    restricted: true,
  });

  for (const n of FACE_NUMBERS) {
    const keys = faceKeys(n);
    const fallback = DEFAULT_FACES[n];
    reg(keys.kind, { type: String, choices: KIND_CHOICES, default: fallback.kind, config: false });
    reg(keys.bonus, { type: Number, default: fallback.bonus, config: false });
    reg(keys.image, { type: String, default: "", filePicker: "image", config: false });
  }
}

/* ── Migration (GM only, once per ready) ──────────────────────────────── */

/**
 * Clear shipped art paths back to "follow the preset", rename the old kind
 * values, and zero an opportunity's bonus. Each write only when it changes
 * something, so a settled world writes nothing.
 */
export async function migrateLegacySettings() {
  if (!game.user?.isGM) return;
  for (const n of FACE_NUMBERS) {
    const keys = faceKeys(n);
    const rawImage = read(keys.image);
    if (typeof rawImage === "string" && rawImage !== "" && normalizeImage(rawImage) === "") {
      await game.settings.set(MODULE_ID, keys.image, "");
    }
    const rawKind = read(keys.kind);
    if (KIND_ALIASES[rawKind]) await game.settings.set(MODULE_ID, keys.kind, KIND_ALIASES[rawKind]);
    if (normalizeKind(read(keys.kind)) === KIND_OPPORTUNITY && Number(read(keys.bonus)) !== 0) {
      await game.settings.set(MODULE_ID, keys.bonus, 0);
    }
  }
}

/* ── The face config window ───────────────────────────────────────────── */

let _app = null;

/**
 * The window, built on first use. Templateless: `view.mjs` returns the markup,
 * which is what the preview draws.
 *
 * Two bugs the old window had are why it listens to its own inputs: the value
 * field of an opportunity was disabled at render and stayed disabled when the GM
 * switched that face to a complication, and a disabled field is not submitted,
 * so the bonus they then typed was saved as 0. And a change to the faces said
 * "requires a reload" in a note and never asked for one.
 */
export function FaceConfigApp() {
  if (_app) return _app;
  const { ApplicationV2 } = foundry.applications.api;

  _app = class DestinyFaceConfig extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "glddf-face-config",
      tag: "form",
      classes: ["glddf-face-config"],
      window: { title: "GLDDF.Settings.FaceConfig.Title", icon: "fa-solid fa-dice-d6", resizable: false },
      position: { width: 640, height: "auto" },
      form: { handler: DestinyFaceConfig.#onSubmit, closeOnSubmit: true },
      actions: {
        browseImage: DestinyFaceConfig.#onBrowse,
        resetFaces: DestinyFaceConfig.#onReset,
      },
    };

    #draft = null;

    #model() {
      return faceConfigModel({ faces: this.#draft ?? faces(), preset: activePreset(), t });
    }

    async _renderHTML() {
      return renderFaceConfig(this.#model());
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    #bound = false;

    _onRender(context, options) {
      super._onRender?.(context, options);
      // The form element outlives a re-render (Reset re-renders), so bind once.
      if (this.#bound) return;
      this.#bound = true;
      this.element.addEventListener("change", (event) => this.#onChange(event));
    }

    /* Redraw only the row that changed and the summary: re-rendering the whole
       form would drop focus out of the field being typed in. */
    #onChange(event) {
      const name = event.target?.name ?? "";
      const n = Number(/^face\.(\d)\./.exec(name)?.[1]);
      if (!FACE_NUMBERS.includes(n)) return;
      this.#draft = this.#read();
      const m = this.#model();
      const row = m.rows.find((r) => r.face === n);
      const el = this.element.querySelector(`.glddf-cfg-row[data-face="${n}"]`);
      if (row && el && /\.kind$/.test(name)) {
        el.outerHTML = renderFaceRow(row, m);
      } else if (row && el) {
        el.dataset.tone = row.tone;
        el.querySelector(".glddf-cfg-face .glddf-fate-face").innerHTML = row.glyph;
      }
      const summary = this.element.querySelector(".glddf-cfg-summary");
      if (summary) summary.innerHTML = renderSummary(m);
    }

    #read() {
      const data = new foundry.applications.ux.FormDataExtended(this.element).object;
      return facesFromForm(data).map((f) => {
        const kind = normalizeKind(f.kind);
        return { face: f.face, kind, bonus: bonusFor(kind, f.bonus), image: normalizeImage(f.image) };
      });
    }

    static async #onBrowse(_event, target) {
      const n = target.dataset.face;
      const input = this.element.querySelector(`input[name="face.${n}.image"]`);
      const Picker = foundry.applications.apps.FilePicker.implementation;
      new Picker({
        type: "image",
        current: input?.value ?? "",
        callback: (path) => {
          if (!input) return;
          input.value = path;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        },
      }).render(true);
    }

    static async #onReset() {
      this.#draft = FACE_NUMBERS.map((n) => ({ face: n, ...DEFAULT_FACES[n], image: "" }));
      await this.render();
    }

    static async #onSubmit(_event, _form, formData) {
      const next = facesFromForm(formData.object).map((f) => {
        const kind = normalizeKind(f.kind);
        return { face: f.face, kind, bonus: bonusFor(kind, f.bonus), image: normalizeImage(f.image) };
      });
      const before = faces();
      let changed = false;
      for (const f of next) {
        const keys = faceKeys(f.face);
        const was = before[f.face - 1];
        if (was.kind !== f.kind) await game.settings.set(MODULE_ID, keys.kind, f.kind);
        if (was.bonus !== f.bonus) await game.settings.set(MODULE_ID, keys.bonus, f.bonus);
        if (was.image !== f.image) await game.settings.set(MODULE_ID, keys.image, f.image);
        changed ||= was.kind !== f.kind || was.bonus !== f.bonus || was.image !== f.image;
      }
      ui.notifications?.info(t("GLDDF.Settings.FaceConfig.Saved"));
      // The faces are baked into the 3D die when Dice So Nice starts.
      if (changed && game.modules.get("dice-so-nice")?.active) {
        await foundry.applications.settings?.SettingsConfig?.reloadConfirm?.({ world: true });
      }
    }
  };
  return _app;
}
