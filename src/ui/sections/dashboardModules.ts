// src/ui/sections/dashboardModules.ts — Dashboard feature modules

import { type UIState } from "../core/panelState";
import { createToggle } from "../components";
import { log } from "../../utils/logger";
import { storage } from "../../utils/storage";
import { t } from "../../i18n";
import { watchDetach } from "../../utils/dom/dom";
import { calculateMaxStrength } from "../../store/xpTracker";
import { onActivePetInfos, type ActivePetInfo } from "../../store/pets";
import {
  onTurtleTimerState,
  setTurtleTimerEnabled,
  type TurtleTimerChannel,
  type GardenSlotEstimate,
} from "../../features/pets/turtleTimer";
import { visibleInterval } from "../../utils/scheduling/timerManager";
import {
  fetchRestockData,
  getRestockDataSync,
  type RestockItem,
} from "../../utils/restock/dataService";

// ---------------------------------------------------------------------------
// Dashboard modules
// ---------------------------------------------------------------------------

const DASHBOARD_MODULES_KEY = "qpm.dashboardModules";

type ModuleId = "xp-near-max" | "turtle-timer" | "active-pets" | "next-restock";

interface DashboardModule {
  id: ModuleId;
  label: string;
  icon: string;
}

const ALL_MODULES: DashboardModule[] = [
  { id: "xp-near-max", label: "feature.dashboard.moduleXpNearMax", icon: "✨" },
  { id: "turtle-timer", label: "feature.dashboard.moduleTurtleTimer", icon: "🐢" },
  { id: "active-pets", label: "feature.dashboard.moduleActivePets", icon: "🐾" },
  { id: "next-restock", label: "feature.dashboard.moduleNextRestock", icon: "🏪" },
];

function loadEnabledModules(): Set<ModuleId> {
  const saved = storage.get<ModuleId[] | null>(DASHBOARD_MODULES_KEY, null);
  return new Set(saved ?? []);
}

