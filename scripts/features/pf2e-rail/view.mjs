/**
 * PF2e HUD — the bottom rail, for playing a PF2e turn without the sheet.
 *
 * A PF2e turn is three actions and a reaction, so the rail is built around
 * the action economy rather than around a sheet. One rail along the bottom
 * edge, 96px and never taller, in Ink and Signal's frame (black plates a
 * tone step apart, inset hairlines, the bottom-right cut). Left to right for
 * a player:
 *
 *   plinth    the character, standing ON the rail and rising out of it, with
 *             the Hero Points as the light behind them
 *   vitals    AC, Hit Points (temp riding over them, Stamina under), the
 *             shield and its Raise, then Perception and the three saves
 *   strikes   one row per strike: the three MAP presses, damage, critical,
 *             with the next MAP step underlined
 *   deck      one plate, four tabs, each drawn in the shape of what it holds:
 *             Spells (cards fanned up out of the rail, one rank at a time),
 *             Actions (rows in PF2e's action glyph), Skills (the skill-action
 *             finder's field and what it suggests right now), Items (tiles)
 *   util      rest, macros, the sheet
 *
 * Over the strikes and the deck, on the rail's top edge, rides the turn bar
 * in an encounter (the actions you have left, the MAP step, whose turn it
 * is) or the exploration bar out of one (what the character is doing while
 * the party travels). The two modes are the same rail re-weighted: in an
 * encounter the strikes open to their three MAP presses, exploring they
 * close to one.
 *
 * The GM's rail swaps everything after the plinth for the creature panel
 * (or the hazard panel) and a hand of every non-PC token on the scene. On
 * both rails the party is the stack of ringed seats above the plinth.
 *
 * The skill finder (`FINDER`) is the rail's hero: every skill action PF2e
 * defines, found by typing, grouped by what the character is trying to do,
 * each one carrying its best skill, the defence it targets and — where the
 * party knows the number — the odds, and rolled through PF2e's own action.
 *
 * This file is pure: every builder takes a plain model and a `t(key, data)`
 * translator and returns markup. It reaches no `game`, no `canvas` and no
 * DOM, so the preview page, the check tool and Foundry draw the same rail.
 * It never decides who may see what: a field the model does not carry is a
 * field the rail does not draw, and the model is built by the host after the
 * permission test (a DC the party does not know arrives as `null`). Nothing
 * here knows what a press does either; gestures attach to the data-*
 * handles (see `HANDLES`). Rules text (`text`) arrives as HTML the host has
 * already enriched and sanitised, exactly as the sheet prints it, and is the
 * one field printed unescaped.
 */
import { escapeHTML as esc } from "../../core/util.mjs";
import { ICON, costGlyph } from "./icons.mjs";
import { actionIcon } from "./action-icons.mjs";
import { GM_MOVES, LOW_HEALTH_AT, SAVES, STRIKE_ROWS } from "./const.mjs";

/** Every gesture handle the rail draws, for the host and the check tool. */
export const HANDLES = Object.freeze([
  "data-act", "data-hero", "data-pip", "data-check", "data-strike", "data-variant", "data-dmg", "data-crit",
  "data-toggle", "data-stance", "data-action", "data-spell", "data-rank-step", "data-tab", "data-item",
  "data-skill-action", "data-find", "data-explore", "data-drawer", "data-row",
  "data-seat", "data-foe", "data-pa",
]);

const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "+0");
const SR = (s) => `<span class="gph-sr">${s}</span>`;
const frac = (v, max) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
const costKey = (c) => `GLRAIL.cost.${String(c).includes("-") ? "range" : c}`;
const glyph = (c, t) => (c != null ? costGlyph(c, t(costKey(c), { cost: c })) : "");

/* ── the plinth ───────────────────────────────────────────────────
   The character stands on the rail. The plate is the rail's height; the
   picture is taller and is let out of the top. A painting fades into the
   map where it leaves, so it has no hard edge above the bar; a cut-out
   (`cutout`: the token ring's subject texture, or a transparent figure) has
   its own edge and stands with a contact shadow instead.

   Hero Points are amber gems in a column on the plinth's edge, amber because
   a Hero Point is the one thing on the sheet that is pure player agency. No
   light stands behind the figure: the picture is the character's own.

   The sub line is class and level (`sub`) and Speed (`speed`), never the
   ancestry: the line is one plinth wide and both are numbers someone acts on.

   The frame (`--fdx/--fdy` in percent of the figure, `--fz` the zoom) is the
   owner's, from the actor's `ph.frame` flag; the default is the whole
   picture, contained and standing on the rail. */
export const frameVars = (f) => (f ? `--fdx:${+f.x || 0};--fdy:${+f.y || 0};--fz:${+f.scale || 1}` : "");

const heroGems = (hero, t, readonly) => {
  const [cur, max] = hero;
  return `<span class="gph-gems" data-pool="hero" role="group" aria-label="${esc(t("GLRAIL.hero.name"))}">${
    Array.from({ length: max }, (_, i) => `<button type="button" class="gph-gem${i < cur ? " on" : ""}" data-hero="${i + 1}"${readonly ? ' tabindex="-1"' : ""} aria-label="${esc(t("GLRAIL.hero.gem", { i: i + 1, max }))}" aria-pressed="${i < cur}"></button>`).join("")
  }<span class="gph-sr" data-hero-n>${esc(t("GLRAIL.hero.count", { n: cur, max }))}</span></span>`;
};

const dyingPlate = (d, t) => `
  <span class="gph-dying" role="img" aria-label="${esc(t("GLRAIL.dying.said", { n: d.value, max: d.max }))}">
    <b>${esc(t("GLRAIL.dying.label"))}</b>
    <span class="gph-beads">${Array.from({ length: d.max }, (_, i) => `<i class="${i < d.value ? "on" : ""}"></i>`).join("")}</span>
  </span>`;

/* Conditions and effects ride just above the name, where the figure meets
   the rail. A chip prints its value, because Frightened 2 and Frightened 1
   are different rolls; one that hurts takes the red edge, one that helps
   the green. A press on any of them opens the effects drawer. */
const condChip = (c) => `
    <li><button type="button" class="gph-cond" data-drawer="effects"${c.tone ? ` data-tone="${c.tone}"` : ""} title="${esc([c.value ? `${c.name} ${c.value}` : c.name, c.note].filter(Boolean).join(" · "))}">
      ${c.icon ? `<img src="${esc(c.icon)}" alt="">` : ""}<span class="gph-cn">${esc(c.name)}</span>${c.value ? `<b>${c.value}</b>` : ""}</button></li>`;

/* They sit in the nameplate's own flow, so a long name or a second row of
   chips pushes the stack up instead of under. Five at most; the rest are a
   count that opens the effects drawer, which lists them all. */
const COND_CAP = 5;
const condList = (conds, t) => {
  const shown = conds.length > COND_CAP ? conds.slice(0, COND_CAP - 1) : conds;
  const more = conds.length - shown.length;
  return `<ul class="gph-conds" aria-label="${esc(t("GLRAIL.conds"))}">${shown.map(condChip).join("")}${more ? `
    <li><button type="button" class="gph-cond is-more" data-drawer="effects" aria-label="${esc(t("GLRAIL.more", { n: more }))}"><b>+${more}</b></button></li>` : ""}</ul>`;
};

export const PLINTH = (p, t, { readonly = false } = {}) => {
  const state = p.dead ? "dead" : p.dying ? "dying" : "";
  return `
<section class="gph-plinth${p.cutout ? " is-cut" : ""}" data-plinth data-kind="${esc(p.kind ?? "character")}"${state ? ` data-state="${state}"` : ""}${p.turn ? " data-turn" : ""}${p.frame ? ` style="${frameVars(p.frame)}"` : ""}>
  <span class="gph-plate"></span>
  <span class="gph-fig" aria-hidden="true"><span class="gph-img"${p.cutout || p.img ? ` style="background-image:url('${esc(p.cutout || p.img)}')"` : ""}></span></span>
  ${p.frameable ? `<button type="button" class="gph-frm" data-act="frame" title="${esc(t("GLRAIL.frame.title"))}" aria-label="${esc(t("GLRAIL.frame.label"))}">${ICON.frame}</button>
  <span class="gph-frhint" aria-hidden="true">${esc(t("GLRAIL.frame.hint"))}</span>` : ""}
  ${p.hero ? heroGems(p.hero, t, readonly) : ""}
  <span class="gph-nameplate">
    ${p.conds?.length ? condList(p.conds, t) : ""}
    ${readonly && !p.dead && !p.dying ? `<span class="gph-watch">${esc(t("GLRAIL.observing"))}</span>` : ""}
    ${p.dead ? `<span class="gph-dead">${esc(t("GLRAIL.dead"))}</span>` : p.dying ? dyingPlate(p.dying, t) : ""}
    <b title="${esc(p.name)}">${esc(p.name)}</b>
    <span class="gph-sub"><span class="gph-subt">${esc(p.sub ?? "")}</span>${p.speed ? `<span class="gph-spd">${esc(p.speed)}</span>` : ""}${p.hp ? `<span class="gph-fhp" data-fold-hp${hpState(...p.hp) ? ' data-state="low"' : ""}><b>${p.hp[0]}</b><s>/${p.hp[1]}</s>${SR(` ${t("GLRAIL.vitals.hpName")}`)}</span>` : ""}</span>
  </span>
  ${p.fold === false ? "" : `<button type="button" class="gph-fold" data-act="fold" aria-label="${esc(t(p.folded ? "GLRAIL.fold.show" : "GLRAIL.fold.hide"))}" aria-expanded="${!p.folded}">${ICON.fold}</button>`}
</section>`;
};

