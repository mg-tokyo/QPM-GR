// Team editor rendering for the manager tab — slot cards, diet popover, keybinds.

import {
  getTeamsConfig,
  renameTeam,
  deleteTeam,
  saveCurrentTeamSlots,
  setTeamSlot,
  clearTeamSlot,
  applyTeam,
  detectCurrentTeam,
  setKeybind,
  clearKeybind,
  getKeybinds,
  getAllPooledPets,
  getFeedPolicy,
  setFeedPolicyOverride,
  clearFeedPolicyOverride,
} from '../../../store/petTeams';
import { getActivePetInfos } from '../../../store/pets';
import { getPetSpriteDataUrlWithMutations, getCropSpriteDataUrl, getAnySpriteDataUrl, isSpritesReady } from '../../../sprite-v2/compat';
import { HUNGER_POTION_KEY } from '../../../features/pets/hungerPotion';
import { getAbilityColor } from '../../../utils/rendering/petCardRenderer';
import { getAbilityDefinition } from '../../../features/pets/data/petAbilities';
import { openPetPicker } from '../pickerModal';
import { hasFloatingCardForSlot, openFloatingCardForSlot } from '../floatingCard';
import { enqueueFeed } from '../../../features/pets/instantFeed';
import {
  getPetFoodRules,
  getDietOptionsForSpecies,
} from '../../../features/pets/foodRules';
import { normalizeSpeciesKey } from '../../../utils/helpers';
import type { PetItemFeedOverride } from '../../../types/petTeams';
import { windowLog } from '../../core/modalWindow';
import { btn, showToast, createKeybindButton, computeTeamScore, computePetScore } from './helpers';
import { renderTeamSummaryBar, computeTeamAbilityPills } from './teamSummary';
import type { ManagerContext } from './types';
import { t } from '../../../i18n';

// ---------------------------------------------------------------------------
// Diet popover state (module-scoped singleton)
// ---------------------------------------------------------------------------

let activeDietAnchor: HTMLElement | null = null;
let activeDietClose: (() => void) | null = null;

