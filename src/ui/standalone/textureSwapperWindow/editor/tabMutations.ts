import { t } from '../../../../i18n';
import {
  getSvc,
  parseAtlasKey,
  addRule,
  updateRule,
  deleteRule,
  scopeKey,
  type TextureOverrideRule,
} from '../../../../features/standalone/textureSwapper';
import type { SpriteService } from '../../../../sprite-v2/types';
import type { WindowState } from '../types';
import type { ToolPanelCallbacks } from '../toolPanel';
import { MUTATION_GROUPS, MUTATION_COLORS } from '../types';
import { isMutationUnlocked } from '../gating';
import { resolveEffectiveSprite } from '../toolPanel';
import { buildMutationToggle } from './mutationChip';
import { renderRemoveRuleFooter } from './removeRuleFooter';

// Apply a new (or updated) selection to the store. Mirrors index.ts's
// `handleMutationsDone` flow but runs synchronously inside the tab so the
// user sees their click reflected immediately.
function applySelection(
  state: WindowState,
  selected: string[],
  existing: TextureOverrideRule | undefined,
): void {
  const noneOnly = selected.length === 1 && selected[0] === 'None';
  const cosmeticMutations = noneOnly ? [] : selected.filter(m => m !== 'None');
  const forceNoMutations = noneOnly;

  if (existing) {
    if (!noneOnly && cosmeticMutations.length === 0) {
      deleteRule(existing.id);
    } else {
      updateRule({ ...existing, cosmeticMutations, forceNoMutations });
    }
    return;
  }

  if (!noneOnly && cosmeticMutations.length === 0) return;

  const { category, id } = parseAtlasKey(state.selectedSpriteKey);
  const newRule: Omit<TextureOverrideRule, 'id'> = {
    enabled: true,
    targetSpriteKey: state.selectedSpriteKey,
    targetCategory: category,
    displayLabel: id,
    source: { type: 'library' },
    cosmeticMutations,
    forceNoMutations,
    params: {},
    scope: state.editorScope,
  };
  if (state.advancedSlotIndex != null) newRule.slotIndex = state.advancedSlotIndex;
  addRule(newRule);
}

export function renderTabMutations(
  container: HTMLElement,
  state: WindowState,
  rules: TextureOverrideRule[],
  callbacks: ToolPanelCallbacks,
): void {
  const initialSvc = getSvc();
  if (!initialSvc) {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:20px;font-size:12px;color:var(--qpm-text-muted);text-align:center;';
    msg.textContent = t('feature.gardenPainter.spriteNotReady');
    container.appendChild(msg);
    return;
  }
  const svc: SpriteService = initialSvc;

  const spriteKey = state.selectedSpriteKey;
  const editorSk = scopeKey(state.editorScope);
  const activeSlot = state.advancedSlotIndex;
  const matchSlot = (r: TextureOverrideRule): boolean => (r.slotIndex ?? null) === activeSlot;
  const mutRule = rules.find(r =>
    scopeKey(r.scope) === editorSk &&
    matchSlot(r) &&
    ((r.cosmeticMutations?.length ?? 0) > 0 || r.forceNoMutations === true),
  );

  // Selected list reflects the current rule's state.
  let selected: string[] = mutRule?.forceNoMutations
    ? ['None']
    : (mutRule?.cosmeticMutations?.slice() ?? []);

  const effective = resolveEffectiveSprite(spriteKey, rules);
  const effectiveSpriteKey = `sprite/${effective.category}/${effective.id}`;

  // Pre-compute unlock status for every mutation in the picker so the chip
  // render is sync. Failure (journal not loaded) fails open per gating.ts.
  const allMutations = MUTATION_GROUPS.flatMap(g => g.mutations);
  const unlockMap = new Map<string, boolean>();
  let pending = allMutations.length;

  function rerender(): void {
    container.innerHTML = '';
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    container.appendChild(body);

    for (const group of MUTATION_GROUPS) {
      const section = document.createElement('div');

      const header = document.createElement('div');
      header.style.cssText = 'font-size:9px;color:var(--qpm-text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;';
      header.textContent = t(group.label);
      section.appendChild(header);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

      for (const mutation of group.mutations) {
        const isActive = selected.includes(mutation);
        const color = MUTATION_COLORS[mutation] ?? '#8f82ff';
        const isUnlocked = unlockMap.get(mutation) ?? true;

        const toggle = buildMutationToggle(mutation, effectiveSpriteKey, svc, isActive, color, () => {
          if (mutation === 'None') {
            if (isActive) {
              selected = selected.filter(m => m !== 'None');
            } else {
              selected = ['None'];
            }
          } else {
            selected = selected.filter(m => m !== 'None');
            if (selected.includes(mutation)) {
              selected = selected.filter(m => m !== mutation);
            } else {
              selected = [...selected, mutation];
            }
          }
          const freshRule = rules.find(r =>
            scopeKey(r.scope) === editorSk &&
            matchSlot(r) &&
            ((r.cosmeticMutations?.length ?? 0) > 0 || r.forceNoMutations === true),
          );
          applySelection(state, selected, freshRule);
          callbacks.onRulesChanged();
        });

        if (!isUnlocked) {
          toggle.style.pointerEvents = 'none';
          toggle.style.opacity = '0.5';
          const labelEl = toggle.querySelector('span');
          if (labelEl instanceof HTMLElement) {
            labelEl.textContent = t('feature.gardenPainter.lockedName');
            labelEl.title = t('feature.gardenPainter.lockedJournal');
          }
        }

        row.appendChild(toggle);
      }

      section.appendChild(row);
      body.appendChild(section);
    }

    if (mutRule) {
      renderRemoveRuleFooter(container, mutRule, callbacks);
    }
  }

  for (const m of allMutations) {
    void isMutationUnlocked(spriteKey, m).then(unlocked => {
      unlockMap.set(m, unlocked);
      pending--;
      if (pending === 0) rerender();
    });
  }

  // First paint with all chips treated as unlocked while the journal lookup
  // settles (fail-open default matches gating.ts behaviour when journal is
  // null). The rerender above replaces this once all unlock checks resolve.
  rerender();
}
