/**
 * Roleplay Chat — the switch above the chat box.
 *
 * Foundry moves its one chat box between the sidebar, the popped-out chat and the notification area
 * whenever the sidebar collapses or the chat pops out, and fires `renderChatInput` each time. The bar
 * and the hint follow it there on every call, so the switch is wherever the box is.
 *
 * The box itself only takes a mode attribute (its tint and, for Do and Think, the serif italic it will
 * appear in) and a placeholder. The placeholder is Foundry's own `--chat-message-placeholder`
 * property on v14, and the `placeholder` attribute on v13's textarea.
 */

import { CSS, HOOKS, KEYBINDINGS } from "./constants.mjs";
import {
  I18N,
  SUB_MODES,
  bindingMatches,
  chooseIc,
  chooseSub,
  composerMode,
  cssString,
  cycleSub,
  humanizeBinding,
  toggleIc
} from "./model.mjs";
import { barHTML, hintHTML } from "./render.mjs";
import { bindingsFor, getComposer, setComposer } from "./settings.mjs";
import { currentSpeaker, pick, pickerModel } from "./speaker.mjs";
import { armSend } from "./send.mjs";

const loc = (key) => game.i18n.localize(key);

let input = null;
let bar = null;
let hint = null;
let pickerOpen = false;
let queued = false;
const wired = new WeakSet();

function labels() {
  return {
    switchLabel: loc("GLRP.switch.label"),
    subLabel: loc("GLRP.switch.subLabel"),
    ooc: loc("GLRP.switch.ooc"),
    ic: loc("GLRP.switch.ic"),
    sub: Object.fromEntries(SUB_MODES.map((m) => [m, loc(I18N.sub(m))])),
    source: { auto: loc(I18N.source("auto")), pinned: loc(I18N.source("pinned")) },
    chipTitle: loc("GLRP.chip.title"),
    pickerLabel: loc("GLRP.picker.label"),
    toggleHint: loc("GLRP.hint.toggle"),
    cycleHint: loc("GLRP.hint.cycle"),
    noSpeaker: loc(game.user?.isGM ? "GLRP.hint.noSpeakerGM" : "GLRP.hint.noSpeaker")
  };
}

/** The chat box, as Foundry handed it over (v14 `<prose-mirror>`, v13 `<textarea>`). */
export function mountComposer(element) {
  const el = element instanceof HTMLElement ? element : document.getElementById("chat-message");
  if (!el) return;
  input = el;
  bar ??= buildBar();
  hint ??= buildHint();
  // Before the box and after it, wherever Foundry has put the box this time.
  if (bar.nextElementSibling !== el) el.before(bar);
  if (hint.previousElementSibling !== el) el.after(hint);
  if (!wired.has(el)) {
    el.addEventListener("keydown", onKeyDown, { capture: true });
    wired.add(el);
  }
  render();
}

function buildBar() {
  const el = document.createElement("div");
  el.id = CSS.bar;
  el.className = `${CSS.bar} gl-type`;
  el.addEventListener("click", onClick);
  // A press on the switch must not take the caret out of the box: the writer is mid-sentence.
  el.addEventListener("mousedown", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  });
  return el;
}

function buildHint() {
  const el = document.createElement("div");
  el.id = CSS.hint;
  el.className = `${CSS.hint} gl-type`;
  return el;
}

/** Re-draw on the next frame, however many reasons arrived in this one. */
export function scheduleRender() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    render();
  });
}

export function render() {
  if (!bar || !input) return;
  const speaker = currentSpeaker();
  const state = getComposer();
  const mode = composerMode(state, speaker?.kind ?? null);
  const canIc = Boolean(speaker);
  if (!canIc) pickerOpen = false;
  const L = labels();
  bar.innerHTML = barHTML({
    mode,
    canIc,
    sub: state.sub,
    speaker: speaker
      ? { name: speaker.name, img: speaker.img, source: game.user?.isGM ? speaker.source : null, narrator: speaker.kind === "narrator" }
      : null,
    pickerOpen,
    picker: pickerOpen ? pickerModel() : null
  }, L);
  bar.dataset.glrpMode = mode;
  hint.dataset.glrpMode = mode;
  hint.innerHTML = hintHTML({
    canIc,
    toggle: humanizeBinding(bindingsFor(KEYBINDINGS.toggle)[0]),
    cycle: humanizeBinding(bindingsFor(KEYBINDINGS.cycle)[0])
  }, L);
  input.dataset.glrpMode = mode;
  const placeholder = game.i18n.format(I18N.placeholder(mode), { name: speaker?.name ?? "" });
  if (input instanceof HTMLTextAreaElement) input.placeholder = placeholder;
  else input.style.setProperty("--chat-message-placeholder", cssString(placeholder));
  Hooks.callAll(HOOKS.composerChanged, { mode, speaker: speaker ? { kind: speaker.kind, name: speaker.name } : null });
}

/** Put the box back as Foundry made it (the feature switched off without a reload). */
export function unmountComposer() {
  bar?.remove();
  hint?.remove();
  if (input) {
    delete input.dataset.glrpMode;
    input.style.setProperty("--chat-message-placeholder", cssString(loc("CHAT.EnterMessage")));
    input.removeEventListener("keydown", onKeyDown, { capture: true });
    wired.delete(input);
  }
  bar = hint = input = null;
  document.removeEventListener("pointerdown", onOutside, true);
}

/* ── changing the mode ─────────────────────────────────────────────────────── */

async function update(next) {
  await setComposer(next);
  render();
}

export function toggle() {
  return update(toggleIc(getComposer(), Boolean(currentSpeaker())));
}

export function cycle() {
  return update(cycleSub(getComposer(), Boolean(currentSpeaker())));
}

function onKeyDown(event) {
  if (event.isComposing) return;
  if (event.key === "Escape" && pickerOpen) {
    setPicker(false);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    armSend();
    return;
  }
  const match = (action) => bindingsFor(action).some((binding) => bindingMatches(event, binding));
  let act = null;
  if (match(KEYBINDINGS.toggle)) act = toggle;
  else if (match(KEYBINDINGS.cycle)) act = cycle;
  if (!act) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) act();
}

async function onClick(event) {
  const button = event.target instanceof Element ? event.target.closest("[data-glrp-action]") : null;
  if (!button || button.disabled) return;
  event.preventDefault();
  const speaker = currentSpeaker();
  switch (button.dataset.glrpAction) {
    case "ooc":
      return update(chooseIc(getComposer(), false, Boolean(speaker)));
    case "ic":
      return update(chooseIc(getComposer(), true, Boolean(speaker)));
    case "sub":
      return update(chooseSub(getComposer(), button.dataset.glrpSub));
    case "picker":
      return setPicker(!pickerOpen);
    case "pick":
      pickerOpen = false;
      document.removeEventListener("pointerdown", onOutside, true);
      await pick(button.dataset.glrpKey);
      render();
      input?.focus?.();
      return;
  }
}

function setPicker(open) {
  pickerOpen = Boolean(open);
  if (pickerOpen) document.addEventListener("pointerdown", onOutside, true);
  else document.removeEventListener("pointerdown", onOutside, true);
  render();
}

function onOutside(event) {
  if (bar?.contains(event.target)) return;
  setPicker(false);
}
