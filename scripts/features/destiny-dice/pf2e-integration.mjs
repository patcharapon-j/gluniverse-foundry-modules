import { applyFateToMessage, canUserAddFate, isPcCheckMessage } from "./fate-result.mjs";

const FATED_CONTEXT_KEY = "glddfFated";
const FATED_OPTION = "glddf:fated-roll";
const pendingHeroRerolls = [];

export function registerPF2eIntegration() {
  Hooks.on("renderCheckModifiersDialog", injectFatedRollToggle);
  Hooks.on("getChatMessageContextOptions", addChatContextOptions);
  Hooks.on("createChatMessage", onCreateChatMessage);
  Hooks.on("pf2e.reroll", onPF2eReroll);
}

export { patchPF2eCheckMethods };

function patchPF2eCheckMethods() {
  const Check = game.pf2e?.Check;
  if (!Check?.roll || Check.roll._glddfPatched) {
    if (!Check?.roll) console.warn("GLUniverse Destiny Dice | PF2e Check API not found; Fate Die integration disabled.");
    return;
  }

  const originalRoll = Check.roll;
  Check.roll = async function wrappedFatedCheckRoll(check, context = {}, event = null, callback = null) {
    const wrappedCallback = async (roll, outcome, message, callbackEvent) => {
      if (callback) await callback(roll, outcome, message, callbackEvent);
      if (context?.[FATED_CONTEXT_KEY] && message?.id) await applyFateToMessage(message, { source: "dialog" });
    };

    return originalRoll.call(this, check, context, event, wrappedCallback);
  };
  Check.roll._glddfPatched = true;

  if (Check.rerollFromMessage && !Check.rerollFromMessage._glddfPatched) {
    const originalReroll = Check.rerollFromMessage;
    Check.rerollFromMessage = async function wrappedFatedReroll(message, options = {}) {
      const isHeroPoint = options?.resource === "hero-points";
      if (isHeroPoint && isPcCheckMessage(message)) {
        const actor = message.actor ?? message.speakerActor;
        pendingHeroRerolls.push({
          actorUuid: actor?.uuid,
          userId: game.user.id,
          createdAt: Date.now(),
        });
      }

      try {
        return await originalReroll.call(this, message, options);
      } finally {
        cleanupPendingHeroRerolls();
      }
    };
    Check.rerollFromMessage._glddfPatched = true;
  }

  console.log("GLUniverse Destiny Dice | PF2e check integration registered");
}

function injectFatedRollToggle(app, html) {
  const element = normalizeHtml(html);
  const form = element?.querySelector?.("form.check-modifiers-content");
  if (!form || form.querySelector(".glddf-fated-roll-toggle")) return;

  const actor = app?.context?.actor ?? app?.context?.origin?.actor ?? app?.context?.target?.actor;
  if (!actor?.isOfType?.("character")) return;

  const row = document.createElement("div");
  row.className = "glddf-fated-roll-row";
  row.dataset.tooltip = "GLDDF.Dialog.FatedRollHint";
  row.innerHTML = `<label class="glddf-fated-roll-toggle"><span>${game.i18n.localize("GLDDF.Dialog.FatedRoll")}</span><input type="checkbox" /></label>`;

  const input = row.querySelector("input");
  input.checked = !!app.context?.[FATED_CONTEXT_KEY] || hasContextOption(app.context, FATED_OPTION);
  input.addEventListener("change", () => {
    setFatedContext(app.context, input.checked);
  });

  // PF2e v14-dev renamed the roll button to a generic submit button and the
  // fate radios from `.fate` to `.roll-twice`; keep the legacy selectors as
  // fallbacks for older PF2e versions.
  const rollButton = form.querySelector("button.roll, button[type='submit']");
  rollButton?.addEventListener("click", () => {
    if (!input.checked) return;
    setFatedContext(app.context, true);
  });

  const divider = document.createElement("hr");
  const anchor = form.querySelector(".roll-twice, .fate");
  if (anchor) anchor.after(divider, row);
  else if (rollButton) rollButton.before(row, divider);
  else form.append(divider, row);

  window.setTimeout(() => {
    app.setPosition?.({ height: (app.position?.height ?? form.closest(".window-content")?.offsetHeight ?? 0) + 36 });
  }, 0);
}

