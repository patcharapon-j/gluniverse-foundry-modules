import { MODULE_ID, SOCKET_NAME, SETTINGS, TOKEN_OVERLAY_PALETTE, DISPOSITION_PALETTE, 
getDispositionColors, FLAGS, INITIATIVE_MODE, CARD_CONFIG_DEFAULTS, CARD_CONFIG_LIMITS, 
BREAK_GAUGE_DEFAULT_MAX, BREAK_GAUGE_MODES, BREAK_GAUGE_FLASH_SEC, BREAK_GAUGE_SHEEN_SEC, 
VISIBILITY, PF2E_GUARD_BREAK_EFFECT_SLUG, PF2E_GUARD_BREAK_PENALTY, APEX, LOCALIZATION_FALLBACKS,
ADHOC_DEFAULT_TYPE, ADHOC_TYPES, ADHOC_VISIBILITY_MODES, ADHOC_LIFECYCLE, 
ADHOC_LIFECYCLE_MODES, STATUS_ANIMATION, ADHOC_ICON_CHOICES, COMBATANT_RENDER_UPDATE_KEYS, 
ACTOR_RENDER_UPDATE_KEYS, FALLBACK_PORTRAIT, PORTRAIT_MIN_PIXELS, CONFIGURABLE_ACTOR_TYPES, 
PORTRAIT_FRAME_DEFAULTS, PORTRAIT_FRAME_LIMITS } from "./constants.mjs";
import { normalizeInitiativeNumber, getDisposition, formatRound, formatInitiative, 
localize, formatLocalized, modulo, clamp, wait, escapeHTML, escapeAttr, escapeCSSIdentifier 
} from "./util.mjs";

// System-aware condition / dying / guard-break / break-gauge state readers
// and their small HTML render helpers (PF2e + D&D5e aware, system-agnostic
// fallbacks). Pure data + markup; no overlay/runtime singletons.

export function getPF2eDyingState(combatant) {
  if (game.system?.id !== "pf2e") return null;

  const actor = combatant?.actor;
  if (!actor || actor.type !== "character") return null;

  const dyingValue = getActorAttributeValue(actor, "dying") ?? getConditionValue(actor, "dying");
  const value = Math.max(0, Math.round(Number(dyingValue) || 0));
  if (value <= 0) return null;

  const doomed = Math.max(0, Math.round(Number(getActorAttributeValue(actor, "doomed") ?? getConditionValue(actor, "doomed") ?? 0) || 0));
  const rawMax = getActorAttributeValue(actor, "dying", "max");
  const hasDiehard = hasActorItem(actor, "diehard");
  const baseMax = Number.isFinite(rawMax) ? rawMax : hasDiehard ? 5 : 4;
  const max = clamp(Math.max(1, Math.round(baseMax - doomed)), 1, 9);
  const ratio = clamp(value / max, 0, 1.5);
  const severity = ratio >= 1 ? "critical" : ratio >= 0.67 ? "high" : "low";

  return { kind: "dying", value, max, doomed, hasDiehard, severity };
}

// D&D 5e death-save state, parallel to getPF2eDyingState. Triggers when a
// character-type actor is at 0 HP (downed), reading the two opposed death-save
// counters (system.attributes.death.success/failure, each capped at 3 by the
// rules). `value`/`max` mirror the PF2e shape (failures = proximity to death)
// so token label/repeat code that reads them keeps working; render code that
// wants both rows branches on `kind === "deathsaves"`.
export function getDnd5eDeathState(combatant) {
  if (game.system?.id !== "dnd5e") return null;

  const actor = combatant?.actor;
  if (!actor || actor.type !== "character") return null;

  // HP is a nullable field in 5e (initial null); `null <= 0` is true in JS, so
  // require a finite number before treating the actor as downed.
  const hp = Number(actor.system?.attributes?.hp?.value);
  if (!Number.isFinite(hp) || hp > 0) return null;

  const death = actor.system?.attributes?.death ?? {};
  const successes = clamp(Math.round(Number(death.success) || 0), 0, 3);
  const failures = clamp(Math.round(Number(death.failure) || 0), 0, 3);
  // No persisted `stable` field exists in 5e; 3 successes is the only signal.
  const stable = successes >= 3 && failures < 3;
  const ratio = failures / 3;
  const severity = stable ? "stable" : ratio >= 1 ? "critical" : ratio >= 0.67 ? "high" : "low";

  return { kind: "deathsaves", value: failures, max: 3, successes, failures, stable, severity };
}