/* ── the Hit Point meter ──────────────────────────────────────────
   PF2e's Hit Points run to the hundreds, so they are a length, not boxes:
   the numeral first and loudest, the bar under it. Paper at rest, red under
   a quarter (the resource bars' `LOW_HEALTH_AT`, so the token's bar and the
   rail turn together). The half mark is a tick, not a colour event — PF2e
   has no bloodied rule. Temporary Hit Points ride over the bar as an info
   line from its start. A loss leaves a chip trail: the lost length stays
   lit in red for a beat and then drains (`--gph-was`, driven by drive.mjs),
   the one place on the rail a number is allowed to be felt. */
export const hpState = (value, max) => (max > 0 && value / max <= LOW_HEALTH_AT ? "low" : "");

export const METER = (kind, m, t, { big = true } = {}) => {
  const v = frac(m.value, m.max), tmp = frac(m.temp ?? 0, m.max);
  const low = kind === "hp" && hpState(m.value, m.max);
  const name = t(kind === "sp" ? "GLRAIL.vitals.spName" : "GLRAIL.vitals.hpName");
  return `
<div class="gph-meter${big ? "" : " is-small"}" data-meter="${kind}" data-max="${m.max}"${low ? ` data-state="${low}"` : ""} style="--gph-v:${v.toFixed(4)};--gph-was:${v.toFixed(4)};--gph-tmp:${tmp.toFixed(4)}">
  ${big ? `<span class="gph-mn"><b data-v>${m.value}</b><s>/${m.max}</s>${SR(` ${name}`)}<em data-tmp${m.temp ? "" : " hidden"}>${esc(t("GLRAIL.vitals.temp", { n: m.temp ?? 0 }))}</em></span>` : ""}
  <span class="gph-bar" role="meter" aria-label="${esc(name)}" aria-valuemin="0" aria-valuemax="${m.max}" aria-valuenow="${m.value}"${big ? "" : ` title="${esc(`${name} ${m.value}/${m.max}`)}"`}>
    <i class="gph-chip"></i><i class="gph-fill"></i><i class="gph-half"></i><i class="gph-tmp"></i></span>
  ${big ? "" : `<span class="gph-mk" aria-hidden="true">${esc(t(kind === "sp" ? "GLRAIL.vitals.sp" : "GLRAIL.vitals.hp"))}</span><span class="gph-ms" aria-hidden="true"><b data-v>${m.value}</b></span>`}
</div>`;
};

/* ── vitals ───────────────────────────────────────────────────────
   AC is the number every attack against you is rolled at, so it is the tile
   the plate leads with; the Hit Points beside it are the number you watch.
   The shield is a press because Raise a Shield is the defensive action taken
   every round; a broken one says so in red where its Raise would be. The
   four checks a GM calls for without warning sit along the foot. */
const SHIELD = (s, t) => {
  const state = s.destroyed ? "destroyed" : s.broken ? "broken" : s.raised ? "raised" : "";
  const label = s.broken || s.destroyed ? t(s.destroyed ? "GLRAIL.shield.destroyed" : "GLRAIL.shield.broken")
    : t(s.raised ? "GLRAIL.shield.raised" : "GLRAIL.shield.raise");
  return `<button type="button" class="gph-shd" data-act="raise" data-cost="1"${state ? ` data-state="${state}"` : ""} aria-pressed="${!!s.raised}"${s.broken || s.destroyed ? ' aria-disabled="true"' : ""}
    title="${esc(t("GLRAIL.shield.title", { name: s.name, hp: s.hp, max: s.max, h: s.hardness, bt: s.bt, ac: s.ac }))}">
    ${ICON.shield}<span class="gph-shn"><b data-v>${s.hp}</b>/${s.max}</span><span class="gph-shh">${esc(t("GLRAIL.shield.hardness", { n: s.hardness }))}</span><em>${esc(label)}</em></button>`;
};

const CHECK = (key, mod, t, short) => `<button type="button" class="gph-chk" data-check="${key}" title="${esc(t("GLRAIL.check.roll", { name: t(`GLRAIL.check.${key}`) }))}">
      <span>${esc(t(`GLRAIL.check.${short}`))}</span><b>${sign(mod)}</b></button>`;

export const VITALS = (v, t) => `
<section class="gph-pl gph-vitals" data-vitals aria-label="${esc(t("GLRAIL.vitals.label"))}">
  <div class="gph-ac" role="img" aria-label="${esc(t("GLRAIL.vitals.acSaid", { n: v.ac }))}"><span aria-hidden="true">${esc(t("GLRAIL.vitals.ac"))}</span><b aria-hidden="true">${v.ac}</b></div>
  <div class="gph-life">
    ${METER("hp", v.hp, t)}
    ${v.sp ? METER("sp", v.sp, t, { big: false }) : ""}
    <div class="gph-vfoot">${v.shield ? SHIELD(v.shield, t) : ""}${v.classDC != null ? `<span class="gph-cdc">${esc(t("GLRAIL.vitals.classDC"))} <b>${v.classDC}</b></span>` : ""}</div>
  </div>
  <div class="gph-checks">
    ${CHECK("perception", v.perception, t, "perceptionShort")}
    ${SAVES.map((s) => CHECK(s, v.saves[s], t, `${s}Short`)).join("")}
  </div>
</section>`;

/* ── the turn bar / the exploration bar ───────────────────────────
   Rides the rail's top edge over the strikes and the deck, because that is
   where the actions it counts are spent. In an encounter: whose turn it is,
   the actions you have left as PF2e's diamonds (the maximum is the rules'
   — three, one more while Quickened, fewer while Slowed or Stunned — and
   the spending is this screen's own count, never stored), the reaction,
   and the MAP step the next attack is rolled at. Exploring: the activity
   the character is doing while the party travels, as PF2e records it. */
/* MAP is printed on your own turn only: off-turn it is always 0, and the
   owner's name needs the room. */
export const TURNBAR = (tb, t) => {
  if (tb.mode === "exploration") return `
<div class="gph-turnbar is-explore" data-turnbar>
  <span class="gph-tb-k">${esc(t("GLRAIL.turnbar.exploring"))}</span>
  <span class="gph-tb-acts">${(tb.activities ?? []).filter((a) => a.on).slice(0, 1).map((a) => `<button type="button" class="gph-tog on" data-explore="${esc(a.id)}" aria-pressed="true">${esc(a.name)}</button>`).join("") || `<span class="gph-none">${esc(t("GLRAIL.turnbar.idle"))}</span>`}</span>
  ${(() => { const extra = (tb.activities ?? []).filter((a) => a.on).length - 1; return `<button type="button" class="gph-tb-more" data-act="explore" aria-label="${esc(t("GLRAIL.turnbar.chooseActivity"))}">${extra > 0 ? `<b>+${extra}</b>` : ""}${ICON.more}</button>`; })()}
</div>`;
  const e = tb.economy ?? { max: 3, spent: 0, reaction: true };
  const left = Math.max(0, e.max - e.spent);
  return `
<div class="gph-turnbar${tb.mine ? " is-mine" : ""}" data-turnbar data-left="${left}">
  <span class="gph-tb-k"><span>${tb.mine ? esc(t("GLRAIL.turnbar.yours")) : esc(t("GLRAIL.turnbar.theirs", { name: tb.current ?? "" }))}</span></span>
  <span class="gph-econ" role="group" aria-label="${esc(t("GLRAIL.turnbar.said", { left, max: e.max }) + (e.reaction ? ` ${t("GLRAIL.turnbar.reactionReady")}` : ""))}">
    ${Array.from({ length: e.max }, (_, i) => `<button type="button" class="gph-pip${i < left ? " on" : ""}${i >= 3 ? " is-extra" : ""}" data-pip="${i}" style="--i:${i}"${i >= 3 && e.note ? ` title="${esc(e.note)}"` : ""} aria-label="${esc(t("GLRAIL.turnbar.pip", { i: i + 1, max: e.max }))}" aria-pressed="${i < left}"></button>`).join("")}
    <button type="button" class="gph-pip is-react${e.reaction ? " on" : ""}" data-pip="r" style="--i:${e.max}" aria-label="${esc(t("GLRAIL.cost.r"))}" aria-pressed="${!!e.reaction}">${costGlyph("r")}</button>
  </span>
  ${e.note ? SR(e.note) : ""}
  ${tb.mine ? `<span class="gph-tb-map" aria-live="polite">${esc(t("GLRAIL.turnbar.map"))} <b data-map-n>${["0", "−5", "−10"][tb.map ?? 0]}</b></span>` : ""}
</div>`;
};

