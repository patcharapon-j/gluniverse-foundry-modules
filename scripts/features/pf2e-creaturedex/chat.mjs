/**
 * Creaturedexing — the offer on a Recall Knowledge card.
 *
 * ## Finding the check
 *
 * PF2e's own Recall Knowledge action pushes the roll option
 * `action:recall-knowledge:<statistic>`, so a check made through it identifies
 * itself. Plenty of tables never touch the action and simply roll Arcana, and
 * for those the card carries nothing to key on — which is why every reveal this
 * feature performs is also available by hand from the dex window. The offer is
 * an accelerator for the common case, never the only road.
 *
 * ## Finding the creature
 *
 * Recall Knowledge is not a targeted action in PF2e: `context.target` is null on
 * every one of these cards, exactly as it is for Treat Wounds. The subject is
 * therefore resolved from the roller's *targets*, which Foundry broadcasts to
 * every client, and stamped onto the message once by the active GM. Resolving
 * per client instead would give two players two different creatures for the
 * same roll, depending on what each of them happened to be targeting.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { SETTINGS, SUBJECT_FLAG } from "./constants.mjs";
import { canAttempt, rollSection } from "./rules.mjs";
import { availableSections } from "./sections.mjs";
import { offerFor, requestReveal } from "./reveal.mjs";
import {
  attemptsIn,
  get,
  knownSections,
  noteAttempt,
  observedIn,
  ownerKey,
  subjectKey,
} from "./store.mjs";

const CLASS = "gldex-offer";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (v) => escapeHTML(String(v ?? ""));

/** Is this message a Recall Knowledge check? */
export function isRecallCheck(message) {
  const context = message?.flags?.pf2e?.context ?? {};
  if (context.type !== "skill-check") return false;
  if (context.identifier === "recall-knowledge" || context.slug === "recall-knowledge") return true;
  return (context.options ?? []).some((o) => typeof o === "string" && o.startsWith("action:recall-knowledge"));
}

/**
 * The creature a roll is about: whatever its roller had targeted.
 *
 * A PC target is ignored. Recall Knowledge against a party member is a legal
 * roll but never a creaturedex entry, and letting one through would file the
 * fighter under "creatures the party has studied".
 */
function targetOf(message) {
  const author = message?.author ?? null;
  const pools = [author?.targets, game.user?.targets].filter(Boolean);
  for (const pool of pools) {
    for (const token of pool) {
      const actor = token?.actor ?? null;
      if (!actor) continue;
      if (actor.type === "npc" || actor.type === "hazard") return actor;
    }
  }
  return null;
}

/** The character who rolled. */
function rollerOf(message) {
  const actor = message?.speaker?.actor ? game.actors?.get(message.speaker.actor) : null;
  return actor?.type === "character" ? actor : null;
}

/**
 * Stamp the subject onto the card, once, from the active GM.
 *
 * Called on creation rather than on render: a render happens on every client
 * and repeatedly, and the roller's targets will have moved on by the second one.
 */