// System dispatcher for the per-combatant dying/death-save view-model. Returns
// the PF2e dying object, the 5e death-save object, or null. Each underlying
// function self-gates by system id, so only one ever returns non-null.
export function getDyingState(combatant) {
  return getPF2eDyingState(combatant) ?? getDnd5eDeathState(combatant);
}

export function getActorAttributeValue(actor, attribute, property = "value") {
  const direct = actor?.system?.attributes?.[attribute]?.[property];
  if (Number.isFinite(Number(direct))) return Number(direct);

  const nested = actor?.system?.attributes?.[attribute]?.[property]?.value;
  if (Number.isFinite(Number(nested))) return Number(nested);

  return null;
}

export function getConditionValue(actor, slug) {
  const condition = getActorItems(actor).find(item => item?.type === "condition" && getItemSlug(item) === slug);
  if (!condition) return null;

  const candidates = [
    condition.system?.value?.value,
    condition.system?.badge?.value,
    condition.system?.value,
    condition.value
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }

  return 1;
}

export function hasActorItem(actor, slug) {
  return getActorItems(actor).some(item => getItemSlug(item) === slug);
}

// Condition slugs the overlay already represents through dedicated states, so
// they must never surface through the generic condition announce/background.
export const COVERED_CONDITION_SLUGS = new Set(["dying", "doomed"]);

// A "primary" condition is one applied directly to the actor: it is active (not
// suppressed by a higher-value duplicate) and is not a linked child of another
// condition (PF2e records the originating condition under
// `system.references.parent`). Nested/linked conditions are skipped so only the
// source condition announces and appears in the background.
export function isPrimaryCondition(item) {
  if (item?.active === false) return false;
  const references = item?.system?.references ?? {};
  if (references.parent && (references.parent.id || typeof references.parent === "string")) return false;
  const overriddenBy = references.overriddenBy;
  if (Array.isArray(overriddenBy) ? overriddenBy.length : overriddenBy) return false;
  return true;
}

// Numeric badge for valued conditions (e.g. frightened 2). Valueless conditions
// (prone, blinded) carry `value: null` / `isValued: false` and return null —
// `Number(null)` is 0, so a naive read would mislabel them "PRONE 0".
export function getConditionBadgeValue(item) {
  const valued = item?.system?.value;
  if (valued && typeof valued === "object") {
    if (valued.isValued === false) return null;
    if (valued.value === null || valued.value === undefined) return null;
    const value = Number(valued.value);
    return Number.isFinite(value) ? value : null;
  }
  const badge = Number(item?.system?.badge?.value);
  return Number.isFinite(badge) ? badge : null;
}

// Per-item keys the GM has hidden on this combatant's card only (a module flag —
// the underlying condition item on the actor/token is never touched).
export function getHiddenConditionKeys(combatant) {
  const raw = combatant?.getFlag?.(MODULE_ID, FLAGS.hiddenConditions);
  return new Set(Array.isArray(raw) ? raw.map(key => String(key)) : []);
}

