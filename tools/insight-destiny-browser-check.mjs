/** Browser-only production checks. Serve repository, then import and run this module. */
import { renderNotification, disposeNotification } from '../scripts/features/insight/module/notification.mjs';
import { registerFateRendering } from '../scripts/features/destiny-dice/fate-result.mjs';
import { engine } from '../scripts/vendor/animejs/engine/engine.js';

export async function runInsightDestinyMotionChecks() {
  const results = [];
  const assert = (condition, description) => {
    if (!condition) throw new Error(description);
    results.push(description);
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const opacity = el => Number(getComputedStyle(el).opacity);
  const roots = () => { let count = 0; for (let node = engine._head; node; node = node._next) count++; return count; };
  const previous = { game: globalThis.game, foundry: globalThis.foundry, Hooks: globalThis.Hooks,
    scale: document.body.style.getPropertyValue('--gl-motion-scale'), priority: document.body.style.getPropertyPriority('--gl-motion-scale') };
  const stages = [];
  const chat = document.createElement('div');
  chat.innerHTML = '<div class="message-content"></div>';
  document.body.appendChild(chat);
  let speed = 'normal';
  const markup = await (await fetch('/templates/insight/notification.hbs')).text();
  let attach;
  try {
    globalThis.game = { settings: { get: (_scope, key) => key === 'insight.animationSpeed' ? speed : key === 'insight.soundEnabled' ? false : undefined } };
    globalThis.foundry = { applications: { handlebars: { renderTemplate: async (_path, data) => {
      let html = markup.replace(/\{\{!--[\s\S]*?--\}\}/g, '');
      html = html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_m, key, yes, no) => data[key] ? yes : no ?? '');
      return html.replace(/\{\{localize "([^"]+)"\}\}/g, (_m, key) => key)
        .replace(/\{\{\{(\w+)\}\}\}/g, (_m, key) => data[key] ?? '')
        .replace(/\{\{(\w+)\}\}/g, (_m, key) => data[key] ?? '');
    } } } };
    globalThis.Hooks = { on: (name, fn) => { if (name === 'renderChatMessageHTML') attach = fn; } };
    document.body.style.setProperty('--gl-motion-scale', '1');
    const make = async callback => {
      const stage = await renderNotification({ id: crypto.randomUUID(), title: 'Motion verification', body: 'Readable production content.', theme: 'dreadlight' }, callback);
      stages.push(stage); return stage;
    };
    let released = 0;
    const stage = await make(() => released++);
    assert(opacity(stage.querySelector('.insight-body')) < .1, 'Insight initially conceals its body');
    await wait(2550);
    assert(opacity(stage.querySelector('.insight-body')) > .99, 'Insight actual timeline reveals readable body');
    assert(opacity(stage.querySelector('.insight-fracture-card')) > .99, 'Insight actual timeline opens card');
    assert(getComputedStyle(stage.querySelector('.insight-fracture-card')).clipPath === 'none', 'Insight settled card releases clipping so depth slab can extend');
    const beforeExit = stage.querySelector('.insight-notification').getBoundingClientRect();
    const button = stage.querySelector('.insight-dismiss');
    button.dispatchEvent(new MouseEvent('click')); button.dispatchEvent(new MouseEvent('click'));
    await wait(110);
    const duringExit = stage.querySelector('.insight-notification').getBoundingClientRect();
    assert(Math.abs((duringExit.left + duringExit.width / 2) - (beforeExit.left + beforeExit.width / 2)) < 2, 'Insight exit preserves horizontal percentage centering');
    assert(Math.abs(duringExit.top - beforeExit.top) < 25, 'Insight exit does not jump down when replacing transform');
    await wait(640);
    assert(!stage.isConnected && released === 1, 'Insight double dismissal removes stage and releases once');
    const early = await make(() => released++);
    disposeNotification(early); disposeNotification(early);
    await wait(100);
    assert(!early.isConnected && released === 2, 'Insight early disposal releases once');
    assert(early.querySelector('.insight-body').style.opacity === '', 'Insight early disposal reverts actual animation styles');
    speed = 'instant';
    const instant = await make(() => released++);
    await wait(80);
    assert(opacity(instant.querySelector('.insight-body')) > .99, 'Insight instant mode settles through real Anime.js');
    disposeNotification(instant);
    speed = 'normal'; document.body.style.setProperty('--gl-motion-scale', '0');
    await wait(50);
    const count = roots();
    const zero = await make(() => released++);
    await wait(80);
    assert(opacity(zero.querySelector('.insight-body')) > .99, 'Insight zero suite motion settles');
    assert(roots() <= count, 'Insight zero suite motion creates no infinite ambient clock');
    disposeNotification(zero);
    document.body.style.setProperty('--gl-motion-scale', '1');
    registerFateRendering();
    const fate = { appliedAt: Date.now(), kind: 'opportunity', face: 1, bonus: 0 };
    const message = { id: crypto.randomUUID(), getFlag: () => fate };
    attach(message, chat);
    const first = chat.querySelector('.glddf-fate-strip');
    assert(first.classList.contains('glddf-anime-reveal'), 'Destiny fresh result uses real reveal');
    await wait(100);
    attach(message, chat);
    const second = chat.querySelector('.glddf-fate-strip');
    assert(!second.classList.contains('glddf-anime-reveal') && opacity(second) === 1, 'Destiny immediate rerender stays readable and static');
    assert(first.style.opacity === '' && !first.isConnected, 'Destiny replacement reverts old animation styles');
    fate.appliedAt = Date.now() - 5000;
    attach({ ...message, id: crypto.randomUUID() }, chat);
    assert(!chat.querySelector('.glddf-anime-reveal'), 'Destiny scrollback remains static');
    fate.appliedAt = Date.now();
    attach({ ...message, id: crypto.randomUUID() }, chat);
    const completing = chat.querySelector('.glddf-fate-strip');
    await wait(1000);
    assert(!completing.classList.contains('glddf-anime-reveal') && completing.style.opacity === '', 'Destiny completed timeline cleans styles and marker');
    chat.style.setProperty('--glddf-motion-scale', '1.4');
    fate.appliedAt = Date.now();
    attach({ ...message, id: crypto.randomUUID() }, chat);
    const cinematic = chat.querySelector('.glddf-fate-strip');
    await wait(740);
    assert(cinematic.classList.contains('glddf-anime-reveal'), 'Destiny cinematic local scale extends actual timeline');
    await wait(400);
    assert(!cinematic.classList.contains('glddf-anime-reveal'), 'Destiny cinematic reveal completes and cleans');
    document.body.style.setProperty('--gl-motion-scale', '0');
    const detached = document.createElement('div');
    detached.innerHTML = '<div class="message-content"></div>';
    fate.appliedAt = Date.now();
    attach({ ...message, id: crypto.randomUUID() }, detached);
    await wait(80);
    assert(!detached.querySelector('.glddf-anime-reveal'), 'Destiny detached Foundry render inherits zero suite motion from body');
    return { passed: results.length, assertions: results };
  } finally {
    for (const stage of stages) disposeNotification(stage);
    chat.remove();
    globalThis.game = previous.game; globalThis.foundry = previous.foundry; globalThis.Hooks = previous.Hooks;
    if (previous.scale) document.body.style.setProperty('--gl-motion-scale', previous.scale, previous.priority);
    else document.body.style.removeProperty('--gl-motion-scale');
  }
}
