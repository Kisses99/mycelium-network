/**
 * rulesEngine.js — Go-variant logic over an irregular graph.
 *
 * Terminology:
 *   Group   — a connected set of nodes sharing the same owner.
 *   Liberty — an empty node adjacent to any member of the group.
 *
 * Rules enforced:
 *   1. A stone may not be placed on an occupied node.
 *   2. Suicide is forbidden unless the move captures at least one opponent group.
 *   3. After placement, all opponent groups with 0 liberties are captured (removed).
 *   4. Ko is not tracked in this implementation (graph irregularity makes it rare).
 */

/** BFS flood-fill: returns { members: Set<id>, liberties: Set<id> } for the group containing nodeId */
function getGroup(nodes, startId) {
  const owner = nodes[startId].owner;
  const members = new Set();
  const liberties = new Set();
  const queue = [startId];
  members.add(startId);

  while (queue.length) {
    const current = queue.shift();
    for (const nid of nodes[current].neighbors) {
      if (nodes[nid].owner === owner && !members.has(nid)) {
        members.add(nid);
        queue.push(nid);
      } else if (nodes[nid].owner === null) {
        liberties.add(nid);
      }
    }
  }
  return { members, liberties };
}

/** Returns all distinct groups for a given owner */
function getAllGroups(nodes, owner) {
  const visited = new Set();
  const groups = [];
  for (const node of nodes) {
    if (node.owner === owner && !visited.has(node.id)) {
      const group = getGroup(nodes, node.id);
      group.members.forEach((id) => visited.add(id));
      groups.push(group);
    }
  }
  return groups;
}

/**
 * Attempt to place `owner` at `nodeId`.
 * Returns { ok, captured, nodes } where `nodes` is the mutated copy on success.
 */
export function applyMove(nodes, nodeId, owner) {
  if (nodes[nodeId].owner !== null) return { ok: false, captured: [] };

  const opponent = owner === 'mycelium' ? 'blight' : 'mycelium';

  // Deep copy
  const next = nodes.map((n) => ({ ...n, neighbors: n.neighbors }));
  next[nodeId] = { ...next[nodeId], owner };

  // Capture opponent groups that lost all liberties
  const captured = [];
  const opponentGroups = getAllGroups(next, opponent);
  for (const { members, liberties } of opponentGroups) {
    if (liberties.size === 0) {
      for (const id of members) {
        next[id] = { ...next[id], owner: null };
        captured.push(id);
      }
    }
  }

  // Check suicide: after captures, our new group must have at least 1 liberty
  const { liberties: ownLiberties } = getGroup(next, nodeId);
  if (ownLiberties.size === 0 && captured.length === 0) {
    return { ok: false, captured: [] }; // suicide forbidden
  }

  return { ok: true, captured, nodes: next };
}

/** Returns a Set of node IDs that are legal moves for `owner` on current board */
export function getLegalMoves(nodes, owner) {
  const legal = new Set();
  for (const node of nodes) {
    if (node.owner !== null) continue;
    const { ok } = applyMove(nodes, node.id, owner);
    if (ok) legal.add(node.id);
  }
  return legal;
}

/** Count owned nodes per player */
export function getScores(nodes) {
  let mycelium = 0;
  let blight = 0;
  for (const n of nodes) {
    if (n.owner === 'mycelium') mycelium++;
    else if (n.owner === 'blight') blight++;
  }
  return { mycelium, blight };
}

/** Returns atari-threatened groups for given owner (groups with exactly 1 liberty) */
export function getAtariGroups(nodes, owner) {
  return getAllGroups(nodes, owner).filter((g) => g.liberties.size === 1);
}

export { getGroup, getAllGroups };
