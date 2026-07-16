import { createSliderRow } from '../components/sliderRow';
import { createButton } from '../components/button';
import { createToggle } from '../components/toggle';
import { createSectionHeader } from '../components/sectionHeader';
import { debounce } from '../../utils/scheduling/debounce';
import {
  enumerateInputs, enumerateImageProperties, enumerateTextRuns,
  fireTrigger, onInstanceRegistered, onInstanceDestroyed,
  type InputDescriptor, type RiveInstance,
} from '../../rive-engine';
import {
  getRiveRules, addRiveRule, updateRiveRule, deleteRiveRule,
  findInstancesForTarget, onRiveRulesChanged,
  type RiveRule, type RiveRuleTarget,
} from '../../features/standalone/riveControl';
import { getCosmeticItemsSafe } from '../../utils/game/catalogHelpers';
import { SLOT_CONFIG } from '../../features/bloblingCustomiser/types';
import { renderPreviewHero } from './previewHero';

export interface RenderEditorOpts {
  target: RiveRuleTarget;
  targetLabel: string;
  onBack: () => void;
}

export interface RenderEditorResult {
  element: HTMLElement;
  cleanup: () => void;
}

interface RuleDraftShape {
  speed?: number | undefined;
  boolInputs?: Record<string, boolean>;
  numberInputs?: Record<string, number>;
  images?: Record<string, string>;
  textRuns?: Record<string, string>;
}

function ruleKeyForTarget(target: RiveRuleTarget): string {
  switch (target.kind) {
    case 'avatar': return `avatar:${target.playerId}`;
    case 'pet': return `pet:${target.petId}`;
    case 'decorClass': return `decorClass:${target.decorClass.toLowerCase()}`;
    case 'artboard': return `artboard:${target.artboardNameLower}`;
  }
}

function ruleMatchesTarget(rule: RiveRule, target: RiveRuleTarget): boolean {
  return ruleKeyForTarget(rule.target) === ruleKeyForTarget(target);
}

function ruleHasAnyOverride(rule: RuleDraftShape): boolean {
  if (rule.speed !== undefined) return true;
  if (rule.boolInputs && Object.keys(rule.boolInputs).length > 0) return true;
  if (rule.numberInputs && Object.keys(rule.numberInputs).length > 0) return true;
  if (rule.images && Object.keys(rule.images).length > 0) return true;
  if (rule.textRuns && Object.keys(rule.textRuns).length > 0) return true;
  return false;
}

function defaultLabelForTarget(target: RiveRuleTarget): string {
  switch (target.kind) {
    case 'avatar': return `Avatar (${target.playerName ?? target.playerId.slice(0, 8)})`;
    case 'pet': return `Pet (${target.species ?? target.petId.slice(0, 8)})`;
    case 'decorClass': return `Decor: ${target.decorClass}`;
    case 'artboard': return `Artboard: ${target.artboardNameLower}`;
  }
}

