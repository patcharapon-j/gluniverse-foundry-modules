import { onSocket, emitSocket } from "../../core/socket.mjs";

const MODULE_ID = "gluniverse-foundry-modules";
const FEATURE_ID = "cargo-grid";
const CARGO_MUTATION_QUERY = `${MODULE_ID}.cargoMutation`;

const SETTINGS = Object.freeze({
  boardData: "cargo.boardData",
  playerVisible: "cargo.playerVisible",
  maxShapeSize: "cargo.maxShapeSize",
  cellSize: "cargo.cellSize",
  viewState: "cargo.viewState"
});

const CATEGORIES = Object.freeze({
  supplies: {
    label: "Supplies",
    icon: "fa-solid fa-kit-medical",
    color: "#18c7b8",
    pattern: "stripe"
  },
  parts: {
    label: "Parts",
    icon: "fa-solid fa-gears",
    color: "#f59e0b",
    pattern: "circuit"
  },
  comforts: {
    label: "Comforts",
    icon: "fa-solid fa-mug-hot",
    color: "#ec4899",
    pattern: "soft"
  },
  objective: {
    label: "Objective",
    icon: "fa-solid fa-diamond",
    color: "#e11d48",
    pattern: "warning"
  },
  intel: {
    label: "Intel",
    icon: "fa-solid fa-hard-drive",
    color: "#38bdf8",
    pattern: "scan"
  },
  loot: {
    label: "Loot",
    icon: "fa-solid fa-shield-halved",
    color: "#8b5cf6",
    pattern: "edge"
  },
  specimens: {
    label: "Specimens",
    icon: "fa-solid fa-flask-vial",
    color: "#22c55e",
    pattern: "bio"
  },
  salvage: {
    label: "Salvage",
    icon: "fa-solid fa-recycle",
    color: "#f97316",
    pattern: "plate"
  },
  hazardous: {
    label: "Hazardous",
    icon: "fa-solid fa-triangle-exclamation",
    color: "#facc15",
    pattern: "hazard"
  },
  custom: {
    label: "Custom",
    icon: "fa-solid fa-cube",
    color: "#94a3b8",
    pattern: "generic"
  }
});

const VISIBILITY = Object.freeze({
  revealed: "revealed",
  scanned: "scanned",
  unknown: "unknown"
});

const LOCK_TIMEOUT_MS = 30000;
const SHAPE_METRICS_CACHE_LIMIT = 512;
const HOLD_TO_MOVE_MS = 550;
const HOLD_TO_MOVE_CANCEL_PX = 8;

const DEFAULT_SHAPE = Object.freeze(["XX", "XX"]);
const SHAPE_PRESETS = Object.freeze({
  one: ["X"],
  two: ["XX"],
  box: ["XX", "XX"],
  long: ["XXXX"],
  l: ["X.", "XXX"],
  t: ["XXX", ".X."],
  s: [".XX", "XX."]
});

let boardWindow = null;
let floatingButton = null;
const minimapWindows = new Map();
let refreshTimer = null;
let readDataSource = null;
let readDataSnapshot = null;
const shapeMetricsCache = new Map();

export function onInit() {
  registerCargoMutationQuery();
}

