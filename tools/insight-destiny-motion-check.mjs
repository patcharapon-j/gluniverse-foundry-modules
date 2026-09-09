/** Production lifecycle checks with a controlled motion clock (no Foundry needed). */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const timelines = [];
function createTimeline(options) {
  const timeline = { options, steps: [], paused: false, reverted: false,
    add(target, properties, position) { this.steps.push({ target, properties, position }); return this; },
    call(fn, position) { this.steps.push({ fn, position }); return this; },
    play() { this.playing = true; return this; },
    pause() { this.paused = true; return this; },
    revert() { this.reverted = true; return this; },
  };
  timelines.push(timeline);
  return timeline;
}
function createMotionOwner() {
  const owned = [];
  return { add(a) { owned.push(a); return a; }, clear() { owned.splice(0).forEach(a => a.revert()); } };
}
class Node {
  constructor() {
    this.children = new Map(); this.listeners = {}; this.removed = false; this.style = {};
    this.classList = { add() {}, remove() {}, contains() { return false; } };
  }
  querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Node()); return this.children.get(selector); }
  querySelectorAll() { return []; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  remove() { this.removed = true; }
  insertAdjacentHTML() {}
}
const settings = { 'insight.animationSpeed': 'normal' };
globalThis.game = { settings: { get: (_id, key) => settings[key] } };
globalThis.document = { body: new Node(), createElement: () => ({ firstElementChild: new Node(), set innerHTML(_) {} }) };
document.body.appendChild = () => {};
globalThis.foundry = { applications: { handlebars: { renderTemplate: async () => '' } } };
globalThis.HTMLElement = Node;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "1" });
globalThis.__motion = { animate: (_target, options) => createTimeline(options), createTimeline, createMotionOwner, motionDuration: n => n, stagger: n => n };
async function production(path, preamble) {
  const source = (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  return import(`data:text/javascript;base64,${Buffer.from(`const { animate, createTimeline, createMotionOwner, motionDuration, stagger } = globalThis.__motion;\n${preamble}\n${source}`).toString('base64')}`);
}
const insight = await production('../scripts/features/insight/module/notification.mjs', 'const SUITE_ID="suite", featurePath=()=>"", applyTheme=()=>{}, playSound=()=>{}, playCustomSound=()=>{};');
let released = 0;
const stage = await insight.renderNotification({ id: 'test' }, () => released++);
const reveal = timelines.at(-1);
reveal.options.onComplete();
const ambient = timelines.at(-1);
const button = stage.querySelector('.insight-dismiss');
button.listeners.click();
const exit = timelines.at(-1);
button.listeners.click();
assert.equal(timelines.at(-1), exit, 'double click must not create another exit');
assert.equal(reveal.paused, true, 'dismiss must stop future reveal and sound cues');
assert.equal(ambient.paused, true, 'dismiss must stop ambient motion');
exit.options.onComplete();
exit.options.onComplete();
assert.equal(released, 1, 'queue must release once');
assert.equal(stage.removed, true);
assert.equal(reveal.reverted && exit.reverted, true, 'all motion must be disposed');
settings['insight.animationSpeed'] = 'instant';
const instant = await insight.renderNotification({ id: 'instant' }, () => released++);
assert(timelines.at(-1).steps.every(s => s.position === 0 && (!s.properties || s.properties.duration === 0)));
insight.disposeNotification(instant);
insight.disposeNotification(instant);
assert.equal(released, 2, 'external disposal must release once');
let attach;
globalThis.Hooks = { on: (_name, fn) => { attach = fn; } };
const destiny = await production('../scripts/features/destiny-dice/fate-result.mjs', 'const FATE_DIE_DENOMINATION="f", FATE_DIE_NOTATION="1df", FLAGS={fate:"fate"}, KIND_OPPORTUNITY="opportunity", MODULE_ID="suite", getFaceImagePaths=()=>null, getFateFace=()=>null, getKindLabel=x=>x, normalizeKind=x=>x;');
destiny.registerFateRendering();
const root = new Node();
const fate = { appliedAt: Date.now(), face: 1, kind: 'opportunity', bonus: 0 };
const message = { id: 'fresh', getFlag: () => fate };
const before = timelines.length;
attach(message, root);
assert.equal(timelines.length, before + 1, 'fresh fate gets a reveal');
attach(message, root);
assert.equal(timelines.length, before + 1, 'repeat render stays static');
fate.appliedAt = Date.now() - 5000;
attach({ ...message, id: 'historical' }, root);
assert.equal(timelines.length, before + 1, 'scrollback stays static');
fate.appliedAt = Date.now(); fate.accepted = false;
attach({ ...message, id: 'refused' }, root);
assert.equal(timelines.length, before + 1, 'refused fate stays static');
console.log('Insight/Destiny lifecycle checks passed: cancellation, double dismissal, instant, disposal, fresh/repeated/historical/refused fate.');