function openDietPopover(
  anchorEl: HTMLElement,
  species: string,
  petItemId: string | null,
  onClose: () => void,
): void {
  // Toggle: if clicking the same gear again, close and return
  if (activeDietAnchor === anchorEl && activeDietClose) {
    activeDietClose();
    return;
  }
  // Close any existing popover first
  if (activeDietClose) activeDietClose();

  const speciesKey = normalizeSpeciesKey(species);
  const dietOptions = getDietOptionsForSpecies(species);
  if (dietOptions.length === 0) return;

  const dropdown = document.createElement('div');
  dropdown.style.cssText = [
    'position:fixed', 'z-index:99998',
    'background:rgba(14,16,22,0.98)',
    'border:1px solid rgba(143,130,255,0.35)',
    'border-radius:10px', 'padding:8px',
    'min-width:200px', 'max-width:260px',
    'max-height:300px', 'overflow-y:auto',
    'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
    'display:flex', 'flex-direction:column', 'gap:2px',
  ].join(';');

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:11px;font-weight:600;color:#e8e0ff;padding:4px 6px 6px;';
  titleEl.textContent = t('feature.petsWindow.dietTitle', { species });
  dropdown.appendChild(titleEl);

  const divider = document.createElement('div');
  divider.style.cssText = 'border-top:1px solid rgba(255,255,255,0.08);margin:0 0 4px;';
  dropdown.appendChild(divider);

  function readForbiddenSet(): Set<string> {
    const rules = getPetFoodRules();
    const feedPolicy = getFeedPolicy();
    const speciesOverride = speciesKey ? (rules.overrides[speciesKey] ?? {}) : {};
    const itemOverride = petItemId ? (feedPolicy.petItemOverrides[petItemId] ?? null) : null;
    const effectiveForbidden = Array.isArray(itemOverride?.forbidden)
      ? itemOverride.forbidden
      : (speciesOverride.forbidden ?? []);
    return new Set(effectiveForbidden);
  }

  function readPreferredKey(): string | null {
    const rules = getPetFoodRules();
    const feedPolicy = getFeedPolicy();
    const speciesOverride = speciesKey ? (rules.overrides[speciesKey] ?? {}) : {};
    const itemOverride = petItemId ? (feedPolicy.petItemOverrides[petItemId] ?? null) : null;
    return itemOverride?.preferred ?? speciesOverride.preferred ?? null;
  }

  const forbiddenSet = readForbiddenSet();
  const preferredKey = readPreferredKey();

  for (const option of dietOptions) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12px;color:#e0e0e0;';
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(143,130,255,0.1)'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !forbiddenSet.has(option.key);
    cb.style.cssText = 'accent-color:#8f82ff;cursor:pointer;flex-shrink:0;';
    cb.addEventListener('change', () => {
      if (!petItemId && !speciesKey) return;
      const freshRules = getPetFoodRules();
      const freshFeedPolicy = getFeedPolicy();
      const freshSpeciesOverride = speciesKey ? (freshRules.overrides[speciesKey] ?? {}) : {};
      const freshItemOverride = petItemId ? (freshFeedPolicy.petItemOverrides[petItemId] ?? null) : null;
      const currentForbidden = Array.isArray(freshItemOverride?.forbidden)
        ? freshItemOverride.forbidden
        : (freshSpeciesOverride.forbidden ?? []);
      const forbidden = new Set(currentForbidden);
      if (cb.checked) forbidden.delete(option.key);
      else forbidden.add(option.key);
      const nextForbidden = Array.from(forbidden);
      const speciesForbidden = new Set(freshSpeciesOverride.forbidden ?? []);
      const sameAsSpecies = (
        nextForbidden.length === speciesForbidden.size &&
        nextForbidden.every((v) => speciesForbidden.has(v))
      );
      if (petItemId) {
        const nextOverride: Partial<PetItemFeedOverride> = {};
        const nextAllowed = Array.isArray(freshItemOverride?.allowed) ? [...freshItemOverride.allowed] : undefined;
        const nextPreferred = typeof freshItemOverride?.preferred === 'string' && freshItemOverride.preferred.length > 0
          ? freshItemOverride.preferred : undefined;
        if (nextAllowed !== undefined) nextOverride.allowed = nextAllowed;
        if (nextPreferred !== undefined) nextOverride.preferred = nextPreferred;
        if (!sameAsSpecies) nextOverride.forbidden = nextForbidden;
        const hasAny = nextOverride.allowed || nextOverride.forbidden || nextOverride.preferred;
        if (!hasAny) clearFeedPolicyOverride(petItemId);
        else setFeedPolicyOverride(petItemId, nextOverride);
      }
    });
    row.appendChild(cb);

    // Food sprite (crop or potion)
    const cropUrl = option.key === HUNGER_POTION_KEY
      ? (getAnySpriteDataUrl('sprite/item/ReplenishPotion') || getAnySpriteDataUrl('item/ReplenishPotion'))
      : getCropSpriteDataUrl(option.key);
    if (cropUrl) {
      const img = document.createElement('img');
      img.src = cropUrl;
      img.alt = '';
      img.style.cssText = 'width:20px;height:20px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
      row.appendChild(img);
    }

    const txt = document.createElement('span');
    txt.textContent = `${option.label}${option.key === preferredKey ? ' \u2605' : ''}`;
    if (option.key === preferredKey) txt.style.color = '#8f82ff';
    row.appendChild(txt);

    dropdown.appendChild(row);
  }

  document.body.appendChild(dropdown);

  // Position below anchor
  const rect = anchorEl.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${rect.left}px`;
  // Clamp to viewport
  requestAnimationFrame(() => {
    const dw = dropdown.offsetWidth || 240;
    const dh = dropdown.offsetHeight || 200;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + dw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - dw - 8);
    if (top + dh > window.innerHeight - 8) top = Math.max(8, rect.top - dh - 4);
    dropdown.style.left = `${Math.round(left)}px`;
    dropdown.style.top = `${Math.round(top)}px`;
  });

  const closeDropdown = (): void => {
    dropdown.remove();
    document.removeEventListener('mousedown', onOutside, true);
    activeDietAnchor = null;
    activeDietClose = null;
    onClose();
  };
  const onOutside = (ev: MouseEvent): void => {
    if (!dropdown.contains(ev.target as Node) && ev.target !== anchorEl) {
      closeDropdown();
    }
  };
  activeDietAnchor = anchorEl;
  activeDietClose = closeDropdown;
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}

// ---------------------------------------------------------------------------
// renderEditor
// ---------------------------------------------------------------------------

export function renderEditor(ctx: ManagerContext): void {
  ctx.editor.innerHTML = '';

  if (!ctx.state.selectedTeamId) {
    const placeholder = document.createElement('div');
    placeholder.className = 'qpm-editor__placeholder';
    placeholder.textContent = t('feature.petsWindow.selectTeam');
    ctx.editor.appendChild(placeholder);
    return;
  }

  const config = getTeamsConfig();
  const team = config.teams.find(t => t.id === ctx.state.selectedTeamId);
  if (!team) {
    ctx.state.selectedTeamId = config.teams[0]?.id ?? null;
    renderEditor(ctx);
    return;
  }

  const detectedId = detectCurrentTeam();
  const isActiveTeam = detectedId === team.id;
  const activePets = getActivePetInfos();

  // Header: name + status + action buttons
  const header = document.createElement('div');
  header.className = 'qpm-editor__header';

  const nameInput = document.createElement('input');
  nameInput.className = 'qpm-editor__name';
  nameInput.value = team.name;
  nameInput.placeholder = t('feature.petsWindow.teamNamePlaceholder');
  let renameTimer: number | null = null;
  nameInput.addEventListener('input', () => {
    if (renameTimer) clearTimeout(renameTimer);
    renameTimer = window.setTimeout(() => {
      renameTeam(team.id, nameInput.value);
      ctx.renderTeamList();
    }, 400);
  });
  header.appendChild(nameInput);

  const statusEl = document.createElement('span');
  statusEl.className = `qpm-editor__status ${isActiveTeam ? 'qpm-editor__status--active' : 'qpm-editor__status--inactive'}`;
  statusEl.textContent = isActiveTeam ? t('feature.petsWindow.active') : '';
  header.appendChild(statusEl);

  const applyBtn = btn(`\u25B6 ${t('feature.petsWindow.apply')}`, 'primary');
  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.textContent = `\u23F3 ${t('feature.petsWindow.applying')}`;
    try {
      const result = await applyTeam(team.id);
      if (result.errors.length === 0) showToast(t('feature.petsWindow.appliedTeam', { name: team.name }), 'success');
      else {
        const summary = result.errorSummary ? `: ${result.errorSummary}` : '';
        showToast(t('feature.petsWindow.appliedWithErrors', { name: team.name, count: String(result.errors.length), summary }), 'error');
      }
    } catch (err) {
      windowLog.warn('QPM-UI-002', { what: 'petsTeam:apply' }, err);
      showToast(t('feature.petsWindow.applyFailed'), 'error');
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = `\u25B6 ${t('feature.petsWindow.apply')}`;
      ctx.renderTeamList();
      ctx.renderEditor();
    }
  });
  header.appendChild(applyBtn);

  const snapshotBtn = btn(`\uD83D\uDCF7 ${t('feature.petsWindow.saveCurrent')}`, 'default');
  snapshotBtn.title = t('feature.petsWindow.saveCurrentTooltip');
  snapshotBtn.addEventListener('click', () => {
    saveCurrentTeamSlots(team.id);
    ctx.renderTeamList();
    ctx.renderEditor();
    showToast(t('feature.petsWindow.teamUpdated'), 'success');
  });
  header.appendChild(snapshotBtn);
  ctx.editor.appendChild(header);

  // Team summary bar (includes team score)
  const filledSlotData: { strength: number | null; targetScale: number | null; species: string; abilities: string[] }[] = [];
  for (let si = 0; si < 3; si++) {
    const slotId = team.slots[si as 0 | 1 | 2];
    if (!slotId) continue;
    const pooledPet = ctx.petPool.find(p => p.id === slotId);
    const activePetSummary = isActiveTeam ? (activePets[si] ?? null) : activePets.find(p => p.slotId === slotId) ?? null;
    const species = pooledPet?.species ?? activePetSummary?.species ?? '';
    if (species) {
      filledSlotData.push({
        strength: pooledPet?.strength ?? activePetSummary?.strength ?? null,
        targetScale: pooledPet?.targetScale ?? activePetSummary?.targetScale ?? null,
        species,
        abilities: pooledPet?.abilities ?? activePetSummary?.abilities ?? [],
      });
    }
  }
  if (filledSlotData.length > 0) {
    const teamScore = computeTeamScore(team.slots, ctx.petPool);
    ctx.editor.appendChild(renderTeamSummaryBar(filledSlotData, teamScore));
  }

  // Slot cards
  const slotsEl = document.createElement('div');
  slotsEl.className = 'qpm-slots';
  slotsEl.dataset.tour = 'mgr-slots';

  for (let i = 0; i < 3; i++) {
    const slotId = team.slots[i as 0 | 1 | 2];
    const slot = document.createElement('div');
    slot.className = 'qpm-slot';

    if (slotId) {
      const pooledPet = ctx.petPool.find(p => p.id === slotId);
      // For the active team, match by slot index (saved slotIds go stale after swaps)
      const activePet = isActiveTeam ? (activePets[i] ?? null) : activePets.find(p => p.slotId === slotId) ?? null;
      const species = pooledPet?.species ?? activePet?.species ?? '';
      const mutations = pooledPet?.mutations ?? activePet?.mutations ?? [];
      const abilities = pooledPet?.abilities ?? activePet?.abilities ?? [];

      // 1. Ability squares
      if (abilities.length > 0) {
        const abilitiesWrap = document.createElement('div');
        abilitiesWrap.className = 'qpm-slot__abilities';
        for (const abilId of abilities.slice(0, 4)) {
          const color = getAbilityColor(abilId);
          const sq = document.createElement('div');
          sq.className = 'qpm-slot__ability-sq';
          sq.style.background = color.base;
          sq.style.boxShadow = `0 0 4px ${color.glow}`;
          sq.title = getAbilityDefinition(abilId)?.name ?? abilId;
          abilitiesWrap.appendChild(sq);
        }
        slot.appendChild(abilitiesWrap);
      }

      // 2. Pet sprite
      if (species && isSpritesReady()) {
        const src = getPetSpriteDataUrlWithMutations(species, mutations);
        if (src) {
          const img = document.createElement('img');
          img.className = 'qpm-slot__sprite';
          img.src = src;
          img.alt = species;
          slot.appendChild(img);
        } else {
          const ph = document.createElement('div');
          ph.className = 'qpm-slot__sprite-placeholder';
          ph.textContent = '\uD83D\uDC3E';
          slot.appendChild(ph);
        }
      } else {
        const ph = document.createElement('div');
        ph.className = 'qpm-slot__sprite-placeholder';
        ph.textContent = '\uD83D\uDC3E';
        slot.appendChild(ph);
      }

      // 3. Pet info (species + STR)
      const info = document.createElement('div');
      info.className = 'qpm-slot__info';

      const speciesEl = document.createElement('div');
      speciesEl.className = 'qpm-slot__species';
      speciesEl.textContent = pooledPet?.name || activePet?.name || species || t('feature.petsWindow.unknownSpecies');

      const hasRainbow = mutations.some(m => m.toLowerCase().includes('rainbow'));
      const hasGold = mutations.some(m => m.toLowerCase().includes('gold'));
      if (hasRainbow) {
        const mut = document.createElement('span');
        mut.className = 'qpm-slot__mutation--rainbow';
        mut.textContent = ' \u2605 Rainbow';
        speciesEl.appendChild(mut);
      } else if (hasGold) {
        const mut = document.createElement('span');
        mut.className = 'qpm-slot__mutation--gold';
        mut.textContent = ' \u2605 Gold';
        speciesEl.appendChild(mut);
      }
      info.appendChild(speciesEl);

      const str = pooledPet?.strength ?? activePet?.strength ?? null;
      const strEl = document.createElement('div');
      strEl.className = 'qpm-slot__str';
      strEl.textContent = str != null ? `STR ${str}` : 'STR ?';
      if (str == null) strEl.style.opacity = '0.35';
      info.appendChild(strEl);

      slot.appendChild(info);

      // 4. Change / clear buttons
      const pickBtn = btn('\u21BB', 'sm');
      pickBtn.title = t('feature.petsWindow.changePet');
      pickBtn.addEventListener('click', () => {
        const usedIds = new Set((team.slots.filter((s, idx2) => s && idx2 !== i) as string[]));
        openPetPicker({
          teamId: team.id,
          usedPetIds: usedIds,
          onSelect: (petId) => {
            setTeamSlot(team.id, i as 0 | 1 | 2, petId);
            getAllPooledPets().then(pool => { ctx.petPool = pool; }).catch(() => { /* decorative refresh — score uses last-known pool until next open */ });
            ctx.renderTeamList();
            ctx.renderEditor();
          },
        });
      });
      slot.appendChild(pickBtn);

      const clearBtn = btn('\u00D7', 'sm');
      clearBtn.title = t('feature.petsWindow.clearSlot');
      clearBtn.addEventListener('click', () => {
        clearTeamSlot(team.id, i as 0 | 1 | 2);
        ctx.renderTeamList();
        ctx.renderEditor();
      });
      slot.appendChild(clearBtn);

      // 5. Hunger bar + feed controls
      if (species) {
        const hungerControls = document.createElement('div');
        hungerControls.className = 'qpm-slot__hunger-controls';

        const hungerPct = activePet?.hungerPct ?? pooledPet?.hunger ?? null;
        if (hungerPct != null) {
          const barWrap = document.createElement('div');
          barWrap.className = 'qpm-slot__hunger-bar';
          const fill = document.createElement('div');
          fill.className = 'qpm-slot__hunger-fill';
          fill.style.width = `${hungerPct}%`;
          const hungerColor = hungerPct < 30 ? '#ff6464' : hungerPct < 60 ? '#ffb464' : '#64ff96';
          fill.style.background = hungerColor;
          barWrap.appendChild(fill);
          hungerControls.appendChild(barWrap);

          const pctLabel = document.createElement('span');
          pctLabel.className = 'qpm-slot__hunger-pct';
          pctLabel.style.color = hungerColor;
          pctLabel.textContent = `${Math.round(hungerPct)}%`;
          hungerControls.appendChild(pctLabel);
        }

        // Feed button (active team only)
        if (isActiveTeam) {
          const feedBtn = document.createElement('button');
          feedBtn.className = 'qpm-slot__feed-btn';
          feedBtn.dataset.tour = 'mgr-feed';
          if (hasFloatingCardForSlot(i)) feedBtn.classList.add('qpm-slot__feed-btn--active');
          feedBtn.textContent = '\uD83C\uDF56';
          feedBtn.title = t('feature.petsWindow.feedPet');
          feedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            enqueueFeed(i);
            if (!hasFloatingCardForSlot(i)) {
              openFloatingCardForSlot(i);
              feedBtn.classList.add('qpm-slot__feed-btn--active');
            }
          });
          hungerControls.appendChild(feedBtn);
        }

        // Diet gear
        const dietBtn = document.createElement('button');
        dietBtn.className = 'qpm-slot__diet-btn';
        dietBtn.dataset.tour = 'mgr-diet';
        dietBtn.textContent = '\u2699';
        dietBtn.title = t('feature.petsWindow.dietSettings');
        dietBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openDietPopover(dietBtn, species, pooledPet?.id ?? activePet?.slotId ?? null, () => {});
        });
        hungerControls.appendChild(dietBtn);

        slot.appendChild(hungerControls);
      }

      // 6. Per-pet score (far right)
      const petScore = computePetScore(slotId, ctx.petPool);
      if (petScore) {
        const scoreWrap = document.createElement('div');
        scoreWrap.className = 'qpm-slot__score';
        const scoreLbl = document.createElement('div');
        scoreLbl.className = 'qpm-slot__score-label';
        scoreLbl.textContent = t('feature.petsWindow.score');
        const scoreVal = document.createElement('div');
        scoreVal.className = 'qpm-slot__score-value';
        scoreVal.textContent = String(Math.round(petScore.total - petScore.granterBonus));
        scoreWrap.appendChild(scoreLbl);
        scoreWrap.appendChild(scoreVal);

        if (petScore.granterBonus > 0 && petScore.granterType) {
          const granterEl = document.createElement('div');
          granterEl.className = `qpm-slot__score-granter qpm-slot__score-granter--${petScore.granterType}`;
          granterEl.textContent = `+${Math.round(petScore.granterBonus)}`;
          scoreWrap.appendChild(granterEl);
        }
        slot.appendChild(scoreWrap);
      }
    } else {
      // Empty slot
      const ph = document.createElement('div');
      ph.className = 'qpm-slot__sprite-placeholder';
      ph.textContent = '+';
      slot.appendChild(ph);

      const emptyLabel = document.createElement('div');
      emptyLabel.className = 'qpm-slot__empty';
      emptyLabel.textContent = t('feature.petsWindow.emptySlot');
      slot.appendChild(emptyLabel);

      const pickBtn = btn(t('feature.petsWindow.pickPet'), 'sm');
      pickBtn.addEventListener('click', () => {
        const usedIds = new Set((team.slots.filter((s, idx2) => s && idx2 !== i) as string[]));
        openPetPicker({
          teamId: team.id,
          usedPetIds: usedIds,
          onSelect: (petId) => {
            setTeamSlot(team.id, i as 0 | 1 | 2, petId);
            getAllPooledPets().then(pool => { ctx.petPool = pool; }).catch(() => { /* decorative refresh — score uses last-known pool until next open */ });
            ctx.renderTeamList();
            ctx.renderEditor();
          },
        });
      });
      slot.appendChild(pickBtn);
    }

    slotsEl.appendChild(slot);
  }
  ctx.editor.appendChild(slotsEl);

  // Bottom controls: keybind + delete
  const controls = document.createElement('div');
  controls.className = 'qpm-editor__controls';

  const editorDeleteBtn = btn(t('feature.petsWindow.delete'), 'danger');
  editorDeleteBtn.addEventListener('click', () => {
    editorDeleteBtn.style.display = 'none';
    const confirmRow = document.createElement('div');
    confirmRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    const confirmLabel = document.createElement('span');
    confirmLabel.style.cssText = 'font-size:12px;color:#f87171;white-space:nowrap;';
    confirmLabel.textContent = t('feature.petsWindow.deleteConfirm', { name: team.name });
    const yesBtn = btn(t('feature.petsWindow.yesDelete'), 'danger');
    const cancelConfirmBtn = btn(t('feature.petsWindow.cancel'), 'default');
    yesBtn.addEventListener('click', () => {
      deleteTeam(team.id);
      ctx.state.selectedTeamId = null;
      ctx.renderTeamList();
      ctx.renderEditor();
    });
    cancelConfirmBtn.addEventListener('click', () => {
      confirmRow.remove();
      editorDeleteBtn.style.display = '';
    });
    confirmRow.appendChild(confirmLabel);
    confirmRow.appendChild(yesBtn);
    confirmRow.appendChild(cancelConfirmBtn);
    controls.appendChild(confirmRow);
  });
  controls.appendChild(editorDeleteBtn);
  ctx.editor.appendChild(controls);

  // Keybind config
  const keybindRow = document.createElement('div');
  keybindRow.className = 'qpm-editor__keybind-row';
  keybindRow.dataset.tour = 'mgr-keybind';
  keybindRow.appendChild(Object.assign(document.createElement('span'), { textContent: t('feature.petsWindow.keybindColon') }));

  const teamId = team.id;
  const kbBtn = createKeybindButton({
    onSet(combo) {
      Object.entries(getKeybinds()).forEach(([k, id]) => { if (id === teamId) clearKeybind(k); });
      setKeybind(combo, teamId);
      ctx.renderTeamList();
    },
    onClear() {
      Object.entries(getKeybinds()).forEach(([k, id]) => { if (id === teamId) clearKeybind(k); });
      ctx.renderTeamList();
    },
    readCurrent: () => Object.entries(getKeybinds()).find(([, id]) => id === teamId)?.[0] ?? '',
  });
  keybindRow.appendChild(kbBtn);

  const kbHint = document.createElement('span');
  kbHint.style.cssText = 'color:rgba(224,224,224,0.35);font-size:11px;';
  kbHint.textContent = t('feature.petsWindow.keybindSetHint');
  keybindRow.appendChild(kbHint);
  ctx.editor.appendChild(keybindRow);
}
