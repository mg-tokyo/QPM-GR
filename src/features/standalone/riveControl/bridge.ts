import {
  onInstanceRegistered, onInstanceDestroyed, getAllInstances,
  setInputOverride, setImageOverride, setSpeedOverride, setTextOverride,
  findAllAvatarInstances,
  type RiveInstance,
} from '../../../rive-engine';
import { lookupPetIdForRive } from '../textureSwapper/petSlotRegistry';
import type { RiveRule, RiveRuleTarget } from './types';
import { getRiveRules, onRiveRulesChanged } from './store';

// ruleId → instanceId → cleanups for that pairing.
const applied = new Map<string, Map<string, Array<() => void>>>();
let engineUnsubs: Array<() => void> = [];
let started = false;

const PET_LABEL_UUID_RE = /\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i;

/**
 * Resolve the game's petId for a Rive pet instance. Verified live 2026-07-15:
 * the game labels each pet sprite as `Pet: <species> (<uuid>)` and that uuid
 * matches ActivePetInfo.petId exactly. The petSlotRegistry WeakMap is checked
 * first as belt-and-suspenders in case sprite labels drop in a future build.
 */
function resolvePetIdForInstance(inst: RiveInstance): string | null {
  if (inst.raw && typeof inst.raw === 'object') {
    const viaRegistry = lookupPetIdForRive(inst.raw as object);
    if (viaRegistry) return viaRegistry;
    const rawLabel = (inst.raw as { label?: unknown }).label;
    if (typeof rawLabel === 'string') {
      const match = rawLabel.match(PET_LABEL_UUID_RE);
      if (match) return match[1] ?? null;
    }
  }
  return null;
}

function targetMatchesInstance(target: RiveRuleTarget, inst: RiveInstance): boolean {
  switch (target.kind) {
    case 'decorClass':
      return inst.tags.includes('decor')
        && inst.artboardName.toLowerCase() === target.decorClass.toLowerCase();
    case 'pet': {
      if (!inst.tags.includes('pet')) return false;
      const petId = resolvePetIdForInstance(inst);
      return petId !== null && petId === target.petId;
    }
    case 'avatar': {
      if (!inst.tags.includes('avatar')) return false;
      for (const { instance, ownerId } of findAllAvatarInstances()) {
        if (instance.id === inst.id) return ownerId === target.playerId;
      }
      return false;
    }
    case 'artboard':
      return inst.artboardName.toLowerCase() === target.artboardNameLower;
  }
}

function applyRuleToInstance(rule: RiveRule, inst: RiveInstance): void {
  const perRule = applied.get(rule.id) ?? new Map<string, Array<() => void>>();
  if (perRule.has(inst.id)) return;
  const cleanups: Array<() => void> = [];
  const scope = { type: 'instance' as const, id: inst.id };

  if (rule.speed !== undefined) {
    cleanups.push(setSpeedOverride({ target: scope, speed: rule.speed }));
  }
  for (const [input, value] of Object.entries(rule.boolInputs ?? {})) {
    cleanups.push(setInputOverride({ target: scope, input, value, pin: true }));
  }
  for (const [input, value] of Object.entries(rule.numberInputs ?? {})) {
    cleanups.push(setInputOverride({ target: scope, input, value, pin: true }));
  }
  for (const [property, image] of Object.entries(rule.images ?? {})) {
    cleanups.push(setImageOverride({ target: scope, property, image }));
  }
  for (const [textRun, value] of Object.entries(rule.textRuns ?? {})) {
    cleanups.push(setTextOverride({ target: scope, textRun, value, pin: true }));
  }

  perRule.set(inst.id, cleanups);
  applied.set(rule.id, perRule);
}

function revertRule(ruleId: string): void {
  const perRule = applied.get(ruleId);
  if (!perRule) return;
  for (const cleanups of perRule.values()) {
    for (const fn of cleanups) {
      try { fn(); } catch { /* instance may already be gone */ }
    }
  }
  applied.delete(ruleId);
}

function revertEverything(): void {
  for (const ruleId of [...applied.keys()]) revertRule(ruleId);
}

export function reapplyAllRiveRules(): void {
  revertEverything();
  const rules = getRiveRules().filter((r) => r.enabled);
  for (const inst of getAllInstances()) {
    for (const rule of rules) {
      if (targetMatchesInstance(rule.target, inst)) applyRuleToInstance(rule, inst);
    }
  }
}

export function findInstancesForTarget(target: RiveRuleTarget): RiveInstance[] {
  const out: RiveInstance[] = [];
  for (const inst of getAllInstances()) {
    if (targetMatchesInstance(target, inst)) out.push(inst);
  }
  return out;
}

export function startRiveBridge(): () => void {
  if (started) return () => {};
  started = true;

  engineUnsubs.push(onInstanceRegistered((inst) => {
    for (const rule of getRiveRules()) {
      if (rule.enabled && targetMatchesInstance(rule.target, inst)) {
        applyRuleToInstance(rule, inst);
      }
    }
  }));
  engineUnsubs.push(onInstanceDestroyed((instanceId) => {
    for (const perRule of applied.values()) perRule.delete(instanceId);
  }));
  engineUnsubs.push(onRiveRulesChanged(() => reapplyAllRiveRules()));

  reapplyAllRiveRules();

  return () => {
    revertEverything();
    for (const fn of engineUnsubs) fn();
    engineUnsubs = [];
    started = false;
  };
}
