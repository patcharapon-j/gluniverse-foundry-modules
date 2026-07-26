// Ported into the GLUniverse Suite: the single installed package id is
// "gluniverse-foundry-modules". Settings/flags register under that id; per-feature
// isolation is via the "init." key prefix. The socket no longer uses a per-module
// channel — emit/on are routed through scripts/core/socket.mjs (feature "initiative").
export const MODULE_ID = "gluniverse-foundry-modules";
export const FEATURE_ID = "initiative";
// Retained for backwards reference; the live channel is core's shared socket.
export const SOCKET_NAME = `module.${MODULE_ID}`;

export const SETTINGS = {
  enabled: "init.enabled",
  initiativeMode: "init.initiativeMode",
  edge: "init.edge",
  visibleCount: "init.visibleCount",
  showAllCombatants: "init.showAllCombatants",
  showDefeated: "init.showDefeated",
  delayedPlacement: "init.delayedPlacement",
  position: "init.position",
  uiScale: "init.uiScale",
  tokenOverlayShape: "init.tokenOverlayShape",
  turnMarkerEnabled: "init.turnMarkerEnabled",
  startMarkerEnabled: "init.startMarkerEnabled",
  startConnectorEnabled: "init.startConnectorEnabled",
  conditionBadges: "init.conditionBadges",
  conditionBadgeLayout: "init.conditionBadgeLayout",
  guardBreakSound: "init.guardBreakSound",
  guardBreakSoundVolume: "init.guardBreakSoundVolume"
};

// ── Etched Glass palette ────────────────────────────────────────────────
// Etched Glass is the suite's single theme, so this is one flat palette rather
// than a set keyed by theme name. The suite previously shipped four (scifi /
// core / fantasy / chronicle) selected by an `init.theme` world setting; the
// other three have been removed.
//
// These are the GPU-side twins of the CSS tokens in styles/gl-tokens.css:
// PIXI/WebGL cannot read CSS custom properties, so the same hues appear here as
// 0xRRGGBB ints and vec3 floats. When a hue changes in gl-tokens.css it MUST be
// changed here too — the comment on each line names the token it mirrors.
//
// The exported palettes stay mutable objects (rather than frozen literals) so
// existing call sites that snapshot them (`const P = TOKEN_OVERLAY_PALETTE`)
// keep working unchanged.

export const TOKEN_OVERLAY_PALETTE = {
  delayed: 0x4aa3ff, delayedHi: 0x9ad8ff,                              // --gl-info / -hot
  broken: 0xffb12d, brokenHot: 0xffe070, brokenDeep: 0xff6f1a,         // --gl-warn / -hot / -deep
  dying: 0xcf85e0, dyingHot: 0xf6d9fb, dyingDeep: 0x842f9e,            // --gl-orchid / -hot
  saveSuccess: 0x57e08b, saveSuccessHot: 0xb6ffd0,                     // --gl-good / -hot
  saveFailure: 0xff5d6c, saveFailureHot: 0xffc0c6,                     // --gl-hazard / -hot
  stable: 0x4ad9c0, stableHot: 0xb6fff2,                               // --gl-teal / -hot
  ink: 0x02070b, white: 0xf3fbff,                                      // --gl-ink-0 / --gl-text-bright
  violet: 0xb497ff, magenta: 0xff66b3                                  // --gl-violet / --gl-holo-c
};

export const DISPOSITION_PALETTE = {
  friendly: { base: 0x5eeaff, hi: 0xb9f7ff },                          // --gl-cyan
  hostile:  { base: 0xff4a52, hi: 0xff9098 },                          // --gl-hazard
  neutral:  { base: 0xffce6a, hi: 0xffe6b0 },                          // neutral disposition amber
  secret:   { base: 0xb497ff, hi: 0xe0d4ff }                           // --gl-violet / -hot
};

// vec3 floats consumed directly by the WebGL filter uniforms in
// CardFXManager / TokenOverlayManager / BreakSplashGL.
export const ACTIVE_SHADER_PALETTE = {
  veinBase:   [0.812, 0.522, 0.878],   // FX_FRAG_DYING orchid (distinct from secret)
  veinHot:    [0.965, 0.851, 0.984],
  mysteryA:   [0.71, 0.59, 1.0],       // FX_FRAG_SCRAMBLE violet
  mysteryB:   [0.37, 0.92, 1.0],       // FX_FRAG_SCRAMBLE cyan
  delayBase:  [0.29, 0.64, 1.0],       // FX_FRAG_DELAY blue
  delayHot:   [0.60, 0.85, 1.0],
  breakAmber: [1.0, 0.694, 0.176],     // FX_FRAG_BREAK amber
  breakHot:   [1.0, 0.878, 0.439],
  splashHot:  [1.0, 0.694, 0.176],     // BREAK_GL_FRAG full-screen
  splashGlow: [1.0, 0.878, 0.439],
  apexBase:   [0.694, 0.294, 1.0],     // FX_FRAG_APEX eclipse-violet ember
  apexHot:    [1.0, 0.482, 0.839]
};

