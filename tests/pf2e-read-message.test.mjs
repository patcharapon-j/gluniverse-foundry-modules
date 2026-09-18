import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CHECK_TYPE_KEYS, readMessage, headingText, degreeOf, fxOf, visibilityOf } from "../scripts/features/stream-cards/pf2e/read-message.js";

const load = name => JSON.parse(readFileSync(new URL(`./fixtures/pf2e/${name}`, import.meta.url), "utf8"));
/** Captured on the GM client and on a non-GM client (the stream's point of view). */
const captures = { gm: load("capture-gm.json"), player: load("capture-player.json") };

for (const [viewer, capture] of Object.entries(captures)) {
  const byLabel = label => {
    const found = capture.messages.filter(m => m.label === label);
    assert.ok(found.length, `fixture ${label} missing`);
    return found;
  };
  const read = label => readMessage(byLabel(label)[0]);

  describe(`PF2e 8.4 fixtures read on the ${viewer} client`, () => {
    test("a plain hit shows total, natural, DC and success with no cracks", () => {
      const card = read("strike-map5");
      assert.equal(card.kind, "check");
      assert.equal(card.visibility, "public");
      assert.deepEqual(card.player, { name: "Player2" });
      assert.equal(card.actor.name, "Kyra");
      assert.equal(card.actor.imgKind, "portrait");
      assert.equal(card.actor.img, "systems/pf2e/icons/iconics/portraits/kyra.webp");
      assert.equal(card.target.name, "Oleg");
      assert.equal(card.action.label, "Melee Strike: +1 Scimitar");
      assert.equal(card.action.map, 1);
      assert.deepEqual(card.roll, { natural: 12, total: 15, dc: 12, dcVisible: true, degree: 2 });
      assert.equal(card.fx, null);
      assert.equal(card.originKey, "Actor.MjkJCqGyiVNWlcLU.Item.Kf9Fu77b4kHAwSUm");
    });

    test("a natural 20 critical success cracks gold", () => {
      const card = read("strike-crit");
      assert.equal(card.roll.natural, 20);
      assert.equal(card.roll.degree, 3);
      assert.equal(card.fx, "gold");
    });

    test("a critical success without a natural 20 still cracks gold", () => {
      const card = read("strike-map0-hit");
      assert.equal(card.roll.natural, 14);
      assert.equal(card.roll.degree, 3);
      assert.equal(card.fx, "gold");
    });

    test("a miss is a failure with no cracks", () => {
      const card = read("strike-miss");
      assert.equal(card.roll.degree, 1);
      assert.equal(card.fx, null);
    });

    test("a natural 1 critical failure on a save cracks red", () => {
      const card = read("save-reflex-dc-fumble");
      assert.equal(card.action.label, "Reflex Saving Throw");
      assert.equal(card.target, null);
      assert.deepEqual(card.roll, { natural: 1, total: 7, dc: 22, dcVisible: true, degree: 0 });
      assert.equal(card.fx, "red");
      assert.equal(card.originKey, null);
    });

    test("a roll with no DC has no degree, and a natural 20 still cracks gold", () => {
      const plain = read("skill-nodc");
      assert.equal(plain.action.label, "Religion Check");
      assert.deepEqual(plain.roll, { natural: 9, total: 20, dc: null, dcVisible: false, degree: null });
      assert.equal(plain.fx, null);
      const twenty = read("skill-nodc-nat20");
      assert.equal(twenty.roll.degree, null);
      assert.equal(twenty.fx, "gold");
    });

    test("damage carries typed parts, the crit flag and the attack's origin key", () => {
      const hit = read("strike-map0-damage");
      assert.equal(hit.kind, "damage");
      assert.equal(hit.originKey, "Actor.MjkJCqGyiVNWlcLU.Item.Kf9Fu77b4kHAwSUm");
      assert.equal(hit.damage.crit, false);
      assert.equal(hit.damage.total, 4);
      assert.deepEqual(hit.damage.parts, [{ type: "slashing", amount: 4, persistent: false }]);
      assert.equal(hit.fx, null);
      const crit = read("strike-crit-damage");
      assert.equal(crit.damage.crit, true);
      assert.equal(crit.damage.total, 12);
      assert.equal(crit.fx, "pop");
      assert.equal(crit.action.label, "Damage Roll: +1 Scimitar (Critical Hit)");
    });

    test("an attack spell chains cast, attack and damage on one origin key", () => {
      const [cast, sibling] = byLabel("spell-attack-cast");
      const castCard = readMessage(cast);
      assert.equal(castCard.kind, "cast");
      assert.deepEqual(castCard.spell, {
        name: "Fire Ray", tradition: "divine", rank: 2, isCantrip: false, dc: null, save: null, attackBonus: 9
      });
      assert.equal(readMessage(sibling), null, "another module's untyped follow-up message is hidden");
      const attack = read("spell-attack-roll");
      assert.equal(attack.action.label, "Fire Ray");
      assert.equal(attack.action.sub, "Divine Spell Attack");
      assert.equal(attack.fx, "gold");
      const damage = read("spell-attack-damage");
      assert.equal(castCard.originKey, attack.originKey);
      assert.equal(attack.originKey, damage.originKey);
    });

    test("a save spell shows its DC and save type", () => {
      const card = read("spell-save-cast");
      assert.deepEqual(card.spell, {
        name: "Daze", tradition: "divine", rank: 2, isCantrip: true, dc: 19,
        save: { statistic: "will", basic: true }, attackBonus: null
      });
      assert.equal(card.originKey, read("spell-save-damage").originKey);
    });

    test("a player's own blind roll is shown with its result, other secret rolls are hidden", () => {
      const blind = read("blind-own-roll");
      assert.equal(blind.visibility, "ownBlind");
      assert.equal(blind.roll.total, 18);
      assert.equal(blind.roll.natural, 17);
      assert.equal(read("gm-secret-blind"), null);
      assert.equal(read("gm-whisper"), null);
    });

    test("a public GM roll becomes the NPC variant with its DC hidden", () => {
      const card = read("gm-npc-strike");
      assert.equal(card.player, null);
      assert.equal(card.actor.isNpc, true);
      assert.equal(card.actor.imgKind, "token");
      assert.equal(card.actor.img, null, "the default NPC icon is not a portrait");
      assert.equal(card.actor.name, "Ambush Scout", "name visibility is off in this world");
      assert.equal(card.target.name, "Kyra");
      assert.equal(card.roll.dc, 19);
      assert.equal(card.roll.dcVisible, false);
      assert.equal(read("gm-npc-damage").originKey, card.originKey);
    });

    test("a hero point reroll reads the new natural, not the copied post-roll option", () => {
      const card = read("reroll-heropoint");
      assert.equal(card.isReroll, true);
      assert.equal(card.roll.natural, 20);
      assert.equal(card.roll.degree, 3);
      assert.equal(card.fx, "gold");
    });

    test("initiative is a check without a DC", () => {
      const card = read("initiative");
      assert.equal(card.kind, "check");
      assert.equal(card.action.label, "Initiative: Perception");
      assert.equal(card.roll.degree, null);
    });

    test("an action posted from a sheet is an action card named from its content", () => {
      const card = read("action-post");
      assert.equal(card.kind, "action");
      assert.equal(card.action.label, "Hide");
      assert.equal(card.action.cost, null, "the captured action came from an unsaved item, so PF2e could not resolve its cost");
      assert.equal(card.roll, null);
    });
  });
}

