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
// Stream Pacer's Dire Peril splash: one beat, ended exactly once whether it
// runs out or the peril ends under it. Its timings come from const.js, and the
// WebGL field it was handed stops with it.
{
  const { MOTION, TIMING } = await import('../scripts/features/stream-pacer/const.js');
  Object.assign(ctx, { MOTION, TIMING });
  const source = (await fs.readFile(new URL('../scripts/features/stream-pacer/band.js', import.meta.url), 'utf8'))
    .replace(/^import [\s\S]*?;\r?\n/gm, '')
    .replace('export class SignalBand', 'globalThis.SignalBand = class SignalBand')
    .replace('export function playPerilSplash', 'globalThis.playPerilSplash = function playPerilSplash');
  vm.runInContext(source, ctx);
  const splashNode = () => {
    const n = node();
    n.props = {};
    n.style = { setProperty: (k, v) => { n.props[k] = v; } };
    n.setAttribute = () => {};
    n.querySelector = () => node();
    n.querySelectorAll = () => [node(), node()];
    n.addEventListener = () => { throw new Error('the splash takes no input'); };
    return n;
  };
  for (const end of ['runs out', 'peril ends', 'both']) {
    ctx.document.createElement = splashNode;
    const parent = node();
    let done = 0;
    const field = { played: null, stopped: 0, play(ms) { this.played = ms; return true; }, stop() { this.stopped++; } };
    const { el, finish, timeline: tl } = ctx.playPerilSplash({ html: '<i></i>', field, parent, onDone: () => done++ });
    assert.equal(parent.children[0], el, 'the splash mounts into its parent');
    assert.equal(el.props['--sp-peril-stage'], `${TIMING.perilStage}ms`, 'the stage length the CSS reads is TIMING.perilStage');
    assert.equal(field.played, TIMING.perilStage, 'the field plays for the stage length');
    const [line1, line2, fade] = tl.adds;
    assert.equal(tl.adds.length, 3, 'two title lines and the stage fade, on one timeline');
    assert.deepEqual([line1[2], line2[2]], [MOTION.perilLine1At, MOTION.perilLine2At], 'the title lines land at MOTION.perilLine1At and perilLine2At');
    assert.ok([line1, line2].every((a) => a[1].duration === MOTION.perilLetter && a[1].duration > 0), 'a title letter lands over MOTION.perilLetter');
    assert.equal(fade[0], el, 'the last tween is the fade of the whole stage');
    assert.equal(fade[1].duration, TIMING.perilFade, 'the stage fades over TIMING.perilFade');
    assert.equal(fade[2] + fade[1].duration, TIMING.perilStage, 'the fade ends exactly at TIMING.perilStage');
    const unmount = tl.calls.at(-1);
    assert.equal(unmount.at, TIMING.perilStage, 'the stage unmounts at TIMING.perilStage');
    if (end !== 'peril ends') unmount.fn();
    if (end !== 'runs out') finish();
    assert.equal(done, 1, `the splash ends exactly once (${end})`);
    assert.equal(field.stopped, 1, `the field stops with it (${end})`);
    assert.equal(el.removed, true, `the splash leaves the DOM (${end})`);
    assert.ok(tl.reverted, `the splash timeline is released (${end})`);
  }
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
