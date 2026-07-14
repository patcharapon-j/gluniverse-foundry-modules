import { escapeAttr, escapeHTML } from "../../core/util.mjs";
import {
  DEFAULT_ICON,
  ICON_SUGGESTIONS,
  MAX_CHARGES,
  MIN_CHARGES,
} from "./constants.mjs";
import { decodeCssContent } from "./token-overlay.mjs";
import {
  getUltimateState,
  hasUltimateItems,
  iconCdnUrl,
  isEligibleItem,
  isNpcActor,
  isReadyState,
  isUltimateItem,
  normalizeUltimateState,
  reconcileActorUltimateState,
  sanitizeIcon,
  setItemFunctions,
  setUltimateState,
  stepCharge,
} from "./state.mjs";

const t = (key) => game.i18n.localize(key);

const glyphAvailability = new Map();

/** Whether the FA class resolves to a glyph in the fonts Foundry loaded. */
function glyphAvailable(iconClass) {
  const cached = glyphAvailability.get(iconClass);
  if (cached !== undefined) return cached;
  let available = false;
  if (document?.body) {
    const probe = document.createElement("i");
    probe.className = iconClass;
    probe.setAttribute("aria-hidden", "true");
    Object.assign(probe.style, { position: "fixed", left: "-9999px", top: "-9999px", visibility: "hidden" });
    document.body.appendChild(probe);
    available = Boolean(decodeCssContent(getComputedStyle(probe, "::before").content));
    probe.remove();
  }
  glyphAvailability.set(iconClass, available);
  return available;
}

/** Icon markup that works for ANY FA icon: the bundled font when available,
 *  otherwise a currentColor CSS mask over the FA free CDN SVG. */
function iconMarkup(iconClass) {
  const icon = sanitizeIcon(iconClass);
  if (glyphAvailable(icon)) return `<i class="${escapeAttr(icon)}" aria-hidden="true"></i>`;
  const url = iconCdnUrl(icon);
  if (url) return `<span class="glult-icon-mask" style="--glult-icon:url('${escapeAttr(url)}')" aria-hidden="true"></span>`;
  return `<i class="${escapeAttr(DEFAULT_ICON)}" aria-hidden="true"></i>`;
}

export function normalizeHtml(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  if (value?.element instanceof HTMLElement) return value.element;
  if (value?.element?.[0] instanceof HTMLElement) return value.element[0];
  return null;
}

function itemFromSheet(app) {
  const item = app?.item ?? app?.document ?? app?.object ?? app?.options?.document;
  return item?.documentName === "Item" ? item : null;
}

function actorFromSheet(app) {
  const actor = app?.actor ?? app?.document ?? app?.object ?? app?.options?.document;
  return actor?.documentName === "Actor" ? actor : null;
}

export function injectItemUltimateToggle(app, html) {
  const item = itemFromSheet(app);
  const root = normalizeHtml(html);
  if (!root || !game.user?.isGM || !isEligibleItem(item)) return;
  if (root.querySelector(".glult-item-toggle")) return;

  const selected = isUltimateItem(item);
  const group = document.createElement("div");
  group.className = "glult-item-toggle";
  group.innerHTML = `
    <label data-tooltip="${escapeAttr(game.i18n.format("GLULT.Item.FunctionHint", { function: t("GLULT.Function.Ultimate") }))}">
      <input type="checkbox" ${selected ? "checked" : ""}>
      <span class="glult-item-toggle-mark"><i class="fa-solid fa-star" aria-hidden="true"></i></span>
      <span>${escapeHTML(t("GLULT.Function.Ultimate"))}</span>
    </label>
  `;
  group.addEventListener("change", async (event) => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    event.stopPropagation();
    input.disabled = true;
    try {
      await setItemFunctions(item, input.checked ? ["ultimate"] : [], { render: false });
      await reconcileActorUltimateState(item.parent);
      item.parent?.sheet?.render?.(false);
    } catch (error) {
      input.checked = !input.checked;
      ui.notifications?.error(t("GLULT.Notify.UpdateFailed"));
      console.error("GLUniverse Suite | PF2e Ultimates | Failed to update item functions", error);
    } finally {
      input.disabled = false;
    }
  });
  // Anchor the toggle at the top of the tabbed sheet body. Older PF2e item
  // sheets keep the tab navigation as a full-width block, but the redesigned
  // ability sheet nests it inside the header's flex row — inserting there
  // stretched the toggle into a giant vertical pill floating over the banner.
  const body = root.querySelector("section.sheet-body, .sheet-body");
  const host = body ?? root.querySelector(".window-content, form") ?? root;
  host.prepend(group);
}

