/**
 * The odds panel inside PF2e's roll dialog.
 *
 * `CheckModifiersDialog` (pf2e.mjs, `var CheckModifiersDialog = class extends
 * foundry.appv1.api.Application`) already holds everything a probe would ask
 * for: `check` is the live CheckModifier (`totalModifier`, `modifiers`) and
 * `context` carries the DC, the degree adjustments, fortune and the roll
 * options. So nothing is probed here — the panel is built straight from the
 * dialog's own state, and it follows every box the player ticks.
 *
 * PF2e re-renders the whole dialog on a modifier or substitution click, so the
 * panel is rebuilt each render from the PREVIOUS model and then updated to the
 * new one in place: that is what plays the narrowing and count beats. The
 * fortune radios do not re-render the dialog, so the panel listens to them.
 *
 * The damage dialog shares the `roll-modifiers-dialog` class; it has no
 * `check`, which is what the fallback match keys on.
 */

import { SETTINGS } from "./constants.mjs";
import { flatDcFor, modelFromProbe } from "./model-from-probe.mjs";
import { modsOf, rollModeOf } from "./probe.mjs";
import { badgeHTML, updateBadge } from "./render.mjs";
import { get } from "./settings.mjs";
import { modelFor, nameFor, seesTruth } from "./view.mjs";
import { motionScale } from "../../core/theme.mjs";
import { escapeHTML } from "../../core/util.mjs";

const ORDINAL = ["GLOD.attack.first", "GLOD.attack.second", "GLOD.attack.third"];
const MAX_OTHERS = 6;

const t = (k) => game.i18n.localize(k);
const on = () => !!get(SETTINGS.dialog, true);

const rootOf = (app, html) => {
  const el = html?.[0] ?? html ?? app?.element?.[0] ?? null;
  return el instanceof HTMLElement ? el : null;
};

const isCheckDialog = (app, root) =>
  !!app?.check && !!app?.context && (app.constructor?.name === "CheckModifiersDialog" || !!root?.classList?.contains("dice-checks"));

/** The dialog's own fortune radio, then the probe's rule (substitutions fix the face). */
function rollTwiceOf(context, root) {
  const radio = root?.querySelector?.("[data-roll-twice] input[type=radio]:checked");
  const chosen = radio ? radio.value || false : context.rollTwice ?? false;
  return rollModeOf(chosen, context.substitutions ?? []);
}

const isSave = (context) => context.type === "saving-throw";

function isAttack(context) {
  if (context.type === "attack-roll" || context.type === "spell-attack-roll") return true;
  const opts = context.options;
  if (opts?.has?.("attack") || opts?.has?.("trait:attack")) return true;
  return [...(context.traits ?? [])].some((tr) => (typeof tr === "string" ? tr : tr?.name) === "attack");
}

/** Roller and defender, by the d20: a save's roller is its target. */
function rolesOf(context) {
  if (isSave(context)) return { roller: context.target?.actor ?? context.actor ?? null, defender: context.origin?.actor ?? null, token: null };
  return { roller: context.origin?.actor ?? context.actor ?? null, defender: context.target?.actor ?? null, token: context.target?.token ?? null };
}

const docOf = (t) => t?.document ?? t ?? null;

const nameOf = (token, actor) => nameFor(token, actor);

/** The dialog's own state in the probe's shape. */
function probeOf(app, root) {
  const { check, context } = app;
  const dc = context.dc;
  if (!Number.isFinite(dc?.value)) return null;
  const options = context.options instanceof Set ? [...context.options] : [...(context.options ?? [])];
  return {
    mod: check.totalModifier,
    mods: modsOf(check),
    dc: { value: dc.value, slug: dc.slug ?? null },
    dcStatistic: dc.statistic ?? null,
    dos: (context.dosAdjustments ?? []).map((d) => ({
      adjustments: d.adjustments,
      test: (o) => (d.predicate?.test ? d.predicate.test(o) : true),
    })),
    options,
    rollTwice: rollTwiceOf(context, root),
    type: context.type ?? null,
  };
}

function primaryModel(app, root) {
  const { context } = app;
  const probe = probeOf(app, root);
  if (!probe) return null;
  const { roller, defender } = rolesOf(context);
  if (!roller) return null;
  const attack = isAttack(context);
  const map = Math.max(0, Math.min(2, Number(context.mapIncreases) || 0));
  const save = isSave(context);
  return modelFromProbe({
    probe,
    roller,
    targetActor: defender,
    truth: seesTruth(),
    stamps: attack ? "attack" : "check",
    label: String(app.title ?? context.title ?? "").trim(),
    sub: attack ? ORDINAL[map] : "",
    flatDc: attack ? flatDcFor(defender) : null,
    // Only a spell's save DC is the caster's spell DC (a breath weapon's is not).
    dcStat: save ? (context.item?.type === "spell" ? "spell-dc" : null) : undefined,
    dcPublic: !!context.dc?.visible || !!game.pf2e?.settings?.metagame?.dcs,
  });
}

