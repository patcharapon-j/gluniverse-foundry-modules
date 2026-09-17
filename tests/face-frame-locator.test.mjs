import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, test } from "node:test";

// Two Foundry clients (a GM and a player) in one process: `game` resolves to whichever client's
// context the code is running in, and the suite socket delivers to the other client.
const als = new AsyncLocalStorage();
globalThis.game = new Proxy({}, { get: (_, key) => als.getStore()?.[key] });

const { FaceLocator, isSocketPayload } = await import("../scripts/core/face-frame.mjs");

const SRC = "worlds/test/art/hero.webp";
const HEAD = { k: "s", w: 100, h: 150, b: [0.4, 0.1, 0.2, 0.15], tier: "detector" };
const NONE = { k: "n", w: 100, h: 150 };

function world({ gmOnline = true, mode = "heads" } = {}) {
  const state = { gmOnline, mode, cache: {}, writes: 0 };
  const clients = [];
  const gmUser = { id: "gm", isGM: true };
  const settings = {
    get: (_, key) => (key === "core.faceFrameCache" ? state.cache : state.mode),
    set: async (_, key, value) => {
      state.cache = value;
      state.writes++;
      for (const client of clients) run(client, () => client.locator.adoptWorld(value));
    }
  };
  const client = (user) => {
    const self = { user, analysed: [], locator: new FaceLocator() };
    self.ctx = {
      user,
      users: { get activeGM() { return state.gmOnline ? gmUser : null; } },
      actors: [{ img: SRC }],
      scenes: [],
      settings,
      socket: {
        emit: (_, message) => {
          const { __feature, __claimedSender, ...payload } = message;
          for (const other of clients) {
            if (other === self) continue;
            setTimeout(() => run(other, () => isSocketPayload(payload) && other.locator.handleSocket(payload)), 1);
          }
        }
      }
    };
    self.result = HEAD;
    self.locator.analyse = async (src) => {
      self.analysed.push(src);
      if (self.result instanceof Error) throw self.result;
      return { ...self.result, m: state.mode };
    };
    clients.push(self);
    return self;
  };
  const gm = client(gmUser);
  const player = client({ id: "player", isGM: false });
  return { state, gm, player };
}

const run = (client, fn) => als.run(client.ctx, fn);
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe("FaceLocator", () => {
  test("a player gets the GM's result and never runs the models itself", async () => {
    const { state, gm, player } = world();
    const entry = await run(player, () => player.locator.request(SRC));
    assert.equal(entry.k, "s");
    assert.deepEqual(gm.analysed, [SRC]);
    assert.deepEqual(player.analysed, []);
    await tick();
    assert.equal(state.cache[SRC].k, "s", "the GM shared it");
    assert.equal(state.writes, 1);
    assert.equal(run(player, () => player.locator.peek(SRC)).k, "s");
    assert.equal(player.locator.inflight.size, 0);
  });

  test("a GM answering from its own cache still replies and shares", async () => {
    const { state, gm, player } = world();
    run(gm, () => gm.locator.remember(SRC, { ...HEAD, m: "heads" }, true));
    state.cache = {};
    gm.locator.world = {};
    player.locator.world = {};
    const entry = await run(player, () => player.locator.request(SRC));
    assert.equal(entry.k, "s");
    assert.deepEqual(gm.analysed, []);
    // remember() above already wrote once, so this write waits out the throttle.
    await tick(4100);
    assert.ok(state.cache[SRC]);
  });

  test("without a GM, or when the GM fails, the player analyses locally at once", async () => {
    const offline = world({ gmOnline: false });
    assert.equal((await run(offline.player, () => offline.player.locator.request(SRC))).k, "s");
    assert.deepEqual(offline.player.analysed, [SRC]);

    const failing = world();
    failing.gm.result = new Error("models unavailable");
    const started = Date.now();
    assert.equal((await run(failing.player, () => failing.player.locator.request(SRC))).k, "s");
    assert.deepEqual(failing.player.analysed, [SRC]);
    assert.ok(Date.now() - started < 1000, "no 45 s wait");
    assert.ok(run(failing.gm, () => failing.gm.locator.failedRecently(SRC)));
  });

  test("turning framing off while images are queued remembers nothing", async () => {
    const { state, gm } = world();
    const pending = ["a.webp", "b.webp", "c.webp"].map(src => run(gm, () => gm.locator.request(src)));
    state.mode = "off";
    const results = await Promise.all(pending);
    assert.equal(results.at(-1), null);
    state.mode = "heads";
    assert.equal(run(gm, () => gm.locator.peek("c.webp")), undefined, "still unanalysed");
  });

  test("enabling creatures re-analyses art where the head pass found nothing", async () => {
    const { state, gm } = world();
    gm.result = NONE;
    await run(gm, () => gm.locator.request(SRC));
    await tick();
    assert.equal(state.cache[SRC].k, "n");
    state.mode = "creatures";
    assert.equal(run(gm, () => gm.locator.peek(SRC)), undefined);
    gm.result = HEAD;
    assert.equal((await run(gm, () => gm.locator.request(SRC))).k, "s");
    await tick(4100);
    assert.equal(state.cache[SRC].k, "s", "the world cache was upgraded");
  });

  test("a player's forget makes the GM analyse again and the player sees the new result", async () => {
    const { state, gm, player } = world();
    await run(player, () => player.locator.request(SRC));
    await tick();
    gm.result = { ...HEAD, b: [0.1, 0.1, 0.2, 0.15] };
    await run(player, () => player.locator.forget(SRC));
    assert.equal(run(player, () => player.locator.peek(SRC)), undefined, "the old world entry is ignored");
    const entry = await run(player, () => player.locator.request(SRC));
    assert.equal(entry.b[0], 0.1);
    assert.equal(gm.analysed.length, 2);
    await tick(4100);
    assert.equal(state.cache[SRC].b[0], 0.1);
    assert.equal(run(player, () => player.locator.peek(SRC)).b[0], 0.1);
    assert.deepEqual(player.analysed, []);
  });

  test("the GM ignores requests for art the world does not use", async () => {
    const { gm } = world();
    run(gm, () => gm.locator.handleSocket({ op: "request", src: "https://example.com/x.png" }));
    await tick();
    assert.deepEqual(gm.analysed, []);
    assert.ok(!isSocketPayload({ op: "result", src: SRC, entry: { k: "s", w: 1, h: 1 } }), "malformed entries are dropped");
    assert.ok(!isSocketPayload({ op: "delete", src: SRC }));
  });
});
