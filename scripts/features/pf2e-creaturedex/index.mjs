/**
 * Creaturedexing — *Adventures+* pp. 77–79. Suite adapter.
 *
 *   "Knowledge is power and the creaturedex rules seek to make the Recall
 *    Knowledge more advantageous during combat encounters by providing more
 *    direct knowledge to the players."
 *
 * A stat block is three sections; Recall Knowledge buys them one at a time; all
 * three is a Completed Creaturedex, which grants the Discerning Aid reaction.
 *
 * ## The GM reveals; nothing watches a roll
 *
 * The book's trigger is a Recall Knowledge check, but the *module's* trigger is
 * the GM pressing a button. That is deliberate and it is the whole shape of the
 * feature: a table's knowledge is granted for reasons a die roll does not cover
 * — a check made out of character, a creature nobody targeted, something a
 * player worked out and was simply told. Watching rolls would make those the
 * exceptions instead of the ordinary case, and it would put a player's click on
 * the write path of a world setting for no gain.
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
import { DELIVERY, FEATURE_ID, PREFIX, SETTINGS } from "./constants.mjs";
import { CreaturedexApp, mayOpen } from "./app.mjs";
import { dexKey } from "./identity.mjs";

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

  // Party Knowledge is ON. The sidebar presents sharing as the collaborative
  // option, and a per-player dex locks the player who missed a session out of
  // knowledge their character was standing next to.
  game.settings.register(SUITE_ID, SETTINGS.party, bool(SETTINGS.party, true));
  // Auto-granting an item to a PC is invasive, and the reaction is per-creature
  // — a granted item has to consult the dex at use time anyway, so the grant
  // buys almost nothing over printing the reaction on the entry.
  game.settings.register(SUITE_ID, SETTINGS.grantAid, bool(SETTINGS.grantAid, false));
  game.settings.register(SUITE_ID, SETTINGS.playerAccess, bool(SETTINGS.playerAccess, true));
  game.settings.register(SUITE_ID, SETTINGS.doctorIwr, bool(SETTINGS.doctorIwr, false));

  // How a Recall Knowledge check gets answered when `pf2e-recall` is also on.
  // Explicit rather than accidental: the prose saying "you sense it is
  // dangerous" beside a card printing AC 24 is two answers to one roll.
  game.settings.register(SUITE_ID, SETTINGS.delivery, {
    name: `GLDEX.settings.${SETTINGS.delivery.slice(PREFIX.length)}.name`,
    hint: `GLDEX.settings.${SETTINGS.delivery.slice(PREFIX.length)}.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      [DELIVERY.both]: "GLDEX.delivery.both",
      [DELIVERY.prose]: "GLDEX.delivery.prose",
      [DELIVERY.sections]: "GLDEX.delivery.sections",
    },
    default: DELIVERY.both,
  });
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
    if (game.user.isGM && ["npc", "hazard"].includes(doc.type)) return { subject: dexKey(doc), pending: doc };
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

/* ── From a token on the canvas ──────────────────────────────────────────── */

/**
 * The creature a user means right now: their target, else their controlled
 * token, else the token under the pointer.
 *
 * Targeting is the only one of the three a player can perform on a hostile
 * creature — they cannot control it and its sheet is closed to them — so it
 * leads. The other two are there for the GM, who almost always has the thing
 * selected rather than targeted.
 */
function pointedActor() {
  const targeted = [...(game.user?.targets ?? [])][0]?.actor ?? null;
  if (targeted) return targeted;
  const controlled = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  if (controlled) return controlled;
  return canvas?.tokens?.hover?.actor ?? null;
}

/**
 * A keybinding, because the canvas has no gesture a player can use on a creature
 * they do not own.
 *
 * Double-click opens a sheet they have no permission for, right-click opens a
 * HUD they cannot summon, and the token's context menu belongs to the GM. Core
 * Foundry leaves `K` unbound, and a user can rebind it from Foundry's own
 * Configure Controls.
 */
function registerKeybinding() {
  try {
    game.keybindings.register(SUITE_ID, "dex.openTarget", {
      name: "GLDEX.app.openTarget",
      editable: [{ key: "KeyK" }],
      restricted: false,
      onDown: () => {
        if (!mayOpen()) return false;
        const actor = pointedActor();
        if (!actor) return false;
        CreaturedexApp.openForActor(actor);
        return true;
      },
    });
  } catch (error) {
    warn("pf2e-creaturedex | could not register the open-target keybinding", error);
  }
}

/**
 * A button on the token HUD.
 *
 * This is the GM's road in and, in practice, only theirs: the HUD is summoned by
 * right-clicking a token you control, and a player controls none of the
 * creatures in this dex. It is registered anyway rather than gated on `isGM`,
 * because a summoner's own minion is a creature a player owns and might well
 * have studied.
 */
