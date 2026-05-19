// src/ui/sections/dashboardModules.ts — Dashboard feature modules

import { type UIState } from "../panelState";
import { log } from "../../utils/logger";
import { storage } from "../../utils/storage";
import { t } from "../../i18n";
import { calculateMaxStrength } from "../../store/xpTracker";
import { onActivePetInfos, type ActivePetInfo } from "../../store/pets";
import {
  onTurtleTimerState,
  setTurtleTimerEnabled,
  type TurtleTimerChannel,
  type GardenSlotEstimate,
} from "../../features/turtleTimer.ts";
import { visibleInterval } from "../../utils/timerManager";
import {
  fetchRestockData,
  getRestockDataSync,
  type RestockItem,
} from "../../utils/restockDataService";

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
    "font-size:11px;color:rgba(224,224,224,0.4);white-space:nowrap;";
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
  if (pct >= 75) return "#4caf50";
  if (pct >= 40) return "#ff9800";
  return "#f44336";
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
    "border:1px solid rgba(143,130,255,0.12)",
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
    "font-size:11px;font-weight:600;color:rgba(224,224,224,0.6);text-transform:uppercase;letter-spacing:0.5px;";
  sectionTitle.textContent = `⚡ ${t("feature.dashboard.sectionTitle")}`;

  const customizeBtn = document.createElement("button");
  customizeBtn.type = "button";
  customizeBtn.textContent = `⚙ ${t("feature.dashboard.customize")}`;
  customizeBtn.style.cssText = [
    "font-size:10px",
    "padding:2px 8px",
    "background:rgba(143,130,255,0.1)",
    "border:1px solid rgba(143,130,255,0.25)",
    "border-radius:4px",
    "color:#c8c0ff",
    "cursor:pointer",
  ].join(";");

  headerRow.append(sectionTitle, customizeBtn);
  section.appendChild(headerRow);

  const togglePanel = document.createElement("div");
  togglePanel.style.cssText = [
    "background:rgba(0,0,0,0.25)",
    "border:1px solid rgba(143,130,255,0.15)",
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
      const chip = document.createElement("label");
      chip.style.cssText =
        "display:flex;align-items:center;gap:5px;font-size:11px;color:rgba(224,224,224,0.7);cursor:pointer;";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = enabledModules.has(mod.id);
      cb.style.accentColor = "#8f82ff";
      cb.addEventListener("change", () => {
        if (cb.checked) enabledModules.add(mod.id);
        else enabledModules.delete(mod.id);
        saveEnabledModules(enabledModules);
        renderModuleCards();
      });
      chip.append(cb, document.createTextNode(`${mod.icon} ${t(mod.label)}`));
      togglePanel.appendChild(chip);
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
        "font-size:11px;color:rgba(224,224,224,0.3);font-style:italic;";
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

  const obs = new MutationObserver(() => {
    if (!section.isConnected) {
      obs.disconnect();
      moduleCleanups.forEach((fn) => fn());
      moduleCleanups = [];
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

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
    "background:rgba(143,130,255,0.08)",
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
        ? "#4caf50"
        : "rgba(224,224,224,0.4)";
      toggleBtn.style.borderColor = snap.enabled
        ? "rgba(76,175,80,0.4)"
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
    "background:rgba(143,130,255,0.08)",
    "color:#c8c0ff",
    "flex-shrink:0",
  ].join(";");
  titleRow.appendChild(feedAllBtn);

  feedAllBtn.addEventListener("click", async () => {
    feedAllBtn.disabled = true;
    feedAllBtn.textContent = "⏳";
    try {
      const { feedAllPetsInstantly } =
        await import("../../features/instantFeed");
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

  const render = (pets: ActivePetInfo[]): void => {
    listEl.innerHTML = "";
    if (!pets.length) {
      const e = document.createElement("div");
      e.style.cssText =
        "font-size:11px;color:rgba(224,224,224,0.3);font-style:italic;";
      e.textContent = t("feature.dashboard.noActivePets");
      listEl.appendChild(e);
      return;
    }
    for (const pet of pets.slice(0, 3)) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:5px;";
      const nameEl = document.createElement("span");
      nameEl.style.cssText =
        "font-size:11px;color:rgba(224,224,224,0.75);min-width:52px;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameEl.textContent =
        pet.name || pet.species || t("feature.dashboard.petFallback", { index: pet.slotIndex + 1 });
      const pct = pet.hungerPct ?? 0;
      const bar = makeBar(pct, hungerColor(pct));
      const pctEl = document.createElement("span");
      pctEl.style.cssText = `font-size:10px;color:${hungerColor(pct)};min-width:28px;text-align:right;`;
      pctEl.textContent = `${Math.round(pct)}%`;
      const feedBtn = document.createElement("button");
      feedBtn.type = "button";
      feedBtn.textContent = "🍖";
      feedBtn.title = t("feature.dashboard.feedTooltip");
      feedBtn.style.cssText =
        "font-size:11px;padding:0 4px;border-radius:3px;cursor:pointer;border:1px solid rgba(143,130,255,0.2);background:rgba(143,130,255,0.06);flex-shrink:0;line-height:1.5;";
      const idx = pet.slotIndex;
      feedBtn.addEventListener("click", async () => {
        feedBtn.disabled = true;
        feedBtn.textContent = "⏳";
        try {
          const { feedPetInstantly } =
            await import("../../features/instantFeed");
          await feedPetInstantly(idx);
        } catch (err) {
          log("⚠️ Feed failed", err);
        } finally {
          feedBtn.disabled = false;
          feedBtn.textContent = "🍖";
        }
      });
      row.append(nameEl, bar, pctEl, feedBtn);
      listEl.appendChild(row);
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

  const render = (pets: ActivePetInfo[]): void => {
    listEl.innerHTML = "";
    // Compute pct-to-max for each pet; sort closest-to-max first
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
      .sort((a, b) => b.pct - a.pct);

    if (!withPct.length) {
      const e = document.createElement("div");
      e.style.cssText =
        "font-size:11px;color:rgba(224,224,224,0.3);font-style:italic;";
      e.textContent = t("feature.dashboard.noXpData");
      listEl.appendChild(e);
      return;
    }
    for (const { pet, pct, str } of withPct.slice(0, 3)) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:5px;";
      const nameEl = document.createElement("span");
      nameEl.style.cssText =
        "font-size:11px;color:rgba(224,224,224,0.75);min-width:52px;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameEl.textContent =
        pet.name || pet.species || t("feature.dashboard.petFallback", { index: pet.slotIndex + 1 });
      const clr =
        pct >= 95 ? "#8f82ff" : pct >= 80 ? "#ff9800" : "rgba(255,255,255,0.5)";
      const bar = makeBar(pct, clr);
      const pctEl = document.createElement("span");
      pctEl.style.cssText = `font-size:10px;color:${clr};min-width:30px;text-align:right;white-space:nowrap;`;
      pctEl.textContent = `${pct}% (${Math.round(str)})`;
      row.append(nameEl, bar, pctEl);
      listEl.appendChild(row);
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
        "font-size:11px;color:rgba(224,224,224,0.3);font-style:italic;";
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
        "font-size:10px;color:#8f82ff;min-width:44px;text-align:right;flex-shrink:0;";
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
