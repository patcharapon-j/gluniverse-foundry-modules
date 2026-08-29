/**
 * GLUniverse Suite — Recall Knowledge feature adapter.
 *
 * A GM prep-and-play tool: turn any Actor, JournalEntry, journal page, Item or
 * Scene into one read-aloud paragraph per competence band (authored with Claude
 * via the clipboard), then hand back the one the roller earned, in the
 * presentation the GM chose — memory, investigation, archive, console log,
 * vision or readout. With the Insight feature enabled, the GM can also push
 * that one paragraph to one player's screen; nothing else is ever sent.
 *
 * PF2e-gated but Flatfinder-independent: without Flatfinder the ladder is still
 * a perfectly good prep document, it simply has no band to resolve against.
 * That is why `requiresFeature` is null rather than "flatfinder".
 *
 * See docs/RECALL_KNOWLEDGE.md for the band model, the presentations, and why
 * this feature computes no DCs at all.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { DEFAULT_PRESENTATION, FEATURE_ID, PRESENTATIONS, SUBJECT_TYPES } from "./constants.mjs";
import { RecallApp } from "./app.mjs";
import { hasLadder } from "./store.mjs";

const L = (k, d) => {
  const s = game.i18n.localize(k);
  return s === k ? (d ?? k) : s;
};

/* -------------------------------------------------- settings ------------ */

