/**
 * Live Daggerheart chat message -> the plain snapshot `read-message.js` reads.
 *
 * The one half of the Daggerheart reader that touches the world. Everything here is a document lookup;
 * every decision about what a card says is in the pure reader, which the tests and the preview drive
 * with snapshots of this exact shape.
 */

import { MODULE_ID } from "../../stream/constants.js";
import { getChatFilter } from "../../stream/settings.js";
import { CARD_FLAGS, getDefaultRollArt } from "../settings.js";
import { SYSTEM_ID, systemFlags } from "./read-message.js";

/** The two actor types a Daggerheart attack is measured against by their Evasion. */
const EVASION_TYPES = new Set(["character", "companion"]);

export function snapshotMessage(message) {
  const source = message._source ?? message.toObject?.() ?? {};
  const flags = source.flags ?? {};
  const actor = speakerActorOf(message, flags);
  const token = speakerTokenOf(message);
  return {
    raw: {
      _id: message.id,
      blind: !!message.blind,
      whisper: [...(message.whisper ?? [])],
      author: message.author?.id ?? null,
      speaker: { ...(message.speaker ?? {}) },
      flavor: message.flavor ?? "",
      content: message.content ?? "",
      style: message.style ?? 0,
      flags
    },
    derived: {
      authorName: message.author?.name ?? null,
      authorIsGM: !!message.author?.isGM,
      rollCount: message.rolls?.length ?? 0,
      rolls: (message.rolls ?? []).map(summarizeRoll),
      actor: actorOf(actor),
      token: tokenOf(token, actor),
      defaultArt: getDefaultRollArt(),
      chatFilter: getChatFilter(),
      foeTarget: foeTargetOf(systemFlags(flags))
    }
  };
}

/**
 * Who spoke. The system writes the speaker from the actor it rolled for, and stores that actor's uuid
 * beside the plate; the uuid is the fallback for a speaker whose token has since left the scene.
 */
function speakerActorOf(message, flags) {
  try {
    const actor = message.speakerActor ?? ChatMessage.getSpeakerActor?.(message.speaker);
    if (actor) return actor;
  } catch {
    // A speaker naming a deleted scene or token throws in some core versions; the uuid still answers.
  }
  const uuid = systemFlags(flags).actorUuid;
  if (typeof uuid !== "string" || !uuid) return null;
  try {
    return fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

function speakerTokenOf(message) {
  const speaker = message.speaker ?? {};
  if (!speaker.token) return null;
  return game.scenes?.get(speaker.scene)?.tokens?.get(speaker.token) ?? null;
}

function actorOf(actor) {
  if (!actor) return null;
  return {
    name: actor.name,
    type: actor.type,
    img: actor.img,
    hasPlayerOwner: !!actor.hasPlayerOwner,
    focusOverrides: actor.getFlag?.(MODULE_ID, CARD_FLAGS.portraitFocus) ?? []
  };
}

/**
 * The speaker's nameplate. With no placed token (a roll made from the sheet) the prototype stands in: it
 * is the nameplate the GM chose for this creature, and a missing answer would read as a visible name.
 */
function tokenOf(token, actor) {
  const source = token ?? actor?.prototypeToken ?? null;
  if (!source) return null;
  return {
    name: source.name ?? null,
    textureSrc: source.texture?.src ?? null,
    displayName: Number.isFinite(source.displayName) ? source.displayName : null
  };
}

/**
 * Whether an adversary's attack was measured against a player character's own Evasion.
 *
 * The plate stores the target by name only (`attackTarget()` in the system's `apps/targets.ts`), so the
 * name is looked up among the characters and companions players own, and the answer is yes only when one
 * of them has exactly that Evasion. Anything else — an adversary, a creature nobody owns, a name two
 * reticles were joined into — is no, which keeps the number and the name off the stream.
 */
function foeTargetOf(flags) {
  if (flags?.kind !== "adversary") return null;
  const plate = flags.plate ?? {};
  const name = typeof plate.target === "string" ? plate.target.trim() : "";
  const dc = Number(plate.dc);
  if (!name || plate.dc === null || plate.dc === undefined || !Number.isFinite(dc)) return null;
  const candidates = [
    ...(game.actors ?? []),
    ...(canvas?.scene?.tokens ?? []).map((token) => token.actor).filter(Boolean)
  ];
  const isPc = candidates.some((actor) =>
    actor?.name === name
    && EVASION_TYPES.has(actor.type)
    && !!actor.hasPlayerOwner
    && Number(actor.system?.evasion?.value) === dc);
  return { isPc };
}

function summarizeRoll(roll) {
  return {
    total: roll.total ?? null,
    formula: roll.formula ?? null,
    dice: (roll.dice ?? []).map((die) => ({
      faces: die.faces ?? null,
      results: (die.results ?? []).filter((r) => r.active !== false).map((r) => r.result)
    }))
  };
}

export { SYSTEM_ID };
