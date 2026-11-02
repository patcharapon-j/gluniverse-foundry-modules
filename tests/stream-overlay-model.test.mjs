/**
 * The stream view's pure halves: who the cloned-card path lets through, what a stored chat setting
 * becomes, which tab a contributed section lands on, and what the on-air strip says.
 *
 * Each of these renders perfectly when wrong. A whisper to a player reached the stream because the old
 * test only refused whispers to the GM; a stored lifetime of 0 removed every card the frame it landed.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isAudienceVisible } from "../scripts/features/stream/audience.mjs";
import { CHAT_LIMITS, sanitizeChatSettings } from "../scripts/features/stream/chat-settings.mjs";
import { CARD_SCALE_RANGE, CHAT_POSITIONS, DEFAULT_CHAT_SETTINGS } from "../scripts/features/stream/constants.js";
import { DEFAULT_PANEL_TAB, PANEL_TABS, panelTabOf } from "../scripts/features/stream/extensions.mjs";
import { ON_AIR_STATES, onAirState } from "../scripts/features/stream/room-model.mjs";

describe("isAudienceVisible", () => {
  test("a whisper to a player never reaches the stream", () => {
    assert.equal(isAudienceVisible({ whisper: ["player-id"] }), false);
  });
  test("a whisper held in a Set is still a whisper", () => {
    assert.equal(isAudienceVisible({ whisper: new Set(["gm-id"]) }), false);
  });
  test("a blind roll is refused even with no recipients", () => {
    assert.equal(isAudienceVisible({ blind: true, whisper: [] }), false);
  });
  test("a public message is shown", () => {
    assert.equal(isAudienceVisible({ whisper: [] }), true);
    assert.equal(isAudienceVisible({}), true);
  });
  test("no message is not shown", () => {
    assert.equal(isAudienceVisible(null), false);
  });
});

describe("sanitizeChatSettings", () => {
  test("a missing value reads as the defaults", () => {
    assert.deepEqual(sanitizeChatSettings(undefined), sanitizeChatSettings({}));
    assert.equal(sanitizeChatSettings(undefined).position, DEFAULT_CHAT_SETTINGS.position);
  });
  test("a zero, blank or nonsense lifetime falls back instead of removing every card at once", () => {
    for (const lifetimeMs of [0, "", null, -1, "soon", Number.NaN]) {
      assert.equal(sanitizeChatSettings({ lifetimeMs }).lifetimeMs, DEFAULT_CHAT_SETTINGS.lifetimeMs, String(lifetimeMs));
    }
  });
  test("numbers are clamped to the room's limits", () => {
    assert.equal(sanitizeChatSettings({ lifetimeMs: 10 }).lifetimeMs, CHAT_LIMITS.lifetimeMs.min);
    assert.equal(sanitizeChatSettings({ lifetimeMs: 1e9 }).lifetimeMs, CHAT_LIMITS.lifetimeMs.max);
    assert.equal(sanitizeChatSettings({ maxVisible: 99 }).maxVisible, CHAT_LIMITS.maxVisible.max);
    assert.equal(sanitizeChatSettings({ maxVisible: 2.6 }).maxVisible, 3);
    assert.equal(sanitizeChatSettings({ offsetX: -99999 }).offsetX, CHAT_LIMITS.offset.min);
    assert.equal(sanitizeChatSettings({ critLifetimeMultiplier: 50 }).critLifetimeMultiplier, CHAT_LIMITS.critLifetimeMultiplier.max);
    assert.equal(sanitizeChatSettings({ cardScale: 99 }).cardScale, CARD_SCALE_RANGE.max);
  });
  test("an offset of 0 is kept, a blank one is the default", () => {
    assert.equal(sanitizeChatSettings({ offsetY: 0 }).offsetY, 0);
    assert.equal(sanitizeChatSettings({ offsetY: "" }).offsetY, DEFAULT_CHAT_SETTINGS.offsetY);
  });
  test("an unknown corner falls back to a real one", () => {
    assert.equal(sanitizeChatSettings({ position: "centre" }).position, DEFAULT_CHAT_SETTINGS.position);
    for (const position of CHAT_POSITIONS) assert.equal(sanitizeChatSettings({ position }).position, position);
  });
});

describe("panel tabs", () => {
  test("a section that names no tab, or a tab that does not exist, lands on the default", () => {
    assert.equal(panelTabOf({}), DEFAULT_PANEL_TAB);
    assert.equal(panelTabOf({ tab: "nowhere" }), DEFAULT_PANEL_TAB);
    assert.ok(PANEL_TABS.includes(DEFAULT_PANEL_TAB));
  });
  test("a real tab is kept", () => {
    for (const tab of PANEL_TABS) assert.equal(panelTabOf({ tab }), tab);
  });
});

describe("onAirState", () => {
  const base = { streamUserId: "u", connected: true };
  test("every state it can return is a declared state", () => {
    const seen = new Set([
      onAirState({ streamUserId: "", connected: false, status: null }),
      onAirState({ ...base, connected: false, status: null }),
      onAirState({ ...base, status: null }),
      onAirState({ ...base, status: { active: false } }),
      onAirState({ ...base, status: { active: true } }),
      onAirState({ ...base, status: { active: true, restoreVisible: true } })
    ]);
    assert.deepEqual([...seen].sort(), [...ON_AIR_STATES].sort());
  });
  test("live with Foundry's UI showing is its own state", () => {
    assert.equal(onAirState({ ...base, status: { active: true, restoreVisible: true } }), "exposed");
    assert.equal(onAirState({ ...base, status: { active: true, restoreVisible: false } }), "live");
  });
  test("an offline login is never reported live from a stale status", () => {
    assert.equal(onAirState({ ...base, connected: false, status: { active: true } }), "offline");
  });
});