export function getDispositionColors(disposition) {
  return DISPOSITION_PALETTE[disposition] ?? DISPOSITION_PALETTE.neutral;
}

// Flag keys are prefixed with "init." for cross-feature isolation on shared
// documents (scope is the suite id MODULE_ID). APEX.* flags mirror the
// flatfinder feature's own ff.-prefixed keys under the same suite scope.
export const FLAGS = {
  visibility: "init.visibility",
  manualDelayed: "init.manualDelayed",
  guardBroken: "init.guardBroken",
  breakGauge: "init.breakGauge",
  portraitFrame: "init.portraitFrame",
  adhoc: "init.adhoc",
  adhocActor: "init.adhocActor",
  turnStart: "init.turnStart",
  hiddenConditions: "init.hiddenConditions",
  // Card initiative mode: per-actor deck config { cards, turns } stored on the
  // Actor, and the live shuffled turn order stored on the Combat as cardDeal:
  // { round, pointer, sequence: [{ cid, n }] }.
  cardConfig: "init.cardConfig",
  cardDeal: "init.cardDeal"
};

export const INITIATIVE_MODE = Object.freeze({ standard: "standard", card: "card" });

// Card mode per-actor deck configuration.
//  - cards: copies of this actor's card in the deck; more copies => more likely
//    to be dealt an early slot. Extra draws after placement are ignored.
//  - turns: how many turns this actor takes per round (boss multi-turn). Each of
//    the actor's first `turns` draws becomes a real turn slot.
// The deck holds max(cards, turns) copies so a multi-turn actor can always reach
// its full turn count.
export const CARD_CONFIG_DEFAULTS = Object.freeze({ cards: 1, turns: 1 });
export const CARD_CONFIG_LIMITS = Object.freeze({
  cards: Object.freeze({ min: 1, max: 10 }),
  turns: Object.freeze({ min: 1, max: 10 })
});

// Break gauge: a GM-managed resource bar that depletes toward a guard break.
// Stored per-combatant under FLAGS.breakGauge as { max, value, mode }.
export const BREAK_GAUGE_DEFAULT_MAX = 100;
export const BREAK_GAUGE_MODES = Object.freeze({ smooth: "smooth", segmented: "segmented" });
// Shared by the card (CSS) and token (PIXI) gauges so they animate alike.
export const BREAK_GAUGE_FLASH_SEC = 0.55;
export const BREAK_GAUGE_SHEEN_SEC = 3.4;

export const VISIBILITY = {
  auto: "auto",
  visible: "visible",
  hidden: "hidden",
  mystery: "mystery"
};

// PF2e-only: an Effect item applied to a broken actor that imposes a -2 status
// penalty to AC and all saving throws. The slug + module flag let us find and
// remove exactly the effect we created when the break is cleared.
export const PF2E_GUARD_BREAK_EFFECT_SLUG = "gluni-guard-break";
export const PF2E_GUARD_BREAK_PENALTY = 2;

// PF2e-Flatfinder integration (optional, soft one-directional read). Flatfinder
// marks a solo "Apex" boss with an actor flag and creates extra Combatant
// documents for the boss's additional turns (at initiative -10, -20, …), tagging
// the original as "prime" and each extra with its 1-based ordinal. We only ever
// READ these — the overlay never writes Flatfinder flags. Key names mirror
// Flatfinder's own constants.js; keep them in sync if that module renames them.
// The PHASE_THRESHOLDS mirror Flatfinder's HP-phase beats so the card's menace
// escalates in lock-step with the boss's mechanical phases.
export const APEX = Object.freeze({
  // Flatfinder is now the "flatfinder" feature of this same suite, so its apex
  // flags live under the suite scope with the ff.-prefixed keys it writes.
  MODULE_ID: "gluniverse-foundry-modules",
  FLAG: "ff.apex",            // actor flag: { enabled, turns }
  PRIME_FLAG: "ff.apexPrime", // combatant flag on the boss's primary turn (true)
  EXTRA_FLAG: "ff.apexExtra", // combatant flag on an extra turn: { primeId, index, total }
  PHASE_THRESHOLDS: Object.freeze([0.66, 0.33]) // HP fraction → Phase II / Phase III
});

