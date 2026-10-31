/**
 * The shared, system-agnostic text reader (`stream-cards/text/read-text.js`).
 *
 * Every system reader builds a typed line's card from it, so these pin what a line says on the stream
 * whichever system the world runs: the Roleplay Chat mode flag beats the chat style, a narrator line is
 * nobody, a hidden name reaches the card as a label key and never as the name, and nothing private is
 * ever a card.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { rpModeFlags } from "../scripts/core/rp-mode.mjs";
import {
  RP_TEXT,
  isPublicText,
  isTypedText,
  playersSeeDisplayName,
  readText,
  speakerNameHidden,
  textRowOf
} from "../scripts/features/stream-cards/text/read-text.js";

const raw = ({ style = 2, content = "<p>Hold the line.</p>", alias = "Bram", mode = null, whisper = [], blind = false } = {}) => ({
  style,
  content,
  speaker: { alias },
  flags: mode ? rpModeFlags(mode) : {},
  whisper,
  blind
});

const actor = (name = "Bram Holt") => ({ name, isNpc: false, img: "bram.webp", imgKind: "portrait", focus: null });

describe("a Roleplay Chat line", () => {
  test("each mode headlines, quotes and tones as its own kind", () => {
    const want = {
      say: ["Says", "speech", "say"],
      do: ["Does", "emote", "do"],
      think: ["Thinks", "thought", "think"],
      narrator: ["Narration", "narration", "narrator"]
    };
    for (const [mode, [key, style, tone]] of Object.entries(want)) {
      const card = readText(raw({ mode, style: mode === "do" ? 3 : 2 }), { actor: actor() });
      assert.equal(card.action.labelKey, key, mode);
      assert.equal(card.text.style, style, mode);
      assert.equal(card.tone, tone, mode);
    }
  });

  test("the flag beats the style: a thought posted as IC is not speech", () => {
    assert.equal(textRowOf(raw({ mode: "think", style: 2 })), "thought");
    assert.equal(textRowOf(raw({ style: 2 })), "speech");
  });

  test("a narrator line is nobody: its alias, no art, whatever the reader resolved", () => {
    const card = readText(raw({ mode: "narrator", alias: "Narrator" }), { actor: actor("Somebody") });
    assert.equal(card.actor.name, "Narrator");
    assert.equal(card.actor.img, null);
  });

  test("a hidden name reaches the card as a label key, with the art kept", () => {
    const card = readText(raw({ mode: "say", alias: "Ogre Warlord" }), { actor: { ...actor(null), img: "ogre.webp" } });
    assert.equal(card.actor.name, null);
    assert.equal(card.actor.nameKey, "Unknown");
    assert.equal(card.actor.img, "ogre.webp");
  });

  test("OOC from Roleplay Chat is the ooc row, with no tone", () => {
    // OOC is posted with no speaker, as Foundry's own /ooc is, so the author is the name.
    const card = readText(raw({ mode: "ooc", style: 1, alias: "" }), { actor: null, authorName: "Mint" });
    assert.equal(textRowOf(raw({ mode: "ooc", style: 1 })), "ooc");
    assert.equal(card.tone, null);
    assert.equal(card.actor.name, "Mint");
  });

  test("every mode has a row, a label and a quote style", () => {
    for (const [mode, entry] of Object.entries(RP_TEXT)) {
      assert.ok(entry.row && entry.key && entry.name, mode);
    }
  });
});

describe("privacy", () => {
  test("a whisper or a blind line is not public and reads as nothing", () => {
    assert.equal(isPublicText(raw({ whisper: ["u1"] })), false);
    assert.equal(isPublicText(raw({ blind: true })), false);
    assert.equal(readText(raw({ whisper: ["u1"], mode: "say" }), { actor: actor() }), null);
    assert.equal(readText(raw({ blind: true }), { actor: actor() }), null);
  });

  test("style OTHER and an empty body are not typed text", () => {
    assert.equal(isTypedText(raw({ style: 0 })), false);
    assert.equal(isTypedText(raw({ content: "<p> </p>" })), false);
  });

  test("a name is hidden only for a GM's unowned creature whose name players cannot read", () => {
    const base = { authorIsGM: true, hasPlayerOwner: false, nameVisibility: true, playersCanSeeName: false };
    assert.equal(speakerNameHidden(base), true);
    assert.equal(speakerNameHidden({ ...base, authorIsGM: false }), false, "a player's own line");
    assert.equal(speakerNameHidden({ ...base, hasPlayerOwner: true }), false, "a PC");
    assert.equal(speakerNameHidden({ ...base, nameVisibility: false }), false, "a world that hides no names");
    assert.equal(speakerNameHidden({ ...base, playersCanSeeName: undefined }), false, "no token, no nameplate");
  });

  test("outside PF2e, the token's nameplate mode decides", () => {
    assert.equal(playersSeeDisplayName(50), true, "always");
    assert.equal(playersSeeDisplayName(30), true, "hover");
    assert.equal(playersSeeDisplayName(40), false, "owner");
    assert.equal(playersSeeDisplayName(20), false, "owner hover");
    assert.equal(playersSeeDisplayName(0), false, "none");
    assert.equal(playersSeeDisplayName(undefined), null);
  });
});
