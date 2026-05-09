import type { PlayerView } from '../../types/publicRooms';
import {
  getPetSpriteCanvas,
  getPetSpriteWithMutations,
} from '../../sprite-v2/compat';
import { getSpeciesXpPerLevel, calculateMaxStrength } from '../../store/xpTracker';
import { getAbilityColor, itemIconMap } from './constants';
import { inspectorState, spriteReadyPromise } from './state';
import {
  sanitizeImageUrl,
  clearNode,
  setPanePlaceholder,
  setPaneContent,
  setAllPanes,
  formatCoins,
  safeArray,
  normalizeMillis,
  formatDuration,
  formatUpdatedAgo,
  renderAvatarBlock,
  friendlyName,
  previewData,
} from './helpers';
import {
  canvasToDataUrlSafe,
  renderSpriteByName,
  normalizePetSpecies,
  getItemSpriteUrl,
  getEggSpriteUrl,
  getMutatedCropSpriteUrl,
  getSeedSpriteUrl,
  applyCanvasFilter,
  renderAbilitySquares,
} from './spriteHelpers';
import { renderGardenPane } from './gardenPane';
import { t } from '../../i18n';

function renderOverviewPane(view: PlayerView, isFriend: boolean, privacy: PlayerView['privacy']): void {
  const allowProfile = isFriend || !!privacy?.showProfile;
  const allowCoins = isFriend || !!privacy?.showCoins;
  const name = allowProfile ? (view.playerName || inspectorState.targetPlayerName || 'Unknown player') : t('feature.publicRooms.hiddenByPrivacy');
  const roomLabel = (view.room && (view.room.id || (view.room as any).roomId)) || '';
  const lastEvent = view.lastEventAt ? formatUpdatedAgo(view.lastEventAt) : t('feature.publicRooms.na');
  const coins = allowCoins ? formatCoins(view.coins) : '—';

  setPaneContent('pr-overview-content', `
    <div class="pr-overview">
      ${renderAvatarBlock(view, name)}
      <div class="pr-overview-grid">
        <div class="pr-row"><span>${t('feature.publicRooms.statusLabel')}</span><span>${view.isOnline ? `🟢 ${t('feature.publicRooms.online')}` : `⚪ ${t('feature.publicRooms.offline')}`}</span></div>
        <div class="pr-row"><span>${t('feature.publicRooms.lastEvent')}</span><span>${lastEvent}</span></div>
        <div class="pr-row"><span>${t('feature.publicRooms.coinsLabel')}</span><span>${coins}</span></div>
      </div>
    </div>
  `);
}