export function decorateNpcSheet(app, html) {
  const actor = actorFromSheet(app);
  const root = normalizeHtml(html);
  if (!root || !isNpcActor(actor)) return;

  const state = getUltimateState(actor);
  decorateAbilityRows(actor, root, state);
  if (game.user?.isGM && hasUltimateItems(actor)) injectChargeControl(app, actor, root, state);
}

function decorateAbilityRows(actor, root, state) {
  for (const row of root.querySelectorAll("[data-item-id]")) {
    const item = actor.items.get(row.dataset.itemId ?? "");
    if (!isUltimateItem(item)) continue;
    const itemRow = row.matches(".item") ? row : row.closest(".item") ?? row;
    itemRow.classList.add("glult-ultimate-item");
    itemRow.style.setProperty("--gl-accent", state.color);
    if (itemRow.querySelector(".glult-item-badges")) continue;
    const name = itemRow.querySelector("h4 .name, h4.name, .item-name, .name");
    if (!name) continue;
    const badges = document.createElement("span");
    badges.className = "glult-item-badges";
    const label = t("GLULT.Function.Ultimate");
    const badge = document.createElement("span");
    badge.className = "glult-item-badge glult-function-ultimate";
    badge.dataset.tooltip = label;
    badge.setAttribute("aria-label", label);
    badge.innerHTML = iconMarkup(state.icon);
    badges.appendChild(badge);
    name.prepend(badges);
  }
}

function injectChargeControl(app, actor, root, state) {
  const sheetRoot = root.closest?.(".application") ?? root;
  const npcBody = sheetRoot.matches?.(".npc-body")
    ? sheetRoot
    : sheetRoot.querySelector?.(".npc-body");
  if (!npcBody) return;

  const existing = [...sheetRoot.querySelectorAll(".glult-charge-control")];
  if (existing.length) {
    const [control, ...duplicates] = existing;
    for (const duplicate of duplicates) duplicate.remove();
    if (control.parentElement !== npcBody || control !== npcBody.lastElementChild) npcBody.appendChild(control);
    return;
  }

  const charged = isReadyState(state);
  const control = document.createElement("section");
  control.className = `glult-charge-control gl-glass${charged ? " is-charged" : ""}`;
  control.style.setProperty("--gl-accent", state.color);
  control.innerHTML = `
    <button type="button" class="glult-clock-button" data-glult-action="step-up" data-tooltip="${escapeAttr(t("GLULT.Charge.ClockHint"))}">
      ${clockSvg(state.value, state.max)}
    </button>
    <div class="glult-charge-copy">
      <span class="gl-tech-label">${escapeHTML(state.resourceName || t("GLULT.Charge.Label"))}</span>
      <strong>${state.value} / ${state.max}</strong>
      <small>${escapeHTML(chargeStatus(state))}</small>
    </div>
    <div class="glult-charge-actions">
      <button type="button" class="gl-btn" data-glult-action="step-down" aria-label="${escapeAttr(t("GLULT.Charge.Remove"))}" data-tooltip="${escapeAttr(t("GLULT.Charge.Remove"))}"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
      <button type="button" class="gl-btn gl-btn-accent" data-glult-action="step-up" aria-label="${escapeAttr(t("GLULT.Charge.Add"))}" data-tooltip="${escapeAttr(t("GLULT.Charge.Add"))}"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
      <button type="button" class="gl-btn" data-glult-action="configure" aria-label="${escapeAttr(t("GLULT.Config.Open"))}" data-tooltip="${escapeAttr(t("GLULT.Config.Open"))}"><i class="fa-solid fa-gear" aria-hidden="true"></i></button>
    </div>
  `;

  const applyStep = async (delta) => {
    control.classList.add("is-busy");
    try {
      const next = await stepCharge(actor, delta);
      if (next) updateChargeControl(control, next);
    } finally {
      control.classList.remove("is-busy");
    }
  };
  control.addEventListener("click", (event) => {
    const action = event.target.closest("[data-glult-action]")?.dataset.glultAction;
    if (action === "step-up") void applyStep(1);
    else if (action === "step-down") void applyStep(-1);
    else if (action === "configure") void openUltimateConfig(actor);
  });
  control.querySelector(".glult-clock-button")?.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void applyStep(-1);
  });
  npcBody.appendChild(control);
}

