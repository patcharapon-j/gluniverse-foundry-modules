/**
 * The Daggerheart roll card reader and its feed.
 *
 * The reader decides what the stream shows for every message a `gluniverse-daggerheart` world can post,
 * and the feed keeps a card in step as the system rewrites its message (the GM's Fear, a reroll) or
 * posts the damage that completes it. Nearly all of it fails silently: a message the reader returns
 * null for reaches the stream as nothing at all, and a DC let through is a number the GM never told the
 * table.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  CHAT_FILTER_ROWS,
  DAGGERHEART_KIND_ROWS,
  DEFAULT_CHAT_FILTER,
  classifyMessage,
  rowAppliesTo
} from "../scripts/features/stream/chat-filter.mjs";
import { FEAR_CHIP, kindOf, priceOf, readMessage, rowOf, systemFlags } from "../scripts/features/stream-cards/daggerheart/read-message.js";
import { DaggerheartCardFeed } from "../scripts/features/stream-cards/daggerheart/card-feed.js";
import { BRUTE, KESS, SYSTEM, adversary, damage, duality, feature, plainRoll, rest, typed, withFlags } from "./fixtures/daggerheart/messages.mjs";

const filterWith = (rows = {}, details = {}) => ({
  rows: { ...DEFAULT_CHAT_FILTER.rows, ...rows },
  details: { ...DEFAULT_CHAT_FILTER.details, ...details }
});

describe("duality rolls", () => {
  test("hope: the higher Hope die headlines With Hope in the hope tone", () => {
    const model = readMessage(duality({ h: 9, f: 4 }));
    assert.equal(model.kind, "check");
    assert.equal(model.dhKind, "duality");
    assert.equal(model.roll.total, 15);
    assert.equal(model.roll.outcomeKey, "WithHope");
    assert.equal(model.tone, "hope");
    assert.deepEqual(model.duality, { hope: 9, fear: 4, hopeDie: "d12", fearDie: "d12", out: "hope" });
    assert.equal(model.fx, null);
    assert.deepEqual(model.chips, []);
  });

  test("fear: With Fear in the fear tone", () => {
    const model = readMessage(duality({ h: 3, f: 10 }));
    assert.equal(model.roll.outcomeKey, "WithFear");
    assert.equal(model.tone, "fear");
    assert.equal(model.duality.out, "fear");
  });

  test("a critical: matching dice, the gold crit tone and the gold crack", () => {
    const model = readMessage(duality({ h: 7, f: 7, dc: 30 }));
    assert.equal(model.roll.outcomeKey, "Critical");
    assert.equal(model.tone, "crit-success");
    assert.equal(model.fx, "gold");
    assert.equal(model.duality.out, "crit");
    // A critical succeeds whatever the Difficulty.
    assert.equal(model.roll.verdictKey, "Success");
  });

  test("a moved die keeps its own face count", () => {
    const model = readMessage(duality({ h: 15, f: 4, hd: "d20" }));
    assert.equal(model.duality.hopeDie, "d20");
  });

  test("the plate's own label headlines, and its kind rides under it only when it says something new", () => {
    assert.equal(readMessage(duality({ h: 9, f: 4, label: "Agility" })).action.sub, null);
    const attack = readMessage(duality({ h: 9, f: 4, label: "Longsword", attack: true }));
    assert.equal(attack.action.label, "Longsword");
    assert.equal(attack.action.sub, "Attack roll");
  });
});

describe("the Difficulty", () => {
  test("a player's roll against a set Difficulty shows it, with Success or Failure beside it", () => {
    const pass = readMessage(duality({ h: 9, f: 4, dc: 12 }));
    assert.equal(pass.roll.dcVisible, true);
    assert.equal(pass.roll.dc, 12);
    assert.equal(pass.roll.verdictKey, "Success");
    const fail = readMessage(duality({ h: 2, f: 1, dc: 12 }));
    assert.equal(fail.roll.verdictKey, "Failure");
    assert.equal(fail.roll.outcomeKey, "WithHope");
  });

  test("no Difficulty set: no verdict and no number", () => {
    const model = readMessage(duality({ h: 9, f: 4 }));
    assert.equal(model.roll.dcVisible, false);
    assert.equal(model.roll.verdictKey, null);
  });

  test("a GM's duality roll never shows its Difficulty", () => {
    const model = readMessage(duality({ h: 9, f: 4, dc: 12, isGM: true, actor: BRUTE }));
    assert.equal(model.roll.dcVisible, false);
    assert.equal(model.roll.verdictKey, null);
  });

  test("the player's DC switch removes the number and its verdict", () => {
    const model = readMessage(duality({ h: 9, f: 4, dc: 12, chatFilter: filterWith({}, { dc: { player: false } }) }));
    assert.equal(model.roll.dcVisible, false);
    assert.equal(model.roll.outcomeKey, "WithHope");
  });

  test("the degree switch removes Success and Failure, never Hope, Fear or a critical", () => {
    const off = filterWith({}, { degree: { player: false, gm: false } });
    const model = readMessage(duality({ h: 9, f: 4, dc: 12, chatFilter: off }));
    assert.equal(model.roll.verdictKey, null);
    assert.equal(model.roll.outcomeKey, "WithHope");
    assert.equal(readMessage(duality({ h: 5, f: 5, chatFilter: off })).roll.outcomeKey, "Critical");
  });
});

describe("reactions", () => {
  test("no Hope and no Fear: a neutral die, a neutral tone, the verdict as the headline", () => {
    const model = readMessage(duality({ h: 9, f: 4, rxn: true, dc: 12 }));
    assert.equal(model.duality.out, "none");
    assert.equal(model.tone, "none");
    assert.equal(model.roll.outcomeKey, "Success");
    // Not a second time beside the number.
    assert.equal(model.roll.verdictKey, null);
    assert.equal(model.roll.dcVisible, true);
  });

  test("a reaction with no Difficulty has no headline at all", () => {
    const model = readMessage(duality({ h: 3, f: 10, rxn: true }));
    assert.equal(model.roll.outcomeKey, null);
    assert.equal(model.tone, "none");
  });

  test("a reaction never takes the Fear chip", () => {
    const model = readMessage(duality({ h: 3, f: 10, rxn: true, claimed: { fear: true } }));
    assert.deepEqual(model.chips, []);
  });

  test("files under its own row", () => {
    const snapshot = duality({ h: 9, f: 4, rxn: true });
    assert.equal(rowOf("duality", systemFlags(snapshot.raw.flags), snapshot.raw), "reaction");
    assert.equal(readMessage({ ...snapshot, derived: { ...snapshot.derived, chatFilter: filterWith({ reaction: { player: false, gm: true } }) } }), null);
    assert.ok(readMessage({ ...snapshot, derived: { ...snapshot.derived, chatFilter: filterWith({ duality: { player: false, gm: true } }) } }));
  });
});

describe("the GM's Fear", () => {
  test("a claimed Fear puts +1 Fear beside the player", () => {
    const model = readMessage(duality({ h: 3, f: 10, claimed: { fear: true } }));
    assert.deepEqual(model.chips, [FEAR_CHIP]);
  });

  test("the dotted-key shape of the same flag counts", () => {
    const snapshot = duality({ h: 3, f: 10 });
    snapshot.raw.flags[SYSTEM]["claimed.fear"] = true;
    assert.deepEqual(readMessage(snapshot).chips, [FEAR_CHIP]);
  });

  test("a hope roll never shows it", () => {
    assert.deepEqual(readMessage(duality({ h: 10, f: 3, claimed: { fear: true } })).chips, []);
  });
});

describe("adversary rolls", () => {
  test("the badge, the kept d20 and Hit, against a PC's own Evasion", () => {
    const model = readMessage(adversary({ d20: [15], target: KESS.name, dc: 11, foeTarget: { isPc: true } }));
    assert.equal(model.dhKind, "adversary");
    assert.equal(model.actor.isNpc, true);
    assert.equal(model.badgeKey, "Adversary");
    assert.equal(model.player, null);
    assert.equal(model.roll.natural, 15);
    assert.equal(model.roll.outcomeKey, "Hit");
    assert.equal(model.tone, "hit");
    assert.equal(model.roll.dcVisible, true);
    assert.equal(model.roll.dcKey, "Evasion");
    assert.deepEqual(model.target, { name: KESS.name });
    assert.equal(model.action.sub, null);
    assert.equal(model.opensDamage, true);
  });

  test("a miss", () => {
    const model = readMessage(adversary({ d20: [3], target: KESS.name, dc: 11, foeTarget: { isPc: true } }));
    assert.equal(model.roll.outcomeKey, "Miss");
    assert.equal(model.tone, "miss");
    assert.equal(model.opensDamage, false);
  });

  test("a number that is not a PC's own Evasion stays off, and so does the target's name", () => {
    const model = readMessage(adversary({ d20: [15], target: "Ward Stone", dc: 14, foeTarget: { isPc: false } }));
    assert.equal(model.roll.outcomeKey, "Hit");
    assert.equal(model.roll.dcVisible, false);
    assert.equal(model.target, null);
    // A snapshot that never looked fails closed.
    assert.equal(readMessage(adversary({ d20: [15], target: KESS.name, dc: 11 })).roll.dcVisible, false);
  });

  test("no target: no verdict", () => {
    const model = readMessage(adversary({ d20: [15] }));
    assert.equal(model.roll.outcomeKey, null);
    assert.equal(model.tone, "none");
  });

  test("disadvantage keeps the lower die; a natural 20 is a critical", () => {
    assert.equal(readMessage(adversary({ d20: [17, 4], neg: true })).roll.natural, 4);
    const crit = readMessage(adversary({ d20: [20], target: KESS.name, dc: 30, foeTarget: { isPc: true } }));
    assert.equal(crit.roll.outcomeKey, "Critical");
    assert.equal(crit.fx, "gold");
  });

  test("a whispered adversary reaction never appears", () => {
    assert.equal(readMessage(adversary({ rxn: true, target: KESS.name, dc: 11, foeTarget: { isPc: true } })), null);
  });

  test("an environment reads Environment in the badge", () => {
    const snapshot = adversary({ d20: [12] });
    snapshot.derived.actor.type = "environment";
    assert.equal(readMessage(snapshot).badgeKey, "Environment");
  });

  test("a hidden nameplate reads Unknown and keeps the art", () => {
    const hidden = adversary({ d20: [12], token: { name: BRUTE.name, textureSrc: "tokens/brute.webp", displayName: 0 } });
    const model = readMessage(hidden);
    assert.equal(model.actor.name, null);
    assert.equal(model.actor.nameKey, "Unknown");
    assert.equal(model.actor.img, BRUTE.img);
    const shown = adversary({ d20: [12], token: { name: BRUTE.name, textureSrc: "tokens/brute.webp", displayName: 50 } });
    assert.equal(readMessage(shown).actor.name, BRUTE.name);
  });
});

describe("damage", () => {
  test("physical: the total, the part, no crit", () => {
    const model = readMessage(damage({ rolls: [4, 6], bonus: 2 }));
    assert.equal(model.kind, "damage");
    assert.equal(model.damage.total, 12);
    assert.deepEqual(model.damage.parts, [{ type: "physical", amount: 12, label: "physical", icon: "sword" }]);
    assert.equal(model.damage.crit, false);
  });

  test("magic, and a critical labelled as one", () => {
    const model = readMessage(damage({ rolls: [3], die: "d10", dtype: "magic", crit: true }));
    assert.equal(model.damage.parts[0].type, "magic");
    assert.equal(model.damage.parts[0].icon, "wand-sparkles");
    assert.equal(model.damage.crit, true);
    assert.equal(model.damage.critKey, "CritMax");
    assert.equal(model.fx, "pop");
  });

  test("a critical in a further group counts", () => {
    const model = readMessage(damage({ rolls: [3], extra: [{ n: 1, die: "d6", rolls: [2], max: [6] }] }));
    assert.equal(model.damage.crit, true);
  });

  test("direct physical keeps its words and its type", () => {
    const model = readMessage(damage({ dtype: "direct physical" }));
    assert.equal(model.damage.parts[0].type, "physical");
    assert.equal(model.damage.parts[0].label, "direct physical");
  });

  test("an attack card offers the merge; its damage shares the actor's key", () => {
    const attack = readMessage(duality({ h: 9, f: 4, attack: true }));
    const dmg = readMessage(damage({}));
    assert.equal(attack.opensDamage, true);
    assert.equal(attack.originKey, dmg.originKey);
    assert.equal(readMessage(duality({ h: 9, f: 4 })).opensDamage, false);
  });
});

describe("posted features", () => {
  test("the feature large, the card beside the verb, its price", () => {
    const model = readMessage(feature({}));
    assert.equal(model.kind, "action");
    assert.equal(model.dhKind, "feature");
    assert.equal(model.action.label, "Power Push");
    assert.equal(model.action.sub, "Book of Ava");
    assert.equal(model.action.verbKey, "UsesFeature");
    assert.deepEqual(model.action.price, [{ n: 1, verbKey: "Spend", unitKey: "Hope" }]);
  });

  test("a whole card names itself", () => {
    const model = readMessage(feature({ feature: "" }));
    assert.equal(model.action.label, "Book of Ava");
    assert.equal(model.action.sub, null);
  });

  test("prices: none, one, a split Fear button, and buttons that disagree", () => {
    assert.deepEqual(priceOf([]), []);
    assert.deepEqual(priceOf([{ kind: "roll-dice", formula: "1d4" }]), []);
    assert.deepEqual(priceOf([{ kind: "pay-cost", stress: 2 }]), [{ n: 2, verbKey: "Mark", unitKey: "Stress" }]);
    assert.deepEqual(priceOf([{ kind: "pay-cost", hope: 1 }, { kind: "pay-cost", fear: 1 }]), [
      { n: 1, verbKey: "Spend", unitKey: "Hope" },
      { n: 1, verbKey: "Spend", unitKey: "Fear" }
    ]);
    assert.deepEqual(priceOf([{ kind: "pay-cost", hope: 1 }, { kind: "pay-cost", hope: 3 }]), []);
    // A chain's steps are part of its price.
    assert.deepEqual(priceOf([{ kind: "roll-damage", steps: [{ kind: "pay-cost", armor: 2 }] }]), [{ n: 2, verbKey: "Mark", unitKey: "ArmorSlots" }]);
  });
});

describe("typed chat and plain rolls", () => {
  test("Say, Do and Think lines through the shared text reader", () => {
    const say = readMessage(typed({ body: "Stay behind me." }));
    assert.equal(say.kind, "text");
    assert.equal(say.text.body, "Stay behind me.");
    assert.equal(readMessage(typed({ style: 3, rpMode: "do", body: "draws her blade" })).text.style, "emote");
    assert.equal(readMessage(typed({ style: 2, rpMode: "think", body: "Not again." })).text.style, "thought");
  });

  test("out-of-character chat is off by default, and a whisper never shows", () => {
    assert.equal(readMessage(typed({ style: 1, body: "brb" })), null);
    assert.equal(readMessage(typed({ body: "psst", whisper: ["userGameMast"] })), null);
    assert.equal(readMessage(typed({ body: "psst", blind: true })), null);
  });

  test("a plain roll with no system flag is a plain roll card", () => {
    const model = readMessage(plainRoll({}));
    assert.equal(model.kind, "roll");
    assert.equal(model.roll.total, 3);
  });
});

describe("messages handled deliberately", () => {
  test("a rest summary and an unknown kind are nothing", () => {
    assert.equal(readMessage(rest({})), null);
    const unknown = duality({ h: 9, f: 4 });
    unknown.raw.flags[SYSTEM].kind = "something-new";
    assert.equal(readMessage(unknown), null);
  });

  test("a style-OTHER message with no dice and no system flag is nothing", () => {
    const snapshot = typed({ style: 0, body: "<div>module summary</div>" });
    assert.equal(kindOf({}, snapshot.derived, snapshot.raw), null);
    assert.equal(readMessage(snapshot), null);
  });

  test("a flagged kind without its plate is nothing", () => {
    const snapshot = duality({ h: 9, f: 4 });
    delete snapshot.raw.flags[SYSTEM].plate;
    assert.equal(readMessage(snapshot), null);
  });

  test("a player's own blind roll shows that they rolled and nothing of how", () => {
    const model = readMessage(duality({ h: 3, f: 10, blind: true, claimed: { fear: true } }));
    assert.equal(model.visibility, "ownBlind");
    assert.equal(model.roll.total, null);
    assert.equal(model.duality, null);
    assert.deepEqual(model.chips, []);
    assert.equal(model.tone, "none");
  });

  test("every Daggerheart kind files under a row that exists, is tagged for the system and starts on", () => {
    for (const row of Object.values(DAGGERHEART_KIND_ROWS).concat("reaction")) {
      const entry = CHAT_FILTER_ROWS.find((r) => r.id === row);
      assert.ok(entry, row);
      assert.ok(rowAppliesTo(entry, SYSTEM), row);
      assert.equal(DEFAULT_CHAT_FILTER.rows[row].player, true, row);
      assert.equal(DEFAULT_CHAT_FILTER.rows[row].gm, true, row);
    }
    for (const id of ["duality", "reaction", "adversary", "feature"]) {
      assert.equal(rowAppliesTo(CHAT_FILTER_ROWS.find((r) => r.id === id), "pf2e"), false, id);
    }
  });

  test("the cloned-card path files the same messages under the same rows", () => {
    const cases = [
      [duality({ h: 9, f: 4 }), "duality"],
      [duality({ h: 9, f: 4, rxn: true }), "reaction"],
      [adversary({}), "adversary"],
      [damage({}), "damage"],
      [feature({}), "feature"],
      [rest({}), "other"]
    ];
    for (const [snapshot, row] of cases) {
      const flags = systemFlags(snapshot.raw.flags);
      const got = classifyMessage({ style: 0, rollCount: snapshot.derived.rollCount, dhKind: flags.kind, dhReaction: !!flags.plate?.rxn });
      assert.equal(got, row);
      const kind = kindOf(flags, snapshot.derived, snapshot.raw);
      if (kind) assert.equal(rowOf(kind, flags, snapshot.raw), row);
    }
  });
});

/* ── the feed ─────────────────────────────────────────────────────────── */

