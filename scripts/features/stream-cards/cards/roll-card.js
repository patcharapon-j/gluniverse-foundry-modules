import { remove } from "../../stream/motion/engine.js";
import { crackRenderer } from "../fx/crack-renderer.js";
import { isFocus, placement } from "../framing/focus-math.js";
import { quoteSize } from "../text/read-text.js";
import {
  CSS_UNFOLD,
  EASE_EXIT,
  EASE_OUT,
  EASE_POP,
  EASE_SNAP,
  PLATE_CLIP,
  PLATE_CLIP_FOLDED,
  countUp,
  el,
  sideOf,
  timing,
  tween,
  waapi,
  wait,
  collapse
} from "./card-motion.js";

/**
 * The stream's roll card.
 *
 * It renders a RollCardModel (see docs/plans/pf2e-roll-card.md) and owns its own motion: the entrance, the
 * outcome reveal, the crit climax, in-place updates for rerolls and spell chains, the merged damage row and
 * the exit. It never reads Foundry documents; a system's reader builds the model — PF2e's
 * (`pf2e/read-message.js`) or Daggerheart's (`daggerheart/read-message.js`), whose extra fields (the
 * duality die, an outcome named by key, chips, a feature's price) are all optional, so a PF2e model draws
 * exactly as it always did.
 *
 * The look is the stream view's black skin (docs/adr/0007-stream-view-skin.md): a chamfered slab, paper
 * type, and one tone carried by a solid verdict tag and a rule along the top edge. Its motion is fade,
 * rise and unfold, with no text decode, scan line or light sweep. Only the crit crack is effect, and it is
 * shared with core.
 *
 * The card always animates. It deliberately ignores reduced-motion preferences: it only renders on the
 * stream client, and its motion is the point of it. Every length comes from CARD_MOTION.
 *
 * Most motion runs on the module's anime.js engine. The Web Animations API is used only where anime.js
 * cannot help: clip-path shapes with calc() (the strip unfold, the damage row drop) and the result
 * divider's ::before pseudo-element.
 */

/*
 * The strip unfolds downwards inside its own slab. Both shapes are the slab's own polygon
 * (`PLATE_CLIP`, the one `.glus-rc-main` is clipped to in stream-cards.css), so the chamfer is there for
 * the whole entrance and the card does not change shape when the clip is cleared.
 */
const STRIP_CLIP = PLATE_CLIP;
const STRIP_CLIP_FOLDED = PLATE_CLIP_FOLDED;

const DEGREE_TONES = ["crit-failure", "failure", "success", "crit-success"];
const DEGREE_LABEL_KEYS = ["CritFailure", "Failure", "Success", "CritSuccess"];

/** PF2e's damage type to Font Awesome icon map, used when CONFIG.PF2E is not available. */
const FALLBACK_DAMAGE_ICONS = {
  bleed: "droplet",
  acid: "vial",
  bludgeoning: "hammer",
  cold: "snowflake",
  electricity: "bolt",
  fire: "fire",
  force: "sparkles",
  mental: "brain",
  piercing: "bow-arrow",
  poison: "spider",
  slashing: "axe",
  sonic: "waveform-lines",
  spirit: "ghost",
  vitality: "sun",
  void: "skull"
};

const DEFAULT_LABELS = {
  CritSuccess: "Critical Success",
  Success: "Success",
  Failure: "Failure",
  CritFailure: "Critical Failure",
  NPC: "NPC",
  Blind: "Blind",
  Reroll: "Reroll",
  Damage: "Damage",
  CritDouble: "Crit ×2",
  DC: "DC",
  // Fallbacks for a check whose chat flavor carries no heading to read — an inline @Check link, a flat
  // check off a condition card. The reader hands over a key, never PF2e's raw context type, or the
  // stream's headline reads "flat-check".
  AttackRoll: "Attack",
  SkillCheck: "Skill Check",
  SavingThrow: "Saving Throw",
  PerceptionCheck: "Perception",
  FlatCheck: "Flat Check",
  Initiative: "Initiative",
  CounteractCheck: "Counteract",
  Check: "Check",
  SpellAttack: "Spell attack",
  Versus: "vs",
  CastsSpell: "Casts a spell",
  // A plain roll and a line somebody typed. The reader hands over a key for each, never the raw
  // chat style, for the same reason a check with no heading does.
  PlainRoll: "Roll",
  Says: "Says",
  Emotes: "Emotes",
  OutOfCharacter: "Out of character",
  // Roleplay Chat lines (see stream-cards/text/read-text.js), and the name a hidden speaker shows.
  Does: "Does",
  Thinks: "Thinks",
  Narration: "Narration",
  Unknown: "Unknown",
  // Daggerheart (see stream-cards/daggerheart/read-message.js): the duality outcome, the GM's d20, a
  // posted feature and its price, the GM's Fear chip and a critical's damage.
  WithHope: "With Hope",
  WithFear: "With Fear",
  Critical: "Critical",
  Hit: "Hit",
  Miss: "Miss",
  Evasion: "Evasion",
  Adversary: "Adversary",
  Environment: "Environment",
  PlusFear: "+1 Fear",
  UsesFeature: "Uses a feature",
  Spend: "Spend",
  Mark: "Mark",
  Hope: "Hope",
  Fear: "Fear",
  Stress: "Stress",
  ArmorSlot: "Armor Slot",
  ArmorSlots: "Armor Slots",
  HitPoint: "Hit Point",
  HitPoints: "Hit Points",
  CritMax: "Critical",
  DualityRoll: "Duality Roll",
  ReactionRoll: "Reaction Roll",
  UsesAction: "Takes an action",
  Action: "Action",
  Actions: "Actions",
  Reaction: "Reaction",
  FreeAction: "Free action",
  Cantrip: "Cantrip",
  Rank: "Rank",
  Basic: "Basic",
  fortitude: "Fortitude",
  reflex: "Reflex",
  will: "Will",
  arcane: "Arcane",
  divine: "Divine",
  occult: "Occult",
  primal: "Primal"
};

