import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { foldChanges, readStatusChange, statusTone } from "../scripts/features/stream-cards/pf2e/read-status.js";
import { DEFAULT_STATUS_UPDATES } from "../scripts/features/stream-cards/settings.js";

const settings = (patch = {}) => ({ ...DEFAULT_STATUS_UPDATES, ...patch });

/** A player character's own condition: the least gated case there is. */
function pcSnapshot(patch = {}) {
  return {
    actor: {
      key: "actor-kyra",
      name: "Kyra",
      isCharacter: true,
      hasPlayerOwner: true,
      hiddenName: false,
      observable: true,
      img: "portraits/kyra.webp",
      imgKind: "portrait",
      focus: { x: 0.1, y: 0.05, w: 0.6 },
      ...(patch.actor ?? {})
    },
    change: {
      id: "item-frightened",
      slug: "frightened",
      name: "Frightened",
      kind: "condition",
      img: "icons/frightened.webp",
      value: 2,
      direction: "gained",
      ...(patch.change ?? {})
    }
  };
}

describe("status changes the stream draws", () => {
  test("a character gaining a condition becomes one card with one chip", () => {
    const model = readStatusChange(pcSnapshot(), settings());
    assert.equal(model.key, "actor-kyra");
    assert.equal(model.actor.name, "Kyra");
    assert.equal(model.actor.isNpc, false);
    assert.deepEqual(model.actor.focus, { x: 0.1, y: 0.05, w: 0.6 });
    assert.equal(model.changes.length, 1);
    assert.deepEqual(model.changes[0], {
      id: "item-frightened",
      slug: "frightened",
      name: "Frightened",
      kind: "condition",
      img: "icons/frightened.webp",
      value: 2,
      direction: "gained",
      eased: false
    });
  });

  test("losing and easing a condition read as pressure letting go", () => {
    for (const direction of ["lost", "lowered"]) {
      const model = readStatusChange(pcSnapshot({ change: { direction } }), settings());
      assert.equal(model.changes[0].eased, true, direction);
      assert.equal(statusTone(model.changes), "cleared", direction);
    }
    assert.equal(statusTone(readStatusChange(pcSnapshot(), settings()).changes), "applied");
  });

  test("every gate refuses its own kind of change and nothing else", () => {
    assert.equal(readStatusChange(pcSnapshot(), settings({ enabled: false })), null);
    assert.equal(readStatusChange(pcSnapshot(), settings({ conditions: false })), null);
    assert.equal(readStatusChange(pcSnapshot(), settings({ players: false })), null);
    // An effect is its own switch, and off by default.
    const effect = pcSnapshot({ change: { kind: "effect", slug: "spell-effect-bless" } });
    assert.equal(readStatusChange(effect, settings()), null);
    assert.ok(readStatusChange(effect, settings({ effects: true })));
    // Value moves and endings are quieter events with switches of their own.
    for (const direction of ["raised", "lowered"]) {
      assert.equal(readStatusChange(pcSnapshot({ change: { direction } }), settings({ valueChanges: false })), null);
      assert.ok(readStatusChange(pcSnapshot({ change: { direction } }), settings()));
    }
    assert.equal(readStatusChange(pcSnapshot({ change: { direction: "lost" } }), settings({ removals: false })), null);
    // "conditions: false" must not take effects with it, nor the other way round.
    assert.ok(readStatusChange(effect, settings({ conditions: false, effects: true })));
  });

  test("a creature nobody can see is never announced, whatever the settings say", () => {
    const hidden = pcSnapshot({
      actor: { isCharacter: false, hasPlayerOwner: false, observable: false }
    });
    assert.equal(readStatusChange(hidden, settings()), null);
    assert.equal(readStatusChange(hidden, settings({ npcs: true, players: true })), null);
    const seen = pcSnapshot({ actor: { isCharacter: false, hasPlayerOwner: false, observable: true } });
    const model = readStatusChange(seen, settings());
    assert.equal(model.actor.isNpc, true);
    assert.equal(readStatusChange(seen, settings({ npcs: false })), null);
  });

  test("an NPC whose name players cannot see keeps its art and loses its name", () => {
    const model = readStatusChange(
      pcSnapshot({ actor: { isCharacter: false, hasPlayerOwner: false, observable: true, hiddenName: true } }),
      settings()
    );
    assert.equal(model.actor.name, null);
    assert.equal(model.actor.img, "portraits/kyra.webp");
  });

  test("a direction the reader does not know is refused rather than drawn blank", () => {
    assert.equal(readStatusChange(pcSnapshot({ change: { direction: "wobbled" } }), settings()), null);
    assert.equal(readStatusChange(pcSnapshot({ change: { kind: "weapon" } }), settings()), null);
    assert.equal(readStatusChange(null, settings()), null);
    assert.equal(readStatusChange(pcSnapshot(), null), null);
  });
});

describe("folding several changes into one card", () => {
  const entry = (patch) => ({ id: "i", slug: "frightened", name: "Frightened", kind: "condition", img: null, value: 1, direction: "gained", eased: false, ...patch });

  test("one condition is one row however often it moves", () => {
    const first = [entry()];
    const folded = foldChanges(first, entry({ value: 2, direction: "raised", eased: false }));
    assert.equal(folded.length, 1);
    assert.equal(folded[0].value, 2);
    // It arrived during this card's life, so it still reads as having arrived rather than as having risen.
    assert.equal(folded[0].direction, "gained");
  });

  test("a different condition is its own row", () => {
    const folded = foldChanges([entry()], entry({ id: "j", slug: "prone", name: "Prone", value: null }));
    assert.equal(folded.length, 2);
    assert.deepEqual(folded.map((e) => e.slug), ["frightened", "prone"]);
  });

  test("the same condition on a different kind of item is a different row", () => {
    const folded = foldChanges([entry()], entry({ kind: "effect" }));
    assert.equal(folded.length, 2);
  });

  test("arriving and ending inside one card's life leaves nothing to say", () => {
    assert.deepEqual(foldChanges([entry()], entry({ direction: "lost", eased: true })), []);
    assert.deepEqual(foldChanges([entry({ direction: "lost", eased: true })], entry()), []);
  });

  test("a row that ends after having risen ends, and reads as eased", () => {
    const risen = [entry({ direction: "raised", value: 3 })];
    const folded = foldChanges(risen, entry({ direction: "lost", value: 3, eased: true }));
    assert.equal(folded.length, 1);
    assert.equal(folded[0].direction, "lost");
    assert.equal(folded[0].eased, true);
  });

  test("rows with no slug fall back to the name, never to each other", () => {
    const named = { id: null, slug: null, name: "Off-Guard", kind: "condition", img: null, value: null, direction: "gained", eased: false };
    assert.equal(foldChanges([named], { ...named }).length, 1);
    assert.equal(foldChanges([named], { ...named, name: "Prone" }).length, 2);
  });

  test("an empty card has no tone to show", () => {
    assert.equal(statusTone([]), "none");
    assert.equal(statusTone(null), "none");
  });
});
