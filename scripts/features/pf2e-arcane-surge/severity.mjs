/**
 * GLUniverse Suite — the severity card.
 *
 * A surge posts this card unrolled, with a button either the GM or the caster
 * can press. That waiting card is most of the tension: everyone can see the roll
 * is coming and nobody knows what it will say. It also means the roll cannot be
 * forgotten, which a button on the banner or a GM-only context menu both allow.
 *
 * The d100 is read against the row for the casting's effective level, and the
 * result — the number, the row, and the tier — is fully public. Hiding what a
 * player just rolled is theatre. The INTERPRETATION is the GM's, and this
 * feature deliberately supplies none: the theme collections live outside the
 * module, so the card names the tier and stops.
 *
 * One casting yields one verdict. Two people pressing at the same instant, or
 * somebody pressing again while scrolling back a session later, must not produce
 * a second answer — the draft is explicit that a caster cannot withdraw a
 * completed casting after learning its twist.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FLAGS, REVEAL_WINDOW_MS } from "./constants.mjs";
import { tagSeverityRoll } from "./dsn.mjs";
import { SEVERITY_NOTATION } from "./constants.mjs";
import { severityTier, tierWindow } from "./levels.mjs";
import { levelConfig, rowLabel, tierLabel } from "./settings.mjs";
import { playFlourish } from "./burst.mjs";

/** Card ids currently rolling on this client — the two-presses-at-once guard. */
const inFlight = new Set();

/* ══════════════════════════════════════════════════════════════════════
   Posting
   ══════════════════════════════════════════════════════════════════════ */

export async function postSeverityCard(sourceMessage, check, { whisperGM = false } = {}) {
  try {
    const data = {
      speaker: sourceMessage?.speaker ?? ChatMessage.getSpeaker(),
      content: "",
      flags: {
        [SUITE_ID]: {
          [FLAGS.severity]: {
            row: check.row,
            level: check.effective,
            mode: check.mode,
            sourceId: sourceMessage?.id ?? null,
            value: null,
            tier: null,
            rolledBy: null,
            rolledAt: null,
            rerolled: false,
          },
        },
      },
    };
    if (whisperGM) data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
    await ChatMessage.implementation.create(data);
  } catch (e) {
    warn("Arcane Surge | could not post the severity card:", e);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Rolling
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Who may press. The GM always; otherwise the card's author, which for a
 * player's casting is the caster themselves — the card is created by whichever
 * client rolled the check.
 */
export function canRollSeverity(message) {
  const state = message?.getFlag?.(SUITE_ID, FLAGS.severity);
  if (!state || state.value != null) return false;
  return game.user.isGM || message.isAuthor;
}

export async function rollSeverity(message, { reroll = false } = {}) {
  const state = message?.getFlag?.(SUITE_ID, FLAGS.severity);
  if (!state) return null;
  // A settled card stays settled. Only a GM may deliberately re-roll it, and
  // the re-roll is recorded rather than pretending the first roll never was.
  if (state.value != null && !(reroll && game.user.isGM)) return null;
  if (inFlight.has(message.id)) return null;

  inFlight.add(message.id);
  try {
    const roll = await new Roll(SEVERITY_NOTATION).evaluate();
    tagSeverityRoll(roll);
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true).catch(() => {});

    // Re-read after the roll. `inFlight` only guards this client; the GM and the
    // caster can both press inside the same instant, and without this the second
    // write would overwrite the first and the table would watch the verdict
    // change under them. The first write wins.
    const settled = message.getFlag(SUITE_ID, FLAGS.severity);
    if (settled?.value != null && !reroll) return settled.tier;

    const value = Number(roll.total);
    const bands = levelConfig()[state.row]?.bands ?? null;
    const tier = severityTier(value, bands);

    await message.setFlag(SUITE_ID, FLAGS.severity, {
      ...state,
      value,
      tier,
      roll: roll.toJSON(),
      rolledBy: game.user.id,
      rolledAt: Date.now(),
      rerolled: state.value != null ? true : state.rerolled,
    });

    playFlourish(tier);
    return tier;
  } catch (e) {
    warn("Arcane Surge | severity roll failed:", e);
    return null;
  } finally {
    inFlight.delete(message.id);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Rendering
   ══════════════════════════════════════════════════════════════════════
   Flag-backed and regenerated on every render, never baked into the message
   content: a card written once would keep showing a stale "unrolled" state to
   a client that reconnected after somebody pressed it. */

export function registerSeverityRendering() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
    const content = root?.querySelector?.(".message-content");
    if (!content) return;

    content.querySelectorAll(".glas-severity").forEach((node) => node.remove());
    const state = message?.getFlag?.(SUITE_ID, FLAGS.severity);
    if (!state) return;

    content.insertAdjacentHTML("beforeend", renderCard(message, state));
    wire(message, content);
  });
}

function wire(message, content) {
  const button = content.querySelector(".glas-severity-roll");
  if (button) button.addEventListener("click", () => rollSeverity(message));
  const again = content.querySelector(".glas-severity-reroll");
  if (again) again.addEventListener("click", () => rollSeverity(message, { reroll: true }));
}

function renderCard(message, state) {
  const rolled = state.value != null;
  const fresh = rolled && Number.isFinite(state.rolledAt) && Date.now() - state.rolledAt < REVEAL_WINDOW_MS;
  const classes = [
    "glas-severity",
    "gl-type",
    rolled ? `glas-tier-${state.tier}` : "glas-unrolled",
    fresh ? "glas-reveal" : "",
  ].filter(Boolean).join(" ");

  const row = escapeHTML(rowLabel(state.row));

  if (!rolled) {
    const canRoll = canRollSeverity(message);
    const button = canRoll
      ? `<button type="button" class="glas-severity-roll">
           <i class="fa-solid fa-dice-d20" aria-hidden="true"></i>
           <span>${escapeHTML(game.i18n.localize("GLAS.severity.roll"))}</span>
         </button>`
      : `<span class="glas-severity-wait">${escapeHTML(game.i18n.localize("GLAS.severity.waiting"))}</span>`;

    return `<section class="${classes}">
      <header class="glas-severity-head">
        <span class="glas-severity-kicker">${escapeHTML(game.i18n.localize("GLAS.severity.kicker"))}</span>
        <span class="glas-severity-row">${row}</span>
      </header>
      ${button}
    </section>`;
  }

  const window = tierWindow(state.tier, levelConfig()[state.row]?.bands ?? null);
  // The band is shown beside the roll so the table can read the system rather
  // than only receive verdicts from it.
  const band = window ? `${window[0]}–${window[1]}` : "—";

  return `<section class="${classes}">
    <header class="glas-severity-head">
      <span class="glas-severity-kicker">${escapeHTML(game.i18n.localize("GLAS.severity.kicker"))}</span>
      <span class="glas-severity-row">${row}</span>
    </header>
    <div class="glas-severity-body">
      <span class="glas-severity-value">${escapeHTML(String(state.value))}</span>
      <span class="glas-severity-tier">${escapeHTML(tierLabel(state.tier))}</span>
      <span class="glas-severity-band">${escapeHTML(band)}</span>
    </div>
    <p class="glas-severity-hint">${escapeHTML(game.i18n.localize(`GLAS.tierHint.${state.tier}`))}</p>
    ${state.rerolled ? `<p class="glas-severity-rerolled">${escapeHTML(game.i18n.localize("GLAS.severity.rerolled"))}</p>` : ""}
    ${game.user.isGM ? `<button type="button" class="glas-severity-reroll">${escapeHTML(game.i18n.localize("GLAS.severity.reroll"))}</button>` : ""}
  </section>`;
}
