/**
 * GLUniverse Suite — the surge check.
 *
 * One eligible casting, one check. That sentence is the hardest thing in this
 * feature, because a single PF2e spell can post three messages — the cast card,
 * an attack roll and a damage roll — and each of them arrives at every connected
 * client's `createChatMessage` hook. Two independent failures live here:
 *
 *   1. Many messages, one casting. Guarded primarily by keying on the cast card
 *      (`flags.pf2e.casting`), and backstopped by an origin-uuid dedup window,
 *      because spells cast from items and some innate paths do not always
 *      produce a card shaped the way you would hope. A double surge is the worst
 *      failure this feature has — it doubles the drama and the GM cannot tell
 *      from the table which one was real.
 *
 *   2. Many clients, one roll. Every client sees the hook; if they all roll,
 *      they all get different answers and race to write the flag. Exactly one
 *      client is elected, deterministically, by a rule every client computes
 *      identically.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { emitSocket } from "../../core/socket.mjs";
import { playBurst } from "./burst.mjs";
import { DEDUP_WINDOW_MS, FEATURE_ID, FLAGS } from "./constants.mjs";
import { readDieResult, stampLevel, surgeNotation } from "./die.mjs";
import { tagRoll } from "./dsn.mjs";
import { isSurge, resolveExposure } from "./levels.mjs";
import { armedMode, clearArmedMode, currentLevel, dieVisibility, eligibility, levelConfig } from "./settings.mjs";
import { postSeverityCard } from "./severity.mjs";

/** origin key → timestamp. Cleared lazily; a session's worth is a few dozen keys. */
const recentCastings = new Map();
/** Message ids currently being rolled on this client. */
const inFlight = new Set();

/* ══════════════════════════════════════════════════════════════════════
   Eligibility
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Resolve the spell item behind a message.
 *
 * `message.item` is the happy path; a spell cast from a consumable or resolved
 * after the item was consumed only leaves `flags.pf2e.origin.uuid` behind.
 * Compendium uuids are skipped — they resolve to the source spell, not to
 * anything this actor cast.
 */
function resolveSpell(message) {
  const item = message?.item;
  if (item?.type === "spell") return item;
  const uuid = message?.flags?.pf2e?.origin?.uuid;
  if (typeof uuid !== "string" || uuid.startsWith("Compendium.")) return null;
  const found = fromUuidSync?.(uuid);
  return found?.type === "spell" ? found : null;
}

/**
 * True when this message is the moment a casting completes.
 *
 * The cast card is the signal. Attack and damage rolls that follow belong to the
 * same casting and must not check again — the draft is explicit that it is one
 * check per casting, not per target, missile, or pulse.
 */
function isCastingMessage(message) {
  const pf2e = message?.flags?.pf2e ?? {};
  const context = pf2e.context ?? {};

  // A reroll re-resolves a check that already happened; the casting did not
  // happen twice.
  if (context.isReroll) return false;
  // Neither of these is a casting at all.
  if (["damage-taken", "self-effect-applied"].includes(context.type)) return false;
  if (pf2e.appliedDamage) return false;

  return Boolean(pf2e.casting) || context.type === "spell-cast";
}

/** Spell rank, however this particular casting path spells it. */
function spellRank(message, spell) {
  const cast = Number(message?.flags?.pf2e?.casting?.level);
  if (Number.isInteger(cast)) return cast;
  const rank = Number(spell?.rank ?? spell?.system?.level?.value);
  return Number.isInteger(rank) ? rank : 1;
}

