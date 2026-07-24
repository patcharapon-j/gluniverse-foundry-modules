/**
 * GLUniverse Suite — Mobile feature: the phone app shell.
 *
 * One thing on screen at a time, switched by a thumb-reachable bottom tab bar:
 *   Canvas | Chat | Character | Suite
 * The shell only manipulates visibility/body state; the heavy lifting (hiding
 * desktop chrome, full-screen geometry) is CSS scoped under `body.gl-mobile`
 * in styles/mobile.css. While a non-canvas tab is fronted the PIXI ticker is
 * frozen to save battery.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { KEY_MODE } from "./detect.mjs";
import { setCanvasFrozen } from "./perf.mjs";

const TABS = [
  { id: "canvas", icon: "fa-solid fa-map", label: "GLMOB.tab.canvas" },
  { id: "chat", icon: "fa-solid fa-comments", label: "GLMOB.tab.chat" },
  { id: "character", icon: "fa-solid fa-user", label: "GLMOB.tab.character" },
  { id: "suite", icon: "fa-solid fa-layer-group", label: "GLMOB.tab.suite" },
];

/** Feature ids offered in the Suite tab, in display order. Player-facing only. */
const SUITE_TAB_FEATURES = ["destiny-dice", "clocks-tracker", "timer", "oracles", "insight", "minimap"];

