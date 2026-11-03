/**
 * Where a fate comes from in PF2e: the Fated Roll switch in the check dialog, a
 * hero point reroll, and "Add Fate Die" on a chat card.
 *
 * ONE road writes. Both automatic sources are read off the posted message itself
 * (its `flags.pf2e.context.options`) in `createChatMessage`, on the author's
 * client only, and go through `applyFate`.
 *
 * The old version also replaced `game.pf2e.Check.roll` and
 * `Check.rerollFromMessage` with wrappers of its own, and listened to
 * `pf2e.reroll`, so a fated check had two roads to a fate (the callback and the
 * hook) and a hero point reroll had three. They were held apart only by an
 * in-flight set. The wrappers are gone: PF2e already writes
 * `check:reroll:hero-points` onto a hero point reroll, and the switch's option
 * survives into the message because PF2e copies `context.options` there. Not
 * patching `Check.roll` also keeps this feature off the target Spotlight Roll
 * and Combat Intro wrap through libWrapper.
 */

import { FATED_OPTION } from "./constants.mjs";
import { applyFate, autoSource, canAddFate, isPcCheckMessage } from "./apply.mjs";
import { renderFatedToggle } from "./view.mjs";
import { t } from "./settings.mjs";

const CONTEXT_ENTRY = "GLDDF.Context.AddFateDie";

export function registerPF2eIntegration() {
  Hooks.on("renderCheckModifiersDialog", injectFatedToggle);
  Hooks.on("getChatMessageContextOptions", addContextOption);
  Hooks.on("createChatMessage", onCreateChatMessage);
}

/* PF2e reads `context.options` by reference (it captured the Set before the
   dialog opened), so the option is added to the very collection it holds, never
   to a replacement: swapping an Array for a new Set here would lose it. */
export function setFated(context, fated) {
  if (!context) return;
  context.options ??= new Set();
  const o = context.options;
  if (o instanceof Set) {
    if (fated) o.add(FATED_OPTION);
    else o.delete(FATED_OPTION);
  } else if (Array.isArray(o)) {
    const at = o.indexOf(FATED_OPTION);
    if (fated && at < 0) o.push(FATED_OPTION);
    if (!fated && at >= 0) o.splice(at, 1);
  }
}

export function isFated(context) {
  const o = context?.options;
  return o instanceof Set ? o.has(FATED_OPTION) : Array.isArray(o) ? o.includes(FATED_OPTION) : false;
}

function injectFatedToggle(app, html) {
  const element = html instanceof HTMLElement ? html : html?.[0] ?? null;
  const form = element?.querySelector?.("form") ?? (element?.tagName === "FORM" ? element : null);
  if (!form || form.querySelector(".glddf-fated-roll-row")) return;
  const actor = app?.context?.actor ?? app?.context?.origin?.actor;
  if (!actor?.isOfType?.("character")) return;
  // Initiative is not fateable (see apply.mjs), so it gets no switch.
  if (app.context?.type === "initiative") return;

  const row = document.createElement("div");
  row.className = "glddf-fated-roll-row";
  row.innerHTML = renderFatedToggle({ checked: isFated(app.context), t });
  const input = row.querySelector("input");
  input.addEventListener("change", () => setFated(app.context, input.checked));

  const anchor = form.querySelector(".roll-twice, .fate");
  const submit = form.querySelector("button[type='submit'], button.roll");
  const rule = document.createElement("hr");
  if (anchor) anchor.after(rule, row);
  else if (submit) submit.before(row, rule);
  else form.append(rule, row);
  app.setPosition?.({ height: "auto" });
}

function addContextOption(_app, options) {
  if (options.some((o) => o.name === CONTEXT_ENTRY)) return;
  options.push({
    name: CONTEXT_ENTRY,
    icon: '<i class="fa-solid fa-dice-d6"></i>',
    condition: (li) => canAddFate(messageOf(li)),
    callback: (li) => applyFate(messageOf(li), { source: "context" }),
  });
}

function onCreateChatMessage(message, _options, userId) {
  if (userId !== game.user.id || !isPcCheckMessage(message)) return;
  const source = autoSource(message);
  if (source) applyFate(message, { source, wait: true });
}

function messageOf(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const id = el?.dataset?.messageId ?? el?.closest?.("[data-message-id]")?.dataset?.messageId;
  return id ? game.messages.get(id) : null;
}
