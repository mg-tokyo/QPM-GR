import { getEffectiveStats } from './tower';
import { getMatchSnapshot, registerPhaseTransitionHook, setProjectiles } from '../state';

// Pinecone Grove piles are stationary Projectiles marked isPathDrop.
// Clear them when the round ends unless T4A Perma-Spikes flipped
// persistBetweenRounds on the owner. Owner-lookup avoids duplicating
// the flag onto every projectile.
registerPhaseTransitionHook((prev, next) => {
  if (prev !== 'inRound' || next === 'inRound') return;
  const snap = getMatchSnapshot();
  if (snap.projectiles.length === 0) return;
  const surviving = snap.projectiles.filter((p) => {
    if (!p.isPathDrop) return true;
    const owner = snap.towers.find((t) => t.id === p.ownerId);
    if (!owner) return false;
    return getEffectiveStats(owner).persistBetweenRounds === true;
  });
  if (surviving.length !== snap.projectiles.length) setProjectiles(surviving);
});
