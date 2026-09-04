/** PF2e AoE — dedicated Spellglass Region creator in the suite scene controls. */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { escapeAttr, escapeHTML } from "../../core/util.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { FLAGS } from "./constants.mjs";
import { normalizeColor, normalizeLabel } from "./data.mjs";
import { BUILTIN_PROFILES } from "./profiles.mjs";
import { compactPresentation } from "./schema.mjs";

const TOOL = "pf2e-aoe-create";
const SHAPES = Object.freeze(["burst", "cone", "line", "square", "emanation"]);
const SHAPE_SET = new Set(SHAPES);
const PROFILE_SET = new Set(BUILTIN_PROFILES.map((entry) => entry.id));

let busy = false;
let draft = {
  name: "",
  label: "",
  shape: "burst",
  size: 20,
  width: 5,
  profileId: "builtin:etched-neutral",
  colorOverride: false,
  color: null,
};

const t = (key) => game.i18n.localize(key);
const tf = (key, data) => game.i18n.format(key, data);

function sceneUnit() {
  return String(canvas?.scene?.grid?.units || t("GLAOE.Creator.UnitsFallback"));
}

function distancePixels(distance) {
  const gridDistance = Number(canvas?.dimensions?.distance) || 5;
  const gridSize = Number(canvas?.dimensions?.size) || 100;
  return Math.max(1, Number(distance) || gridDistance) * gridSize / gridDistance;
}

function shapeData({ shape, size, width }) {
  const extent = distancePixels(size);
  const point = canvas?.mousePosition ?? { x: 0, y: 0 };
  switch (shape) {
    case "cone":
      return { type: "cone", x: point.x, y: point.y, radius: extent, angle: 90 };
    case "line":
      return { type: "line", x: point.x, y: point.y, length: extent, width: distancePixels(width) };
    case "square":
      return { type: "rectangle", x: point.x, y: point.y, width: extent, height: extent };
    default:
      return { type: "circle", x: point.x, y: point.y, radius: extent };
  }
}

function creatorContent() {
  const profileId = PROFILE_SET.has(draft.profileId) ? draft.profileId : "builtin:etched-neutral";
  const color = normalizeColor(draft.color, "#759dff");
  const unit = sceneUnit();
  const shapeOptions = SHAPES.map((id) =>
    `<option value="${id}"${draft.shape === id ? " selected" : ""}>${escapeHTML(t(`GLAOE.Creator.Shape.${id}`))}</option>`
  ).join("");
  const profileOptions = BUILTIN_PROFILES.map((entry) =>
    `<option value="${entry.id}"${profileId === entry.id ? " selected" : ""}>${escapeHTML(t(entry.nameKey))}</option>`
  ).join("");

  return `
    <form class="gl-aoe-create-form">
      <p class="gl-aoe-create-intro">${escapeHTML(t("GLAOE.Creator.Intro"))}</p>
      <div class="form-group">
        <label>${escapeHTML(t("GLAOE.Creator.Name"))}</label>
        <div class="form-fields"><input type="text" name="name" maxlength="80" value="${escapeAttr(draft.name)}" placeholder="${escapeAttr(t("GLAOE.Creator.NamePlaceholder"))}"></div>
      </div>
      <div class="form-group">
        <label>${escapeHTML(t("GLAOE.RegionStyle.Label"))}</label>
        <div class="form-fields"><input type="text" name="label" maxlength="80" value="${escapeAttr(draft.label)}" placeholder="${escapeAttr(t("GLAOE.RegionStyle.LabelPlaceholder"))}"></div>
        <p class="hint">${escapeHTML(t("GLAOE.RegionStyle.LabelHint"))}</p>
      </div>
      <div class="gl-aoe-create-grid">
        <div class="form-group">
          <label>${escapeHTML(t("GLAOE.Creator.ShapeLabel"))}</label>
          <div class="form-fields"><select name="shape">${shapeOptions}</select></div>
        </div>
        <div class="form-group">
          <label>${escapeHTML(tf("GLAOE.Creator.Size", { unit }))}</label>
          <div class="form-fields"><input type="number" name="size" min="1" max="1000" step="1" value="${Number(draft.size) || 20}"></div>
        </div>
      </div>
      <div class="form-group gl-aoe-create-width"${draft.shape === "line" ? "" : " hidden"}>
        <label>${escapeHTML(tf("GLAOE.Creator.Width", { unit }))}</label>
        <div class="form-fields"><input type="number" name="width" min="1" max="100" step="1" value="${Number(draft.width) || 5}"></div>
      </div>
      <div class="gl-aoe-create-grid">
        <div class="form-group">
          <label>${escapeHTML(t("GLAOE.RegionStyle.Profile"))}</label>
          <div class="form-fields"><select name="profileId">${profileOptions}</select></div>
        </div>
        <div class="form-group gl-aoe-create-color">
          <label>${escapeHTML(t("GLAOE.RegionStyle.Color"))}</label>
          <div class="form-fields">
            <label class="checkbox"><input type="checkbox" name="colorOverride"${draft.colorOverride ? " checked" : ""}> ${escapeHTML(t("GLAOE.RegionStyle.ColorOverride"))}</label>
            <input type="color" name="color" value="${escapeAttr(color)}"${draft.colorOverride ? "" : " disabled"}>
            <output>${escapeHTML(color)}</output>
          </div>
        </div>
      </div>
      <p class="hint">${escapeHTML(t("GLAOE.Creator.PlacementHint"))}</p>
    </form>`;
}

