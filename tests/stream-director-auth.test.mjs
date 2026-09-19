/**
 * The attested director channel, driven through the two `updateUser` listeners
 * it actually installs.
 *
 * Every case here failed *silently* in the shipped feature: a trusted director
 * pressed a button, Foundry reported nothing, and the shot did not move. The
 * flag keys contain a dot (`stream.request`), and Foundry does not agree with
 * itself about the shape such a key takes — `setFlag` sends the literal dotted
 * key, `getFlag` and `unsetFlag` treat it as a nested path — so a listener that
 * bracketed the dotted key off the change matched under one shape and matched
 * nothing under the other. Both shapes are exercised below, along with the
 * partial diff a repeated command arrives as.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const SUITE_ID = "gluniverse-foundry-modules";
const REQUEST = "stream.request";
const COMMAND = "stream.command";

/** Foundry's own `getProperty`: the literal key wins, then the dotted walk. */
function getProperty(object, key) {
  if (!key || !object) return undefined;
  if (key in object) return object[key];
  let target = object;
  for (const part of key.split(".")) {
    if (!(target instanceof Object) || !(part in target)) return undefined;
    target = target[part];
  }
  return target;
}

/** A User whose flags are stored in whichever shape the world produces. */
function makeUser({ id, isGM = false, flags = {} }) {
  return {
    id,
    isGM,
    flags,
    getFlag(scope, key) {
      return getProperty(this.flags?.[scope] ?? {}, key);
    },
    async unsetFlag(scope, key) {
      const scoped = this.flags?.[scope];
      if (!scoped) return;
      if (key in scoped) delete scoped[key];
      else {
        const parts = key.split(".");
        const leaf = parts.pop();
        let target = scoped;
        for (const part of parts) target = target?.[part];
        if (target) delete target[leaf];
      }
    },
  };
}

/**
 * Stand the module's world up around a fresh import, so each case starts with
 * its own module-level `delegationRefused` and its own hook list.
 */
async function harness({ trusted = [], gm, users = [] } = {}) {
  const listeners = [];
  const settings = new Map([
    [`${SUITE_ID}.stream.trustedDirectorUserIds`, trusted],
    [`${SUITE_ID}.stream.streamUserId`, ""],
    [`${SUITE_ID}.stream.cameraSettings`, {}],
  ]);
  const written = [];
  const sceneFlags = [];

  globalThis.Hooks = { on: (event, fn) => listeners.push({ event, fn }) };
  globalThis.foundry = { utils: { getProperty } };
  globalThis.game = {
    user: gm,
    users: Object.assign([gm, ...users].filter(Boolean), { activeGM: gm }),
    scenes: { get: (id) => ({ id, setFlag: async (s, k, v) => sceneFlags.push([id, k, v]) }) },
    settings: {
      get: (ns, key) => settings.get(`${ns}.${key}`),
      set: async (ns, key, value) => {
        settings.set(`${ns}.${key}`, value);
        written.push([key, value]);
      },
    },
  };

  const mod = await import(`../scripts/features/stream/director-auth.mjs?case=${Math.random()}`);
  const fire = async (event, ...args) => {
    for (const l of listeners) if (l.event === event) await l.fn(...args);
  };
  return { mod, fire, written, sceneFlags, settings };
}

/** The two shapes a dotted flag key can arrive in, for the same stored value. */
const SHAPES = {
  nested: (key, value) => {
    const parts = key.split(".");
    const leaf = parts.pop();
    const out = {};
    let target = out;
    for (const part of parts) target = target[part] = {};
    target[leaf] = value;
    return out;
  },
  literal: (key, value) => ({ [key]: value }),
};

for (const [name, shape] of Object.entries(SHAPES)) {
  test(`a director's setting request is applied when the change arrives ${name}`, async () => {
    const gm = makeUser({ id: "gm", isGM: true });
    const director = makeUser({ id: "dir" });
    const { mod, fire, written } = await harness({ trusted: ["dir"], gm, users: [director] });
    mod.installDirectorRelay((key, value) => value);

    const request = { kind: "setting", key: "stream.cameraSettings", value: { panSpeed: 12 }, at: 1 };
    director.flags[SUITE_ID] = shape(REQUEST, request);
    await fire("updateUser", director, { flags: { [SUITE_ID]: shape(REQUEST, request) } });

    assert.deepEqual(written, [["stream.cameraSettings", { panSpeed: 12 }]]);
  });

  test(`a director's command reaches the stream client when the change arrives ${name}`, async () => {
    const gm = makeUser({ id: "gm", isGM: true });
    const director = makeUser({ id: "dir" });
    const { mod, fire } = await harness({ trusted: ["dir"], gm, users: [director] });
    const seen = [];
    mod.installCommandListener((command, payload) => seen.push([command, payload]));

    const message = { command: "stop", payload: {}, at: 1 };
    director.flags[SUITE_ID] = shape(COMMAND, message);
    await fire("updateUser", director, { flags: { [SUITE_ID]: shape(COMMAND, message) } });

    assert.deepEqual(seen, [["stop", {}]]);
  });
}

