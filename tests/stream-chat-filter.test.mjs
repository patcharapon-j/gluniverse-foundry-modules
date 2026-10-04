/**
 * The stream chat filter: one vocabulary of content types, each switched for players and for the GM.
 *
 * Both card paths read it — the cloned chat card through `classifyMessage`, PF2e roll cards through the
 * reader's `rowOf` — so these pin that the two agree, that the sanitizer is total (a row a world never
 * stored arrives at its default, never as "off"), and that a hidden detail is removed from the model
 * rather than left for the card to hide.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CHAT_FILTER_ROWS,
  DEFAULT_CHAT_FILTER,
  PF2E_CHECK_ROWS,
  allows,
  classifyMessage,
  sanitizeChatFilter,
  showsDetail
} from "../scripts/features/stream/chat-filter.mjs";
import { readMessage, rowOf } from "../scripts/features/stream-cards/pf2e/read-message.js";

const filterWith = (rows = {}, details = {}) => ({
  rows: { ...DEFAULT_CHAT_FILTER.rows, ...rows },
  details: { ...DEFAULT_CHAT_FILTER.details, ...details }
});

describe("the filter itself", () => {
  test("sanitizing nothing gives the shipped defaults, every cell a boolean", () => {
    const filter = sanitizeChatFilter(undefined);
    assert.deepEqual(filter, JSON.parse(JSON.stringify(DEFAULT_CHAT_FILTER)));
    for (const row of CHAT_FILTER_ROWS) {
      for (const author of ["player", "gm"]) assert.equal(typeof filter.rows[row.id][author], "boolean", `${row.id}.${author}`);
    }
  });

  test("a stored row keeps its cells, a missing row arrives at its default, an unknown row is dropped", () => {
    const filter = sanitizeChatFilter({ rows: { speech: { player: false }, bogus: { player: true } } });
    assert.deepEqual(filter.rows.speech, { player: false, gm: true });
    assert.deepEqual(filter.rows.attack, { player: true, gm: true });
    assert.equal(filter.rows.bogus, undefined);
  });

  test("effects start off; everything else starts on", () => {
    assert.deepEqual(DEFAULT_CHAT_FILTER.rows.effect, { player: false, gm: false });
    assert.equal(allows(DEFAULT_CHAT_FILTER, "speech", "gm"), true);
  });

  test("a detail with no column for an author is never shown for them", () => {
    assert.equal(showsDetail(DEFAULT_CHAT_FILTER, "dc", "gm"), false);
    assert.equal(showsDetail(DEFAULT_CHAT_FILTER, "playerName", "gm"), false);
    assert.equal(showsDetail(DEFAULT_CHAT_FILTER, "dc", "player"), true);
  });

  test("an unknown row is refused rather than waved through", () => {
    assert.equal(allows(DEFAULT_CHAT_FILTER, "nope", "player"), false);
    assert.equal(allows(DEFAULT_CHAT_FILTER, null, "player"), false);
  });
});

describe("both card paths file a message under the same row", () => {
  test("PF2e check types", () => {
    for (const [type, row] of Object.entries(PF2E_CHECK_ROWS)) {
      assert.equal(classifyMessage({ contextType: type, rollCount: 1 }), row, type);
      assert.equal(rowOf("check", { type }, {}), row, type);
    }
  });

  test("damage, spells, actions, plain rolls and typed chat", () => {
    assert.equal(classifyMessage({ contextType: "damage-roll", rollCount: 1 }), rowOf("damage"));
    assert.equal(classifyMessage({ contextType: "spell-cast" }), rowOf("cast"));
    assert.equal(classifyMessage({ originType: "feat" }), rowOf("action"));
    assert.equal(classifyMessage({ rollCount: 1 }), rowOf("roll"));
    for (const style of [1, 2, 3]) assert.equal(classifyMessage({ style }), rowOf("text", null, { style }));
  });

  test("everything else is `other`, which only the cloned path draws", () => {
    assert.equal(classifyMessage({ style: 0 }), "other");
    assert.ok(CHAT_FILTER_ROWS.some((row) => row.id === "other"));
  });

  test("every row the classifier can produce exists", () => {
    const ids = new Set(CHAT_FILTER_ROWS.map((row) => row.id));
    const produced = [
      ...Object.values(PF2E_CHECK_ROWS),
      classifyMessage({ contextType: "damage-roll" }),
      classifyMessage({ casting: true }),
      classifyMessage({ originType: "action" }),
      classifyMessage({ rollCount: 2 }),
      classifyMessage({ style: 1 }),
      classifyMessage({ style: 2 }),
      classifyMessage({ style: 3 }),
      classifyMessage({})
    ];
    for (const row of produced) assert.ok(ids.has(row), row);
  });
});

/** A player's skill check against a DC they are allowed to see, against a named target. */
function checkSnapshot({ authorIsGM = false, chatFilter } = {}) {
  return {
    raw: {
      _id: "msg",
      blind: false,
      whisper: [],
      speaker: { token: "tokA" },
      flavor: "<h4>Athletics</h4>",
      content: "",
      style: 0,
      flags: { pf2e: { context: { type: "skill-check", dc: { value: 15, visible: true }, outcome: "criticalSuccess", options: [] } } }
    },
    derived: {
      authorName: "Player1",
      authorIsGM,
      isReroll: false,
      rollCount: 1,
      rolls: [{ total: 25, formula: "1d20+7", dice: [{ faces: 20, results: [18] }], d20Results: [{ result: 18, active: true }], degreeOfSuccess: 3, instances: null }],
      actor: { name: "Kyra", img: null, hasPlayerOwner: !authorIsGM },
      token: null,
      target: { actorName: "Ogre", tokenName: "Ogre", playersCanSeeName: true, hasPlayerOwner: false },
      item: null,
      defaultArt: { src: "", focus: null },
      metagameDcs: true,
      ...(chatFilter ? { chatFilter } : {}),
      nameVisibilitySetting: false
    }
  };
}

describe("a row switched off for one author only", () => {
  test("hides that author's checks and keeps the other's", () => {
    const filter = filterWith({ skill: { player: false, gm: true } });
    assert.equal(readMessage(checkSnapshot({ chatFilter: filter })), null);
    assert.ok(readMessage(checkSnapshot({ authorIsGM: true, chatFilter: filter })));
  });
});

describe("card details", () => {
  test("on by default: degree, DC, target and player name all reach the model", () => {
    const card = readMessage(checkSnapshot());
    assert.equal(card.roll.degree, 3);
    assert.equal(card.roll.dcVisible, true);
    assert.equal(card.target.name, "Ogre");
    assert.equal(card.player.name, "Player1");
    assert.equal(card.fx, "gold");
  });

  test("each one switched off is removed from the model, not left for the card to hide", () => {
    const card = readMessage(checkSnapshot({
      chatFilter: filterWith({}, {
        degree: { player: false, gm: true },
        dc: { player: false },
        target: { player: false, gm: true },
        playerName: { player: false }
      })
    }));
    assert.equal(card.roll.degree, null);
    assert.equal(card.roll.dcVisible, false);
    assert.equal(card.target, null);
    assert.equal(card.player, null);
    assert.equal(card.roll.total, 25, "the total is not a detail");
  });

  test("hiding the degree re-derives the crack from the die alone", () => {
    const hidden = filterWith({}, { degree: { player: false, gm: false } });
    // A critical success on a natural 18 must not keep its gold crack once the degree is gone.
    assert.equal(readMessage(checkSnapshot({ chatFilter: hidden })).fx, null);
  });
});