// Every primary, temporary PF2e condition on a combatant the overlay does not
// otherwise cover. PF2e models temporary statuses as `condition` items, so
// stances (effects) and class features (feats) are naturally excluded. Each tag
// carries the display `text` reused by the announce flash, the background field,
// and the side labels, plus a unique `key` (the item id) so distinct items that
// share a slug — notably several persistent-damage entries of different types —
// stay individually visible, hideable, and announceable.
export function getPrimaryConditionItems(combatant) {
  if (game.system?.id !== "pf2e") return [];
  const actor = combatant?.actor;
  if (!actor) return [];

  const tags = [];
  for (const item of getActorItems(actor)) {
    if (item?.type !== "condition" || !isPrimaryCondition(item)) continue;
    const slug = getItemSlug(item);
    if (!slug || COVERED_CONDITION_SLUGS.has(slug)) continue;
    const key = String(item.id ?? slug);
    const value = getConditionBadgeValue(item);
    // PF2e bakes the value into a valued condition's name (e.g. "Clumsy 2"), so
    // strip a trailing number before we render our own badge — otherwise the
    // value shows twice ("Clumsy 2" + badge → "Clumsy 2 2").
    const rawName = String(item.name ?? slug).trim();
    const name = value === null ? rawName : rawName.replace(/\s+\d+$/, "");
    const text = value === null ? name.toUpperCase() : `${name.toUpperCase()} ${value}`;
    tags.push({ key, slug, name, value, text });
  }
  return tags;
}

// Statuses the 5e overlay represents through other dedicated states (or that
// read as noise on a card), so they never surface as a generic condition badge.
// `dead` is owned by the defeated treatment; the 0-HP downed state is owned by
// the death-save display (conditions are overridden whenever dying is present).
export const DND5E_COVERED_STATUSES = new Set(["dead"]);

// Maps each active status id to the ActiveEffect that contributes it. A
// custom/non-standard status (a module- or user-authored condition) can surface
// in `actor.statuses` under a random document id rather than a registered
// condition slug; the contributing effect always carries a human-readable name,
// so we keep it on hand to label such statuses instead of rendering the raw id.
function getDnd5eStatusEffects(actor) {
  const map = new Map();
  const effects = actor?.appliedEffects ?? actor?.effects?.contents ?? actor?.effects ?? [];
  if (!effects || typeof effects[Symbol.iterator] !== "function") return map;
  for (const effect of effects) {
    if (!effect || effect.disabled) continue;
    const ids = effect.statuses;
    if (!ids || typeof ids[Symbol.iterator] !== "function") continue;
    for (const raw of ids) {
      const statusId = String(raw);
      if (statusId && !map.has(statusId)) map.set(statusId, effect);
    }
  }
  return map;
}