function registerSettings() {
  game.settings.register(SUITE_ID, "rk.mistakenIdentity", {
    name: "GLRK.settings.mistakenIdentity.name",
    hint: "GLRK.settings.mistakenIdentity.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // NOTE: the agreed design also allows an optional "escalate on repeat
  // attempts" toggle (each further recall needs one band higher). It is NOT
  // registered, deliberately: v1 is GM-only viewing, so there is no event that
  // honestly counts as "an attempt" — clicking a band chip to read the ladder
  // is not one. Registering a toggle nothing reads would be a setting that
  // silently lies. It belongs with the roll-driven path (see the v2 notes in
  // docs/RECALL_KNOWLEDGE.md), where an attempt has a real trigger.

  // A campaign that is entirely ship's logs should be configured once, not on
  // every creature. These only supply the initial value of the Generate tab's
  // box; once a ladder exists, its own stamp is what the Read tab reports.
  game.settings.register(SUITE_ID, "rk.defaultPresentation", {
    name: "GLRK.settings.defaultPresentation.name",
    hint: "GLRK.settings.defaultPresentation.hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_PRESENTATION,
    choices: Object.fromEntries(
      PRESENTATIONS.map((p) => [p.key, `GLRK.presentation.${p.key}`])
    ),
  });

  game.settings.register(SUITE_ID, "rk.defaultPresentationText", {
    name: "GLRK.settings.defaultPresentationText.name",
    hint: "GLRK.settings.defaultPresentationText.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(SUITE_ID, "rk.sheetButton", {
    name: "GLRK.settings.sheetButton.name",
    hint: "GLRK.settings.sheetButton.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

/* -------------------------------------------------- integration --------- */

/**
 * Resolve the document a sheet/config application is showing.
 *
 * RecallApp is excluded explicitly: it carries a `document` of its own, so
 * without this guard the header-controls hook would add a Recall Knowledge
 * button to the Recall Knowledge window's own header.
 */
function docOf(app) {
  if (!app || app instanceof RecallApp) return null;
  const doc = app.document ?? app.object;
  return SUBJECT_TYPES.includes(doc?.documentName) ? doc : null;
}

const buttonLabel = () => L("GLRK.action.open", "Recall Knowledge");

/**
 * Header controls.
 *
 * Two generations of the same idea coexist in Foundry v13/v14 and PF2e's own
 * sheets have not all moved: ApplicationV2 sheets fire
 * `getHeaderControlsApplicationV2`, while AppV1 sheets fire the older
 * per-type `get<Type>SheetHeaderButtons`. Both are registered; a document only
 * ever reaches one of them, so there is no double-button risk.
 */
function registerHeaderButtons() {
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    if (!game.user.isGM || !game.settings.get(SUITE_ID, "rk.sheetButton")) return;
    const doc = docOf(app);
    if (!doc) return;
    controls.push({
      icon: "fa-solid fa-book-open-reader",
      label: buttonLabel(),
      onClick: () => RecallApp.show(doc),
    });
  });

  const legacy = (app, buttons) => {
    if (!game.user.isGM || !game.settings.get(SUITE_ID, "rk.sheetButton")) return;
    const doc = docOf(app);
    if (!doc) return;
    buttons.unshift({
      class: "glrk-open",
      icon: "fa-solid fa-book-open-reader",
      label: buttonLabel(),
      onclick: () => RecallApp.show(doc),
    });
  };
  // AppV1 class names, not document names: the journal entry sheet is
  // `JournalSheet` and a page's own sheet is `JournalPageSheet` (or the text
  // subclass), so a page opened in its own window gets the button too.
  for (const type of [
    "Actor",
    "Journal",
    "JournalPage",
    "JournalTextPage",
    "Item",
    "Scene",
  ]) {
    Hooks.on(`get${type}SheetHeaderButtons`, legacy);
  }
  Hooks.on("getSceneConfigHeaderButtons", legacy);
}

/**
 * Sidebar right-click entries — the literal "right-click on the sheet" ask, and
 * much faster than opening each document when prepping a whole folder.
 *
 * v13 renamed these hooks from `get<Type>DirectoryEntryContext` to
 * `get<Type>ContextOptions`. Both names are registered because the suite
 * supports v13 and v14; a guard on the entry keeps a double-registration from
 * producing two identical menu items.
 */
function registerContextMenus() {
  /**
   * A FRESH entry object per menu, never a shared one.
   *
   * ContextMenu writes `entry.element` onto the object it renders and deletes
   * it again on close, then resolves a click with
   * `menuItems.find(i => i.element === clicked)`. One object pushed into the
   * Actor, JournalEntry, Item and Scene menus means all four instances fight
   * over that single slot: whichever rendered last owns it, and every other
   * menu's lookup returns undefined, so the click silently does nothing.
   */
  const makeEntry = (collection) => ({
    name: "GLRK.action.open",
    icon: '<i class="fa-solid fa-book-open-reader"></i>',
    condition: () => game.user.isGM,
    callback: (target) => {
      const li = target instanceof HTMLElement ? target : target?.[0];
      const id = li?.dataset?.entryId ?? li?.dataset?.documentId;
      const doc = collection()?.get(id);
      return doc ? RecallApp.show(doc) : null;
    },
  });

  const COLLECTIONS = {
    Actor: () => game.actors,
    JournalEntry: () => game.journal,
    Item: () => game.items,
    Scene: () => game.scenes,
  };

  for (const [type, collection] of Object.entries(COLLECTIONS)) {
    const add = (options) => {
      if (options.some((o) => o.name === "GLRK.action.open")) return;
      options.push(makeEntry(collection));
    };
    // v13 renamed these hooks; only `get<Type>ContextOptions` fires on v14, but
    // both are registered because the suite supports v13 too. The guard above
    // keeps a double-registration from producing two identical menu items.
    Hooks.on(`get${type}DirectoryEntryContext`, (_html, options) => add(options));
    Hooks.on(`get${type}ContextOptions`, (_app, options) => add(options));
  }
}

/**
 * Right-click entry for ONE PAGE of a journal, in the page list of an open
 * journal sheet.
 *
 * A gazetteer entry is thirty places in thirty pages. One ladder written across
 * the whole entry is a brief that is mostly about the other twenty-nine, and
 * the extraction cap decides which of them the model never sees — so the page
 * is the unit a GM prepped and the unit the ladder belongs to.
 *
 * ## Why a list of hook names rather than one
 *
 * The sidebar directories settled on `get<Document>ContextOptions` in v13, but
 * the journal sheet's page list did not move with them: it builds its menu
 * through `ContextMenu.create`, whose hook name is derived from the APPLICATION
 * CLASS plus the menu's own suffix, and both halves have changed across the
 * v12/v13/v14 rewrites of that sheet. Guessing one name and being wrong is a
 * silently missing menu item, which is the failure mode this whole file is
 * written to avoid.
 *
 * So every plausible name is registered. They are inert hooks — a listener that
 * never fires costs nothing — and the entry's own `condition` is what decides
 * whether it appears: it resolves the clicked element to a real page, and
 * returns false when it cannot. A hook registered for a menu that is not a page
 * list therefore adds nothing to it, including the sidebar's own journal menu,
 * where the id under the cursor belongs to the entry and matches no page.
 */
const PAGE_CONTEXT_HOOKS = Object.freeze([
  "getJournalEntryPageContextOptions",
  "getJournalSheetPageContext",
  "getJournalEntrySheetPageContext",
  "getJournalSheetEntryContext",
  "getJournalEntrySheetEntryContext",
]);

/** Resolve the clicked list row to a JournalEntryPage, or null. */
function pageFromElement(target) {
  const el = target instanceof HTMLElement ? target : target?.[0];
  const row = el?.closest?.("[data-page-id], [data-entry-id], [data-document-id]") ?? el;
  const id = row?.dataset?.pageId ?? row?.dataset?.entryId ?? row?.dataset?.documentId;
  if (!id) return null;
  // Searched rather than resolved from a uuid because the row carries only an
  // id, and the sheet it belongs to is not passed to `condition`. Journals are
  // few and pages are indexed, so this is a map lookup per entry.
  for (const entry of game.journal ?? []) {
    const page = entry.pages?.get?.(id);
    if (page) return page;
  }
  return null;
}

function registerPageContextMenus() {
  const add = (options) => {
    if (!Array.isArray(options)) return;
    if (options.some((o) => o.name === "GLRK.action.openPage")) return;
    // A fresh object per menu, for the reason spelled out in makeEntry above:
    // ContextMenu writes `element` onto the entry it renders, so one shared
    // object across several menus makes every click but the last a no-op.
    options.push({
      name: "GLRK.action.openPage",
      icon: '<i class="fa-solid fa-book-open-reader"></i>',
      condition: (target) => game.user.isGM && !!pageFromElement(target),
      callback: (target) => {
        const page = pageFromElement(target);
        return page ? RecallApp.show(page) : null;
      },
    });
  };
  for (const hook of PAGE_CONTEXT_HOOKS) Hooks.on(hook, (_a, options) => add(options));
}

/**
 * A quiet marker on sheets that already carry a ladder, so a GM scanning a
 * folder can see which subjects are prepped without opening each one.
 */
function registerLadderMarker() {
  const mark = (app, element) => {
    const doc = docOf(app);
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!doc || !root) return;
    // Toggle rather than add: a re-render reuses the existing frame, so adding
    // would leave the mark behind after the ladder is deleted.
    root.classList.toggle("glrk-has-ladder", hasLadder(doc));
  };
  Hooks.on("renderActorSheetV2", mark);
  Hooks.on("renderJournalEntrySheet", mark);
}

/* -------------------------------------------------- lifecycle ----------- */

function onInit() {
  registerHeaderButtons();
  registerContextMenus();
  registerPageContextMenus();
  registerLadderMarker();
}

function onReady() {
  // Nothing to wire at ready: the feature opens no HUD, holds no socket, and
  // posts nothing to chat. Everything is driven from the GM's own click.
}

Suite.register({
  id: FEATURE_ID,
  title: "GLRK.feature.title",
  hint: "GLRK.feature.hint",
  icon: "fa-solid fa-book-open-reader",
  settingPrefix: "rk.",
  system: "pf2e",
  requires: [],
  requiresFeature: null,
  core: false,
  defaultEnabled: false,

  registerSettings,
  onInit,
  onReady,

  api: {
    open: (doc) => RecallApp.show(doc),
    hasLadder,
  },
});
