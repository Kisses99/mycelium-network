/**
 * aiEngine.js — Heuristic AI for "Blight" player.
 *
 * Difficulty levels:
 *   easy        — 70% random, 30% light heuristics (no attack)
 *   medium-easy — 40% random, 60% full heuristics
 *   medium      — full heuristics (atari attack → defend → hub capture → degree)
 *   hard        — full heuristics, prefers highest capture count above all
 */

import { applyMove, getLegalMoves, getAtariGroups } from './rulesEngine.js';

const AI_OWNER = 'blight';
const PLAYER_OWNER = 'mycelium';

export function getAIMove(nodes, difficulty = 'medium') {
  const legal = getLegalMoves(nodes, AI_OWNER);
  if (legal.size === 0) return null;

  const arr = [...legal];
  const rnd = () => arr[Math.floor(Math.random() * arr.length)];

  if (difficulty === 'easy') {
    if (Math.random() < 0.70) return rnd();
    // Light heuristic: atari-defend only
    const ownAtari = getAtariGroups(nodes, AI_OWNER);
    for (const { liberties } of ownAtari) {
      const lib = [...liberties][0];
      if (legal.has(lib)) return lib;
    }
    return rnd();
  }

  if (difficulty === 'medium-easy' && Math.random() < 0.40) return rnd();

  // ── Full heuristic pipeline ────────────────────────────────────────────────

  // 1. Atari Attack — close the last liberty of an opponent group
  const opponentAtari = getAtariGroups(nodes, PLAYER_OWNER);
  for (const { liberties } of opponentAtari) {
    const lib = [...liberties][0];
    if (legal.has(lib)) return lib;
  }

  // 2. Atari Defend — save our own threatened group
  const ownAtari = getAtariGroups(nodes, AI_OWNER);
  for (const { liberties } of ownAtari) {
    const lib = [...liberties][0];
    if (legal.has(lib)) return lib;
  }

  // 3 & 4. Evaluate all moves by capture count then degree centrality
  let bestId = null, bestCapture = -1, bestDegree = -1;
  for (const id of legal) {
    const { captured } = applyMove(nodes, id, AI_OWNER);
    const degree = nodes[id].neighbors.length;

    // Hard: strongly prefer captures
    const captureWeight = difficulty === 'hard' ? captured.length * 3 : captured.length;
    const score = captureWeight * 100 + degree;

    if (score > bestCapture * 100 + bestDegree) {
      bestCapture = captured.length;
      bestDegree = degree;
      bestId = id;
    }
  }

  return bestId;
}
