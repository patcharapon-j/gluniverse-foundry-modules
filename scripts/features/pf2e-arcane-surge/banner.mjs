/**
 * GLUniverse Suite — the surge banner.
 *
 * Injected into the spell's OWN card rather than posted as a second message:
 * one casting, one card. A caster-heavy party would otherwise double the length
 * of the chat log for a line of text.
 *
 * It renders on a pass as well as a surge. That is not decoration — a banner
 * that only appears when something happened spoils itself by existing, and the
 * quiet "the weave held" is most of what makes the next one land.
 *
 * The suite's destiny-dice writes a fate strip into the same `.message-content`
 * with the same remove-then-reinsert idempotence, so the two can coexist. This
 * one deliberately looks like a sibling of that strip and deliberately inserts
 * BELOW it: the mechanical adjustment (fate) reads before the cosmic
 * consequence (surge).
 */

import { SUITE_ID } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FLAGS, REVEAL_WINDOW_MS } from "./constants.mjs";
import { releaseHeldSurge, voidCheck } from "./check.mjs";
import { levelLabel, modeLabel } from "./settings.mjs";
import { playBurst } from "./burst.mjs";

/** Messages whose burst this client has already played. A re-render (an edit, a
 *  scroll, a permission change) must not replay the ceremony. */
const played = new Set();

export function registerBanner() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
    const content = root?.querySelector?.(".message-content");
    if (!content) return;

    content.querySelectorAll(".glas-banner").forEach((node) => node.remove());

    const check = message?.getFlag?.(SUITE_ID, FLAGS.check);
    if (!check) return;

    // A held NPC surge exists only for the GM until they release it.
    if (check.held && !game.user.isGM) return;

    content.insertAdjacentHTML("beforeend", renderBanner(check));
    wire(message, content);
    maybePlay(message, check);
  });
}

/**
 * The burst rides the flag rather than a socket: every client renders the card,
 * sees a fresh flag, and plays. Free, self-healing, and already the pattern the
 * suite's fate strip uses for its own reveal. The socket is reserved for the one
 * case this cannot cover — a GM releasing a surge whose card is already old.
 */
function maybePlay(message, check) {
  if (!check.surged || check.held || check.voided) return;
  if (played.has(message.id)) return;
  const fresh = Number.isFinite(check.appliedAt) && Date.now() - check.appliedAt < REVEAL_WINDOW_MS;
  if (!fresh) return;
  played.add(message.id);
  playBurst(check.effective);
}

function wire(message, content) {
  const voidBtn = content.querySelector(".glas-banner-void");
  if (voidBtn) voidBtn.addEventListener("click", () => voidCheck(message));
  const release = content.querySelector(".glas-banner-release");
  if (release) release.addEventListener("click", () => releaseHeldSurge(message));
}

function renderBanner(check) {
  const fresh = Number.isFinite(check.appliedAt) && Date.now() - check.appliedAt < REVEAL_WINDOW_MS;
  const state = check.voided ? "voided" : check.surged ? "surge" : "held";

  const classes = [
    "glas-banner",
    `glas-${state}`,
    `glas-level-${check.effective}`,
    check.held ? "glas-pending" : "",
    fresh && !check.voided ? "glas-reveal" : "",
  ].filter(Boolean).join(" ");

  const title = game.i18n.localize(
    check.voided ? "GLAS.banner.voided" : check.surged ? "GLAS.banner.surge" : "GLAS.banner.held"
  );

  // Provenance line: the level the check was read against, the die face when
  // there was one, and the declared choice when it was not "none".
  const bits = [levelLabel(check.effective)];
  if (check.mode !== "none") bits.push(modeLabel(check.mode));
  if (Number.isInteger(check.die)) bits.push(`${check.die} / ${check.threshold}`);

  const controls = game.user.isGM
    ? `<span class="glas-banner-controls">
        ${check.held ? `<button type="button" class="glas-banner-release">${escapeHTML(game.i18n.localize("GLAS.banner.release"))}</button>` : ""}
        <button type="button" class="glas-banner-void">${escapeHTML(game.i18n.localize(check.voided ? "GLAS.banner.unvoid" : "GLAS.banner.void"))}</button>
      </span>`
    : "";

  return `<footer class="${classes}">
    <i class="glas-cut" aria-hidden="true"></i>
    <span class="glas-banner-glyph" aria-hidden="true">
      <i class="fa-solid ${check.surged ? "fa-burst" : "fa-shield-halved"}"></i>
    </span>
    <div class="glas-banner-body">
      <span class="glas-banner-kicker">${escapeHTML(bits.join(" · "))}</span>
      <span class="glas-banner-title">${escapeHTML(title)}</span>
    </div>
    ${controls}
  </footer>`;
}