const D20_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <polygon class="glus-rc-die-edge" points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5"/>
  <polygon class="glus-rc-die-facet" points="50,24 77,70 23,70"/>
  <path class="glus-rc-die-facet" d="M50 3L50 24M91 26.5L77 70M91 73.5L77 70M50 97L77 70M50 97L23 70M9 73.5L23 70M9 26.5L23 70M9 26.5L50 24M91 26.5L50 24"/>
</svg>`;

/**
 * The Daggerheart duality die: one die's footprint split down the middle, Hope on the left and Fear on
 * the right. `data-out` on the die lights the half that won (both on a critical, neither on a reaction).
 */
const DUALITY_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <polygon class="glus-rc-dd-half" data-side="hope" points="50,3 9,26.5 9,73.5 50,97"/>
  <polygon class="glus-rc-dd-half" data-side="fear" points="50,3 91,26.5 91,73.5 50,97"/>
  <polygon class="glus-rc-die-edge glus-rc-dd-edge" points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5"/>
  <path class="glus-rc-dd-split" d="M50 3L50 97"/>
</svg>`;

/** A die's notation ("d12", "d20") to its face count, for the spin; anything unreadable is a d12. */
function facesOf(notation) {
  const n = Math.floor(Number(String(notation ?? "").replace(/^d/i, "")));
  return Number.isFinite(n) && n > 1 ? n : 12;
}

function damageIcon(type) {
  const configured = globalThis.CONFIG?.PF2E?.damageTypes?.[type];
  const fromConfig = typeof configured === "object" ? configured?.icon : null;
  if (typeof fromConfig === "string" && fromConfig) return fromConfig.replace(/^fa-/, "");
  return FALLBACK_DAMAGE_ICONS[type] ?? null;
}

function toneFor(model) {
  // A reader that decided the tone itself (a Roleplay Chat line) is taken at its word.
  if (typeof model.tone === "string" && model.tone) return model.tone;
  if (model.kind === "cast" && model.spell && !model.roll) return model.spell.tradition || "none";
  const degree = model.roll?.degree;
  return Number.isInteger(degree) ? DEGREE_TONES[degree] ?? "none" : "none";
}

export class RollCard {
  /**
   * @param {object} model    RollCardModel from the PF2e reader.
   * @param {object} [options]
   * @param {(key: string) => string} [options.label]  Localises a label key; defaults to English.
   * @param {{peek: Function, request: Function}} [options.framer]  Finds where to frame the art.
   */
  constructor(model, { label, framer } = {}) {
    this.label = (key) => label?.(key) ?? DEFAULT_LABELS[key] ?? key;
    this.framer = framer ?? null;
    this.model = model;
    this.pending = false;
    this.version = 0;
    /** Bumped by every `setChips`, so an update can tell a claim landed while it was fading. */
    this.chipStamp = 0;
    this.destroyed = false;
    this.crack = null;
    this.damageCrack = null;
    this.element = this.buildShell();
    this.render(model);
  }

  buildShell() {
    const root = el("div", "glus-rc");
    const main = el("div", "glus-rc-main");
    const frame = el("div", "glus-rc-art-frame");
    const art = el("img", "glus-rc-art");
    art.alt = "";
    art.decoding = "async";
    frame.append(art);
    const text = el("div", "glus-rc-text");
    text.append(el("div", "glus-rc-player"), el("div", "glus-rc-name"), el("div", "glus-rc-action"));
    main.append(
      frame,
      el("span", "glus-rc-monogram"),
      el("span", "glus-rc-spacer"),
      text,
      el("div", "glus-rc-result"),
      el("canvas", "glus-rc-fx"),
      el("div", "glus-rc-glow"),
      el("div", "glus-rc-hair")
    );
    root.append(main);
    this.main = main;
    return root;
  }

  q(selector) {
    return this.element.querySelector(selector);
  }

  /** Pixels per design unit (1% of a 1920px frame at the current card scale). */
  unit() {
    return (this.element.getBoundingClientRect().width || 537.6) / 28;
  }

