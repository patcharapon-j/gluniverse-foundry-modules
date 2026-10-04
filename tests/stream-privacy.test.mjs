import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { readMessage } from "../scripts/features/stream-cards/pf2e/read-message.js";
import { snapshotMessage } from "../scripts/features/stream-cards/pf2e/snapshot.js";
import { readStatusChange } from "../scripts/features/stream-cards/pf2e/read-status.js";
import { snapshotStatusChange } from "../scripts/features/stream-cards/pf2e/status-snapshot.js";
import { StatusCardFeed } from "../scripts/features/stream-cards/pf2e/status-feed.js";
import { DEFAULT_STATUS_UPDATES } from "../scripts/features/stream-cards/settings.js";
import { DEFAULT_CHAT_FILTER } from "../scripts/features/stream/chat-filter.mjs";

/**
 * What the stream must not say. Every case here renders perfectly when it is wrong — the leak is a
 * number or a name on a screen the players are watching — so each is pinned by the model it produces.
 */

const capture = JSON.parse(readFileSync(new URL("./fixtures/pf2e/capture-player.json", import.meta.url), "utf8"));
const fixture = (label) => structuredClone(capture.messages.find((m) => m.label === label));
const withDerived = (label, patch) => {
  const snapshot = fixture(label);
  Object.assign(snapshot.derived, patch);
  return snapshot;
};

/** The few `game` reads the snapshot builders make, with PF2e's settings set as a test asks. */
function stubGame({ metagameDcs = false, uuids = {} } = {}) {
  globalThis.game = {
    settings: { get: () => undefined },
    pf2e: { settings: { metagame: { dcs: metagameDcs }, tokens: { nameVisibility: false } } }
  };
  globalThis.fromUuidSync = (uuid) => uuids[uuid] ?? null;
}

describe("a DC reaches the stream only where PF2e shows it to players", () => {
  test("a player's strike against an NPC withholds its AC", () => {
    const card = readMessage(fixture("strike-map5"));
    assert.equal(card.roll.dc, 12, "the value stays on the model; the degree came from it");
    assert.equal(card.roll.dcVisible, false);
  });

  test("each of PF2e's three reasons to show it shows it", () => {
    assert.equal(readMessage(withDerived("strike-map5", { opposer: { hasPlayerOwner: true } })).roll.dcVisible, true);
    assert.equal(readMessage(withDerived("strike-map5", { metagameDcs: true })).roll.dcVisible, true);
    const visible = fixture("strike-map5");
    visible.raw.flags.pf2e.context.dc.visible = true;
    assert.equal(readMessage(visible).roll.dcVisible, true);
  });

  test("a GM's roll keeps its DC hidden whatever the opposer", () => {
    const card = readMessage(withDerived("gm-npc-strike", { opposer: { hasPlayerOwner: true }, metagameDcs: true }));
    assert.equal(card.roll.dcVisible, false);
  });

  test("a spell's save DC shows for a player's caster and not for an NPC's", () => {
    assert.equal(readMessage(fixture("spell-save-cast")).spell.dc, 19);
    const npc = fixture("spell-save-cast");
    npc.derived.actor.hasPlayerOwner = false;
    assert.equal(readMessage(npc).spell.dc, null);
    npc.derived.metagameDcs = true;
    assert.equal(readMessage(npc).spell.dc, 19, "the world's metagame setting shows every DC");
  });

  test("the snapshot names the opposer the way PF2e's reroll path does", () => {
    const message = (context, rollerUuid) => ({
      id: "m1",
      flags: { pf2e: { context } },
      actor: { uuid: rollerUuid, name: "Roller" },
      rolls: []
    });
    stubGame({ metagameDcs: true, uuids: { "Actor.pc": { hasPlayerOwner: true }, "Scene.s.Token.t.Actor.npc": { hasPlayerOwner: false } } });
    // A strike: the roller is the origin, so the opposer is the target.
    const strike = snapshotMessage(message({ origin: { actor: "Actor.pc" }, target: { actor: "Scene.s.Token.t.Actor.npc" } }, "Actor.pc"));
    assert.deepEqual(strike.derived.opposer, { hasPlayerOwner: false });
    assert.equal(strike.derived.metagameDcs, true);
    // A save against the NPC's spell: the roller is the target, so the opposer is the origin.
    const save = snapshotMessage(message({ origin: { actor: "Scene.s.Token.t.Actor.npc" }, target: { actor: "Actor.pc" } }, "Actor.pc"));
    assert.deepEqual(save.derived.opposer, { hasPlayerOwner: false });
    // An NPC attacking a PC: the opposer is the PC.
    const npcStrike = snapshotMessage(message({ origin: { actor: "Scene.s.Token.t.Actor.npc" }, target: { actor: "Actor.pc" } }, "Scene.s.Token.t.Actor.npc"));
    assert.deepEqual(npcStrike.derived.opposer, { hasPlayerOwner: true });
    // No context, or nobody on the other side.
    assert.equal(snapshotMessage(message(undefined, "Actor.pc")).derived.opposer, null);
    assert.equal(snapshotMessage(message({ origin: null, target: { actor: "Actor.pc" } }, "Actor.pc")).derived.opposer, null);
  });
});

