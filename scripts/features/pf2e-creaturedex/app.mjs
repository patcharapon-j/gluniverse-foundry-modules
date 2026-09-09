/**
 * Creaturedexing — the dex window.
 *
 * This is the surface the players actually use, and it is player-facing by
 * default. Two things follow from that and shape the whole file.
 *
 * **It renders from the creature, not from a stored copy.** A revealed section
 * is drawn out of the live actor every time the window opens, so a GM who
 * retunes a creature's numbers does not leave the party holding a stale
 * transcript of what it used to be. What is stored is only *which* sections
 * were bought.
 *
 * **A player sees exactly one character's dex.** Their own. Reading another
 * character's knowledge is the Party Knowledge sidebar's job, and when that is
 * on the union is what every character resolves to anyway — so there is never a
 * reason to expose a picker to a player, and doing it would quietly hand them
 * the answer to "what does the rogue know that I don't".
 */

import { SUITE_ID } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { SETTINGS, sectionKeys } from "./constants.mjs";
import { isComplete, missingSections } from "./rules.mjs";
import { buildSections } from "./sections.mjs";
import { renderSealed, renderSection } from "./render.mjs";
import {
  falseSections,
  forget,
  get,
  knownSections,
  knownSubjects,
  ownerKey,
  partyMode,
  redact,
  reveal,
} from "./store.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Characters this user may look at the dex of. */
export function viewableCharacters() {
  if (game.user.isGM) return game.actors.filter((a) => a.type === "character");
  const owned = game.actors.filter((a) => a.type === "character" && a.testUserPermission(game.user, "OWNER"));
  const assigned = game.user.character;
  if (assigned && !owned.includes(assigned)) owned.push(assigned);
  return owned;
}

export function mayOpen() {
  if (game.user.isGM) return true;
  return !!get(SETTINGS.playerAccess, true) && viewableCharacters().length > 0;
}

