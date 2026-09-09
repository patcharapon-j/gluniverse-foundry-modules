/**
 * Creaturedexing — turning a result into knowledge.
 *
 * The book gives the *choice* of section to the player ("reveals one section of
 * the stat block for the creature or hazard of your choice"), so the offer card
 * is shown to the roller, not only to the GM. But only a GM client may write a
 * world setting, so a player's click travels over the suite socket and is
 * executed by the GM's client.
 *
 * ## Why the GM re-derives the offer instead of trusting the message
 *
 * A raw Foundry module socket carries no server-attested identity and no
 * authority: any client can emit any payload. So the executing GM ignores
 * everything in the payload except three pointers — which chat message, which
 * character, which section — and re-answers the questions itself:
 *
 *   • does that message exist, and is it a Recall Knowledge check?
 *   • what outcome does *the message* record, and how many sections does that
 *     outcome buy?
 *   • does the sending user actually own that character?
 *   • has this offer already been spent?
 *
 * Everything the payload could lie about is therefore re-read from shared state
 * the sender does not control. Without this a player could hand themselves a
 * completed creaturedex for anything on the board, and nothing would look wrong
 * on any screen.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { emitSocket, onSocket } from "../../core/socket.mjs";
import { FEATURE_ID, SETTINGS, SUBJECT_FLAG } from "./constants.mjs";
import { isComplete, outcomeEffect } from "./rules.mjs";
import { availableSections } from "./sections.mjs";
import { grantAid } from "./aid.mjs";
import { get, knownSections, ownerKey, reveal, revealFalse, subjectKey } from "./store.mjs";

/** Flag on the chat message recording what this offer has already paid out. */
export const SPENT_FLAG = "dex.spent";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/* ── the offer, re-derived from shared state ─────────────────────────────── */

/**
 * Everything an offer is, computed from documents rather than from a payload.
 *
 * Returns null when the message is not an offer at all, which is also the
 * answer for a message that has been fully spent.
 */
export function offerFor(message) {
  const context = message?.flags?.pf2e?.context ?? {};
  const outcome = context.outcome ?? null;
  if (!outcome) return null;

  const effect = outcomeEffect(outcome, { noSecret: !!get(SETTINGS.noSecret, false) });
  const spent = message?.getFlag?.(SUITE_ID, SPENT_FLAG) ?? null;
  const taken = Array.isArray(spent?.sections) ? spent.sections.length : 0;
  return {
    outcome,
    kind: effect.kind,
    total: effect.count,
    remaining: Math.max(0, effect.count - taken),
    subject: spent?.subject ?? null,
    owner: spent?.owner ?? null,
  };
}

/* ── writing (GM only) ───────────────────────────────────────────────────── */

/**
 * Apply one section of an offer. GM-side; every argument is re-validated here.
 *
 * `userId` is the user asking. For a local GM click it is that GM; for a socket
 * it is the claimed sender, which is why ownership is checked rather than
 * assumed.
 */
export async function applyReveal({ messageId, subjectUuid, ownerId, section, userId }) {
  if (!game.user?.isGM) return false;

  const message = game.messages?.get(messageId) ?? null;
  const offer = message ? offerFor(message) : null;
  if (!offer || offer.remaining <= 0) return false;

  // The card has to be one this feature stamped, and the claim has to be the
  // one it stamped. Without this the only requirement on `messageId` is "a
  // message with an outcome on it" — a player's own attack roll qualifies — and
  // the subject and character would be whatever the payload said they were.
  const stamp = message.getFlag(SUITE_ID, SUBJECT_FLAG) ?? null;
  if (!stamp || stamp.uuid !== subjectUuid || stamp.owner !== ownerId) return false;

  const subject = await fromUuid(subjectUuid).catch(() => null);
  const pc = game.actors?.get(ownerId) ?? null;
  if (!subject || !pc) return false;

  // The asking user must own the character the knowledge is filed under. A GM
  // asking on a player's behalf is always allowed; that is the manual path.
  const user = game.users?.get(userId) ?? null;
  if (user && !user.isGM && !pc.testUserPermission(user, "OWNER")) return false;

  const available = availableSections(subject);
  if (!available.includes(section)) return false;

  const key = subjectKey(subject);
  const owner = ownerKey(pc);
  if (!key || !owner) return false;

  if (offer.kind === "false") {
    await revealFalse(key, owner, section, null);
  } else if (offer.kind === "reveal") {
    if (knownSections(key, owner).includes(section)) return false;
    await reveal(key, owner, section);
  } else {
    return false;
  }

  const spent = message.getFlag(SUITE_ID, SPENT_FLAG) ?? { sections: [] };
  await message.setFlag(SUITE_ID, SPENT_FLAG, {
    sections: [...(spent.sections ?? []), section],
    subject: key,
    owner,
  });

  await announce({ subject, pc, section, kind: offer.kind, available });
  return true;
}

/**
 * Say what happened, and check for completion.
 *
 * The completion card is public: a completed creaturedex is a party asset (it
 * unlocks a reaction other players will be aided by) and the book's Party
 * Knowledge sidebar assumes the table is talking to each other about it.
 */
async function announce({ subject, pc, section, kind, available }) {
  const key = subjectKey(subject);
  const owner = ownerKey(pc);
  const known = knownSections(key, owner);
  const complete = kind === "reveal" && isComplete(known, available);

  const lines = [
    `<p class="gldex-card-line">${L("GLDEX.card.learned", {
      actor: pc.name,
      section: L(`GLDEX.section.${section}`),
      subject: subject.name,
    })}</p>`,
  ];
  if (complete) lines.push(`<p class="gldex-card-done">${L("GLDEX.card.complete", { subject: subject.name })}</p>`);

  await ChatMessage.create({
    content: `<section class="gldex-card" data-section="${section}"${complete ? ' data-complete="true"' : ""}>${lines.join("")}</section>`,
    speaker: ChatMessage.getSpeaker({ actor: pc }),
  });

  if (complete) await grantAid(pc);
}

/* ── the socket ──────────────────────────────────────────────────────────── */

const REVEAL = "reveal";

/** Ask for a section. A GM does it; anybody else asks one to. */
export function requestReveal(payload) {
  if (game.user.isGM) return applyReveal({ ...payload, userId: game.user.id });
  emitSocket(FEATURE_ID, { action: REVEAL, ...payload });
  return Promise.resolve(true);
}

/**
 * Exactly one GM executes. `activeGM` is Foundry's own designated GM, so two
 * logged-in GMs do not both write the same reveal and spend the offer twice.
 */
export function registerRevealSocket() {
  onSocket(
    FEATURE_ID,
    async (payload, senderId) => {
      if (payload?.action !== REVEAL) return;
      if (game.users?.activeGM !== game.user) return;
      try {
        await applyReveal({ ...payload, userId: senderId });
      } catch (error) {
        warn("pf2e-creaturedex | reveal request failed", error);
      }
    },
    {
      validate: (p) =>
        p?.action === REVEAL &&
        typeof p.messageId === "string" &&
        typeof p.subjectUuid === "string" &&
        typeof p.ownerId === "string" &&
        typeof p.section === "string",
    }
  );
}

