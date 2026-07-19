import {
  APPRENTICE_CLASSES,
  addStartingMoney,
  getConfig,
  getWeaponOptions,
  isLevelZeroActor,
  requiredSkillCount,
  saveConfig,
  setCantrip,
  startingMoneyGranted,
} from "./main.mjs";

const TAB = "gl0-level-zero";
const activeActors = new Set();
const L = (key) => game.i18n.localize(key);
const E = (value) => foundry.utils.escapeHTML(String(value ?? ""));
const TE = () => foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;

function option(value, label, selected = false) {
  return `<option value="${E(value)}"${selected ? " selected" : ""}>${E(label)}</option>`;
}

function labelForConfig(record, key) {
  const label = record?.[key]?.label ?? record?.[key] ?? key;
  return game.i18n.localize(label);
}

function skillOptions(actor, config) {
  return Object.entries(CONFIG.PF2E?.skills ?? {})
    .map(([slug, data]) => ({ slug, label: labelForConfig(CONFIG.PF2E.skills, slug), attribute: data.attribute }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
    .map(({ slug, label, attribute }) => {
      const checked = config.skills.includes(slug);
      const mod = Number(actor.system?.abilities?.[attribute]?.mod ?? 0);
      return `<label class="gl0-skill${checked ? " selected" : ""}">
        <input type="checkbox" data-gl0-skill value="${E(slug)}"${checked ? " checked" : ""}>
        <span>${E(label)}</span><small>${attribute.toUpperCase()} ${mod >= 0 ? "+" : ""}${mod}</small>
      </label>`;
    }).join("");
}

function classOptions(kind, selected) {
  return APPRENTICE_CLASSES[kind].map((slug) => {
    const label = labelForConfig(CONFIG.PF2E?.classTraits ?? {}, slug);
    return option(slug, label, selected === slug);
  }).join("");
}

function traditionOptions(selected) {
  return Object.keys(CONFIG.PF2E?.magicTraditions ?? { arcane: "Arcane", divine: "Divine", occult: "Occult", primal: "Primal" })
    .map((slug) => option(slug, labelForConfig(CONFIG.PF2E.magicTraditions, slug), selected === slug))
    .join("");
}

async function cantripData(config) {
  return Promise.all(config.cantrips.map(async (uuid) => {
    if (!uuid) return null;
    try {
      const item = await fromUuid(uuid);
      return item?.type === "spell" && item.isCantrip ? { uuid, name: item.name, img: item.img } : null;
    } catch {
      return null;
    }
  }));
}

function cantripSlot(item, slot) {
  return `<div class="gl0-cantrip${item ? " filled" : ""}" data-cantrip-slot="${slot}">
    ${item ? `<img src="${E(item.img)}" alt=""><span>${E(item.name)}</span><button type="button" data-remove-cantrip="${slot}" title="${E(L("GL0.cantrip.remove"))}"><i class="fa-solid fa-xmark"></i></button>`
      : `<i class="fa-solid fa-wand-sparkles"></i><span>${E(L("GL0.cantrip.drop"))}</span>`}
  </div>`;
}

function classSkillText(config) {
  const labels = config.classSkills.map((slug) => labelForConfig(CONFIG.PF2E?.skills ?? {}, slug));
  return game.i18n.format("GL0.apprentice.classSkills", { skills: labels.join(", ") || L("GL0.list.empty") });
}

function moneyText(actor) {
  try { return actor.inventory.coins.toString({ decimal: true }) || "0 gp"; }
  catch { return "0 gp"; }
}

export class LevelZeroSheet {
  static inFlightRoots = new WeakSet();
  static navHandlers = new WeakMap();

  static register() {
    const names = new Set(["CharacterSheetPF2e", "ActorSheetPF2e", "ApplicationV2", "ActorSheet", "ActorSheetV2"]);
    try {
      for (const entry of Object.values(CONFIG?.Actor?.sheetClasses?.character ?? {})) {
        if (entry?.cls?.name) names.add(entry.cls.name);
      }
    } catch (error) {
      console.warn("GLUniverse Suite | Could not inspect PF2e character sheet classes", error);
    }
    for (const name of names) Hooks.on(`render${name}`, (app, html) => this.onRender(app, html));
  }

  static async onRender(app, html) {
    const actor = app?.actor ?? app?.document;
    if (!isLevelZeroActor(actor)) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || !actor.isOwner) return;
    if (this.inFlightRoots.has(root)) return;
    this.inFlightRoots.add(root);
    try { await this.inject(root, actor); }
    catch (error) { console.error("GLUniverse Suite | Level 0 sheet injection failed", error); }
    finally { this.inFlightRoots.delete(root); }
  }

  static async inject(root, actor) {
    const mainNav = root.querySelector("nav.sheet-navigation");
    const navLink = mainNav?.querySelector("[data-tab]") ?? root.querySelector("nav a[data-tab], nav [data-tab]");
    const nav = mainNav ?? navLink?.closest("nav") ?? navLink?.parentElement;
    const contentTab = root.querySelector(".sheet-body .sheet-content > .tab[data-tab]")
      ?? root.querySelector("section.tab[data-tab], div.tab[data-tab], [data-tab].tab");
    const body = contentTab?.parentElement;
    if (!nav || !body || !navLink || !contentTab) return;

    nav.querySelectorAll(`[data-tab="${TAB}"]`).forEach((element) => element.remove());
    body.querySelectorAll(`:scope > [data-tab="${TAB}"]`).forEach((element) => element.remove());

    const config = getConfig(actor);
    const required = requiredSkillCount(actor);
    const simpleWeapons = await getWeaponOptions("simple");
    const martialWeapons = await getWeaponOptions("martial");
    const cantrips = await cantripData(config);
    if (!root.isConnected) return;

    const link = document.createElement(navLink.tagName);
    link.className = navLink.className.replace(/\bactive\b/g, "").trim();
    link.classList.add("gl0-tab-button");
    link.dataset.tab = TAB;
    link.setAttribute("data-tooltip", L("GL0.tab"));
    link.setAttribute("aria-label", L("GL0.tab"));
    link.innerHTML = `<i class="fa-solid fa-seedling"></i>`;
    nav.appendChild(link);

    const section = document.createElement(contentTab.tagName);
    section.className = contentTab.className.replace(/\bactive\b/g, "").trim();
    section.classList.add("gl0-sheet-tab");
    section.dataset.tab = TAB;
    section.innerHTML = this.markup(actor, config, required, simpleWeapons, martialWeapons, cantrips);
    body.appendChild(section);
    this.activate(section, actor, required);

    const priorHandler = this.navHandlers.get(nav);
    if (priorHandler) nav.removeEventListener("click", priorHandler, true);
    const navHandler = (event) => {
      const hit = event.target.closest("[data-tab]");
      if (!hit || !nav.contains(hit)) return;
      this.setActive(nav, body, hit.dataset.tab);
      if (hit.dataset.tab === TAB) activeActors.add(actor.id);
      else activeActors.delete(actor.id);
    };
    this.navHandlers.set(nav, navHandler);
    nav.addEventListener("click", navHandler, true);
    if (activeActors.has(actor.id)) this.setActive(nav, body, TAB);
  }

  static markup(actor, config, required, simpleWeapons, martialWeapons, cantrips) {
    let missing = Math.abs(required - config.skills.length) + (config.simpleWeapon ? 0 : 1);
    if (config.apprentice === "martial") missing += (config.classSlug ? 0 : 1) + (config.martialWeapon ? 0 : 1);
    if (config.apprentice === "spellcaster") {
      missing += (config.classSlug ? 0 : 1) + config.cantrips.filter((uuid) => !uuid).length;
      if (config.cantrips.every(Boolean) && new Set(config.cantrips).size !== 2) missing += 1;
    }
    const fundsAdded = startingMoneyGranted(actor);
    return `<div class="gl0-root gl-glass">
      <header class="gl0-hero">
        <div class="gl0-emblem"><i class="fa-solid fa-seedling"></i></div>
        <div><span class="gl-tech-label">${E(L("GL0.subtitle"))}</span><h2>${E(L("GL0.title"))}</h2><p>${E(L("GL0.summary"))}</p></div>
        <span class="gl0-status ${missing ? "incomplete" : "ready"}"><i class="fa-solid ${missing ? "fa-triangle-exclamation" : "fa-circle-check"}"></i> ${E(missing ? game.i18n.format("GL0.status.incomplete", { count: missing }) : L("GL0.status.ready"))}</span>
      </header>
      ${actor.itemTypes?.class?.length ? `<div class="gl0-warning"><i class="fa-solid fa-triangle-exclamation"></i><span>${E(L("GL0.warning.class"))}</span></div>` : ""}

      <section class="gl0-card">
        <div class="gl0-card-title"><i class="fa-solid fa-shield-halved"></i><h3>${E(L("GL0.initial.title"))}</h3></div>
        <p class="gl0-fixed">${E(L("GL0.initial.fixed"))}</p>
        <div class="gl0-field"><label>${E(L("GL0.weapon.simple"))}</label><select data-gl0-field="simpleWeapon" class="gl-field">
          ${option("", L("GL0.weapon.choose"), !config.simpleWeapon)}
          ${simpleWeapons.map((weapon) => option(weapon.value, weapon.label, config.simpleWeapon === weapon.value)).join("")}
        </select></div>
        <div class="gl0-field"><label>${E(game.i18n.format("GL0.skills.label", { chosen: config.skills.length, required }))}</label><p class="hint">${E(L("GL0.skills.hint"))}</p>
          <div class="gl0-skills">${skillOptions(actor, config)}</div>
        </div>
      </section>

      <section class="gl0-card">
        <div class="gl0-card-title"><i class="fa-solid fa-graduation-cap"></i><h3>${E(L("GL0.apprentice.title"))}</h3></div>
        <div class="gl0-field"><select data-gl0-field="apprentice" class="gl-field">
          ${option("none", L("GL0.apprentice.none"), config.apprentice === "none")}
          ${option("alchemist", L("GL0.apprentice.alchemist"), config.apprentice === "alchemist")}
          ${option("monk", L("GL0.apprentice.monk"), config.apprentice === "monk")}
          ${option("martial", L("GL0.apprentice.martial"), config.apprentice === "martial")}
          ${option("spellcaster", L("GL0.apprentice.spellcaster"), config.apprentice === "spellcaster")}
        </select></div>
        <div class="gl0-apprentice" data-apprentice-section="alchemist"><p>${E(L("GL0.apprentice.alchemistHint"))}</p></div>
        <div class="gl0-apprentice" data-apprentice-section="monk"><p>${E(L("GL0.apprentice.monkHint"))}</p></div>
        <div class="gl0-apprentice" data-apprentice-section="martial">
          <p>${E(L("GL0.apprentice.martialHint"))}</p>
          <div class="gl0-grid"><div class="gl0-field"><label>${E(L("GL0.apprentice.class"))}</label><select data-gl0-field="martialClass" class="gl-field">${option("", L("GL0.none"), !APPRENTICE_CLASSES.martial.includes(config.classSlug))}${classOptions("martial", config.classSlug)}</select></div>
          <div class="gl0-field"><label>${E(L("GL0.weapon.martial"))}</label><select data-gl0-field="martialWeapon" class="gl-field">${option("", L("GL0.weapon.choose"), !config.martialWeapon)}${martialWeapons.map((weapon) => option(weapon.value, weapon.label, config.martialWeapon === weapon.value)).join("")}</select></div></div>
        </div>
        <div class="gl0-apprentice" data-apprentice-section="spellcaster">
          <p>${E(L("GL0.apprentice.spellcasterHint"))}</p>
          <div class="gl0-grid"><div class="gl0-field"><label>${E(L("GL0.apprentice.class"))}</label><select data-gl0-field="spellcasterClass" class="gl-field">${option("", L("GL0.none"), !APPRENTICE_CLASSES.spellcaster.includes(config.classSlug))}${classOptions("spellcaster", config.classSlug)}</select></div>
          <div class="gl0-field"><label>${E(L("GL0.tradition"))}</label><select data-gl0-field="tradition" class="gl-field">${traditionOptions(config.tradition)}</select></div>
          <div class="gl0-field"><label>${E(L("GL0.castingStyle"))}</label><select data-gl0-field="castingStyle" class="gl-field">${option("prepared", L("GL0.casting.prepared"), config.castingStyle === "prepared")}${option("spontaneous", L("GL0.casting.spontaneous"), config.castingStyle === "spontaneous")}</select></div></div>
          <label class="gl0-cantrip-label">${E(L("GL0.cantrips"))}</label><div class="gl0-cantrips">${cantripSlot(cantrips[0], 0)}${cantripSlot(cantrips[1], 1)}</div>
        </div>
        ${config.apprentice !== "none" ? `<p class="gl0-class-skills"><i class="fa-solid fa-book-open"></i> ${E(classSkillText(config))}</p>` : ""}
      </section>

      <section class="gl0-card gl0-money">
        <div><div class="gl0-card-title"><i class="fa-solid fa-coins"></i><h3>${E(L("GL0.money.title"))}</h3></div><p>${E(L("GL0.money.rule"))}</p><strong>${E(game.i18n.format("GL0.money.current", { amount: moneyText(actor) }))}</strong></div>
        <button type="button" class="gl-btn" data-add-money${fundsAdded ? " disabled" : ""}><i class="fa-solid ${fundsAdded ? "fa-check" : "fa-plus"}"></i> ${E(fundsAdded ? L("GL0.money.added") : L("GL0.money.add"))}</button>
      </section>
      <section class="gl0-card gl0-guidance">
        <div class="gl0-card-title"><i class="fa-solid fa-route"></i><h3>${E(L("GL0.gameplay.title"))}</h3></div>
        <p>${E(L("GL0.gameplay.rule"))}</p>
      </section>
      <footer><button type="button" class="gl-btn gl0-save" data-gl0-save><i class="fa-solid fa-floppy-disk"></i> ${E(L("GL0.save"))}</button></footer>
    </div>`;
  }

  static activate(section, actor, required) {
    const form = section.querySelector(".gl0-root");
    const field = (name) => form.querySelector(`[data-gl0-field="${name}"]`);
    const apprenticeSelect = field("apprentice");
    const showApprentice = () => {
      for (const panel of form.querySelectorAll("[data-apprentice-section]")) panel.hidden = panel.dataset.apprenticeSection !== apprenticeSelect.value;
    };
    apprenticeSelect.addEventListener("change", showApprentice);
    showApprentice();

    for (const checkbox of form.querySelectorAll('.gl0-skill input[type="checkbox"]')) {
      checkbox.addEventListener("change", () => checkbox.closest(".gl0-skill").classList.toggle("selected", checkbox.checked));
    }

    form.querySelector("[data-gl0-save]").addEventListener("click", async (event) => {
      event.preventDefault();
      const apprentice = apprenticeSelect.value;
      const skills = [...form.querySelectorAll("input[data-gl0-skill]:checked")].map((input) => input.value);
      if (skills.length !== required) return ui.notifications.warn(game.i18n.format("GL0.error.skills", { required }));
      if (!field("simpleWeapon").value) return ui.notifications.warn(L("GL0.error.simpleWeapon"));
      const config = getConfig(actor);
      config.simpleWeapon = field("simpleWeapon").value;
      config.skills = skills;
      config.apprentice = apprentice;
      config.classSlug = apprentice === "martial" ? field("martialClass").value : apprentice === "spellcaster" ? field("spellcasterClass").value : "";
      config.martialWeapon = field("martialWeapon").value;
      config.tradition = field("tradition").value;
      config.castingStyle = field("castingStyle").value;
      if (["martial", "spellcaster"].includes(apprentice) && !config.classSlug) return ui.notifications.warn(L("GL0.error.class"));
      if (apprentice === "martial" && !config.martialWeapon) return ui.notifications.warn(L("GL0.error.martialWeapon"));
      if (apprentice === "spellcaster" && (config.cantrips.some((uuid) => !uuid) || new Set(config.cantrips).size !== 2)) return ui.notifications.warn(L("GL0.error.twoCantrips"));
      await saveConfig(actor, config);
      ui.notifications.info(game.i18n.format("GL0.saved", { name: actor.name }));
    });

    for (const zone of form.querySelectorAll("[data-cantrip-slot]")) {
      zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("drop-hot"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop-hot"));
      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        zone.classList.remove("drop-hot");
        let data;
        try { data = TE().getDragEventData(event); } catch { data = null; }
        const uuid = data?.uuid ?? (data?.type === "Item" && data?.id ? `Item.${data.id}` : null);
        const item = uuid ? await fromUuid(uuid) : null;
        if (item?.type !== "spell" || !item.isCantrip) return ui.notifications.warn(L("GL0.error.cantrip"));
        await setCantrip(actor, Number(zone.dataset.cantripSlot), uuid);
        activeActors.add(actor.id);
      });
    }

    for (const button of form.querySelectorAll("[data-remove-cantrip]")) {
      button.addEventListener("click", async () => {
        await setCantrip(actor, Number(button.dataset.removeCantrip), null);
        activeActors.add(actor.id);
      });
    }

    form.querySelector("[data-add-money]")?.addEventListener("click", async () => {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: L("GL0.money.confirmTitle") },
        content: `<p>${E(game.i18n.format("GL0.money.confirm", { name: actor.name }))}</p>`,
      });
      if (confirmed) await addStartingMoney(actor);
    });
  }

  static setActive(nav, body, name) {
    nav.querySelectorAll("[data-tab]").forEach((link) => link.classList.toggle("active", link.dataset.tab === name));
    body.querySelectorAll(":scope > .tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  }
}