  setPending(on) {
    this.pending = on;
    this.element.toggleAttribute("data-pending", on);
  }

  render(model) {
    this.model = model;
    const root = this.element;
    root.dataset.kind = model.kind;
    root.dataset.tone = toneFor(model);
    root.toggleAttribute("data-blind", model.visibility === "ownBlind");
    root.toggleAttribute("data-npc", !!model.actor?.isNpc);
    root.toggleAttribute("data-pending", this.pending);

    const art = this.q(".glus-rc-art");
    const img = model.actor?.img;
    if (img && art.getAttribute("src") !== img) art.src = img;
    else if (!img) art.removeAttribute("src");
    this.q(".glus-rc-art-frame").dataset.kind = model.actor?.imgKind === "token" ? "token" : "portrait";
    this.frameArt(img, model.actor?.focus);
    // No usable art (a default NPC icon, a hidden name): a faint initial holds the portrait's place.
    root.toggleAttribute("data-no-art", !img);
    this.q(".glus-rc-monogram").textContent = (model.actor?.name ?? "?").trim().charAt(0).toUpperCase() || "?";

    const player = this.q(".glus-rc-player");
    const reroll = player.querySelector('[data-chip="reroll"]');
    // `badgeKey` is a reader's word for the GM's side ("Adversary"); PF2e hands none and reads "NPC".
    player.replaceChildren(
      el("span", "glus-rc-player-name", model.actor?.isNpc ? `◆ ${this.label(model.badgeKey ?? "NPC")}` : model.player?.name ?? "")
    );
    if (model.visibility === "ownBlind") {
      const chip = el("span", "glus-rc-chip", this.label("Blind"));
      chip.dataset.chip = "blind";
      player.append(chip);
    }
    for (const chip of model.chips ?? []) player.append(this.buildChip(chip));
    if (reroll) player.append(reroll);

    // A hidden name stays hidden: the reader hands over a label key ("Unknown") and never the name.
    this.q(".glus-rc-name").textContent = model.actor?.name ?? (model.actor?.nameKey ? this.label(model.actor.nameKey) : "");

    const action = this.q(".glus-rc-action");
    const isCast = model.kind === "cast" && model.spell && !model.roll;
    const isAction = model.kind === "action";
    const isText = model.kind === "text";
    const isPlainRoll = model.kind === "roll";
    const actionLabel = isCast
      ? this.label("CastsSpell")
      : isAction
        ? this.label(model.action?.verbKey ?? "UsesAction")
        : this.checkLabel(model.action);
    const actionSub = isCast ? this.castDetail(model.spell) : model.action?.sub;
    const sub = [actionSub, model.target?.name ? `${this.label("Versus")} ${model.target.name}` : null]
      .filter(Boolean)
      .join(" · ");
    action.replaceChildren(el("span", "glus-rc-action-label", actionLabel));
    if (sub) action.append(document.createTextNode(` · ${sub}`));
    if (model.action?.map) action.append(el("span", "glus-rc-map", model.action.map));

    const result = this.q(".glus-rc-result");
    result.replaceChildren();
    if (isText) {
      result.append(this.buildQuote(model.text));
    } else if (isCast) {
      result.append(this.buildSpell(model.spell));
    } else if (isAction) {
      result.append(this.buildAction(model.action));
    } else if (model.roll) {
      const degree = isPlainRoll ? this.buildFormula(model.roll) : this.buildDegree(model.roll);
      if (degree) result.append(degree);
      if (model.duality) result.append(this.buildDuality(model.duality));
      else if (Number.isFinite(model.roll.natural)) result.append(this.buildDie(model.roll.natural));
      result.append(el("div", "glus-rc-total", "0"));
    } else if (model.damage) {
      // A damage roll with no attack card to merge into: the damage total is the headline.
      const degree = el("div", "glus-rc-degree");
      degree.append(el("span", "glus-rc-degree-label", model.damage.crit ? this.label(model.damage.critKey ?? "CritDouble") : this.label("Damage")));
      const meta = el("span", "glus-rc-degree-meta");
      meta.textContent = (model.damage.parts ?? []).map((p) => `${p.amount} ${p.label ?? p.type}`).join(" · ");
      degree.append(meta);
      result.append(degree, el("div", "glus-rc-total", "0"));
      if (model.damage.crit) root.dataset.tone = "crit-success";
    }
    // No outcome box: the result column shrinks to the die and the total, and the padding it was
    // holding for a degree label goes to the identity column. Set as an attribute rather than matched
    // with :has(), which older OBS browser sources lack.
    root.toggleAttribute("data-lean", !result.querySelector(".glus-rc-degree"));
  }