/* ── strikes ──────────────────────────────────────────────────────
   A strike is a row of PF2e's own chat-card buttons: the three attack
   variants with the multiple attack penalty already in them, then Damage and
   Critical, so the rail and the card read the same. The next MAP step is
   underlined — one marker per row that slides as the turn's attacks land,
   so the eye never has to count. A weapon not in hand dims and says why
   before it is pressed. Exploring, the row closes to its first attack. */
/* `s.short` is what the weapon IS (PF2e's base item, "Greatsword"; a
   blast's element, and its range when it has one, "Water 30 ft") — the word that tells two
   rows apart, which a name cut from its end loses first behind its runes.
   The whole name rides the title and the peek. */
const STRIKE = (s, t) => {
  const short = s.ready === false;
  return `
  <div class="gph-stk${short ? " is-short" : ""}${s.kind === "blast" ? " is-blast" : ""}" data-strike-row="${esc(s.id)}">
    <button type="button" class="gph-stn" data-strike="${esc(s.id)}" data-act="peek-strike" title="${esc(s.name)}${short ? ` · ${esc(t("GLRAIL.strike.notReady"))}` : ""}">
      ${s.img ? `<img src="${esc(s.img)}" alt="">` : ""}<b>${esc(s.short ?? s.name)}</b>${short ? SR(`, ${t("GLRAIL.strike.notReady")}`) : ""}</button>
    ${[0, 1, 2].map((i) => s.variants[i] != null
      ? `<button type="button" class="gph-map" data-strike="${esc(s.id)}" data-variant="${i}" data-cost="1" data-attack${short ? ' aria-disabled="true"' : ""} aria-label="${esc(t("GLRAIL.strike.attack", { name: s.name, mod: s.variants[i] }))}">${esc(s.variants[i])}</button>`
      : '<span class="gph-map is-none" aria-hidden="true"></span>').join("")}
    <i class="gph-mapmark" aria-hidden="true"></i>
    <button type="button" class="gph-dmg" data-dmg="${esc(s.id)}" title="${esc(s.damage ?? "")}" aria-label="${esc(t("GLRAIL.strike.dmgSaid", { name: s.name, f: s.damage ?? "" }))}">${esc(t("GLRAIL.strike.dmg"))}</button>
    <button type="button" class="gph-dmg is-crit" data-crit="${esc(s.id)}" title="${esc(s.critical ?? "")}" aria-label="${esc(t("GLRAIL.strike.critSaid", { name: s.name, f: s.critical ?? "" }))}">${esc(t("GLRAIL.strike.crit"))}</button>
  </div>`;
};

export const STRIKES = ({ list }, t) => {
  if (!list?.length) return `<section class="gph-pl gph-strikes is-none" aria-label="${esc(t("GLRAIL.strike.label"))}"><span class="gph-none">${esc(t("GLRAIL.strike.none"))}</span></section>`;
  const shown = list.length > STRIKE_ROWS ? list.slice(0, STRIKE_ROWS - 1) : list;
  const more = list.length - shown.length;
  return `
<section class="gph-pl gph-strikes" data-rows="${shown.length + (more ? 1 : 0)}" aria-label="${esc(t("GLRAIL.strike.label"))}">${shown.map((s) => STRIKE(s, t)).join("")}${more ? `
  <button type="button" class="gph-row is-more" data-drawer="strikes"><b>${esc(t("GLRAIL.more", { n: more }))}</b>${ICON.more}</button>` : ""}
</section>`;
};

/* ── the deck ─────────────────────────────────────────────────────
   One plate, four tabs down its left edge, so the plate's whole height is
   content and the tabs never compete with the cards that rise out of it.
   The marker travels between tabs; the pane changes under it. The deck is
   the one plate that grows: on a wide screen a tab simply shows more of
   itself. The ⤢ press (or typing, on Skills) opens the tab whole, as a
   panel rising over the deck. */
const TAB_ICON = { spells: "spells", actions: "actions", skills: "skills", items: "inventory" };

const TABS = (d, t) => `
  <div class="gph-tabs" role="tablist" aria-orientation="vertical" style="--gph-tab:${Math.max(0, d.tabs.findIndex((x) => x.key === d.tab))}">
    ${d.tabs.map((x) => `<button type="button" class="gph-tab${x.key === d.tab ? " on" : ""}" role="tab" data-tab="${x.key}" aria-selected="${x.key === d.tab}" title="${esc(t(`GLRAIL.tab.${x.key}`))}">
      ${ICON[TAB_ICON[x.key]]}<span>${esc(t(`GLRAIL.tab.${x.key}`))}</span>${x.count != null ? `<b>${x.count}</b>` : ""}</button>`).join("")}
    <i class="gph-tabmark" aria-hidden="true"></i>
  </div>`;

/* Spells. A spell is a card with a face and a slot is literally a limit, so
   the spells are held the way a hand of cards is: true-size compact cards
   fanned up out of the rail, never shrunk to fit 96px. A caster at level
   nine knows more spells than any fan can hold legibly, so the hand holds
   one rank at a time and the rank dial chooses which, with that rank's
   slots under the numeral. An expended prepared slot is still a card, put
   down; an empty one is a socket. */
const rankName = (k, t) => (k === "c" ? t("GLRAIL.rank.cantrips") : k === "f" ? t("GLRAIL.rank.focus") : t("GLRAIL.rank.n", { n: k }));
const rankMark = (k, t) => (k === "c" ? t("GLRAIL.rank.c") : k === "f" ? t("GLRAIL.rank.f") : String(k));
const pips = ([left, max], cls = "gph-slots") => `<span class="${cls}" aria-hidden="true">${Array.from({ length: max }, (_, i) => `<i class="${i < left ? "on" : ""}"></i>`).join("")}</span>`;

const DIAL = (h, t) => {
  const r = h.ranks.find((x) => x.key === h.rank) ?? h.ranks[0];
  const idx = h.ranks.indexOf(r);
  const said = t("GLRAIL.rank.said", { rank: rankName(r.key, t), n: r.cards }) + (r.slots ? ` ${t("GLRAIL.rank.slotsSaid", { left: r.slots[0], max: r.slots[1] })}` : "");
  return `
  <div class="gph-dial">
    <div class="gph-dialrow">
      <button type="button" class="gph-step" data-rank-step="-1"${idx <= 0 ? ' aria-disabled="true"' : ""} aria-label="${esc(t("GLRAIL.rank.prev"))}">${ICON.prev}</button>
      <button type="button" class="gph-rk" data-act="ranks" aria-label="${esc(said)}" aria-haspopup="dialog">
        <span aria-hidden="true">${esc(t(r.key === "c" ? "GLRAIL.rank.cLabel" : r.key === "f" ? "GLRAIL.rank.fLabel" : "GLRAIL.rank.label"))}</span><b aria-hidden="true">${esc(rankMark(r.key, t))}</b></button>
      <button type="button" class="gph-step" data-rank-step="1"${idx >= h.ranks.length - 1 ? ' aria-disabled="true"' : ""} aria-label="${esc(t("GLRAIL.rank.next"))}">${ICON.next}</button>
    </div>
    ${r.key === "f" && h.focus ? pips(h.focus, "gph-slots is-focus") : r.slots ? pips(r.slots) : '<span class="gph-slots is-free" aria-hidden="true"></span>'}
    <span class="gph-sdc">${h.dc != null ? `${esc(t("GLRAIL.spell.dc"))} <b>${h.dc}</b>` : ""}${h.atk != null ? ` <b>${sign(h.atk)}</b>` : ""}</span>
  </div>`;
};