export async function stampSubject(message) {
  if (game.users?.activeGM !== game.user) return;
  if (!isRecallCheck(message) || !get(SETTINGS.chatOffer, true)) return;

  const subject = targetOf(message);
  const pc = rollerOf(message);
  if (!subject || !pc) return;

  // The 1d4 sidebar's die is rolled HERE, once, and stored — not derived at
  // render time. A "roll" recomputed on every client and every re-render is not
  // a roll; it would also show two players two different answers for one card.
  let d4 = null;
  if (get(SETTINGS.randomSection, false)) {
    try {
      d4 = (await new Roll("1d4").evaluate()).total;
    } catch {
      d4 = null;
    }
  }

  try {
    await message.setFlag(SUITE_ID, SUBJECT_FLAG, { uuid: subject.uuid, owner: pc.id, d4 });
    const key = subjectKey(subject);
    const encounter = game.combat?.id ?? null;
    if (key) await noteAttempt(key, ownerKey(pc), encounter);
  } catch (error) {
    warn("pf2e-creaturedex | could not stamp a Recall Knowledge card", error);
  }
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function sectionButton(key, { disabled, known }) {
  const label = esc(L(`GLDEX.section.${key}`));
  const state = known ? ' data-known="true"' : "";
  return `<button type="button" class="gl-btn ${CLASS}-pick" data-section="${key}"${state}${
    disabled ? " disabled" : ""
  }>${label}</button>`;
}

function render({ subject, pc, offer, available, known, repeat, forced }) {
  const head = L(`GLDEX.offer.${offer.kind}`, { count: String(offer.remaining) });

  // A forced section is the 1d4 sidebar landing on a specific one. The other
  // two buttons are shown disabled rather than hidden, so the player can see
  // what the die took away from them.
  const buttons = available
    .map((key) =>
      sectionButton(key, {
        disabled: (forced && key !== forced) || (offer.kind === "reveal" && known.includes(key)),
        known: known.includes(key),
      })
    )
    .join("");

  const notes = [];
  if (repeat) notes.push(`<p class="${CLASS}-note is-warn">${esc(L("GLDEX.offer.repeat"))}</p>`);
  if (forced) notes.push(`<p class="${CLASS}-note">${esc(L("GLDEX.offer.forced", { section: L(`GLDEX.section.${forced}`) }))}</p>`);
  if (offer.kind === "false") notes.push(`<p class="${CLASS}-note is-hazard">${esc(L("GLDEX.offer.falseHint"))}</p>`);

  return `<section class="${CLASS}" data-kind="${offer.kind}">
    <header class="${CLASS}-head">
      <span class="${CLASS}-title">${esc(L("GLDEX.offer.title"))}</span>
      <span class="${CLASS}-subject">${esc(subject.name)}</span>
    </header>
    <p class="${CLASS}-line">${esc(head)}</p>
    <div class="${CLASS}-picks">${buttons}</div>
    ${notes.join("")}
    <footer class="${CLASS}-foot">${esc(L("GLDEX.offer.for", { actor: pc.name }))}</footer>
  </section>`;
}

export async function onRenderChat(message, html) {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
    const content = root?.querySelector?.(".message-content");
    if (!content) return;

    content.querySelectorAll(`.${CLASS}`).forEach((node) => node.remove());
    if (!get(SETTINGS.chatOffer, true)) return;

    const stamp = message?.getFlag?.(SUITE_ID, SUBJECT_FLAG) ?? null;
    if (!stamp) return;

    const offer = offerFor(message);
    if (!offer || offer.kind === "none" || offer.remaining <= 0) return;

    const pc = game.actors?.get(stamp.owner) ?? null;
    const subject = await fromUuid(stamp.uuid).catch(() => null);
    if (!pc || !subject) return;

    // Shown to the GM and to whoever owns the character. A third player reading
    // the log sees the roll, not the menu — the choice is the roller's.
    const mayChoose = game.user.isGM || pc.testUserPermission(game.user, "OWNER");
    if (!mayChoose) return;

    const available = availableSections(subject);
    if (!available.length) return;

    const key = subjectKey(subject);
    const known = knownSections(key, ownerKey(pc));
    const encounter = game.combat?.id ?? null;
    const repeat = !canAttempt(attemptsIn(key, ownerKey(pc), encounter) - 1, observedIn(key, encounter));

    // The die was rolled when the card was stamped; a 4 (or a subject with
    // fewer sections than the die can name) means the player chooses freely.
    const forced = offer.kind === "reveal" ? rollSection(stamp.d4, available) : null;

    content.insertAdjacentHTML("beforeend", render({ subject, pc, offer, available, known, repeat, forced }));

    for (const button of content.querySelectorAll(`.${CLASS}-pick`)) {
      button.addEventListener("click", async () => {
        button.disabled = true;
        await requestReveal({
          messageId: message.id,
          subjectUuid: subject.uuid,
          ownerId: pc.id,
          section: button.dataset.section,
        });
      });
    }
  } catch (error) {
    warn("pf2e-creaturedex | could not render a Recall Knowledge offer", error);
  }
}

