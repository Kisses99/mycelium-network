/**
 * boardGen.js — Generates a single fully-connected irregular graph.
 * Node spacing is adaptive to canvas size and requested node count.
 */

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function generateBoard(canvasWidth, canvasHeight, nodeCount = 42) {
  const padding = 72;
  const usableW = canvasWidth - padding * 2;
  const usableH = canvasHeight - padding * 2;
  const minDist = Math.sqrt((usableW * usableH) / nodeCount) * 0.62;
  const maxEdgeDist = minDist * 2.9;
  const maxNeighbors = 6;

  // Poisson-disk-like node placement
  const nodes = [];
  let attempts = 0;
  while (nodes.length < nodeCount && attempts < 12000) {
    attempts++;
    const x = randBetween(padding, canvasWidth - padding);
    const y = randBetween(padding, canvasHeight - padding);
    if (nodes.every(n => dist(n, { x, y }) >= minDist)) {
      nodes.push({ id: nodes.length, x, y, r: randBetween(5, 11), owner: null });
    }
  }

  // Build edges with degree cap, sorted by distance for sparse-first wiring
  const adjacency = Array.from({ length: nodes.length }, () => []);
  const edges = [];
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = dist(nodes[i], nodes[j]);
      if (d <= maxEdgeDist) pairs.push({ i, j, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  for (const { i, j } of pairs) {
    if (adjacency[i].length < maxNeighbors && adjacency[j].length < maxNeighbors) {
      edges.push({ a: i, b: j });
      adjacency[i].push(j);
      adjacency[j].push(i);
    }
  }

  // Guarantee at least 2 neighbors for every node
  for (let i = 0; i < nodes.length; i++) {
    if (adjacency[i].length < 2) {
      const sorted = nodes
        .map((n, idx) => ({ idx, d: dist(nodes[i], n) }))
        .filter(x => x.idx !== i && !adjacency[i].includes(x.idx))
        .sort((a, b) => a.d - b.d);
      for (const { idx } of sorted) {
        if (adjacency[i].length >= 2) break;
        edges.push({ a: i, b: idx });
        adjacency[i].push(idx);
        adjacency[idx].push(i);
      }
    }
  }

  // Guarantee single connected component via BFS component merging
  ensureConnected(nodes, edges, adjacency);

  nodes.forEach((n, i) => { n.neighbors = adjacency[i]; });
  return { nodes, edges };
}

function ensureConnected(nodes, edges, adjacency) {
  const n = nodes.length;
  const comp = new Array(n).fill(-1);
  let numComps = 0;

  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const q = [s];
    comp[s] = numComps;
    while (q.length) {
      const cur = q.shift();
      for (const nid of adjacency[cur]) {
        if (comp[nid] === -1) { comp[nid] = numComps; q.push(nid); }
      }
    }
    numComps++;
  }

  if (numComps <= 1) return;

  const compMembers = Array.from({ length: numComps }, () => []);
  for (let i = 0; i < n; i++) compMembers[comp[i]].push(i);
  const main = new Set(compMembers[0]);

  for (let c = 1; c < numComps; c++) {
    let best = Infinity, bestA = -1, bestB = -1;
    for (const a of main) {
      for (const b of compMembers[c]) {
        const d = dist(nodes[a], nodes[b]);
        if (d < best) { best = d; bestA = a; bestB = b; }
      }
    }
    edges.push({ a: bestA, b: bestB });
    adjacency[bestA].push(bestB);
    adjacency[bestB].push(bestA);
    compMembers[c].forEach(id => main.add(id));
  }
}

/** Precompute Bezier control points for organic hyphae curves */
export function computeEdgeControlPoints(nodes, edges) {
  return edges.map(({ a, b }) => {
    const na = nodes[a], nb = nodes[b];
    const mx = (na.x + nb.x) / 2, my = (na.y + nb.y) / 2;
    const dx = nb.x - na.x, dy = nb.y - na.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const perp = (Math.random() - 0.5) * len * 0.28;
    return { a, b, cpx: mx + (-dy / len) * perp, cpy: my + (dx / len) * perp };
  });
}