export const Shell = {
  active: "canvas",
  bar: null,
  panel: null,

  mount() {
    document.body.classList.add("gl-mobile");
    this._buildTabBar();
    this._buildSuitePanel();
    this._wireChatSendButton();
    this._wireCombatBanner();
    this._wireRollResults();
    this.select("canvas");
  },

  _buildTabBar() {
    const bar = document.createElement("nav");
    bar.className = "gl-mobile-tabbar gl-glass";
    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gl-mobile-tab";
      btn.dataset.tab = tab.id;
      btn.innerHTML = `<i class="${tab.icon}"></i><span>${game.i18n.localize(tab.label)}</span>`;
      btn.addEventListener("click", () => this.select(tab.id));
      bar.appendChild(btn);
    }
    document.body.appendChild(bar);
    this.bar = bar;
  },

  select(tabId) {
    this.active = tabId;
    document.body.dataset.glMobileView = tabId;
    this.bar?.querySelectorAll(".gl-mobile-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    this.panel?.classList.toggle("open", tabId === "suite");
    setCanvasFrozen(tabId !== "canvas");

    if (tabId === "chat") this._frontChat();
    else if (tabId === "canvas") ui.sidebar?.collapse?.();
    else if (tabId === "character") this._openCharacter();
  },

  _frontChat() {
    try {
      ui.sidebar?.expand?.();
      // v13 ApplicationV2 sidebar vs older API — try both tab-change shapes.
      if (typeof ui.sidebar?.changeTab === "function") ui.sidebar.changeTab("chat", "primary");
      else ui.sidebar?.activateTab?.("chat");
    } catch {
      /* sidebar not ready */
    }
  },

  _openCharacter() {
    const actor = game.user.character ?? game.actors?.find((a) => a.isOwner && a.hasPlayerOwner);
    if (!actor) {
      ui.notifications?.warn(game.i18n.localize("GLMOB.noCharacter"));
      this.select("canvas");
      return;
    }
    actor.sheet?.render(true);
  },

  _buildSuitePanel() {
    const panel = document.createElement("section");
    panel.className = "gl-mobile-suite gl-glass";
    const list = document.createElement("div");
    list.className = "gl-mobile-suite-list";

    for (const id of SUITE_TAB_FEATURES) {
      if (!Suite.enabled(id)) continue;
      const def = Suite.get(id);
      const open = this._featureOpener(id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gl-btn gl-mobile-suite-item";
      btn.innerHTML = `<i class="${def.icon}"></i><span>${game.i18n.localize(def.title)}</span>`;
      if (open) btn.addEventListener("click", () => open());
      else {
        btn.disabled = true;
        btn.title = game.i18n.localize("GLMOB.notMobileReady");
      }
      list.appendChild(btn);
    }

    // Escape hatch: force mobile mode off from within mobile mode (Q4).
    const exit = document.createElement("button");
    exit.type = "button";
    exit.className = "gl-btn gl-mobile-suite-exit";
    exit.innerHTML = `<i class="fa-solid fa-display"></i><span>${game.i18n.localize("GLMOB.exitMobile")}</span>`;
    exit.addEventListener("click", async () => {
      await game.settings.set(SUITE_ID, KEY_MODE, "off");
      foundry.utils.debouncedReload();
    });

    panel.append(list, exit);
    document.body.appendChild(panel);
    this.panel = panel;
  },

  /** A feature is mobile-openable when its registered api exposes openMobile/open. */
  _featureOpener(id) {
    const api = game.modules.get(SUITE_ID)?.api?.features?.[id] ?? Suite.get(id)?.api;
    const fn = api?.openMobile ?? api?.open;
    return typeof fn === "function" ? () => fn.call(api) : null;
  },

  /** Mobile keyboards have no reliable Enter-to-send; add an explicit button. */
  _wireChatSendButton() {
    const inject = () => {
      const input = document.querySelector("#chat-message");
      if (!input || input.parentElement.querySelector(".gl-mobile-send")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gl-mobile-send gl-btn";
      btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i>`;
      btn.addEventListener("click", () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      });
      input.insertAdjacentElement("afterend", btn);
    };
    Hooks.on("renderChatLog", inject);
    inject();
  },

  /**
   * Cinematic compact result bar: every visible chat message surfaces as a
   * dismissable toast at the top of the screen, so players never need to
   * front the full chat tab to see a result. Rolls wait for the Dice So Nice
   * 3D animation (when installed) before appearing, and a player's own roll
   * collapses their sheet back to the canvas so the dice are visible.
   */
  _wireRollResults() {
    const wrap = document.createElement("div");
    wrap.className = "gl-mobile-toasts";
    document.body.appendChild(wrap);

    Hooks.on("createChatMessage", (msg) => {
      // Own roll while the sheet is up → drop back to the map to watch it.
      if (msg.isRoll && msg.author?.id === game.user.id && this.active === "character") this.select("canvas");
      if (msg.visible === false) return;

      let shown = false;
      const show = () => {
        if (shown) return;
        shown = true;
        this._showToast(msg, wrap);
      };
      // Sync the toast with the 3D dice landing when Dice So Nice is active.
      if (msg.isRoll && game.dice3d) {
        const hookId = Hooks.on("diceSoNiceRollComplete", (id) => {
          if (id !== msg.id) return;
          Hooks.off("diceSoNiceRollComplete", hookId);
          show();
        });
        setTimeout(() => {
          Hooks.off("diceSoNiceRollComplete", hookId);
          show();
        }, 8000);
      } else show();
    });
  },

  /**
   * System-aware toast payload. gluniverse-wod-v5 stamps its evaluated result
   * into the roll message's flags (roll cards) and the card DOM (Rouse /
   * Remorse / Frenzy checks), so the toast can show the actual game outcome —
   * successes vs difficulty, Messy Critical, Bestial Failure — instead of the
   * meaningless d10 sum. Returns null for anything else → generic fallback.
   */
  _systemResult(msg) {
    const f = msg.flags?.["gluniverse-wod-v5"];
    if (!f?.card) return null;
    if (f.card === "roll" && f.result) {
      const r = f.result;
      const OUTCOMES = {
        messy: ["Messy Critical", "messy"],
        critical: ["Critical Win", "crit"],
        success: ["Success", "win"],
        failure: ["Failure", "loss"],
        totalFailure: ["Total Failure", "loss"],
        bestial: ["Bestial Failure", "bestial"],
      };
      const [label, tone] = OUTCOMES[r.outcome] ?? [String(r.outcome ?? ""), "win"];
      // Difficulty 0 = open-ended (Storyteller judges) → just tally successes.
      const num = r.difficulty > 0 ? `${r.successes}/${r.difficulty}` : `${r.successes}`;
      return { what: f.flavor ?? "", num, label, tone };
    }
    // Check cards keep their outcome only in the rendered card markup.
    if (["rouse", "remorse", "frenzy"].includes(f.card)) {
      const d = document.createElement("div");
      d.innerHTML = msg.content ?? "";
      const success = d.querySelector(".gl-card")?.dataset.outcome === "success";
      const title = d.querySelector(".gl-card-flavor")?.textContent?.trim() ?? f.card;
      return { what: title, num: null, label: success ? "Success" : "Failure", tone: success ? "win" : "loss" };
    }
    return null;
  },

  _showToast(msg, wrap) {
    const strip = (html) => {
      const d = document.createElement("div");
      d.innerHTML = html ?? "";
      return d.textContent.replace(/\s+/g, " ").trim();
    };
    const who = msg.alias || msg.author?.name || "";
    const sys = this._systemResult(msg);
    let what;
    let resHTML = "";
    if (sys) {
      what = strip(sys.what);
      resHTML = `<span class="res tone-${sys.tone}">
        ${sys.num != null ? `<b class="num">${escapeHTML(sys.num)}</b>` : ""}
        <span class="lbl">${escapeHTML(sys.label)}</span></span>`;
    } else {
      const totals = msg.isRoll ? (msg.rolls ?? []).map((r) => r.total).join(" · ") : "";
      what = strip(msg.flavor);
      if (!what && !totals) what = strip(msg.content);
      if (!what && !totals) return;
      if (totals) resHTML = `<b class="num">${totals}</b>`;
    }
    if (what.length > 90) what = `${what.slice(0, 90)}…`;

    const toast = document.createElement("button");
    toast.type = "button";
    // System results get the V5 parchment-card skin instead of etched glass.
    toast.className = `gl-mobile-toast ${sys ? "v5" : "gl-glass"}`;
    toast.innerHTML = `
      <span class="who">${escapeHTML(who)}</span>
      <span class="what">${escapeHTML(what)}</span>
      ${resHTML}`;
    toast.addEventListener("click", () => this.select("chat"));
    wrap.appendChild(toast);
    while (wrap.children.length > 3) wrap.firstElementChild.remove();

    const dismiss = () => {
      toast.classList.add("out");
      setTimeout(() => toast.remove(), 350);
    };
    setTimeout(dismiss, 6500);
  },

  /** Compact current-combatant banner over the canvas while combat runs. */
  _wireCombatBanner() {
    const banner = document.createElement("div");
    banner.className = "gl-mobile-combat gl-glass";
    document.body.appendChild(banner);
    const update = () => {
      const combat = game.combats?.active;
      const name = combat?.started ? combat.combatant?.name : null;
      banner.classList.toggle("show", !!name);
      if (name) banner.textContent = game.i18n.format("GLMOB.combatTurn", { name });
    };
    for (const hook of ["combatStart", "combatTurnChange", "updateCombat", "deleteCombat"]) Hooks.on(hook, update);
    update();
  },
};
