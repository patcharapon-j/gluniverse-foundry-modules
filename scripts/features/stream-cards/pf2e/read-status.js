/**
 * PF2e condition and effect change -> status card model.
 *
 * Pure: no `game`, no DOM. It reads the plain snapshot `status-snapshot.js` builds and decides what, if
 * anything, the stream shows.
 *
 * Two things here are the whole point of the module.
 *
 * **Observability is decided once, here, and it fails closed.** A roll card can only exist because
 * somebody posted to chat, so its audience test is the message's own (`visibilityOf`). A condition
 * carries no message: it is a document change that every client is told about, GM-hidden token or not.
 * So a status card would happily announce that the ambusher nobody has seen yet is frightened, on the
 * stream, while the GM's own screen looks completely ordinary. An actor is shown only when a player
 * could have seen the creature it belongs to: a player-owned actor always, anything else only while it
 * has a token on the scene that is not hidden from players.
 *
 * **A change the GM switched off must not reach a card at all.** The gates are read here rather than in
 * the card so that "Effects: off" means no model, no coalescing key and no lifetime timer — a feature
 * that is off costs nothing rather than drawing invisibly.
 */

/** Which document types this feature will draw, and the settings gate each one answers to. */
export const STATUS_KINDS = Object.freeze({
  condition: "conditions",
  effect: "effects"
});

/** How a status moved. `gained`/`raised` read as pressure arriving, `lost`/`lowered` as it letting go. */
export const STATUS_DIRECTIONS = Object.freeze(["gained", "raised", "lowered", "lost"]);

const EASED = new Set(["lowered", "lost"]);

/**
 * @param {object} snapshot                      from snapshotStatusChange()
 * @param {object} settings                      sanitized `stream.card.statusUpdates`
 * @returns {StatusCardModel|null}               null when the stream must not show this change
 */
export function readStatusChange(snapshot, settings) {
  const change = snapshot?.change;
  const actor = snapshot?.actor;
  if (!change || !actor || !settings?.enabled) return null;

  const gate = STATUS_KINDS[change.kind];
  if (!gate || !settings[gate]) return null;
  if (!STATUS_DIRECTIONS.includes(change.direction)) return null;
  // A value moving is a quieter event than a condition arriving, and a table that watches a lot of
  // frightened creatures ticking down can say so.
  if (!settings.valueChanges && (change.direction === "raised" || change.direction === "lowered")) return null;
  if (!settings.removals && change.direction === "lost") return null;

  const isNpc = !actor.isCharacter && !actor.hasPlayerOwner;
  if (!settings[isNpc ? "npcs" : "players"]) return null;
  // Fails closed: an actor whose observability could not be established is not drawn.
  if (isNpc && !actor.observable) return null;

  return {
    key: actor.key,
    actor: {
      name: actor.hiddenName ? null : actor.name ?? "",
      isNpc,
      img: actor.img ?? null,
      imgKind: actor.imgKind === "token" ? "token" : "portrait",
      focus: actor.focus ?? null
    },
    changes: [entryOf(change)]
  };
}

function entryOf(change) {
  return {
    id: change.id ?? null,
    slug: change.slug ?? null,
    name: change.name ?? "",
    kind: change.kind,
    img: change.img ?? null,
    value: Number.isFinite(change.value) ? change.value : null,
    direction: change.direction,
    eased: EASED.has(change.direction)
  };
}

/**
 * Folds a change into the entries a live card already shows.
 *
 * One condition is one row, whatever happened to it in between: frightened arriving and then ticking to
 * 2 is one line reading "Frightened 2", not two lines disagreeing about the same creature. A condition
 * that arrives and then leaves inside the same card's life is dropped entirely rather than shown twice —
 * the viewer saw nothing happen, because nothing did.
 *
 * Pure, and exported for its own test: getting this wrong is a stream that stutters the same word twice.
 */
export function foldChanges(entries, next) {
  const at = entries.findIndex((e) => sameStatus(e, next));
  if (at < 0) return [...entries, next];
  const previous = entries[at];
  const folded = entries.filter((_, i) => i !== at);
  if (previous.direction === "gained" && next.direction === "lost") return folded;
  if (previous.direction === "lost" && next.direction === "gained") return folded;
  const direction = previous.direction === "gained" && next.direction !== "lost" ? "gained" : next.direction;
  return [...folded, { ...next, direction, eased: EASED.has(direction) }];
}

function sameStatus(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.slug && b.slug) return a.slug === b.slug;
  if (a.id && b.id) return a.id === b.id;
  return a.name === b.name;
}

/** The card's overall tone: pressure arriving outranks pressure letting go. */
export function statusTone(changes) {
  if (!changes?.length) return "none";
  return changes.some((c) => !c.eased) ? "applied" : "cleared";
}

/**
 * @typedef {object} StatusCardModel
 * @property {string} key    the actor's own key; every change to one creature shares one card
 * @property {{name: string|null, isNpc: boolean, img: string|null, imgKind: "token"|"portrait", focus: {x: number, y: number, w: number}|null}} actor
 * @property {{id: string|null, slug: string|null, name: string, kind: "condition"|"effect", img: string|null, value: number|null, direction: "gained"|"raised"|"lowered"|"lost", eased: boolean}[]} changes
 */