function updateChargeControl(control, state) {
  control.classList.toggle("is-charged", isReadyState(state));
  const clock = control.querySelector(".glult-clock-button");
  if (clock) clock.innerHTML = clockSvg(state.value, state.max);
  const value = control.querySelector(".glult-charge-copy strong");
  if (value) value.textContent = `${state.value} / ${state.max}`;
  const status = control.querySelector(".glult-charge-copy small");
  if (status) status.textContent = chargeStatus(state);
}

function chargeStatus(state) {
  if (isReadyState(state)) return t("GLULT.Charge.Charged");
  if (state.readyMode === "atLeast") return game.i18n.format("GLULT.Charge.ReadyAtLeast", { threshold: state.readyThreshold });
  if (state.readyMode === "exactly") return game.i18n.format("GLULT.Charge.ReadyExactly", { threshold: state.readyThreshold });
  return t("GLULT.Charge.Charging");
}

export function clockSvg(value, max) {
  if (max === 1) {
    const filled = value >= 1 ? " is-filled" : "";
    return `<svg class="glult-clock" viewBox="0 0 104 104" aria-hidden="true"><circle class="glult-clock-segment glult-clock-disc${filled}" cx="52" cy="52" r="42"></circle><circle class="glult-clock-ring" cx="52" cy="52" r="42"></circle></svg>`;
  }
  const paths = [];
  for (let index = 0; index < max; index += 1) {
    const start = (index / max) * 360 - 90;
    const end = ((index + 1) / max) * 360 - 90;
    const [x0, y0] = polar(42, start);
    const [x1, y1] = polar(42, end);
    const large = end - start <= 180 ? 0 : 1;
    paths.push(`<path class="glult-clock-segment${index < value ? " is-filled" : ""}" d="M52 52 L${x0.toFixed(2)} ${y0.toFixed(2)} A42 42 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z"></path>`);
  }
  return `<svg class="glult-clock" viewBox="0 0 104 104" aria-hidden="true">${paths.join("")}<circle class="glult-clock-ring" cx="52" cy="52" r="42"></circle></svg>`;
}

function polar(radius, degrees) {
  const radians = degrees * Math.PI / 180;
  return [52 + radius * Math.cos(radians), 52 + radius * Math.sin(radians)];
}

