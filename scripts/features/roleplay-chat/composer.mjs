/**
 * Roleplay Chat — the switch above the chat box.
 *
 * Foundry moves its one chat box between the sidebar, the popped-out chat and the notification area
 * whenever the sidebar collapses or the chat pops out, and fires `renderChatInput` each time. The bar
 * follows it there on every call, so the switch is wherever the box is.
 *
 * The box itself only takes a mode attribute (its tone, its spine and, for Do and Think, the serif
 * italic it will appear in), a header and a placeholder. The placeholder is Foundry's own
 * `--chat-message-placeholder` property on v14, and the `placeholder` attribute on v13's textarea.
 *
 * The bar is rebuilt only when its markup changes. A dozen hooks ask for a render (a token selected, an
 * actor renamed, a scene drawn), and rebuilding on every one of them reset the picker's scroll, dropped
 * the hover under the cursor and would replay the tone slab's slide for a mode that never moved.
 */

import { CSS, HOOKS, KEYBINDINGS } from "./constants.mjs";
import {
  I18N,
  SUB_MODES,
  bindingMatches,
  chooseIc,
  chooseSub,
  composerHead,
  composerMode,
  cssString,
  cycleSub,
  humanizeBinding,
  pickerStep,
  toggleIc
} from "./model.mjs";
import { barHTML } from "./render.mjs";
import { bindingsFor, getComposer, setComposer } from "./settings.mjs";
import { currentSpeaker, pick, pickerModel } from "./speaker.mjs";
import { armSend } from "./send.mjs";
import { noteTyping, stop as stopTyping } from "./typing.mjs";

const loc = (key) => game.i18n.localize(key);

let input = null;
let bar = null;
let lastHTML = "";
let pickerOpen = false;
let queued = false;
const wired = new WeakSet();

function labels() {
  return {
    switchLabel: loc("GLRP.switch.label"),
    ooc: loc(I18N.sub("ooc")),
    narrate: loc(I18N.sub("narrator")),
    sub: Object.fromEntries(SUB_MODES.map((m) => [m, loc(I18N.sub(m))])),
    source: { auto: loc(I18N.source("auto")), pinned: loc(I18N.source("pinned")) },
    as: loc("GLRP.chip.as"),
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
  // Right before the box, wherever Foundry has put the box this time.
  if (bar.nextElementSibling !== el) el.before(bar);
  if (!wired.has(el)) {
    el.addEventListener("keydown", onKeyDown, { capture: true });
    el.addEventListener("input", onInput);
    wired.add(el);
  }
  render();
}

function buildBar() {
  const el = document.createElement("div");
  el.id = CSS.bar;
  el.className = `${CSS.bar} gl-type`;
  el.addEventListener("click", onClick);
  el.addEventListener("keydown", onBarKeyDown);
  // A press on the switch must not take the caret out of the box: the writer is mid-sentence.
  el.addEventListener("mousedown", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  });
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
  const html = barHTML({
    mode,
    canIc,
    sub: state.sub,
    speaker: speaker
      ? { name: speaker.name, img: speaker.img, source: game.user?.isGM ? speaker.source : null, narrator: speaker.kind === "narrator" }
      : null,
    pickerOpen,
    picker: pickerOpen ? pickerModel() : null,
    keys: {
      toggle: humanizeBinding(bindingsFor(KEYBINDINGS.toggle)[0]),
      cycle: humanizeBinding(bindingsFor(KEYBINDINGS.cycle)[0])
    }
  }, labels());
  if (html !== lastHTML) paint(html, mode);
  input.dataset.glrpMode = mode;
  const placeholder = game.i18n.format(I18N.placeholder(mode), { name: speaker?.name ?? "" });
  if (input instanceof HTMLTextAreaElement) input.placeholder = placeholder;
  else {
    input.style.setProperty("--chat-message-placeholder", cssString(placeholder));
    // The box's header ("SERI VALEN · SAYS") and the name a Do line will open with.
    input.style.setProperty("--glrp-head", cssString(composerHead({ mode, name: speaker?.name, label: loc(I18N.label(mode)) })));
    input.style.setProperty("--glrp-speaker", cssString(speaker?.name ?? ""));
  }
  Hooks.callAll(HOOKS.composerChanged, { mode, speaker: speaker ? { kind: speaker.kind, name: speaker.name } : null });
  // A switch to OOC mid-sentence, or to another speaker, moves or takes down the "…".
  noteTyping({ mode, speaker, text: boxText() });
}