const CARD = (c, t) => {
  if (c.socket) return `<span class="gph-card is-socket" aria-label="${esc(t("GLRAIL.spell.empty"))}"><span class="gph-pen">${esc(rankMark(c.rank, t))}</span><b class="gph-cname">${esc(t("GLRAIL.spell.empty"))}</b></span>`;
  const costSaid = c.cost != null ? t(costKey(c.cost), { cost: c.cost }) : "";
  return `<button type="button" class="gph-card${c.spent ? " is-spent" : ""}" data-spell="${esc(c.id)}"${c.cost != null && /^[123]$/.test(String(c.cost)) ? ` data-cost="${c.cost}"` : ""}${c.entry ? ` data-entry="${esc(c.entry)}"` : ""}${c.slot != null ? ` data-slot="${c.slot}"` : ""}
    aria-label="${esc([c.name, rankName(c.rank, t), costSaid, c.spent ? t("GLRAIL.spell.spent") : ""].filter(Boolean).join(", "))}">
    <span class="gph-art"${c.img ? ` style="background-image:url('${esc(c.img)}')"` : ""}></span>
    <span class="gph-pen" aria-hidden="true">${esc(rankMark(c.heightened ?? c.rank, t))}</span>
    ${c.cost != null ? `<span class="gph-ccost" aria-hidden="true">${costGlyph(c.cost)}</span>` : ""}
    <b class="gph-cname" aria-hidden="true">${esc(c.name)}</b>
  </button>`;
};

const FAN = (items, cls, label) => {
  const mid = (items.length - 1) / 2;
  return `<div class="gph-fan${cls}" style="--n:${items.length}" aria-label="${esc(label)}">${items.map((it, i) =>
    `<div class="gph-held${it.sel ? " is-sel" : ""}${it.socket ? " is-socket" : ""}" style="--t:${((i - mid) * Math.min(1, 3 / Math.max(mid, 1))).toFixed(2)};--z:${i + 1}">${it.html}</div>`).join("")}</div>`;
};

export const SPELLS = (h, t) => {
  const r = h.ranks.find((x) => x.key === h.rank) ?? h.ranks[0];
  const cards = h.cards.filter((c) => c.rank === r.key);
  return `${DIAL(h, t)}
  ${cards.length ? FAN(cards.map((c) => ({ socket: !!c.socket, html: CARD(c, t) })), "", t("GLRAIL.spell.handSaid", { rank: rankName(r.key, t), n: cards.length }))
    : `<span class="gph-none gph-pane-none">${esc(t("GLRAIL.spell.noneAtRank"))}</span>`}`;
};

/* Actions. Toggles first, as chips: the switches players open the sheet
   mid-fight to flip, and the one thing on this tab that is a state rather
   than a move. Then the stances, the active one lit; then everything the
   character owns with an action cost, in PF2e's glyph, with what is left of
   its frequency as round pips. */
const freqRead = (f, t) => f ? `<span class="gph-freq" title="${esc(t("GLRAIL.freq.title", { left: f.max - f.used, max: f.max, per: f.per }))}">${
  Array.from({ length: f.max }, (_, i) => `<i class="${i < f.max - f.used ? "on" : ""}"></i>`).join("")}${SR(t("GLRAIL.freq.title", { left: f.max - f.used, max: f.max, per: f.per }))}</span>` : "";

const ACTION_ROW = (a, t) => {
  const spent = a.freq && a.freq.used >= a.freq.max;
  return `<button type="button" class="gph-row${a.stance ? " is-stance" : ""}${a.active ? " is-on" : ""}${spent ? " is-spent" : ""}" ${a.stance ? "data-stance" : "data-action"}="${esc(a.id)}"${/^[123]$/.test(String(a.cost)) ? ` data-cost="${a.cost}"` : ""}${a.active ? ' aria-pressed="true"' : ""}>
    <span class="gph-cost">${glyph(a.cost, t)}</span><b>${esc(a.name)}</b>${spent ? SR(`, ${t("GLRAIL.freq.spent")}`) : ""}${freqRead(a.freq, t)}</button>`;
};

export const ACTIONS = ({ toggles = [], list = [] }, t) => `
  <div class="gph-actpane${toggles.length ? " has-toggles" : ""}">
    ${toggles.length ? `<div class="gph-togs">${toggles.map((g) => `<button type="button" class="gph-tog${g.on ? " on" : ""}" data-toggle="${esc(g.id)}" aria-pressed="${!!g.on}" title="${esc(g.label)}">${esc(g.label)}</button>`).join("")}</div>` : ""}
    <div class="gph-arows">${list.length ? list.map((a) => ACTION_ROW(a, t)).join("") : `<span class="gph-none">${esc(t("GLRAIL.actions.none"))}</span>`}</div>
  </div>`;

/* Skills, in the rail: the finder's field — type and the finder opens with
   what you typed — and the actions worth reaching for right now, which the
   host chooses from the mode, the target and the character's pins. Each is
   a key with its skill's modifier and, where the party knows the defence,
   its odds. */
const ODDS = (vs, t) => {
  if (!vs) return "";
  const dc = vs.dc == null ? t("GLRAIL.skill.unknown") : String(vs.dc);
  const chance = vs.chance == null ? "" : Array.isArray(vs.chance) ? `${Math.round(vs.chance[0] * 100)}–${Math.round(vs.chance[1] * 100)}%` : `${Math.round(vs.chance * 100)}%`;
  return `<span class="gph-vs${vs.dc == null ? " is-unknown" : ""}" title="${esc(t("GLRAIL.skill.vsTitle", { stat: vs.label, dc }))}">
    <span class="gph-vsk">${esc(vs.label)}</span><em${oddsTone(vs.chance) ? ` data-tone="${oddsTone(vs.chance)}"` : ""}>${chance || (vs.dc == null ? esc(dc) : esc(t("GLRAIL.skill.dcShort", { dc })))}</em>${chance ? SR(t("GLRAIL.skill.chanceSaid", { chance })) : ""}</span>`;
};

const RANK_TAG = (rank, t) => (rank == null ? "" : `<i class="gph-tag" data-rank="${rank}" title="${esc(t(`GLRAIL.prof.${rank}`))}">${esc(t(`GLRAIL.prof.${rank}Short`))}</i>`);

const KEY = (a, t) => `<button type="button" class="gph-key${a.locked ? " is-locked" : ""}" data-skill-action="${esc(a.id)}"${a.attack ? " data-attack" : ""}${/^[123]$/.test(String(a.cost)) ? ` data-cost="${a.cost}"` : ""}${a.locked ? ` aria-disabled="true" title="${esc(a.locked)}"` : ""}
    aria-label="${esc([a.name, `${a.skill.name} ${sign(a.skill.mod)}`, a.vs ? `${t("GLRAIL.skill.vs")} ${a.vs.label}` : ""].filter(Boolean).join(", "))}">
    ${actionIcon(a.slug)}<b>${esc(a.name)}</b><span class="gph-cost">${glyph(a.cost, t)}</span>${RANK_TAG(a.skill.rank, t)}<span class="gph-kmod">${sign(a.mapMod ?? a.skill.mod)}</span>${ODDS(a.vs, t)}</button>`;

export const SKILLTAB = (s, t) => `
  <div class="gph-skilltab">
    <label class="gph-search is-mini">${ICON.search}<input type="search" data-find value="${esc(s.query ?? "")}" placeholder="${esc(t("GLRAIL.skill.placeholder"))}" aria-label="${esc(t("GLRAIL.skill.find"))}" autocomplete="off" spellcheck="false"><kbd>${esc(t("GLRAIL.skill.key"))}</kbd></label>
    ${s.target ? `<span class="gph-tgt" title="${esc(s.target.name)}">${s.target.img ? `<img src="${esc(s.target.img)}" alt="">` : ""}<span>${esc(t("GLRAIL.skill.vs"))}</span><b>${esc(s.target.name)}</b></span>` : `<span class="gph-tgt is-none">${esc(t("GLRAIL.skill.noTarget"))}</span>`}
    <div class="gph-keys">${(s.suggested ?? []).map((a) => KEY(a, t)).join("")}</div>
  </div>`;

/* Items: what is reached for in a fight, held as a hand of the same compact
   card the spells are — the item's own painting, what is left of it on the
   pennant where a spell carries its rank, the action cost top right. A
   press uses it through PF2e. */
