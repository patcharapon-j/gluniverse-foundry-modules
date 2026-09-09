/**
 * Creaturedexing — *Adventures+* pp. 77–79. Suite adapter.
 *
 *   "Knowledge is power and the creaturedex rules seek to make the Recall
 *    Knowledge more advantageous during combat encounters by providing more
 *    direct knowledge to the players."
 *
 * A stat block is three sections; Recall Knowledge buys them one at a time; all
 * three is a Completed Creaturedex, which grants the Discerning Aid reaction.
 * Every optional reading the book prints in a sidebar — Party Knowledge, It's
 * Not a Secret, the 1d4 pick — is a setting here rather than a decision baked
 * into the code, because the book prints them as choices for the table.
 *
 * ## Its relationship with the Recall Knowledge feature
 *
 * `features/pf2e-recall` deliberately computes no DCs and prints no numbers: it
 * hands the GM a paragraph to read aloud. This feature is the opposite half —
 * the book calls it "a simulationist ruleset, as literal numbers and mechanics
 * are revealed to the players". They compose rather than compete: the ladder is
 * what the GM *says*, the dex is what the party can *look up*. Neither reads the
 * other's storage and either can run alone.
 *
 * See docs/CREATUREDEX.md.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID, warn } from "../../core/const.mjs";
import { FEATURE_ID, PREFIX, SETTINGS } from "./constants.mjs";
import { CreaturedexApp, mayOpen } from "./app.mjs";
import { onRenderChat, stampSubject } from "./chat.mjs";
import { registerRevealSocket } from "./reveal.mjs";
import { noteObserved, subjectKey } from "./store.mjs";

const L = (key) => {
  const s = game.i18n.localize(key);
  return s === key ? "" : s;
};

const bool = (key, dflt) => ({
  name: `GLDEX.settings.${key.slice(PREFIX.length)}.name`,
  hint: `GLDEX.settings.${key.slice(PREFIX.length)}.hint`,
  scope: "world",
  config: true,
  type: Boolean,
  default: dflt,
});

function registerSettings() {
  // The dex itself. A world setting rather than document flags — see store.mjs
  // for why knowledge cannot live on either end of the relation it describes.
  game.settings.register(SUITE_ID, "dex.knowledge", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(SUITE_ID, SETTINGS.party, bool(SETTINGS.party, false));
  game.settings.register(SUITE_ID, SETTINGS.noSecret, bool(SETTINGS.noSecret, false));
  game.settings.register(SUITE_ID, SETTINGS.randomSection, bool(SETTINGS.randomSection, false));
  game.settings.register(SUITE_ID, SETTINGS.grantAid, bool(SETTINGS.grantAid, true));
  game.settings.register(SUITE_ID, SETTINGS.chatOffer, bool(SETTINGS.chatOffer, true));
  game.settings.register(SUITE_ID, SETTINGS.playerAccess, bool(SETTINGS.playerAccess, true));
}

/* ── observed turns ──────────────────────────────────────────────────────── */

/**
 * A creature's turn ending is what pays for the next Recall Knowledge attempt
 * against it, so it is counted when the turn *ends* rather than when it starts.
 *
 * Only the active GM writes. Every client fires this hook, and a world setting
 * written by five clients at once is five round trips and a race.
 */
function registerObservation() {
  const seen = (combat, prior) => {
    if (game.users?.activeGM !== game.user) return;
    const combatant = prior?.combatantId ? combat?.combatants?.get(prior.combatantId) : null;
    const actor = combatant?.actor ?? null;
    if (!actor || !["npc", "hazard"].includes(actor.type)) return;
    const key = subjectKey(actor);
    if (!key) return;
    noteObserved(key, combat?.id ?? null).catch((e) => warn("pf2e-creaturedex | observation failed", e));
  };
  Hooks.on("combatTurnChange", seen);
}

/* ── the way in ──────────────────────────────────────────────────────────── */

/**
 * The dex opens from a sheet header, on both generations of sheet.
 *
 * ApplicationV2 sheets fire `getHeaderControlsApplicationV2`; PF2e's own actor
 * sheets are still AppV1 and fire `getActorSheetHeaderButtons`. A document only
 * ever reaches one of them, so registering both cannot double the button.
 *
 * A character sheet opens that character's dex — which is the player's road in,
 * and the only one they need. An NPC or hazard sheet is GM-only and opens the
 * dex focused on that creature, which is the GM's.
 */
function registerHeaderButtons() {
  const target = (app) => {
    const doc = app?.document ?? app?.actor ?? null;
    if (doc?.documentName !== "Actor") return null;
    if (doc.type === "character") return { ownerId: doc.id };
    if (game.user.isGM && ["npc", "hazard"].includes(doc.type)) return { subjectUuid: doc.uuid };
    return null;
  };

  const label = () => L("GLDEX.app.open") || "Creaturedex";

  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    if (!mayOpen()) return;
    const options = target(app);
    if (!options) return;
    controls.push({ icon: "fa-solid fa-book-skull", label: label(), onClick: () => CreaturedexApp.open(options) });
  });

  Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    if (!mayOpen()) return;
    const options = target(app);
    if (!options) return;
    buttons.unshift({
      class: "gldex-open",
      icon: "fa-solid fa-book-skull",
      label: label(),
      onclick: () => CreaturedexApp.open(options),
    });
  });
}

function onInit() {
  registerHeaderButtons();
  registerObservation();
  Hooks.on("createChatMessage", (message) => {
    stampSubject(message).catch((e) => warn("pf2e-creaturedex | stamp failed", e));
  });
  Hooks.on("renderChatMessageHTML", onRenderChat);
}

function onReady() {
  registerRevealSocket();
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.pf2e-creaturedex.title",
  hint: "GLS.feature.pf2e-creaturedex.hint",
  icon: "fa-solid fa-book-skull",
  settingPrefix: PREFIX,
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api: { open: (options) => CreaturedexApp.open(options ?? {}) },
});