function registerTokenHud() {
  Hooks.on("renderTokenHUD", (hud, html) => {
    try {
      if (!mayOpen()) return;
      const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
      const column = root?.querySelector(".col.left") ?? root?.querySelector(".control-icons");
      const actor = hud?.object?.actor ?? null;
      if (!column || !actor || !["npc", "hazard"].includes(actor.type)) return;
      if (!CreaturedexApp.mayView(actor)) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "control-icon gldex-hud";
      button.dataset.action = "gldex";
      button.setAttribute("aria-label", L("GLDEX.app.title") || "Creaturedex");
      button.innerHTML = '<i class="fa-solid fa-book-skull"></i>';
      button.addEventListener("click", () => CreaturedexApp.openForActor(actor));
      column.append(button);
    } catch (error) {
      warn("pf2e-creaturedex | could not add the token HUD button", error);
    }
  });
}

/**
 * A scene control, which is the browsable road in.
 *
 * The two moments this feature serves want different surfaces. "What do I know
 * about *this* thing" is one click from a token, mid-combat. "What have we
 * learned" is a shelf you browse between sessions, and a shelf needs somewhere
 * to live that is not attached to any one creature — which is what this is.
 *
 * It sits under Token controls rather than getting a layer of its own: a whole
 * scene-control group for one button is a lot of chrome, and Foundry's own
 * grouping puts "things about creatures on the board" there.
 *
 * v13 changed `getSceneControlButtons` from an array of groups to a record
 * keyed by name, with `tools` a record rather than an array. Both shapes are
 * handled because the suite supports v13 and v14, and reading the wrong one is
 * a button that simply never appears.
 */
function registerSceneControl() {
  Hooks.on("getSceneControlButtons", (controls) => {
    try {
      if (!mayOpen()) return;
      const group = Array.isArray(controls) ? controls.find((c) => c.name === "token") : controls?.token;
      if (!group) return;
      const tool = {
        name: "gldex",
        title: "GLDEX.app.open",
        icon: "fa-solid fa-book-skull",
        button: true,
        visible: true,
        order: 99,
        onChange: () => CreaturedexApp.open({}),
        onClick: () => CreaturedexApp.open({}),
      };
      if (Array.isArray(group.tools)) {
        if (!group.tools.some((t) => t.name === "gldex")) group.tools.push(tool);
      } else if (group.tools && typeof group.tools === "object") {
        group.tools.gldex ??= tool;
      }
    } catch (error) {
      warn("pf2e-creaturedex | could not add the scene control", error);
    }
  });
}

/**
 * Right-click an actor in the sidebar.
 *
 * The GM's mental model is "this creature", and sometimes that creature is a
 * row in the Actors directory rather than a token on a map — prep, or a
 * creature that is not on the board at all. `pf2e-recall` reaches its own panel
 * the same way, so this reads as native rather than as a second convention.
 *
 * v13 renamed `getActorDirectoryEntryContext` to `getActorContextOptions`.
 * Both are registered because the suite supports v13 and v14; the guard keeps a
 * double registration from producing two identical menu items.
 */
function registerContextMenu() {
  /**
   * A FRESH entry object per menu, never a shared one. ContextMenu writes
   * `entry.element` onto the object it renders and resolves a click by matching
   * it back, so one object pushed into two menus has the two of them fighting
   * over a single slot and the loser's click silently does nothing.
   */
  const entry = () => ({
    name: "GLDEX.app.open",
    icon: '<i class="fa-solid fa-book-skull"></i>',
    condition: (target) => {
      if (!mayOpen()) return false;
      const li = target instanceof HTMLElement ? target : target?.[0];
      const actor = game.actors?.get(li?.dataset?.entryId ?? li?.dataset?.documentId);
      if (!actor || !["npc", "hazard"].includes(actor.type)) return false;
      return !!CreaturedexApp.mayView(actor);
    },
    callback: (target) => {
      const li = target instanceof HTMLElement ? target : target?.[0];
      const actor = game.actors?.get(li?.dataset?.entryId ?? li?.dataset?.documentId);
      return actor ? CreaturedexApp.openForActor(actor) : null;
    },
  });

  const add = (options) => {
    if (options.some((o) => o.name === "GLDEX.app.open")) return;
    options.push(entry());
  };
  Hooks.on("getActorDirectoryEntryContext", (_html, options) => add(options));
  Hooks.on("getActorContextOptions", (_app, options) => add(options));
}

function onInit() {
  registerHeaderButtons();
  registerSceneControl();
  registerContextMenu();
  registerKeybinding();
  registerTokenHud();
  // An open window follows the target, so a player aiming at something they
  // have studied sees its entry without touching the window at all.
  Hooks.on("targetToken", (user, token, targeted) => {
    if (user !== game.user || !targeted) return;
    if (token?.actor) CreaturedexApp.followTarget(token.actor);
  });
}

function onReady() {}

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
