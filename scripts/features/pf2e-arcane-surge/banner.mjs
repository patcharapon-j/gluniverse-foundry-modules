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
import { isConcealed, levelLabel, modeLabel } from "./settings.mjs";
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

    // Every NPC casting's banner is the GM's alone — a passed check too, not
    // only a held surge. A public "the weave held" on an enemy's spell announces
    // that the GM's monsters are being checked at all, and prints the level it
    // was checked against, which is exactly what conceal exists to prevent.
    if (!check.playerCast && !game.user.isGM) return;

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
  // A released surge is the socket's to play, on every client including the GM
  // who released it. Letting the render path fire too would play it twice for
  // anyone whose re-render lands inside the freshness window.
  if (check.releasedAt) return;
  // A manual surge is played by the GM who applied it and broadcast to everyone
  // else; letting the flag render fire it too would double it for the GM.
  if (check.manual) return;
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

  // `.gl-type` because Foundry styles button/label/input at element level, which
  // beats an inherited font-family — without it any control inside the banner
  // silently renders in Signika.
  const classes = [
    "glas-banner",
    "gl-type",
    `glas-${state}`,
    `glas-level-${check.effective}`,
    check.held ? "glas-pending" : "",
    fresh && !check.voided ? "glas-reveal" : "",
  ].filter(Boolean).join(" ");

  const title = game.i18n.localize(
    check.voided ? "GLAS.banner.voided" : check.surged ? "GLAS.banner.surge" : "GLAS.banner.held"
  );

  /* Provenance line: the level the check was read against, the die face when
     there was one, and the declared choice when it was not "none".

     While the GM has concealed stability, the level is REDACTED for players.
     Naming it here would defeat conceal on the party's very first cast — a
     surge they experience is the intended way to find out, a label reading
     "Unraveling" on their own spell card is not. */
  const redacted = isConcealed() && !game.user.isGM;
  const bits = [];
  if (!redacted) bits.push(levelLabel(check.effective));
  if (check.mode !== "none") bits.push(modeLabel(check.mode));
  if (!redacted && Number.isInteger(check.die)) bits.push(`${check.die} / ${check.threshold}`);
  if (!bits.length) bits.push(game.i18n.localize("GLAS.banner.unknownLevel"));

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
