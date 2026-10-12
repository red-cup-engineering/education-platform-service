import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pebbleIndependent,
  lamanCount,
  meanCoordination,
  loadBearing,
  connectedComponents,
  hallStability,
} from './stability.mjs';

function doorsFromEdges(edges) {
  return edges.map(([from, to]) => ({ from, to, weight: 'hard', reason: 'fixture' }));
}

test('triangle (3 nodes, 3 edges) is minimally rigid — pebbleIndependent true', () => {
  assert.equal(pebbleIndependent(3, [[0, 1], [1, 2], [2, 0]]), true);
});

test('a bare spanning tree (no cycle) is independent but not load-bearing', () => {
  // path graph 0-1-2-3: 4 nodes, 3 edges, 1 component
  const edges = [[0, 1], [1, 2], [2, 3]];
  assert.equal(pebbleIndependent(4, edges), true);
  assert.equal(loadBearing(4, edges.length, 1), false);
});

test('a 4-cycle plus a diagonal (4 nodes, 5 edges) is over-braced — pebbleIndependent false', () => {
  // K4 minus one edge: 0-1,1-2,2-3,3-0,0-2,1-3 would be K4 (6 edges on 4 nodes, way over 2n-3=5)
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]];
  assert.equal(pebbleIndependent(4, edges), false);
});

test('double-banana graph: lamanCount passes but pebbleIndependent correctly rejects it', () => {
  // Two "bananas" (each a K5-minus-one-edge rigid cluster on 5 nodes, 9 edges) sharing a single
  // hinge edge between them — the canonical rigidity-matroid counterexample the design doc's
  // own doctrine names: locally over-braced within each cluster, globally under-braced across
  // the hinge. 8 vertices total (nodes 0-3 + hinge pair {4,5} shared... construct directly:
  // banana A on {0,1,2,3,4}, banana B on {3,4,5,6,7}, sharing the hinge pair (3,4).
  const bananaEdges = (nodes) => {
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        out.push([nodes[i], nodes[j]]);
      }
    }
    return out; // K5 on 5 nodes = 10 edges
  };
  const bananaA = bananaEdges([0, 1, 2, 3, 4]).filter(([u, v]) => !(u === 3 && v === 4)); // K5 minus {3,4}: 9 edges
  const bananaB = bananaEdges([3, 4, 5, 6, 7]).filter(([u, v]) => !(u === 3 && v === 4)); // 9 edges
  const hinge = [[3, 4]];
  const edges = [...bananaA, ...bananaB, ...hinge];
  const nodes = 8;

  assert.equal(edges.length, 19);
  assert.equal(lamanCount(nodes, edges.length), true, 'naive edge-count prefilter passes (>= 2*8-3=13)');
  assert.equal(pebbleIndependent(nodes, edges), false, 'the real pebble-game check must reject the double banana');
});

test('meanCoordination is 2E/N and matches the Phillips-Thorpe isostatic reference point', () => {
  assert.equal(meanCoordination(0, 0), 0);
  assert.equal(meanCoordination(10, 12), 2.4);
});

test('connectedComponents counts correctly on a disconnected graph', () => {
  // {0,1,2} connected, {3,4} connected, {5} isolated
  const edges = [[0, 1], [1, 2], [3, 4]];
  assert.equal(connectedComponents(6, edges), 3);
});

test('hallStability: connected + cycle + pebble-independent => stable (triangle of rooms)', () => {
  const rooms = ['a', 'b', 'c'];
  const doors = doorsFromEdges([['a', 'b'], ['b', 'c'], ['c', 'a']]);
  assert.equal(hallStability(rooms, doors), true);
});

test('hallStability: bare chain (spanning tree only) => not stable, no cross-link', () => {
  const rooms = ['a', 'b', 'c'];
  const doors = doorsFromEdges([['a', 'b'], ['b', 'c']]);
  assert.equal(hallStability(rooms, doors), false);
});

test('hallStability: disconnected hall => not stable regardless of local bracing', () => {
  const rooms = ['a', 'b', 'c', 'd'];
  const doors = doorsFromEdges([['a', 'b'], ['c', 'd']]);
  assert.equal(hallStability(rooms, doors), false);
});

test('hallStability: over-braced (redundant) cross-link => not stable (pebble game catches it)', () => {
  // K4 on 4 rooms: 6 edges, well past rigid (2*4-3=5), and the extra edge is redundant bracing.
  const rooms = ['a', 'b', 'c', 'd'];
  const doors = doorsFromEdges([
    ['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['a', 'c'], ['b', 'd'],
  ]);
  assert.equal(hallStability(rooms, doors), false);
});

test('hallStability deduplicates a door and its reverse as one undirected edge', () => {
  const rooms = ['a', 'b', 'c'];
  const doors = [
    ...doorsFromEdges([['a', 'b'], ['b', 'c'], ['c', 'a']]),
    { from: 'b', to: 'a', weight: 'soft', reason: 'reverse of a->b, should not double the edge count' },
  ];
  // Still exactly 3 undirected edges on 3 nodes -> still the minimally-rigid triangle -> stable.
  assert.equal(hallStability(rooms, doors), true);
});