/** The armed descriptor this dialog's roll corresponds to, for re-pricing it against other targets. */
function actionOf(context, roller) {
  const item = context.item;
  if (!item) return null;
  if (item.type === "spell" && item.uuid) return { kind: "spell", uuid: item.uuid, mode: "attack" };
  if (context.action !== "strike" && context.type !== "attack-roll") return null;
  const strike = (roller?.system?.actions ?? []).find((s) => s?.item?.id === item.id);
  const slug = strike?.slug ?? strike?.item?.slug ?? null;
  return slug ? { kind: "strike", slug } : null;
}

/** One compact row per other target. Async: each is a probe. */
async function fillOthers(app, panel, gen) {
  const { context } = app;
  if (!isAttack(context) || (game.user.targets?.size ?? 0) < 2) return;
  const { roller, defender } = rolesOf(context);
  const action = actionOf(context, roller);
  if (!roller || !action) return;
  const others = [...game.user.targets].filter((tk) => tk?.actor && tk.actor !== defender && tk.actor !== roller).slice(0, MAX_OTHERS);
  if (!others.length) return;
  const list = document.createElement("div");
  list.className = "glod-dialog-others";
  list.innerHTML = `<div class="glod-dialog-others-head">${escapeHTML(t("GLOD.dialog.others"))}</div>`;
  panel.append(list);
  const map = Math.max(0, Math.min(2, Number(context.mapIncreases) || 0));
  const rollerToken = docOf(context.origin?.token)?.object ?? roller.getActiveTokens?.()[0] ?? null;
  for (const target of others) {
    if (app._glodGen !== gen || !list.isConnected) return;
    let model = null;
    try {
      model = await modelFor({ roller, rollerToken, target, action, map });
    } catch {
      model = null;
    }
    if (app._glodGen !== gen || !list.isConnected) return;
    if (!model) continue;
    const row = document.createElement("div");
    row.className = "glod-dialog-row";
    row.innerHTML = badgeHTML(model, { t, target: nameOf(target, target.actor) });
    list.append(row);
    app.setPosition?.({ height: "auto" });
  }
  if (!list.querySelector(".glod-dialog-row")) list.remove();
}

function mount(app, root) {
  const form = root.querySelector("form.check-modifiers-content") ?? root.querySelector("form");
  if (!form) return;
  root.querySelector(".glod-dialog")?.remove();
  const gen = (app._glodGen = (app._glodGen ?? 0) + 1);
  const next = primaryModel(app, root);
  if (!next) {
    app._glodModel = null;
    return;
  }
  const { context } = app;
  const { defender, token } = rolesOf(context);
  const opts = { t, target: isSave(context) ? "" : nameOf(token, defender), motion: motionScale() };

  const panel = document.createElement("section");
  panel.className = "glod-dialog";
  const prev = app._glodModel;
  panel.innerHTML = badgeHTML(prev ?? next, opts);
  form.prepend(panel);
  if (prev) {
    const el = panel.querySelector(".glod-badge");
    if (el) updateBadge(el, prev, next, opts);
  }
  app._glodModel = next;

  // Fortune radios change the odds without a re-render.
  for (const radio of root.querySelectorAll("[data-roll-twice] input[type=radio]")) {
    radio.addEventListener("change", () => {
      try {
        const now = primaryModel(app, root);
        const el = panel.querySelector(".glod-badge");
        if (!now || !el) return;
        updateBadge(el, app._glodModel, now, { ...opts, motion: motionScale() });
        app._glodModel = now;
      } catch {
        /* the dialog still rolls */
      }
    });
  }

  app.setPosition?.({ height: "auto" });
  fillOthers(app, panel, gen).catch(() => {});
}

function onRender(app, html) {
  try {
    if (!on()) return;
    const root = rootOf(app, html);
    if (!root || !isCheckDialog(app, root)) return;
    mount(app, root);
  } catch {
    /* never break PF2e's dialog */
  }
}

export function wireDialog() {
  Hooks.on("renderCheckModifiersDialog", onRender);
  // A bundler rename would change the class name; catch it by shape, once.
  Hooks.on("renderApplication", (app, html) => {
    if (app?.constructor?.name === "CheckModifiersDialog") return;
    onRender(app, html);
  });
}