function bindCreatorDialog(_event, dialog) {
  const form = dialog.element?.querySelector("form.gl-aoe-create-form");
  if (!form) return;
  const shape = form.elements.shape;
  const color = form.elements.color;
  const colorOverride = form.elements.colorOverride;
  const output = form.querySelector(".gl-aoe-create-color output");
  const width = form.querySelector(".gl-aoe-create-width");
  shape?.addEventListener("change", () => width?.toggleAttribute("hidden", shape.value !== "line"));
  color?.addEventListener("input", () => { if (output) output.value = color.value; });
  colorOverride?.addEventListener("change", () => { if (color) color.disabled = !colorOverride.checked; });
}

function readCreator(button) {
  const elements = button.form?.elements ?? {};
  const shape = SHAPE_SET.has(elements.shape?.value) ? elements.shape.value : "burst";
  const profileId = PROFILE_SET.has(elements.profileId?.value) ? elements.profileId.value : "builtin:etched-neutral";
  return {
    name: String(elements.name?.value ?? "").trim().slice(0, 80),
    label: normalizeLabel(elements.label?.value),
    shape,
    size: Math.max(1, Math.min(1000, Number(elements.size?.value) || 20)),
    width: Math.max(1, Math.min(100, Number(elements.width?.value) || 5)),
    profileId,
    colorOverride: Boolean(elements.colorOverride?.checked),
    color: normalizeColor(elements.color?.value, "#759dff"),
  };
}

async function chooseArea() {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2) {
    ui.notifications?.error?.(t("GLAOE.Creator.DialogUnavailable"));
    return null;
  }
  return DialogV2.wait({
    window: { title: t("GLAOE.Creator.Title") },
    classes: ["gl-aoe-create-dialog"],
    position: { width: 500 },
    modal: true,
    rejectClose: false,
    content: creatorContent(),
    render: bindCreatorDialog,
    buttons: [
      {
        action: "place",
        label: t("GLAOE.Creator.Place"),
        icon: "fa-solid fa-location-crosshairs",
        default: true,
        callback: (_event, button) => readCreator(button),
      },
      {
        action: "cancel",
        label: t("GLAOE.Creator.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null,
      },
    ],
  });
}

function baseRegionData(config) {
  const suiteFlags = {};
  foundry.utils.setProperty(suiteFlags, FLAGS.presentation, compactPresentation({
    schema: 2,
    mode: "profile",
    profileId: config.profileId,
    overrides: config.colorOverride ? { appearance: { palette: { body: config.color } } } : {},
    label: config.label ? { mode: "custom", value: config.label } : { mode: "inherit", value: "" },
  }));
  return {
    name: config.name || config.label || t("GLAOE.Creator.DefaultName"),
    color: config.color,
    highlightMode: "coverage",
    displayMeasurements: true,
    ownership: { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    flags: {
      pf2e: { areaShape: config.shape },
      [SUITE_ID]: suiteFlags,
    },
  };
}

function regionData(config) {
  return { ...baseRegionData(config), shapes: [shapeData(config)] };
}

async function createTokenEmanation(config) {
  const selected = canvas.tokens?.controlled ?? [];
  if (selected.length !== 1) {
    ui.notifications?.warn?.(t("GLAOE.Creator.SelectOneToken"));
    return false;
  }
  const create = CONFIG.Region?.documentClass?.createTokenEmanation;
  if (typeof create !== "function") {
    ui.notifications?.error?.(t("GLAOE.Creator.EmanationUnavailable"));
    return false;
  }
  await create.call(CONFIG.Region.documentClass, selected[0].document, config.size, baseRegionData(config), {
    gridBased: Boolean(canvas.grid?.isSquare),
  });
  return true;
}

export async function openSpellglassCreator() {
  if (busy || !game.user?.isGM) return;
  if (!canvas?.ready || !canvas.regions) {
    ui.notifications?.warn?.(t("GLAOE.Creator.CanvasRequired"));
    return;
  }
  if (!game.user.can?.("REGION_CREATE")) {
    ui.notifications?.warn?.(t("GLAOE.Creator.PermissionRequired"));
    return;
  }
  busy = true;
  try {
    const config = await chooseArea();
    if (!config) return;
    draft = { ...config };
    if (config.shape === "emanation") {
      await createTokenEmanation(config);
      return;
    }
    ui.notifications?.info?.(t("GLAOE.Creator.ClickToPlace"));
    await canvas.regions.placeRegion(regionData(config));
  } catch (error) {
    warn("pf2e-aoe | Spellglass placement failed", error);
    ui.notifications?.error?.(tf("GLAOE.Creator.Failed", { message: error?.message ?? String(error) }));
  } finally {
    busy = false;
  }
}

export function addSpellglassSceneControl(controls) {
  if (!game.user?.isGM) return;
  const group = ensureSuiteGroup(controls);
  if (!group) return;
  group.tools[TOOL] = {
    name: TOOL,
    title: "GLAOE.Controls.Create",
    icon: "fa-solid fa-bullseye",
    order: Object.keys(group.tools).length,
    button: true,
    visible: true,
    onChange: () => { void openSpellglassCreator(); },
  };
}

export function bindSpellglassSceneControl(html) {
  if (!game.user?.isGM) return;
  bindSuiteToolClicks(html, { [TOOL]: () => { void openSpellglassCreator(); } });
}