export const LOCALIZATION_FALLBACKS = Object.freeze({
  "GLUNI.A11y.OverlayLabel": "Initiative order",
  "GLUNI.A11y.RoundAnnouncement": "Round {round}",
  "GLUNI.A11y.TurnAnnouncement": "Round {round}: {name}'s turn",
  "GLUNI.Settings.Edge.Hint": "Choose which screen edge the initiative rail anchors to.",
  "GLUNI.Settings.Edge.Left": "Left",
  "GLUNI.Settings.Edge.Name": "Tracker edge",
  "GLUNI.Settings.Edge.Right": "Right",
  "GLUNI.Settings.Enabled.Hint": "Show the GLUniverse Initiative overlay for this user while combat is active.",
  "GLUNI.Settings.Enabled.Name": "Show cinematic initiative overlay",
  "GLUNI.Settings.ShowDefeated.Hint": "When disabled, defeated combatants are omitted from the cinematic overlay.",
  "GLUNI.Settings.ShowDefeated.Name": "Show defeated combatants",
  "GLUNI.Settings.TokenOverlayShape.Circle": "Circle",
  "GLUNI.Settings.TokenOverlayShape.Hint": "Shape of the status overlay drawn on tokens with delay or guard break.",
  "GLUNI.Settings.TokenOverlayShape.Name": "Token overlay shape",
  "GLUNI.Settings.TokenOverlayShape.Square": "Square",
  "GLUNI.Settings.UIScale.Hint": "Scale the initiative tracker for only this user.",
  "GLUNI.Settings.UIScale.Name": "UI scale",
  "GLUNI.Settings.TurnMarker.Name": "Turn marker on tokens",
  "GLUNI.Settings.TurnMarker.Hint": "Draw a cinematic ground ring beneath the current and next combatant's tokens, coloured by disposition.",
  "GLUNI.Settings.StartMarker.Name": "Starting-location marker",
  "GLUNI.Settings.StartMarker.Hint": "Mark where the active combatant's token began its turn, so players can see how far it has moved.",
  "GLUNI.Settings.StartConnector.Name": "Starting-location trail",
  "GLUNI.Settings.StartConnector.Hint": "Draw a flowing connector line from the starting-location marker to the active token. Requires the starting-location marker.",
  "GLUNI.Settings.ConditionBadges.Name": "Show condition badges",
  "GLUNI.Settings.ConditionBadges.Hint": "Display the small per-condition badges alongside each combatant card. Does not affect the in-card condition treatment or the actual conditions on the token.",
  "GLUNI.Settings.ConditionBadgeLayout.Name": "Condition badge layout",
  "GLUNI.Settings.ConditionBadgeLayout.Hint": "Arrange the condition badges as stacked horizontal pills, or as a slim vertical strip of rotated text along the card.",
  "GLUNI.Settings.ConditionBadgeLayout.Horizontal": "Horizontal pills",
  "GLUNI.Settings.ConditionBadgeLayout.Vertical": "Vertical strip",
  "GLUNI.Settings.GuardBreakSound.Name": "Guard break sound",
  "GLUNI.Settings.GuardBreakSound.Hint": "Audio file played for everyone when a combatant's guard is broken. Leave empty for no sound.",
  "GLUNI.Settings.GuardBreakSoundVolume.Name": "Guard break sound volume",
  "GLUNI.Settings.GuardBreakSoundVolume.Hint": "Playback volume of the guard break sound for this user.",
  "GLUNI.TurnMarker.Next": "Next",
  "GLUNI.Settings.VisibleCount.Hint": "Number of normal initiative combatants to show from the current turn forward. Ignored when \"Show all combatants\" is enabled.",
  "GLUNI.Settings.VisibleCount.Name": "Visible combatants",
  "GLUNI.Settings.ShowAllCombatants.Name": "Show all combatants",
  "GLUNI.Settings.ShowAllCombatants.Hint": "Always show every combatant in the initiative order (including ad hoc cards) instead of a fixed number. One-shot ad hoc entries still only appear on their scheduled round. Overrides the visible-combatants count.",
  "GLUNI.Settings.DelayedPlacement.Name": "Delayed card placement",
  "GLUNI.Settings.DelayedPlacement.Hint": "Where delayed combatant cards are shown: stacked beneath the rail, or as a column on the screen-edge side of the tracker (opposite the condition badges).",
  "GLUNI.Settings.DelayedPlacement.Bottom": "Below the rail",
  "GLUNI.Settings.DelayedPlacement.Side": "Side of tracker",
  "GLUNI.Controls.Auto": "Auto",
  "GLUNI.Controls.Delay": "Delay",
  "GLUNI.Controls.EndTurn": "End turn",
  "GLUNI.Controls.AdjustInitiative": "Adjust initiative",
  "GLUNI.Controls.Apply": "Apply",
  "GLUNI.Controls.GuardBreak": "Guard break",
  "GLUNI.Controls.ClearGuardBreak": "Clear guard break",
  "GLUNI.Controls.TokenGuardBreak.Tooltip": "Toggle break on token",
  "GLUNI.Controls.TokenGuardBreak.NoCombat": "Start combat before marking break.",
  "GLUNI.Controls.TokenGuardBreak.NoCombatant": "This token is not in the active combat.",
  "GLUNI.Controls.TokenBreakGauge": "Break gauge",
  "GLUNI.BreakGauge.Label": "Break",
  "GLUNI.BreakGauge.Title": "Break gauge",
  "GLUNI.BreakGauge.Max": "Max",
  "GLUNI.BreakGauge.Current": "Current",
  "GLUNI.BreakGauge.ModeLabel": "Mode",
  "GLUNI.BreakGauge.Mode.Smooth": "Smooth",
  "GLUNI.BreakGauge.Mode.Segmented": "Segmented",
  "GLUNI.BreakGauge.Enable": "Show break gauge",
  "GLUNI.BreakGauge.Apply": "Apply",
  "GLUNI.BreakGauge.Clear": "Remove",
  "GLUNI.BreakGauge.Aria": "Break gauge {value} of {max}",
  "GLUNI.Controls.DecreaseInitiative": "Decrease initiative",
  "GLUNI.Controls.Hidden": "Hide",
  "GLUNI.Controls.IncreaseInitiative": "Increase initiative",
  "GLUNI.Controls.Mystery": "Mystery",
  "GLUNI.Controls.NextTurn": "Next turn",
  "GLUNI.Controls.PreviousTurn": "Previous turn",
  "GLUNI.Controls.Return": "Return",
  "GLUNI.Controls.Turn": "Turn",
  "GLUNI.Controls.MoveTracker": "Move tracker",
  "GLUNI.Controls.TurnControls": "Turn controls",
  "GLUNI.Controls.Visible": "Show",
  "GLUNI.AdHoc.Add": "Add ad hoc initiative",
  "GLUNI.AdHoc.Create": "Create",
  "GLUNI.AdHoc.Delete": "Delete ad hoc initiative",
  "GLUNI.AdHoc.DeleteConfirm": "Delete ad hoc initiative entry \"{name}\"?",
  "GLUNI.AdHoc.DefaultName": "Ad Hoc Trigger",
  "GLUNI.AdHoc.DialogTitle": "Ad Hoc Initiative",
  "GLUNI.AdHoc.Icon": "Icon",
  "GLUNI.AdHoc.Initiative": "Initiative",
  "GLUNI.AdHoc.Lifecycle": "Duration",
  "GLUNI.AdHoc.Name": "Name",
  "GLUNI.AdHoc.NameRequired": "Ad hoc initiative needs a name.",
  "GLUNI.AdHoc.OneShot": "One shot",
  "GLUNI.AdHoc.Persistent": "Persistent",
  "GLUNI.AdHoc.Round": "Round",
  "GLUNI.AdHoc.TypeLabel": "Type",
  "GLUNI.AdHoc.Type.Effect": "Effect",
  "GLUNI.AdHoc.Type.Environment": "Environment",
  "GLUNI.AdHoc.Type.Hazard": "Hazard",
  "GLUNI.AdHoc.Type.NPC": "NPC",
  "GLUNI.AdHoc.Visibility": "Visibility",
  "GLUNI.Delayed": "Delayed",
  "GLUNI.GuardBreak": "Break",
  "GLUNI.Apex.Tag": "Apex",
  "GLUNI.Apex.PhaseLabel": "Phase",
  "GLUNI.Apex.Aria": "Apex solo creature, phase {phase} of 3",
  "GLUNI.Apex.Ordinal.Aria": "Apex extra turn {index} of {total}",
  "GLUNI.Conditions.Title": "Conditions",
  "GLUNI.Conditions.Hide": "Hide on tracker",
  "GLUNI.Conditions.Show": "Show on tracker",
  "GLUNI.Conditions.None": "No temporary conditions",
  "GLUNI.PF2e.BreakEffect.Name": "Break",
  "GLUNI.PF2e.BreakEffect.Description": "<p>Your guard has been broken. You take a -2 status penalty to AC and all saving throws, and you lose all resistances.</p>",
  "GLUNI.Dying.Label": "Dying",
  "GLUNI.Dying.Aria": "Dying {value} of {max}",
  "GLUNI.DeathSaves.Label": "Death Saves",
  "GLUNI.DeathSaves.Stable": "Stable",
  "GLUNI.DeathSaves.Success.Aria": "Death save successes {value} of {max}",
  "GLUNI.DeathSaves.Failure.Aria": "Death save failures {value} of {max}",
  "GLUNI.PortraitConfig.ActiveCard": "Active card",
  "GLUNI.PortraitConfig.Button": "Frame",
  "GLUNI.PortraitConfig.Expanded": "Expanded",
  "GLUNI.PortraitConfig.Hint": "Tune how this actor's image is cropped in normal and active initiative cards. Right-drag a preview to reposition; use the mouse wheel over a preview to adjust zoom.",
  "GLUNI.PortraitConfig.Normal": "Normal",
  "GLUNI.PortraitConfig.NormalCard": "Idle card",
  "GLUNI.PortraitConfig.Open": "Configure initiative portrait",
  "GLUNI.PortraitConfig.PositionX": "X",
  "GLUNI.PortraitConfig.PositionY": "Y",
  "GLUNI.PortraitConfig.PreviewHint": "Right-drag to reposition. Mouse wheel adjusts zoom.",
  "GLUNI.PortraitConfig.Reset": "Reset",
  "GLUNI.PortraitConfig.Save": "Save",
  "GLUNI.PortraitConfig.Scale": "Zoom",
  "GLUNI.PortraitConfig.Title": "{name} Initiative Portrait",
  "GLUNI.Round": "Round",
  "GLUNI.Splash.Break": "GUARD BREAK",
  "GLUNI.Splash.Cycle": "INITIATIVE - CYCLE {round}",
  "GLUNI.Unknown": "Unknown",
  "GLUNI.Settings.InitiativeMode.Name": "Initiative mode",
  "GLUNI.Settings.InitiativeMode.Hint": "Standard uses each combatant's rolled initiative. Card draws a fresh, shuffled turn order each round, ignoring initiative scores.",
  "GLUNI.Settings.InitiativeMode.Standard": "Standard (initiative scores)",
  "GLUNI.Settings.InitiativeMode.Card": "Card (shuffle &amp; deal each round)",
  "GLUNI.Card.Order": "Draw order {order}",
  "GLUNI.Card.Swap": "Swap turn with another combatant",
  "GLUNI.Card.SwapCancel": "Cancel swap",
  "GLUNI.Card.SwapPick": "Force this combatant to act now",
  "GLUNI.Card.SwapPickShort": "Act now",
  "GLUNI.Card.Reshuffle": "Reshuffle",
  "GLUNI.Card.Deck": "Deck",
  "GLUNI.Card.DeckRemaining": "{count} cards left this round",
  "GLUNI.Card.Reorder": "Drag to reorder upcoming turns",
  "GLUNI.Card.Config.Button": "Deck",
  "GLUNI.Card.Config.Open": "Configure initiative deck",
  "GLUNI.Card.Config.Title": "{name} Initiative Deck",
  "GLUNI.Card.Config.Hint": "Card initiative settings for this actor. These only apply while the Card initiative mode is active.",
  "GLUNI.Card.Config.Cards": "Cards in deck",
  "GLUNI.Card.Config.CardsHint": "More copies make this actor more likely to be dealt an early turn. Extra copies do not grant extra turns.",
  "GLUNI.Card.Config.Turns": "Turns per round",
  "GLUNI.Card.Config.TurnsHint": "How many turns this actor takes each round (for multi-turn bosses).",
  "GLUNI.Card.Config.Reset": "Reset",
  "GLUNI.Card.Config.Save": "Save"
});