  /**
   * Frames the art: a GM's focus point first, then a detected one. An image not analysed yet shows the
   * default crop and glides to its framing when the analysis lands.
   */
  frameArt(img, manual) {
    this.unwatchArt?.();
    this.unwatchArt = null;
    this.artSrc = img ?? null;
    if (!img) return this.applyFocus(null);
    if (isFocus(manual)) return this.applyFocus(manual);
    const update = (focus) => {
      if (!this.destroyed && this.artSrc === img && !isFocus(this.model.actor?.focus)) this.applyFocus(focus);
    };
    // A fallback framing, cached or not, can be replaced by a late head result.
    this.unwatchArt = this.framer?.watch?.(img, update) ?? null;
    const known = this.framer?.peek(img);
    if (known !== undefined) return this.applyFocus(known);
    this.applyFocus(null);
    this.framer?.request(img).then(update);
  }

  applyFocus(focus) {
    const frame = this.q(".glus-rc-art-frame");
    const art = this.q(".glus-rc-art");
    if (!isFocus(focus)) {
      frame.removeAttribute("data-framed");
      return;
    }
    const { scale, left, top } = placement(focus);
    art.style.setProperty("--glus-rc-art-scale", scale);
    art.style.setProperty("--glus-rc-art-left", left);
    art.style.setProperty("--glus-rc-art-top", top);
    frame.setAttribute("data-framed", "");
  }

  /** The headline for a check: PF2e's own heading if it had one, else the check type's label. */
  checkLabel(action) {
    const text = action?.label?.trim();
    if (text) return text;
    return action?.labelKey ? this.label(action.labelKey) : "";
  }

  /**
   * The outcome box, or null when there is nothing to say.
   *
   * A roll PF2e resolved against no DC has no degree, and the card says *nothing* about it: the
   * standing "Result", "Natural 20" and "Natural 1" labels only restated the number already drawn
   * large on the die beside them, in the widest type on the card, and the room they took came out of
   * the skill, spell, action or target on the left — which is the line a viewer cannot reconstruct
   * from anything else on screen. The natural die keeps its gold and red tint, so a 20 and a 1 still
   * announce themselves.
   */
  buildDegree(roll) {
    // A reader that names its own outcome (Daggerheart's "With Hope", "Hit") is taken at its word; PF2e
    // hands a degree index and the label follows from it.
    const key = roll.outcomeKey ?? (Number.isInteger(roll.degree) ? DEGREE_LABEL_KEYS[roll.degree] : null);
    const hasDc = roll.dcVisible && Number.isFinite(roll.dc);
    if (!key && !hasDc) return null;
    const degree = el("div", "glus-rc-degree");
    if (key) degree.append(el("span", "glus-rc-degree-label", this.label(key)));
    if (hasDc) {
      // "Success · DC 12" — the verdict rides beside the number it was measured against, never without it.
      const prefix = roll.verdictKey ? `${this.label(roll.verdictKey)} · ` : "";
      const meta = el("span", "glus-rc-degree-meta", `${prefix}${this.label(roll.dcKey ?? "DC")}`);
      meta.append(el("b", "glus-rc-big-number", roll.dc));
      degree.append(meta);
    }
    return degree;
  }

  /**
   * A plain roll's box: what was rolled, beside the total it produced.
   *
   * It takes the outcome box's place rather than adding one, so the card keeps its shape. There is no
   * degree in it because PF2e resolved none — the card stays silent about outcome rather than inventing
   * one, exactly as a check made against no DC does.
   */
  buildFormula(roll) {
    if (!roll?.formula) return null;
    const box = el("div", "glus-rc-degree");
    // The formula alone, with no word over it. "Roll" is already the headline on the left when the
    // roll carried no flavour of its own, and a label that restates it costs the column the one thing
    // a viewer cannot reconstruct from the die and the total beside it: the modifier.
    box.append(el("span", "glus-rc-degree-meta", roll.formula));
    return box;
  }

  /**
   * What somebody typed.
   *
   * Set as text, never as HTML: the body is arbitrary markup from any client in the world, and the
   * stream is the one screen in a session nobody is watching. The reader has already flattened it.
   */
  buildQuote(text) {
    const quote = el("div", "glus-rc-quote");
    quote.dataset.style = text?.style ?? "speech";
    quote.dataset.size = quoteSize(text?.body);
    const runs = Array.isArray(text?.runs) ? text.runs : null;
    if (!runs) {
      quote.textContent = text?.body ?? "";
      return quote;
    }
    // A spoken line with `*asides*`: the words stay quoted, each aside sits between the marks.
    for (const run of runs) {
      if (!run.aside) {
        quote.append(document.createTextNode(run.text));
        continue;
      }
      const aside = el("span", "glus-rc-aside");
      aside.textContent = run.text;
      if (run.closes) aside.dataset.closes = "";
      if (run.opens) aside.dataset.opens = "";
      quote.append(aside);
    }
    if (runs[0]?.aside) quote.dataset.open = "aside";
    if (runs[runs.length - 1]?.aside) quote.dataset.close = "aside";
    return quote;
  }

  buildDie(natural) {
    const die = el("span", "glus-rc-die");
    die.innerHTML = D20_SVG;
    die.dataset.natural = natural === 20 ? "max" : natural === 1 ? "min" : "";
    die.append(el("b", "glus-rc-die-value", natural));
    return die;
  }