async function renderInventoryPane(view: PlayerView, _isFriend: boolean, _privacy: PlayerView['privacy']): Promise<void> {
  await spriteReadyPromise;

  const inventory = view.state?.inventory as Record<string, unknown>;
  const collected: Array<{ label: string; qty: number; sprite?: string | null; icon?: string | null; petLevel?: number | null; petMaxLevel?: number; isPet?: boolean; abilities?: string[]; xp?: number; targetScale?: number }> = [];

  const pushItem = (item: Record<string, unknown> | null, fallbackKey?: string): void => {
    if (!item) return;
    if (fallbackKey && (fallbackKey === 'FavoritedItemIDs' || fallbackKey.includes('Favorited'))) return;
    if (typeof item !== 'object' || Array.isArray(item)) return;

    const qtyRaw = item.quantity ?? item.qty ?? item.count ?? 1;
    const qty = Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 1;
    const isPet = item.itemType && String(item.itemType).toLowerCase().includes('pet');
    const isEgg = item.itemType && String(item.itemType).toLowerCase().includes('egg');
    const seedName = item.seedName || item.seed || item.crop || item.species || item.cropId;
    const petSpecies = isPet ? (item.petSpecies || item.species) : null;
    let eggRarity = null;
    if (isEgg && item.eggId) {
      const eggIdStr = String(item.eggId);
      eggRarity = eggIdStr.replace(/Egg$/i, '').trim() || 'Common';
    }
    let baseLabel = (item.displayName || item.name || seedName || petSpecies || item.toolId || item.itemType || item.id || fallbackKey || 'Item') as string;
    if (isEgg && eggRarity) {
      baseLabel = `${eggRarity} Egg`;
    }
    if (String(baseLabel).toLowerCase().includes('tulip')) {
      baseLabel = 'Tulip';
    }
    const isSeed = Boolean(seedName) && (!item.itemType || String(item.itemType).toLowerCase().includes('seed'));
    if (baseLabel.toLowerCase() === 'decor' && (item.id || item.decorId || item.itemId)) {
      baseLabel = (item.displayName || item.name || item.id || item.decorId || item.itemId || 'Decor') as string;
    }
    const label = friendlyName(isSeed ? `${baseLabel} Seeds` : baseLabel);

    let petLevel: number | null = null;
    let petMaxLevel: number = 30;
    if (isPet) {
      const xp = (item.xp ?? item.petXP ?? item.petXp ?? 0) as number;
      const targetScale = (item.targetScale ?? item.petTargetScale ?? item.scale ?? 1) as number;
      if (xp > 0 && petSpecies) {
        const maxStrength = calculateMaxStrength(targetScale, petSpecies as string);
        const xpPerLevel = getSpeciesXpPerLevel(petSpecies as string);
        if (xpPerLevel && xpPerLevel > 0 && maxStrength) {
          const level = Math.min(30, Math.floor(xp / xpPerLevel));
          const baseStrength = 50;
          const strengthPerLevel = (maxStrength - baseStrength) / 30;
          petLevel = Math.min(maxStrength, Math.round(baseStrength + level * strengthPerLevel));
          petMaxLevel = maxStrength;
        }
      }
    }
    const species = isPet ? petSpecies : seedName;
    const lowerLabel = label.toLowerCase();
    const petMut = isPet && (item.mutation || item.mutations) ? String(Array.isArray(item.mutations) ? item.mutations[0] : item.mutation).toLowerCase() : '';

    let sprite: string | null = null;
    const candidateNames = [label, baseLabel, seedName, petSpecies, item.decorId, item.id, item.itemId, fallbackKey]
      .map((n) => (n ? String(n) : null))
      .filter(Boolean) as string[];

    if (isSeed && species) {
      sprite = getSeedSpriteUrl(String(species).toLowerCase());
    } else if (isEgg) {
      sprite = item.eggId ? getEggSpriteUrl(String(item.eggId)) : null;
    } else if (isPet && species) {
      const normalized = normalizePetSpecies(String(species));
      const petCanvas = petMut ? getPetSpriteWithMutations(normalized, [petMut]) : getPetSpriteCanvas(normalized);
      sprite = canvasToDataUrlSafe(petCanvas);
    } else if (species) {
      sprite = getMutatedCropSpriteUrl(String(species).toLowerCase(), (item.mutations || []) as unknown[]);
    }

    if (!sprite) {
      sprite =
        getItemSpriteUrl(lowerLabel) ||
        getItemSpriteUrl(baseLabel.toLowerCase()) ||
        candidateNames.map((name) => renderSpriteByName(name, ['decor', 'item'])).find(Boolean) ||
        candidateNames.map((name) => renderSpriteByName(name, ['item', 'decor'])).find(Boolean) ||
        null;
    }

    let finalSprite = sprite;
    if (!finalSprite && getItemSpriteUrl(baseLabel.toLowerCase())) {
      finalSprite = getItemSpriteUrl(baseLabel.toLowerCase());
    }

    const fallbackIcon = itemIconMap[lowerLabel.replace(/\s+/g, '')];
    const abilities = isPet && item.abilities ? (Array.isArray(item.abilities) ? item.abilities as string[] : [item.abilities as string]) : [];
    const xp = isPet ? ((item.xp ?? item.petXP ?? item.petXp ?? 0) as number) : 0;
    const targetScale = isPet ? ((item.targetScale ?? item.petTargetScale ?? item.scale ?? 1) as number) : 1;
    collected.push({ label, qty, sprite: finalSprite || null, icon: fallbackIcon || null, petLevel, petMaxLevel, isPet: !!isPet, abilities, xp, targetScale });
  };

  if (Array.isArray(inventory)) {
    inventory.forEach((item) => pushItem(item as Record<string, unknown>));
  } else if (inventory && typeof inventory === 'object') {
    Object.entries(inventory).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((v) => pushItem(v as Record<string, unknown>, key));
      } else if (value && typeof value === 'object') {
        pushItem(value as Record<string, unknown>, key);
      }
    });
  }

  const pane = document.getElementById('pr-inventory-content');
  if (!pane) return;
  clearNode(pane);

  const section = document.createElement('div');
  section.className = 'pr-section';

  const sectionHead = document.createElement('div');
  sectionHead.className = 'pr-section-head';
  sectionHead.textContent = t('feature.publicRooms.inventoryCount', { count: String(collected.length) });

  const cardsRoot = document.createElement('div');
  cardsRoot.className = 'pr-card-grid';
  cardsRoot.id = 'pr-inv-cards';

  section.append(sectionHead, cardsRoot);
  pane.appendChild(section);

  const appendAbilitySquares = (container: HTMLElement, abilities: string[]): void => {
    if (!abilities.length) return;
    const abilityWrap = document.createElement('div');
    abilityWrap.className = 'pr-inv-abilities';
    abilities.forEach((ability) => {
      const colors = getAbilityColor(String(ability));
      const square = document.createElement('div');
      square.className = 'pr-ability-square';
      square.title = String(ability);
      square.style.cssText = `background:${colors.base};border:1px solid rgba(255,255,255,0.3);box-shadow:0 0 6px ${colors.glow};`;
      abilityWrap.appendChild(square);
    });
    container.appendChild(abilityWrap);
  };

  const appendSprite = (container: HTMLElement, spriteUrl: string | null | undefined, fallback: string): void => {
    const spriteContainer = document.createElement('div');
    spriteContainer.className = 'pr-inv-sprite-container';
    const safeSprite = sanitizeImageUrl(spriteUrl);
    if (safeSprite) {
      const img = document.createElement('img');
      img.src = safeSprite;
      img.alt = '';
      img.className = 'pr-inv-sprite';
      spriteContainer.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'pr-inv-placeholder';
      ph.textContent = fallback;
      spriteContainer.appendChild(ph);
    }
    container.appendChild(spriteContainer);
  };

  const buildInventoryCard = (item: (typeof collected)[number]): HTMLElement => {
    const card = document.createElement('div');
    card.className = item.isPet ? 'pr-inv-card pet-card' : 'pr-inv-card';

    if (item.isPet) {
      appendAbilitySquares(card, Array.isArray(item.abilities) ? item.abilities.map((a) => String(a)) : []);
      appendSprite(card, item.sprite, '?');

      const name = document.createElement('div');
      name.className = 'pr-inv-name';
      name.textContent = String(item.label || 'Pet');

      const str = document.createElement('div');
      str.className = 'pr-inv-str';
      str.textContent = `STR: ${item.petLevel ?? 0}`;

      card.append(name, str);
      return card;
    }

    appendSprite(card, item.sprite, String(item.icon || '?'));

    const name = document.createElement('div');
    name.className = 'pr-inv-name';
    name.textContent = String(item.label || 'Item');

    const qtyEl = document.createElement('div');
    qtyEl.className = 'pr-inv-qty';
    qtyEl.textContent = `x${Number(item.qty || 0)}`;

    card.append(name, qtyEl);
    return card;
  };

  const BATCH_SIZE = 32;
  let index = 0;
  const pump = (): void => {
    const start = performance.now();
    let processed = 0;
    const frag = document.createDocumentFragment();

    while (index < collected.length && processed < BATCH_SIZE && performance.now() - start < 10) {
      const item = collected[index++];
      if (!item) continue;
      frag.appendChild(buildInventoryCard(item));
      processed += 1;
    }

    if (frag.childNodes.length > 0) {
      cardsRoot.appendChild(frag);
    }

    if (index < collected.length) {
      requestAnimationFrame(pump);
      return;
    }

    if (!cardsRoot.firstChild) {
      const empty = document.createElement('div');
      empty.className = 'pr-pane-placeholder';
      empty.textContent = t('feature.publicRooms.inventoryEmpty');
      cardsRoot.appendChild(empty);
    }
  };

  if (!collected.length) {
    const empty = document.createElement('div');
    empty.className = 'pr-pane-placeholder';
    empty.textContent = t('feature.publicRooms.inventoryEmpty');
    cardsRoot.appendChild(empty);
  } else {
    requestAnimationFrame(pump);
  }

  const storages = (view.state?.inventory as Record<string, unknown>)?.storages as Record<string, unknown>[] | undefined;
  const hutch = storages?.find((s) => s.decorId === 'PetHutch' || s.type === 'hutch' || s.id === 'hutch');
  if (hutch && Array.isArray(hutch.items) && hutch.items.length > 0) {
    const hutchSection = document.createElement('div');
    hutchSection.className = 'pr-section';

    const hutchHead = document.createElement('div');
    hutchHead.className = 'pr-section-head';
    hutchHead.textContent = t('feature.publicRooms.hutchCount', { count: String(hutch.items.length) });

    const hutchGrid = document.createElement('div');
    hutchGrid.className = 'pr-card-grid';

    hutch.items.forEach((pet: Record<string, unknown>) => {
      const species = (pet.petSpecies || pet.species) as string;
      const normalized = normalizePetSpecies(String(species));
      const petName = (pet.name || friendlyName(species)) as string;

      let spriteUrl = canvasToDataUrlSafe(getPetSpriteCanvas(normalized));
      const petMut = (pet.mutation || pet.mutations) ? String(Array.isArray(pet.mutations) ? pet.mutations[0] : pet.mutation).toLowerCase() : '';
      if (spriteUrl && petMut) {
        const petCanvas = getPetSpriteWithMutations(normalized, [petMut]);
        if (petCanvas) {
          const withMut = applyCanvasFilter(petCanvas, petMut);
          spriteUrl = canvasToDataUrlSafe(withMut) || spriteUrl;
        }
      }

      const xp = (pet.xp || 0) as number;
      const targetScale = (pet.targetScale || 1) as number;
      let strength = 50;
      const maxStrength = calculateMaxStrength(targetScale, species);
      const xpPerLevel = getSpeciesXpPerLevel(species);
      if (xpPerLevel && xpPerLevel > 0 && xp > 0 && maxStrength) {
        const level = Math.min(30, Math.floor(xp / xpPerLevel));
        const baseStrength = 50;
        const strengthPerLevel = (maxStrength - baseStrength) / 30;
        strength = Math.min(maxStrength, Math.round(baseStrength + level * strengthPerLevel));
      }

      const abilities = pet.abilities ? (Array.isArray(pet.abilities) ? pet.abilities as string[] : [pet.abilities as string]) : [];
      const card = document.createElement('div');
      card.className = 'pr-inv-card pet-card';
      appendAbilitySquares(card, abilities.map((a) => String(a)));
      appendSprite(card, spriteUrl, '?');

      const nameEl = document.createElement('div');
      nameEl.className = 'pr-inv-name';
      nameEl.textContent = String(petName);

      const petStr = document.createElement('div');
      petStr.className = 'pr-inv-str';
      petStr.textContent = `STR: ${strength}`;

      card.append(nameEl, petStr);
      hutchGrid.appendChild(card);
    });

    hutchSection.append(hutchHead, hutchGrid);
    pane.appendChild(hutchSection);
  }
}