/** Apply the GM's eligibility checklist to one spell. */
function passesEligibility(message, spell) {
  const rules = eligibility();
  const traits = spell?.system?.traits?.value ?? [];
  const category = spell?.system?.category?.value ?? "";

  const isCantrip = spell?.isCantrip ?? traits.includes("cantrip");
  // A focus cantrip is still a cantrip, and an item cantrip is still a cantrip.
  // The cantrip test therefore runs before the others, exactly as the draft's
  // "excluded even when they are focus cantrips or come from items" requires.
  if (isCantrip) return rules.cantrips;

  const isRitual = spell?.isRitual ?? category === "ritual";
  if (isRitual) return rules.rituals;

  if (category === "focus" && !rules.focus) return false;
  if ((spell?.isInnate ?? category === "innate") && !rules.innate) return false;
  if ((spell?.isFromConsumable ?? false) && !rules.fromItems) return false;

  if (spellRank(message, spell) < rules.minRank) return false;
  return true;
}

/**
 * True when a real person at this table is watching their own spell.
 *
 * Ownership, not authorship: it correctly covers a player-run NPC ally and a
 * familiar, and it correctly treats a GM casting from a PC's sheet as public.
 */
export function isPlayerCast(actor) {
  if (!actor) return false;
  return game.users.some((user) => !user.isGM && actor.testUserPermission?.(user, "OWNER"));
}

/**
 * The one client that rolls. Every client computes this and only the match acts.
 *
 * Preference order, and every step of it is deterministic so that all clients
 * reach the same answer from the same state:
 *
 *   1. The message's author, if they are a player who owns the actor. The
 *      caster's own client should throw the die so Dice So Nice launches it
 *      from their seat.
 *   2. Failing that, the lowest-id ACTIVE PLAYER who owns the actor. This is
 *      the GM-casting-from-a-PC's-sheet case: it is still a player casting
 *      (the spec makes that public), and putting the roll on that player's
 *      client is also what lets them press their own severity card, since the
 *      card is authored by whoever rolled.
 *   3. Failing that, the lowest-id active GM — every NPC casting, and any
 *      player casting whose owner is not connected.
 */
function electRoller(message, actor) {
  const author = message?.author;
  if (author && !author.isGM && actor?.testUserPermission?.(author, "OWNER")) return author.id;

  const byId = (a, b) => a.id.localeCompare(b.id);
  const owners = game.users
    .filter((u) => !u.isGM && u.active && actor?.testUserPermission?.(u, "OWNER"))
    .sort(byId);
  if (owners.length) return owners[0].id;

  return game.users.filter((u) => u.isGM && u.active).sort(byId)[0]?.id ?? null;
}

/** A stable key for "this casting", used only for the dedup backstop. */
function castingKey(message, actor, spell) {
  const origin = message?.flags?.pf2e?.origin?.uuid ?? spell?.uuid ?? spell?.id ?? "spell";
  return `${actor?.id ?? "?"}:${origin}`;
}

function seenRecently(key) {
  const now = Date.now();
  for (const [k, at] of recentCastings) if (now - at > DEDUP_WINDOW_MS) recentCastings.delete(k);
  if (recentCastings.has(key)) return true;
  recentCastings.set(key, now);
  return false;
}

/* ══════════════════════════════════════════════════════════════════════
   The roll
   ══════════════════════════════════════════════════════════════════════ */

export function registerCheck() {
  Hooks.on("createChatMessage", onCreateChatMessage);
}

async function onCreateChatMessage(message) {
  try {
    if (!isCastingMessage(message)) return;
    if (message.getFlag(SUITE_ID, FLAGS.check)) return;

    const actor = message.actor ?? message.speakerActor ?? null;
    const spell = resolveSpell(message);
    if (!spell || !actor) return;
    if (!passesEligibility(message, spell)) return;

    const playerCast = isPlayerCast(actor);
    if (!playerCast && !eligibility().npcCasters) return;

    const key = castingKey(message, actor, spell);
    if (seenRecently(key)) return;

    if (electRoller(message, actor) !== game.user.id) return;
    if (inFlight.has(message.id)) return;

    inFlight.add(message.id);
    try {
      await rollCheck(message, { playerCast });
    } finally {
      inFlight.delete(message.id);
    }
  } catch (e) {
    warn("Arcane Surge | surge check failed:", e);
  }
}

