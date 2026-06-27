/**
 * GLUniverse Suite — Etched-Glass Chat Theme: per-actor portrait framing.
 *
 * Chat-card framing is INDEPENDENT of the initiative tracker's portrait frame:
 * it lives on etched-chat's own `ec.frame = {x, y, zoom, enabled}` actor flag,
 * with a face-focused smart default. The entry point is a dedicated "Chat Frame"
 * crop button on the actor sheet header (separate from initiative's button), and
 * its dialog previews a REAL chat card — header, diorama portrait, dice result,
 * d20 chip — so the user sees exactly what the framing produces. Owner / GM only.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { clamp, escapeHTML } from "../../core/util.mjs";

/** etched-chat's own framing flag (independent of initiative's portraitFrame). */
const FLAG_KEY = "ec.frame";

/** Smart default framing: face-focused (upper-centre), no zoom, portrait on. */
export const DEFAULT_FRAME = { x: 50, y: 18, zoom: 100, enabled: true };

const clampPct = (n) => clamp(Number(n), 0, 100);
const clampZoom = (n) => clamp(Number(n), 100, 300);
const safeNum = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : d);

/** Read an actor's chat-card framing override merged over the smart default. */
export function getFrame(actor) {
  let stored = null;
  try {
    stored = actor?.getFlag?.(SUITE_ID, FLAG_KEY) ?? null;
  } catch {
    /* actor without flag support */
  }
  const f = { ...DEFAULT_FRAME, ...(stored && typeof stored === "object" ? stored : {}) };
  return {
    x: safeNum(f.x, DEFAULT_FRAME.x, 0, 100),
    y: safeNum(f.y, DEFAULT_FRAME.y, 0, 100),
    zoom: safeNum(f.zoom, DEFAULT_FRAME.zoom, 100, 300),
    enabled: f.enabled !== false,
  };
}

/** Push a frame onto a portrait layer's CSS custom properties. */
export function applyFrame(layer, frame) {
  if (!layer) return;
  layer.style.setProperty("--glec-frame-x", `${frame.x}%`);
  layer.style.setProperty("--glec-frame-y", `${frame.y}%`);
  layer.style.setProperty("--glec-frame-zoom", String(frame.zoom / 100));
}

/** True when the current user may reframe this actor. */
export function canFrame(actor) {
  if (!actor) return false;
  return !!(game.user?.isGM || actor.isOwner || actor.testUserPermission?.(game.user, "OWNER"));
}

/** Resolve the portrait image used in the diorama bleed for an actor. */
function resolveActorPortrait(actor) {
  try {
    return actor?.prototypeToken?.texture?.src || actor?.img || null;
  } catch {
    return null;
  }
}

/** A realistic, self-contained chat-card mock for the framing preview. Uses the
 *  exact `.glec-card` anatomy + classes the live styler stamps, so it renders
 *  through styles/etched-chat.css identically to a real check card. */