class FakeCard {
  constructor(model) {
    this.model = model;
    this.calls = [];
    this.destroyed = false;
    this.element = { dataset: {}, isConnected: true };
  }
  enter() { this.calls.push(["enter"]); }
  async update(model, options) { this.model = model; this.calls.push(["update", options]); }
  setChips(model) { this.model = { ...this.model, chips: model.chips }; this.calls.push(["chips", model.chips.map((c) => c.id)]); }
  async addDamage(damageModel) { this.calls.push(["damage", damageModel.total]); }
}

function harness() {
  const live = new Map();
  const overlay = {
    streamMode: { active: true, getChatRoot: () => ({ append() {} }) },
    cards: [],
    applySettings() {},
    enforceMaxVisible() {},
    removed: [],
    removeCard(element) { this.removed.push(element); }
  };
  const feed = new DaggerheartCardFeed(overlay, {
    Card: FakeCard,
    snapshot: (message) => live.get(message.id),
    waitForDice: async () => {},
    chatSettings: () => ({ lifetimeMs: 60_000, critLifetimeMultiplier: 2 })
  });
  // A message is its id; the snapshot it reads as is whatever was posted last under that id.
  const post = (snapshot) => {
    live.set(snapshot.raw._id, snapshot);
    return { id: snapshot.raw._id };
  };
  return { feed, overlay, live, post };
}

