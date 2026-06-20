import { MODULE_ID } from "./constants.js";
import { flattenActor, hasModifier, isUpdatable, unflattenActor } from "./flatten.js";

/** Localize (or format, when `data` is supplied) a module string. */
const t = (key, data) =>
	data
		? game.i18n.format(`${MODULE_ID}.${key}`, data)
		: game.i18n.localize(`${MODULE_ID}.${key}`);

/**
 * Resolves the actor for a directory list entry. Handles both the HTMLElement
 * passed in v13+ and the legacy jQuery wrapper.
 * @param {HTMLElement|JQuery} li
 * @returns {Actor|null}
 */
function actorFromListItem(li) {
	const element = li instanceof HTMLElement ? li : (li?.[0] ?? null);
	const id =
		element?.dataset?.entryId ??
		element?.dataset?.documentId ??
		(typeof li?.data === "function" ? (li.data("entryId") ?? li.data("documentId")) : undefined);
	return id ? (game.actors.get(id) ?? null) : null;
}

/** Creates a sidebar header button wired to the given handler. */
function createButton(icon, label, handler) {
	const button = document.createElement("button");
	button.type = "button";
	button.classList.add("pf2e-flatten-button");
	button.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		handler();
	});
	return button;
}

/** Flattens every eligible, not-yet-flattened actor in the world. */
async function flattenAll() {
	const actors = game.actors.filter((actor) => isUpdatable(actor) && !hasModifier(actor));
	ui.notifications.info(t("notifications.flattening", { count: actors.length }));
	for (const actor of actors) await flattenActor(actor);
	ui.notifications.info(t("notifications.flattened", { count: actors.length }));
}

/** Unflattens every eligible, currently-flattened actor in the world. */
async function unflattenAll() {
	const actors = game.actors.filter((actor) => isUpdatable(actor) && hasModifier(actor));
	ui.notifications.info(t("notifications.unflattening", { count: actors.length }));
	for (const actor of actors) await unflattenActor(actor);
	ui.notifications.info(t("notifications.unflattened", { count: actors.length }));
}

/**
 * Adds "Flatten / Unflatten All" buttons to the Actors sidebar header.
 * Bound to the `renderActorDirectory` hook (GM only).
 * @param {Application} _app
 * @param {HTMLElement|JQuery} html
 */
export function renderDirectoryButtons(_app, html) {
	if (!game.user.isGM) return;

	const root = html instanceof HTMLElement ? html : (html?.[0] ?? null);
	if (!root || root.querySelector("[data-pf2e-flatten-row]")) return;

	const header = root.querySelector(".directory-header") ?? root.querySelector("header");
	if (!header) return;

	const row = document.createElement("div");
	row.dataset.pf2eFlattenRow = "";
	row.classList.add("header-actions", "action-buttons", "flexrow");
	row.append(
		createButton("fa-level-down-alt", t("buttons.flattenAll"), flattenAll),
		createButton("fa-level-up-alt", t("buttons.unflattenAll"), unflattenAll),
	);

	const anchor = header.querySelector(".action-buttons");
	if (anchor) anchor.after(row);
	else header.append(row);
}

/**
 * Adds Flatten / Unflatten entries to the actor directory right-click menu.
 * Bound to the `getActorContextOptions` hook (v13+). The first argument is the
 * ActorDirectory application; the second is the mutable array of menu entries.
 * @param {Application} _directory
 * @param {object[]} options
 */
export function addContextMenuOptions(_directory, options) {
	options.unshift(
		{
			name: t("context.flatten"),
			icon: '<i class="fas fa-level-down-alt"></i>',
			condition: (li) => {
				const actor = actorFromListItem(li);
				return isUpdatable(actor) && !hasModifier(actor);
			},
			callback: (li) => flattenActor(actorFromListItem(li)),
		},
		{
			name: t("context.unflatten"),
			icon: '<i class="fas fa-level-up-alt"></i>',
			condition: (li) => {
				const actor = actorFromListItem(li);
				return isUpdatable(actor) && hasModifier(actor);
			},
			callback: (li) => unflattenActor(actorFromListItem(li)),
		},
	);
}
