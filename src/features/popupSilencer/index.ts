import { atomObjectFor, readSync, subscribe } from '../../core/gameState';
import { getAbilityName } from '../../utils/game/catalogHelpers';
import { createAtomWriteInterceptor, type InterceptorState } from '../../utils/game/atomWriteInterceptor';
import { silenceUpdate, type DropKind, type SilenceRules } from './filter';
import { getPopupSilencerSettings } from './settings';

export {
  getPopupSilencerSettings,
  setAbilitySilenced,
  setLevelUpsSilenced,
  setSilencedAbilities,
} from './settings';
export type { PopupSilencerSettings } from './settings';

const interceptor = createAtomWriteInterceptor('popupSilencer.toasts');
const cleanups: Array<() => void> = [];
let started = false;
const drops: Record<DropKind, number> = { ability: 0, levelUp: 0 };
let lastDropAt: number | null = null;

function currentRules(): SilenceRules | null {
  const s = getPopupSilencerSettings();
  if (!s.levelUps && s.abilities.length === 0) return null;
  return { abilityNames: new Set(s.abilities.map(getAbilityName)), levelUps: s.levelUps };
}

function onDrop(kind: DropKind): void {
  drops[kind] += 1;
  lastDropAt = Date.now();
}

function transform(update: unknown, readPrev: () => unknown): unknown {
  try {
    const rules = currentRules();
    return rules ? silenceUpdate(update, readPrev, rules, onDrop) : update;
  } catch {
    return update;
  }
}

function tryInstall(): boolean {
  // A read binds the usable rung, so atomObjectFor returns the label atom when the room-scope rung is absent.
  readSync('quinoaToasts');
  return interceptor.install(atomObjectFor('quinoaToasts'), transform);
}

// Room handoffs swap the scope that holds the toast atom; another mod's uninstall can restore a stale write.
function check(): void {
  const atom = atomObjectFor('quinoaToasts');
  if (interceptor.state() === 'absent' || !interceptor.isTarget(atom)) tryInstall();
  else interceptor.ensure();
}

export function startPopupSilencer(): void {
  if (started) return;
  started = true;
  tryInstall();
  cleanups.push(subscribe('roomScopeId', check), subscribe('quinoaToasts', check));
}

export function stopPopupSilencer(): void {
  if (!started) return;
  started = false;
  for (const off of cleanups.splice(0)) {
    try { off(); } catch { /* ignore */ }
  }
  interceptor.uninstall();
}

export function getPopupSilencerDiagnostics(): {
  state: InterceptorState;
  drops: Record<DropKind, number>;
  lastDropAt: number | null;
  silencedAbilities: number;
  levelUps: boolean;
} {
  const s = getPopupSilencerSettings();
  return { state: interceptor.state(), drops: { ...drops }, lastDropAt, silencedAbilities: s.abilities.length, levelUps: s.levelUps };
}
