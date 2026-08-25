import { getEffectiveStats } from './tower';
import { getMatchSnapshot, registerPhaseTransitionHook, setProjectiles } from '../state';

// Round-end projectile cleanup: in-flight projectiles freeze visually in
// preRound (sim loop is inRound-gated), so drop them. Pinecone Grove piles
// (isPathDrop) are dropped too unless T4A Perma-Spikes flipped
// persistBetweenRounds on the owner. Owner-lookup avoids duplicating the
// flag onto every projectile.
registerPhaseTransitionHook((prev, next) => {
  if (prev !== 'inRound' || next === 'inRound') return;
  const snap = getMatchSnapshot();
  if (snap.projectiles.length === 0) return;
  const surviving = snap.projectiles.filter((p) => {
    if (!p.isPathDrop) return false;
    const owner = snap.towers.find((t) => t.id === p.ownerId);
    if (!owner) return false;
    return getEffectiveStats(owner).persistBetweenRounds === true;
  });
  if (surviving.length !== snap.projectiles.length) setProjectiles(surviving);
});
