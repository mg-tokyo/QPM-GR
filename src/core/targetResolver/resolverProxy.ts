import { getProbeRuntime } from '../../debug/universalProbe/runtime';
import { buildSceneIndex } from '../../debug/universalProbe/sceneIndex';
import { buildDomIndex, isDomInteractive } from '../../debug/universalProbe/domIndex';
import { resolveTarget } from './resolver';
import { TARGET_RECIPES } from './recipes';

/**
 * Chrome devtools autocomplete reads properties directly from objects via
 * Runtime.getProperties — it does NOT call Proxy ownKeys/get traps.
 * All properties must exist as real own properties (getters) on plain objects.
 *
 * For dynamic branches (pet, plant, building, avatar, button), a $scan()
 * method rescans the live scene and defines getter properties for each
 * discovered entity so they appear in autocomplete on the next Tab press.
 */

interface DynamicBranchConfig {
  recipe: string;
  regex: RegExp;
  paramKey: 'label' | 'text';
  source: 'pixi' | 'dom';
}

const DYNAMIC_BRANCHES: Record<string, DynamicBranchConfig> = {
  pet:      { recipe: 'pet.byName',      regex: /^Pet: (.+)/,            paramKey: 'label', source: 'pixi' },
  plant:    { recipe: 'plant.byName',     regex: /(.+) PlantBody$/,       paramKey: 'label', source: 'pixi' },
  building: { recipe: 'building.byId',    regex: /^Building \((\d+)\)/,   paramKey: 'label', source: 'pixi' },
  avatar:   { recipe: 'avatar.byId',      regex: /^AvatarContainer (.+)/, paramKey: 'label', source: 'pixi' },
  button:   { recipe: 'button.byText',    regex: /.+/,                    paramKey: 'text',  source: 'dom' },
};

function toPropertyName(raw: string): string {
  return raw.replace(/\s+/g, '_').replace(/[^\w$]/g, '_');
}

function fromPropertyName(prop: string): string {
  return prop.replace(/_/g, ' ');
}

function scanLiveLabels(config: DynamicBranchConfig): string[] {
  const labels = new Set<string>();
  const runtime = getProbeRuntime();
  if (!runtime.ready) return [];

  if (config.source === 'pixi') {
    const scene = buildSceneIndex(runtime);
    for (const node of scene.nodes) {
      const match = config.regex.exec(node.label);
      if (match?.[1]) {
        labels.add(toPropertyName(match[1]));
      }
    }
  } else {
    const entries = buildDomIndex(2000);
    for (const entry of entries) {
      if (!isDomInteractive(entry.element)) continue;
      const label = entry.label;
      if (label && config.regex.test(label)) {
        labels.add(toPropertyName(label));
      }
    }
  }

  return Array.from(labels);
}

/** Remove all dynamic (non-static) getter properties from an object. */
function clearDynamicKeys(obj: Record<string, unknown>, staticKeys: Set<string>): void {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!staticKeys.has(key)) {
      delete obj[key];
    }
  }
}

function buildBranch(branchName: string, subRecipeNames: string[]): Record<string, unknown> {
  const dynamicConfig = DYNAMIC_BRANCHES[branchName];
  const obj = Object.create(null) as Record<string, unknown>;

  // Define static sub-recipe getters
  const staticKeys = new Set(subRecipeNames);
  for (const sub of subRecipeNames) {
    const fullId = `${branchName}.${sub}`;
    Object.defineProperty(obj, sub, {
      get() { return resolveTarget(fullId); },
      configurable: true,
      enumerable: true,
    });
  }

  if (dynamicConfig) {
    // $scan() — scans the live scene and populates entity properties
    // so they show up in Chrome autocomplete on next Tab press.
    staticKeys.add('$scan');
    Object.defineProperty(obj, '$scan', {
      value: function $scan(): string[] {
        clearDynamicKeys(obj, staticKeys);
        const labels = scanLiveLabels(dynamicConfig);
        for (const label of labels) {
          const decoded = fromPropertyName(label);
          Object.defineProperty(obj, label, {
            get() { return resolveTarget(dynamicConfig.recipe, { [dynamicConfig.paramKey]: decoded }); },
            configurable: true,
            enumerable: true,
          });
        }
        return labels;
      },
      configurable: true,
      enumerable: false, // keep $scan out of autocomplete clutter
    });

    // Auto-scan on first construction if runtime is ready
    const runtime = getProbeRuntime();
    if (runtime.ready) {
      (obj.$scan as () => string[])();
    }
  }

  return obj;
}

/**
 * Build an object tree that provides Chrome console autocomplete for all
 * target recipes and live entity names from the current scene.
 *
 * Usage:
 *   probe.r.pet.        → Tab shows static recipes (any, byName, slots, ...)
 *   probe.r.pet.$scan() → scans scene, adds live pet names as properties
 *   probe.r.pet.        → Tab now also shows Butterfly, Lily, etc.
 *   probe.r.pet.Butterfly → resolves + tracks that pet
 */
export function buildResolverProxy(): Record<string, unknown> {
  const groups = new Map<string, string[]>();
  for (const recipe of TARGET_RECIPES) {
    const dot = recipe.id.indexOf('.');
    if (dot < 0) continue;
    const branch = recipe.id.slice(0, dot);
    const sub = recipe.id.slice(dot + 1);
    if (!groups.has(branch)) groups.set(branch, []);
    groups.get(branch)!.push(sub);
  }

  const root = Object.create(null) as Record<string, unknown>;

  for (const [branchName, subs] of groups) {
    root[branchName] = buildBranch(branchName, subs);
  }

  // $scan() on root — scans all dynamic branches at once
  Object.defineProperty(root, '$scan', {
    value: function $scan(): Record<string, string[]> {
      const results: Record<string, string[]> = {};
      for (const [branchName] of groups) {
        const branch = root[branchName] as Record<string, unknown>;
        if (typeof branch.$scan === 'function') {
          results[branchName] = (branch.$scan as () => string[])();
        }
      }
      return results;
    },
    configurable: true,
    enumerable: false,
  });

  return root;
}