export const ADHOC_DEFAULT_TYPE = "effect";
export const ADHOC_TYPES = Object.freeze({
  effect: Object.freeze({
    label: "GLUNI.AdHoc.Type.Effect",
    icon: "fa-solid fa-bolt",
    disposition: "neutral"
  }),
  hazard: Object.freeze({
    label: "GLUNI.AdHoc.Type.Hazard",
    icon: "fa-solid fa-triangle-exclamation",
    disposition: "hostile"
  }),
  npc: Object.freeze({
    label: "GLUNI.AdHoc.Type.NPC",
    icon: "fa-solid fa-user-clock",
    disposition: "secret"
  }),
  environment: Object.freeze({
    label: "GLUNI.AdHoc.Type.Environment",
    icon: "fa-solid fa-cloud-bolt",
    disposition: "friendly"
  })
});
export const ADHOC_VISIBILITY_MODES = new Set([VISIBILITY.visible, VISIBILITY.mystery, VISIBILITY.hidden]);
export const ADHOC_LIFECYCLE = Object.freeze({
  persistent: "persistent",
  oneShot: "oneShot"
});
export const ADHOC_LIFECYCLE_MODES = new Set(Object.values(ADHOC_LIFECYCLE));
export const STATUS_ANIMATION = Object.freeze({
  delay: Object.freeze({ label: "GLUNI.Delayed", colorClass: "delay", motion: "slide" }),
  guardBreak: Object.freeze({ label: "GLUNI.GuardBreak", colorClass: "break", motion: "slide" }),
  dying: Object.freeze({ label: "GLUNI.Dying.Label", colorClass: "dying", motion: "dying" })
});
export const ADHOC_ICON_CHOICES = Object.freeze([
  "fa-solid fa-bolt",
  "fa-solid fa-burst",
  "fa-solid fa-fire",
  "fa-solid fa-skull",
  "fa-solid fa-triangle-exclamation",
  "fa-solid fa-cloud-bolt",
  "fa-solid fa-droplet",
  "fa-solid fa-wind",
  "fa-solid fa-snowflake",
  "fa-solid fa-radiation",
  "fa-solid fa-biohazard",
  "fa-solid fa-eye",
  "fa-solid fa-eye-slash",
  "fa-solid fa-hourglass-half",
  "fa-solid fa-clock",
  "fa-solid fa-stopwatch",
  "fa-solid fa-gears",
  "fa-solid fa-shield-halved",
  "fa-solid fa-crosshairs",
  "fa-solid fa-person-rays",
  "fa-solid fa-spider",
  "fa-solid fa-dragon",
  "fa-solid fa-ghost",
  "fa-solid fa-user-clock",
  "fa-solid fa-masks-theater",
  "fa-solid fa-circle-nodes",
  "fa-solid fa-circle-radiation",
  "fa-solid fa-location-crosshairs",
  "fa-solid fa-dungeon",
  "fa-solid fa-land-mine-on",
  "fa-solid fa-volcano",
  "fa-solid fa-mountain-sun",
  "fa-solid fa-water",
  "fa-solid fa-cloud-showers-heavy",
  "fa-solid fa-wand-sparkles",
  "fa-solid fa-hand-sparkles",
  "fa-solid fa-book-skull",
  "fa-solid fa-flask-vial",
  "fa-solid fa-circle-question",
  "fa-solid fa-star-of-life"
]);

