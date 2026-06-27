import { t } from '../../../../i18n';
import { getTextureSwapperState } from '../../../../features/standalone/textureSwapper';
import type { RuleScope } from '../../../../features/standalone/textureSwapper/types';

export function renderScopeChip(opts: {
  targetSpriteKey: string;
  currentScope: RuleScope;
  onSwitchScope: (newScope: RuleScope) => void;
  onCreateNewScope: () => void;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px;';

  const label = document.createElement('span');
  label.style.cssText = 'opacity:0.6;';
  label.textContent = t('feature.gardenPainter.editor.scopeLabel');

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.style.cssText = 'padding:4px 12px;border-radius:9999px;background:rgba(143,130,255,0.18);color:#fff;border:none;cursor:pointer;font-family:var(--qpm-font);font-size:12px;';
  chip.textContent = describeScope(opts.currentScope);
  chip.addEventListener('click', () => openPopover(chip, opts));

  wrap.appendChild(label);
  wrap.appendChild(chip);
  return wrap;
}

function describeScope(scope: RuleScope): string {
  if (scope.kind === 'all') return t('feature.gardenPainter.editor.scopeAll');
  if (scope.kind === 'tile') return t('feature.gardenPainter.editor.scopeTile', { tileKey: scope.tileKey, species: scope.species });
  return t('feature.gardenPainter.editor.scopePetSlot', { slotIndex: String(scope.slotIndex), species: scope.species });
}

function openPopover(anchor: HTMLElement, opts: {
  targetSpriteKey: string;
  currentScope: RuleScope;
  onSwitchScope: (newScope: RuleScope) => void;
  onCreateNewScope: () => void;
}): void {
  document.querySelectorAll('.gp-scope-popover').forEach(p => p.remove());

  const pop = document.createElement('div');
  pop.className = 'gp-scope-popover';
  pop.style.cssText = 'position:fixed;background:var(--qpm-surface-2);border:1px solid rgba(143,130,255,0.4);border-radius:var(--qpm-radius-md);padding:6px;display:flex;flex-direction:column;gap:4px;z-index:10002;min-width:200px;';

  const rect = anchor.getBoundingClientRect();
  pop.style.left = `${rect.left}px`;
  pop.style.top = `${rect.bottom + 4}px`;

  const rules = getTextureSwapperState().rules.filter(r => r.targetSpriteKey === opts.targetSpriteKey);
  const scopes: RuleScope[] = [{ kind: 'all' }];
  for (const r of rules) {
    const sc = r.scope ?? { kind: 'all' };
    if (sc.kind !== 'all' && !scopes.some(s => sameScope(s, sc))) scopes.push(sc);
  }

  for (const sc of scopes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'padding:4px 8px;text-align:left;border:none;background:rgba(255,255,255,0.04);color:var(--qpm-text);border-radius:var(--qpm-radius-sm);cursor:pointer;font-family:var(--qpm-font);font-size:12px;';
    if (sameScope(sc, opts.currentScope)) {
      btn.style.background = 'rgba(143,130,255,0.2)';
    }
    btn.textContent = describeScope(sc);
    btn.addEventListener('click', () => { pop.remove(); opts.onSwitchScope(sc); });
    pop.appendChild(btn);
  }

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.style.cssText = 'padding:4px 8px;text-align:left;border:none;background:rgba(100,200,255,0.15);color:#bde6ff;border-radius:var(--qpm-radius-sm);cursor:pointer;font-family:var(--qpm-font);font-size:12px;';
  newBtn.textContent = t('feature.gardenPainter.editor.scopePopoverNew');
  newBtn.addEventListener('click', () => { pop.remove(); opts.onCreateNewScope(); });
  pop.appendChild(newBtn);

  document.body.appendChild(pop);

  const dismiss = (e: MouseEvent): void => {
    if (e.target instanceof Node && !pop.contains(e.target)) {
      pop.remove();
      document.removeEventListener('click', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

function sameScope(a: RuleScope, b: RuleScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'all') return true;
  if (a.kind === 'tile' && b.kind === 'tile') return a.tileKey === b.tileKey && a.species === b.species;
  if (a.kind === 'petSlot' && b.kind === 'petSlot') return a.slotIndex === b.slotIndex && a.species === b.species;
  return false;
}