/**
 * Put new markup in the bar. When the pressed tab moved, the tone slab under it starts from the old
 * column and the old tone and settles on the new ones (`glrp-ink-slide`), so the eye follows the mode
 * across the strip rather than finding it again.
 */
function paint(html, mode) {
  const before = bar.querySelector(".glrp-modes");
  const from = before ? Number(before.dataset.at) : -1;
  const fromCount = before ? before.querySelectorAll(".glrp-mode").length : 0;
  const fromMode = bar.dataset.glrpMode;
  const focused = bar.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  bar.innerHTML = html;
  lastHTML = html;
  bar.dataset.glrpMode = mode;
  const after = bar.querySelector(".glrp-modes");
  const to = after ? Number(after.dataset.at) : -1;
  const ink = after?.querySelector(".glrp-ink");
  if (ink && from >= 0 && to >= 0 && from !== to && fromCount === after.querySelectorAll(".glrp-mode").length) {
    ink.style.setProperty("--glrp-from", String(from - to));
    if (fromMode) ink.style.setProperty("--glrp-from-tone", `var(--glrp-${fromMode === "narrator" ? "narr" : fromMode})`);
    ink.classList.add("glrp-ink-slide");
  }
  // Keyboard focus survives a repaint: the same control, found by what it does.
  if (focused) bar.querySelector(focused)?.focus({ preventScroll: true });
}

function focusKey(el) {
  const btn = el?.closest?.("[data-glrp-action]");
  if (!btn) return null;
  const { glrpAction: action, glrpSub: sub, glrpKey: key } = btn.dataset;
  if (key) return `[data-glrp-key="${CSS_escape(key)}"]`;
  return sub ? `[data-glrp-sub="${sub}"]` : `[data-glrp-action="${action}"]`;
}

const CSS_escape = (value) => (globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));

/** What is in the box right now, as text. */
function boxText() {
  if (!input) return "";
  if (input instanceof HTMLTextAreaElement) return input.value;
  return input.querySelector(".editor-content")?.textContent ?? "";
}

function onInput() {
  const speaker = currentSpeaker();
  noteTyping({ mode: composerMode(getComposer(), speaker?.kind ?? null), speaker, text: boxText() });
}

/**
 * Re-decide the "…" without a keystroke: the writer switched Foundry's message mode to a whisper or
 * back while a line sat in the box. Without it a pill announced for a public line stayed up over a
 * line now going to the GM alone, until the next key or its expiry.
 */
export function refreshTyping() {
  if (input) onInput();
}

/** Put the box back as Foundry made it (the feature switched off without a reload). */
export function unmountComposer() {
  stopTyping();
  bar?.remove();
  if (input) {
    delete input.dataset.glrpMode;
    input.style.setProperty("--chat-message-placeholder", cssString(loc("CHAT.EnterMessage")));
    input.style.removeProperty("--glrp-head");
    input.style.removeProperty("--glrp-speaker");
    input.removeEventListener("keydown", onKeyDown, { capture: true });
    input.removeEventListener("input", onInput);
    wired.delete(input);
  }
  bar = input = null;
  lastHTML = "";
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
    stopTyping();
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

/** Keys inside the bar: the picker's arrows, and Escape back to the box. */
function onBarKeyDown(event) {
  if (!pickerOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    setPicker(false);
    input?.focus?.();
    return;
  }
  const rows = [...bar.querySelectorAll(".glrp-picker-row")];
  const next = pickerStep(rows.indexOf(document.activeElement), rows.length, event.key);
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  rows[next]?.focus();
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
      return setPicker(!pickerOpen, event.detail === 0);
    case "pick":
      pickerOpen = false;
      document.removeEventListener("pointerdown", onOutside, true);
      await pick(button.dataset.glrpKey);
      render();
      input?.focus?.();
      return;
  }
}

/** Open or close the picker. Opened from the keyboard, focus lands on the selected row. */
function setPicker(open, fromKeyboard = false) {
  pickerOpen = Boolean(open);
  if (pickerOpen) document.addEventListener("pointerdown", onOutside, true);
  else document.removeEventListener("pointerdown", onOutside, true);
  render();
  if (pickerOpen && fromKeyboard) {
    const row = bar?.querySelector('.glrp-picker-row[aria-selected="true"]') ?? bar?.querySelector(".glrp-picker-row");
    row?.focus();
  }
}

function onOutside(event) {
  if (bar?.contains(event.target)) return;
  setPicker(false);
}