describe("the feed", () => {
  let restore;
  beforeEach(() => {
    const before = { game: globalThis.game, window: globalThis.window };
    const timers = new Set();
    globalThis.window = {
      setTimeout: (fn, ms) => { const t = { fn, ms }; timers.add(t); return t; },
      clearTimeout: (t) => timers.delete(t)
    };
    restore = () => Object.assign(globalThis, before);
  });
  afterEach(() => restore());

  const withGame = (live) => {
    globalThis.game = { messages: { get: (id) => (live.has(id) ? { id } : undefined) } };
  };

  test("a fear roll shows, then the GM's claim adds the chip in place", async () => {
    const { feed, live, post } = harness();
    withGame(live);
    const rolled = duality({ h: 3, f: 10 });
    const message = post(rolled);
    await feed.handleCreate(message);
    const record = feed.byMessageId.get(message.id);
    assert.ok(record);
    assert.deepEqual(record.card.model.chips, []);

    live.set(message.id, withFlags(rolled, { claimed: { fear: true } }));
    await feed.handleUpdate(message, { flags: { [SYSTEM]: { claimed: { fear: true } } } });
    assert.deepEqual(record.card.calls.at(-1), ["chips", ["fear"]]);
    assert.ok(!record.card.calls.some(([name]) => name === "update"), "the result was not redrawn");
  });

  test("a claim that lands during the dice wait is on the card from the start", async () => {
    const { feed, live, post } = harness();
    withGame(live);
    const rolled = duality({ h: 3, f: 10 });
    const message = post(rolled);
    feed.waitForDice = async () => live.set(message.id, withFlags(rolled, { claimed: { fear: true } }));
    await feed.handleCreate(message);
    assert.deepEqual(feed.byMessageId.get(message.id).card.model.chips, [FEAR_CHIP]);
  });

  test("a reroll rewrites the card in place with the Reroll chip", async () => {
    const { feed, live, post } = harness();
    withGame(live);
    const rolled = duality({ h: 3, f: 10 });
    const message = post(rolled);
    await feed.handleCreate(message);
    const record = feed.byMessageId.get(message.id);

    const rerolled = duality({ h: 11, f: 10, id: message.id, rr: { h: [3] } });
    live.set(message.id, rerolled);
    await feed.handleUpdate(message, { rolls: [{}, {}], flags: { [SYSTEM]: { plate: {} } } });
    const [name, options] = record.card.calls.at(-1);
    assert.equal(name, "update");
    assert.deepEqual(options, { reroll: true });
    assert.equal(record.card.model.roll.outcomeKey, "WithHope");
  });

  test("an update that changes nothing the card says leaves it alone", async () => {
    const { feed, live, post } = harness();
    withGame(live);
    const message = post(duality({ h: 9, f: 4, attack: true }));
    await feed.handleCreate(message);
    const record = feed.byMessageId.get(message.id);
    live.set(message.id, withFlags(live.get(message.id), { claimed: { damage: true } }));
    await feed.handleUpdate(message, { flags: {} });
    assert.deepEqual(record.card.calls, [["enter"]]);
  });

  test("damage merges under the attack that offered it, once", async () => {
    const { feed, live, post } = harness();
    withGame(live);
    const attack = post(duality({ h: 9, f: 4, attack: true }));
    await feed.handleCreate(attack);
    const record = feed.byMessageId.get(attack.id);

    const hit = post(damage({ rolls: [4, 6], bonus: 2 }));
    await feed.handleCreate(hit);
    assert.equal(feed.byMessageId.get(hit.id), record);
    assert.deepEqual(record.card.calls.at(-1), ["damage", 12]);

    const second = post(damage({ rolls: [1], bonus: 0 }));
    await feed.handleCreate(second);
    assert.notEqual(feed.byMessageId.get(second.id), record, "a second damage roll gets its own card");
  });

  test("damage never merges under a card that offered none, or another actor's", async () => {
    const { feed, live, post } = harness();
    withGame(live);
    const check = post(duality({ h: 9, f: 4 }));
    await feed.handleCreate(check);
    const hit = post(damage({}));
    await feed.handleCreate(hit);
    assert.notEqual(feed.byMessageId.get(hit.id), feed.byMessageId.get(check.id));

    const attack = post(duality({ h: 9, f: 4, attack: true }));
    await feed.handleCreate(attack);
    const theirs = post(damage({ actor: KESS }));
    await feed.handleCreate(theirs);
    assert.notEqual(feed.byMessageId.get(theirs.id), feed.byMessageId.get(attack.id));
  });

  test("an adversary hit takes its damage; a whispered reaction makes no card", async () => {
    const { feed, live, post } = harness();
    withGame(live);
    const swing = post(adversary({ d20: [15], target: KESS.name, dc: 11, foeTarget: { isPc: true } }));
    await feed.handleCreate(swing);
    const blow = post(damage({ actor: BRUTE, isGM: true, rolls: [5, 3] }));
    await feed.handleCreate(blow);
    assert.equal(feed.byMessageId.get(blow.id), feed.byMessageId.get(swing.id));

    const reaction = post(adversary({ rxn: true }));
    await feed.handleCreate(reaction);
    assert.equal(feed.byMessageId.get(reaction.id), undefined);
  });

  test("deleting the card's message takes the card down; deleting merged damage does not", async () => {
    const { feed, overlay, live, post } = harness();
    withGame(live);
    const attack = post(duality({ h: 9, f: 4, attack: true }));
    await feed.handleCreate(attack);
    const hit = post(damage({}));
    await feed.handleCreate(hit);
    assert.equal(feed.handleDelete(hit), true);
    assert.equal(overlay.removed.length, 0);
    assert.equal(feed.handleDelete(attack), true);
    assert.equal(overlay.removed.length, 1);
  });
});