function renderActivityPane(view: PlayerView, _isFriend: boolean, _privacy: PlayerView['privacy']): void {
  const logs = Array.isArray(view.state?.activityLog)
    ? view.state?.activityLog
    : (Array.isArray(view.state?.activityLogs) ? view.state?.activityLogs : []);

  if (!logs || logs.length === 0) {
    setPanePlaceholder('pr-activity-content', t('feature.publicRooms.noActivityShared'));
    return;
  }

  const parsed = logs.slice(0, 8).map((entry) => {
    let obj = entry as Record<string, unknown>;
    if (typeof entry === 'string') {
      try { obj = JSON.parse(entry); } catch { obj = { note: entry }; }
    }
    const rawAction = (obj.action || obj.type || obj.event || obj.name || 'Activity') as string;
    const action = friendlyName(rawAction);
    const timestamp = normalizeMillis(obj.timestamp ?? obj.time ?? obj.createdAt ?? null);
    const ago = timestamp ? formatUpdatedAgo(new Date(timestamp).toISOString()) : 'recently';
    const params = (obj.parameters || obj) as Record<string, unknown>;

    const crop = params?.species || params?.crop || params?.seed || obj.seed;
    const pet = (params?.pet as Record<string, unknown>)?.name || (params?.pet as Record<string, unknown>)?.petSpecies || params?.petSpecies || obj.pet;
    const mutations = (params?.mutations || params?.mutation || []) as unknown[];
    let spriteUrl = null;

    if (crop) {
      spriteUrl = getMutatedCropSpriteUrl(String(crop).toLowerCase(), mutations);
    } else if (pet) {
      const petSpecies = (params?.pet as Record<string, unknown>)?.petSpecies || pet;
      spriteUrl = canvasToDataUrlSafe(getPetSpriteCanvas(String(petSpecies).toLowerCase()));
    }

    let detail = '';
    if (rawAction === 'feedPet') {
      const petName = (params?.pet as Record<string, unknown>)?.name || 'pet';
      detail = t('feature.publicRooms.fedPet', { name: String(petName) });
    } else if (rawAction === 'purchaseEgg') {
      const eggIds = (params?.eggIds || []) as string[];
      const eggType = Array.isArray(eggIds) && eggIds.length > 0 ? eggIds[0] : 'egg';
      detail = t('feature.publicRooms.purchasedItem', { name: friendlyName(eggType) });
    } else if (rawAction === 'purchaseSeed') {
      const seedIds = (params?.seedIds || []) as string[];
      const seedType = Array.isArray(seedIds) && seedIds.length > 0 ? seedIds[0] : 'seed';
      detail = t('feature.publicRooms.purchasedItem', { name: friendlyName(seedType) });
    } else if (rawAction === 'purchaseTool') {
      detail = t('feature.publicRooms.purchasedTool');
    } else if (rawAction === 'harvest') {
      const crops = (params?.crops || []) as Record<string, unknown>[];
      const cropCount = Array.isArray(crops) ? crops.length : 1;
      const cropSpecies = Array.isArray(crops) && crops.length > 0 ? crops[0]?.species : 'crops';
      detail = t('feature.publicRooms.harvestedCrops', { count: String(cropCount), species: friendlyName(cropSpecies) });
    } else if (rawAction === 'plantEgg') {
      detail = t('feature.publicRooms.plantedEgg');
    } else if (rawAction.startsWith('PetXpBoost')) {
      const bonusXp = params?.bonusXp || 0;
      const affected = (params?.petsAffected as unknown[])?.length || 0;
      detail = affected !== 1 ? t('feature.publicRooms.xpBoosts', { xp: String(bonusXp), count: String(affected) }) : t('feature.publicRooms.xpBoost', { xp: String(bonusXp), count: String(affected) });
    } else if (rawAction === 'ProduceScaleBoostII' || rawAction === 'ProduceScaleBoost') {
      detail = t('feature.publicRooms.cropSizeBoost');
    } else if (rawAction.includes('Kisser') || rawAction.includes('Granter')) {
      detail = t('feature.publicRooms.abilityTriggered', { ability: action });
    } else if (rawAction.toLowerCase().includes('hatch')) {
      detail = t('feature.publicRooms.hatched', { name: friendlyName(pet || crop || 'pet') });
    } else if (rawAction.toLowerCase().includes('sell')) {
      detail = t('feature.publicRooms.sold', { name: friendlyName(pet || crop || 'item') });
    } else if (params?.currency && params?.purchasePrice) {
      detail = t('feature.publicRooms.spent', { amount: String(params.purchasePrice), currency: String(params.currency) });
    } else {
      detail = previewData(params) || t('feature.publicRooms.noDetails');
    }

    return { action, ago, detail, sprite: spriteUrl };
  });

  const pane = document.getElementById('pr-activity-content');
  if (!pane) return;
  clearNode(pane);

  const section = document.createElement('div');
  section.className = 'pr-section';

  const head = document.createElement('div');
  head.className = 'pr-section-head';
  head.textContent = t('feature.publicRooms.recentActivity');

  const timeline = document.createElement('div');
  timeline.className = 'pr-timeline';

  parsed.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'pr-timeline-item';

    const dot = document.createElement('div');
    dot.className = 'pr-timeline-dot';
    row.appendChild(dot);

    const safeSprite = sanitizeImageUrl(item.sprite);
    if (safeSprite) {
      const spriteEl = document.createElement('div');
      spriteEl.className = 'pr-sprite-circle';
      spriteEl.style.backgroundImage = `url("${safeSprite}")`;
      row.appendChild(spriteEl);
    } else {
      const spacer = document.createElement('div');
      spacer.style.width = '10px';
      row.appendChild(spacer);
    }

    const main = document.createElement('div');
    main.className = 'pr-timeline-main';

    const title = document.createElement('div');
    title.className = 'pr-timeline-title';
    title.textContent = item.action;

    const detailEl = document.createElement('div');
    detailEl.className = 'pr-timeline-detail';
    detailEl.textContent = item.detail || t('feature.publicRooms.noDetails');

    main.append(title, detailEl);

    const timeBadge = document.createElement('div');
    timeBadge.className = 'pr-time-badge';
    timeBadge.textContent = item.ago;

    row.append(main, timeBadge);
    timeline.appendChild(row);
  });

  section.append(head, timeline);

  if (logs.length > 8) {
    const hint = document.createElement('div');
    hint.className = 'pr-hint';
    hint.textContent = t('feature.publicRooms.showingFirstEntries');
    section.appendChild(hint);
  }

  pane.appendChild(section);
}

export async function renderInspectorPanes(view: PlayerView, isFriend: boolean): Promise<void> {
  const privacy = view.privacy || {
    showProfile: true,
    showGarden: true,
    showInventory: true,
    showStats: true,
    showActivityLog: true,
    showJournal: true,
    showCoins: true,
  };

  renderOverviewPane(view, true, privacy);
  renderGardenPane(view, true, privacy);
  await renderInventoryPane(view, true, privacy);
  renderActivityPane(view, true, privacy);
}