function saveEnabledModules(ids: Set<ModuleId>): void {
  storage.set(DASHBOARD_MODULES_KEY, [...ids]);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function formatCountdown(ms: number): string {
  if (ms <= 0) return t("feature.dashboard.soon");
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─── Compact helpers ────────────────────────────────────────────────────────────

function makeChannelRow(
  icon: string,
  label: string,
): { el: HTMLElement; val: HTMLElement } {
  const row = document.createElement("div");
  row.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:4px;";
  const labelEl = document.createElement("span");
  labelEl.style.cssText =
    "font-size:12px;color:rgba(224,224,224,0.4);white-space:nowrap;";
  labelEl.textContent = `${icon} ${label}`;
  const val = document.createElement("span");
  val.style.cssText = "font-size:12px;font-weight:600;color:#e0e0e0;";
  val.textContent = "—";
  row.append(labelEl, val);
  return { el: row, val };
}

function makeBar(pct: number, color: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "flex:1;height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;min-width:30px;";
  const fill = document.createElement("div");
  fill.style.cssText = `height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${color};border-radius:3px;transition:width 0.4s;`;
  wrap.appendChild(fill);
  return wrap;
}

function hungerColor(pct: number): string {
  if (pct >= 75) return "var(--qpm-hunger-full)";
  if (pct >= 40) return "var(--qpm-hunger-mid)";
  return "var(--qpm-hunger-low)";
}

// ─── Module card dispatcher ─────────────────────────────────────────────────────────────────────

function buildModuleCard(
  mod: DashboardModule,
  _uiState: UIState,
  onCleanup: (fn: () => void) => void,
): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = [
    "padding:8px 10px",
    "background:rgba(255,255,255,0.04)",
    "border:1px solid var(--qpm-accent-subtle)",
    "border-radius:6px",
    "display:flex",
    "flex-direction:column",
    "gap:5px",
    "overflow:hidden",
  ].join(";");

  const cleanups: Array<() => void> = [];
  const reg = (fn: () => void): void => {
    cleanups.push(fn);
  };

  const titleRow = document.createElement("div");
  titleRow.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:4px;min-height:18px;";
  const titleEl = document.createElement("div");
  titleEl.style.cssText =
    "font-size:10px;font-weight:600;color:rgba(224,224,224,0.5);text-transform:uppercase;letter-spacing:0.3px;white-space:nowrap;";
  titleEl.textContent = `${mod.icon} ${t(mod.label)}`;
  titleRow.appendChild(titleEl);
  card.appendChild(titleRow);

  if (mod.id === "turtle-timer") buildTurtleTimerModule(card, titleRow, reg);
  else if (mod.id === "active-pets") buildActivePetsModule(card, titleRow, reg);
  else if (mod.id === "xp-near-max") buildXpNearMaxModule(card, reg);
  else if (mod.id === "next-restock") buildNextRestockModule(card, reg);

  onCleanup(() => cleanups.forEach((fn) => fn()));
  return card;
}

// ---------------------------------------------------------------------------
// Modules section (exported)
// ---------------------------------------------------------------------------

export function buildModulesSection(uiState: UIState): HTMLElement {
  const section = document.createElement("div");
  section.style.cssText = "margin-top:14px;";

  const headerRow = document.createElement("div");
  headerRow.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";

  const sectionTitle = document.createElement("div");
  sectionTitle.style.cssText =
    "font-size:12px;font-weight:600;color:rgba(224,224,224,0.6);text-transform:uppercase;letter-spacing:0.5px;";
  sectionTitle.textContent = `⚡ ${t("feature.dashboard.sectionTitle")}`;

  const customizeBtn = document.createElement("button");
  customizeBtn.type = "button";
  customizeBtn.textContent = `⚙ ${t("feature.dashboard.customize")}`;
  customizeBtn.style.cssText = [
    "font-size:10px",
    "padding:2px 8px",
    "background:var(--qpm-accent-tint)",
    "border:1px solid var(--qpm-accent-border)",
    "border-radius:4px",
    "color:#c8c0ff",
    "cursor:pointer",
  ].join(";");

  headerRow.append(sectionTitle, customizeBtn);
  section.appendChild(headerRow);

  const togglePanel = document.createElement("div");
  togglePanel.style.cssText = [
    "background:rgba(0,0,0,0.25)",
    "border:1px solid var(--qpm-accent-subtle)",
    "border-radius:6px",
    "padding:8px 10px",
    "margin-bottom:8px",
    "flex-wrap:wrap",
    "gap:8px",
  ].join(";");
  togglePanel.style.display = "none";
  section.appendChild(togglePanel);

  let enabledModules = loadEnabledModules();

  const moduleCards = document.createElement("div");
  moduleCards.style.cssText =
    "display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;";
  section.appendChild(moduleCards);

  const renderTogglePanel = (): void => {
    togglePanel.innerHTML = "";
    for (const mod of ALL_MODULES) {
      const { root: toggle } = createToggle({
        size: "compact",
        checked: enabledModules.has(mod.id),
        label: `${mod.icon} ${t(mod.label)}`,
        onChange: (checked) => {
          if (checked) enabledModules.add(mod.id);
          else enabledModules.delete(mod.id);
          saveEnabledModules(enabledModules);
          renderModuleCards();
        },
      });
      togglePanel.appendChild(toggle);
    }
  };

  let moduleCleanups: Array<() => void> = [];

  const renderModuleCards = (): void => {
    moduleCleanups.forEach((fn) => fn());
    moduleCleanups = [];
    moduleCards.innerHTML = "";
    if (enabledModules.size === 0) {
      const hint = document.createElement("div");
      hint.style.cssText =
        "font-size:12px;color:rgba(224,224,224,0.3);font-style:italic;";
      hint.textContent = t("feature.dashboard.noModulesHint");
      moduleCards.appendChild(hint);
      return;
    }
    for (const modDef of ALL_MODULES) {
      if (!enabledModules.has(modDef.id)) continue;
      moduleCards.appendChild(
        buildModuleCard(modDef, uiState, (cleanup) => {
          moduleCleanups.push(cleanup);
        }),
      );
    }
  };

  watchDetach(section, () => {
    moduleCleanups.forEach((fn) => fn());
    moduleCleanups = [];
  });

  customizeBtn.addEventListener("click", () => {
    const showing = togglePanel.style.display !== "none";
    togglePanel.style.display = showing ? "none" : "flex";
    if (!showing) renderTogglePanel();
  });

  renderModuleCards();
  return section;
}

// ─── Turtle Timer module ────────────────────────────────────────────────────────────

function buildTurtleTimerModule(
  card: HTMLElement,
  titleRow: HTMLElement,
  reg: (fn: () => void) => void,
): void {
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.textContent = "...";
  toggleBtn.style.cssText = [
    "font-size:10px",
    "padding:1px 8px",
    "border-radius:3px",
    "cursor:pointer",
    "border:1px solid rgba(143,130,255,0.3)",
    "background:var(--qpm-accent-tint)",
    "color:rgba(224,224,224,0.4)",
    "flex-shrink:0",
  ].join(";");
  titleRow.appendChild(toggleBtn);

  const plantRow = makeChannelRow("🌱", t("feature.dashboard.channelPlant"));
  const eggRow = makeChannelRow("🥚", t("feature.dashboard.channelEgg"));
  const footerEl = document.createElement("div");
  footerEl.style.cssText = "font-size:10px;color:rgba(224,224,224,0.3);";
  card.append(plantRow.el, eggRow.el, footerEl);

  let currentEnabled = false;
  let plantEndTime: number | null = null;
  let plantRate = 1;
  let eggEndTime: number | null = null;
  let eggRate = 1;

  toggleBtn.addEventListener("click", () =>
    setTurtleTimerEnabled(!currentEnabled),
  );

  const tick = (): void => {
    const now = Date.now();
    if (plantEndTime != null) {
      const adj = Math.max(0, plantEndTime - now) / Math.max(0.01, plantRate);
      plantRow.val.textContent = adj > 0 ? formatCountdown(adj) : t("feature.dashboard.ready");
    } else {
      plantRow.val.textContent = "—";
    }
    if (eggEndTime != null) {
      const adj = Math.max(0, eggEndTime - now) / Math.max(0.01, eggRate);
      eggRow.val.textContent = adj > 0 ? formatCountdown(adj) : t("feature.dashboard.ready");
    } else {
      eggRow.val.textContent = "—";
    }
  };

  reg(
    onTurtleTimerState((snap) => {
      currentEnabled = snap.enabled;
      toggleBtn.textContent = snap.enabled ? t("feature.dashboard.toggleOn") : t("feature.dashboard.toggleOff");
      toggleBtn.style.color = snap.enabled
        ? "var(--qpm-positive)"
        : "rgba(224,224,224,0.4)";
      toggleBtn.style.borderColor = snap.enabled
        ? "rgba(79,209,139,0.4)"
        : "rgba(143,130,255,0.3)";
      if (!snap.enabled) {
        plantEndTime = eggEndTime = null;
        plantRow.val.textContent = eggRow.val.textContent = t("feature.dashboard.channelOff");
        footerEl.textContent = t("common.disabled");
        return;
      }
      const getEnd = (ch: TurtleTimerChannel): number | null =>
        (
          ch.focusSlot as
            | (GardenSlotEstimate & {
                remainingMs: number | null;
                endTime?: number;
              })
            | null
        )?.endTime ?? null;
      plantEndTime = getEnd(snap.plant);
      plantRate = snap.plant.effectiveRate ?? 1;
      eggEndTime = getEnd(snap.egg);
      eggRate = snap.egg.effectiveRate ?? 1;
      footerEl.textContent =
        snap.availableTurtles > 0
          ? t(snap.availableTurtles === 1 ? "feature.dashboard.turtleActive" : "feature.dashboard.turtlesActive", { count: snap.availableTurtles })
          : t("feature.dashboard.noTurtlesAvailable");
      tick();
    }),
  );
  reg(visibleInterval("dashboard-turtle-module", tick, 1000));
}

// ─── Active Pets module ────────────────────────────────────────────────────────────

function buildActivePetsModule(
  card: HTMLElement,
  titleRow: HTMLElement,
  reg: (fn: () => void) => void,
): void {
  const feedAllBtn = document.createElement("button");
  feedAllBtn.type = "button";
  feedAllBtn.textContent = `🍖 ${t("feature.dashboard.feedAll")}`;
  feedAllBtn.style.cssText = [
    "font-size:10px",
    "padding:1px 6px",
    "border-radius:3px",
    "cursor:pointer",
    "border:1px solid rgba(143,130,255,0.3)",
    "background:var(--qpm-accent-tint)",
    "color:#c8c0ff",
    "flex-shrink:0",
  ].join(";");
  titleRow.appendChild(feedAllBtn);

  feedAllBtn.addEventListener("click", async () => {
    feedAllBtn.disabled = true;
    feedAllBtn.textContent = "…";
    try {
      const { feedAllPetsInstantly } =
        await import("../../features/pets/instantFeed");
      await feedAllPetsInstantly(100);
    } catch (err) {
      log("⚠️ Feed all failed", err);
    } finally {
      feedAllBtn.disabled = false;
      feedAllBtn.textContent = `🍖 ${t("feature.dashboard.feedAll")}`;
    }
  });

  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  card.appendChild(listEl);

  interface PetRowRefs {
    row: HTMLElement;
    nameEl: HTMLElement;
    barFill: HTMLElement;
    pctEl: HTMLElement;
    feedBtn: HTMLButtonElement;
    slotIndex: number;
  }
  const petRows: PetRowRefs[] = [];
  let emptyMsg: HTMLElement | null = null;

  const buildRow = (): PetRowRefs => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:5px;";
    const nameEl = document.createElement("span");
    nameEl.style.cssText =
      "font-size:12px;color:rgba(224,224,224,0.75);min-width:52px;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const barWrap = document.createElement("div");
    barWrap.style.cssText =
      "flex:1;height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;min-width:30px;";
    const barFill = document.createElement("div");
    barFill.style.cssText = "height:100%;width:0%;background:transparent;border-radius:3px;transition:width 0.4s;";
    barWrap.appendChild(barFill);
    const pctEl = document.createElement("span");
    pctEl.style.cssText = "font-size:10px;color:rgba(224,224,224,0.5);min-width:28px;text-align:right;";
    const feedBtn = document.createElement("button");
    feedBtn.type = "button";
    feedBtn.textContent = "🍖";
    feedBtn.title = t("feature.dashboard.feedTooltip");
    feedBtn.style.cssText =
      "font-size:12px;padding:0 4px;border-radius:3px;cursor:pointer;border:1px solid rgba(143,130,255,0.2);background:rgba(143,130,255,0.06);flex-shrink:0;line-height:1.5;";
    const refs: PetRowRefs = { row, nameEl, barFill, pctEl, feedBtn, slotIndex: -1 };
    feedBtn.addEventListener("click", async () => {
      if (refs.slotIndex < 0) return;
      const idx = refs.slotIndex;
      feedBtn.disabled = true;
      feedBtn.textContent = "…";
      try {
        const { feedPetInstantly } =
          await import("../../features/pets/instantFeed");
        await feedPetInstantly(idx);
      } catch (err) {
        log("⚠️ Feed failed", err);
      } finally {
        feedBtn.disabled = false;
        feedBtn.textContent = "🍖";
      }
    });
    row.append(nameEl, barWrap, pctEl, feedBtn);
    return refs;
  };

  const render = (pets: ActivePetInfo[]): void => {
    const target = pets.slice(0, 3);
    if (!target.length) {
      for (const r of petRows) r.row.style.display = "none";
      if (!emptyMsg) {
        emptyMsg = document.createElement("div");
        emptyMsg.style.cssText =
          "font-size:12px;color:rgba(224,224,224,0.3);font-style:italic;";
        emptyMsg.textContent = t("feature.dashboard.noActivePets");
        listEl.appendChild(emptyMsg);
      }
      emptyMsg.style.display = "";
      return;
    }
    if (emptyMsg) emptyMsg.style.display = "none";
    while (petRows.length < target.length) {
      const refs = buildRow();
      petRows.push(refs);
      listEl.appendChild(refs.row);
    }
    for (let i = 0; i < petRows.length; i++) {
      const refs = petRows[i]!;
      const pet = target[i];
      if (!pet) {
        refs.row.style.display = "none";
        continue;
      }
      refs.row.style.display = "";
      refs.slotIndex = pet.slotIndex;
      refs.nameEl.textContent =
        pet.name || pet.species || t("feature.dashboard.petFallback", { index: pet.slotIndex + 1 });
      const pct = Math.max(0, Math.min(100, pet.hungerPct ?? 0));
      const clr = hungerColor(pct);
      refs.barFill.style.width = `${pct}%`;
      refs.barFill.style.background = clr;
      refs.pctEl.style.color = clr;
      refs.pctEl.textContent = `${Math.round(pct)}%`;
    }
  };

  reg(onActivePetInfos(render));
}

