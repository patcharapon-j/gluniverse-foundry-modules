/**
 * GLUniverse Suite — Mobile feature: full-screen window management.
 *
 * On a phone there are no floating windows: every rendered Application (V1 and
 * V2) is forced full-screen below the top bar and above the tab bar via the
 * `gl-mobile-fs` class (geometry lives in styles/mobile.css). Inline
 * positioning that core applies is stripped so the CSS wins.
 */

const FS_CLASS = "gl-mobile-fs";

function elementOf(app) {
  // ApplicationV2 → HTMLElement; ApplicationV1 → jQuery.
  const el = app?.element;
  if (!el) return null;
  return el instanceof HTMLElement ? el : el[0] ?? null;
}

function fullscreen(app) {
  const el = elementOf(app);
  if (!el || !el.classList.contains("window-app") && !el.classList.contains("application")) return;
  // Leave core fixed UI regions (sidebar, hotbar, …) alone — they are
  // ApplicationV2 too but not positioned windows.
  const positioned = app?.options?.window?.positioned ?? app?.options?.positioned ?? true;
  if (!positioned && !el.classList.contains("window-app")) return;
  // Frameless ApplicationV2s are HUD overlays (e.g. the Stream Pacer), not
  // windows; forcing them full-screen strands their content mid-screen. Each
  // overlay gets its own mobile docking in styles/mobile.css instead.
  const framed = app?.options?.window?.frame ?? true;
  if (!framed && !el.classList.contains("window-app")) return;
  el.classList.add(FS_CLASS);
  // Actor sheets belong to the Character tab: they are only visible while
  // that tab is fronted (CSS), so a roll can "collapse" the sheet by simply
  // switching the shell back to the canvas view.
  const doc = app?.document ?? app?.actor ?? app?.object;
  if (doc?.documentName === "Actor") el.classList.add("gl-mobile-sheet-win");
  // Strip the inline geometry core computed so the fixed inset CSS applies.
  for (const prop of ["top", "left", "width", "height", "transform", "zIndex"]) el.style[prop] = "";
}

/** Wire render hooks. Call once from onReady when mobile mode is active. */
export function initWindowManager() {
  Hooks.on("renderApplication", (app) => fullscreen(app)); // V1
  Hooks.on("renderApplicationV2", (app) => fullscreen(app)); // V2
  // Dragging/resizing full-screen windows makes no sense; core listeners are
  // neutralized by CSS (header is still tappable for the close button).
}