// Resolve a 5e status id to a display label. Conditions carry a localization key
// under `name` (older builds used `label`); fall back to the matching core
// `CONFIG.statusEffects` entry, then to the contributing ActiveEffect's own
// name, and only then to a title-cased id. The effect-name step keeps a
// custom/non-standard condition (whose status id may be a random document id)
// from rendering as a garbled string in the badge and card background.
function getDnd5eStatusName(id, condition, effect) {
  for (const key of [condition?.name, condition?.label]) {
    if (!key) continue;
    const localized = game.i18n?.localize?.(key);
    if (localized && localized !== key) return localized;
  }
  const status = (CONFIG?.statusEffects ?? []).find(effect => effect?.id === id);
  const statusKey = status?.name ?? status?.label;
  if (statusKey) {
    const localized = game.i18n?.localize?.(statusKey);
    return localized && localized !== statusKey ? localized : statusKey;
  }
  // Reaching here means the id is not a registered condition or status, so it
  // may be a random document id rather than a readable slug. Prefer the
  // contributing effect's own name (`name` is a plain string; older effects may
  // carry a localizable `label`) and only title-case the id as a last resort.
  const effectName = effect?.name ?? effect?.label;
  if (effectName) {
    const localized = game.i18n?.localize?.(effectName);
    return localized && localized !== effectName ? localized : effectName;
  }
  return String(id).replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

// Every active D&D 5e status/condition on a combatant, mapped to the shared tag
// shape used by the PF2e path. 5e models conditions as ActiveEffects aggregated
// on `actor.statuses` (a Set of status ids); exhaustion is valued and carries
// its level in `system.attributes.exhaustion`. Statuses implied by another
// active condition (e.g. `incapacitated` granted by `paralyzed`/`unconscious`)
// are dropped so only the source condition shows — mirroring the PF2e
// "skip linked children" behaviour. The status id doubles as the stable `key`
// so the GM hide toggle and announce de-dup keep working.
export function getDnd5eConditionItems(combatant) {
  if (game.system?.id !== "dnd5e") return [];
  const actor = combatant?.actor;
  if (!actor) return [];

  const statuses = actor.statuses;
  if (!statuses || typeof statuses[Symbol.iterator] !== "function") return [];
  const active = Array.from(statuses).map(id => String(id)).filter(Boolean);
  if (!active.length) return [];

  const conditionTypes = CONFIG?.DND5E?.conditionTypes ?? {};
  // Effect lookup so custom/non-standard statuses can borrow a readable name.
  const statusEffects = getDnd5eStatusEffects(actor);

  // Statuses granted as a side-effect of another active condition.
  const implied = new Set();
  for (const id of active) {
    const sub = conditionTypes[id]?.statuses;
    if (Array.isArray(sub)) for (const child of sub) implied.add(String(child));
  }

  const tags = [];
  for (const id of active) {
    if (DND5E_COVERED_STATUSES.has(id) || implied.has(id)) continue;
    const name = getDnd5eStatusName(id, conditionTypes[id], statusEffects.get(id));
    if (!name) continue;
    let value = null;
    if (id === "exhaustion") {
      const level = Math.round(Number(actor.system?.attributes?.exhaustion) || 0);
      value = level > 0 ? level : null;
    }
    const text = value === null ? name.toUpperCase() : `${name.toUpperCase()} ${value}`;
    tags.push({ key: id, slug: id, name, value, text });
  }
  // Stable alphabetical order so Set iteration drift never reshuffles badges.
  tags.sort((a, b) => a.name.localeCompare(b.name));
  return tags;
}

// System dispatcher for the full primary condition set (ignoring the GM per-card
// hide toggle). Each underlying reader self-gates by system id and returns the
// shared tag shape; unsupported systems get an empty list.
export function getPrimaryConditionTags(combatant) {
  if (game.system?.id === "pf2e") return getPrimaryConditionItems(combatant);
  if (game.system?.id === "dnd5e") return getDnd5eConditionItems(combatant);
  return [];
}

// Display set — primary conditions minus any the GM hid on this card. Returns
// null when there is nothing to show so callers can branch cheaply.
export function getConditionTags(combatant) {
  const hidden = getHiddenConditionKeys(combatant);
  const tags = getPrimaryConditionTags(combatant).filter(tag => !hidden.has(tag.key));
  return tags.length ? tags : null;
}

export function renderConditionRepeatText(conditions) {
  const text = conditions.map(condition => condition.text).join("  •  ");
  const line = Array.from({ length: 4 }, () => `<span>${escapeHTML(text)}</span>`).join("");
  return Array.from({ length: 4 }, (_, index) => `
    <div class="gluni-card-condition-repeat-line${index % 2 ? " gluni-card-condition-repeat-line--alt" : ""}">
      ${line}
    </div>
  `).join("");
}

// PF2e exposes no positive/negative flag on conditions; tone is "neutral" for
// now (single colour) but kept as a hook so a future classifier can colour the
// labels without touching the markup.
export function getConditionTone() {
  return "neutral";
}

// Small per-condition chips anchored to the card's outer side (opposite the
// floating turn controls). Long names are clipped with an ellipsis and the full
// text is preserved in the title attribute.
export function renderConditionLabels(conditions) {
  return conditions.map(condition => {
    const tone = getConditionTone(condition);
    const display = condition.value === null
      ? escapeHTML(condition.name)
      : `${escapeHTML(condition.name)}<b>${escapeHTML(String(condition.value))}</b>`;
    return `<span class="gluni-card-condition-label gluni-card-condition-label--${tone}" title="${escapeAttr(condition.text)}">${display}</span>`;
  }).join("");
}

export function findPF2eGuardBreakEffects(actor) {
  return getActorItems(actor).filter(item =>
    item?.type === "effect" &&
    (item.getFlag?.(MODULE_ID, "init.guardBreak") === true || getItemSlug(item) === PF2E_GUARD_BREAK_EFFECT_SLUG)
  );
}

export function getActorItems(actor) {
  const items = actor?.items?.contents ?? actor?.items ?? [];
  return Array.from(items)
    .map(entry => Array.isArray(entry) ? entry[1] : entry)
    .filter(Boolean);
}

export function getItemSlug(item) {
  return String(item?.slug ?? item?.system?.slug ?? item?.flags?.core?.sourceId ?? item?.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/^.*\./, "")
    .replace(/\s+/g, "-");
}

export function renderDyingRepeatText(dying) {
  const text = `${localize("GLUNI.Dying.Label").toUpperCase()} ${dying.value}`;
  const line = Array.from({ length: 5 }, () => `<span>${escapeHTML(text)}</span>`).join("");
  return Array.from({ length: 6 }, (_, index) => `
    <div class="gluni-card-dying-repeat-line${index % 2 ? " gluni-card-dying-repeat-line--alt" : ""}">
      ${line}
    </div>
  `).join("");
}

export function renderGuardBreakRepeatText() {
  const text = localize("GLUNI.GuardBreak").toUpperCase();
  const line = Array.from({ length: 6 }, () => `<span>${escapeHTML(text)}</span>`).join("");
  return Array.from({ length: 5 }, (_, index) => `
    <div class="gluni-card-guard-break-repeat-line${index % 2 ? " gluni-card-guard-break-repeat-line--alt" : ""}">
      ${line}
    </div>
  `).join("");
}

export function getGuardBreakState(combatant) {
  const value = combatant?.getFlag?.(MODULE_ID, FLAGS.guardBroken);
  if (!value) return null;
  if (typeof value === "object") return value;
  return {};
}

// True only when the optional PF2e-Flatfinder module is installed and active, so
// the whole Apex integration self-gates to zero cost when it isn't present.
export function isFlatfinderActive() {
  return Boolean(game.system?.id === "pf2e" && game.modules?.get?.(APEX.MODULE_ID)?.active);
}

// Hybrid Apex actor check: prefer Flatfinder's own API (the stable contract) and
// fall back to reading the actor flag it sets. Either confirms a solo-boss actor.
function isApexActor(actor) {
  if (!actor) return false;
  const api = game.modules?.get?.(APEX.MODULE_ID)?.api;
  if (typeof api?.isApexActor === "function") {
    try { return Boolean(api.isApexActor(actor)); } catch { /* fall through to flag */ }
  }
  return Boolean(actor.getFlag?.(APEX.MODULE_ID, APEX.FLAG)?.enabled);
}

// 0..3 HP phase mirroring Flatfinder's phase beats: Phase I (full → 66%),
// Phase II (≤66%, enraged), Phase III (≤33%, desperate). Unknown HP stays Phase I
// so a creature with no readable pool never reads as "desperate".
function getApexPhase(actor) {
  const hp = actor?.system?.attributes?.hp;
  const value = Number(hp?.value);
  const max = Number(hp?.max);
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return { phase: 1, ratio: 1 };
  const ratio = clamp(value / max, 0, 1);
  const [t2, t3] = APEX.PHASE_THRESHOLDS;
  const phase = ratio <= t3 ? 3 : ratio <= t2 ? 2 : 1;
  return { phase, ratio };
}

// Per-combatant Apex (solo boss) view-model, or null. Reads Flatfinder's flags
// without ever writing them. `role` is "prime" (the showpiece turn) or "reprise"
// (one of the boss's extra turns, carrying its 1-based ordinal). Callers suppress
// this for mystery/defeated cards so a hidden boss never leaks its phase/HP.
export function getApexState(combatant) {
  if (!isFlatfinderActive()) return null;

  const extra = combatant?.getFlag?.(APEX.MODULE_ID, APEX.EXTRA_FLAG);
  const prime = combatant?.getFlag?.(APEX.MODULE_ID, APEX.PRIME_FLAG);
  const actor = combatant?.actor;
  const apexActor = isApexActor(actor);

  // An extra turn is one Flatfinder inserted for an already-apex boss; a prime is
  // the boss's primary turn. Require apex confirmation (flag/API) so a stray flag
  // on a non-apex combatant can never style a normal creature.
  if (extra && typeof extra === "object" && apexActor) {
    const total = Math.max(2, Math.round(Number(extra.total) || 0));
    const index = clamp(Math.round(Number(extra.index) || 1), 1, total);
    const { phase, ratio } = getApexPhase(actor);
    return { role: "reprise", index, total, phase, hpRatio: ratio };
  }
  if (apexActor || prime === true) {
    const { phase, ratio } = getApexPhase(actor);
    return { role: "prime", index: 1, total: 1, phase, hpRatio: ratio };
  }
  return null;
}

// Returns every Combatant that belongs to the same Apex boss as `combatant` —
// the prime turn plus all of Flatfinder's reprise/extra turns — as an ordered
// array (prime first, then extras by ascending ordinal), or null when the
// combatant is not part of an Apex group. The group is resolved through the
// prime's id (the extras carry it on their `apexExtra.primeId` flag), so a
// guard break can sweep the whole boss out of the round rather than only the
// single turn that was struck.
export function getApexGroupCombatants(combat, combatant) {
  if (!isFlatfinderActive() || !combat || !combatant) return null;
  if (!getApexState(combatant)) return null;

  // The prime's combatant id keys the group: it is the boss's own id when this
  // is the prime turn, otherwise the primeId stamped onto the extra's flag.
  const extra = combatant.getFlag?.(APEX.MODULE_ID, APEX.EXTRA_FLAG);
  const primeId = (extra && typeof extra === "object" && extra.primeId) || combatant.id;

  const all = Array.from(combat.combatants ?? [])
    .map(entry => Array.isArray(entry) ? entry[1] : entry)
    .filter(Boolean);

  const ordinalOf = member => {
    if (member.id === primeId) return 0;
    const ex = member.getFlag?.(APEX.MODULE_ID, APEX.EXTRA_FLAG);
    const index = Math.round(Number(ex?.index));
    return Number.isFinite(index) && index > 0 ? index : Number.MAX_SAFE_INTEGER;
  };

  const members = all.filter(member => {
    if (member.id === primeId) return true;
    const ex = member.getFlag?.(APEX.MODULE_ID, APEX.EXTRA_FLAG);
    return Boolean(ex && typeof ex === "object" && ex.primeId === primeId);
  });

  if (members.length === 0) return null;
  members.sort((a, b) => ordinalOf(a) - ordinalOf(b));
  return members;
}

// Normalizes the stored break-gauge flag into { max, value, mode, ratio } or
// null when the combatant is not marked. Max is clamped to >= 1 and value to
// the [0, max] range so render/draw code can trust the numbers.
export function getBreakGaugeState(combatant) {
  const raw = combatant?.getFlag?.(MODULE_ID, FLAGS.breakGauge);
  if (!raw || typeof raw !== "object") return null;
  const max = Math.max(1, Math.round(Number(raw.max) || 0));
  if (!Number.isFinite(max)) return null;
  const value = clamp(Math.round(Number(raw.value) || 0), 0, max);
  const mode = raw.mode === BREAK_GAUGE_MODES.segmented ? BREAK_GAUGE_MODES.segmented : BREAK_GAUGE_MODES.smooth;
  return { max, value, mode, ratio: max > 0 ? value / max : 0 };
}

export function renderBreakGaugeBar(gauge) {
  if (!gauge) return "";
  const { max, value, mode, ratio } = gauge;
  const label = formatLocalized("GLUNI.BreakGauge.Aria", { value, max });
  const broken = value <= 0;
  const valueTag = `<span class="gluni-break-gauge-value">${value}<small>/${max}</small></span>`;
  let track;
  if (mode === BREAK_GAUGE_MODES.segmented) {
    const pips = Array.from({ length: max }, (_unused, index) =>
      `<span class="gluni-break-gauge-seg${index < value ? " gluni-break-gauge-seg--on" : ""}" aria-hidden="true"></span>`
    ).join("");
    track = `<div class="gluni-break-gauge-track gluni-break-gauge-track--seg" data-ratio="${ratio.toFixed(4)}">
        <div class="gluni-break-gauge-segs">${pips}</div>
        ${valueTag}
      </div>`;
  } else {
    const pct = clamp(ratio * 100, 0, 100);
    track = `
      <div class="gluni-break-gauge-track gluni-break-gauge-bar" data-ratio="${ratio.toFixed(4)}">
        <div class="gluni-break-gauge-fill" style="width:${pct.toFixed(2)}%"></div>
        <div class="gluni-break-gauge-sheen" aria-hidden="true"></div>
        ${valueTag}
      </div>
    `;
  }
  return `
    <div class="gluni-break-gauge${broken ? " gluni-break-gauge--empty" : ""}" role="img" aria-label="${escapeAttr(label)}">
      <span class="gluni-break-gauge-tag">${escapeHTML(localize("GLUNI.BreakGauge.Label").toUpperCase())}</span>
      ${track}
    </div>
  `;
}


export function renderDyingPips(dying) {
  const max = clamp(Math.round(Number(dying.max) || 4), 1, 9);
  const value = clamp(Math.round(Number(dying.value) || 0), 0, max);
  const label = formatLocalized("GLUNI.Dying.Aria", { value, max });
  const pips = Array.from({ length: max }, (_unused, index) => {
    const filled = index < value;
    return `<span class="gluni-dying-pip${filled ? " gluni-dying-pip--filled" : ""}" aria-hidden="true"></span>`;
  }).join("");

  return `<div class="gluni-dying-pips" role="img" aria-label="${escapeAttr(label)}">${pips}</div>`;
}

// Two-row pip readout for 5e death saves: a calming successes row and an
// escalating failures row, each three pips wide.
export function renderDeathSavePips(state) {
  const successes = clamp(Math.round(Number(state.successes) || 0), 0, 3);
  const failures = clamp(Math.round(Number(state.failures) || 0), 0, 3);
  const row = (kind, value, ariaKey) => {
    const label = formatLocalized(ariaKey, { value, max: 3 });
    const pips = Array.from({ length: 3 }, (_unused, index) => {
      const filled = index < value;
      return `<span class="gluni-deathsave-pip gluni-deathsave-pip--${kind}${filled ? " gluni-deathsave-pip--filled" : ""}" aria-hidden="true"></span>`;
    }).join("");
    return `<div class="gluni-deathsave-row gluni-deathsave-row--${kind}" role="img" aria-label="${escapeAttr(label)}">${pips}</div>`;
  };
  return `<div class="gluni-deathsave-pips">
    ${row("success", successes, "GLUNI.DeathSaves.Success.Aria")}
    ${row("failure", failures, "GLUNI.DeathSaves.Failure.Aria")}
  </div>`;
}

export function renderDeathSaveRepeatText(state) {
  const text = (state.stable ? localize("GLUNI.DeathSaves.Stable") : localize("GLUNI.DeathSaves.Label")).toUpperCase();
  const line = Array.from({ length: 5 }, () => `<span>${escapeHTML(text)}</span>`).join("");
  return Array.from({ length: 6 }, (_, index) => `
    <div class="gluni-card-dying-repeat-line${index % 2 ? " gluni-card-dying-repeat-line--alt" : ""}">
      ${line}
    </div>
  `).join("");
}

