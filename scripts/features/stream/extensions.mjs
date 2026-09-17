/**
 * GLUniverse Stream — extension slots.
 *
 * The standalone module was one package, so its chat overlay simply imported
 * the PF2e roll-card feed, `main.js` imported the portrait sheet header, and
 * the control panel imported the framing app. Split into three suite features
 * those become a **cycle**: `stream` → `stream-cards` → `stream`.
 *
 * It is resolved by inverting the edge rather than by hoisting code. `stream`
 * knows only that a card feed and some panel sections *may* exist; the children
 * fill these slots from their own `onReady`. Nothing here imports a child, so
 * `stream` builds and runs identically whether or not they are installed or
 * enabled — which is also what makes a disabled `stream-cards` inert rather
 * than merely idle.
 *
 * Slots are process-wide, not per-instance: a feature registers once at ready
 * and the overlay may be torn down and rebuilt many times per session.
 */

let cardFeedFactory = null;
const panelSections = [];

/**
 * `stream-cards` calls this with `overlay => new RollCardFeed(overlay)`.
 *
 * The feed's contract, as the chat overlay uses it: `handleCreate(message)`
 * (async), `handleDelete(message) → boolean`, `forget(record)`, `prescan()`,
 * `clear()`.
 */
export function registerCardFeed(factory) {
  cardFeedFactory = typeof factory === "function" ? factory : null;
}

/** True when something has claimed the card-feed slot. */
export function hasCardFeed() {
  return Boolean(cardFeedFactory);
}

/** Build a feed for an overlay, or null when no feature provides one. */
export function createCardFeed(overlay) {
  if (!cardFeedFactory) return null;
  try {
    return cardFeedFactory(overlay) ?? null;
  } catch (error) {
    console.error("GLUniverse Suite | Stream: a card feed factory threw; the overlay falls back to cloned chat cards.", error);
    return null;
  }
}

/**
 * Contribute a section to the control panel.
 *
 * `stream-targets` uses this so its settings appear beside the shot they affect
 * when `stream` is on, while remaining reachable from its own editor when
 * `stream` is off — a feature that can run alone has to be configurable alone.
 *
 * @param {object} section
 * @param {string} section.id      unique; re-registering replaces.
 * @param {number} [section.order] ascending; panel-native sections sit at 0.
 * @param {() => Promise<string>|string} section.render  the section's HTML.
 * @param {(name: string, value: unknown) => Promise<boolean>|boolean} [section.change]
 *        offered every form change the panel did not recognise as its own,
 *        in registration order; return true to claim it. The panel never
 *        writes a child's settings itself — the owning feature does, through
 *        its own prefix and its own sanitizers.
 * @param {(action: string, element: HTMLElement) => Promise<boolean>|boolean} [section.action]
 *        the same for `[data-action]` clicks.
 */
export function registerPanelSection(section) {
  if (!section?.id || typeof section.render !== "function") return;
  const at = panelSections.findIndex((s) => s.id === section.id);
  const entry = { order: 0, ...section };
  if (at >= 0) panelSections[at] = entry;
  else panelSections.push(entry);
}

/** Remove a contributed section (a feature disabled at runtime). */
export function unregisterPanelSection(id) {
  const at = panelSections.findIndex((s) => s.id === id);
  if (at >= 0) panelSections.splice(at, 1);
}

/** Contributed sections in display order. */
export function getPanelSections() {
  return [...panelSections].sort((a, b) => a.order - b.order);
}

/**
 * Render every contributed section. A section that throws is skipped with its
 * own id named, rather than taking the whole panel down with it — the panel is
 * how a GM stops a stream that has gone wrong, so it has to open.
 */
export async function renderPanelSections() {
  const out = [];
  for (const section of getPanelSections()) {
    try {
      out.push(String((await section.render()) ?? ""));
    } catch (error) {
      console.error(`GLUniverse Suite | Stream: panel section "${section.id}" failed to render.`, error);
    }
  }
  return out.join("");
}

/** Offer a form change to the contributed sections. True once one claims it. */
export async function offerPanelChange(name, value) {
  for (const section of getPanelSections()) {
    if (typeof section.change !== "function") continue;
    try {
      if (await section.change(name, value)) return true;
    } catch (error) {
      console.error(`GLUniverse Suite | Stream: panel section "${section.id}" failed on "${name}".`, error);
    }
  }
  return false;
}

/** Offer a `[data-action]` click to the contributed sections. */
export async function offerPanelAction(action, element) {
  for (const section of getPanelSections()) {
    if (typeof section.action !== "function") continue;
    try {
      if (await section.action(action, element)) return true;
    } catch (error) {
      console.error(`GLUniverse Suite | Stream: panel section "${section.id}" failed on action "${action}".`, error);
    }
  }
  return false;
}