// ─── XP Near Max module ────────────────────────────────────────────────────────────

function buildXpNearMaxModule(
  card: HTMLElement,
  reg: (fn: () => void) => void,
): void {
  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  card.appendChild(listEl);

  interface XpRowRefs {
    row: HTMLElement;
    nameEl: HTMLElement;
    barFill: HTMLElement;
    pctEl: HTMLElement;
  }
  const xpRows: XpRowRefs[] = [];
  let emptyMsg: HTMLElement | null = null;

  const buildRow = (): XpRowRefs => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:5px;";
    const nameEl = document.createElement("span");
    nameEl.style.cssText =
      "font-size:12px;color:rgba(224,224,224,0.75);min-width:52px;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const barWrap = document.createElement("div");
    barWrap.style.cssText =
      "flex:1;height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;min-width:30px;";
    const barFill = document.createElement("div");
    barFill.style.cssText = "height:100%;width:0%;background:transparent;border-radius:3px;transition:width 0.4s;";
    barWrap.appendChild(barFill);
    const pctEl = document.createElement("span");
    pctEl.style.cssText = "font-size:10px;min-width:30px;text-align:right;white-space:nowrap;color:rgba(255,255,255,0.5);";
    row.append(nameEl, barWrap, pctEl);
    return { row, nameEl, barFill, pctEl };
  };

  const render = (pets: ActivePetInfo[]): void => {
    type PetWithPct = { pet: ActivePetInfo; pct: number; str: number };
    const withPct = pets
      .reduce<PetWithPct[]>((acc, p) => {
        if (p.strength === null) return acc;
        const maxStr =
          p.targetScale !== null && p.species !== null
            ? calculateMaxStrength(p.targetScale, p.species)
            : null;
        const pct =
          maxStr !== null && maxStr > 0
            ? Math.min(100, Math.round((p.strength / maxStr) * 100))
            : null;
        if (pct !== null) acc.push({ pet: p, pct, str: p.strength });
        return acc;
      }, [])
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3);

    if (!withPct.length) {
      for (const r of xpRows) r.row.style.display = "none";
      if (!emptyMsg) {
        emptyMsg = document.createElement("div");
        emptyMsg.style.cssText =
          "font-size:12px;color:rgba(224,224,224,0.3);font-style:italic;";
        emptyMsg.textContent = t("feature.dashboard.noXpData");
        listEl.appendChild(emptyMsg);
      }
      emptyMsg.style.display = "";
      return;
    }
    if (emptyMsg) emptyMsg.style.display = "none";
    while (xpRows.length < withPct.length) {
      const refs = buildRow();
      xpRows.push(refs);
      listEl.appendChild(refs.row);
    }
    for (let i = 0; i < xpRows.length; i++) {
      const refs = xpRows[i]!;
      const entry = withPct[i];
      if (!entry) {
        refs.row.style.display = "none";
        continue;
      }
      refs.row.style.display = "";
      const { pet, pct, str } = entry;
      const clr =
        pct >= 95 ? "var(--qpm-accent)" : pct >= 80 ? "#ff9800" : "rgba(255,255,255,0.5)";
      refs.nameEl.textContent =
        pet.name || pet.species || t("feature.dashboard.petFallback", { index: pet.slotIndex + 1 });
      refs.barFill.style.width = `${pct}%`;
      refs.barFill.style.background = clr;
      refs.pctEl.style.color = clr;
      refs.pctEl.textContent = `${pct}% (${Math.round(str)})`;
    }
  };

  reg(onActivePetInfos(render));
}