function renderPreviewCard(actor, portrait) {
  const name = escapeHTML(actor?.name ?? "");
  const flavor = escapeHTML(game.i18n.localize("GLEC.frame.previewFlavor") || "Perception check");
  const art = portrait
    ? `<div class="glec-portrait" aria-hidden="true"><img src="${escapeHTML(portrait)}" alt=""></div>`
    : "";
  return `
    <div class="glec-frame-preview-card chat-message message glec-card" data-glec-category="check" data-glec-tier="baseline">
      ${art}
      <header class="message-header">
        <h4 class="message-sender">${name}</h4>
        <span class="message-timestamp">${escapeHTML(game.i18n.localize("GLEC.frame.previewNow") || "now")}</span>
      </header>
      <div class="message-content">
        <div class="flavor-text">${flavor}</div>
        <div class="dice-roll">
          <div class="dice-result">
            <div class="dice-formula">1d20 + 9</div>
            <h4 class="dice-total"><span class="glec-d20">17</span>26</h4>
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * Open the chat-card framing dialog for an actor. Live-previews the framing on a
 * real chat-card mock and persists `ec.frame` on save.
 */
export async function openFrameDialog(actor) {
  if (!canFrame(actor)) return;
  const start = getFrame(actor);
  const portrait = resolveActorPortrait(actor);
  const row = (label, key, min, max, val, suffix = "%") => `
    <div class="glec-frame-row">
      <label>${escapeHTML(label)}</label>
      <input type="range" name="${key}" min="${min}" max="${max}" value="${val}" />
      <output data-for="${key}">${val}${suffix}</output>
    </div>`;
  const content = `
    <div class="glec-frame-dialog">
      ${renderPreviewCard(actor, portrait)}
      <label class="glec-frame-toggle">
        <input type="checkbox" name="enabled" ${start.enabled ? "checked" : ""} />
        ${escapeHTML(game.i18n.localize("GLEC.frame.enabled") || "Show portrait")}
      </label>
      ${row(game.i18n.localize("GLEC.frame.x") || "Horizontal", "x", 0, 100, start.x)}
      ${row(game.i18n.localize("GLEC.frame.y") || "Vertical", "y", 0, 100, start.y)}
      ${row(game.i18n.localize("GLEC.frame.zoom") || "Zoom", "zoom", 100, 300, start.zoom)}
    </div>`;

  // Read the current values straight from the dialog DOM (robust regardless of
  // whether live-input listeners attached).
  const readValues = (el) => {
    const q = (n) => el?.querySelector(`[name="${n}"]`);
    const num = (n, d) => {
      const v = Number(q(n)?.value);
      return Number.isFinite(v) ? v : d;
    };
    return {
      x: clampPct(num("x", start.x)),
      y: clampPct(num("y", start.y)),
      zoom: clampZoom(num("zoom", start.zoom)),
      enabled: q("enabled") ? !!q("enabled").checked : start.enabled,
    };
  };
  const preview = (el) => {
    const v = readValues(el);
    el?.querySelectorAll("output[data-for]").forEach((o) => {
      const k = o.dataset.for;
      o.textContent = `${v[k]}%`;
    });
    const layer = el?.querySelector(".glec-frame-preview-card .glec-portrait");
    if (layer) {
      layer.style.display = v.enabled ? "" : "none";
      applyFrame(layer, v);
    }
  };
  const attachLive = (el) => {
    el?.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => preview(el)));
    if (el) preview(el); // seed the card with the starting frame
  };
  const persist = async (el) => {
    const v = readValues(el);
    await actor.setFlag(SUITE_ID, FLAG_KEY, v);
  };

  const title = game.i18n.localize("GLEC.frame.title") || "Frame chat portrait";
  const saveLabel = game.i18n.localize("GLEC.frame.save") || "Save";
  const cancelLabel = game.i18n.localize("GLEC.frame.cancel") || "Cancel";
  const DialogV2 = foundry.applications?.api?.DialogV2;

  if (DialogV2) {
    try {
      await DialogV2.wait({
        window: { title },
        classes: ["glec-frame-window"],
        position: { width: 420 },
        content,
        render: (_ev, dialog) => attachLive(dialog?.element ?? dialog),
        buttons: [
          {
            action: "save",
            label: saveLabel,
            default: true,
            callback: (_ev, _btn, dialog) => persist(dialog?.element ?? dialog),
          },
          { action: "cancel", label: cancelLabel },
        ],
        rejectClose: false,
      });
    } catch {
      /* dismissed — nothing persisted */
    }
    return;
  }

  // Legacy Dialog fallback (pre-DialogV2).
  new Dialog({
    title,
    content,
    buttons: {
      save: { label: saveLabel, callback: (html) => persist(html?.[0] ?? html) },
      cancel: { label: cancelLabel },
    },
    default: "save",
    render: (html) => attachLive(html?.[0] ?? html),
  }).render(true);
}

/* ---------------------------------------------------------------------------
 * Actor-sheet header entry point (cross-version). etched-chat owns its OWN
 * "Chat Frame" button, separate from the initiative tracker's portrait button —
 * the two frame independent surfaces. Contribute to every header button/control
 * array AND fall back to direct DOM injection on render.
 * ------------------------------------------------------------------------- */

/** Resolve the Actor document backing a sheet application (or null). */
function getActorFromSheet(app) {
  const doc = app?.actor ?? app?.document ?? app?.object ?? app?.options?.document;
  return doc?.documentName === "Actor" ? doc : null;
}

/** Normalize a hook's html arg (HTMLElement / jQuery / app) to an element. */
function getHTMLElement(value) {
  if (!value) return null;
  if (value instanceof HTMLElement) return value;
  if (value[0] instanceof HTMLElement) return value[0];
  if (value.element instanceof HTMLElement) return value.element;
  if (value.element?.[0] instanceof HTMLElement) return value.element[0];
  return null;
}

const BTN_CLASS = "glec-frame-portrait";
const BTN_ACTION = "glec-frame-portrait";
const BTN_ICON = "fa-solid fa-image-portrait";

/** Legacy header-button array (getApplicationHeaderButtons / *V1 / ActorSheet). */
export function addFrameHeaderButton(app, buttons) {
  const actor = getActorFromSheet(app);
  if (!canFrame(actor) || !Array.isArray(buttons)) return;
  if (buttons.some((b) => b.class === BTN_CLASS)) return;
  buttons.unshift({
    label: game.i18n.localize("GLEC.frame.button") || "Chat Frame",
    class: BTN_CLASS,
    icon: BTN_ICON,
    onclick: (event) => {
      event?.preventDefault?.();
      openFrameDialog(actor);
    },
  });
}

/** ApplicationV2 header-control array (getHeaderControlsApplicationV2). */
export function addFrameHeaderControl(app, controls) {
  const actor = getActorFromSheet(app);
  if (!canFrame(actor) || !Array.isArray(controls)) return;
  if (controls.some((c) => c.action === BTN_ACTION)) return;
  controls.unshift({
    action: BTN_ACTION,
    icon: BTN_ICON,
    label: game.i18n.localize("GLEC.frame.button") || "Chat Frame",
    onClick: (event) => {
      event?.preventDefault?.();
      openFrameDialog(actor);
    },
    visible: true,
  });
}

/** DOM-injection fallback on render (renderApplicationV1 / renderApplicationV2). */
export function injectFrameTitlebarButton(app, html) {
  const actor = getActorFromSheet(app);
  if (!canFrame(actor)) return;
  const element = getHTMLElement(html) ?? getHTMLElement(app?.element) ?? app?.element;
  const wrapper = element?.closest?.(".app, .application, .window-app") ?? element;
  const header = app?.window?.header ?? wrapper?.querySelector?.(".window-header");
  if (!header || header.querySelector(`[data-action="${BTN_ACTION}"], .${BTN_CLASS}`)) return;

  const button = document.createElement("a");
  button.className = `header-button ${BTN_CLASS}`;
  button.dataset.action = BTN_ACTION;
  button.title = game.i18n.localize("GLEC.frame.title") || "Frame chat portrait";
  button.innerHTML = `<i class="${BTN_ICON}" aria-hidden="true"></i>${
    game.i18n.localize("GLEC.frame.button") || "Chat Frame"
  }`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openFrameDialog(actor);
  });

  const close = header.querySelector('[data-action="close"], .close');
  if (close) header.insertBefore(button, close);
  else header.appendChild(button);
}
