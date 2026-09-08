/** Actual bundled Anime.js checks; no browser or Foundry globals required. */
import assert from 'node:assert/strict';
import { createCinematicMotion } from '../scripts/features/critical/motion.mjs';
import { TimerMotion } from '../scripts/features/timer/motion.mjs';
import { remainingOf } from '../scripts/features/timer/state.mjs';
import { createMotionOwner, animate } from '../scripts/core/motion.mjs';
import { engine } from '../scripts/vendor/animejs/engine/engine.js';
engine.useDefaultMainLoop = false;
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-7, `${message}: ${a} != ${b}`);
for (const scale of [0, 0.5, 1, 1.4, 3]) {
  const motion = createCinematicMotion(2000, { scale });
  let frame = motion.sample(0);
  near(frame.imgAlpha, scale ? 0 : 1, 'initial alpha');
  for (let t = 10; t <= 2000; t += 10) {
    frame = motion.sample(t);
    for (const key of ['bgAlpha', 'imgAlpha', 'scaleMul', 'wipe', 'lift']) assert.ok(Number.isFinite(frame[key]), `${key} stays finite`);
    assert.ok(frame.imgAlpha >= 0 && frame.imgAlpha <= 1);
    assert.ok(frame.bgAlpha >= 0 && frame.bgAlpha <= 0.85);
  }
  near(frame.imgAlpha, 0, 'same media endpoint regardless of scale');
  near(frame.bgAlpha, 0, 'background gone at endpoint');
  motion.destroy();
}
const seekable = createCinematicMotion(2000);
for (const t of [2000, 1000, 125, 1800, 500, 0, 1500, 2000]) {
  const fresh = createCinematicMotion(2000);
  const expected = fresh.sample(t);
  const actual = seekable.sample(t);
  for (const key of ['bgAlpha', 'imgAlpha', 'scaleMul', 'wipe', 'lift']) near(actual[key], expected[key], `random seek ${t}: ${key}`);
  fresh.destroy();
}
seekable.destroy();
const zero = createCinematicMotion(2000, { scale: 0 });
assert.deepEqual(zero.sample(1999), { bgAlpha: 0.85, imgAlpha: 1, scaleMul: 1, wipe: 1, lift: 0 });
zero.destroy();
const skipped = createCinematicMotion(2000);
near(skipped.sample(1000).imgAlpha, 1, 'a delayed first render still displays the portrait');
skipped.destroy();

let scale = 1;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => String(scale) });
const targets = {
  '.gltimer-face': { y: 0 },
  '.gltimer-sheen-light': { x: '-130%', opacity: 0 },
  '.gltimer-impact': { opacity: 0, scale: 1 },
  '.gltimer-main': { scale: 1 },
};
const timer = new TimerMotion({ querySelector: s => targets[s] });
const tracked = [];
for (const owner of [timer.entrance, timer.accent]) {
  const add = owner.add.bind(owner);
  owner.add = animation => { tracked.push(animation); return add(animation); };
}
timer.reveal();
const entrance = tracked.at(-1);
entrance.seek(920, true);
near(targets['.gltimer-face'].y, 0, 'entrance face endpoint');
near(targets['.gltimer-sheen-light'].opacity, 0, 'sheen vanishes');
timer.emphasize(true);
tracked.at(-1).seek(760, true);
near(targets['.gltimer-impact'].opacity, 0, 'expiry impact vanishes');
near(targets['.gltimer-main'].scale, 1, 'expiry digits settle');
timer.clear();
near(targets['.gltimer-main'].scale, 1, 'cleanup restores scale');
assert.equal(tracked.at(-1).paused, true, 'cleanup pauses expiry timeline');
// Plain object zero capture differs from DOM style removal in Anime.js; the
// browser harness checks the ring returns to CSS opacity zero.
scale = 0;
const count = tracked.length;
timer.reveal(); timer.emphasize(); timer.emphasize(true);
assert.equal(tracked.length, count, 'zero motion creates no decorative animations');
const state = { active: true, running: true, remainingMs: 10000, anchor: 1000 };
assert.equal(remainingOf(state, 6500), 4500, 'countdown follows its authoritative anchor');
assert.equal(remainingOf({ ...state, worldPaused: true }, 6500), 10000, 'world pause freezes state');
const owner = createMotionOwner();
const value = { x: 2 };
const animation = owner.add(animate(value, { x: 10, duration: 100, autoplay: false }));
animation.seek(100, true); near(value.x, 10, 'actual vendor reaches target');
owner.clear(); owner.clear(); near(value.x, 2, 'owner clear is reversible and idempotent');
console.log('Critical/Timer checks passed: vendor endpoints, skipped frames, zero motion, cleanup, authoritative timer.');