  /**
   * Daggerheart's two dice in one die's footprint: Hope's face on the left, Fear's on the right. The
   * half that won is lit (`data-out`), both on a critical and neither on a reaction, which throws the
   * duality away. Its numbers are the faces as rolled; the total beside it carries everything else.
   */
  buildDuality(duality) {
    const die = el("span", "glus-rc-die glus-rc-duality");
    die.innerHTML = DUALITY_SVG;
    die.dataset.out = duality.out ?? "none";
    for (const side of ["hope", "fear"]) {
      const value = el("b", "glus-rc-dd-value", duality[side]);
      value.dataset.side = side;
      value.dataset.faces = String(facesOf(duality[`${side}Die`]));
      // Two faces share one die's width: a pair of two-digit faces ("11 11") is set a size smaller.
      value.dataset.digits = String(Math.max(String(duality.hope ?? "").length, String(duality.fear ?? "").length));
      die.append(value);
    }
    return die;
  }

  /** A chip beside the player name ("+1 Fear"): its own word, keyed so an in-place refresh can find it. */
  buildChip(chip) {
    const node = el("span", "glus-rc-chip", this.label(chip.labelKey));
    node.dataset.chip = chip.id;
    return node;
  }

  buildSpell(spell) {
    const box = el("div", "glus-rc-spell");
    box.append(el("span", "glus-rc-spell-name", spell.name ?? ""));
    const line = el("span", "glus-rc-spell-line");
    if (Number.isFinite(spell.dc)) {
      line.append(document.createTextNode(this.label("DC")), el("b", "glus-rc-big-number", spell.dc));
      if (spell.save) {
        const save = this.label(spell.save.statistic);
        line.append(document.createTextNode(`· ${spell.save.basic ? `${this.label("Basic")} ${save}` : save}`));
      }
    } else if (Number.isFinite(spell.attackBonus)) {
      const bonus = spell.attackBonus >= 0 ? `+${spell.attackBonus}` : String(spell.attackBonus);
      line.append(document.createTextNode(this.label("SpellAttack")), el("b", "glus-rc-big-number", bonus));
    }
    box.append(line);
    return box;
  }

  /** An action posted from a sheet: its name large, its cost underneath. */
  buildAction(action) {
    const box = el("div", "glus-rc-spell");
    box.append(el("span", "glus-rc-spell-name", action?.label ?? ""));
    const line = el("span", "glus-rc-spell-line");
    const cost = action?.cost;
    if (Array.isArray(action?.price)) {
      // A Daggerheart feature's price: "Spend 2 Hope · Mark 1 Stress", or nothing when it has none.
      action.price.forEach((part, index) => {
        if (index) line.append(document.createTextNode("·"));
        line.append(document.createTextNode(this.label(part.verbKey)), el("b", "glus-rc-big-number", part.n), document.createTextNode(this.label(part.unitKey)));
      });
    } else if (cost?.type === "reaction") line.textContent = this.label("Reaction");
    else if (cost?.type === "free") line.textContent = this.label("FreeAction");
    else if (Number.isFinite(cost?.value)) {
      line.append(el("b", "glus-rc-big-number", cost.value), document.createTextNode(this.label(cost.value === 1 ? "Action" : "Actions")));
    } else line.textContent = this.label("Action");
    box.append(line);
    return box;
  }

  /** "Cantrip 2 · Divine" or "Rank 3 · Arcane". */
  castDetail(spell) {
    const rank = Number.isFinite(spell.rank) ? `${this.label(spell.isCantrip ? "Cantrip" : "Rank")} ${spell.rank}` : null;
    const tradition = spell.tradition ? this.label(spell.tradition) : null;
    return [rank, tradition].filter(Boolean).join(" · ") || null;
  }

  /** A total the reader withheld (a player's own blind roll) reads "?", never a blank box or "null". */
  headlineValue() {
    const m = this.model;
    if (m.roll) return m.roll.total ?? "?";
    if (m.damage) return m.damage.total ?? "?";
    return null;
  }

