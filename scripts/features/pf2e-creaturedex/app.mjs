/**
 * Creaturedexing — the dex window.
 *
 * This is the surface the players actually use, and it is player-facing by
 * default. Two things follow from that and shape the whole file.
 *
 * **It renders from stored snapshots, never from the creature.** Foundry hands
 * every client the full Actor document, so a window that drew a redacted stat
 * block out of the live actor would be locking data the player already holds —
 * theatre, on the player's own screen, over a console call away. A section is
 * rendered by the GM at reveal time and the *result* is what the store keeps;
 * see the note at the top of `store.mjs`. The cost is that a section is a
 * memory rather than a live view, which is why the GM has a refresh action.
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
import { dexKey } from "./identity.mjs";
import { isComplete, missingSections } from "./rules.mjs";
import { buildSections } from "./sections.mjs";
import { renderSealed, renderSection } from "./render.mjs";
import { openFalsify } from "./falsify.mjs";
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
  refresh,
  reveal,
  subjectMeta,
  trueSnapshot,
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

/**
 * What the dex records about a subject, read off a live actor.
 *
 * Only ever called on a GM client — it is the half of the feature that needs to
 * see the creature honestly, and it is the only half that does.
 */
export function snapshotOf(actor) {
  const { kind, sections, deferred } = buildSections(actor);
  const available = sections.map((s) => s.key);
  const snapshots = Object.fromEntries(sections.map((s) => [s.key, s]));
  const base = actor?.isToken ? (actor.token?.baseActor ?? actor) : actor;
  return {
    kind,
    available,
    snapshots,
    deferred,
    meta: { name: base?.name ?? "", img: base?.img ?? "", kind, available, uuid: base?.uuid ?? null, deferred },
  };
}

/**
 * Say out loud that something was learned.
 *
 * A chat message rather than a silent store write or the Insight cinematic.
 * In-band is socially useful — the table sees that the party now knows a thing,
 * which is half of why anybody rolls — and Insight is a full-screen arrival
 * built for revelations that would wear out fast on "you learned the goblin's
 * AC". Insight stays available to a table that wants the ceremony.
 */