async function rollCheck(message, { playerCast }) {
  const config = levelConfig();
  const mode = armedMode();
  const exposure = resolveExposure(currentLevel(), mode, config);

  // Stable: no check happens at all. No die, no banner, no card. The die's
  // appearance is itself the sign that the party is somewhere unstable.
  if (!exposure.rollsDie && !exposure.autoSurge) {
    if (mode !== "none") await clearArmedMode();
    return null;
  }

  let dieResult = null;
  let rollData = null;

  if (exposure.rollsDie) {
    const roll = await new Roll(surgeNotation()).evaluate();
    // Stamp BEFORE tagging: the level decides what the die's own face label
    // says, and that label appears in the roll tooltip whether or not Dice So
    // Nice ever animates the throw.
    stampLevel(roll, exposure.effective);
    tagRoll(roll, exposure.effective);
    dieResult = readDieResult(roll);
    rollData = roll.toJSON();

    const surged = isSurge(dieResult, exposure.threshold);
    if (shouldShowDie(surged) && game.dice3d) {
      // Player casts synchronize the throw to every client; an NPC's check stays
      // on the GM's screen so the reveal is still theirs to make.
      await game.dice3d.showForRoll(roll, game.user, playerCast).catch(() => {});
    }
  }

  const surged = exposure.autoSurge || isSurge(dieResult, exposure.threshold);
  const held = surged && !playerCast;

  const check = {
    level: exposure.areaLevel,
    effective: exposure.effective,
    row: exposure.row,
    threshold: exposure.threshold,
    mode: exposure.invited ? "invited" : exposure.steadied ? "steadied" : "none",
    die: dieResult,
    surged,
    // A surge on an NPC's casting waits for the GM to release it, so the
    // animation is not the thing that announces what the GM has not decided yet.
    held,
    playerCast,
    voided: false,
    roll: rollData,
    user: game.user.id,
    appliedAt: Date.now(),
  };

  await message.setFlag(SUITE_ID, FLAGS.check, check);
  if (mode !== "none") await clearArmedMode();

  if (surged && !held) await postSeverityCard(message, check);
  else if (held) await postSeverityCard(message, check, { whisperGM: true });

  return check;
}

/** Per-client preference: always throw, only throw on a surge, or never. */
function shouldShowDie(surged) {
  const mode = dieVisibility();
  if (mode === "never") return false;
  if (mode === "surge") return surged;
  return true;
}

/**
 * GM release of a held NPC surge.
 *
 * The message is old by now, so its freshness window has expired on every
 * client and a flag update alone would not play anything. This is the one job
 * the socket exists for.
 *
 * Two things this has to get right, both of which were wrong before:
 *
 *   - Foundry does NOT echo a socket message back to its sender, so the GM who
 *     pressed Release would be the only person at the table not to see the
 *     burst. It is played locally as well, the same way `locations` runs its own
 *     travel payload after emitting it.
 *   - `releasedAt` marks the flag so the render path stands down permanently for
 *     this message. Without it, a release inside the freshness window plays
 *     twice on every player — once from the socket, once from the re-render.
 */
export async function releaseHeldSurge(message) {
  if (!game.user.isGM) return;
  const check = message?.getFlag?.(SUITE_ID, FLAGS.check);
  if (!check?.held) return;
  await message.setFlag(SUITE_ID, FLAGS.check, { ...check, held: false, releasedAt: Date.now() });
  emitSocket(FEATURE_ID, { type: "surge", level: check.effective });
  playBurst(check.effective);
}

/** GM void of a check whose casting was disrupted before it completed. */
export async function voidCheck(message) {
  if (!game.user.isGM) return;
  const check = message?.getFlag?.(SUITE_ID, FLAGS.check);
  if (!check) return;
  await message.setFlag(SUITE_ID, FLAGS.check, { ...check, voided: !check.voided });
}
