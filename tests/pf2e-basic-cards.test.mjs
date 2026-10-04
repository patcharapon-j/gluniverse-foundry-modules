/**
 * Plain dice rolls and typed chat, read into roll-card models.
 *
 * In a PF2e world the chat overlay clones no chat card at all — every message goes through this
 * reader — so before these two kinds existed a `/r 2d6+3` and a line of speech reached the stream as
 * nothing, which is indistinguishable from the overlay being off. These pin the two rules that keep
 * that fix from becoming the opposite problem: style OTHER is refused (it is the default every roll
 * and every system card carries), and a d20 is only ever drawn for a roll that has exactly one.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_CHAT_FILTER } from "../scripts/features/stream/chat-filter.mjs";
import {
  diceFaces,
  plainText,
  readMessage,
  singleD20Of
} from "../scripts/features/stream-cards/pf2e/read-message.js";

/** The shape `snapshot.js` builds, with only what these paths read. */
function snapshot({ style = 0, content = "", flavor = "", rolls = [], authorIsGM = false, speaker = {}, chatFilter, authorName = "Player1" } = {}) {
  return {
    raw: { _id: "msg", blind: false, whisper: [], speaker, flavor, content, style, flags: {} },
    derived: {
      authorName,
      authorIsGM,
      isReroll: false,
      rollCount: rolls.length,
      rolls,
      actor: null,
      token: null,
      target: null,
      item: null,
      defaultArt: { src: "", focus: null },
      ...(chatFilter ? { chatFilter } : {}),
      nameVisibilitySetting: false
    }
  };
}

const d20Roll = { total: 17, formula: "1d20 + 5", dice: [{ faces: 20, results: [12] }], d20Results: [{ result: 12, active: true }], degreeOfSuccess: null, instances: null };
const d6Roll = { total: 10, formula: "2d6 + 3", dice: [{ faces: 6, results: [4, 3] }], d20Results: null, degreeOfSuccess: null, instances: null };

describe("a plain dice roll", () => {
  test("becomes a roll card carrying its formula, its faces and its total", () => {
    const card = readMessage(snapshot({ rolls: [d6Roll] }));
    assert.equal(card.kind, "roll");
    assert.equal(card.roll.formula, "2d6 + 3");
    assert.equal(card.roll.total, 10);
    assert.equal(card.roll.natural, null, "a 2d6 has no natural d20 to draw");
    assert.equal(card.roll.degree, null, "PF2e resolved no outcome, so the card says nothing about one");
    assert.equal(card.action.labelKey, "PlainRoll");
    assert.equal(card.action.sub, "4 · 3");
  });

  test("a 1d20+N draws its natural, and a 20 cracks gold", () => {
    const plain = readMessage(snapshot({ rolls: [d20Roll] }));
    assert.equal(plain.roll.natural, 12);
    assert.equal(plain.fx, null);
    const nat20 = readMessage(snapshot({ rolls: [{ ...d20Roll, total: 25, dice: [{ faces: 20, results: [20] }] }] }));
    assert.equal(nat20.fx, "gold");
  });

  test("its own flavor is the headline when it has one", () => {
    const card = readMessage(snapshot({ rolls: [d6Roll], flavor: "<h4>Falling damage</h4>" }));
    assert.equal(card.action.label, "Falling damage");
    assert.equal(card.action.labelKey, null);
  });

  test("the switch silences it without silencing the rest", () => {
    const off = filterWith({ roll: { player: false, gm: false } });
    assert.equal(readMessage(snapshot({ rolls: [d6Roll], chatFilter: off })), null);
    assert.ok(readMessage(snapshot({ style: 2, content: "<p>Hello</p>", chatFilter: off })));
  });

  test("singleD20Of refuses every shape but one d20 rolling once", () => {
    assert.equal(singleD20Of({ dice: [{ faces: 20, results: [7] }] }), 7);
    assert.equal(singleD20Of({ dice: [{ faces: 20, results: [7, 19] }] }), null, "keep/drop leaves two results and no single natural");
    assert.equal(singleD20Of({ dice: [{ faces: 20, results: [7] }, { faces: 20, results: [3] }] }), null);
    assert.equal(singleD20Of({ dice: [{ faces: 6, results: [4] }] }), null);
    assert.equal(singleD20Of({}), null);
  });

  test("diceFaces stops before the card does", () => {
    assert.equal(diceFaces({ dice: [{ faces: 6, results: [1, 2, 3] }] }), "1 · 2 · 3");
    assert.match(diceFaces({ dice: [{ faces: 6, results: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }] }), /…$/);
    assert.equal(diceFaces({ dice: [] }), null);
  });
});