  /** Entrance: rule, strip, portrait, identity, die and total; the outcome waits for the total to settle. */
  async enter() {
    const version = ++this.version;
    this.setPending(true);
    const root = this.element;
    const main = this.main;
    const u = this.unit();
    const d = timing(root);
    // In from the edge the stack hugs: a card in a right-hand corner arrives from the right.
    const side = sideOf(root);

    tween(root, { opacity: [0, 1], translateX: [side * 1.2 * u, 0], duration: d("cardIn"), ease: EASE_OUT });
    tween(this.q(".glus-rc-hair"), { scaleX: [0, 1], duration: d("ruleIn"), ease: EASE_SNAP });
    main.style.clipPath = STRIP_CLIP_FOLDED;
    await wait(d("stripDelay"));
    if (!this.alive(version)) return;

    waapi(main, [{ clipPath: STRIP_CLIP_FOLDED }, { clipPath: STRIP_CLIP }], { duration: d("unfold"), easing: CSS_UNFOLD }).then(() => {
      main.style.clipPath = "";
      main.getAnimations?.().forEach((a) => a.cancel());
    });
    tween(this.q(".glus-rc-art-frame"), {
      opacity: [0, 1],
      translateX: ["-8%", "0%"],
      scale: [1.05, 1],
      duration: d("artIn"),
      delay: d("artDelay"),
      ease: EASE_OUT
    });

    // Identity: player, name, then action, each rising into place.
    tween(this.q(".glus-rc-player"), { opacity: [0, 1], translateY: [0.3 * u, 0], duration: d("playerIn"), delay: d("playerDelay"), ease: EASE_OUT });
    tween(this.q(".glus-rc-name"), { opacity: [0, 1], translateY: [0.4 * u, 0], duration: d("nameIn"), delay: d("nameDelay"), ease: EASE_OUT });
    tween(this.q(".glus-rc-action"), { opacity: [0, 1], translateY: [0.4 * u, 0], duration: d("actionIn"), delay: d("actionDelay"), ease: EASE_OUT });

    waapi(this.q(".glus-rc-result"), [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
      duration: d("dividerIn"),
      delay: d("dividerDelay"),
      easing: CSS_UNFOLD,
      pseudoElement: "::before"
    });
    tween(this.q(".glus-rc-degree-meta"), { opacity: [0, 1], translateY: [0.3 * u, 0], duration: d("metaIn"), delay: d("metaDelay"), ease: EASE_OUT });
    tween(this.q(".glus-rc-spell-name"), { opacity: [0, 1], translateY: [0.45 * u, 0], duration: d("headlineIn"), delay: d("headlineDelay"), ease: EASE_OUT });
    tween(this.q(".glus-rc-spell-line"), { opacity: [0, 1], translateY: [0.3 * u, 0], duration: d("metaIn"), delay: d("metaDelay"), ease: EASE_OUT });
    tween(this.q(".glus-rc-quote"), { opacity: [0, 1], translateY: [0.4 * u, 0], duration: d("quoteIn"), delay: d("quoteDelay"), ease: EASE_OUT });

    this.rollDie(d("dieDelay"), d);
    const total = this.q(".glus-rc-total");
    if (total) {
      tween(total, { opacity: [0, 1], translateY: [0.5 * u, 0], duration: d("totalIn"), delay: d("totalDelay"), ease: EASE_OUT });
      await wait(d("totalDelay"));
      countUp(total, this.headlineValue(), d("count"));
      await wait(d("countHold"));
    } else {
      await wait(d("noTotalHold"));
    }
    if (!this.alive(version)) return;

    await this.reveal(version);
  }

  alive(version) {
    return !this.destroyed && this.version === version && this.element.isConnected;
  }

  /** The outcome lands: the verdict tag, the tone on the rule and the die, then the climax. */
  async reveal(version) {
    const m = this.model;
    const u = this.unit();
    const d = timing(this.element);
    this.setPending(false);
    const label = this.q(".glus-rc-degree-label");
    // The tag slides in from the name's side, along its own wedge, as the slab of tone it is.
    if (label) tween(label, { opacity: [0, 1], translateX: [-0.5 * u, 0], duration: d("labelIn"), ease: EASE_OUT });
    // The rule takes its tone now; a gradient cannot transition, so the new colour fades up instead.
    tween(this.q(".glus-rc-hair"), { opacity: [0.3, 1], duration: d("ruleTone"), ease: EASE_OUT });
    const die = this.q(".glus-rc-die");
    if (die && m.visibility !== "ownBlind" && (m.roll?.natural === 20 || m.roll?.natural === 1 || m.duality?.out === "crit")) {
      tween(die, { scale: [{ from: 1, to: 1.16, duration: d("diePopUp") }, { to: 1, duration: d("diePopDown") }], ease: EASE_POP });
    }
    const total = this.q(".glus-rc-total");
    if (total && !m.fx) tween(total, { scale: [1.1, 1], duration: d("totalPop"), ease: EASE_POP });
    await wait(d("climaxDelay"));
    if (!this.alive(version)) return;
    this.climax();
  }

  climax() {
    const m = this.model;
    const total = this.q(".glus-rc-total");
    const glow = this.q(".glus-rc-glow");
    const u = this.unit();
    const d = timing(this.element);
    if (m.fx === "gold" || m.fx === "red") {
      // A blind roll cracks in info blue, its own tone, so the crack cannot say which way it went.
      const color = m.visibility === "ownBlind" ? "info" : m.fx;
      this.crack = crackRenderer.add(this.q(".glus-rc-fx"), { color });
      // The light is the beat, not the card: it flares and goes, and the crack is what stays.
      tween(glow, { opacity: [{ from: 0, to: 1, duration: d("glowIn") }, { to: 0, duration: d("glowRest") }], ease: EASE_OUT });
      tween(total, { scale: [1.45, 1], filter: ["brightness(1.8)", "brightness(1)"], duration: d("critPop"), ease: EASE_POP });
      if (m.fx === "red") {
        tween(this.main, {
          translateX: [
            { from: 0, to: 0.22 * u, duration: d("shakeStep") },
            { to: -0.18 * u, duration: d("shakeStep") },
            { to: 0.08 * u, duration: d("shakeStep") },
            { to: 0, duration: d("shakeStep") }
          ],
          ease: "linear"
        });
      }
    } else if (m.fx === "pop") {
      tween(total, { scale: [1.5, 1], filter: ["brightness(2)", "brightness(1)"], duration: d("pop"), ease: EASE_POP });
      tween(glow, { opacity: [{ from: 0, to: 0.8, duration: d("popGlowIn") }, { to: 0, duration: d("popGlowOut") }], ease: EASE_OUT });
    }
  }

