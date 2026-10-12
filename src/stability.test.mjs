import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pebbleIndependent, loadBearing, connectedComponents, hallStability, buildHallGraph } from './stability.mjs';

test('a bare spanning tree is not load-bearing (no cycle beyond connectivity)', () => {
  // 3 nodes, 2 edges (a path): connects everything, braces nothing extra.
  assert.equal(loadBearing(3, 2, 1), false);
});

test('one edge past a spanning tree is load-bearing', () => {
  assert.equal(loadBearing(3, 3, 1), true);
});

test('pebbleIndependent: a triangle (3 nodes, 3 edges) is independent under (2,3)-counting', () => {
  assert.equal(pebbleIndependent(3, [[0, 1], [1, 2], [0, 2]]), true);
});

test('pebbleIndependent: a self-loop is never independent', () => {
  assert.equal(pebbleIndependent(2, [[0, 0]]), false);
});

test('pebbleIndependent: K4 (4 nodes, 6 edges) is dependent -- over-braced past the 2n-3=5 bound', () => {
  // K4 in the plane is the textbook minimal over-braced example: 6 edges on 4 vertices exceeds
  // the Laman bound 2*4-3=5, so at least one edge must be redundant bracing.
  const k4 = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  assert.equal(pebbleIndependent(4, k4), false);
});

test('connectedComponents: disjoint pairs count as two components', () => {
  assert.equal(connectedComponents(4, [[0, 1], [2, 3]]), 2);
});

test('connectedComponents: a chain is one component', () => {
  assert.equal(connectedComponents(4, [[0, 1], [1, 2], [2, 3]]), 1);
});

test('hallStability: fewer than 2 rooms is never stable', () => {
  assert.equal(hallStability(['a'], []), false);
});

test('hallStability: a bare chain (no cross-link) is connected but not stable', () => {
  const doors = [
    { from: 'a', to: 'b', weight: 'hard', reason: 'x' },
    { from: 'b', to: 'c', weight: 'hard', reason: 'x' },
  ];
  assert.equal(hallStability(['a', 'b', 'c'], doors), false);
});

test('hallStability: a chain plus one independent cross-link is stable', () => {
  const doors = [
    { from: 'a', to: 'b', weight: 'hard', reason: 'x' },
    { from: 'b', to: 'c', weight: 'hard', reason: 'x' },
    { from: 'a', to: 'c', weight: 'soft', reason: 'y' },
  ];
  assert.equal(hallStability(['a', 'b', 'c'], doors), true);
});

test('buildHallGraph deduplicates undirected doors and drops self-loops/out-of-hall endpoints', () => {
  const doors = [
    { from: 'a', to: 'b', weight: 'hard', reason: 'x' },
    { from: 'b', to: 'a', weight: 'soft', reason: 'dup-reverse' }, // same undirected edge
    { from: 'a', to: 'a', weight: 'hard', reason: 'self' },
    { from: 'a', to: 'zzz-outside-hall', weight: 'hard', reason: 'outside' },
  ];
  const graph = buildHallGraph(['a', 'b'], doors);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.components, 1);
});