const ITEM_CARD = (i, t) => {
  const costSaid = i.cost != null ? t(costKey(i.cost), { cost: i.cost }) : "";
  return `<button type="button" class="gph-card is-item${i.qty === 0 ? " is-spent" : ""}" data-item="${esc(i.id)}"${/^[123]$/.test(String(i.cost)) ? ` data-cost="${i.cost}"` : ""}
    aria-label="${esc([i.name, costSaid, i.qty != null ? t("GLRAIL.items.left", { n: i.qty }) : ""].filter(Boolean).join(", "))}">
    <span class="gph-art"${i.img ? ` style="background-image:url('${esc(i.img)}')"` : ""}></span>
    ${i.qty != null ? `<span class="gph-pen" aria-hidden="true">×${i.qty}</span>` : ""}
    ${i.cost != null ? `<span class="gph-ccost" aria-hidden="true">${costGlyph(i.cost)}</span>` : ""}
    <b class="gph-cname" aria-hidden="true">${esc(i.name)}</b>
  </button>`;
};

export const ITEMS = ({ list = [] }, t) => list.length
  ? FAN(list.map((i) => ({ html: ITEM_CARD(i, t) })), " is-items", t("GLRAIL.items.handSaid", { n: list.length }))
  : `<span class="gph-none gph-pane-none">${esc(t("GLRAIL.items.none"))}</span>`;

export const DECK = (d, t) => {
  const pane = d.tab === "spells" && d.spells ? SPELLS(d.spells, t)
    : d.tab === "skills" ? SKILLTAB(d.skills ?? {}, t)
    : d.tab === "items" ? ITEMS(d.items ?? {}, t)
    : ACTIONS(d.actions ?? {}, t);
  const n = d.tab === "spells" && d.spells ? d.spells.cards.filter((c) => c.rank === (d.spells.rank ?? d.spells.ranks[0].key)).length
    : d.tab === "items" ? (d.items?.list?.length ?? 0) : 1;
  return `
<section class="gph-pl gph-deck" data-tab="${esc(d.tab)}" style="--n:${Math.max(1, n)}" aria-label="${esc(t("GLRAIL.deck.label"))}">
  ${TABS(d, t)}
  <div class="gph-pane" role="tabpanel" data-pane="${esc(d.tab)}">${pane}</div>
  <button type="button" class="gph-expand" data-act="expand" aria-label="${esc(t("GLRAIL.deck.expand", { tab: t(`GLRAIL.tab.${d.tab}`) }))}">${ICON.expand}</button>
</section>`;
};

/* Rest, macros (the hotbar is hidden while the rail is up, and Foundry
   keeps the user's macros there) and the sheet. */
export const UTIL = (u, t) => `
<nav class="gph-pl gph-util" aria-label="${esc(t("GLRAIL.util"))}">${["rest", "macros", "sheet"].map((k) => `
  <button type="button" class="gph-dw${u?.open === k ? " on" : ""}" data-drawer="${k}" title="${esc(t(`GLRAIL.drawer.${k}`))}" aria-label="${esc(t(`GLRAIL.drawer.${k}`))}"${k === "sheet" ? "" : ` aria-expanded="${u?.open === k}"`}>${ICON[k]}</button>`).join("")}
</nav>`;

/* ── the skill finder ─────────────────────────────────────────────
   pf2e-hud's skill menu is every skill with every action under it, all at
   once. The finder keeps the skill as the way in — players know what they
   are good at, and the skill is what the roll adds — but shows only what
   this character can actually do, small enough to take in at a glance:

   - one column per skill the character has an action in, best modifier
     first; the column's head IS the plain skill check (press it to roll
     Athletics), so the modifier is printed once, not on every row;
   - every action a one-line chip: its picture, its name, its cost, and on
     the right the chance against the target's defence where the party
     knows it (?? where they do not), coloured only at the ends — likely
     green, unlikely red;
   - a trained-only action under an untrained skill is not drawn at all,
     because it cannot be taken; untrained skills that still have actions
     share one column, each chip naming its skill;
   - skills with no actions here (and Lores) are a row of check presses
     along the foot.

   Typing narrows every column at once. An attack-trait action rolls at the
   turn's MAP step (shown on its chip when it is not the first); 1–3 roll it
   at a chosen step. A pin keeps an action in the rail's Skills tab. */
const oddsTone = (c) => {
  if (c == null) return "";
  const [lo, hi] = Array.isArray(c) ? c : [c, c];
  return lo >= 0.7 ? "good" : hi <= 0.3 ? "bad" : "";
};
const pctOf = (c) => (c == null ? "" : Array.isArray(c) ? `${Math.round(c[0] * 100)}–${Math.round(c[1] * 100)}%` : `${Math.round(c * 100)}%`);

