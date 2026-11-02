/**
 * Diorama — the props of a scene: the only reader and writer of FLAG_PROPS
 * (STUB, contract only).
 *
 *   PropStore.read(scene) → Prop[]            normalised (terrain/props.mjs)
 *   PropStore.write(scene, Prop[])            forced replacement, GM only
 *   PropStore.touched(changes) → bool         an updateScene diff moved FLAG_PROPS
 *   PropStore.states(scene, { isGM }) → PropState[]  what the renderer draws
 */

export const PropStore = {
  read() { return []; },
  async write() {},
  touched() { return false; },
  states() { return []; },
};