export function onReady() {
  registerCargoMutationQuery();

  onSocket(FEATURE_ID, payload => {
    if (payload?.type === "refresh") scheduleRefresh();
    if (payload?.type === "closePlayers" && !game.user.isGM) {
      closeBoard();
      closeMinimaps();
    }
    if (payload?.type === "cargoMutation" && shouldHandleCargoMutation(payload)) handleCargoMutationRequest(payload);
  });

  Hooks.on("updateSetting", setting => {
    if (setting.key === `${MODULE_ID}.${SETTINGS.boardData}` || setting.key === `${MODULE_ID}.${SETTINGS.playerVisible}`) {
      scheduleRefresh();
    }
  });

  Hooks.on("renderSceneNavigation", () => scheduleRefresh());
  scheduleRefresh();
}

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.boardData, {
    scope: "world",
    config: false,
    type: Object,
    default: createDefaultWorldData()
  });

  game.settings.register(MODULE_ID, SETTINGS.playerVisible, {
    name: "GLUCARGO.Settings.PlayerVisible.Name",
    hint: "GLUCARGO.Settings.PlayerVisible.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: false,
    onChange: visible => {
      if (!visible) emitSocket(FEATURE_ID, { type: "closePlayers" });
      scheduleRefresh();
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.maxShapeSize, {
    name: "GLUCARGO.Settings.MaxShapeSize.Name",
    hint: "GLUCARGO.Settings.MaxShapeSize.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Number,
    default: 8,
    range: { min: 3, max: 12, step: 1 }
  });

  game.settings.register(MODULE_ID, SETTINGS.cellSize, {
    name: "GLUCARGO.Settings.CellSize.Name",
    hint: "GLUCARGO.Settings.CellSize.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 44,
    range: { min: 28, max: 56, step: 1 },
    onChange: () => boardWindow?.render()
  });

  game.settings.register(MODULE_ID, SETTINGS.viewState, {
    scope: "client",
    config: false,
    type: Object,
    default: {
      left: 120,
      top: 90,
      width: 1180,
      height: 740,
      activeContainerId: null
    }
  });
}

function createDefaultWorldData() {
  return {
    schemaVersion: 1,
    activeMissionId: null,
    missions: {},
    templates: {},
    lastUndo: null,
    updatedAt: Date.now()
  };
}

function createMission(name = "New Mission") {
  const now = Date.now();
  const id = makeId("mission");
  const containerId = makeId("container");
  return {
    id,
    name,
    status: "active",
    locked: false,
    containers: {
      [containerId]: {
        id: containerId,
        name: "Extraction Case",
        width: 10,
        height: 6,
        locked: false,
        brokenCells: [],
        notes: "",
        createdAt: now,
        updatedAt: now
      }
    },
    cargo: {},
    createdAt: now,
    updatedAt: now,
    extractedAt: null
  };
}

function normalizeMission(mission) {
  for (const [id, container] of Object.entries(mission.containers ?? {})) {
    container.id = container.id || id;
    container.brokenCells = getBrokenCellKeys(container);
  }
  mission.cargo = mission.cargo ?? {};
  mission.containers = mission.containers ?? {};
  return mission;
}

function getData() {
  return duplicate(game.settings.get(MODULE_ID, SETTINGS.boardData) ?? createDefaultWorldData());
}

function getReadData() {
  const source = game.settings.get(MODULE_ID, SETTINGS.boardData) ?? createDefaultWorldData();
  if (source !== readDataSource) {
    readDataSource = source;
    readDataSnapshot = duplicate(source);
  }
  return readDataSnapshot;
}

async function setData(data, { emit = true } = {}) {
  data.updatedAt = Date.now();
  await game.settings.set(MODULE_ID, SETTINGS.boardData, data);
  readDataSource = null;
  readDataSnapshot = null;
  if (emit) emitSocket(FEATURE_ID, { type: "refresh" });
  scheduleRefresh();
}

async function mutateData(mutator, { undo = true } = {}) {
  const data = getData();
  const before = stripUndo(data);
  const result = await mutator(data);
  if (undo && game.user.isGM) {
    data.lastUndo = {
      at: Date.now(),
      userId: game.user.id,
      userName: game.user.name,
      data: before
    };
  }
  await setData(data);
  return result;
}

function registerCargoMutationQuery() {
  if (!globalThis.CONFIG?.queries) return;
  CONFIG.queries[CARGO_MUTATION_QUERY] = async payload => {
    if (!game.user.isGM) return { ok: false };
    const ok = await handleCargoMutationRequest(payload);
    return { ok };
  };
}

async function requestCargoMutation(operation, data, { undo = false } = {}) {
  const user = getCurrentUserSnapshot();
  if (game.user.isGM) return performCargoMutation(operation, data, user, { undo });
  const targetGm = getPrimaryActiveGM();
  if (targetGm?.query) {
    try {
      const response = await targetGm.query(CARGO_MUTATION_QUERY, {
        operation,
        userId: user.id,
        userName: user.name,
        data
      }, { timeout: 10000 });
      return Boolean(response?.ok ?? response);
    } catch (error) {
      console.warn(`${MODULE_ID} | GM cargo mutation query failed`, error);
      notifyWarn("The GM client did not confirm the cargo move.");
      return false;
    }
  }

  notifyWarn("A connected GM client is required to move cargo.");
  return false;
}

async function handleCargoMutationRequest(payload) {
  const user = getSocketUserSnapshot(payload);
  return performCargoMutation(payload.operation, payload.data ?? {}, user, { undo: false });
}

async function performCargoMutation(operation, data, user, { undo = false } = {}) {
  if (operation === "lockCargo") {
    const changed = await mutateData(worldData => {
      const cargo = getActiveMission(worldData)?.cargo?.[data.cargoId];
      if (!cargo || isLockedByOtherForUser(cargo, user.id)) return false;
      cargo.lock = {
        userId: user.id,
        userName: user.name,
        expiresAt: Date.now() + LOCK_TIMEOUT_MS
      };
      return true;
    }, { undo: false });
    return Boolean(changed);
  }

  if (operation === "releaseCargoLock") {
    const changed = await mutateData(worldData => {
      const cargo = getActiveMission(worldData)?.cargo?.[data.cargoId];
      if (cargo?.lock?.userId !== user.id) return false;
      cargo.lock = null;
      return true;
    }, { undo: false });
    return Boolean(changed);
  }

  if (operation === "placeCargo") {
    const changed = await mutateData(worldData => {
      const mission = getActiveMission(worldData);
      const cargo = mission?.cargo?.[data.cargoId];
      const container = mission?.containers?.[data.containerId];
      if (!mission || !cargo || !container) return false;
      if (mission.status === "extracted" || container.locked || (mission.locked && !user.isGM)) return false;
      if (isLockedByOtherForUser(cargo, user.id)) return false;
      const x = Number(data.x);
      const y = Number(data.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
      const rotation = normalizeRotation(data.rotation ?? cargo.rotation ?? 0);
      const shape = rotateShape(cargo.shape, rotation);
      if (!canPlaceCargo(mission, container, cargo.id, shape, { x, y })) return false;
      cargo.location = { type: "container", containerId: container.id, position: { x, y } };
      cargo.rotation = rotation;
      cargo.lock = null;
      cargo.updatedAt = Date.now();
      mission.updatedAt = Date.now();
      return true;
    }, { undo });
    return Boolean(changed);
  }

  if (operation === "returnCargoToFloor") {
    const changed = await mutateData(worldData => {
      const mission = getActiveMission(worldData);
      const cargo = mission?.cargo?.[data.cargoId];
      if (!mission || !cargo) return false;
      if (mission.status === "extracted" || (mission.locked && !user.isGM)) return false;
      if (isLockedByOtherForUser(cargo, user.id)) return false;
      cargo.location = { type: "floor" };
      cargo.lock = null;
      cargo.updatedAt = Date.now();
      mission.updatedAt = Date.now();
      return true;
    }, { undo });
    return Boolean(changed);
  }

  return false;
}

function getCurrentUserSnapshot() {
  return {
    id: game.user.id,
    name: game.user.name,
    isGM: Boolean(game.user.isGM)
  };
}

function getSocketUserSnapshot(payload) {
  const user = game.users?.get?.(payload?.userId);
  return {
    id: user?.id ?? payload?.userId,
    name: user?.name ?? payload?.userName ?? "Player",
    isGM: false
  };
}

function shouldHandleCargoMutation(payload) {
  if (!game.user.isGM) return false;
  if (payload?.targetGmId) return payload.targetGmId === game.user.id;
  return getPrimaryActiveGM()?.id === game.user.id;
}

function getPrimaryActiveGM() {
  if (game.users?.activeGM?.isGM) return game.users.activeGM;
  const gms = getUsersArray()
    .filter(user => user?.isGM && user.active === true)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return gms[0] ?? null;
}

function getUsersArray() {
  if (!game.users) return [];
  if (Array.isArray(game.users.contents)) return game.users.contents;
  if (typeof game.users.filter === "function") return game.users.filter(() => true);
  if (typeof game.users.values === "function") return Array.from(game.users.values());
  return Array.from(game.users);
}

function stripUndo(data) {
  const cloned = duplicate(data);
  cloned.lastUndo = null;
  return cloned;
}

function duplicate(value) {
  if (globalThis.foundry?.utils?.deepClone) return globalThis.foundry.utils.deepClone(value);
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix) {
  const id = globalThis.foundry?.utils?.randomID ? globalThis.foundry.utils.randomID(12) : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${id}`;
}

function resolveUuid(uuid) {
  const fn = globalThis.foundry?.utils?.fromUuid ?? globalThis.fromUuid;
  return typeof fn === "function" ? fn(uuid) : Promise.resolve(null);
}

function localize(key, fallback) {
  const text = game.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
}

function getActiveMission(data = getReadData()) {
  const mission = data.activeMissionId ? data.missions?.[data.activeMissionId] : null;
  return mission ? normalizeMission(mission) : null;
}

function canPlayerSeeBoard(data = getReadData()) {
  if (game.user.isGM) return true;
  return Boolean(game.settings.get(MODULE_ID, SETTINGS.playerVisible) && getActiveMission(data));
}

function scheduleRefresh() {
  if (refreshTimer) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    renderFloatingButton();
    boardWindow?.render();
    refreshMinimaps();
    const data = getReadData();
    if (!canPlayerSeeBoard(data)) {
      closeBoard();
      closeMinimaps();
    }
  }, 40);
}

function renderFloatingButton() {
  floatingButton?.remove();
  floatingButton = null;
  const data = getReadData();
  if (!canPlayerSeeBoard(data)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "glucargo-fab";
  button.title = localize("GLUCARGO.Open", "Open Cargo Grid");
  button.innerHTML = `<i class="fa-solid fa-boxes-stacked"></i><span>CARGO</span>`;
  button.addEventListener("click", () => openBoard());
  button.addEventListener("contextmenu", event => {
    event.preventDefault();
    toggleMinimaps();
  });
  document.body.append(button);
  floatingButton = button;
}

function openBoard() {
  if (!boardWindow) boardWindow = new CargoBoardWindow();
  boardWindow.render();
}

function closeBoard() {
  boardWindow?.close();
  boardWindow = null;
}

function toggleMinimaps() {
  if (minimapWindows.size) return closeMinimaps();
  openMinimaps();
}

function openMinimaps() {
  const data = getReadData();
  const mission = getActiveMission(data);
  if (!canPlayerSeeBoard(data) || !mission) return;
  Object.values(mission.containers ?? {}).forEach((container, index) => {
    const minimap = minimapWindows.get(container.id) ?? new CargoMinimapWindow(container.id, index);
    minimapWindows.set(container.id, minimap);
    minimap.render(data, index);
  });
}

function refreshMinimaps() {
  if (!minimapWindows.size) return;
  const data = getReadData();
  const mission = getActiveMission(data);
  if (!canPlayerSeeBoard(data) || !mission) return closeMinimaps();

  const containers = Object.values(mission.containers ?? {});
  const liveIds = new Set(containers.map(container => container.id));
  for (const [containerId, minimap] of minimapWindows) {
    if (liveIds.has(containerId)) continue;
    minimap.close();
  }
  containers.forEach((container, index) => {
    const minimap = minimapWindows.get(container.id) ?? new CargoMinimapWindow(container.id, index);
    minimapWindows.set(container.id, minimap);
    minimap.render(data, index);
  });
}

function closeMinimaps() {
  for (const minimap of Array.from(minimapWindows.values())) minimap.close();
  minimapWindows.clear();
}

class CargoMinimapWindow {
  constructor(containerId, index = 0) {
    this.containerId = containerId;
    this.index = index;
    this.element = null;
    this.left = null;
    this.top = null;
  }

  render(data = getReadData(), index = this.index) {
    this.index = index;
    const mission = getActiveMission(data);
    const container = mission?.containers?.[this.containerId];
    if (!canPlayerSeeBoard(data) || !mission || !container) return this.close();

    if (!this.element) {
      this.element = document.createElement("section");
      this.element.className = "glucargo-minimap";
      this.element.setAttribute("role", "dialog");
      this.element.setAttribute("aria-label", "Cargo minimap");
      document.body.append(this.element);
      this.bindEvents();
    }

    const cellSize = getMinimapCellSize(container);
    const position = this.getPosition(container, cellSize);
    this.element.style.left = `${position.left}px`;
    this.element.style.top = `${position.top}px`;
    this.element.innerHTML = this.renderShell(mission, container, cellSize).trim();
  }

  close() {
    this.element?.remove();
    this.element = null;
    minimapWindows.delete(this.containerId);
  }

  renderShell(mission, container, cellSize) {
    return `
      <header class="glucargo-minimap__bar" data-minimap-drag-handle>
        <i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i>
        <button type="button" data-minimap-action="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="glucargo-minimap__frame">
        ${this.renderGrid(mission, container, cellSize)}
      </div>
    `;
  }

  renderGrid(mission, container, cellSize) {
    const width = Math.max(1, Number(container?.width) || 1);
    const height = Math.max(1, Number(container?.height) || 1);
    const brokenSet = new Set(getBrokenCellKeys(container));
    const cells = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        cells.push(`<span class="glucargo-minimap__cell ${brokenSet.has(cellKey(x, y)) ? "is-broken" : ""}" style="grid-column:${x + 1}; grid-row:${y + 1};"></span>`);
      }
    }

    const cargoCells = Object.values(mission.cargo ?? {})
      .filter(cargo => cargo.location?.type === "container" && cargo.location.containerId === container.id)
      .filter(cargo => !isHiddenFromPlayer(cargo))
      .flatMap(cargo => this.renderCargoCells(cargo, container))
      .join("");

    return `
      <div class="glucargo-minimap__grid" style="--glucargo-mini-cell:${cellSize}px; --glucargo-cols:${width}; --glucargo-rows:${height};">
        ${cells.join("")}
        ${cargoCells}
      </div>
    `;
  }

  renderCargoCells(cargo, container) {
    const width = Math.max(1, Number(container?.width) || 1);
    const height = Math.max(1, Number(container?.height) || 1);
    const cat = getCategory(cargo);
    const metrics = getShapeMetrics(cargo.shape, cargo.rotation ?? 0);
    const pos = cargo.location?.position ?? { x: 0, y: 0 };
    return metrics.cells.map(cell => {
      const gx = pos.x + cell.x;
      const gy = pos.y + cell.y;
      if (gx < 0 || gy < 0 || gx >= width || gy >= height) return "";
      const edges = [];
      if (!metrics.cellSet.has(`${cell.x},${cell.y - 1}`)) edges.push("top");
      if (!metrics.cellSet.has(`${cell.x + 1},${cell.y}`)) edges.push("right");
      if (!metrics.cellSet.has(`${cell.x},${cell.y + 1}`)) edges.push("bottom");
      if (!metrics.cellSet.has(`${cell.x - 1},${cell.y}`)) edges.push("left");
      return `<span class="glucargo-minimap__tile priority-${escapeAttr(cargo.priority ?? "normal")}" style="grid-column:${gx + 1}; grid-row:${gy + 1}; --cargo-accent:${escapeAttr(cat.color)};" data-edges="${edges.join(" ")}"></span>`;
    });
  }

  getPosition(container, cellSize) {
    const containerWidth = Math.max(1, Number(container?.width) || 1);
    const containerHeight = Math.max(1, Number(container?.height) || 1);
    const width = Math.max(96, (containerWidth * cellSize) + 18);
    const height = Math.max(76, (containerHeight * cellSize) + 44);
    if (this.left === null || this.top === null) {
      const buttonRect = floatingButton?.getBoundingClientRect?.();
      const anchorLeft = buttonRect ? buttonRect.right + 10 : Math.round((window.innerWidth - width) / 2);
      const anchorTop = buttonRect ? buttonRect.bottom + 10 : 42;
      this.left = anchorLeft + (this.index * 16);
      this.top = anchorTop + (this.index * 16);
    }
    this.left = Math.max(8, Math.min(this.left, window.innerWidth - width - 8));
    this.top = Math.max(8, Math.min(this.top, window.innerHeight - height - 8));
    return { left: this.left, top: this.top };
  }

  bindEvents() {
    let dragging = null;
    const finishDrag = event => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      this.left = Math.max(8, Math.min(window.innerWidth - 40, dragging.left + event.clientX - dragging.startX));
      this.top = Math.max(8, Math.min(window.innerHeight - 40, dragging.top + event.clientY - dragging.startY));
      dragging = null;
      this.element.style.left = `${this.left}px`;
      this.element.style.top = `${this.top}px`;
      this.element.style.transform = "";
      this.element.classList.remove("is-dragging");
    };

    this.element.addEventListener("click", event => {
      if (event.target.closest("[data-minimap-action='close']")) this.close();
    });
    this.element.addEventListener("contextmenu", event => event.preventDefault());
    this.element.addEventListener("pointerdown", event => {
      if (!event.target.closest("[data-minimap-drag-handle]")) return;
      if (event.target.closest("button")) return;
      dragging = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: this.element.offsetLeft,
        top: this.element.offsetTop
      };
      this.element.setPointerCapture(event.pointerId);
      this.element.classList.add("is-dragging");
    });
    this.element.addEventListener("pointermove", event => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      this.element.style.transform = `translate3d(${event.clientX - dragging.startX}px, ${event.clientY - dragging.startY}px, 0)`;
    });
    this.element.addEventListener("pointerup", finishDrag);
    this.element.addEventListener("pointercancel", finishDrag);
  }
}

class CargoBoardWindow {
  constructor() {
    this.element = null;
    this.selectedCargoId = null;
    this.selectedRotation = null;
    this.quickShape = duplicate(DEFAULT_SHAPE);
    this.quickCargoDraft = this.createQuickCargoDraft();
    this.droppedItem = null;
    this.search = "";
    this.filters = { category: "all", visibility: "all", sort: "newest" };
    this.renderedFloorCargoIds = new Set();
    this.previewCell = null;
    this.hoveredCargoId = null;
    this.placementActive = false;
    this.lockedCargoId = null;
    this.holdToMove = null;
    this.suppressNextCargoClickId = null;
    this.invalidPlacementTimer = null;
    this.resizeObserver = null;
    this.saveViewState = debounce(() => this.persistViewState(), 250);
    this.renderFilterDebounced = debounce(() => this.render(), 120);
    this.renderData = null;
    this.renderMission = null;
    this.placementContexts = new Map();
  }

  get viewState() {
    return duplicate(game.settings.get(MODULE_ID, SETTINGS.viewState) ?? {});
  }

  async setViewState(patch) {
    await game.settings.set(MODULE_ID, SETTINGS.viewState, { ...this.viewState, ...patch });
  }

  render() {
    const data = getReadData();
    if (!canPlayerSeeBoard(data)) return;

    if (!this.element) {
      this.element = document.createElement("section");
      this.element.className = "glucargo-window";
      this.element.setAttribute("role", "dialog");
      this.element.setAttribute("aria-label", "GLUniverse Cargo Grid");
      document.body.append(this.element);
      this.bindPersistentEvents();
    }

    const view = this.viewState;
    const maxWidth = Math.max(320, window.innerWidth - 20);
    const maxHeight = Math.max(320, window.innerHeight - 20);
    const width = Math.min(maxWidth, Math.max(760, Number(view.width ?? 1180)));
    const height = Math.min(maxHeight, Math.max(520, Number(view.height ?? 740)));
    const left = Math.max(8, Math.min(Number(view.left ?? 120), window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(Number(view.top ?? 90), window.innerHeight - height - 8));
    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;
    const previousGrid = this.element.querySelector(".glucargo-grid");
    const template = document.createElement("template");
    template.innerHTML = this.renderShell(data).trim();
    const nextGrid = template.content.querySelector(".glucargo-grid");
    if (previousGrid && nextGrid && previousGrid.dataset.gridKey === nextGrid.dataset.gridKey) {
      this.updateGridContents(previousGrid, nextGrid);
      nextGrid.replaceWith(previousGrid);
    }
    this.element.replaceChildren(...template.content.childNodes);
    this.bindRenderedEvents();
    this.recordRenderedFloorCargo();
  }

  close() {
    this.releaseSelection();
    window.clearTimeout(this.invalidPlacementTimer);
    this.invalidPlacementTimer = null;
    this.saveViewState.cancel?.();
    this.renderFilterDebounced.cancel?.();
    this.cancelHoldToMove();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element?.remove();
    this.element = null;
    this.renderData = null;
    this.renderMission = null;
    if (boardWindow === this) boardWindow = null;
  }

  renderShell(data = getReadData()) {
    this.renderData = data;
    this.placementContexts.clear();
    const mission = getActiveMission(data);
    this.renderMission = mission;
    const visible = game.settings.get(MODULE_ID, SETTINGS.playerVisible);
    const gmClass = game.user.isGM ? " glucargo-window--gm" : "";

    if (!mission) {
      return `
        <header class="glucargo-titlebar" data-drag-handle>
          <div class="glucargo-brand">
            <i class="fa-solid fa-boxes-stacked"></i>
            <div>
              <strong>GLUniverse Cargo Grid</strong>
              <span>Mission cargo logistics</span>
            </div>
          </div>
          <button type="button" class="glucargo-icon-button" data-action="close" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <main class="glucargo-empty-state${gmClass}">
          <div class="glucargo-empty-state__panel">
            <span class="glucargo-kicker">No Active Mission</span>
            <h2>Create a cargo board to begin staging mission rewards.</h2>
            ${game.user.isGM ? `
              <div class="glucargo-inline-form">
                <input type="text" data-new-mission-name placeholder="Mission name" value="Field Operation">
                <button type="button" data-action="create-mission"><i class="fa-solid fa-plus"></i> Create Mission</button>
              </div>
            ` : ""}
          </div>
        </main>
      `;
    }

    const activeContainer = this.getActiveContainer(mission);
    const selectedRecord = mission.cargo?.[this.selectedCargoId] ?? null;
    const selected = selectedRecord && !isHiddenFromPlayer(selectedRecord) ? selectedRecord : null;
    if (!selected) {
      this.selectedCargoId = null;
      this.selectedRotation = null;
      this.previewCell = null;
      this.placementActive = false;
      this.lockedCargoId = null;
    }
    const hasCargoTools = (game.user.isGM && mission.status !== "extracted") || Boolean(selected);

    return `
      <header class="glucargo-titlebar" data-drag-handle>
        <div class="glucargo-brand">
          <i class="fa-solid fa-boxes-stacked"></i>
          <div>
            <strong>${escapeHtml(mission.name)}</strong>
            <span>${mission.status === "extracted" ? "Extracted archive" : "Shared extraction cargo"}</span>
          </div>
        </div>
        <div class="glucargo-titlebar__actions">
          ${game.user.isGM ? `
            <button type="button" class="glucargo-chip ${visible ? "is-on" : ""}" data-action="toggle-visibility" title="Toggle player visibility">
              <i class="fa-solid ${visible ? "fa-eye" : "fa-eye-slash"}"></i>
              ${visible ? "Players visible" : "GM only"}
            </button>
            <button type="button" class="glucargo-chip ${mission.locked ? "is-locked" : ""}" data-action="toggle-board-lock" title="Lock player cargo movement">
              <i class="fa-solid ${mission.locked ? "fa-lock" : "fa-lock-open"}"></i>
              ${mission.locked ? "Board locked" : "Board open"}
            </button>
            <button type="button" class="glucargo-icon-button" data-action="undo" title="Undo last GM action" ${data.lastUndo ? "" : "disabled"}><i class="fa-solid fa-rotate-left"></i></button>
          ` : ""}
          <button type="button" class="glucargo-icon-button" data-action="close" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </header>
      <main class="glucargo-board ${hasCargoTools ? "" : "glucargo-board--no-tools"}">
        ${this.renderSidebar(data, mission, activeContainer)}
        ${this.renderGridPanel(mission, activeContainer)}
        ${this.renderCargoTools(mission, selected)}
        ${this.renderFloorDock(mission)}
      </main>
    `;
  }

  renderSidebar(data, mission, activeContainer) {
    const containers = Object.values(mission.containers ?? {});
    const missionList = Object.values(data.missions ?? {}).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return `
      <aside class="glucargo-sidebar">
        <section class="glucargo-panel glucargo-panel--flush">
          <div class="glucargo-panel__head">
            <span>Containers</span>
            ${game.user.isGM && mission.status !== "extracted" ? `<button type="button" data-action="add-container" title="Add container"><i class="fa-solid fa-plus"></i></button>` : ""}
          </div>
          <div class="glucargo-container-list">
            ${containers.map(container => this.renderContainerButton(mission, container, activeContainer?.id)).join("")}
          </div>
        </section>
        ${game.user.isGM ? `
          <section class="glucargo-panel glucargo-mission-manager">
            <div class="glucargo-panel__head">
              <span>Missions</span>
              <button type="button" data-action="create-mission" title="Create mission"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div class="glucargo-mission-list">
              ${missionList.map(item => `
                <button type="button" class="glucargo-mission-row ${item.id === mission.id ? "is-active" : ""}" data-action="activate-mission" data-mission-id="${escapeAttr(item.id)}">
                  <span>${escapeHtml(item.name)}</span>
                  <small>${escapeHtml(item.status)}</small>
                </button>
              `).join("")}
            </div>
            <div class="glucargo-manager-actions">
              ${mission.status === "extracted" ? `<button type="button" data-action="reopen-mission"><i class="fa-solid fa-lock-open"></i> Reopen</button>` : `<button type="button" data-action="extract-mission"><i class="fa-solid fa-flag-checkered"></i> Extract</button>`}
              <button type="button" data-action="duplicate-mission"><i class="fa-solid fa-copy"></i> Duplicate</button>
              <button type="button" class="danger" data-action="delete-mission"><i class="fa-solid fa-trash"></i> Delete</button>
            </div>
          </section>
        ` : ""}
      </aside>
    `;
  }

  renderContainerButton(mission, container, activeId) {
    const stats = getContainerStats(mission, container);
    const pct = stats.total ? Math.min(100, Math.round((stats.used / stats.total) * 100)) : 0;
    const brokenMeta = stats.broken ? ` / ${stats.broken} broken` : "";
    return `
      <article class="glucargo-container-card ${container.id === activeId ? "is-active" : ""}">
        <button type="button" class="glucargo-container-card__main" data-action="select-container" data-container-id="${escapeAttr(container.id)}">
          <span class="glucargo-container-card__name">${escapeHtml(container.name)}</span>
          <span class="glucargo-container-card__meta">${container.width}x${container.height} / ${stats.used}/${stats.total} cells / ${stats.pieces} cargo${brokenMeta}</span>
          <span class="glucargo-meter"><span style="width:${pct}%"></span></span>
        </button>
        ${game.user.isGM && mission.status !== "extracted" ? `
          <div class="glucargo-container-card__actions">
            <button type="button" data-action="edit-container" data-container-id="${escapeAttr(container.id)}" title="Edit container"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="danger" data-action="delete-container" data-container-id="${escapeAttr(container.id)}" title="Remove container"><i class="fa-solid fa-trash"></i></button>
          </div>
        ` : ""}
      </article>
    `;
  }

  renderGridPanel(mission, container) {
    if (!container) {
      return `<section class="glucargo-grid-panel"><div class="glucargo-empty-grid">No container selected.</div></section>`;
    }

    const readonly = mission.status === "extracted" || container.locked || (mission.locked && !game.user.isGM);
    const cellSize = this.getCellSize(container);
    const showCoordinates = Boolean(this.viewState.showCoordinates);
    const brokenCells = getBrokenCellKeys(container);
    const brokenSet = new Set(brokenCells);
    const canEditBrokenCells = game.user.isGM && mission.status !== "extracted" && !container.locked;
    const brokenEditMode = canEditBrokenCells && this.viewState.brokenEditContainerId === container.id;
    const gridKey = `${container.id}:${container.width}x${container.height}:${brokenCells.join("|")}:${readonly ? "readonly" : "active"}:${showCoordinates ? "coords" : "no-coords"}:${brokenEditMode ? "broken-edit" : "normal"}`;
    const cells = [];
    for (let y = 0; y < container.height; y += 1) {
      for (let x = 0; x < container.width; x += 1) {
        const broken = brokenSet.has(cellKey(x, y));
        const action = brokenEditMode ? "toggle-broken-cell" : "place-selected";
        const label = broken ? `Broken cell ${x + 1}, ${y + 1}` : `Cell ${x + 1}, ${y + 1}`;
        cells.push(`<button type="button" class="glucargo-cell ${broken ? "is-broken" : ""} ${brokenEditMode ? "is-broken-edit" : ""}" data-action="${action}" data-x="${x}" data-y="${y}" data-coord="${x + 1},${y + 1}" ${readonly ? "disabled" : ""} aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"></button>`);
      }
    }

    const selected = mission.cargo?.[this.selectedCargoId];
    const isMovingSelected = Boolean(selected && this.placementActive && this.previewCell);
    const cargoTiles = Object.values(mission.cargo ?? {})
      .filter(cargo => cargo.location?.type === "container" && cargo.location.containerId === container.id)
      .filter(cargo => !isHiddenFromPlayer(cargo))
      .map(cargo => this.renderCargoTile(cargo, cellSize))
      .join("");

    const preview = isMovingSelected
      ? this.renderPreviewTile(mission, container, selected, cellSize)
      : "";

    return `
      <section class="glucargo-grid-panel">
        <div class="glucargo-grid-panel__head">
          <div>
            <span class="glucargo-kicker">Active Container</span>
            <h2>${escapeHtml(container.name)}</h2>
          </div>
          <div class="glucargo-grid-panel__tools">
            ${game.user.isGM ? `<button type="button" class="${showCoordinates ? "is-on" : ""}" data-action="toggle-coordinates"><i class="fa-solid fa-table-cells"></i> Coords</button>` : ""}
            ${canEditBrokenCells ? `<button type="button" class="${brokenEditMode ? "is-on" : ""}" data-action="toggle-broken-cells" data-container-id="${escapeAttr(container.id)}" title="Mark broken cells"><i class="fa-solid fa-hammer"></i> Broken</button>` : ""}
            ${selected && !readonly ? `<button type="button" data-action="move-selected"><i class="fa-solid fa-up-down-left-right"></i> Move</button><button type="button" data-action="rotate-selected"><i class="fa-solid fa-rotate-right"></i> Rotate</button><button type="button" data-action="cancel-selection"><i class="fa-solid fa-ban"></i> Cancel</button>` : ""}
          </div>
        </div>
        <div class="glucargo-grid-wrap ${readonly ? "is-readonly" : ""} ${showCoordinates ? "show-coords" : ""} ${brokenEditMode ? "is-broken-edit" : ""}" style="--glucargo-cell:${cellSize}px; --glucargo-cols:${container.width}; --glucargo-rows:${container.height};">
          <div class="glucargo-grid" data-grid-container-id="${escapeAttr(container.id)}" data-grid-key="${escapeAttr(gridKey)}">
            ${cells.join("")}
            ${cargoTiles}
            ${preview}
          </div>
        </div>
      </section>
    `;
  }

  renderCargoTools(mission, selected) {
    const tools = [
      game.user.isGM && mission.status !== "extracted" ? this.renderQuickCargo(mission) : "",
      selected ? this.renderDetailPanel(mission, selected) : ""
    ].filter(Boolean).join("");
    if (!tools) return "";
    return `<aside class="glucargo-manifest glucargo-cargo-tools">${tools}</aside>`;
  }

  renderFloorDock(mission) {
    const floorCargo = this.getManifestCargo(mission);
    return `
      <section class="glucargo-panel glucargo-floor-dock">
        <div class="glucargo-floor-dock__sidebar">
          <div class="glucargo-panel__head">
            <span>Floor Manifest</span>
            <small>${floorCargo.length}</small>
          </div>
          <label>
            <span>Search</span>
            <input type="search" data-filter="search" placeholder="Search" value="${escapeAttr(this.search)}">
          </label>
          <label>
            <span>Category</span>
            <select data-filter="category">${this.renderCategoryOptions(this.filters.category, true)}</select>
          </label>
          <label>
            <span>Visibility</span>
            <select data-filter="visibility">
              ${["all", "revealed", "scanned", "unknown"].map(value => `<option value="${value}" ${this.filters.visibility === value ? "selected" : ""}>${capitalize(value)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select data-filter="sort">
              ${[
                ["newest", "Newest"],
                ["priority", "Priority"],
                ["name", "Name"],
                ["size", "Size"]
              ].map(([value, label]) => `<option value="${value}" ${this.filters.sort === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="glucargo-floor-list">
          ${floorCargo.length ? floorCargo.map(cargo => this.renderFloorCargo(cargo)).join("") : `<div class="glucargo-empty-list">No cargo on the floor.</div>`}
        </div>
      </section>
    `;
  }

  renderQuickCargo() {
    const maxRandomShapeCells = this.getMaxRandomShapeCells();
    const currentShapeCells = getShapeMetrics(this.quickShape).cells.length;
    const draft = this.getQuickCargoDraft(currentShapeCells);
    return `
      <section class="glucargo-panel glucargo-quick">
        <div class="glucargo-panel__head">
          <span>Quick Cargo</span>
          <small>${this.droppedItem ? "Item linked" : "Drop PF2e item"}</small>
        </div>
        <form data-form="quick-cargo">
          <div class="glucargo-field-grid">
            <label>Name<input name="name" type="text" value="${escapeAttr(draft.name)}" placeholder="Cargo name" required></label>
            <label>Subtitle<input name="subtitle" type="text" value="${escapeAttr(draft.subtitle)}" placeholder="Benefit or contents"></label>
            <label>Category<select name="category">${this.renderCategoryOptions(draft.category)}</select></label>
            <label>Priority<select name="priority">
              ${["normal", "high", "critical"].map(value => `<option value="${value}" ${draft.priority === value ? "selected" : ""}>${capitalize(value)}</option>`).join("")}
            </select></label>
            <label>Qty<input name="quantity" type="number" value="${escapeAttr(draft.quantity)}" min="1" max="20"></label>
            <label>Color<input name="color" type="color" value="${escapeAttr(draft.color)}"></label>
            <label class="glucargo-hidden-toggle" title="Hide from players until revealed"><input name="hidden" type="checkbox" ${draft.hidden ? "checked" : ""}> Hidden from players</label>
          </div>
          <div class="glucargo-shape-tools">
            <span>Shape</span>
            <button type="button" data-action="shape-preset" data-preset="one">1</button>
            <button type="button" data-action="shape-preset" data-preset="two">2</button>
            <button type="button" data-action="shape-preset" data-preset="box">Box</button>
            <button type="button" data-action="shape-preset" data-preset="l">L</button>
            <button type="button" data-action="shape-preset" data-preset="t">T</button>
            <label class="glucargo-shape-size">Cells<input name="randomShapeSize" type="number" min="1" max="${maxRandomShapeCells}" value="${escapeAttr(draft.randomShapeSize)}"></label>
            <button type="button" data-action="random-quick-shape" title="Generate random valid shape"><i class="fa-solid fa-shuffle"></i></button>
            <button type="button" data-action="rotate-quick-shape"><i class="fa-solid fa-rotate-right"></i></button>
            <button type="button" data-action="clear-quick-shape"><i class="fa-solid fa-eraser"></i></button>
          </div>
          ${this.renderShapeEditor()}
          <button type="submit" class="glucargo-primary"><i class="fa-solid fa-plus"></i> Award Cargo</button>
        </form>
      </section>
    `;
  }

  renderShapeEditor() {
    const size = Math.max(3, Math.min(12, Number(game.settings.get(MODULE_ID, SETTINGS.maxShapeSize) ?? 8)));
    const shapeSet = getShapeMetrics(this.quickShape).cellSet;
    const cells = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const active = shapeSet.has(`${x},${y}`);
        cells.push(`<button type="button" class="glucargo-shape-cell ${active ? "is-on" : ""}" data-action="toggle-shape-cell" data-x="${x}" data-y="${y}" aria-label="Shape cell ${x + 1}, ${y + 1}"></button>`);
      }
    }
    return `<div class="glucargo-shape-editor" style="--shape-size:${size};">${cells.join("")}</div>`;
  }

  renderFloorCargo(cargo) {
    const visible = getPlayerFacingCargo(cargo);
    const cat = getCategory(cargo);
    const locked = lockOwner(cargo);
    const preview = this.renderCargoShapePreview(cargo);
    const lockMessage = locked ? `Picked up by ${locked}` : "";
    const newClass = this.renderedFloorCargoIds.has(cargo.id) ? "" : " is-new";
    const isHidden = Boolean(cargo.hidden);
    const hiddenClass = game.user.isGM && isHidden ? " is-hidden" : "";
    const visibilityToggle = game.user.isGM
      ? `<button type="button" class="glucargo-visibility-toggle ${isHidden ? "is-hidden" : ""}" data-action="toggle-cargo-hidden" data-cargo-id="${escapeAttr(cargo.id)}" title="${isHidden ? "Hidden from players — click to reveal" : "Visible to players — click to hide"}" aria-label="${isHidden ? "Reveal cargo to players" : "Hide cargo from players"}"><i class="fa-solid ${isHidden ? "fa-eye-slash" : "fa-eye"}"></i></button>`
      : "";
    return `
      <article class="glucargo-floor-item${newClass}${hiddenClass} ${this.selectedCargoId === cargo.id ? "is-selected" : ""} ${locked ? "is-locked" : ""} priority-${escapeAttr(cargo.priority ?? "normal")}" data-cargo-id="${escapeAttr(cargo.id)}" draggable="false" style="--cargo-accent:${escapeAttr(cat.color)};">
        <button type="button" data-action="select-cargo" data-cargo-id="${escapeAttr(cargo.id)}">
          ${preview}
          <span class="glucargo-floor-item__copy">
            <strong>${escapeHtml(visible.name)}</strong>
            <small>${escapeHtml(visible.subtitle || cat.label)}</small>
            <span class="glucargo-floor-item__meta">
              <span>${escapeHtml(cat.label)}</span>
              <span>${getShapeMetrics(visible.shape).cells.length} cells</span>
              <span>${escapeHtml(cargo.priority ?? "normal")}</span>
            </span>
          </span>
          ${locked ? `<span class="glucargo-lock glucargo-floor-lock" title="Locked by ${escapeAttr(locked)}"><i class="fa-solid fa-lock"></i></span>` : ""}
          ${lockMessage ? `<span class="glucargo-lock-banner"><strong>${escapeHtml(lockMessage)}</strong></span>` : ""}
        </button>
        ${visibilityToggle}
      </article>
    `;
  }

  renderCargoShapePreview(cargo) {
    const visible = getPlayerFacingCargo(cargo);
    const cat = getCategory(cargo);
    const rotation = this.selectedCargoId === cargo.id ? this.selectedRotation ?? cargo.rotation ?? 0 : cargo.rotation ?? 0;
    const { cells, width, height, cellSet } = getShapeMetrics(visible.shape, rotation);
    const cellSize = Math.max(5, Math.min(14, Math.floor(44 / width), Math.floor(44 / height)));
    const cellHtml = cells.map(cell => {
      const edges = [];
      if (!cellSet.has(`${cell.x},${cell.y - 1}`)) edges.push("top");
      if (!cellSet.has(`${cell.x + 1},${cell.y}`)) edges.push("right");
      if (!cellSet.has(`${cell.x},${cell.y + 1}`)) edges.push("bottom");
      if (!cellSet.has(`${cell.x - 1},${cell.y}`)) edges.push("left");
      return `<span style="grid-column:${cell.x + 1}; grid-row:${cell.y + 1};" data-edges="${edges.join(" ")}"></span>`;
    }).join("");
    return `
      <span class="glucargo-shape-preview" aria-hidden="true" style="--preview-cols:${width}; --preview-rows:${height}; --preview-cell:${cellSize}px; --cargo-accent:${escapeAttr(cat.color)};">
        ${cellHtml}
      </span>
    `;
  }

  renderCargoTile(cargo, cellSize) {
    const visible = getPlayerFacingCargo(cargo);
    const cat = getCategory(cargo);
    const { cells, width, height, cellSet, maskUrl, iconCell, labelSegment } = getShapeMetrics(cargo.shape, cargo.rotation ?? 0);
    const pos = cargo.location?.position ?? { x: 0, y: 0 };
    const selected = this.selectedCargoId === cargo.id;
    const lockedBy = lockOwner(cargo);
    const locked = Boolean(lockedBy);
    const lockedByOther = isLockedByOther(cargo);
    const lockLabel = lockedBy ? `Picked up by ${lockedBy}` : "";
    const image = cargoImage(cargo);
    const imageStyle = image ? ` --cargo-image:${cssUrl(image)};` : "";
    const tileVars = `--tile-x:${pos.x}; --tile-y:${pos.y}; --tile-w:${width}; --tile-h:${height}; --cargo-accent:${escapeAttr(cat.color)}; --tile-mask:${maskUrl}; --emblem-x:${iconCell.x}; --emblem-y:${iconCell.y};${imageStyle}`;
    const labelVars = `--tile-x:${pos.x + labelSegment.x}; --tile-y:${pos.y + labelSegment.y}; --tile-w:${labelSegment.width}; --tile-h:${labelSegment.height}; --cargo-accent:${escapeAttr(cat.color)};`;

    const cellHtml = cells.map(cell => {
      const gx = pos.x + cell.x;
      const gy = pos.y + cell.y;
      const edges = [];
      if (!cellSet.has(`${cell.x},${cell.y - 1}`)) edges.push("top");
      if (!cellSet.has(`${cell.x + 1},${cell.y}`)) edges.push("right");
      if (!cellSet.has(`${cell.x},${cell.y + 1}`)) edges.push("bottom");
      if (!cellSet.has(`${cell.x - 1},${cell.y}`)) edges.push("left");
      const posClass = `at-r${cell.y}-c${cell.x}`;
      const lockAnchor = locked && cell.x === labelSegment.x && cell.y === labelSegment.y;
      return `<button type="button" class="glucargo-tile-cell ${selected ? "is-selected" : ""} ${locked ? "is-locked" : ""} ${locked && !lockedByOther ? "is-own-lock" : ""} ${lockAnchor ? "is-lock-anchor" : ""} pattern-${escapeAttr(cat.pattern)} ${image ? "has-image" : ""} priority-${escapeAttr(cargo.priority ?? "normal")} ${posClass}" data-action="select-cargo" data-cargo-id="${escapeAttr(cargo.id)}" draggable="false" style="--cx:${gx}; --cy:${gy}; --lx:${cell.x}; --ly:${cell.y}; --cargo-accent:${escapeAttr(cat.color)};${imageStyle}" data-edges="${edges.join(" ")}" data-lx="${cell.x}" data-ly="${cell.y}" ${lockLabel ? `data-lock-label="${escapeAttr(lockLabel)}"` : ""}></button>`;
    }).join("");

    const compact = cells.length === 1;
    const narrow = labelSegment.height === 1;
    const overlayIcon = `<div class="glucargo-tile-emblem ${image ? "has-image" : ""}" data-cargo-id="${escapeAttr(cargo.id)}" style="${tileVars}"><span>${renderCargoIcon(cat, image)}</span></div>`;
    const label = `<div class="glucargo-tile-label ${selected ? "is-selected" : ""} ${compact ? "is-compact" : ""} ${narrow ? "is-narrow" : ""}" data-cargo-id="${escapeAttr(cargo.id)}" style="${labelVars}"><strong>${escapeHtml(visible.name)}</strong><small>${escapeHtml(visible.subtitle || cat.label)}</small></div>`;
    const lockOverlay = locked ? `<div class="glucargo-lock-overlay" data-cargo-id="${escapeAttr(cargo.id)}" style="${tileVars}"><strong>Picked up by ${escapeHtml(lockedBy)}</strong></div>` : "";

    return cellHtml + overlayIcon + label + lockOverlay;
  }

  renderPreviewTile(mission, container, cargo, cellSize) {
    const rotation = this.selectedRotation ?? cargo.rotation ?? 0;
    const { rows, cells, width, height, cellSet, maskUrl, iconCell } = getShapeMetrics(cargo.shape, rotation);
    const context = this.getPlacementContext(mission, container, cargo.id);
    const valid = canPlaceCargo(mission, container, cargo.id, rows, this.previewCell, context);
    const cat = getCategory(cargo);
    const image = cargoImage(cargo);
    const previewVars = `--tile-x:${this.previewCell.x}; --tile-y:${this.previewCell.y}; --tile-w:${width}; --tile-h:${height}; --cargo-accent:${escapeAttr(cat.color)}; --tile-mask:${maskUrl}; --emblem-x:${iconCell.x}; --emblem-y:${iconCell.y};`;
    const cellHtml = cells.map(cell => {
      const gx = this.previewCell.x + cell.x;
      const gy = this.previewCell.y + cell.y;
      const edges = [];
      if (!cellSet.has(`${cell.x},${cell.y - 1}`)) edges.push("top");
      if (!cellSet.has(`${cell.x + 1},${cell.y}`)) edges.push("right");
      if (!cellSet.has(`${cell.x},${cell.y + 1}`)) edges.push("bottom");
      if (!cellSet.has(`${cell.x - 1},${cell.y}`)) edges.push("left");
      return `<div class="glucargo-preview-cell ${valid ? "is-valid" : "is-invalid"}" style="--cx:${gx}; --cy:${gy}; --cargo-accent:${escapeAttr(cat.color)};" data-edges="${edges.join(" ")}"></div>`;
    }).join("");
    const emblem = `<div class="glucargo-preview-emblem ${valid ? "is-valid" : "is-invalid"}" style="${previewVars}"><span>${renderCargoIcon(cat, image)}</span></div>`;
    return cellHtml + emblem;
  }

  renderTileMask(cargo) {
    const { cells } = getShapeMetrics(cargo.shape, cargo.rotation ?? 0);
    return `<span class="glucargo-tile__mask">${cells.map(cell => `<span style="--cx:${cell.x}; --cy:${cell.y};"></span>`).join("")}</span>`;
  }

  renderDetailPanel(_mission, cargo) {
    const visible = getPlayerFacingCargo(cargo);
    const cat = getCategory(cargo);
    const canEdit = game.user.isGM;
    const lock = lockOwner(cargo);
    const image = cargoImage(cargo);
    const { cells, width, height } = getShapeMetrics(cargo.shape, cargo.rotation ?? 0);
    const footprint = `${width}x${height}`;
    const linked = cargo.linkedItem;
    const location = cargo.location?.type === "container" ? "Container" : "Floor manifest";
    return `
      <aside class="glucargo-detail ${image ? "has-image" : ""}" style="--cargo-accent:${escapeAttr(cat.color)};">
        <div class="glucargo-detail__head">
          <span>${renderCargoIcon(cat, image)}</span>
          <div>
            <strong>${escapeHtml(visible.name)}</strong>
            <small>${escapeHtml(visible.subtitle || cat.label)}</small>
          </div>
          <button type="button" data-action="cancel-selection" title="Close details"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <dl>
          <dt>Subtitle</dt><dd>${escapeHtml(visible.subtitle || cat.label)}</dd>
          <dt>Category</dt><dd>${escapeHtml(cat.label)}</dd>
          <dt>Visibility</dt><dd>${escapeHtml(cargo.visibility ?? VISIBILITY.revealed)}</dd>
          ${canEdit ? `<dt>Players</dt><dd>${cargo.hidden ? "Hidden" : "Shown"}</dd>` : ""}
          <dt>Priority</dt><dd>${escapeHtml(cargo.priority ?? "normal")}</dd>
          <dt>Location</dt><dd>${escapeHtml(location)}</dd>
          <dt>Footprint</dt><dd>${footprint} / ${cells.length} cells</dd>
          ${linked?.type ? `<dt>Item Type</dt><dd>${escapeHtml(capitalize(linked.type))}</dd>` : ""}
          ${linked?.level !== null && linked?.level !== undefined && linked?.level !== "" ? `<dt>Level</dt><dd>${escapeHtml(linked.level)}</dd>` : ""}
          ${linked?.rarity ? `<dt>Rarity</dt><dd>${escapeHtml(capitalize(linked.rarity))}</dd>` : ""}
          ${linked?.traits?.length ? `<dt>Traits</dt><dd>${linked.traits.map(trait => escapeHtml(trait)).join(", ")}</dd>` : ""}
          ${linked?.description ? `<dt>Description</dt><dd>${escapeHtml(linked.description)}</dd>` : ""}
          ${lock ? `<dt>Lock</dt><dd>${escapeHtml(lock)}</dd>` : ""}
        </dl>
        ${cargo.linkedItem?.uuid && cargo.visibility !== VISIBILITY.unknown ? `
          <button type="button" data-action="open-linked-item" data-cargo-id="${escapeAttr(cargo.id)}"><i class="fa-solid fa-up-right-from-square"></i> Open linked item</button>
        ` : ""}
        ${cargo.location?.type === "container" && _mission.status !== "extracted" ? `
          <button type="button" data-action="move-selected" data-cargo-id="${escapeAttr(cargo.id)}"><i class="fa-solid fa-up-down-left-right"></i> Move</button>
          <button type="button" data-action="return-to-floor" data-cargo-id="${escapeAttr(cargo.id)}"><i class="fa-solid fa-arrow-up-from-bracket"></i> Return to floor</button>
        ` : ""}
        ${canEdit ? `
          <form data-form="edit-cargo" data-cargo-id="${escapeAttr(cargo.id)}">
            <label>Name<input name="name" value="${escapeAttr(cargo.name)}"></label>
            <label>Subtitle<input name="subtitle" value="${escapeAttr(cargo.subtitle ?? "")}"></label>
            <label>Visibility<select name="visibility">${Object.values(VISIBILITY).map(value => `<option value="${value}" ${cargo.visibility === value ? "selected" : ""}>${capitalize(value)}</option>`).join("")}</select></label>
            <label>Priority<select name="priority">${["normal", "high", "critical"].map(value => `<option value="${value}" ${cargo.priority === value ? "selected" : ""}>${capitalize(value)}</option>`).join("")}</select></label>
            <label class="glucargo-hidden-toggle" title="Hide from players until revealed"><input name="hidden" type="checkbox" ${cargo.hidden ? "checked" : ""}> Hidden from players</label>
            <button type="submit"><i class="fa-solid fa-floppy-disk"></i> Save</button>
            <button type="button" class="danger" data-action="delete-cargo" data-cargo-id="${escapeAttr(cargo.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
          </form>
        ` : ""}
      </aside>
    `;
  }

  renderCategoryOptions(selected = "supplies", includeAll = false) {
    const options = includeAll ? [`<option value="all" ${selected === "all" ? "selected" : ""}>All categories</option>`] : [];
    for (const [value, cat] of Object.entries(CATEGORIES)) {
      options.push(`<option value="${value}" ${selected === value ? "selected" : ""}>${escapeHtml(cat.label)}</option>`);
    }
    return options.join("");
  }

  createQuickCargoDraft(overrides = {}) {
    const requestedCategory = String(overrides.category ?? (this.droppedItem ? "loot" : "supplies"));
    const category = CATEGORIES[requestedCategory] ? requestedCategory : "supplies";
    const fallbackColor = CATEGORIES[category]?.color ?? CATEGORIES.supplies.color;
    const color = String(overrides.color ?? fallbackColor);
    const priority = String(overrides.priority ?? "normal");
    const currentShapeCells = getShapeMetrics(this.quickShape ?? DEFAULT_SHAPE).cells.length;
    const randomShapeSize = Math.max(1, Math.min(this.getMaxRandomShapeCells(), Number(overrides.randomShapeSize ?? currentShapeCells) || currentShapeCells));
    return {
      name: String(overrides.name ?? this.droppedItem?.name ?? ""),
      subtitle: String(overrides.subtitle ?? (this.droppedItem ? summarizeItem(this.droppedItem) : "")),
      category,
      priority: ["normal", "high", "critical"].includes(priority) ? priority : "normal",
      quantity: String(Math.max(1, Math.min(20, Number(overrides.quantity ?? 1) || 1))),
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : fallbackColor,
      randomShapeSize: String(randomShapeSize),
      hidden: Boolean(overrides.hidden)
    };
  }

  getQuickCargoDraft(currentShapeCells = getShapeMetrics(this.quickShape).cells.length) {
    return this.createQuickCargoDraft({
      randomShapeSize: currentShapeCells,
      ...(this.quickCargoDraft ?? {})
    });
  }

  captureQuickCargoDraft(form) {
    if (!form) return;
    const formData = new FormData(form);
    this.quickCargoDraft = this.createQuickCargoDraft({
      name: formData.get("name") ?? "",
      subtitle: formData.get("subtitle") ?? "",
      category: formData.get("category") ?? "supplies",
      priority: formData.get("priority") ?? "normal",
      quantity: formData.get("quantity") ?? "1",
      color: formData.get("color") ?? CATEGORIES.supplies.color,
      randomShapeSize: formData.get("randomShapeSize") ?? getShapeMetrics(this.quickShape).cells.length,
      hidden: formData.get("hidden") === "on"
    });
  }

  recordRenderedFloorCargo() {
    const items = this.element?.querySelectorAll(".glucargo-floor-item[data-cargo-id]") ?? [];
    this.renderedFloorCargoIds = new Set(Array.from(items, item => item.dataset.cargoId).filter(Boolean));
  }

  bindPersistentEvents() {
    this.element.addEventListener("click", event => this.onClick(event));
    this.element.addEventListener("submit", event => this.onSubmit(event));
    this.element.addEventListener("input", event => this.onInput(event));
    this.element.addEventListener("change", event => this.onInput(event));
    this.element.addEventListener("keydown", event => this.onKeydown(event));
    this.element.addEventListener("contextmenu", event => this.onContextMenu(event));
    this.element.addEventListener("pointerdown", event => this.onCargoHoldStart(event));
    this.element.addEventListener("pointermove", event => this.onCargoHoldMove(event));
    this.element.addEventListener("pointerup", event => this.onCargoHoldEnd(event));
    this.element.addEventListener("pointercancel", event => this.onCargoHoldEnd(event));
    this.element.addEventListener("pointerover", event => this.onCargoPointerOver(event));
    this.element.addEventListener("pointerout", event => this.onCargoPointerOut(event));
    this.element.addEventListener("dragstart", event => this.onDragStart(event));
    this.element.addEventListener("dragover", event => {
      event.preventDefault();
      this.element.classList.add("is-drop-ready");
    });
    this.element.addEventListener("dragleave", event => {
      if (event.target === this.element) this.element.classList.remove("is-drop-ready");
    });
    this.element.addEventListener("drop", event => this.onDrop(event));
    this.bindDrag();
  }

  bindRenderedEvents() {
    const grid = this.element.querySelector("[data-grid-container-id]");
    if (grid?.dataset.eventsBound === "1") {
      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver(() => this.saveViewState());
      this.resizeObserver.observe(this.element);
      return;
    }
    grid?.addEventListener("pointermove", event => {
      if (!this.selectedCargoId || !this.placementActive) return;
      const cell = this.getGridCellFromEvent(event);
      if (!cell) return;
      const nx = cell.x, ny = cell.y;
      if (this.previewCell?.x === nx && this.previewCell?.y === ny) return;
      this.previewCell = { x: nx, y: ny };
      this.updatePreview();
    });
    grid?.addEventListener("pointerleave", () => {
      if (!this.previewCell) return;
      this.previewCell = null;
      this.updatePreview();
    });
    grid?.addEventListener("dragover", event => {
      event.preventDefault();
      const cid = this.placementActive ? this.selectedCargoId : null;
      if (!cid) return;
      this.placementActive = true;
      const cell = this.getGridCellFromEvent(event);
      if (!cell) return;
      const nx = cell.x, ny = cell.y;
      if (this.previewCell?.x === nx && this.previewCell?.y === ny) return;
      this.previewCell = { x: nx, y: ny };
      this.updatePreview();
    });
    if (grid) grid.dataset.eventsBound = "1";

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.saveViewState());
    this.resizeObserver.observe(this.element);
  }

  updateGridContents(currentGrid, nextGrid) {
    currentGrid.querySelectorAll(".glucargo-tile-cell, .glucargo-tile-emblem, .glucargo-tile-label, .glucargo-lock-overlay, .glucargo-preview-cell, .glucargo-preview-emblem").forEach(el => el.remove());
    nextGrid.querySelectorAll(".glucargo-tile-cell, .glucargo-tile-emblem, .glucargo-tile-label, .glucargo-lock-overlay, .glucargo-preview-cell, .glucargo-preview-emblem").forEach(el => {
      currentGrid.append(el);
    });
  }

  updatePreview() {
    const grid = this.element?.querySelector(".glucargo-grid");
    if (!grid) return;
    grid.querySelectorAll(".glucargo-preview-cell, .glucargo-preview-emblem").forEach(el => el.remove());
    grid.querySelectorAll(".is-moving-source").forEach(el => el.classList.remove("is-moving-source"));
    if (!this.selectedCargoId || !this.placementActive || !this.previewCell) return;
    grid.querySelectorAll(".glucargo-tile-cell, .glucargo-tile-label, .glucargo-tile-emblem").forEach(el => {
      if (el.dataset.cargoId === this.selectedCargoId) el.classList.add("is-moving-source");
    });
    const mission = this.renderMission ?? getActiveMission();
    if (!mission) return;
    const cargo = mission.cargo?.[this.selectedCargoId];
    const container = this.getActiveContainer(mission);
    if (!cargo || !container) return;
    const cellSize = this.getCellSize(container);
    const html = this.renderPreviewTile(mission, container, cargo, cellSize);
    if (html) grid.insertAdjacentHTML("beforeend", html);
  }

  onCargoPointerOver(event) {
    const target = event.target.closest(".glucargo-grid [data-cargo-id]");
    if (!target) return;
    this.setHoveredCargo(target.dataset.cargoId || null);
  }

  onCargoPointerOut(event) {
    const target = event.target.closest(".glucargo-grid [data-cargo-id]");
    if (!target) return;
    const next = event.relatedTarget?.closest?.(".glucargo-grid [data-cargo-id]");
    if (next?.dataset.cargoId === target.dataset.cargoId) return;
    this.setHoveredCargo(null);
  }

  setHoveredCargo(cargoId) {
    const grid = this.element?.querySelector(".glucargo-grid");
    if (!grid) return;
    this.hoveredCargoId = cargoId;
    grid.querySelectorAll(".is-cargo-hovered").forEach(el => el.classList.remove("is-cargo-hovered"));
    if (!cargoId) return;
    grid.querySelectorAll(".glucargo-tile-cell, .glucargo-tile-emblem, .glucargo-tile-label").forEach(el => {
      if (el.dataset.cargoId === cargoId) el.classList.add("is-cargo-hovered");
    });
  }

  onCargoHoldStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const tile = event.target.closest(".glucargo-grid .glucargo-tile-cell[data-cargo-id]");
    if (!tile || tile.classList.contains("is-locked")) return;
    const cargoId = tile.dataset.cargoId;
    const mission = this.renderMission ?? getActiveMission();
    const cargo = mission?.cargo?.[cargoId];
    if (!cargo || mission.status === "extracted" || (mission.locked && !game.user.isGM) || isLockedByOther(cargo)) return;
    this.cancelHoldToMove();
    this.holdToMove = {
      cargoId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: window.setTimeout(() => this.completeHoldToMove(cargoId, event.pointerId), HOLD_TO_MOVE_MS)
    };
    tile.setPointerCapture?.(event.pointerId);
    this.setHoldToMoveState(cargoId, true);
  }

  onCargoHoldMove(event) {
    const hold = this.holdToMove;
    if (!hold || hold.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - hold.startX) <= HOLD_TO_MOVE_CANCEL_PX && Math.abs(event.clientY - hold.startY) <= HOLD_TO_MOVE_CANCEL_PX) return;
    this.cancelHoldToMove();
  }

  onCargoHoldEnd(event) {
    if (!this.holdToMove || this.holdToMove.pointerId !== event.pointerId) return;
    this.cancelHoldToMove();
  }

  async completeHoldToMove(cargoId, pointerId) {
    if (!this.holdToMove || this.holdToMove.cargoId !== cargoId || this.holdToMove.pointerId !== pointerId) return;
    this.cancelHoldToMove();
    this.suppressNextCargoClickId = cargoId;
    await this.moveSelected(cargoId);
    window.setTimeout(() => {
      if (this.suppressNextCargoClickId === cargoId) this.suppressNextCargoClickId = null;
    }, 1000);
  }

  cancelHoldToMove() {
    const cargoId = this.holdToMove?.cargoId;
    if (this.holdToMove?.timer) window.clearTimeout(this.holdToMove.timer);
    this.holdToMove = null;
    if (cargoId) this.setHoldToMoveState(cargoId, false);
  }

  setHoldToMoveState(cargoId, active) {
    const grid = this.element?.querySelector(".glucargo-grid");
    if (!grid) return;
    grid.querySelectorAll(".is-hold-arming").forEach(el => el.classList.remove("is-hold-arming"));
    if (!active) return;
    grid.querySelectorAll(".glucargo-tile-cell, .glucargo-tile-emblem, .glucargo-tile-label").forEach(el => {
      if (el.dataset.cargoId === cargoId) el.classList.add("is-hold-arming");
    });
  }

  bindDrag() {
    let dragging = null;
    const finishDrag = event => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      const left = Math.max(8, Math.min(window.innerWidth - 80, dragging.left + event.clientX - dragging.startX));
      const top = Math.max(8, Math.min(window.innerHeight - 60, dragging.top + event.clientY - dragging.startY));
      dragging = null;
      this.element.style.left = `${left}px`;
      this.element.style.top = `${top}px`;
      this.element.style.transform = "";
      this.element.classList.remove("is-dragging");
      this.persistViewState();
    };
    this.element.addEventListener("pointerdown", event => {
      if (!event.target.closest("[data-drag-handle]")) return;
      if (event.target.closest("button, input, select, textarea")) return;
      dragging = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: this.element.offsetLeft,
        top: this.element.offsetTop
      };
      this.element.setPointerCapture(event.pointerId);
      this.element.classList.add("is-dragging");
    });
    this.element.addEventListener("pointermove", event => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      const dx = event.clientX - dragging.startX;
      const dy = event.clientY - dragging.startY;
      this.element.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    });
    this.element.addEventListener("pointerup", finishDrag);
    this.element.addEventListener("pointercancel", finishDrag);
  }

  async onClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const data = getReadData();
    const mission = getActiveMission(data);
    const quickCargoForm = actionEl.closest("[data-form='quick-cargo']");
    if (quickCargoForm) this.captureQuickCargoDraft(quickCargoForm);
    if (action === "select-cargo" && this.suppressNextCargoClickId === actionEl.dataset.cargoId) {
      this.suppressNextCargoClickId = null;
      event.preventDefault();
      return;
    }

    if (action === "toggle-broken-cell" && mission) {
      return this.toggleBrokenCell(actionEl.closest("[data-grid-container-id]")?.dataset.gridContainerId, Number(actionEl.dataset.x), Number(actionEl.dataset.y));
    }

    if (this.selectedCargoId && this.placementActive && mission && action !== "rotate-selected" && action !== "cancel-selection" && actionEl.closest(".glucargo-grid")) {
      const cell = this.getGridCellFromEvent(event, mission);
      if (cell) return this.placeSelected(mission, cell.x, cell.y);
    }

    if (action === "close") return this.close();
    if (action === "create-mission") return this.createMissionFromInput();
    if (action === "toggle-visibility") return this.toggleVisibility();
    if (action === "toggle-board-lock") return this.toggleBoardLock();
    if (action === "undo") return this.undo();
    if (action === "select-container") return this.selectContainer(actionEl.dataset.containerId);
    if (action === "add-container") return this.addContainer();
    if (action === "edit-container") return this.editContainer(actionEl.dataset.containerId);
    if (action === "delete-container") return this.deleteContainer(actionEl.dataset.containerId);
    if (action === "activate-mission") return this.activateMission(actionEl.dataset.missionId);
    if (action === "duplicate-mission") return this.duplicateMission();
    if (action === "delete-mission") return this.deleteMission();
    if (action === "reopen-mission") return this.reopenMission();
    if (action === "extract-mission") return this.extractMission();
    if (action === "shape-preset") return this.setQuickShape(SHAPE_PRESETS[actionEl.dataset.preset] ?? DEFAULT_SHAPE);
    if (action === "random-quick-shape") return this.randomizeQuickShape(actionEl.closest("form")?.elements?.randomShapeSize?.value);
    if (action === "rotate-quick-shape") return this.setQuickShape(rotateShape(this.quickShape, 1));
    if (action === "clear-quick-shape") return this.setQuickShape(["X"]);
    if (action === "toggle-shape-cell") return this.toggleShapeCell(Number(actionEl.dataset.x), Number(actionEl.dataset.y));
    if (action === "cancel-selection") return this.releaseSelection();
    if (action === "move-selected") return this.moveSelected(actionEl.dataset.cargoId);
    if (action === "rotate-selected") return this.rotateSelected();
    if (action === "return-to-floor") return this.returnToFloor(actionEl.dataset.cargoId);
    if (action === "open-linked-item") return this.openLinkedItem(actionEl.dataset.cargoId);
    if (action === "delete-cargo") return this.deleteCargo(actionEl.dataset.cargoId);
    if (action === "toggle-cargo-hidden") return this.toggleCargoHidden(actionEl.dataset.cargoId);
    if (action === "toggle-coordinates") return this.toggleCoordinates();
    if (action === "toggle-broken-cells") return this.toggleBrokenCells(actionEl.dataset.containerId);

    if (!mission) return;
    if (action === "select-cargo") return this.selectCargo(actionEl.dataset.cargoId);
    if (action === "place-selected" && this.placementActive) return this.placeSelected(mission, Number(actionEl.dataset.x), Number(actionEl.dataset.y));
  }

  async onSubmit(event) {
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === "quick-cargo") return this.createCargo(form);
    if (form.dataset.form === "edit-cargo") return this.editCargo(form);
  }

  onInput(event) {
    const filter = event.target?.dataset?.filter;
    if (filter) {
      if (filter === "search") this.search = event.target.value ?? "";
      else this.filters[filter] = event.target.value;
      if (filter === "search") this.renderFilterDebounced();
      else this.render();
      return;
    }
    const quickCargoForm = event.target.closest("[data-form='quick-cargo']");
    if (quickCargoForm) {
      if (event.target.name === "category") {
        const colorInput = quickCargoForm.querySelector("input[name='color']");
        if (colorInput) colorInput.value = CATEGORIES[event.target.value]?.color || CATEGORIES.custom.color;
      }
      this.captureQuickCargoDraft(quickCargoForm);
    }
  }

  onKeydown(event) {
    if (event.target.matches("input, textarea, select")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.selectedCargoId) this.releaseSelection();
      else this.close();
    }
    if (event.key.toLowerCase() === "r" && this.selectedCargoId) {
      event.preventDefault();
      this.rotateSelected();
    }
    if ((event.key === "Delete" || event.key === "Backspace") && game.user.isGM && this.selectedCargoId) {
      event.preventDefault();
      this.deleteCargo(this.selectedCargoId);
    }
  }

  onContextMenu(event) {
    if (!this.selectedCargoId) return;
    if (!event.target.closest(".glucargo-grid-panel, .glucargo-floor-item")) return;
    event.preventDefault();
    this.rotateSelected();
  }

  onDragStart(event) {
    const cargoEl = event.target.closest("[data-cargo-id]");
    const cargoId = cargoEl?.dataset?.cargoId;
    if (!cargoId) return;
    event.preventDefault();
  }

  async onDrop(event) {
    event.preventDefault();
    this.element.classList.remove("is-drop-ready");
    if (!game.user.isGM) return;
    const raw = event.dataTransfer?.getData("text/plain") || event.dataTransfer?.getData("application/json");
    if (!raw) return;
    let dropped;
    try {
      dropped = JSON.parse(raw);
    } catch (_error) {
      return;
    }
    const uuid = dropped.uuid || dropped.documentUuid;
    if (!uuid || dropped.type !== "Item") return;
    const item = await resolveUuid(uuid);
    if (!item) return;
    this.droppedItem = snapshotItem(item);
    this.quickCargoDraft = this.createQuickCargoDraft({
      name: this.droppedItem.name,
      subtitle: summarizeItem(this.droppedItem),
      category: "loot",
      color: CATEGORIES.loot.color
    });
    notifyInfo(`Linked ${item.name} for the next cargo.`);
    this.render();
  }

  async createMissionFromInput() {
    if (!game.user.isGM) return;
    const input = this.element.querySelector("[data-new-mission-name]");
    const name = input?.value?.trim() || await promptTextDialog({
      title: "Create Mission",
      label: "Mission name",
      value: "Field Operation"
    }) || "Field Operation";
    await mutateData(data => {
      const mission = createMission(name);
      data.missions[mission.id] = mission;
      data.activeMissionId = mission.id;
    });
  }

  async toggleVisibility() {
    if (!game.user.isGM) return;
    await game.settings.set(MODULE_ID, SETTINGS.playerVisible, !game.settings.get(MODULE_ID, SETTINGS.playerVisible));
  }

  async toggleBoardLock() {
    if (!game.user.isGM) return;
    await mutateData(data => {
      const mission = getActiveMission(data);
      if (!mission) return;
      mission.locked = !mission.locked;
    });
  }

  async undo() {
    if (!game.user.isGM) return;
    const data = getReadData();
    if (!data.lastUndo?.data) return;
    const restore = duplicate(data.lastUndo.data);
    restore.lastUndo = null;
    await setData(restore);
  }

  async selectContainer(containerId) {
    await this.setViewState({ activeContainerId: containerId });
    this.render();
  }

  async toggleCoordinates() {
    if (!game.user.isGM) return;
    await this.setViewState({ showCoordinates: !this.viewState.showCoordinates });
    this.render();
  }

  async addContainer() {
    if (!game.user.isGM) return;
    const values = await containerDialog({ title: "Add Container" });
    if (!values) return;
    await mutateData(data => {
      const mission = getActiveMission(data);
      if (!mission) return;
      const id = makeId("container");
      mission.containers[id] = {
        id,
        name: values.name,
        width: values.width,
        height: values.height,
        locked: false,
        brokenCells: [],
        notes: "",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    });
  }

  async editContainer(containerId) {
    if (!game.user.isGM) return;
    const container = getActiveMission()?.containers?.[containerId];
    if (!container) return;
    const values = await containerDialog({ title: "Edit Container", container });
    if (!values) return;
    await mutateData(data => {
      const mission = getActiveMission(data);
      const target = mission?.containers?.[containerId];
      if (!target) return;
      target.name = values.name;
      target.width = values.width;
      target.height = values.height;
      target.locked = values.locked;
      target.brokenCells = getBrokenCellKeys(target);
      target.updatedAt = Date.now();
      returnInvalidCargoToFloor(mission, target);
    });
  }

  async toggleBrokenCells(containerId) {
    if (!game.user.isGM) return;
    const mission = getActiveMission();
    const container = mission?.containers?.[containerId];
    if (!container || mission.status === "extracted" || container.locked) return;
    const active = this.viewState.brokenEditContainerId === containerId;
    if (!active && this.selectedCargoId) await this.releaseSelection();
    await this.setViewState({ brokenEditContainerId: active ? null : containerId });
    this.render();
  }

  async toggleBrokenCell(containerId, x, y) {
    if (!game.user.isGM || !Number.isInteger(x) || !Number.isInteger(y)) return;
    const mission = getActiveMission();
    const container = mission?.containers?.[containerId];
    if (!container || mission.status === "extracted" || container.locked) return;
    if (x < 0 || y < 0 || x >= container.width || y >= container.height) return;

    await mutateData(data => {
      const active = getActiveMission(data);
      const target = active?.containers?.[containerId];
      if (!active || !target) return;
      const cells = new Set(getBrokenCellKeys(target));
      const key = cellKey(x, y);
      if (cells.has(key)) cells.delete(key);
      else cells.add(key);
      target.brokenCells = Array.from(cells).sort(compareCellKeys);
      target.updatedAt = Date.now();
      returnInvalidCargoToFloor(active, target);
    });
  }

  async deleteContainer(containerId) {
    if (!game.user.isGM) return;
    const mission = getActiveMission();
    const container = mission?.containers?.[containerId];
    if (!mission || !container) return;
    if (Object.keys(mission.containers ?? {}).length <= 1) {
      notifyWarn("A mission needs at least one container.");
      return;
    }
    const ok = await confirmDialog({
      title: "Remove Container",
      content: `<p>Remove <strong>${escapeHtml(container.name)}</strong>? Cargo inside it will return to the floor.</p>`
    });
    if (!ok) return;
    await mutateData(data => {
      const active = getActiveMission(data);
      if (!active?.containers?.[containerId]) return;
      delete active.containers[containerId];
      for (const cargo of Object.values(active.cargo ?? {})) {
        if (cargo.location?.type === "container" && cargo.location.containerId === containerId) {
          cargo.location = { type: "floor" };
          cargo.lock = null;
          cargo.updatedAt = Date.now();
        }
      }
    });
    if (this.viewState.activeContainerId === containerId) await this.setViewState({ activeContainerId: null });
  }

  async activateMission(missionId) {
    if (!game.user.isGM) return;
    await mutateData(data => {
      if (!data.missions[missionId]) return;
      data.activeMissionId = missionId;
      if (data.missions[missionId].status !== "extracted") data.missions[missionId].status = "active";
    });
  }

  async duplicateMission() {
    if (!game.user.isGM) return;
    await mutateData(data => {
      const mission = getActiveMission(data);
      if (!mission) return;
      const copy = duplicate(mission);
      copy.id = makeId("mission");
      copy.name = `${mission.name} Copy`;
      copy.status = "draft";
      copy.createdAt = Date.now();
      copy.updatedAt = Date.now();
      data.missions[copy.id] = copy;
      data.activeMissionId = copy.id;
    });
  }

  async deleteMission() {
    if (!game.user.isGM) return;
    const mission = getActiveMission();
    if (!mission) return;
    const ok = await confirmDialog({
      title: "Delete Mission",
      content: `<p>Delete <strong>${escapeHtml(mission.name)}</strong>? This cannot be undone after the next GM action.</p>`
    });
    if (!ok) return;
    await mutateData(data => {
      delete data.missions[mission.id];
      data.activeMissionId = Object.keys(data.missions)[0] ?? null;
    });
  }

  async reopenMission() {
    if (!game.user.isGM) return;
    await mutateData(data => {
      const mission = getActiveMission(data);
      if (!mission) return;
      mission.status = "active";
      mission.extractedAt = null;
      for (const cargo of Object.values(mission.cargo)) cargo.state = "available";
    });
  }

  async extractMission() {
    if (!game.user.isGM) return;
    const mission = getActiveMission();
    if (!mission) return;
    const ok = await confirmDialog({
      title: "Extract Mission",
      content: `<p>Extract <strong>${escapeHtml(mission.name)}</strong> and post a cargo report?</p>`
    });
    if (!ok) return;
    const report = buildExtractionReport(mission);
    await mutateData(data => {
      const active = getActiveMission(data);
      if (!active) return;
      active.status = "extracted";
      active.extractedAt = Date.now();
      for (const cargo of Object.values(active.cargo)) {
        if (cargo.location?.type === "container") cargo.state = "extracted";
        else if (cargo.location?.type === "held") cargo.state = "unresolved";
        else cargo.state = "abandoned";
        cargo.lock = null;
      }
    });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ alias: "Cargo Grid" }),
      content: report
    });
  }

  setQuickShape(shape) {
    this.quickShape = trimShape(shape);
    this.render();
  }

  getMaxShapeEditorSize() {
    return Math.max(3, Math.min(12, Number(game.settings.get(MODULE_ID, SETTINGS.maxShapeSize) ?? 8)));
  }

  getMaxRandomShapeCells() {
    const size = this.getMaxShapeEditorSize();
    return size * size;
  }

  randomizeQuickShape(cellCount) {
    const maxCells = this.getMaxRandomShapeCells();
    const targetCells = Math.max(1, Math.min(maxCells, Math.floor(Number(cellCount) || getShapeMetrics(this.quickShape).cells.length || 1)));
    this.quickShape = generateRandomContiguousShape(targetCells, this.getMaxShapeEditorSize());
    this.render();
  }

  toggleShapeCell(x, y) {
    const size = this.getMaxShapeEditorSize();
    const activeCells = getShapeMetrics(this.quickShape).cellSet;
    const grid = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => {
      return activeCells.has(`${col},${row}`);
    }));
    grid[y][x] = !grid[y][x];
    const next = trimShape(grid.map(row => row.map(on => on ? "X" : ".").join("")));
    this.quickShape = next.length ? next : ["X"];
    this.render();
  }

  async createCargo(form) {
    if (!game.user.isGM) return;
    const formData = new FormData(form);
    const shape = trimShape(this.quickShape);
    if (!isContiguous(shape)) {
      notifyWarn("Cargo shape must be orthogonally contiguous.");
      return;
    }
    const quantity = Math.max(1, Math.min(20, Number(formData.get("quantity") || 1)));
    const category = String(formData.get("category") || "supplies");
    const color = String(formData.get("color") || CATEGORIES[category]?.color || CATEGORIES.custom.color);
    const name = String(formData.get("name") || this.droppedItem?.name || "Cargo").trim();
    const subtitle = String(formData.get("subtitle") || "").trim();
    const linkedItem = this.droppedItem ? duplicate(this.droppedItem) : null;
    const hidden = formData.get("hidden") === "on";
    await mutateData(data => {
      const mission = getActiveMission(data);
      if (!mission) return;
      for (let i = 0; i < quantity; i += 1) {
        const id = makeId("cargo");
        mission.cargo[id] = {
          id,
          templateId: null,
          name: quantity > 1 ? `${name} ${i + 1}` : name,
          subtitle,
          category,
          customCategory: null,
          shape,
          rotation: 0,
          location: { type: "floor" },
          visibility: linkedItem ? VISIBILITY.scanned : VISIBILITY.revealed,
          hidden,
          priority: String(formData.get("priority") || "normal"),
          value: "",
          benefit: "",
          gmNotes: "",
          linkedItem,
          styleOverride: { color },
          state: "available",
          lock: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }
      mission.updatedAt = Date.now();
    });
    this.droppedItem = null;
    this.quickCargoDraft = this.createQuickCargoDraft();
  }

  async editCargo(form) {
    if (!game.user.isGM) return;
    const cargoId = form.dataset.cargoId;
    const formData = new FormData(form);
    await mutateData(data => {
      const cargo = getActiveMission(data)?.cargo?.[cargoId];
      if (!cargo) return;
      cargo.name = String(formData.get("name") || cargo.name);
      cargo.subtitle = String(formData.get("subtitle") || "");
      cargo.visibility = String(formData.get("visibility") || cargo.visibility);
      cargo.priority = String(formData.get("priority") || cargo.priority);
      cargo.hidden = formData.get("hidden") === "on";
      cargo.updatedAt = Date.now();
    });
  }

  async toggleCargoHidden(cargoId) {
    if (!game.user.isGM || !cargoId) return;
    await mutateData(data => {
      const cargo = getActiveMission(data)?.cargo?.[cargoId];
      if (!cargo) return;
      cargo.hidden = !cargo.hidden;
      cargo.updatedAt = Date.now();
    });
  }

  async deleteCargo(cargoId) {
    if (!game.user.isGM || !cargoId) return;
    const cargo = getActiveMission()?.cargo?.[cargoId];
    if (!cargo) return;
    const ok = await confirmDialog({
      title: "Delete Cargo",
      content: `<p>Delete <strong>${escapeHtml(cargo.name)}</strong>?</p>`
    });
    if (!ok) return;
    await mutateData(data => {
      const mission = getActiveMission(data);
      if (!mission) return;
      delete mission.cargo[cargoId];
    });
    this.selectedCargoId = null;
    this.selectedRotation = null;
    this.previewCell = null;
    this.placementActive = false;
    if (this.lockedCargoId === cargoId) this.lockedCargoId = null;
  }

  async selectCargo(cargoId) {
    const mission = getActiveMission();
    const cargo = mission?.cargo?.[cargoId];
    const lockedCargoId = this.lockedCargoId;
    this.lockedCargoId = null;
    if (lockedCargoId) await requestCargoMutation("releaseCargoLock", { cargoId: lockedCargoId });
    this.selectedCargoId = cargoId;
    this.selectedRotation = cargo?.rotation ?? 0;
    this.placementActive = false;
    this.previewCell = null;
    this.render();
  }

  async moveSelected(cargoId = this.selectedCargoId) {
    const mission = getActiveMission();
    const cargo = mission?.cargo?.[cargoId];
    if (!cargo || mission.status === "extracted" || (mission.locked && !game.user.isGM)) return;
    if (isLockedByOther(cargo)) {
      notifyWarn(`${cargo.name} is being moved by ${cargo.lock.userName}.`);
      return;
    }
    if (this.lockedCargoId !== cargoId) {
      const locked = await this.acquireLock(cargoId);
      if (!locked) {
        notifyWarn("The GM client did not confirm the cargo lock.");
        return;
      }
      this.lockedCargoId = cargoId;
    }
    this.selectedCargoId = cargoId;
    this.selectedRotation = cargo.rotation ?? 0;
    this.placementActive = true;
    this.render();
  }

  async acquireLock(cargoId) {
    return requestCargoMutation("lockCargo", { cargoId });
  }

  async releaseSelection() {
    const cargoId = this.lockedCargoId;
    this.selectedCargoId = null;
    this.selectedRotation = null;
    this.previewCell = null;
    this.placementActive = false;
    this.lockedCargoId = null;
    if (cargoId) {
      await requestCargoMutation("releaseCargoLock", { cargoId });
    }
    if (this.element) this.render();
  }

  async rotateSelected() {
    const mission = getActiveMission();
    const cargo = mission?.cargo?.[this.selectedCargoId];
    if (!cargo) return;
    if (mission.locked && !game.user.isGM) return;
    if (isLockedByOther(cargo)) {
      notifyWarn(`${cargo.name} is being moved by ${cargo.lock.userName}.`);
      return;
    }
    if (this.lockedCargoId !== cargo.id) {
      const locked = await this.acquireLock(cargo.id);
      if (!locked) {
        notifyWarn("The GM client did not confirm the cargo lock.");
        return;
      }
      this.lockedCargoId = cargo.id;
    }
    const nextRotation = ((this.selectedRotation ?? cargo.rotation ?? 0) + 1) % 4;
    this.selectedRotation = nextRotation;
    this.placementActive = true;
    this.render();
  }

  async placeSelected(mission, x, y) {
    const cargo = mission.cargo?.[this.selectedCargoId];
    const container = this.getActiveContainer(mission);
    if (!cargo || !container || !this.placementActive || mission.status === "extracted" || container.locked || (mission.locked && !game.user.isGM)) return;
    if (isLockedByOther(cargo)) return;
    if (this.lockedCargoId !== cargo.id) {
      const locked = await this.acquireLock(cargo.id);
      if (!locked) {
        notifyWarn("The GM client did not confirm the cargo lock.");
        return;
      }
      this.lockedCargoId = cargo.id;
    }
    const rotation = this.selectedRotation ?? cargo.rotation ?? 0;
    const shape = rotateShape(cargo.shape, rotation);
    if (!canPlaceCargo(mission, container, cargo.id, shape, { x, y })) {
      this.flashInvalidPlacement(x, y);
      notifyWarn("Cargo does not fit there.");
      return;
    }
    const placed = await requestCargoMutation("placeCargo", {
      cargoId: cargo.id,
      containerId: container.id,
      x,
      y,
      rotation
    }, { undo: game.user.isGM });
    if (!placed) {
      notifyWarn("The GM client did not accept the cargo placement.");
      return;
    }
    this.selectedCargoId = null;
    this.selectedRotation = null;
    this.previewCell = null;
    this.placementActive = false;
    this.lockedCargoId = null;
  }

  async returnToFloor(cargoId) {
    const mission = getActiveMission();
    const cargo = mission?.cargo?.[cargoId];
    if (!cargo || mission.status === "extracted" || (mission.locked && !game.user.isGM) || isLockedByOther(cargo)) return;
    const returned = await requestCargoMutation("returnCargoToFloor", { cargoId }, { undo: game.user.isGM });
    if (!returned) return;
    this.selectedCargoId = null;
    this.selectedRotation = null;
    this.previewCell = null;
    this.placementActive = false;
    if (this.lockedCargoId === cargoId) this.lockedCargoId = null;
  }

  async openLinkedItem(cargoId) {
    const cargo = getActiveMission()?.cargo?.[cargoId];
    if (!cargo?.linkedItem?.uuid) return;
    const item = await resolveUuid(cargo.linkedItem.uuid);
    item?.sheet?.render?.(true);
  }

  getActiveContainer(mission) {
    const view = this.viewState;
    const containers = Object.values(mission.containers ?? {});
    return mission.containers?.[view.activeContainerId] ?? containers[0] ?? null;
  }

  getCellSize(container) {
    const preferred = Number(game.settings.get(MODULE_ID, SETTINGS.cellSize) ?? 44);
    const mission = this.renderMission ?? getActiveMission();
    const hasCargoTools = (game.user.isGM && mission?.status !== "extracted") || Boolean(this.selectedCargoId);
    const availableWidth = Math.max(320, (this.element?.clientWidth ?? 1180) - (hasCargoTools ? 550 : 250));
    return Math.max(28, Math.min(preferred, Math.floor(availableWidth / Math.max(1, container.width))));
  }

  getPlacementContext(mission, container, ignoreCargoId) {
    const key = `${container.id}:${ignoreCargoId ?? ""}`;
    const cached = this.placementContexts.get(key);
    if (cached) return cached;

    const occupied = new Set();
    for (const cargo of Object.values(mission.cargo ?? {})) {
      if (cargo.id === ignoreCargoId) continue;
      if (cargo.location?.type !== "container" || cargo.location.containerId !== container.id) continue;
      const position = cargo.location.position;
      if (!position) continue;
      for (const cell of getShapeMetrics(cargo.shape, cargo.rotation ?? 0).cells) {
        occupied.add(`${position.x + cell.x},${position.y + cell.y}`);
      }
    }

    const context = {
      occupied,
      broken: getBrokenCellSet(container)
    };
    this.placementContexts.set(key, context);
    return context;
  }

  flashInvalidPlacement(x, y) {
    this.previewCell = { x, y };
    this.updatePreview();
    const cells = this.element?.querySelectorAll(".glucargo-preview-cell.is-invalid");
    if (!cells?.length) return;
    window.clearTimeout(this.invalidPlacementTimer);
    cells.forEach(cell => {
      cell.classList.remove("is-rejected");
      void cell.offsetWidth;
      cell.classList.add("is-rejected");
    });
    this.invalidPlacementTimer = window.setTimeout(() => {
      this.element?.querySelectorAll(".glucargo-preview-cell.is-rejected").forEach(cell => cell.classList.remove("is-rejected"));
    }, 520);
  }

  getGridCellFromEvent(event, mission = getActiveMission()) {
    const grid = event.target?.closest?.(".glucargo-grid") ?? this.element?.querySelector(".glucargo-grid");
    const container = mission ? this.getActiveContainer(mission) : null;
    if (!grid || !container) return null;
    const rect = grid.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor((event.clientX - rect.left) / (rect.width / container.width));
    const y = Math.floor((event.clientY - rect.top) / (rect.height / container.height));
    if (x < 0 || y < 0 || x >= container.width || y >= container.height) return null;
    return { x, y };
  }

  getManifestCargo(mission) {
    const query = this.search.trim().toLowerCase();
    let cargo = Object.values(mission.cargo ?? {}).filter(item => item.location?.type !== "container");
    cargo = cargo.filter(item => {
      if (isHiddenFromPlayer(item)) return false;
      if (!game.user.isGM && item.visibility === VISIBILITY.unknown) return true;
      const visible = getPlayerFacingCargo(item);
      if (query && !`${visible.name} ${visible.subtitle}`.toLowerCase().includes(query)) return false;
      if (this.filters.category !== "all" && item.category !== this.filters.category) return false;
      if (this.filters.visibility !== "all" && item.visibility !== this.filters.visibility) return false;
      return true;
    });
    cargo.sort((a, b) => {
      if (this.filters.sort === "name") return a.name.localeCompare(b.name);
      if (this.filters.sort === "size") return getShapeMetrics(b.shape).cells.length - getShapeMetrics(a.shape).cells.length;
      if (this.filters.sort === "priority") return priorityRank(b.priority) - priorityRank(a.priority);
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
    return cargo;
  }

  persistViewState() {
    if (!this.element) return;
    this.setViewState({
      left: this.element.offsetLeft,
      top: this.element.offsetTop,
      width: this.element.offsetWidth,
      height: this.element.offsetHeight
    });
  }
}

function snapshotItem(item) {
  const system = item.system ?? {};
  return {
    uuid: item.uuid,
    name: item.name,
    img: item.img,
    type: item.type,
    level: system.level?.value ?? system.level ?? null,
    rarity: system.rarity ?? system.traits?.rarity ?? null,
    traits: Array.isArray(system.traits?.value) ? system.traits.value : [],
    description: String(system.description?.value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220)
  };
}

function notifyInfo(message) {
  globalThis.ui?.notifications?.info?.(message);
}

function notifyWarn(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

function getDialogV2() {
  return globalThis.foundry?.applications?.api?.DialogV2 ?? null;
}

async function confirmDialog({ title, content }) {
  const DialogV2 = getDialogV2();
  if (!DialogV2) {
    notifyWarn("Foundry Dialog is not available.");
    return false;
  }
  const result = await DialogV2.confirm({
    window: { title },
    content,
    modal: true,
    rejectClose: false
  });
  return result === true;
}

async function promptTextDialog({ title, label, value = "" }) {
  const DialogV2 = getDialogV2();
  if (!DialogV2) {
    notifyWarn("Foundry Dialog is not available.");
    return null;
  }
  const result = await DialogV2.wait({
    window: { title },
    modal: true,
    rejectClose: false,
    content: `
      <div class="glucargo-dialog-form">
        <label>${escapeHtml(label)}<input name="value" type="text" value="${escapeAttr(value)}" autofocus></label>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: "Save",
        icon: "fa-solid fa-check",
        default: true,
        callback: (_event, button) => String(button.form?.elements?.value?.value ?? "").trim()
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ]
  });
  return typeof result === "string" ? result : null;
}

async function containerDialog({ title, container = null }) {
  const DialogV2 = getDialogV2();
  if (!DialogV2) {
    notifyWarn("Foundry Dialog is not available.");
    return null;
  }
  const width = Number(container?.width ?? 10);
  const height = Number(container?.height ?? 6);
  const result = await DialogV2.wait({
    window: { title },
    modal: true,
    rejectClose: false,
    content: `
      <div class="glucargo-dialog-form">
        <label>Name<input name="name" type="text" value="${escapeAttr(container?.name ?? "Extraction Case")}" required></label>
        <div class="glucargo-dialog-grid">
          <label>Width<input name="width" type="number" min="1" max="30" value="${width}"></label>
          <label>Height<input name="height" type="number" min="1" max="20" value="${height}"></label>
        </div>
        <label class="glucargo-dialog-check"><input name="locked" type="checkbox" ${container?.locked ? "checked" : ""}> Locked</label>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: "Save",
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (_event, button) => {
          const elements = button.form?.elements ?? {};
          return {
            name: String(elements.name?.value || "Extraction Case").trim(),
            width: Math.max(1, Math.min(30, Number(elements.width?.value || 10))),
            height: Math.max(1, Math.min(20, Number(elements.height?.value || 6))),
            locked: elements.locked?.checked === true
          };
        }
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ]
  });
  return result && typeof result === "object" ? result : null;
}

function cargoImage(cargo) {
  const img = cargo?.linkedItem?.img;
  if (!img || img === "icons/svg/item-bag.svg") return "";
  return img;
}

function renderCargoIcon(cat, image) {
  if (image) return `<img src="${escapeAttr(image)}" alt="">`;
  return `<i class="${escapeAttr(cat.icon)}"></i>`;
}

function cssUrl(value) {
  return `url('${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "%22").replace(/'/g, "\\'")}')`;
}

function shapeMaskDataUri(cells, width, height) {
  const rects = cells.map(cell => `<rect x="${cell.x}" y="${cell.y}" width="1" height="1" fill="white"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${rects}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function getIconAnchorCell(cells, width, height) {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  return cells.reduce((best, cell) => {
    const score = ((cell.x - cx) ** 2) + ((cell.y - cy) ** 2);
    const bestScore = ((best.x - cx) ** 2) + ((best.y - cy) ** 2);
    if (score !== bestScore) return score < bestScore ? cell : best;
    if (cell.y !== best.y) return cell.y < best.y ? cell : best;
    return cell.x < best.x ? cell : best;
  }, cells[0]);
}

function getLabelSegment(cells, width, height) {
  if (cells.length === width * height) return { x: 0, y: 0, width, height };

  const set = new Set(cells.map(cell => `${cell.x},${cell.y}`));
  const centerY = (height - 1) / 2;
  const centerX = (width - 1) / 2;
  let best = null;
  const isBetter = rect => {
    if (!best) return true;
    const rectArea = rect.width * rect.height;
    const bestArea = best.width * best.height;
    if (rectArea !== bestArea) return rectArea > bestArea;
    if (rect.width !== best.width) return rect.width > best.width;
    const rectCenterX = rect.x + ((rect.width - 1) / 2);
    const rectCenterY = rect.y + ((rect.height - 1) / 2);
    const bestCenterX = best.x + ((best.width - 1) / 2);
    const bestCenterY = best.y + ((best.height - 1) / 2);
    const rectDistance = Math.abs(rectCenterY - centerY) + Math.abs(rectCenterX - centerX);
    const bestDistance = Math.abs(bestCenterY - centerY) + Math.abs(bestCenterX - centerX);
    if (rectDistance !== bestDistance) return rectDistance < bestDistance;
    return rect.y > best.y;
  };

  for (let y = 0; y < height; y += 1) {
    const filledColumns = Array.from({ length: width }, () => true);
    for (let bottom = y; bottom < height; bottom += 1) {
      for (let x = 0; x < width; x += 1) {
        filledColumns[x] = filledColumns[x] && set.has(`${x},${bottom}`);
      }

      let runStart = null;
      for (let x = 0; x <= width; x += 1) {
        if (x < width && filledColumns[x]) {
          if (runStart === null) runStart = x;
          continue;
        }
        if (runStart !== null) {
          const rect = { x: runStart, y, width: x - runStart, height: bottom - y + 1 };
          if (isBetter(rect)) best = rect;
          runStart = null;
        }
      }
    }
  }

  return best ?? { x: 0, y: 0, width: 1, height: 1 };
}

function summarizeItem(item) {
  const pieces = [];
  if (item.type) pieces.push(capitalize(item.type));
  if (item.level !== null && item.level !== undefined && item.level !== "") pieces.push(`Level ${item.level}`);
  if (item.rarity) pieces.push(capitalize(String(item.rarity)));
  return pieces.join(" / ");
}

function isHiddenFromPlayer(cargo) {
  return Boolean(cargo?.hidden) && !game.user.isGM;
}

function getPlayerFacingCargo(cargo) {
  if (game.user.isGM || cargo.visibility !== VISIBILITY.unknown) return cargo;
  return {
    ...cargo,
    name: "Unknown Cargo",
    subtitle: "Unidentified mission cargo",
    shape: cargo.shape
  };
}

function getCategory(cargo) {
  const base = CATEGORIES[cargo.category] ?? CATEGORIES.custom;
  return {
    ...base,
    color: resolveCargoColor(cargo.styleOverride?.color, base.color),
    label: cargo.customCategory?.label || base.label,
    icon: cargo.customCategory?.icon || base.icon,
    pattern: cargo.customCategory?.pattern || base.pattern
  };
}

function resolveCargoColor(value, fallback) {
  const color = String(value || "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) return fallback;
  return relativeHexLuminance(color) < 0.12 ? fallback : color;
}

function relativeHexLuminance(color) {
  const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function getContainerStats(mission, container) {
  const pieces = Object.values(mission.cargo ?? {}).filter(cargo => cargo.location?.type === "container" && cargo.location.containerId === container.id);
  const used = pieces.reduce((sum, cargo) => sum + getShapeMetrics(cargo.shape).cells.length, 0);
  const broken = getBrokenCellKeys(container).length;
  return {
    used,
    total: Math.max(0, (container.width * container.height) - broken),
    broken,
    pieces: pieces.length
  };
}

function getMinimapCellSize(container) {
  const width = Math.max(1, Number(container?.width) || 1);
  const height = Math.max(1, Number(container?.height) || 1);
  return Math.max(5, Math.min(16, Math.floor(220 / width), Math.floor(160 / height)));
}

function canPlaceCargo(mission, container, cargoId, shape, position, context = null) {
  if (!container || !position) return false;
  let occupied = context?.occupied;
  let broken = context?.broken;
  if (!occupied || !broken) {
    occupied = new Set();
    broken = getBrokenCellSet(container);
    for (const cargo of Object.values(mission.cargo ?? {})) {
      if (cargo.id === cargoId) continue;
      if (cargo.location?.type !== "container" || cargo.location.containerId !== container.id) continue;
      const cargoPosition = cargo.location.position;
      if (!cargoPosition) continue;
      for (const cell of getShapeMetrics(cargo.shape, cargo.rotation ?? 0).cells) {
        occupied.add(`${cargoPosition.x + cell.x},${cargoPosition.y + cell.y}`);
      }
    }
  }
  for (const cell of getShapeMetrics(shape).cells) {
    const x = position.x + cell.x;
    const y = position.y + cell.y;
    if (x < 0 || y < 0 || x >= container.width || y >= container.height) return false;
    if (broken.has(cellKey(x, y))) return false;
    if (occupied.has(`${x},${y}`)) return false;
  }
  return true;
}

function returnInvalidCargoToFloor(mission, container) {
  for (const cargo of Object.values(mission.cargo ?? {})) {
    if (cargo.location?.type !== "container" || cargo.location.containerId !== container.id) continue;
    const shape = getShapeMetrics(cargo.shape, cargo.rotation ?? 0).rows;
    if (canPlaceCargo(mission, container, cargo.id, shape, cargo.location.position)) continue;
    cargo.location = { type: "floor" };
    cargo.lock = null;
    cargo.updatedAt = Date.now();
  }
}

function getBrokenCellSet(container) {
  return new Set(getBrokenCellKeys(container));
}

function getBrokenCellKeys(container) {
  const width = Math.max(0, Number(container?.width ?? 0));
  const height = Math.max(0, Number(container?.height ?? 0));
  const cells = new Set();
  for (const raw of container?.brokenCells ?? []) {
    const [rawX, rawY] = typeof raw === "string" ? raw.split(",") : [raw?.x, raw?.y];
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    cells.add(cellKey(x, y));
  }
  return Array.from(cells).sort(compareCellKeys);
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function compareCellKeys(a, b) {
  const [ax, ay] = a.split(",").map(Number);
  const [bx, by] = b.split(",").map(Number);
  return ay === by ? ax - bx : ay - by;
}

function getShapeMetrics(shape, rotation = 0) {
  const key = `${normalizeShapeKey(shape)}|${normalizeRotation(rotation)}`;
  const cached = shapeMetricsCache.get(key);
  if (cached) return cached;

  const rows = rotateShape(shape, rotation);
  const cells = shapeCells(rows);
  const width = Math.max(1, Math.max(...cells.map(cell => cell.x)) + 1);
  const height = Math.max(1, Math.max(...cells.map(cell => cell.y)) + 1);
  const cellSet = new Set(cells.map(cell => `${cell.x},${cell.y}`));
  const metrics = {
    rows,
    cells,
    width,
    height,
    cellSet,
    maskUrl: cssUrl(shapeMaskDataUri(cells, width, height)),
    iconCell: getIconAnchorCell(cells, width, height),
    labelSegment: getLabelSegment(cells, width, height)
  };
  shapeMetricsCache.set(key, metrics);
  if (shapeMetricsCache.size > SHAPE_METRICS_CACHE_LIMIT) {
    shapeMetricsCache.delete(shapeMetricsCache.keys().next().value);
  }
  return metrics;
}

function normalizeShapeKey(shape) {
  return trimShape(Array.isArray(shape) ? shape : DEFAULT_SHAPE).join("\n");
}

function shapeCells(shape) {
  const cells = [];
  for (let y = 0; y < shape.length; y += 1) {
    const row = String(shape[y] ?? "");
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] && row[x] !== "." && row[x] !== "o" && row[x] !== "O" && row[x] !== "0") cells.push({ x, y });
    }
  }
  return cells;
}

function trimShape(shape) {
  const cells = shapeCells(shape);
  if (!cells.length) return ["X"];
  const minX = Math.min(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y));
  const maxX = Math.max(...cells.map(c => c.x));
  const maxY = Math.max(...cells.map(c => c.y));
  const set = new Set(cells.map(c => `${c.x},${c.y}`));
  const rows = [];
  for (let y = minY; y <= maxY; y += 1) {
    let row = "";
    for (let x = minX; x <= maxX; x += 1) row += set.has(`${x},${y}`) ? "X" : ".";
    rows.push(row);
  }
  return rows;
}

function rotateShape(shape, turns = 0) {
  let rows = trimShape(shape);
  const count = normalizeRotation(turns);
  for (let i = 0; i < count; i += 1) {
    const height = rows.length;
    const width = Math.max(...rows.map(row => row.length));
    const next = [];
    for (let x = 0; x < width; x += 1) {
      let row = "";
      for (let y = height - 1; y >= 0; y -= 1) row += rows[y]?.[x] && rows[y][x] !== "." ? "X" : ".";
      next.push(row);
    }
    rows = trimShape(next);
  }
  return rows;
}

function normalizeRotation(turns = 0) {
  return ((Number(turns) % 4) + 4) % 4;
}

function generateRandomContiguousShape(cellCount, maxSize) {
  const size = Math.max(1, Math.floor(Number(maxSize) || 1));
  const target = Math.max(1, Math.min(size * size, Math.floor(Number(cellCount) || 1)));
  const start = {
    x: Math.floor(Math.random() * size),
    y: Math.floor(Math.random() * size)
  };
  const occupied = new Set([`${start.x},${start.y}`]);
  const frontier = new Set();
  const addFrontier = (x, y) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size && !occupied.has(key)) frontier.add(key);
    }
  };
  addFrontier(start.x, start.y);

  while (occupied.size < target && frontier.size) {
    const options = Array.from(frontier);
    const key = options[Math.floor(Math.random() * options.length)];
    frontier.delete(key);
    occupied.add(key);
    const [x, y] = key.split(",").map(Number);
    addFrontier(x, y);
  }

  const rows = [];
  for (let y = 0; y < size; y += 1) {
    let row = "";
    for (let x = 0; x < size; x += 1) row += occupied.has(`${x},${y}`) ? "X" : ".";
    rows.push(row);
  }
  return trimShape(rows);
}

function isContiguous(shape) {
  const cells = shapeCells(shape);
  if (cells.length <= 1) return true;
  const set = new Set(cells.map(cell => `${cell.x},${cell.y}`));
  const seen = new Set();
  const stack = [cells[0]];
  while (stack.length) {
    const cell = stack.pop();
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = `${cell.x + dx},${cell.y + dy}`;
      if (set.has(next) && !seen.has(next)) stack.push({ x: cell.x + dx, y: cell.y + dy });
    }
  }
  return seen.size === cells.length;
}

function isLockedByOther(cargo) {
  return isLockedByOtherForUser(cargo, game.user.id);
}

function isLockedByOtherForUser(cargo, userId) {
  return Boolean(cargo.lock?.userId && cargo.lock.userId !== userId && cargo.lock.expiresAt > Date.now());
}

function lockOwner(cargo) {
  if (!cargo.lock?.userId || cargo.lock.expiresAt <= Date.now()) return "";
  return cargo.lock.userId === game.user.id ? "You" : cargo.lock.userName;
}

function priorityRank(priority) {
  if (priority === "critical") return 3;
  if (priority === "high") return 2;
  return 1;
}

function buildExtractionReport(mission) {
  const cargo = Object.values(mission.cargo ?? {});
  const extracted = cargo.filter(item => item.location?.type === "container");
  const abandoned = cargo.filter(item => item.location?.type !== "container" && !item.hidden);
  const byCategory = extracted.reduce((map, item) => {
    const label = getCategory(item).label;
    map[label] = (map[label] ?? 0) + 1;
    return map;
  }, {});
  const rows = extracted.map(item => {
    const visible = getPlayerFacingCargo(item);
    const cat = getCategory(item);
    const image = cargoImage(item);
    return `
      <li class="glucargo-chat-report__cargo priority-${escapeAttr(item.priority ?? "normal")}" style="--cargo-accent:${escapeAttr(cat.color)};">
        <span class="glucargo-chat-report__cargo-icon">${renderCargoIcon(cat, image)}</span>
        <span class="glucargo-chat-report__cargo-copy">
          <strong>${escapeHtml(visible.name)}</strong>
          <small>${escapeHtml(visible.subtitle || cat.label)}</small>
        </span>
        <span class="glucargo-chat-report__cargo-meta">${getShapeMetrics(item.shape).cells.length}c</span>
      </li>
    `;
  }).join("");
  const summary = Object.entries(byCategory).map(([label, count]) => `<span>${escapeHtml(label)} <strong>${count}</strong></span>`).join("");
  const abandonedRows = abandoned.slice(0, 6).map(item => `<span>${escapeHtml(getPlayerFacingCargo(item).name)}</span>`).join("");
  const totalCells = extracted.reduce((sum, item) => sum + getShapeMetrics(item.shape).cells.length, 0);
  const serial = String(mission.id ?? "").replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase().padStart(4, "0");
  return `
    <div class="glucargo-chat-report">
      <header class="glucargo-chat-report__head">
        <span><i class="fa-solid fa-flag-checkered"></i></span>
        <div>
          <span class="glucargo-kicker">Extraction Manifest</span>
          <h2>${escapeHtml(mission.name)}</h2>
        </div>
        <span class="glucargo-regmark" aria-hidden="true">
          <em>GLU·CARGO // ${serial}</em>
          <span class="glucargo-cmyk"><i></i><i></i><i></i><i></i></span>
        </span>
      </header>
      <section class="glucargo-chat-report__stats">
        <span><strong>${extracted.length}</strong><small>Secured</small></span>
        <span><strong>${totalCells}</strong><small>Cells</small></span>
        <span><strong>${abandoned.length}</strong><small>Left Site</small></span>
      </section>
      <section class="glucargo-chat-report__chips">${summary || "<span>No secured cargo <strong>0</strong></span>"}</section>
      <ol class="glucargo-chat-report__list">${rows || `<li class="glucargo-chat-report__empty">No cargo extracted.</li>`}</ol>
      ${abandoned.length ? `<footer class="glucargo-chat-report__lost"><strong>Unsecured</strong>${abandonedRows}${abandoned.length > 6 ? `<span>+${abandoned.length - 6} more</span>` : ""}</footer>` : ""}
    </div>
  `;
}

function debounce(fn, delay) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
  debounced.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

function capitalize(value) {
  return String(value ?? "").replace(/^\w/, char => char.toUpperCase());
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