function announceReveal(name, section, owners, key) {
  try {
    const who = owners
      .map((id) => game.actors?.get(id)?.name)
      .filter(Boolean)
      .join(", ");
    const body = L("GLDEX.chat.learned", {
      who: who || L("GLDEX.app.everyone"),
      section: L(`GLDEX.section.${section}`),
      name,
    });
    const meta = subjectMeta(key);
    const done = meta && isComplete(knownSections(key, PARTY_KEY), meta.available ?? []);
    const tail = done ? `<div class="gldex-card-done">${escapeHTML(L("GLDEX.chat.complete", { name }))}</div>` : "";
    // `.gldex-card` and its two data attributes already exist and already carry
    // the per-section accent; a new class here would render unstyled while
    // looking deliberate in this file.
    ChatMessage.create({
      content:
        `<div class="gldex-card" data-section="${escapeHTML(section)}" data-complete="${done ? "true" : "false"}">` +
        `<div class="gldex-card-line">${escapeHTML(body)}</div>${tail}</div>`,
    });
  } catch (error) {
    // A notification is not worth losing the reveal that earned it.
    console.warn("pf2e-creaturedex | could not post the reveal notice", error);
  }
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
      refreshSubject: CreaturedexApp.prototype._onRefresh,
      forgetSubject: CreaturedexApp.prototype._onForget,
    },
  };

  static PARTS = { main: { template: `modules/${SUITE_ID}/templates/pf2e-creaturedex/dex.hbs` } };

  #ownerId = null;
  #subject = null;
  /** A creature the GM opened on that nobody has learned anything about yet. */
  #pending = null;

  constructor(options = {}) {
    super(options);
    // Party-wide is the GM's default. The common case at a real table is that
    // the players have just been told out loud, so making the rare per-player
    // reveal the default would put a click on every ordinary one.
    this.#ownerId = options.ownerId ?? (game.user.isGM ? PARTY_KEY : null);
    this.#subject = options.subject ?? null;
    this.#pending = options.pending ?? null;
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

  /** The live creature behind the current entry, for the GM's writes only. */
  async #actor() {
    if (this.#pending) return this.#pending;
    const uuid = subjectMeta(this.#subject)?.uuid ?? null;
    return uuid ? await fromUuid(uuid).catch(() => null) : null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const owner = this.owner;
    const ownerId = this.readKey;
    const everyone = this.everyone;

    const subjects = [];
    const keys = new Set(knownSubjects());
    if (isGM && this.#pending) keys.add(dexKey(this.#pending));
    for (const key of keys) {
      const meta = subjectMeta(key) ?? (this.#pending && dexKey(this.#pending) === key ? snapshotOf(this.#pending).meta : null);
      if (!meta) continue;
      const available = meta.available ?? [];
      const known = ownerId ? knownSections(key, ownerId) : [];
      // A subject nobody in view knows anything about is not in this dex. The
      // GM sees the whole shelf; a player sees only what they have opened.
      if (!isGM && !known.length && !falseSections(key, ownerId).length) continue;
      subjects.push({
        key,
        name: meta.name,
        img: meta.img,
        complete: isComplete(known, available),
        count: known.length,
        total: available.length,
        selected: key === this.#subject,
      });
    }
    subjects.sort((a, b) => a.name.localeCompare(b.name));
    if (!subjects.some((s) => s.selected) && subjects.length) {
      subjects[0].selected = true;
      this.#subject = subjects[0].key;
    }

    return {
      ...context,
      isGM,
      party: partyMode(),
      // "Everyone" leads the list because revealing to the table is the common
      // case at an actual table: the players have just been told out loud. The
      // per-character rows below it are the exception the Party Knowledge
      // sidebar exists to make rare, so they are only offered when it is off.
      owners: [
        ...(isGM ? [{ id: PARTY_KEY, name: L("GLDEX.app.everyone"), selected: everyone }] : []),
        ...(isGM && partyMode()
          ? []
          : viewableCharacters().map((a) => ({ id: a.id, name: a.name, selected: !everyone && a.id === ownerId }))),
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
    const key = this.#subject;
    if (!key || !ownerId) return null;
    const meta = subjectMeta(key) ?? (this.#pending && dexKey(this.#pending) === key ? snapshotOf(this.#pending).meta : null);
    if (!meta) return null;

    const kind = meta.kind === "hazard" ? "hazard" : "creature";
    const known = knownSections(key, ownerId);
    const lies = falseSections(key, ownerId);
    const available = meta.available ?? [];
    const order = sectionKeys(kind).filter((k) => available.includes(k));
    const stored = subjectMeta(key) ? (this.#storedSections(key) ?? {}) : {};
    const complete = isComplete(known, order);

    const rendered = [];
    for (const key2 of order) {
      const lie = lies.find((f) => f.section === key2) ?? null;
      const isKnown = known.includes(key2);
      const snapshot = isKnown ? stored[key2] : (lie?.snapshot ?? null);
      rendered.push({
        key: key2,
        label: L(`GLDEX.section.${key2}`),
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
        html: snapshot ? await renderSection(snapshot) : renderSealed(key2),
      });
    }

    return {
      key,
      name: meta.name,
      img: meta.img,
      kind,
      kindLabel: L(`GLDEX.kind.${kind}`),
      sections: rendered,
      missing: missingSections(known, order).length,
      complete,
      // Abilities PF2e left uncategorised are held back until the entry is
      // finished, so a routing guess can never leak Offense to somebody who
      // only bought Defense. Once everything is bought there is nothing left to
      // leak, and they are simply printed.
      deferred: complete ? await this.#renderDeferred(meta) : [],
      deferredCount: complete ? 0 : (meta.deferred?.length ?? 0),
      canRefresh: game.user.isGM,
    };
  }

  /** Every truth snapshot this entry holds, keyed by section. */
  #storedSections(key) {
    const meta = subjectMeta(key);
    if (!meta) return {};
    const out = {};
    for (const section of meta.available ?? []) {
      const snap = trueSnapshot(key, section);
      if (snap) out[section] = snap;
    }
    return out;
  }

  async #renderDeferred(meta) {
    const out = [];
    for (const entry of meta.deferred ?? []) {
      out.push(await renderSection({ rows: [], abilities: [entry] }));
    }
    return out;
  }

  /* ── actions ─────────────────────────────────────────────────────────── */

  async _onSetOwner(event, target) {
    this.#ownerId = target.dataset.owner ?? null;
    await this.render();
  }

  async _onSetSubject(event, target) {
    this.#subject = target.dataset.key ?? null;
    await this.render();
  }

  /**
   * The GM's manual controls.
   *
   * This is the whole reveal mechanism, by design. Nothing here watches a
   * Recall Knowledge roll: the GM clicks when the table has earned it, which
   * covers the check the module never saw, the creature nobody targeted and the
   * correction after a misclick without any of them being special cases.
   */
  #write(target) {
    if (!game.user.isGM) return null;
    const section = target?.dataset?.section ?? null;
    const owners = this.writeKeys;
    if (!section || !owners.length || !this.#subject) return null;
    return { section, owners, key: this.#subject };
  }

  async _onReveal(event, target) {
    const w = this.#write(target);
    if (!w) return;
    const actor = await this.#actor();
    if (!actor) {
      ui.notifications?.warn(L("GLDEX.app.noActor"));
      return;
    }
    // The snapshot is taken here, on the GM's client, post-flatten — the
    // numbers that will actually apply at this table, not a theoretical
    // unflattened stat block.
    const snap = snapshotOf(actor);
    await reveal(w.key, w.owners, w.section, snap.snapshots, snap.meta);
    this.#pending = null;
    await this.render();
    announceReveal(snap.meta.name, w.section, w.owners, w.key);
  }

  /**
   * Plant a lie by hand, through the authoring dialog.
   *
   * The book produces one on a critical failure, but a GM needs to make the
   * same thing happen for a reason the dice did not supply — a disguised
   * creature, a poisoned source, a lie the party was told in character.
   */
  async _onFalsify(event, target) {
    const w = this.#write(target);
    if (!w) return;
    const actor = await this.#actor();
    const snap = actor ? snapshotOf(actor) : null;
    openFalsify({
      dexKey: w.key,
      section: w.section,
      owners: w.owners,
      name: subjectMeta(w.key)?.name ?? actor?.name ?? "",
      kind: snap?.kind ?? subjectMeta(w.key)?.kind ?? "creature",
      actorId: actor?.id ?? null,
      truth: snap?.snapshots?.[w.section] ?? null,
      meta: snap?.meta ?? null,
      onDone: () => this.render(),
    });
  }

  async _onClear(event, target) {
    const w = this.#write(target);
    if (!w) return;
    await redact(w.key, w.owners, w.section);
    await this.render();
  }

  /**
   * Re-take every snapshot this entry holds.
   *
   * A snapshot is a memory and going stale is usually correct — a creature the
   * GM buffed last session *should* surprise the party. This is for the other
   * case: the GM fixed a typo, or rebuilt the creature, and wants the dex to
   * stop disagreeing with the thing on the board.
   */
  async _onRefresh() {
    if (!game.user.isGM || !this.#subject) return;
    const actor = await this.#actor();
    if (!actor) {
      ui.notifications?.warn(L("GLDEX.app.noActor"));
      return;
    }
    const snap = snapshotOf(actor);
    await refresh(this.#subject, snap.snapshots, snap.meta);
    ui.notifications?.info(L("GLDEX.app.refreshed", { name: snap.meta.name }));
    await this.render();
  }

  async _onForget(event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.key ?? this.#subject;
    if (!key) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("GLDEX.forget.title") },
      content: `<p>${escapeHTML(L("GLDEX.forget.body"))}</p>`,
    });
    if (!ok) return;
    await forget(key);
    this.#subject = null;
    await this.render();
  }

  /** One window, reused — a second dex open beside the first is just confusing. */
  static open(options = {}) {
    const existing = foundry.applications.instances.get("gldex-app");
    if (existing instanceof CreaturedexApp) {
      if (options.subject) existing.showSubject(options.subject, options.pending ?? null);
      if (options.ownerId) existing.#ownerId = options.ownerId;
      return existing.render({ force: true });
    }
    return new CreaturedexApp(options).render({ force: true });
  }

  /** Point an already-open window at a creature without re-opening it. */
  showSubject(key, pending = null) {
    this.#subject = key ?? null;
    this.#pending = pending;
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
   *
   * Knowing a *lie* counts. A player who was told one cannot see that it is
   * false, so refusing to open there would be the module losing the only thing
   * they were given.
   */
  static mayView(actor) {
    const key = dexKey(actor);
    if (!key) return null;
    if (game.user.isGM) return key;
    const known = viewableCharacters().some(
      (pc) => knownSections(key, ownerKey(pc)).length || falseSections(key, ownerKey(pc)).length
    );
    return known ? key : null;
  }

  static openForActor(actor) {
    const key = CreaturedexApp.mayView(actor);
    if (!key) {
      ui.notifications?.info(L("GLDEX.app.unknown", { name: actor?.token?.name ?? actor?.name ?? "" }));
      return null;
    }
    // The GM may open a creature nothing is known about; the actor rides along
    // so the reveal controls have something to read.
    return CreaturedexApp.open({ subject: key, pending: game.user.isGM ? actor : null });
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
    const key = CreaturedexApp.mayView(actor);
    if (key) app.showSubject(key, game.user.isGM ? actor : null);
  }
}