export const COMBATANT_RENDER_UPDATE_KEYS = new Set([
  "actorId",
  "defeated",
  "flags",
  "hidden",
  "img",
  "initiative",
  "name",
  "sceneId",
  "sort",
  "token",
  "tokenId"
]);
export const ACTOR_RENDER_UPDATE_KEYS = new Set(["flags", "img", "items", "name", "prototypeToken", "system"]);

export const FALLBACK_PORTRAIT = "icons/svg/mystery-man.svg";
export const PORTRAIT_MIN_PIXELS = Object.freeze({
  normalHeight: 58,
  activeHeight: 166
});
export const CONFIGURABLE_ACTOR_TYPES = new Set(["character", "npc", "pc"]);
export const PORTRAIT_FRAME_DEFAULTS = Object.freeze({
  normal: Object.freeze({ x: 54, y: 24, scale: 1.06 }),
  expanded: Object.freeze({ x: 55, y: 12, scale: 1.2 })
});
export const PORTRAIT_FRAME_LIMITS = Object.freeze({
  // Position is intentionally free-form: the range runs well past the portrait's
  // own edges so a frame can be pushed fully out of view in any direction.
  x: Object.freeze({ min: -200, max: 300 }),
  y: Object.freeze({ min: -200, max: 300 }),
  scale: Object.freeze({ min: 0.25, max: 6 })
});