// ─── Next Restock module ────────────────────────────────────────────────────────────

function buildNextRestockModule(
  card: HTMLElement,
  reg: (fn: () => void) => void,
): void {
  const SHOP_ICONS: Record<string, string> = {
    seed: "🌱",
    egg: "🥚",
    decor: "🏡",
    weather: "🌤",
  };
  const SHOP_LABELS: Record<string, string> = {
    seed: t("feature.dashboard.shopSeeds"),
    egg: t("feature.dashboard.shopEggs"),
    decor: t("feature.dashboard.shopDecor"),
    weather: t("feature.dashboard.shopWeather"),
  };
  const SHOP_ORDER = ["seed", "egg", "decor", "weather"];

  const listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  card.appendChild(listEl);

  const shopSlots = new Map<string, { tsEl: HTMLElement; ts: number }>();

  const buildRows = (items: RestockItem[]): void => {
    listEl.innerHTML = "";
    shopSlots.clear();
    const now = Date.now();
    const byShop = new Map<string, RestockItem>();
    for (const it of items) {
      if (!it.shop_type || !it.estimated_next_timestamp) continue;
      const ex = byShop.get(it.shop_type);
      if (
        !ex ||
        it.estimated_next_timestamp < (ex.estimated_next_timestamp ?? Infinity)
      ) {
        byShop.set(it.shop_type, it);
      }
    }
    if (!byShop.size) {
      const e = document.createElement("div");
      e.style.cssText =
        "font-size:12px;color:rgba(224,224,224,0.3);font-style:italic;";
      e.textContent = t("feature.dashboard.noData");
      listEl.appendChild(e);
      return;
    }
    for (const shopKey of SHOP_ORDER) {
      const it = byShop.get(shopKey);
      if (!it) continue;
      const ts = it.estimated_next_timestamp ?? 0;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:5px;";
      const iconEl = document.createElement("span");
      iconEl.style.cssText = "font-size:12px;flex-shrink:0;";
      iconEl.textContent = SHOP_ICONS[shopKey] ?? "🏪";
      const nameEl = document.createElement("span");
      nameEl.style.cssText =
        "font-size:10px;color:rgba(224,224,224,0.6);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameEl.textContent = (it.item_id ?? shopKey)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const prob =
        it.current_probability ??
        (it as RestockItem & { appearance_rate?: number }).appearance_rate ??
        0;
      const probEl = document.createElement("span");
      probEl.style.cssText =
        "font-size:10px;color:rgba(224,224,224,0.4);flex-shrink:0;";
      probEl.textContent = `${Math.round(prob * 100)}%`;
      const tsEl = document.createElement("span");
      tsEl.style.cssText =
        "font-size:10px;color:var(--qpm-accent);min-width:44px;text-align:right;flex-shrink:0;";
      tsEl.textContent = ts > now ? formatCountdown(ts - now) : t("feature.dashboard.soon");
      shopSlots.set(shopKey, { tsEl, ts });
      row.append(iconEl, nameEl, probEl, tsEl);
      listEl.appendChild(row);
    }
  };

  buildRows(getRestockDataSync() ?? []);
  void fetchRestockData()
    .then((items) => {
      if (items) buildRows(items);
    })
    .catch(() => {
      /* no-op */
    });

  reg(
    visibleInterval(
      "dashboard-restock-module",
      () => {
        const now = Date.now();
        for (const { tsEl, ts } of shopSlots.values()) {
          tsEl.textContent = ts > now ? formatCountdown(ts - now) : t("feature.dashboard.soon");
        }
      },
      1000,
    ),
  );
}
