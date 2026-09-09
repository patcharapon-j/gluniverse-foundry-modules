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
import { PARTY_KEY, SETTINGS, sectionKeys } from "./constants.mjs";
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
  partyCharacters,
  partyMode,
  redact,
  reveal,
  revealFalse,
  subjectKey,
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
      revealSection: CreaturedexApp.prototype._onReveal,
      falsifySection: CreaturedexApp.prototype._onFalsify,
      clearSection: CreaturedexApp.prototype._onClear,
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

  /** True when the GM has the whole party selected rather than one character. */
  get everyone() {
    return game.user.isGM && this.#ownerId === PARTY_KEY;
  }

  get owner() {
    if (this.everyone) return null;
    const pool = viewableCharacters();
    return pool.find((a) => a.id === this.#ownerId) ?? pool[0] ?? null;
  }

  /**
   * The key a *read* resolves against.
   *
   * `PARTY_KEY` makes `knownSections` union every owner, which is exactly what
   * "what does the party know" means and is also what the Party Knowledge
   * sidebar does for a single character. So the whole-party view is a read mode,
   * not a separate store.
   */
  get readKey() {
    return this.everyone ? PARTY_KEY : ownerKey(this.owner);
  }

  /**
   * The characters a *write* lands on.
   *
   * Fanned out across the party rather than written to a shared `party` bucket.
   * A shared bucket would only read back while the Party Knowledge setting was
   * on, so turning that setting off would silently delete everything the GM had
   * revealed to "everyone" — and each character's own dex would be empty while
   * the GM's screen looked correct.
   */
  get writeKeys() {
    if (!this.everyone) {
      const key = ownerKey(this.owner);
      return key ? [key] : [];
    }
    return partyCharacters().map((a) => a.id);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const owner = this.owner;
    const ownerId = this.readKey;
    const everyone = this.everyone;

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
      // "Everyone" leads the list because revealing to the table is the common
      // case at an actual table: the players have just been told out loud.
      owners: [
        ...(isGM ? [{ id: PARTY_KEY, name: L("GLDEX.app.everyone"), selected: everyone }] : []),
        ...viewableCharacters().map((a) => ({ id: a.id, name: a.name, selected: !everyone && a.id === ownerId })),
      ],
      showOwners: isGM,
      everyone,
      ownerName: everyone ? L("GLDEX.app.everyone") : (owner?.name ?? ""),
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
        // Three GM controls, not one toggle. A section can be true, false or
        // unknown, and the missing third state was the reason there was no way
        // to plant a lie by hand at all — the only road to one was a critical
        // failure the dice had to hand you.
        canReveal: !isKnown,
        canFalsify: !isKnown && !lie,
        canClear: isKnown || !!lie,
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
   * The GM's manual controls.
   *
   * This is the road every table can always use — a check the module never saw,
   * a creature nobody targeted, a correction after a misclick — so none of it is
   * gated on an offer or on a roll.
   */
  #write(target) {
    if (!game.user.isGM) return null;
    const section = target?.dataset?.section ?? null;
    const owners = this.writeKeys;
    const uuid = this.#subjectUuid;
    if (!section || !owners.length || !uuid) return null;
    return { section, owners, uuid };
  }

  async _onReveal(event, target) {
    const w = this.#write(target);
    if (!w) return;
    await reveal(w.uuid, w.owners, w.section);
    await this.render();
  }

  /**
   * Plant a lie by hand.
   *
   * The book only produces one on a critical failure, but a GM needs to be able
   * to make the same thing happen for a reason the dice did not supply — a
   * disguised creature, a poisoned source, a lie the party was told in
   * character. Without this control the mechanic existed but had no switch.
   */
  async _onFalsify(event, target) {
    const w = this.#write(target);
    if (!w) return;
    await revealFalse(w.uuid, w.owners, w.section, null);
    await this.render();
  }

  async _onClear(event, target) {
    const w = this.#write(target);
    if (!w) return;
    await redact(w.uuid, w.owners, w.section);
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
    if (existing instanceof CreaturedexApp) {
      if (options.subjectUuid) existing.showSubject(options.subjectUuid);
      if (options.ownerId) existing.#ownerId = options.ownerId;
      return existing.render({ force: true });
    }
    return new CreaturedexApp(options).render({ force: true });
  }

  /** Point an already-open window at a creature without re-opening it. */
  showSubject(uuid) {
    this.#subjectUuid = uuid ?? null;
    if (this.rendered) this.render();
  }

  /**
   * Open the entry for a creature on the canvas.
   *
   * A player may only open a creature they have learned something about. An
   * unknown creature's entry would print its **actor** name and portrait, and a
   * GM who hid a token's name did so on purpose — so "nothing learned" is the
   * honest answer rather than a window that quietly identifies the thing the
   * party is looking at.
   */
  static mayView(actor) {
    const uuid = subjectKey(actor);
    if (!uuid) return null;
    if (game.user.isGM) return uuid;
    const known = viewableCharacters().some(
      (pc) => knownSections(uuid, ownerKey(pc)).length || falseSections(uuid, ownerKey(pc)).length
    );
    return known ? uuid : null;
  }

  static openForActor(actor) {
    const uuid = CreaturedexApp.mayView(actor);
    if (!uuid) {
      ui.notifications?.info(L("GLDEX.app.unknown", { name: actor?.token?.name ?? actor?.name ?? "" }));
      return null;
    }
    return CreaturedexApp.open({ subjectUuid: uuid });
  }

  /**
   * Follow the user's target, but only into a window that is already open.
   *
   * Targeting is a thing players do constantly and for reasons that have nothing
   * to do with the dex; opening a window on it would be a window that appears
   * while you are aiming a spell. Silent when the creature is unknown, because
   * a notification on every target would be noise — the keybinding is where a
   * player asks the question and gets an answer.
   */
  static followTarget(actor) {
    const app = foundry.applications.instances.get("gldex-app");
    if (!(app instanceof CreaturedexApp) || !app.rendered) return;
    const uuid = CreaturedexApp.mayView(actor);
    if (uuid) app.showSubject(uuid);
  }
}