test("a repeated command arrives as a partial diff and is still delivered", async () => {
  // Pressing the same button twice changes only `at`, so the change carries no
  // `command` at all. Reading the value off the change drops it; reading it off
  // the document does not.
  const gm = makeUser({ id: "gm", isGM: true });
  const director = makeUser({ id: "dir" });
  const { mod, fire } = await harness({ trusted: ["dir"], gm, users: [director] });
  const seen = [];
  mod.installCommandListener((command) => seen.push(command));

  director.flags[SUITE_ID] = SHAPES.nested(COMMAND, { command: "toggleRestore", payload: {}, at: 2 });
  await fire("updateUser", director, { flags: { [SUITE_ID]: SHAPES.nested(COMMAND, { at: 2 }) } });

  assert.deepEqual(seen, ["toggleRestore"]);
});

test("clearing the request flag is not read back as a new request", async () => {
  const gm = makeUser({ id: "gm", isGM: true });
  const director = makeUser({ id: "dir" });
  const { mod, fire, written } = await harness({ trusted: ["dir"], gm, users: [director] });
  mod.installDirectorRelay((key, value) => value);

  director.flags[SUITE_ID] = { stream: {} };
  await fire("updateUser", director, { flags: { [SUITE_ID]: { stream: { "-=request": null } } } });

  assert.deepEqual(written, []);
});

test("a request from a user who is not a director is ignored", async () => {
  const gm = makeUser({ id: "gm", isGM: true });
  const player = makeUser({ id: "nobody" });
  const { mod, fire, written } = await harness({ trusted: ["dir"], gm, users: [player] });
  mod.installDirectorRelay((key, value) => value);

  const request = { kind: "setting", key: "stream.cameraSettings", value: { panSpeed: 99 }, at: 1 };
  player.flags[SUITE_ID] = SHAPES.nested(REQUEST, request);
  await fire("updateUser", player, { flags: { [SUITE_ID]: SHAPES.nested(REQUEST, request) } });

  assert.deepEqual(written, []);
});

test("a director cannot appoint themselves through the relay", async () => {
  // The two settings that decide who the feature answers to are not delegable,
  // so one forged or mistaken request must not be a permanent escalation.
  const gm = makeUser({ id: "gm", isGM: true });
  const director = makeUser({ id: "dir" });
  const { mod, fire, written } = await harness({ trusted: ["dir"], gm, users: [director] });
  mod.installDirectorRelay((key, value) => value);

  for (const key of ["stream.trustedDirectorUserIds", "stream.streamUserId"]) {
    const request = { kind: "setting", key, value: ["dir"], at: 1 };
    director.flags[SUITE_ID] = SHAPES.nested(REQUEST, request);
    await fire("updateUser", director, { flags: { [SUITE_ID]: SHAPES.nested(REQUEST, request) } });
  }

  assert.deepEqual(written, []);
});

test("a director's tracked-token request reaches the scene flag", async () => {
  const gm = makeUser({ id: "gm", isGM: true });
  const director = makeUser({ id: "dir" });
  const { mod, fire, sceneFlags } = await harness({ trusted: ["dir"], gm, users: [director] });
  mod.installDirectorRelay((key, value) => value);

  const request = { kind: "sceneFlag", sceneId: "scene1", flagKey: "stream.trackedTokenIds", value: ["t1"], at: 1 };
  director.flags[SUITE_ID] = SHAPES.nested(REQUEST, request);
  await fire("updateUser", director, { flags: { [SUITE_ID]: SHAPES.nested(REQUEST, request) } });

  assert.deepEqual(sceneFlags, [["scene1", "stream.trackedTokenIds", ["t1"]]]);
});
