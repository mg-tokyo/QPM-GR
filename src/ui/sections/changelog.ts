// src/ui/sections/changelog.ts — Changelog rendering

import { t } from '../../i18n';
export { CHANGELOG } from './changelog-data';
import { CHANGELOG } from './changelog-data';

// ---------------------------------------------------------------------------
// Changelog card
// ---------------------------------------------------------------------------

export function buildChangelogCard(): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = [
    "margin-top:14px",
    "padding:10px",
    "background:rgba(255,255,255,0.03)",
    "border:1px solid var(--qpm-accent-subtle)",
    "border-radius:6px",
  ].join(";");

  const headerRow = document.createElement("div");
  headerRow.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;";

  const title = document.createElement("div");
  title.style.cssText = "font-size:12px;font-weight:700;color:var(--qpm-accent);";
  title.textContent = `📋 ${t('panel.footer.changelog')}`;

  const visibleEntries = CHANGELOG.slice(0, 3);
  const latest = visibleEntries[0]!;
  const latestBadge = document.createElement("div");
  latestBadge.style.cssText = "font-size:10px;color:rgba(224,224,224,0.5);";
  latestBadge.textContent = `v${latest.version}`;

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.style.cssText =
    "background:none;border:none;color:rgba(224,224,224,0.4);font-size:10px;cursor:pointer;padding:0 2px;";
  toggleBtn.textContent = "▶";

  headerRow.append(title, latestBadge, toggleBtn);
  card.appendChild(headerRow);

  // All changelog content — collapsed by default
  const body = document.createElement("div");
  body.style.display = "none";

  for (let index = 0; index < visibleEntries.length; index += 1) {
    const entry = visibleEntries[index]!;
    body.appendChild(buildChangelogEntry(entry, index === 0));
  }
  card.appendChild(body);

  let expanded = false;
  const toggle = (): void => {
    expanded = !expanded;
    body.style.display = expanded ? "block" : "none";
    toggleBtn.textContent = expanded ? "▼" : "▶";
  };
  headerRow.addEventListener("click", toggle);

  return card;
}

function buildChangelogEntry(
  entry: { version: string; date: string; notes: string[] },
  isLatest: boolean,
): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `margin-top:8px;padding-top:${isLatest ? "8" : "6"}px;${isLatest ? "" : "border-top:1px solid rgba(255,255,255,0.06);"}`;

  const versionRow = document.createElement("div");
  versionRow.style.cssText =
    "display:flex;align-items:center;gap:6px;margin-bottom:4px;";

  const versionBadge = document.createElement("span");
  versionBadge.style.cssText = `font-size:10px;font-weight:700;color:${isLatest ? "var(--qpm-accent)" : "var(--qpm-text-muted)"};`;
  versionBadge.textContent = `v${entry.version}`;

  const dateBadge = document.createElement("span");
  dateBadge.style.cssText = "font-size:10px;color:rgba(224,224,224,0.35);";
  dateBadge.textContent = entry.date;

  versionRow.append(versionBadge, dateBadge);
  el.appendChild(versionRow);

  const list = document.createElement("ul");
  list.style.cssText = "margin:0;padding:0 0 0 14px;";
  for (const note of entry.notes) {
    const li = document.createElement("li");
    li.style.cssText =
      "font-size:12px;color:rgba(224,224,224,0.7);margin-bottom:2px;";
    li.textContent = note;
    list.appendChild(li);
  }
  el.appendChild(list);

  return el;
}