describe("rules", () => {
  test("hidden names apply when PF2e name visibility is on and the token hides its name", () => {
    const snapshot = structuredClone(captures.gm.messages.find(m => m.label === "gm-npc-strike"));
    snapshot.derived.nameVisibilitySetting = true;
    const card = readMessage(snapshot);
    assert.equal(card.actor.name, null);
    assert.equal(card.target.name, "Kyra", "a player-owned target keeps its name");
  });

  test("a GM's focus point applies only to the image it was set for", () => {
    const snapshot = structuredClone(captures.gm.messages.find(m => m.label === "strike-map5"));
    const img = "systems/pf2e/icons/iconics/portraits/kyra.webp";
    snapshot.derived.actor.focusOverrides = [
      { src: "old/art.webp", x: 0.9, y: 0.9, w: 0.1 },
      { src: img, x: 0.1, y: 0.05, w: 0.6 },
      { src: img, x: "bad", y: 0, w: 0.5 }
    ];
    assert.deepEqual(readMessage(snapshot).actor.focus, { x: 0.1, y: 0.05, w: 0.6 });
    snapshot.derived.actor.focusOverrides = [{ src: "old/art.webp", x: 0.1, y: 0.1, w: 0.5 }];
    assert.equal(readMessage(snapshot).actor.focus, null);
  });

  test("a GM roll with no art of its own falls back to the world's default roll art", () => {
    const snapshot = structuredClone(captures.gm.messages.find(m => m.label === "gm-npc-strike"));
    assert.equal(readMessage(snapshot).actor.img, null, "the fixture's creature is still on a default icon");
    snapshot.derived.defaultArt = { src: "worlds/stream/gm-roll.webp", focus: { x: 0.2, y: 0.05, w: 0.5 } };
    const card = readMessage(snapshot);
    assert.equal(card.actor.img, "worlds/stream/gm-roll.webp");
    assert.equal(card.actor.imgKind, "portrait");
    assert.deepEqual(card.actor.focus, { x: 0.2, y: 0.05, w: 0.5 });

    snapshot.derived.defaultArt = { src: "worlds/stream/gm-roll.webp", focus: { x: "bad", y: 0, w: 0.5 } };
    assert.equal(readMessage(snapshot).actor.focus, null, "an unusable framing leaves the picture to face detection");
  });

  test("the default roll art replaces nothing: not a roll's own art, not a player's roll", () => {
    const defaultArt = { src: "worlds/stream/gm-roll.webp", focus: null };
    const withArt = structuredClone(captures.gm.messages.find(m => m.label === "strike-map5"));
    withArt.derived.defaultArt = defaultArt;
    assert.equal(readMessage(withArt).actor.img, "systems/pf2e/icons/iconics/portraits/kyra.webp");

    const fromPlayer = structuredClone(captures.gm.messages.find(m => m.label === "gm-npc-strike"));
    fromPlayer.derived.authorIsGM = false;
    fromPlayer.derived.defaultArt = defaultArt;
    assert.equal(readMessage(fromPlayer).actor.img, null);

    const unset = structuredClone(captures.gm.messages.find(m => m.label === "gm-npc-strike"));
    unset.derived.defaultArt = { src: "", focus: null };
    assert.equal(readMessage(unset).actor.img, null, "no picture set leaves the monogram in place");
  });

  test("visibility: public, own blind, and everything else hidden", () => {
    assert.equal(visibilityOf({ blind: false, whisper: [] }, { authorIsGM: true }), "public");
    assert.equal(visibilityOf({ blind: true, whisper: ["gm"] }, { authorIsGM: false }), "ownBlind");
    assert.equal(visibilityOf({ blind: true, whisper: ["gm"] }, { authorIsGM: true }), null);
    assert.equal(visibilityOf({ blind: false, whisper: ["gm"] }, { authorIsGM: false }), null);
  });

  test("fx: degree first, natural only without a DC", () => {
    assert.equal(fxOf(3, 5), "gold");
    assert.equal(fxOf(0, 15), "red");
    assert.equal(fxOf(2, 20), null, "a natural 20 that only reached success does not crack");
    assert.equal(fxOf(null, 20), "gold");
    assert.equal(fxOf(null, 1), "red");
    assert.equal(fxOf(null, 12), null);
  });

  test("a flat check shows success and failure — its degree is never gated on a DC in the context", () => {
    // PF2e records the outcome it resolved on the message and on the roll. Where it puts the DC is its
    // own business, and a flat check is the case where the two part company: gating the degree on
    // `context.dc` left every flat check on the stream with no Success and no Failure on it.
    const roll = { total: 14, d20Results: [{ result: 14, active: true }], degreeOfSuccess: null };
    assert.equal(degreeOf({ type: "flat-check", outcome: "success" }, roll, null), 2);
    assert.equal(degreeOf({ type: "flat-check" }, { ...roll, degreeOfSuccess: 1 }, null), 1);
    // Outcome absent, DC known: a flat check has no critical degrees, so the comparison is the answer.
    assert.equal(degreeOf({ type: "flat-check" }, roll, 11), 2);
    assert.equal(degreeOf({ type: "flat-check" }, roll, 15), 1);
    assert.equal(degreeOf({ type: "flat-check" }, roll, null), null, "no DC and no outcome says nothing");
    // Every other check keeps PF2e's own bands: guessing them here would put a degree on the stream
    // that the player's chat card does not carry.
    assert.equal(degreeOf({ type: "skill-check" }, roll, 11), null);
    assert.equal(degreeOf({ type: "saving-throw" }, roll, 11), null);
  });

  test("a check with no heading to read hands over a label key, never PF2e's raw type", () => {
    const flat = structuredClone(captures.player.messages.find(m => m.label === "skill-nodc"));
    flat.raw.flags.pf2e.context.type = "flat-check";
    flat.raw.flags.pf2e.context.dc = { value: 11 };
    flat.raw.flavor = "<p>no heading here</p>";
    const card = readMessage(flat);
    assert.equal(card.action.label, null, "a raw context type is not a phrase to put on a stream");
    assert.equal(card.action.labelKey, "FlatCheck");
    assert.equal(card.roll.degree, card.roll.total >= 11 ? 2 : 1);
    // A heading, where PF2e gives one, still wins: it names the actual skill or strike.
    assert.equal(readMessage(captures.player.messages.find(m => m.label === "skill-nodc")).action.labelKey, null);
  });

  test("every check type the reader accepts has a label key behind it", () => {
    for (const [type, key] of Object.entries(CHECK_TYPE_KEYS)) {
      assert.ok(key && /^[A-Za-z]+$/.test(key), `${type} -> ${key}`);
    }
  });

  test("headingText strips markup and action glyphs", () => {
    assert.equal(headingText('<h4 class="action"><strong>Take Cover</strong> <span class="pf2-icon larger">1</span></h4>'), "Take Cover");
    assert.equal(headingText("<p>no heading</p>"), null);
    assert.equal(headingText(null), null);
  });
});
