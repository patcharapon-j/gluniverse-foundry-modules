/** Lifecycle checks without Foundry: execute adapters with injected motion/DOM. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const timelines = [];
const timeline = () => {
  const t = { calls: [], adds: [], add(...a) { this.adds.push(a); return this; }, call(fn, at) { this.calls.push({fn, at}); return this; }, play() {}, revert() { this.reverted = true; } };
  timelines.push(t); return t;
};
const owner = () => { const items = []; return { add(a) { items.push(a); return a; }, clear() { for (const a of items.splice(0)) a.revert(); } }; };
const classes = () => { const values = new Set(); return { add: (...a) => a.forEach(x => values.add(x)), remove: (...a) => a.forEach(x => values.delete(x)), contains: x => values.has(x) }; };
const node = () => ({ classList: classes(), style: { setProperty() {} }, children: [], appendChild(n) { this.children.push(n); }, remove() { this.removed = true; }, querySelectorAll() { return []; } });
const ctx = vm.createContext({ console, Math, FEATURE_ID: 'stream-pacer', createTimeline: timeline, createMotionOwner: owner, motionDuration: n => n, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, document: { createElement: node }, animate: () => timeline(), stagger: n => n, featurePath: () => '' });
async function load(path, name) {
  const source = (await fs.readFile(new URL('../' + path, import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('export class ' + name, 'globalThis.' + name + ' = class ' + name);
  vm.runInContext(source, ctx);
  return ctx[name];
}
const DiceSlot = await load('scripts/features/clocks-tracker/delving/dice-slot.js', 'DiceSlot');
const host = Object.assign(node(), { dataset: {}, closest: () => null, clientWidth: 200, clientHeight: 56 });
let settled = 0;
const slot = DiceSlot.mount(host, { faces: [1, 6, 3], size: 6, discard: 2 }, () => settled++);
slot._spin();
const roll = timelines.at(-1);
assert.deepEqual(Array.from(slot.reels, r => r.strip.children.at(-1).textContent), ['1', '6', '3']);
const reveal = roll.calls.find(c => c.at === 1380);
assert.ok(reveal, 'discard waits for last reel plus reveal hold');
assert.equal(slot.reels[0].reel.classList.contains('drop'), false);
reveal.fn();
assert.equal(slot.reels[0].reel.classList.contains('drop'), true);
assert.equal(slot.reels[1].reel.classList.contains('drop'), false);
slot.destroy(); slot.destroy();
assert.equal(settled, 1, 'settle exactly once under interruption');
assert.equal(roll.reverted, true);
assert.equal(host.classList.contains('dx-tumbling'), false);
// Stream Pacer's Dire Peril splash: one beat, lifted exactly once whether it
// finishes, is clicked away, or both. Its timings come from const.js.
{
  const { MOTION, TIMING } = await import('../scripts/features/stream-pacer/const.js');
  Object.assign(ctx, { MOTION, TIMING });
  const tweens = [];
  ctx.animate = (target, options) => { const t = timeline(); t.target = target; t.options = options; tweens.push(t); return t; };
  const source = (await fs.readFile(new URL('../scripts/features/stream-pacer/band.js', import.meta.url), 'utf8'))
    .replace(/^import [\s\S]*?;\r?\n/gm, '')
    .replace('export class SignalBand', 'globalThis.SignalBand = class SignalBand')
    .replace('export function playPerilSplash', 'globalThis.playPerilSplash = function playPerilSplash');
  vm.runInContext(source, ctx);
  const splashNode = () => {
    const n = node();
    n.listeners = {};
    n.setAttribute = () => {};
    n.querySelector = () => node();
    n.querySelectorAll = () => [node(), node()];
    n.addEventListener = (type, fn) => { n.listeners[type] = fn; };
    return n;
  };
  for (const end of ['finish', 'click', 'both']) {
    tweens.length = 0;
    ctx.document.createElement = splashNode;
    const parent = node();
    let done = 0;
    const { el } = ctx.playPerilSplash({ html: '<i></i>', parent, onDone: () => done++ });
    assert.equal(parent.children[0], el, 'the splash mounts into its parent');
    const lift = tweens.at(-1);
    assert.equal(lift.target, el, 'the last tween is the lift of the whole splash');
    assert.equal(lift.options.delay, TIMING.perilHold, 'the splash holds for TIMING.perilHold');
    assert.equal(lift.options.duration, TIMING.perilLift, 'the splash lifts over TIMING.perilLift');
    if (end !== 'click') lift.options.onComplete();
    if (end !== 'finish') el.listeners.click();
    assert.equal(done, 1, `the splash ends exactly once (${end})`);
    assert.equal(el.removed, true, `the splash leaves the DOM (${end})`);
    assert.ok(tweens.every((t) => t.reverted), `every splash tween is released (${end})`);
  }
  for (const t of tweens) assert.ok(!Number.isFinite(t.options.duration) || t.options.duration > 0, 'no zero-length beat at the default tier');
}
// a Windows checkout may carry CRLF; the slice below is written against LF
const hudSource = (await fs.readFile(new URL('../scripts/features/clocks-tracker/apps/hud.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const tweenMethod = hudSource.slice(hudSource.indexOf('  _tweenBar('), hudSource.indexOf('  /**\n   * Compact value-flash:'));
vm.runInContext('globalThis.hudTween = ({' + tweenMethod + '})._tweenBar;', ctx);
let tweenOptions;
ctx.animate = (bar, options) => { tweenOptions = options; return timeline(); };
const hudOwner = owner(); hudOwner.forget = () => {};
const hud = { _barMotion: hudOwner };
const bar = { style: { transition: 'width 1s ease', width: '' } };
ctx.hudTween.call(hud, bar, 40, 200, 420, () => {});
assert.equal(bar.style.transition, 'none');
hudOwner.clear();
assert.equal(bar.style.transition, 'width 1s ease', 'interrupted width motion restores CSS');
let completed = false;
ctx.hudTween.call(hud, bar, 200, 40, 420, () => { completed = true; });
tweenOptions.onComplete();
assert.equal(bar.style.width, '', 'completed tween releases intrinsic width');
assert.equal(completed, true);
console.log('Clocks/Pacer motion checks passed: outcomes, reveal order, exactly-once settle, cancellation, Dire Peril splash lifted once.');