function addChatContextOptions(_html, options) {
  if (options.some((option) => option.name === "GLDDF.Context.AddFateDie")) return;

  options.push({
    name: "GLDDF.Context.AddFateDie",
    icon: '<i class="fa-solid fa-sparkles"></i>',
    condition: (li) => {
      const message = messageFromLi(li);
      return canUserAddFate(message);
    },
    callback: async (li) => {
      const message = messageFromLi(li);
      await safeApplyFateToMessage(message, { source: "context" });
    },
  });
}

function onPF2eReroll(_oldRoll, _newRoll, resource) {
  if (resource?.slug !== "hero-points") return;

  pendingHeroRerolls.push({
    userId: game.user.id,
    createdAt: Date.now(),
  });
  cleanupPendingHeroRerolls();
}

function onCreateChatMessage(message, _options, userId) {
  if (userId !== game.user.id) return;
  if (!isPcCheckMessage(message)) return;

  const context = message.flags?.pf2e?.context;
  if (context?.[FATED_CONTEXT_KEY] || hasContextOption(context, FATED_OPTION)) {
    window.setTimeout(() => safeApplyFateToMessage(message, { source: "dialog" }), 100);
    return;
  }

  if (isHeroPointRerollMessage(message)) {
    window.setTimeout(() => safeApplyFateToMessage(message, { source: "hero-point-reroll" }), 100);
    return;
  }

  const actor = message.actor ?? message.speakerActor;
  const isReroll = !!context?.isReroll;
  const pendingHero = findPendingRoll(pendingHeroRerolls, actor?.uuid, userId);
  if (isReroll && pendingHero) {
    pendingHeroRerolls.splice(pendingHeroRerolls.indexOf(pendingHero), 1);
    window.setTimeout(() => safeApplyFateToMessage(message, { source: "hero-point-reroll" }), 100);
  }
}

function setFatedContext(context, fated) {
  if (!context) return;
  context[FATED_CONTEXT_KEY] = fated;
  context.options ??= new Set();
  if (Array.isArray(context.options)) context.options = new Set(context.options);
  if (fated) context.options.add(FATED_OPTION);
  else context.options.delete(FATED_OPTION);
}

function hasContextOption(context, option) {
  const options = context?.options;
  return options instanceof Set ? options.has(option) : Array.isArray(options) ? options.includes(option) : false;
}

function isHeroPointRerollMessage(message) {
  const context = message.flags?.pf2e?.context;
  return !!context?.isReroll && hasContextOption(context, "check:reroll:hero-points");
}

function messageFromLi(li) {
  const id = li?.dataset?.messageId ?? li?.attr?.("data-message-id");
  return id ? game.messages.get(id) : null;
}

function normalizeHtml(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function findPendingRoll(pendingRolls, actorUuid, userId) {
  const now = Date.now();
  return pendingRolls.find((pending) => {
    if (now - pending.createdAt >= 15000) return false;
    if (pending.actorUuid && actorUuid) return pending.actorUuid === actorUuid;
    return pending.userId === userId;
  });
}

async function safeApplyFateToMessage(message, options) {
  try {
    return await applyFateToMessage(message, options);
  } catch (error) {
    console.error("GLUniverse Destiny Dice | Failed to apply Fate Die", error);
    ui.notifications.error(game.i18n.localize("GLDDF.Notify.RollFailed"));
    return null;
  }
}

function cleanupPendingHeroRerolls() {
  const cutoff = Date.now() - 30000;
  for (let index = pendingHeroRerolls.length - 1; index >= 0; index -= 1) {
    if (pendingHeroRerolls[index].createdAt < cutoff) pendingHeroRerolls.splice(index, 1);
  }
}

export { FATED_CONTEXT_KEY };