describe("a player's own blind roll shows that they rolled, never how it went", () => {
  test("a check loses its natural, total, degree, DC and crack, and keeps the Blind visibility", () => {
    const blind = fixture("strike-crit");
    blind.raw.blind = true;
    blind.derived.metagameDcs = true;
    const card = readMessage(blind);
    assert.equal(card.visibility, "ownBlind");
    assert.deepEqual(card.roll, { natural: null, total: null, dc: null, dcVisible: false, degree: null });
    assert.equal(card.fx, null, "a gold crack says critical success in everything but words");
  });

  test("a plain roll loses its total and its faces, and keeps its formula", () => {
    const blind = fixture("skill-nodc");
    blind.raw.blind = true;
    delete blind.raw.flags.pf2e.context;
    blind.derived.rolls = [{ total: 11, formula: "2d6+3", dice: [{ faces: 6, results: [4, 4] }], d20Results: null }];
    const card = readMessage(blind);
    assert.equal(card.kind, "roll");
    assert.equal(card.roll.total, null);
    assert.equal(card.roll.formula, "2d6+3");
    assert.equal(card.action.sub, null, "the faces under the headline are the result too");
  });

  test("a damage roll loses its total, its parts and its crit", () => {
    const blind = fixture("strike-crit-damage");
    blind.raw.blind = true;
    const card = readMessage(blind);
    assert.deepEqual(card.damage, { total: null, parts: [], crit: false });
    assert.equal(card.fx, null);
  });

  test("a public roll is untouched", () => {
    const card = readMessage(fixture("strike-crit"));
    assert.equal(card.visibility, "public");
    assert.equal(card.roll.natural, 20);
    assert.equal(card.fx, "gold");
  });
});

describe("status cards", () => {
  const settings = { ...DEFAULT_STATUS_UPDATES, enabled: true };
  // Effects ship switched off; these cases are about what an *enabled* row may say.
  const effectsOn = { ...DEFAULT_CHAT_FILTER, rows: { ...DEFAULT_CHAT_FILTER.rows, effect: { player: true, gm: true } } };
  const actor = (id, uuid) => ({
    id,
    uuid,
    name: "Goblin",
    type: "npc",
    img: "goblin.webp",
    hasPlayerOwner: false,
    token: { id: uuid, name: "Goblin", hidden: false, texture: { src: "goblin-token.webp" } },
    getActiveTokens: () => []
  });
  const item = (parent, patch = {}) => ({
    id: "item1",
    uuid: `${parent.uuid}.Item.item1`,
    type: "effect",
    name: "Effect: Secret Curse",
    img: "curse.webp",
    system: {},
    parent,
    ...patch
  });

  test("an unidentified effect is refused, name and icon alike", () => {
    stubGame();
    const goblin = actor("base", "Scene.s.Token.a.Actor.base");
    const snapshot = snapshotStatusChange(item(goblin, { system: { unidentified: true } }), "gained", null);
    assert.equal(snapshot.change.unidentified, true);
    assert.equal(readStatusChange(snapshot, settings, effectsOn), null);
    const identified = snapshotStatusChange(item(goblin), "gained", null);
    assert.equal(identified.change.unidentified, false);
    assert.ok(readStatusChange(identified, settings, effectsOn), "the same effect identified is drawn");
  });

  test("an unidentified flag on a condition is not read as an effect's", () => {
    stubGame();
    const snapshot = snapshotStatusChange(item(actor("base", "Actor.base"), { type: "condition", system: { unidentified: true } }), "gained", 1);
    assert.equal(snapshot.change.unidentified, false);
  });

  test("two unlinked tokens of one base actor are two creatures", () => {
    stubGame();
    // Synthetic actors carry their base actor's _id; only the uuid runs through the token.
    const a = snapshotStatusChange(item(actor("base", "Scene.s.Token.a.Actor.base")), "gained", null);
    const b = snapshotStatusChange(item(actor("base", "Scene.s.Token.b.Actor.base")), "gained", null);
    assert.notEqual(a.actor.key, b.actor.key);
    assert.notEqual(readStatusChange(a, settings, effectsOn).key, readStatusChange(b, settings, effectsOn).key);
  });

  test("their conditions' remembered values do not overwrite each other", () => {
    stubGame();
    const feed = new StatusCardFeed(null); // no overlay: never live, so nothing is drawn
    const frightened = (parent, value) => item(parent, { type: "condition", name: "Frightened", system: { value: { value } } });
    const a = frightened(actor("base", "Scene.s.Token.a.Actor.base"), 2);
    const b = frightened(actor("base", "Scene.s.Token.b.Actor.base"), 3);
    feed.handleCreate(a);
    feed.handleCreate(b);
    assert.equal(feed.values.get(a.uuid), 2);
    assert.equal(feed.values.get(b.uuid), 3);
    feed.handleDelete(b);
    assert.equal(feed.values.get(a.uuid), 2, "losing one goblin's condition forgets only that goblin's");
  });
});