export async function openUltimateConfig(actor) {
  if (!game.user?.isGM || !isNpcActor(actor)) return;
  const state = getUltimateState(actor);
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) {
    ui.notifications?.error(t("GLULT.Notify.DialogUnavailable"));
    return;
  }

  const content = renderConfig(actor, state);
  const persist = async (root) => {
    const form = root?.querySelector?.(".glult-config-form") ?? root;
    const next = normalizeUltimateState({
      ...state,
      max: form?.querySelector?.('[name="max"]')?.value,
      readyMode: form?.querySelector?.('[name="readyMode"]')?.value,
      readyThreshold: form?.querySelector?.('[name="readyThreshold"]')?.value,
      displayMode: form?.querySelector?.('[name="displayMode"]')?.value,
      counterMode: form?.querySelector?.('[name="counterMode"]')?.value,
      color: form?.querySelector?.('[name="color"]')?.value,
      icon: form?.querySelector?.('[name="icon"]')?.value,
      resourceName: form?.querySelector?.('[name="resourceName"]')?.value,
      tier: form?.querySelector?.('[name="tier"]')?.value,
      allegiance: form?.querySelector?.('[name="allegiance"]')?.value,
      combatPromise: form?.querySelector?.('[name="combatPromise"]')?.value,
      gainRule: form?.querySelector?.('[name="gainRule"]')?.value,
      cashOut: form?.querySelector?.('[name="cashOut"]')?.value,
      tell: form?.querySelector?.('[name="tell"]')?.value,
      threat: form?.querySelector?.('[name="threat"]')?.value,
      counterplay: form?.querySelector?.('[name="counterplay"]')?.value,
    });
    await setUltimateState(actor, next);
    actor.sheet?.render?.(false);
    return next;
  };

  await DialogV2.wait({
    window: { title: game.i18n.format("GLULT.Config.Title", { name: actor.name }), icon: "fa-solid fa-star", resizable: false },
    classes: ["glult-config-dialog"],
    position: { width: 520 },
    content,
    render: (_event, dialog) => activateConfigPreview(normalizeHtml(dialog?.element ?? dialog)),
    buttons: [
      {
        action: "save",
        label: t("GLULT.Config.Save"),
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (_event, _button, dialog) => persist(normalizeHtml(dialog?.element ?? dialog)),
      },
      { action: "cancel", label: t("GLULT.Config.Cancel"), icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  }).catch(() => null);
}

function renderConfig(actor, state) {
  const options = ICON_SUGGESTIONS.map((icon) => `<option value="${escapeAttr(icon)}"></option>`).join("");
  const tierOptions = ["background", "standard", "elite", "boss"]
    .map((value) => option(value, t(`GLULT.Tier.${value}`), state.tier)).join("");
  const allegianceOptions = ["enemy", "ally"]
    .map((value) => option(value, t(`GLULT.Allegiance.${value}`), state.allegiance)).join("");
  return `
    <form class="glult-config-form" style="--gl-accent:${escapeAttr(state.color)}">
      <div class="glult-config-preview gl-glass">
        <span class="glult-config-icon">${iconMarkup(state.icon)}</span>
        <span><small>${escapeHTML(state.resourceName || t("GLULT.Charge.Label"))}</small><strong>${escapeHTML(actor.name)}</strong></span>
      </div>
      <div class="glult-config-grid">
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.ResourceName"))}</span>
          <input class="gl-field" type="text" name="resourceName" maxlength="48" value="${escapeAttr(state.resourceName)}" placeholder="${escapeAttr(t("GLULT.Config.ResourcePlaceholder"))}">
        </label>
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.Tier"))}</span>
          <select class="gl-field" name="tier">${tierOptions}</select>
        </label>
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.Allegiance"))}</span>
          <select class="gl-field" name="allegiance">${allegianceOptions}</select>
        </label>
      </div>
      <div class="glult-config-grid">
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.Required"))}</span>
          <input class="gl-field" type="number" name="max" min="${MIN_CHARGES}" max="${MAX_CHARGES}" step="1" value="${state.max}">
          <small>${escapeHTML(t("GLULT.Config.RequiredHint"))}</small>
        </label>
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.ReadyMode"))}</span>
          <select class="gl-field" name="readyMode">
            ${option("full", t("GLULT.Config.ReadyFull"), state.readyMode)}
            ${option("atLeast", t("GLULT.Config.ReadyAtLeast"), state.readyMode)}
            ${option("exactly", t("GLULT.Config.ReadyExactly"), state.readyMode)}
          </select>
          <small>${escapeHTML(t("GLULT.Config.ReadyModeHint"))}</small>
        </label>
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.ReadyThreshold"))}</span>
          <input class="gl-field" type="number" name="readyThreshold" min="1" max="${MAX_CHARGES}" step="1" value="${state.readyThreshold}" ${state.readyMode === "full" ? "disabled" : ""}>
          <small>${escapeHTML(t("GLULT.Config.ReadyThresholdHint"))}</small>
        </label>
      </div>
      <div class="glult-config-grid">
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.Display"))}</span>
          <select class="gl-field" name="displayMode">
            ${option("default", t("GLULT.Config.OptionDefault"), state.displayMode)}
            ${option("icon", t("GLULT.Settings.DisplayMode.Icon"), state.displayMode)}
            ${option("overlay", t("GLULT.Settings.DisplayMode.Overlay"), state.displayMode)}
            ${option("both", t("GLULT.Settings.DisplayMode.Both"), state.displayMode)}
          </select>
          <small>${escapeHTML(t("GLULT.Config.DisplayHint"))}</small>
        </label>
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.Counter"))}</span>
          <select class="gl-field" name="counterMode">
            ${option("default", t("GLULT.Config.OptionDefault"), state.counterMode)}
            ${option("show", t("GLULT.Config.CounterShow"), state.counterMode)}
            ${option("hide", t("GLULT.Config.CounterHide"), state.counterMode)}
          </select>
          <small>${escapeHTML(t("GLULT.Config.CounterHint"))}</small>
        </label>
        <label class="glult-config-field">
          <span>${escapeHTML(t("GLULT.Config.Color"))}</span>
          <input class="gl-field glult-color" type="color" name="color" value="${escapeAttr(state.color)}">
        </label>
      </div>
      <label class="glult-config-field">
        <span>${escapeHTML(t("GLULT.Config.Icon"))}</span>
        <input class="gl-field" type="search" name="icon" list="glult-icon-suggestions" value="${escapeAttr(state.icon)}" autocomplete="off">
        <datalist id="glult-icon-suggestions">${options}</datalist>
        <small>${escapeHTML(t("GLULT.Config.IconHint"))}</small>
      </label>
      <details class="glult-engine-details" open>
        <summary>${escapeHTML(t("GLULT.Config.EngineDesign"))}</summary>
        ${textArea("combatPromise", "GLULT.Config.CombatPromise", "GLULT.Config.CombatPromiseHint", state.combatPromise)}
        ${textArea("gainRule", "GLULT.Config.GainRule", "GLULT.Config.GainRuleHint", state.gainRule)}
        ${textArea("cashOut", "GLULT.Config.CashOut", "GLULT.Config.CashOutHint", state.cashOut)}
      </details>
      <details class="glult-engine-details" ${state.allegiance === "enemy" ? "open" : ""}>
        <summary>${escapeHTML(t("GLULT.Config.CounterplayDesign"))}</summary>
        ${textArea("tell", "GLULT.Config.Tell", "GLULT.Config.TellHint", state.tell)}
        ${textArea("threat", "GLULT.Config.Threat", "GLULT.Config.ThreatHint", state.threat)}
        ${textArea("counterplay", "GLULT.Config.Counterplay", "GLULT.Config.CounterplayHint", state.counterplay)}
      </details>
    </form>
  `;
}

function option(value, label, selected) {
  return `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHTML(label)}</option>`;
}

function textArea(name, labelKey, hintKey, value) {
  return `<label class="glult-config-field">
    <span>${escapeHTML(t(labelKey))}</span>
    <textarea class="gl-field" name="${escapeAttr(name)}" rows="2">${escapeHTML(value)}</textarea>
    <small>${escapeHTML(t(hintKey))}</small>
  </label>`;
}

function activateConfigPreview(root) {
  const form = root?.querySelector?.(".glult-config-form");
  if (!form) return;
  const color = form.querySelector('[name="color"]');
  const icon = form.querySelector('[name="icon"]');
  const previewIcon = form.querySelector(".glult-config-icon");
  const resourceName = form.querySelector('[name="resourceName"]');
  const previewLabel = form.querySelector(".glult-config-preview small");
  const update = () => {
    form.style.setProperty("--gl-accent", color.value);
    previewIcon.innerHTML = iconMarkup(icon.value || DEFAULT_ICON);
    previewLabel.textContent = resourceName.value.trim() || t("GLULT.Charge.Label");
  };
  color.addEventListener("input", update);
  icon.addEventListener("input", update);
  resourceName.addEventListener("input", update);
  update();

  const readyMode = form.querySelector('[name="readyMode"]');
  const readyThreshold = form.querySelector('[name="readyThreshold"]');
  const maxInput = form.querySelector('[name="max"]');
  const syncReady = () => {
    if (!readyMode || !readyThreshold) return;
    readyThreshold.disabled = readyMode.value === "full";
    const cap = Number.parseInt(maxInput?.value, 10);
    if (Number.isFinite(cap)) readyThreshold.max = String(cap);
  };
  readyMode?.addEventListener("change", syncReady);
  maxInput?.addEventListener("input", syncReady);
  syncReady();
}
