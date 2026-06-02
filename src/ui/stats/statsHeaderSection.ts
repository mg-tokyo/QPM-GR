// src/ui/sections/statsHeaderSection.ts — Dashboard stats header section
import { type UIState } from "../core/panelState";
import { btn, showToast } from "../core/panelHelpers";
import { log } from "../../utils/logger";
import { t } from "../../i18n";
import { getCropSpriteDataUrl } from "../../sprite-v2/compat";
import {
  fetchRestockData,
  getRestockDataSync,
  onRestockDataUpdated,
  type RestockItem,
} from "../../utils/restock/dataService";
import { visibleInterval } from "../../utils/scheduling/timerManager";
import { buildChangelogCard } from "../sections/changelog";

// ---------------------------------------------------------------------------
// Shop restock card helpers
// ---------------------------------------------------------------------------

// These are specific items tracked in the restock database with special pity logic.
// They are matched by item_id (trying multiple known aliases), not by shop_type.
// Item IDs must stay in sync with CELESTIAL_IDS in shopRestockWindow.ts.
const CELESTIAL_ITEMS = [
  {
    label: "Starweaver",
    color: "rgba(255,215,0,0.12)",
    accent: "#FFD700",
    itemIds: ["StarweaverPod", "Starweaver"],
  },
  {
    label: "Dawnbinder",
    color: "rgba(255,152,0,0.12)",
    accent: "#FF9800",
    itemIds: ["DawnbinderPod", "Dawnbinder", "DawnCelestial"],
  },
  {
    label: "Moonbinder",
    color: "rgba(156,39,176,0.12)",
    accent: "#CE93D8",
    itemIds: ["MoonbinderPod", "Moonbinder", "MoonCelestial"],
  },
  {
    label: "Mythical Egg",
    color: "rgba(66,165,245,0.12)",
    accent: "#42A5F5",
    itemIds: ["MythicalEgg", "MythicalEggs"],
  },
] as const;

/** Try to get a sprite data URL for the first matching item ID alias. Returns '' if not found. */
function getCelestialSpriteUrl(itemIds: readonly string[]): string {
  for (const id of itemIds) {
    const url = getCropSpriteDataUrl(id);
    if (url) return url;
  }
  return "";
}

// ETA format matching the restock tracker: ~Xm / ~Xh / ~Xd
function formatETA(ts: number): string {
  if (!ts) return "—";
  const diff = ts - Date.now();
  if (diff <= 0) return "—"; // stale — Supabase will have a new prediction after next refresh
  const min = Math.ceil(diff / 60_000);
  if (min < 60) return `~${min}m`;
  const hr = Math.ceil(diff / 3_600_000);
  if (hr < 24) return `~${hr}h`;
  const day = Math.ceil(diff / 86_400_000);
  return `~${day}d`;
}

// 7-tier color scale matching the restock tracker: green = imminent, red = far
function etaColor(ts: number): string {
  if (!ts) return "rgba(224,224,224,0.4)";
  const diff = ts - Date.now();
  if (diff <= 0) return "rgba(224,224,224,0.3)"; // stale — muted until next refresh
  const h = diff / 3_600_000;
  if (h < 1) return "#22c55e";
  if (h < 6) return "#84cc16";
  if (h < 24) return "#eab308";
  const d = diff / 86_400_000;
  if (d < 7) return "#f97316";
  if (d < 14) return "#f87171";
  return "#ef4444";
}


// ---------------------------------------------------------------------------
// createStatsHeader
// ---------------------------------------------------------------------------

export function createStatsHeader(
  uiState: UIState,
  cfg: any,
  saveCfg: () => void,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "qpm-card";
  container.dataset.qpmSection = "header";
  container.style.cssText =
    "background:linear-gradient(135deg,rgba(143,130,255,0.08),rgba(143,130,255,0.03));border:1px solid rgba(143,130,255,0.15);";

  // ── Header row ──
  const headerRow = document.createElement("div");
  headerRow.className = "qpm-card__header";

  const headerTitle = document.createElement("div");
  headerTitle.className = "qpm-card__title";
  headerTitle.textContent = t('feature.statsHeader.title');
  headerTitle.style.cssText =
    "font-size:14px;font-weight:700;letter-spacing:0.3px;";

  const resetWinBtn = btn(t('panel.footer.resetWindows'), () => {
    import("../core/modalWindow").then(({ resetAllWindowLayouts }) => {
      resetAllWindowLayouts();
      resetWinBtn.textContent = t('feature.statsHeader.resetDone');
      setTimeout(() => {
        resetWinBtn.textContent = t('panel.footer.resetWindows');
      }, 1500);
    });
  });
  resetWinBtn.classList.add("qpm-button--accent");
  resetWinBtn.style.fontSize = "11px";
  resetWinBtn.title = t('feature.statsHeader.resetTooltip');

  headerRow.append(headerTitle, resetWinBtn);
  container.appendChild(headerRow);

  // ── Shop Restock summary ──
  const shopSection = buildShopRestockSection();
  container.appendChild(shopSection);

  // ── Changelog ──
  const changelogCard = buildChangelogCard();
  container.appendChild(changelogCard);

  // ── Settings backup/restore ──
  const settingsRow = buildSettingsRow();
  container.appendChild(settingsRow);

  return container;
}