/* The typed words, marked where they start a word of the name. */
const fold = (x) => String(x).toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const marked = (name, q) => {
  const words = fold(q ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return esc(name);
  return String(name).split(/(\s+|-)/).map((part) => {
    const w = words.filter((x) => fold(part).startsWith(x)).sort((x, y) => y.length - x.length)[0];
    return w ? `<mark>${esc(part.slice(0, w.length))}</mark>${esc(part.slice(w.length))}` : esc(part);
  }).join("");
};

const CHIP = (a, t, sel, k, { withSkill = false, query = "" } = {}) => {
  const chance = a.vs?.chance ?? null;
  const known = a.vs && a.vs.dc != null;
  const said = [a.name, a.cost != null ? t(costKey(a.cost), { cost: a.cost }) : "", `${a.skill.name} ${sign(a.mapMod ?? a.skill.mod)}`,
    a.vs ? `${t("GLRAIL.skill.vs")} ${a.vs.label}${known ? "" : " ??"}` : "", chance != null ? pctOf(chance) : "", a.secret ? t("GLRAIL.skill.secret") : ""].filter(Boolean).join(", ");
  return `<button type="button" class="gph-fa${sel ? " is-sel" : ""}${a.pinned ? " is-pinned" : ""}" role="option" aria-selected="${!!sel}" data-skill-action="${esc(a.id)}"${a.attack ? " data-attack" : ""}${/^[123]$/.test(String(a.cost)) ? ` data-cost="${a.cost}"` : ""} data-k="${k}" style="--k:${k}"
      title="${esc([a.name, a.vs ? `${t("GLRAIL.skill.vs")} ${a.vs.label}${a.vs.dc != null ? ` (DC ${a.vs.dc})` : ""}` : a.note ?? "", a.secret ? t("GLRAIL.skill.secretTitle") : ""].filter(Boolean).join(" · "))}" aria-label="${esc(said)}">
    ${actionIcon(a.slug)}<b>${marked(a.name, query)}</b>${a.cost != null ? `<span class="gph-cost">${costGlyph(a.cost)}</span>` : ""}${a.secret ? ICON.secret : ""}
    ${withSkill ? `<i class="gph-cskill">${esc(a.skill.name.slice(0, 3))} ${sign(a.skill.mod)}</i>` : a.attack && a.mapMod !== a.skill.mod ? `<i class="gph-cmap">${sign(a.mapMod)}</i>` : ""}
    ${a.pinned ? `<span class="gph-pinmk" title="${esc(t("GLRAIL.skill.pinned"))}">${ICON.pin}</span>` : ""}<em class="gph-codds"${oddsTone(chance) ? ` data-tone="${oddsTone(chance)}"` : ""}>${a.vs ? (chance != null ? pctOf(chance) : known ? esc(t("GLRAIL.skill.dcShort", { dc: a.vs.dc })) : esc(t("GLRAIL.skill.unknown"))) : ""}</em>
  </button>`;
};

/* The selected action, said whole in the foot: what it rolls, against what,
   and whether the party knows that number — so the keyboard has what the
   pointer gets from a tooltip, and "??" is never a riddle. */
const SELINE = (a, f, t) => {
  const mod = sign(a.mapMod ?? a.skill.mod);
  const vs = a.vs
    ? `${esc(t("GLRAIL.skill.vs"))} ${esc(a.vs.label)} ${a.vs.dc != null ? `<b>${a.vs.stat === "recall" || a.vs.stat === "dc" ? esc(a.vs.dc) : esc(t("GLRAIL.skill.dcShort", { dc: a.vs.dc }))}</b>` : `<i>${esc(t("GLRAIL.skill.dcUnknown"))}</i>`}`
    : f.target || !a.note ? "" : esc(a.note);
  const odds = a.vs?.chance != null ? `<em${oddsTone(a.vs.chance) ? ` data-tone="${oddsTone(a.vs.chance)}"` : ""}>${esc(t("GLRAIL.skill.chanceOf", { chance: pctOf(a.vs.chance) }))}</em>` : "";
  const hint = !a.vs && !f.target && !a.note ? esc(t("GLRAIL.skill.pickTarget")) : "";
  return `<p class="gph-fsel" aria-live="polite"><b>${esc(a.name)}</b><span>${esc(a.skill.name)} ${mod}</span>${vs ? `<span>${vs}</span>` : ""}${odds}${hint ? `<span class="gph-fdim">${hint}</span>` : ""}${a.secret ? `<span class="gph-fdim">${esc(t("GLRAIL.skill.secretTitle"))}</span>` : ""}</p>`;
};

export const FINDER = (f, t) => {
  let k = 0;
  const sel = f.sel ?? 0;
  /* A column shows its first six (pins first); the untrained column starts
     folded, since a +1 action is rarely the one to take. Typing opens all. */
  const CAP = 6;
  let picked = null;
  const cols = f.columns.map((c, ci) => {
    const cap = c.key === "untrained" ? 0 : CAP;
    const open = f.query || f.expanded?.includes(c.key) || c.actions.length <= cap + 1;
    const list = open ? c.actions : c.actions.slice(0, cap);
    return `
      <section class="gph-scol${c.key === "untrained" ? " is-untrained" : ""}" aria-label="${esc(c.name)}" style="--c:${ci}">
        ${c.key === "untrained" ? `<h3 class="gph-shead is-plain">${esc(t("GLRAIL.skill.untrained"))}</h3>`
          : `<button type="button" class="gph-shead"${c.rank != null ? ` data-rank="${c.rank}"` : ""} data-check="${c.check ?? `skill:${esc(c.key)}`}" title="${esc(t("GLRAIL.check.roll", { name: c.name }))}">
          <b>${esc(c.name)}</b>${RANK_TAG(c.rank, t)}<em>${sign(c.mod)}</em></button>`}
        <div class="gph-chips-v">${list.map((a) => { const i = k++; if (i === sel) picked = a; return CHIP(a, t, i === sel, i, { withSkill: c.key === "untrained", query: f.query }); }).join("")}${open ? "" : `<button type="button" class="gph-more" data-act="expand-col" data-col="${esc(c.key)}">${esc(t("GLRAIL.more", { n: c.actions.length - cap }))}</button>`}</div>
      </section>`;
  }).join("");
  return `
<section class="gph-finder" role="dialog" aria-label="${esc(t("GLRAIL.skill.title"))}" data-finder>
  <header class="gph-fhead">
    <label class="gph-search">${ICON.search}<input type="search" data-find value="${esc(f.query ?? "")}" placeholder="${esc(t("GLRAIL.skill.placeholder"))}" aria-label="${esc(t("GLRAIL.skill.find"))}" autocomplete="off" spellcheck="false" aria-controls="gph-results"></label>
    ${f.target ? `<span class="gph-tgt is-big">${f.target.img ? `<img src="${esc(f.target.img)}" alt="">` : ""}<span>${esc(t("GLRAIL.skill.vs"))}</span><b>${esc(f.target.name)}</b>${f.target.known ? `<em>${esc(f.target.known)}</em>` : ""}</span>` : `<span class="gph-tgt is-big is-none">${esc(t("GLRAIL.skill.noTarget"))}</span>`}
    ${f.map ? `<span class="gph-fmap">${esc(t("GLRAIL.turnbar.map"))} <b>${["0", "−5", "−10"][f.map]}</b></span>` : ""}
    <button type="button" class="gph-x" data-act="close" aria-label="${esc(t("GLRAIL.close"))}">${ICON.close}</button>
  </header>
  <div class="gph-results" id="gph-results" role="listbox" aria-label="${esc(t("GLRAIL.skill.results"))}">
    ${f.columns.length ? `<div class="gph-scols">${cols}</div>` : `<p class="gph-fnone">${esc(t("GLRAIL.skill.none", { q: f.query ?? "" }))}</p>`}
  </div>
  ${f.checks?.length ? `<footer class="gph-fchecks"><span>${esc(t("GLRAIL.group.checks"))}</span>${f.checks.map((s) => `<button type="button" class="gph-cchk" data-check="skill:${esc(s.slug)}" title="${esc(t("GLRAIL.check.roll", { name: s.name }))}"><b>${esc(s.name)}</b>${s.rank > 0 ? RANK_TAG(s.rank, t) : ""}<em>${sign(s.mod)}</em></button>`).join("")}</footer>` : ""}
  <footer class="gph-ffoot">${picked ? SELINE(picked, f, t) : ""}<span class="gph-fhint"><span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ${esc(t("GLRAIL.skill.hintMove"))}</span><span><kbd>↵</kbd> ${esc(t("GLRAIL.skill.hintRoll"))}</span><span><kbd>1</kbd>–<kbd>3</kbd> ${esc(t("GLRAIL.skill.hintMap"))}</span><span><kbd>P</kbd> ${esc(t("GLRAIL.skill.hintPin"))}</span><span><kbd>Esc</kbd> ${esc(t("GLRAIL.close"))}</span></span></footer>
</section>`;
};

/* ── drawers ──────────────────────────────────────────────────────
   A drawer is a plate that rises above the rail (placeDrawer). One at a
   time. Rows: a name, what it says about itself, and the number at the
   right edge, where the eye goes down a column of numbers. */
export const DRAWER = ({ title, note, body, wide }) => `
<section class="gph-drawer${wide ? " is-wide" : ""}" role="dialog" aria-label="${esc(title)}">
  <header><b>${esc(title)}</b>${note ? `<span>${note}</span>` : ""}<button type="button" class="gph-x" data-act="close" aria-label="${esc(title)}">${ICON.close}</button></header>
  <div class="gph-dbody">${body}</div>
</section>`;

export const DLIST = ({ rows, empty }, t) => (rows.length ? `
<ul class="gph-dlist">${rows.map((r) => r.head ? `<li class="gph-dhead">${esc(r.head)}</li>` : `
  <li>${r.act ? `<button type="button" class="gph-drow${r.spent ? " is-spent" : ""}" data-row="${esc(r.key)}"${r.title ? ` title="${esc(r.title)}"` : ""}>` : '<div class="gph-drow is-read">'}
    ${r.cost != null ? `<span class="gph-cost">${glyph(r.cost, t)}</span>` : ""}
    ${r.icon ? `<img src="${esc(r.icon)}" alt="">` : ""}<b>${esc(r.name)}</b>${r.meta ? `<span>${esc(r.meta)}</span>` : ""}${r.tag ? `<i class="gph-tag"${r.tagTone ? ` data-tone="${r.tagTone}"` : ""}>${esc(r.tag)}</i>` : ""}${r.n != null ? `<em>${esc(r.n)}</em>` : ""}
  ${r.act ? "</button>" : "</div>"}</li>`).join("")}
</ul>` : `<p class="gph-dnone">${esc(empty ?? t("GLRAIL.drawer.empty"))}</p>`);

export const REST = (t) => `
<div class="gph-rest">
  <button type="button" class="gph-rb" data-row="rest:night"><b>${esc(t("GLRAIL.rest.night"))}</b><span>${esc(t("GLRAIL.rest.nightNote"))}</span></button>
</div>`;

export const MACROS = ({ page, slots }, t) => `
<div class="gph-macros">${slots.map((m, i) => m ? `
  <button type="button" class="gph-mac" data-row="macro:${esc(m.id)}" title="${esc(m.name)}">
    <span class="gph-mk">${(i + 1) % 10}</span>${m.img ? `<img src="${esc(m.img)}" alt="">` : ""}<b>${esc(m.name)}</b></button>` : `
  <span class="gph-mac is-empty"><span class="gph-mk">${(i + 1) % 10}</span></span>`).join("")}
</div>
<p class="gph-dnote">${esc(t("GLRAIL.macros.page", { n: page }))}</p>`;

/** The spell-rank picker the dial's numeral opens. */
export const RANKS = (h, t) => DLIST({
  rows: h.ranks.map((r) => ({
    key: `rank:${r.key}`, act: true, name: rankName(r.key, t), meta: t("GLRAIL.rank.cardsN", { n: r.cards }),
    n: r.key === "f" && h.focus ? `${h.focus[0]}/${h.focus[1]}` : r.slots ? `${r.slots[0]}/${r.slots[1]}` : null,
    spent: r.slots ? r.slots[0] === 0 : false,
  })),
}, t);

/* ── the peek ─────────────────────────────────────────────────────
   A strike, a spell, an action or a feat, whole, over the thing it is a
   peek of, with that thing's own presses under it — the presses the chat
   card offers, so it can be used without posting it first. */
export const PEEK = ({ name, from, traits = [], lines = [], text = "", actions = [], tone }, t) => `
<div class="gph-peek"${tone ? ` data-tone="${tone}"` : ""}>
  <article class="gph-rule">
    <header><b>${esc(name)}</b>${from ? `<span>${from}</span>` : ""}</header>
    ${traits.length ? `<ul class="gph-traits">${traits.map((x) => `<li${x.tone ? ` data-tone="${x.tone}"` : ""}>${esc(x.label ?? x)}</li>`).join("")}</ul>` : ""}
    ${lines.length ? `<dl class="gph-lines">${lines.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
    ${text ? `<div class="gph-text">${text}</div>` : ""}
  </article>
  ${actions.length ? `<div class="gph-pacts">${actions.map((a) => `
    <button type="button" class="gph-pa${a.primary ? " is-primary" : ""}" data-pa="${esc(a.id)}"${a.cost != null && /^[123]$/.test(String(a.cost)) ? ` data-cost="${a.cost}"` : ""}${a.disabled ? ` aria-disabled="true" title="${esc(a.disabled)}"` : ""}>${
      a.cost != null ? `<span class="gph-cost">${costGlyph(a.cost, "")}</span>` : ""}<b>${esc(a.label)}</b></button>`).join("")}</div>` : ""}
</div>`;

/* ── the party seat ───────────────────────────────────────────────
   A round portrait with its Hit Points bent round it, the stream kit's
   geometry (110° to 300°). One continuous arc lit from its start to the
   fraction left, red under a quarter; temporary Hit Points a thin outer arc
   in info blue. A seat the viewer may only see LIMITED of carries no ring
   and no numbers: the portrait, the name and what is visibly wrong. */
export const SEAT_FROM = 110;
export const SEAT_TO = 300;
const RING = 64 / 184, TRING = 76 / 184, DISC = 52 / 184;
const point = (c, r, deg) => { const a = (deg * Math.PI) / 180; return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`; };
const arc = (c, r, from, to) => `M${point(c, r, from)}A${r.toFixed(2)} ${r.toFixed(2)} 0 ${to - from > 180 ? 1 : 0} 1 ${point(c, r, to)}`;
export const seatArcLen = (r) => (r * (SEAT_TO - SEAT_FROM) * Math.PI) / 180;

const seatSaid = (s, t) => [s.name,
  s.hp ? t("GLRAIL.seat.hp", { v: s.hp[0], max: s.hp[1] }) : "", s.temp ? t("GLRAIL.vitals.temp", { n: s.temp }) : "",
  s.ac != null ? t("GLRAIL.vitals.acSaid", { n: s.ac }) : "", s.hero ? t("GLRAIL.hero.count", { n: s.hero[0], max: s.hero[1] }) : "",
  s.turn ? t("GLRAIL.seat.turn") : "", s.note ?? ""].filter(Boolean).join(", ");

export const SEAT = (s, t) => {
  const size = s.size ?? 60, c = size / 2, d = DISC * size, r = RING * size, tr = TRING * size;
  const hpF = s.hp ? frac(s.hp[0], s.hp[1]) : 0, tF = s.hp && s.temp ? frac(s.temp, s.hp[1]) : 0;
  const clip = `gphc-${esc(s.id ?? "x")}`;
  return `
<div class="gph-seat${s.self ? " is-self" : ""}${s.turn ? " is-turn" : ""}"${s.id ? ` data-seat="${esc(s.id)}"` : ""}${s.state ? ` data-state="${s.state}"` : ""}${s.hp && hpState(...s.hp) ? ' data-low=""' : ""}
  style="--gph-sz:${size}px;--gph-len:${seatArcLen(r).toFixed(2)};--gph-tlen:${seatArcLen(tr).toFixed(2)};--gph-f:${hpF.toFixed(4)};--gph-tf:${tF.toFixed(4)}" role="img" aria-label="${esc(seatSaid(s, t))}" data-name="${esc(s.name)}">
  <svg class="gph-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <defs><clipPath id="${clip}"><circle cx="${c}" cy="${c}" r="${d.toFixed(2)}"/></clipPath></defs>
    <circle class="gph-well" cx="${c}" cy="${c}" r="${(d + 1.5).toFixed(2)}"/>
    ${s.img ? `<image href="${esc(s.img)}" x="${(c - d).toFixed(2)}" y="${(c - d).toFixed(2)}" width="${(2 * d).toFixed(2)}" height="${(2 * d).toFixed(2)}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${clip})"/>` : ""}
    <circle class="gph-lip" cx="${c}" cy="${c}" r="${d.toFixed(2)}"/>
    ${s.hp ? `<path class="gph-band" d="${arc(c, r, SEAT_FROM - 2, SEAT_TO + 2)}"/><path class="gph-arc" d="${arc(c, r, SEAT_FROM, SEAT_TO)}"/><path class="gph-tarc" d="${arc(c, tr, SEAT_FROM, SEAT_TO)}"/>` : ""}
  </svg>
  <span class="gph-sid">
    <b class="gph-sname">${esc(s.name)}</b>
    <span class="gph-ssub">${s.ac != null ? `<span class="gph-sac">${esc(t("GLRAIL.vitals.ac"))} <b>${s.ac}</b></span>` : ""}${s.note ? `<span class="gph-snote">${esc(s.note)}</span>` : s.hp ? `<span class="gph-shp"><b data-v>${s.hp[0]}</b>/${s.hp[1]}</span>` : ""}</span>
    ${s.hero ? `<span class="gph-shero" aria-hidden="true">${Array.from({ length: s.hero[1] }, (_, i) => `<i class="${i < s.hero[0] ? "on" : ""}"></i>`).join("")}</span>` : ""}
  </span>
</div>`;
};

/* ── the GM's creature panel ──────────────────────────────────────
   AC leads, as on the player's vitals. Then the Hit Points the GM marks,
   the three saves and Perception as presses, and the line read before
   deciding what the party knows: level, the Recall Knowledge DC, and the
   creature's own skill actions through the same finder the players use.
   The moves are the strikes as rows of MAP presses, then the abilities as
   chips in PF2e's glyph; nothing is lost silently under the panel's edge. */
const NPC_STRIKE = (s, t) => `
    <div class="gph-nstk">
      <button type="button" class="gph-stn" data-strike="${esc(s.id)}" data-act="peek-strike" title="${esc(s.name)}"><b>${esc(s.short ?? s.name)}</b></button>
      ${s.variants.map((label, i) => `<button type="button" class="gph-map" data-strike="${esc(s.id)}" data-variant="${i}" aria-label="${esc(t("GLRAIL.strike.attack", { name: s.name, mod: label }))}">${esc(label)}</button>`).join("")}
      <button type="button" class="gph-dmg" data-dmg="${esc(s.id)}" title="${esc(s.damage ?? "")}" aria-label="${esc(t("GLRAIL.strike.dmgSaid", { name: s.name, f: s.damage ?? "" }))}">${esc(t("GLRAIL.strike.dmg"))}</button>
    </div>`;

const MOVE_CHIP = (a, t) => `<button type="button" class="gph-move" data-action="${esc(a.id)}" title="${esc(a.name)}">
      <span class="gph-cost">${glyph(a.cost, t)}</span><b>${esc(a.name)}</b></button>`;

const npcMoves = (strikes, abilities, t) => {
  const sRows = strikes.slice(0, 3);
  const room = (4 - sRows.length) * 2;
  const shown = abilities.length > room ? abilities.slice(0, room - 1) : abilities;
  const more = abilities.length - shown.length + Math.max(0, strikes.length - sRows.length);
  return `${sRows.map((s) => NPC_STRIKE(s, t)).join("")}
    <div class="gph-chips">${shown.map((a) => MOVE_CHIP(a, t)).join("")}${more ? `<button type="button" class="gph-move is-more" data-act="sheet"><b>${esc(t("GLRAIL.more", { n: more }))}</b></button>` : ""}</div>`;
};

export const CREATURE = (n, t) => `
<section class="gph-pl gph-npc" aria-label="${esc(n.name)}">
  <div class="gph-ac is-npc" role="img" aria-label="${esc(t("GLRAIL.vitals.acSaid", { n: n.ac }))}"><span aria-hidden="true">${esc(t("GLRAIL.vitals.ac"))}</span><b aria-hidden="true">${n.ac}</b></div>
  <div class="gph-npct">
    ${METER("hp", n.hp, t)}
    <div class="gph-checks">${CHECK("perception", n.perception, t, "perceptionShort")}${SAVES.map((s) => CHECK(s, n.saves[s], t, `${s}Short`)).join("")}</div>
    <div class="gph-know"><span>${esc(t("GLRAIL.gm.level", { n: n.level }))}${n.recallDC != null ? ` · ${esc(t("GLRAIL.gm.recall"))} <b>${n.recallDC}</b>` : ""}${n.adjust ? ` · <em>${esc(n.adjust)}</em>` : ""}</span>
      <button type="button" class="gph-kbtn" data-act="finder">${ICON.skills}${esc(t("GLRAIL.tab.skills"))}</button></div>
  </div>
  <div class="gph-moves">${npcMoves(n.strikes ?? [], n.abilities ?? [], t)}</div>
</section>`;

/* A hazard leads with how it is found (Stealth) and how it is stopped (the
   disable line); its defences appear only where it has them. */
export const HAZARD = (z, t) => `
<section class="gph-pl gph-npc is-hazard" aria-label="${esc(z.name)}">
  <div class="gph-ac is-npc is-dc" role="img" aria-label="${esc(t("GLRAIL.hazard.stealthSaid", { n: z.stealthDC }))}"><span aria-hidden="true">${esc(t("GLRAIL.hazard.stealth"))}</span><b aria-hidden="true">${z.stealthDC}</b></div>
  <div class="gph-npct">
    ${z.hp ? METER("hp", z.hp, t) : ""}
    <p class="gph-disable"><b>${esc(t("GLRAIL.hazard.disable"))}</b> ${esc(z.disable)}</p>
    <div class="gph-know"><span>${esc(t("GLRAIL.gm.level", { n: z.level }))}${z.ac != null ? ` · ${esc(t("GLRAIL.vitals.ac"))} <b>${z.ac}</b>` : ""}${z.hardness != null ? ` · ${esc(t("GLRAIL.hazard.hardness", { n: z.hardness }))}` : ""}${z.complex ? ` · <em>${esc(t("GLRAIL.hazard.complex"))}</em>` : ""}</span></div>
  </div>
  <div class="gph-moves">${npcMoves([], z.abilities ?? [], t)}</div>
</section>`;

/* The GM's hand is every non-PC token on the scene: painting, level on the
   pennant, disposition as the card's tone edge, a Hit Point line along its
   top. Hostile first, then scene order within each, so the hand never
   reshuffles when a token is selected. Shared leading words drop; a name
   held more than once is numbered. */
const sharedHead = (names) => {
  if (names.length < 2) return 0;
  const split = names.map((n) => n.split(" "));
  let k = 0;
  while (split.every((w) => w.length > k + 1 && w[k] === split[0][k])) k++;
  return k;
};
export const shortNames = (names) => {
  const k = sharedHead(names);
  const base = names.map((n) => n.split(" ").slice(k).join(" "));
  const total = {}, seen = {};
  for (const b of base) total[b] = (total[b] ?? 0) + 1;
  /* the number is glued to the last word, so a wrapping name never strands it */
  return base.map((b) => (total[b] > 1 ? `${b}\u00a0${(seen[b] = (seen[b] ?? 0) + 1)}` : b));
};

/* A hand holds ten. Past that the last card is the rest, as a count that
   opens the whole list, and the selected creature always keeps its card: a
   card narrower than its pennant and name cannot be told apart or hit. */
export const FOE_CAP = 10;
const foeCards = (foes, selected) => {
  if (foes.length <= FOE_CAP) return { cards: foes, more: 0 };
  const cards = foes.slice(0, FOE_CAP - 1);
  const sel = foes.find((f) => f.id === selected);
  if (sel && !cards.includes(sel)) cards[cards.length - 1] = sel;
  return { cards, more: foes.length - cards.length };
};

export const FOES = ({ foes: all, selected }, t) => {
  const names = shortNames(all.map((f) => f.name));
  const { cards: foes, more } = foeCards(all, selected);
  const nameOf = new Map(all.map((f, i) => [f, names[i]]));
  const items = foes.map((f) => ({ sel: f.id === selected, html: `
    <button type="button" class="gph-card is-foe" data-foe="${esc(f.id)}" data-disp="${esc(f.disp ?? "neutral")}"${f.state ? ` data-state="${f.state}"` : ""}${f.hp && hpState(f.hp[0], f.hp[1]) ? ' data-low=""' : ""}${f.turn ? " data-turn" : ""}
      aria-label="${esc([f.name, t(`GLRAIL.disp.${f.disp ?? "neutral"}`), f.hp ? t("GLRAIL.seat.hp", { v: f.hp[0], max: f.hp[1] }) : "", f.state ? t(`GLRAIL.state.${f.state}`) : "", f.turn ? t("GLRAIL.seat.turn") : ""].filter(Boolean).join(", "))}"
      aria-pressed="${f.id === selected}" style="--gph-f:${f.hp ? frac(f.hp[0], f.hp[1]).toFixed(4) : 1}">
      <span class="gph-art"${f.img ? ` style="background-image:url('${esc(f.img)}')"` : ""}></span>
      <span class="gph-pen" aria-hidden="true">${f.level}</span>
      ${f.hp ? '<span class="gph-mini" aria-hidden="true"><i></i></span>' : ""}
      <b class="gph-cname" aria-hidden="true">${esc(nameOf.get(f))}</b>
      ${f.state ? `<span class="gph-cstate" aria-hidden="true">${esc(t(`GLRAIL.state.${f.state}`))}</span>` : ""}
    </button>` }));
  if (more) items.push({ html: `
    <button type="button" class="gph-card is-foe is-more" data-drawer="foes" aria-label="${esc(t("GLRAIL.gm.moreFoes", { n: more }))}">
      <b class="gph-cmore">+${more}</b><span class="gph-cname">${esc(t("GLRAIL.gm.moreShort"))}</span></button>` });
  return `
<section class="gph-pl gph-hand gph-foes"${items.length > 6 ? " data-dense" : ""} style="--n:${items.length}" aria-label="${esc(t("GLRAIL.gm.foes", { n: all.length }))}">
  ${FAN(items, " is-foes", t("GLRAIL.gm.foes", { n: all.length }))}
</section>`;
};

export const EMPTY = (t) => `
<section class="gph-pl gph-empty"><b>${esc(t("GLRAIL.empty.title"))}</b><span>${esc(t("GLRAIL.empty.body"))}</span></section>`;

/* ── the whole rail ───────────────────────────────────────────────
   `o.role` is "player" or "gm"; `o.mode` is "encounter" or "exploration";
   `o.slim` draws the creature rail a familiar or a player-owned NPC gets.
   `o.overlay` is whatever panel is risen over the rail (a drawer, the
   finder) and `o.peek` the open peek, both already built by the host. */
export const RAIL = (o, t) => {
  const body = o.role === "gm"
    ? (o.hazard ? HAZARD(o.hazard, t) : o.creature ? CREATURE(o.creature, t) : o.foes?.foes?.length ? "" : EMPTY(t)) + (o.foes?.foes?.length ? FOES(o.foes, t) : "")
    : VITALS(o.vitals, t) + STRIKES(o.strikes ?? { list: [] }, t) + DECK(o.deck, t) + (o.slim ? "" : UTIL(o.util, t));
  return `
<div class="gph" data-role="${o.role}" data-mode="${o.mode ?? "exploration"}" data-map="${o.turnbar?.map ?? 0}" style="--gph-map:${o.turnbar?.map ?? 0}"${o.slim ? " data-slim" : ""}${o.folded ? " data-folded" : ""}${o.readonly ? " data-readonly" : ""}${o.role !== "gm" && (o.plinth?.dead || o.plinth?.dying) ? ` data-down="${o.plinth.dead ? "dead" : "dying"}"` : ""}${o.overlay ? " data-overlay" : ""}>
  ${o.stack?.length ? `<div class="gph-stack" role="group" aria-label="${esc(t("GLRAIL.party"))}">${o.stack.map((s) => SEAT(s, t)).join("")}</div>` : ""}
  <div class="gph-rail">
    ${PLINTH({ ...o.plinth, folded: o.folded }, t, { readonly: o.readonly })}
    <div class="gph-body">${o.turnbar && o.role !== "gm" ? TURNBAR(o.turnbar, t) : ""}${body}</div>
  </div>
  ${o.overlay ?? ""}
  ${o.peek ?? ""}
</div>`;
};