describe("a typed chat message", () => {
  test("speech, an emote and out-of-character each headline differently", () => {
    const ic = readMessage(snapshot({ style: 2, content: "<p>Stand back.</p>", speaker: { alias: "Kyra" } }));
    assert.equal(ic.kind, "text");
    assert.deepEqual(ic.text, { body: "Stand back.", style: "speech" });
    assert.equal(ic.action.labelKey, "Says");
    assert.equal(ic.actor.name, "Kyra", "a speaker with no actor behind it still has a name");

    assert.equal(readMessage(snapshot({ style: 3, content: "waves" })).text.style, "emote");
    assert.equal(readMessage(snapshot({ style: 3, content: "waves" })).action.labelKey, "Emotes");
    assert.equal(readMessage(snapshot({ style: 1, content: "brb" })).action.labelKey, "OutOfCharacter");
  });

  test("style OTHER is refused — that is every roll and every system card", () => {
    assert.equal(readMessage(snapshot({ style: 0, content: "<div class='pf2e chat-card'>Longsword</div>" })), null);
  });

  test("an empty body is not a card", () => {
    assert.equal(readMessage(snapshot({ style: 2, content: "<p></p>" })), null);
  });

  test("the author falls back to the speaker's name and then to the player", () => {
    assert.equal(readMessage(snapshot({ style: 1, content: "brb", authorName: "Player2" })).actor.name, "Player2");
  });

  test("each row is its own, and each column is its own", () => {
    const noOoc = filterWith({ ooc: { player: false, gm: false } });
    assert.equal(readMessage(snapshot({ style: 1, content: "brb", chatFilter: noOoc })), null);
    assert.ok(readMessage(snapshot({ style: 2, content: "Hello", chatFilter: noOoc })));

    // Speech off for the GM only: the GM's narration goes, the players' lines stay.
    const noGmSpeech = filterWith({ speech: { player: true, gm: false } });
    assert.equal(readMessage(snapshot({ style: 2, content: "Hello", authorIsGM: true, chatFilter: noGmSpeech })), null);
    assert.ok(readMessage(snapshot({ style: 2, content: "Hello", authorIsGM: false, chatFilter: noGmSpeech })));
    assert.ok(readMessage(snapshot({ style: 3, content: "waves", authorIsGM: true, chatFilter: noGmSpeech })), "emotes are another row");

    // And the other way round, for plain rolls.
    const noPlayerRolls = filterWith({ roll: { player: false, gm: true } });
    assert.equal(readMessage(snapshot({ rolls: [d6Roll], chatFilter: noPlayerRolls })), null);
    assert.ok(readMessage(snapshot({ rolls: [d6Roll], authorIsGM: true, chatFilter: noPlayerRolls })));
  });

  test("a snapshot with no switches at all reads as the shipped defaults", () => {
    // The fixtures were captured before these existed, and the check tools drive the reader directly.
    // An absent object read as `undefined` per row would silence the whole feature.
    assert.ok(readMessage(snapshot({ style: 2, content: "Hello" })));
  });
});

/** The shipped filter with some rows replaced. */
function filterWith(rows) {
  return { rows: { ...DEFAULT_CHAT_FILTER.rows, ...rows }, details: DEFAULT_CHAT_FILTER.details };
}

describe("plainText", () => {
  test("flattens chat HTML, decodes entities and collapses space", () => {
    assert.equal(plainText("<p>Hello   <b>there</b></p><p>friend</p>"), "Hello there friend");
    assert.equal(plainText("a &amp; b &lt;c&gt;"), "a & b <c>");
    assert.equal(plainText("<p>one</p><br>two"), "one two");
  });

  test("drops script and style bodies rather than reading them out", () => {
    assert.equal(plainText("<script>alert(1)</script>hi"), "hi");
    assert.equal(plainText("<style>.a{}</style>hi"), "hi");
  });

  test("cuts a long message so the card cannot grow under the stack", () => {
    const long = plainText("x".repeat(400));
    assert.ok(long.length <= 240, `got ${long.length}`);
    assert.match(long, /…$/);
  });

  test("never returns null", () => {
    assert.equal(plainText(undefined), "");
    assert.equal(plainText("<p> </p>"), "");
  });
});