export class CreaturedexApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    // The frame stays bare; `.gl-glass` never goes on an ApplicationV2 frame,
    // because Foundry sets `.application { position: absolute }` inside
    // `@layer applications` and an unlayered utility that declares `position`
    // wins outright, dropping the window into normal document flow.
    id: "gldex-app",
    classes: ["gldex", "gldex-app"],
    tag: "div",
    window: { title: "GLDEX.app.title", icon: "fa-solid fa-book-skull", resizable: true },
    position: { width: 720, height: 660 },
    actions: {
      setOwner: CreaturedexApp.prototype._onSetOwner,
      setSubject: CreaturedexApp.prototype._onSetSubject,
      toggleSection: CreaturedexApp.prototype._onToggleSection,
      forgetSubject: CreaturedexApp.prototype._onForget,
    },
  };

  static PARTS = { main: { template: `modules/${SUITE_ID}/templates/pf2e-creaturedex/dex.hbs` } };

  #ownerId = null;
  #subjectUuid = null;

  constructor(options = {}) {
    super(options);
    this.#ownerId = options.ownerId ?? null;
    this.#subjectUuid = options.subjectUuid ?? null;
  }

  get owner() {
    const pool = viewableCharacters();
    return pool.find((a) => a.id === this.#ownerId) ?? pool[0] ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const owner = this.owner;
    const ownerId = ownerKey(owner);

    const subjects = [];
    for (const uuid of knownSubjects()) {
      const actor = await fromUuid(uuid).catch(() => null);
      if (!actor) continue;
      const { sections } = buildSections(actor);
      const available = sections.map((s) => s.key);
      const known = ownerId ? knownSections(uuid, ownerId) : [];
      // A subject nobody in view knows anything about is not in this dex. The
      // GM sees the whole shelf; a player sees only what they have opened.
      if (!isGM && !known.length && !falseSections(uuid, ownerId).length) continue;
      subjects.push({
        uuid,
        name: actor.name,
        img: actor.img,
        complete: isComplete(known, available),
        count: known.length,
        total: available.length,
        selected: uuid === this.#subjectUuid,
      });
    }
    subjects.sort((a, b) => a.name.localeCompare(b.name));
    if (!subjects.some((s) => s.selected) && subjects.length) {
      subjects[0].selected = true;
      this.#subjectUuid = subjects[0].uuid;
    }

    return {
      ...context,
      isGM,
      party: partyMode(),
      owners: viewableCharacters().map((a) => ({ id: a.id, name: a.name, selected: a.id === ownerId })),
      showOwners: isGM && viewableCharacters().length > 1,
      ownerName: owner?.name ?? "",
      subjects,
      detail: await this.#detail(ownerId),
      empty: !subjects.length,
    };
  }

  async #detail(ownerId) {
    const uuid = this.#subjectUuid;
    if (!uuid || !ownerId) return null;
    const actor = await fromUuid(uuid).catch(() => null);
    if (!actor) return null;

    const { kind, sections } = buildSections(actor);
    const known = knownSections(uuid, ownerId);
    const lies = falseSections(uuid, ownerId);
    const order = sectionKeys(kind);

    const rendered = [];
    for (const key of order) {
      const section = sections.find((s) => s.key === key);
      if (!section) continue;
      const lie = lies.find((f) => f.section === key) ?? null;
      const isKnown = known.includes(key);
      rendered.push({
        key,
        label: L(`GLDEX.section.${key}`),
        // A lie is shown as ordinary knowledge to its holder and labelled to
        // the GM. `state` therefore differs by viewer on purpose.
        state: isKnown ? "known" : lie ? (game.user.isGM ? "false" : "known") : "sealed",
        // Precomputed rather than compared in the template: this repo's
        // templates use no subexpression helpers, and `eq` is not one Foundry
        // has always shipped — a missing helper throws inside the render and
        // takes the whole window with it.
        isLie: !isKnown && !!lie && game.user.isGM,
        known: isKnown,
        html: isKnown || lie ? await renderSection(section) : renderSealed(key),
      });
    }

    return {
      uuid,
      name: actor.name,
      img: actor.img,
      kind,
      kindLabel: L(`GLDEX.kind.${kind}`),
      sections: rendered,
      missing: missingSections(known, order).length,
      complete: isComplete(known, order),
    };
  }

  /* ── actions ─────────────────────────────────────────────────────────── */

  async _onSetOwner(event, target) {
    this.#ownerId = target.dataset.owner ?? null;
    await this.render();
  }

  async _onSetSubject(event, target) {
    this.#subjectUuid = target.dataset.uuid ?? null;
    await this.render();
  }

  /**
   * The GM's manual reveal.
   *
   * This is the road every table can always use — a check the module never saw,
   * a creature nobody targeted, a correction after a misclick — so it is not
   * gated on an offer or on a roll at all.
   */
  async _onToggleSection(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.section;
    const ownerId = ownerKey(this.owner);
    const uuid = this.#subjectUuid;
    if (!key || !ownerId || !uuid) return;

    const known = knownSections(uuid, ownerId);
    if (known.includes(key)) await redact(uuid, ownerId, key);
    else await reveal(uuid, ownerId, key);
    await this.render();
  }

  async _onForget(event, target) {
    if (!game.user.isGM) return;
    const uuid = target.dataset.uuid ?? this.#subjectUuid;
    if (!uuid) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("GLDEX.forget.title") },
      content: `<p>${escapeHTML(L("GLDEX.forget.body"))}</p>`,
    });
    if (!ok) return;
    await forget(uuid);
    this.#subjectUuid = null;
    await this.render();
  }

  /** One window, reused — a second dex open beside the first is just confusing. */
  static open(options = {}) {
    const existing = foundry.applications.instances.get("gldex-app");
    const app = existing instanceof CreaturedexApp ? existing : new CreaturedexApp(options);
    return app.render({ force: true });
  }
}