export function renderRiveEditor(opts: RenderEditorOpts): RenderEditorResult {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-3);font-family:var(--qpm-font);color:var(--qpm-text);';

  const cleanups: Array<() => void> = [];

  const draft: RuleDraftShape = {
    boolInputs: {},
    numberInputs: {},
    images: {},
    textRuns: {},
  };

  function findExistingRule(): RiveRule | undefined {
    return getRiveRules().find((r) => ruleMatchesTarget(r, opts.target));
  }

  const existing = findExistingRule();
  if (existing) {
    if (existing.speed !== undefined) draft.speed = existing.speed;
    Object.assign(draft.boolInputs!, existing.boolInputs ?? {});
    Object.assign(draft.numberInputs!, existing.numberInputs ?? {});
    Object.assign(draft.images!, existing.images ?? {});
    Object.assign(draft.textRuns!, existing.textRuns ?? {});
  }

  const applyDraft = (): void => {
    const current = findExistingRule();
    const nonEmpty = ruleHasAnyOverride(draft);
    if (!nonEmpty) {
      if (current) deleteRiveRule(current.id);
      return;
    }
    const next: Omit<RiveRule, 'id'> = {
      enabled: current?.enabled !== false,
      label: current?.label || defaultLabelForTarget(opts.target),
      target: opts.target,
    };
    if (draft.speed !== undefined) next.speed = draft.speed;
    if (draft.boolInputs && Object.keys(draft.boolInputs).length > 0) next.boolInputs = { ...draft.boolInputs };
    if (draft.numberInputs && Object.keys(draft.numberInputs).length > 0) next.numberInputs = { ...draft.numberInputs };
    if (draft.images && Object.keys(draft.images).length > 0) next.images = { ...draft.images };
    if (draft.textRuns && Object.keys(draft.textRuns).length > 0) next.textRuns = { ...draft.textRuns };

    if (current) updateRiveRule({ ...next, id: current.id });
    else addRiveRule(next);
  };
  const debouncedApply = debounce(applyDraft, 150);

  // Header: back + label + live-count sub
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-1);';
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:var(--qpm-space-2);';
  const backBtn = createButton('← Back', { variant: 'ghost', size: 'sm', onClick: opts.onBack });
  topRow.appendChild(backBtn);
  const title = document.createElement('div');
  title.textContent = opts.targetLabel;
  title.style.cssText = 'flex:1;font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-semibold);';
  topRow.appendChild(title);
  const liveInfo = document.createElement('div');
  liveInfo.style.cssText = 'font-size:var(--qpm-font-xs);color:var(--qpm-text-muted);white-space:nowrap;';
  topRow.appendChild(liveInfo);
  header.appendChild(topRow);
  root.appendChild(header);

  // Preview hero
  let heroCleanup: (() => void) | null = null;
  const heroSlot = document.createElement('div');
  root.appendChild(heroSlot);

  let lastHeroGlow: boolean | null = null;
  function refreshHero(): void {
    const glow = ruleHasAnyOverride(draft);
    // Skip rebuild when the only thing that could change (glow) hasn't.
    if (glow === lastHeroGlow) return;
    lastHeroGlow = glow;
    try { heroCleanup?.(); } catch { /* */ }
    heroSlot.innerHTML = '';
    const hero = renderPreviewHero(opts.target, glow);
    heroSlot.appendChild(hero.element);
    heroCleanup = hero.cleanup;
  }
  refreshHero();
  cleanups.push(() => { try { heroCleanup?.(); } catch { /* */ } });

  // Shared-scope warning for decor
  if (opts.target.kind === 'decorClass') {
    const warn = document.createElement('div');
    warn.textContent = 'Applies to every copy of this decor in the room, including other players\' gardens in view.';
    warn.style.cssText = 'padding:var(--qpm-space-2);background:var(--qpm-warning-subtle,rgba(255,183,77,0.15));color:var(--qpm-warning,#ffb74d);border-radius:var(--qpm-radius-sm);font-size:var(--qpm-font-caption);line-height:1.4;';
    root.appendChild(warn);
  }

  // Playback speed section — always shown
  root.appendChild(createSectionHeader('Playback speed', { size: 'compact' }).root);
  const speedInitial = draft.speed ?? 1;
  root.appendChild(createSliderRow({
    label: 'Speed',
    min: 0,
    max: 3,
    step: 0.05,
    value: speedInitial,
    onChange: (v) => {
      draft.speed = Math.abs(v - 1) < 0.001 ? undefined : v;
      debouncedApply();
      refreshHero();
    },
    formatFn: (v) => (v === 0 ? 'frozen' : `${v.toFixed(2)}×`),
  }));

  // Schema-derived body — rebuilt when live instance registers/destroys
  const schemaBody = document.createElement('div');
  schemaBody.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-3);';
  root.appendChild(schemaBody);

  function renderSchema(): void {
    schemaBody.innerHTML = '';
    const instances = findInstancesForTarget(opts.target);
    if (instances.length === 0) {
      liveInfo.textContent = '0 live — controls apply when target appears';
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:var(--qpm-space-3);color:var(--qpm-text-muted);font-size:var(--qpm-font-caption);text-align:center;';
      empty.textContent = 'Waiting for a live instance to enumerate inputs / images / text runs.';
      schemaBody.appendChild(empty);
      return;
    }
    liveInfo.textContent = `${instances.length} live instance${instances.length === 1 ? '' : 's'}`;

    const first = instances[0]!;
    renderTriggersSection(schemaBody, first);
    renderInputsSection(schemaBody, first);
    renderImagesSection(schemaBody, first);
    renderTextRunsSection(schemaBody, first);
  }

  // Triggers — wrapping pill row
  function renderTriggersSection(container: HTMLElement, inst: RiveInstance): void {
    const triggers = enumerateInputs(inst.id).filter((d) => d.type === 'trigger');
    if (triggers.length === 0) return;
    container.appendChild(createSectionHeader(`Triggers (${triggers.length})`, { size: 'compact' }).root);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--qpm-space-1) var(--qpm-space-2);';
    for (const desc of triggers) {
      const btn = createButton(desc.name, { variant: 'tonal', size: 'sm', pill: true, onClick: () => fireTrigger({ target: { type: 'instance', id: inst.id }, trigger: desc.name }) });
      btn.title = `Fire trigger "${desc.name}" (one-shot; not saved)`;
      wrap.appendChild(btn);
    }
    container.appendChild(wrap);
  }

  // Inputs (bool + number)
  function renderInputsSection(container: HTMLElement, inst: RiveInstance): void {
    const nonTrigger = enumerateInputs(inst.id).filter((d) => d.type !== 'trigger');
    if (nonTrigger.length === 0) return;
    container.appendChild(createSectionHeader('State-machine inputs', { size: 'compact' }).root);
    for (const desc of nonTrigger) container.appendChild(renderInputControl(desc));
  }

  function renderInputControl(desc: InputDescriptor): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:var(--qpm-space-2);';
    const label = document.createElement('div');
    label.textContent = desc.name;
    label.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text);width:110px;flex-shrink:0;';
    row.appendChild(label);

    if (desc.type === 'boolean') {
      const gameValue = typeof desc.currentValue === 'boolean' ? desc.currentValue : false;
      const initial = draft.boolInputs?.[desc.name] ?? gameValue;
      const toggle = createToggle({
        size: 'compact',
        checked: initial,
        onChange: (v) => {
          if (v === gameValue) delete draft.boolInputs![desc.name];
          else draft.boolInputs![desc.name] = v;
          debouncedApply();
          refreshHero();
        },
      });
      row.appendChild(toggle.root);
      return row;
    }

    // number
    const currentValue = typeof desc.currentValue === 'number' ? desc.currentValue : 0;
    const isIndex = Number.isInteger(currentValue) && currentValue >= 0 && currentValue <= 30;
    const min = isIndex ? 0 : -100;
    const max = isIndex ? 30 : 100;
    const step = 1;
    const value = draft.numberInputs?.[desc.name] ?? currentValue;
    const slider = createSliderRow({
      label: '',
      min,
      max,
      step,
      value,
      onChange: (v) => {
        if (v === currentValue) delete draft.numberInputs![desc.name];
        else draft.numberInputs![desc.name] = v;
        debouncedApply();
        refreshHero();
      },
      formatFn: (v) => String(v),
    });
    slider.style.flex = '1';
    row.appendChild(slider);
    return row;
  }

  // Images (URL + dropdown for avatar cosmetic slots)
  function renderImagesSection(container: HTMLElement, inst: RiveInstance): void {
    const properties = enumerateImageProperties(inst.id);
    if (properties.length === 0) return;
    container.appendChild(createSectionHeader('Images', { size: 'compact' }).root);
    for (const prop of properties) container.appendChild(renderImageRow(prop));
  }

  function renderImageRow(property: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-1);';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:var(--qpm-space-2);';
    const label = document.createElement('div');
    label.textContent = property;
    label.style.cssText = 'font-size:var(--qpm-font-caption);width:110px;flex-shrink:0;color:var(--qpm-text-muted);';
    top.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'URL or data:URI';
    input.value = draft.images?.[property] ?? '';
    input.style.cssText = 'flex:1;padding:4px 6px;background:var(--qpm-surface-3);border:1px solid var(--qpm-accent-border);border-radius:var(--qpm-radius-sm);color:var(--qpm-text);font-family:var(--qpm-font);font-size:var(--qpm-font-caption);min-width:0;';
    top.appendChild(input);

    const apply = createButton('Apply', {
      variant: 'ghost',
      size: 'sm',
      onClick: () => {
        const v = input.value.trim();
        if (v.length === 0) delete draft.images![property];
        else draft.images![property] = v;
        debouncedApply();
        refreshHero();
      },
    });
    top.appendChild(apply);
    row.appendChild(top);

    // Cosmetic dropdown only for avatar targets, only for the 3 image slots.
    if (opts.target.kind === 'avatar') {
      const slotCfg = SLOT_CONFIG.find((c) => c.riveProperty === property);
      if (slotCfg && slotCfg.type !== 'Expression') {
        const dropdownRow = document.createElement('div');
        dropdownRow.style.cssText = 'display:flex;align-items:center;gap:var(--qpm-space-2);padding-left:118px;';
        const select = document.createElement('select');
        select.style.cssText = 'flex:1;padding:3px 6px;background:var(--qpm-surface-3);border:1px solid var(--qpm-accent-border);border-radius:var(--qpm-radius-sm);color:var(--qpm-text);font-family:var(--qpm-font);font-size:var(--qpm-font-caption);min-width:0;';
        const placeholder = document.createElement('option');
        placeholder.textContent = `Pick a cosmetic for ${slotCfg.label}`;
        placeholder.value = '';
        select.appendChild(placeholder);

        const items = getCosmeticItemsSafe(slotCfg.type)
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        for (const item of items) {
          const opt = document.createElement('option');
          opt.value = item.filename;
          opt.textContent = item.displayName;
          select.appendChild(opt);
        }

        select.addEventListener('change', () => {
          if (!select.value) return;
          // Build the CDN URL synchronously; keep the plain URL field authoritative.
          const cdnUrl = resolveCosmeticUrl(select.value);
          input.value = cdnUrl;
          draft.images![property] = cdnUrl;
          debouncedApply();
          refreshHero();
        });
        dropdownRow.appendChild(select);
        row.appendChild(dropdownRow);
      }
    }

    return row;
  }

  // Text runs
  function renderTextRunsSection(container: HTMLElement, inst: RiveInstance): void {
    const runs = enumerateTextRuns(inst.id);
    if (runs.length === 0) return;
    container.appendChild(createSectionHeader('Text runs', { size: 'compact' }).root);
    for (const run of runs) container.appendChild(renderTextRunRow(run));
  }

  function renderTextRunRow(runName: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:var(--qpm-space-2);';
    const label = document.createElement('div');
    label.textContent = runName;
    label.style.cssText = 'font-size:var(--qpm-font-caption);width:110px;flex-shrink:0;color:var(--qpm-text-muted);';
    row.appendChild(label);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = draft.textRuns?.[runName] ?? '';
    input.style.cssText = 'flex:1;padding:4px 6px;background:var(--qpm-surface-3);border:1px solid var(--qpm-accent-border);border-radius:var(--qpm-radius-sm);color:var(--qpm-text);font-family:var(--qpm-font);font-size:var(--qpm-font-caption);';
    input.addEventListener('input', () => {
      const v = input.value;
      if (v.length === 0) delete draft.textRuns![runName];
      else draft.textRuns![runName] = v;
      debouncedApply();
    });
    row.appendChild(input);
    return row;
  }

  renderSchema();

  // Debounce schema rebuilds — a game WebGL context loss fires 40+ register/
  // destroy events in the same tick as the engine reinit tears down its 45
  // systems and rebuilds them. Rebuilding the DOM per event is wasteful and
  // races the WASM teardown (deleted StateMachineInstance).
  const debouncedRenderSchema = debounce(renderSchema, 200);
  cleanups.push(onInstanceRegistered(() => debouncedRenderSchema()));
  cleanups.push(onInstanceDestroyed(() => debouncedRenderSchema()));
  cleanups.push(onRiveRulesChanged(() => refreshHero()));

  // Footer
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;padding-top:var(--qpm-space-3);border-top:1px solid var(--qpm-divider,rgba(255,255,255,0.08));';
  const resetBtn = createButton('Reset target', {
    variant: 'ghost',
    size: 'sm',
    onClick: () => {
      const current = findExistingRule();
      if (current) deleteRiveRule(current.id);
      draft.speed = undefined;
      draft.boolInputs = {};
      draft.numberInputs = {};
      draft.images = {};
      draft.textRuns = {};
      opts.onBack();
    },
  });
  resetBtn.title = 'Delete the saved rule for this target';
  footer.appendChild(resetBtn);
  root.appendChild(footer);

  return {
    element: root,
    cleanup: () => {
      for (const fn of cleanups) {
        try { fn(); } catch { /* */ }
      }
    },
  };
}

function resolveCosmeticUrl(filename: string): string {
  const scripts = document.querySelectorAll('script[src*="/assets/"]');
  for (const s of scripts) {
    const src = (s as HTMLScriptElement).src;
    const idx = src.indexOf('/assets/');
    if (idx !== -1) return src.substring(0, idx) + '/assets/cosmetic/' + filename;
  }
  return '/assets/cosmetic/' + filename;
}
