/**
 * Boss Creatures — what the table gets told.
 *
 * The GM builds a boss privately, but two beats have to be public or the whole
 * mechanic stops working:
 *
 *   • A **Telegraph** is a signal. "As long as creatures can sense the target of
 *     a Telegraph, they know the target of a Telegraphed Boss Ability" — a
 *     telegraph nobody was told about is just the boss getting a free turn.
 *   • A **Downfall** landing is the party's feedback that the lever worked. It
 *     is the only way they learn that whatever they just did is worth doing
 *     again, and the boss's defences have genuinely dropped, which changes what
 *     the next PC should attempt.
 *
 * Both go out as ordinary public chat messages rather than whispers, and neither
 * names the trigger the GM wrote down: the party is meant to work out *why* it
 * fired, and printing "Auditory" in the card answers that for them.
 */

import { SUITE_ID } from "../../../core/const.mjs";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const CLASS = "glvr-boss-card";

async function post(content) {
  try {
    await ChatMessage.create({
      content,
      speaker: { alias: L("GLVR.boss.panel") },
      flags: { [SUITE_ID]: { "vr.bossCard": true } },
    });
  } catch {
    /* a locked world simply gets no card */
  }
}

/** Announce a Downfall, and whatever it disrupted on the way through. */
export async function announceDownfall(actor, result, downfall) {
  const body = L("GLVR.boss.chat.downfall", {
    name: actor?.name ?? "",
    penalty: String(result.penalty),
  });

  const disrupted = result.disrupted?.ability
    ? L("GLVR.boss.chat.downfallDisrupt", {
        ability: L(`GLVR.boss.ability.${result.disrupted.ability}.name`),
      })
    : "";

  await post(
    `<section class="${CLASS}" data-kind="downfall"><p>${body}${disrupted}</p></section>`
  );
  return downfall;
}

/** Announce a Telegraph, including its target when the GM named one. */
export async function announceTelegraph(actor, abilityId, target) {
  const suffix = target ? L("GLVR.boss.chat.telegraphTarget", { target }) : "";
  const body = L("GLVR.boss.chat.telegraph", {
    name: actor?.name ?? "",
    ability: L(`GLVR.boss.ability.${abilityId}.name`),
    target: suffix,
  });
  await post(`<section class="${CLASS}" data-kind="telegraph"><p>${body}</p></section>`);
}