// ---------------------------------------------------------------------------
// Shop restock summary
// ---------------------------------------------------------------------------

function buildShopRestockSection(): HTMLElement {
  const section = document.createElement("div");
  section.style.cssText = "margin-top:14px;";

  const sectionTitle = document.createElement("div");
  sectionTitle.style.cssText =
    "font-size:11px;font-weight:600;color:#64b5f6;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;";
  sectionTitle.textContent = `✨ ${t('feature.statsHeader.celestialRestocks')}`;
  section.appendChild(sectionTitle);

  const grid = document.createElement("div");
  grid.style.cssText =
    "display:grid;grid-template-columns:repeat(2,1fr);gap:8px;";
  section.appendChild(grid);

  // One card per celestial item — looked up by item_id, not shop_type
  const cardEls: Array<{
    nextEl: HTMLElement;
    subEl: HTMLElement;
    ts: number;
  }> = [];

  for (const item of CELESTIAL_ITEMS) {
    const card = document.createElement("div");
    card.style.cssText = [
      "padding:8px 10px",
      `background:${item.color}`,
      `border:1px solid ${item.accent}40`,
      "border-radius:6px",
      "display:flex",
      "flex-direction:column",
      "gap:3px",
      "min-width:0",
    ].join(";");

    const nameEl = document.createElement("div");
    nameEl.style.cssText = `font-size:10px;font-weight:700;color:${item.accent};letter-spacing:0.3px;display:flex;align-items:center;gap:3px;`;
    const spriteUrl = getCelestialSpriteUrl(item.itemIds);
    if (spriteUrl) {
      const img = document.createElement("img");
      img.src = spriteUrl;
      img.style.cssText =
        "height:16px;width:auto;image-rendering:pixelated;flex-shrink:0;";
      nameEl.appendChild(img);
    }
    nameEl.appendChild(document.createTextNode(item.label));

    // ETA row: large colored countdown
    const nextEl = document.createElement("div");
    nextEl.style.cssText =
      "font-size:15px;font-weight:700;color:rgba(224,224,224,0.4);font-variant-numeric:tabular-nums;";
    nextEl.textContent = "—";

    // Last seen row
    const subRow = document.createElement("div");
    subRow.style.cssText = "display:flex;align-items:center;gap:5px;";
    const subEl = document.createElement("span");
    subEl.style.cssText =
      "font-size:10px;color:rgba(224,224,224,0.3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    subEl.textContent = t('common.loading');
    subRow.append(subEl);

    card.append(nameEl, nextEl, subRow);
    grid.appendChild(card);
    cardEls.push({ nextEl, subEl, ts: 0 });
  }

  // Find best matching item across aliases.
  // Preference: earliest future ETA, then newest last_seen, then first alias order.
  const findItem = (
    allItems: RestockItem[],
    aliases: readonly string[],
  ): RestockItem | null => {
    const aliasOrder = new Map<string, number>();
    aliases.forEach((alias, index) => {
      aliasOrder.set(alias.toLowerCase(), index);
    });

    const candidates = allItems.filter((item) =>
      aliasOrder.has((item.item_id ?? "").toLowerCase()),
    );
    if (!candidates.length) return null;

    const now = Date.now();
    candidates.sort((a, b) => {
      const aTs = a.estimated_next_timestamp ?? 0;
      const bTs = b.estimated_next_timestamp ?? 0;
      const aHasFuture = aTs > now;
      const bHasFuture = bTs > now;

      if (aHasFuture !== bHasFuture) return aHasFuture ? -1 : 1;
      if (aHasFuture && bHasFuture && aTs !== bTs) return aTs - bTs;

      const aLast = a.last_seen ?? 0;
      const bLast = b.last_seen ?? 0;
      if (aLast !== bLast) return bLast - aLast;

      const aOrder =
        aliasOrder.get((a.item_id ?? "").toLowerCase()) ??
        Number.MAX_SAFE_INTEGER;
      const bOrder =
        aliasOrder.get((b.item_id ?? "").toLowerCase()) ??
        Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });

    return candidates[0] ?? null;
  };

  // Update card contents from dataset
  const updateCards = (allItems: RestockItem[]): void => {
    CELESTIAL_ITEMS.forEach((def, i) => {
      const card = cardEls[i];
      if (!card) return;
      const { nextEl, subEl } = card;

      const found = findItem(allItems, def.itemIds);
      if (!found) {
        nextEl.textContent = "—";
        nextEl.style.color = "rgba(224,224,224,0.4)";
        subEl.textContent = t('feature.statsHeader.noDataYet');
        card.ts = 0;
        return;
      }

      const ts = found.estimated_next_timestamp ?? 0;
      card.ts = ts;
      nextEl.textContent = formatETA(ts);
      nextEl.style.color = etaColor(ts);

      const now = Date.now();
      subEl.textContent = found.last_seen
        ? t('feature.statsHeader.lastSeenDaysAgo', { days: String(Math.round((now - found.last_seen) / 86_400_000)) })
        : "";
    });
  };

  // Live countdown ticker — update ETA text + color every 30s (matches restock window)
  const stopTicker = visibleInterval(
    "dashboard-restock-cards",
    () => {
      for (const card of cardEls) {
        if (!card.ts) continue;
        card.nextEl.textContent = formatETA(card.ts);
        card.nextEl.style.color = etaColor(card.ts);
      }
    },
    30_000,
  );

  const stopRestockSync = onRestockDataUpdated((detail) => {
    updateCards(detail.items ?? getRestockDataSync() ?? []);
  });

  // Cleanup on container detach
  const obs = new MutationObserver(() => {
    if (!section.isConnected) {
      obs.disconnect();
      stopTicker();
      stopRestockSync();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Load data
  const cached = getRestockDataSync();
  if (cached) updateCards(cached);

  fetchRestockData(false)
    .then((items) => updateCards(items))
    .catch((err) => {
      log("⚠️ [Dashboard] Failed to load restock data", err);
    });

  return section;
}

// ---------------------------------------------------------------------------
// Settings backup/restore row
// ---------------------------------------------------------------------------

function settingsBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = [
    "font-size:10px",
    "padding:3px 10px",
    "border-radius:4px",
    "cursor:pointer",
    "border:1px solid rgba(143,130,255,0.3)",
    "background:rgba(143,130,255,0.08)",
    "color:#c8c0ff",
    "white-space:nowrap",
  ].join(";");
  b.addEventListener("click", onClick);
  return b;
}

function buildSettingsRow(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "margin-top:8px;text-align:center;";

  const toggle = document.createElement("span");
  toggle.style.cssText =
    "font-size:10px;color:rgba(224,224,224,0.35);cursor:pointer;user-select:none;";
  const settingsLabel = t('feature.statsHeader.settings');
  toggle.textContent = `${settingsLabel} \u25BC`;
  wrapper.appendChild(toggle);

  const buttons = document.createElement("div");
  buttons.style.cssText =
    "display:none;justify-content:center;gap:6px;margin-top:6px;";
  wrapper.appendChild(buttons);

  toggle.addEventListener("click", () => {
    const open = buttons.style.display !== "none";
    buttons.style.display = open ? "none" : "flex";
    toggle.textContent = open ? `${settingsLabel} \u25BC` : `${settingsLabel} \u25B2`;
  });

  const exportBtn = settingsBtn(t('panel.footer.export'), async () => {
    try {
      const { downloadBackup } = await import("../../services/backupService");
      downloadBackup();
      showToast(t('panel.footer.exportToast'));
    } catch (err) {
      log("Export failed", err);
      showToast(t('panel.footer.exportFailed'));
    }
  });

  const importBtn = settingsBtn(t('panel.footer.import'), () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      if (
        !confirm(
          t('feature.statsHeader.importConfirm'),
        )
      )
        return;
      try {
        const { importFromFile } = await import("../../services/backupService");
        const result = await importFromFile(file);
        if (result.ok) {
          showToast(t('feature.statsHeader.importSuccess', { count: String(result.keysWritten) }));
          if (result.warnings.length) log("Import warnings:", result.warnings);
        } else {
          showToast(t('panel.footer.importError', { reason: result.warnings[0] ?? t('window.lazy.unknownError') }));
        }
      } catch (err) {
        log("Import failed", err);
        showToast(t('panel.footer.importFailed'));
      }
    });
    document.body.appendChild(input);
    input.click();
  });

  buttons.append(exportBtn, importBtn);
  return wrapper;
}