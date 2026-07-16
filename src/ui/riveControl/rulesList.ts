import { createToggle } from '../components/toggle';
import { createButton } from '../components/button';
import { createSectionHeader } from '../components/sectionHeader';
import { renderBySpriteKey, getPetSpriteWithMutations } from '../../sprite-v2/compat';
import { getActivePetInfos } from '../../store/pets';
import {
  getRiveRules, updateRiveRule, deleteRiveRule, onRiveRulesChanged,
  type RiveRule, type RiveRuleTarget,
} from '../../features/standalone/riveControl';

export interface RulesListOptions {
  onPick: (target: RiveRuleTarget, label: string) => void;
}

export interface RulesListHandle {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderRulesList(opts: RulesListOptions): RulesListHandle {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-3);';

  const render = (): void => {
    root.innerHTML = '';
    const rules = getRiveRules();
    root.appendChild(createSectionHeader(`Saved rules (${rules.length})`, { size: 'compact' }).root);

    if (rules.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No saved rules yet. Pick a target from the panel to create one.';
      empty.style.cssText = 'padding:var(--qpm-space-3);color:var(--qpm-text-muted);font-size:var(--qpm-font-caption);';
      root.appendChild(empty);
      return;
    }

    for (const rule of rules) {
      root.appendChild(buildRuleRow(rule, opts.onPick));
    }
  };

  const unsub = onRiveRulesChanged(render);
  render();

  return {
    element: root,
    cleanup: () => { try { unsub(); } catch { /* */ } },
  };
}

function buildRuleRow(rule: RiveRule, onPick: (target: RiveRuleTarget, label: string) => void): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex;align-items:center;gap:var(--qpm-space-3);',
    'padding:var(--qpm-space-2) var(--qpm-space-3);',
    'background:var(--qpm-surface-2);',
    'border:1px solid var(--qpm-accent-border);',
    'border-radius:var(--qpm-radius-sm);',
  ].join('');

  const thumb = renderRuleThumb(rule.target);
  if (thumb) row.appendChild(thumb);

  const toggle = createToggle({
    size: 'compact',
    checked: rule.enabled,
    onChange: (checked) => updateRiveRule({ ...rule, enabled: checked }),
  });
  row.appendChild(toggle.root);

  const meta = document.createElement('div');
  meta.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  title.textContent = rule.label || describeRuleTarget(rule.target);
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:var(--qpm-font-xs);color:var(--qpm-text-muted);';
  sub.textContent = summarizeRule(rule);
  meta.append(title, sub);
  row.appendChild(meta);

  const editBtn = createButton('Edit', {
    variant: 'ghost',
    size: 'sm',
    onClick: () => onPick(rule.target, rule.label || describeRuleTarget(rule.target)),
  });
  row.appendChild(editBtn);

  const delBtn = createButton('×', { variant: 'ghost', size: 'sm', onClick: () => deleteRiveRule(rule.id) });
  delBtn.title = 'Delete rule';
  row.appendChild(delBtn);

  return row;
}

function renderRuleThumb(target: RiveRuleTarget): HTMLElement | null {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:36px;height:36px;flex-shrink:0;background:var(--qpm-surface-3);border-radius:var(--qpm-radius-sm);display:flex;align-items:center;justify-content:center;overflow:hidden;';

  if (target.kind === 'pet') {
    const pet = getActivePetInfos().find((p) => p.petId === target.petId);
    const species = target.species ?? pet?.species;
    const sprite = species ? getPetSpriteWithMutations(species, pet?.mutations ?? []) : null;
    if (sprite) {
      const c = document.createElement('canvas');
      c.width = sprite.width;
      c.height = sprite.height;
      c.getContext('2d')?.drawImage(sprite, 0, 0);
      c.style.cssText = 'width:30px;height:30px;image-rendering:pixelated;object-fit:contain;';
      wrap.appendChild(c);
      return wrap;
    }
  } else if (target.kind === 'decorClass') {
    const sprite = renderBySpriteKey(`sprite/decor/${target.decorClass}`) as HTMLCanvasElement | null;
    if (sprite) {
      const c = document.createElement('canvas');
      c.width = sprite.width;
      c.height = sprite.height;
      c.getContext('2d')?.drawImage(sprite, 0, 0);
      c.style.cssText = 'width:30px;height:30px;image-rendering:pixelated;object-fit:contain;';
      wrap.appendChild(c);
      return wrap;
    }
  }

  // Avatar / fallback: text glyph
  const glyph = document.createElement('div');
  glyph.style.cssText = 'font-size:14px;color:var(--qpm-text-muted);';
  glyph.textContent = target.kind === 'avatar' ? '👤' : '◆';
  wrap.appendChild(glyph);
  return wrap;
}

function describeRuleTarget(target: RiveRuleTarget): string {
  switch (target.kind) {
    case 'avatar': return `Avatar (${target.playerName ?? target.playerId.slice(0, 8)})`;
    case 'pet': return `Pet (${target.species ?? 'unknown'} ${target.petId.slice(0, 8)})`;
    case 'decorClass': return `Decor: ${target.decorClass}`;
    case 'artboard': return `Artboard: ${target.artboardNameLower}`;
  }
}

function summarizeRule(rule: RiveRule): string {
  const parts: string[] = [];
  if (rule.speed !== undefined) parts.push(rule.speed === 0 ? 'frozen' : `${rule.speed.toFixed(2)}×`);
  const bools = Object.entries(rule.boolInputs ?? {});
  if (bools.length > 0) parts.push(`${bools.length} bool`);
  const nums = Object.entries(rule.numberInputs ?? {});
  if (nums.length > 0) parts.push(`${nums.length} number`);
  const imgs = Object.entries(rule.images ?? {});
  if (imgs.length > 0) parts.push(`${imgs.length} image`);
  const texts = Object.entries(rule.textRuns ?? {});
  if (texts.length > 0) parts.push(`${texts.length} text`);
  return parts.length > 0 ? parts.join(' · ') : 'no overrides';
}