  rollDie(delay = 0, d = timing(this.element)) {
    const die = this.q(".glus-rc-die");
    if (!die) return;
    tween(die, {
      opacity: [0, 1],
      rotate: [{ from: -180, to: 10, duration: d("dieSpin") }, { to: 0, duration: d("dieSettle") }],
      scale: [{ from: 0.4, to: 1.08, duration: d("dieSpin") }, { to: 1, duration: d("dieSettle") }],
      delay,
      ease: EASE_OUT
    });
    if (this.model.duality) {
      // Each half spins through its own die's faces and lands on what that die rolled.
      for (const value of die.querySelectorAll(".glus-rc-dd-value")) {
        this.spinValue(value, this.model.duality[value.dataset.side], Number(value.dataset.faces) || 12, delay, d);
      }
      return;
    }
    this.spinValue(die.querySelector(".glus-rc-die-value"), this.model.roll?.natural, 20, delay, d);
  }

  /** Flicker a die's numeral through random faces, then settle it on the face it actually rolled. */
  spinValue(value, natural, faces, delay = 0, d = timing(this.element)) {
    if (!value) return;
    const id = (value._spin = (value._spin ?? 0) + 1);
    const t0 = performance.now() + delay;
    const flicker = d("dieFlicker");
    const step = Math.max(1, d("dieFlickerStep"));
    let lastStep = -1;
    const frame = (now) => {
      if (value._spin !== id) return;
      const elapsed = now - t0;
      if (elapsed >= flicker) {
        value.textContent = natural;
        return;
      }
      const at = Math.floor(Math.max(0, elapsed) / step);
      if (at !== lastStep) {
        lastStep = at;
        value.textContent = 1 + Math.floor(Math.random() * faces);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // A background tab runs no frames; the face it rolled lands on a timer regardless.
    setTimeout(() => {
      if (value._spin === id) value.textContent = natural;
    }, delay + flicker + d("settleSlack"));
  }

  clearCrack() {
    crackRenderer.remove(this.crack);
    crackRenderer.remove(this.damageCrack);
    this.crack = null;
    this.damageCrack = null;
    const glow = this.q(".glus-rc-glow");
    if (glow) {
      remove(glow);
      glow.style.opacity = "0";
    }
  }

  /**
   * Rewrites the card in place: a reroll, or the next step of a spell chain (cast, then attack).
   * The outcome is re-revealed after the new total settles.
   */
  async update(model, { reroll = false } = {}) {
    const version = ++this.version;
    const u = this.unit();
    const d = timing(this.element);
    this.clearCrack();
    const result = this.q(".glus-rc-result");
    const previous = Number(this.q(".glus-rc-total")?.textContent);
    const chipsBefore = this.chipStamp;
    await tween(result, { opacity: [1, 0], translateY: [0, -0.4 * u], duration: d("updateOut"), ease: EASE_EXIT });
    if (!this.alive(version)) return;

    // A claim that landed during the fade (the GM's Fear) is newer than this model's chips: keep it.
    if (this.chipStamp !== chipsBefore) model = { ...model, chips: this.model?.chips ?? model.chips };
    this.pending = true;
    this.render(model);
    const total = this.q(".glus-rc-total");
    if (total && Number.isFinite(previous)) total.textContent = previous;

    if (reroll && !this.q('[data-chip="reroll"]')) {
      const chip = el("span", "glus-rc-chip", this.label("Reroll"));
      chip.dataset.chip = "reroll";
      this.q(".glus-rc-player").append(chip);
      tween(chip, { opacity: [0, 1], translateY: [0.3 * u, 0], duration: d("chipIn"), ease: EASE_OUT });
    }
    tween(this.q(".glus-rc-hair"), { scaleX: [0, 1], duration: d("updateRuleIn"), ease: EASE_SNAP });
    tween(result, { opacity: [0, 1], translateY: [0.4 * u, 0], duration: d("updateIn"), ease: EASE_OUT });
    this.rollDie(0, d);
    if (total) countUp(total, this.headlineValue(), d("updateCount"));
    await wait(d("updateHold"));
    if (!this.alive(version)) return;
    await this.reveal(version);
  }

  /**
   * Brings the chips beside the player name in step with a new model, without touching the result: a
   * claim written onto the message after it was posted (the GM's Fear) is news about the roll, not a new
   * roll, so the total and the die stay exactly where they landed. A new chip rises in; a chip the model
   * no longer carries leaves.
   */
  setChips(model) {
    if (this.destroyed) return;
    this.chipStamp = (this.chipStamp ?? 0) + 1;
    this.model = { ...this.model, chips: model?.chips ?? [] };
    const player = this.q(".glus-rc-player");
    if (!player) return;
    const want = new Map((this.model.chips ?? []).map((chip) => [chip.id, chip]));
    for (const node of [...player.querySelectorAll("[data-chip]")]) {
      const id = node.dataset.chip;
      if (id === "blind" || id === "reroll") continue;
      if (want.has(id)) want.delete(id);
      else node.remove();
    }
    const u = this.unit();
    const d = timing(this.element);
    const before = player.querySelector('[data-chip="reroll"]');
    for (const chip of want.values()) {
      const node = this.buildChip(chip);
      player.insertBefore(node, before);
      tween(node, { opacity: [0, 1], translateY: [0.3 * u, 0], duration: d("chipIn"), ease: EASE_OUT });
    }
  }

  /** Merges a damage roll under the card. A crit attack's fracture carries into the row. */
  async addDamage(damage) {
    if (!damage) return;
    const version = this.version;
    const u = this.unit();
    this.q(".glus-rc-damage")?.remove();
    crackRenderer.remove(this.damageCrack);
    this.damageCrack = null;

    const row = el("div", "glus-rc-damage");
    row.toggleAttribute("data-crit", !!damage.crit);
    const canvas = el("canvas", "glus-rc-fx");
    const parts = el("div", "glus-rc-damage-parts");
    for (const part of damage.parts ?? []) {
      const chip = el("span", "glus-rc-damage-part");
      chip.dataset.type = part.type ?? "untyped";
      // A reader may name the icon itself (Daggerheart's physical and magic are no PF2e damage type).
      const icon = part.icon ?? damageIcon(part.type);
      if (icon) chip.append(el("i", `fa-solid fa-${icon}`));
      chip.append(document.createTextNode(`${part.amount} ${part.label ?? part.type ?? ""}`.trim()));
      parts.append(chip);
    }
    row.append(canvas, el("span", "glus-rc-damage-key", this.label("Damage")), parts);
    if (damage.crit) row.append(el("span", "glus-rc-damage-crit", this.label(damage.critKey ?? "CritDouble")));
    const total = el("span", "glus-rc-damage-total", "0");
    row.append(total);
    this.element.append(row);

    const d = timing(this.element);
    // The row drops out from under the strip, unfolding on the same plate polygon it rests on.
    await waapi(
      row,
      [
        { clipPath: PLATE_CLIP_FOLDED, transform: `translateY(${-0.6 * u}px)` },
        { clipPath: PLATE_CLIP, transform: "none" }
      ],
      { duration: d("damageDrop"), easing: CSS_UNFOLD }
    );
    row.getAnimations?.().forEach((a) => a.cancel());
    row.style.clipPath = "";
    if (this.destroyed) return;

    const stagger = d("damagePartStagger");
    [...row.querySelectorAll(".glus-rc-damage-part, .glus-rc-damage-crit")].forEach((chip, index) =>
      tween(chip, { opacity: [0, 1], translateY: [0.3 * u, 0], duration: d("damagePartIn"), delay: index * stagger, ease: EASE_OUT })
    );
    countUp(total, damage.total ?? "?", d("damageCount"));
    await wait(d("damageCount"));
    if (this.destroyed || version !== this.version) return;
    if (damage.crit) {
      tween(total, { scale: [1.4, 1], filter: ["brightness(1.8)", "brightness(1)"], duration: d("damageCritPop"), ease: EASE_POP });
      if (this.crack) {
        this.damageCrack = crackRenderer.add(canvas, {
          color: this.crack.color,
          seed: this.crack.seed,
          impact: [0.9, 0.5],
          dense: 0.6,
          reach: 1.6
        });
      }
    }
  }

  /** Takes a merged damage row back off the card, when its message is deleted or turns private. */
  removeDamage() {
    this.q(".glus-rc-damage")?.remove();
    crackRenderer.remove(this.damageCrack);
    this.damageCrack = null;
  }

  /**
   * Slides the card out toward the edge its stack hugs, then closes the gap it leaves: its height and
   * its share of the stack's spacing together, so the cards behind it move once and never jump.
   * Resolves once it is gone.
   */
  async exit() {
    this.version++;
    const root = this.element;
    if (!root.isConnected) return this.destroy();
    const u = this.unit();
    const d = timing(root);
    await tween(root, { opacity: [1, 0], translateX: [0, sideOf(root) * 1.6 * u], duration: d("exitSlide"), ease: EASE_EXIT });
    await collapse(root, d("exitCollapse"));
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unwatchArt?.();
    this.version++;
    this.clearCrack();
    try {
      remove(this.element.querySelectorAll("*"));
      remove(this.element);
    } catch (_error) {
      // Nothing was animating.
    }
    this.element.remove();
  }
}
