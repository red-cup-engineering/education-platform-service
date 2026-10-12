import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { canonicalJson } from '@red-cup-engineering/json-services-section/canonical-json';
import { voxelizeWorld, chunkVoxelView } from './voxels.mjs';
import { gridFromCells } from '../../../../computer-interface-system-services-section/services/graphical-computer-interface-system-services-sections/apps/abrash/src/grid.mjs';
import { castRay } from '../../../../computer-interface-system-services-section/services/graphical-computer-interface-system-services-sections/apps/abrash/src/raycaster.mjs';

const room = (id) => ({ id });
const world = (ids, doors = [], extra = {}) => ({
  wingId: 'test-wing', rooms: ids.map(room), doors, halls: [], warnings: [], ...extra,
});
const layout = (positions) => ({ positions });

test('resolution tower chooses the coarsest stage where the requested share of rooms are alone', () => {
  const view = voxelizeWorld(world(['a', 'b', 'c']), layout({
    a: { x: 0, y: 0 }, b: { x: 1.1, y: 0 }, c: { x: 4, y: 0 },
  }), { K: 4 });
  assert.equal(view.tower.length, 3);
  assert.deepEqual(view.tower.map(({ occupied, voxelizable, alone }) => [occupied, voxelizable, alone]),
    [[2, 1, 1], [2, 1, 1], [3, 3, 3]]);
  assert.equal(view.voxelizableRatio, 0.9);
  assert.equal(view.resolution, 1);
});

test('a collision remaining at the finite bound is displaced instead of becoming top', () => {
  const view = voxelizeWorld(world(['a', 'b']), layout({ a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 } }), { K: 0 });
  assert.deepEqual(view.displaced, [{ roomId: 'b', from: [0, 0], to: [1, 0] }]);
  assert.deepEqual(view.contested, []);
  assert.ok(!view.cells.some(([, , reading]) => reading === 'top'));
});

test('one near-coincident pair among 200 rooms does not refine the whole world', () => {
  const count = 200;
  const ids = Array.from({ length: count }, (_, index) => `room-${String(index).padStart(3, '0')}`);
  const positions = Object.fromEntries(ids.map((id, index) => [id, { x: index * 10, y: 0 }]));
  const separated = voxelizeWorld(world(ids), layout(positions));
  positions[ids[1]] = { x: 0.01, y: 0 };
  const first = voxelizeWorld(world(ids), layout(positions));
  const second = voxelizeWorld(world(ids), layout(positions));
  const chamberCells = first.chambers.map(({ x, z }) => `${x},${z}`);

  assert.equal(first.resolution, separated.resolution);
  assert.deepEqual(first.displaced, [{ roomId: ids[1], from: [0, 0], to: [1, 0] }]);
  assert.equal(new Set(chamberCells).size, count);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.deepEqual(chunkVoxelView(first).index.displaced, first.displaced);
});

test('a well-separated layout displaces nobody and keeps its prior singleton resolution', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const positions = Object.fromEntries(ids.map((id, index) => [id, { x: index * 10, y: 0 }]));
  const view = voxelizeWorld(world(ids), layout(positions));
  assert.equal(view.resolution, 30 / 4);
  assert.deepEqual(view.displaced, []);
});

test('chambers are explicitly carved while absent cells retain stone as their default', () => {
  const view = voxelizeWorld(world(['a']), layout({ a: { x: 0, y: 0 } }));
  assert.equal(view.cells.filter(([, , reading]) => reading === 'f').length, 9);
  const grid = gridFromCells(view.cells, view.defaultReading);
  assert.equal(grid.at(1, 1).reading, 'f');
  assert.equal(grid.at(view.bounds.minX, view.bounds.minZ).reading, 't');
});

test('a hard door carves an x-then-z connected corridor and gates the dependent chamber', () => {
  const door = { from: 'a', to: 'b', weight: 'hard', reason: 'requires' };
  const view = voxelizeWorld(world(['a', 'b'], [door]), layout({ a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }));
  assert.deepEqual(view.gates.map(({ roomId, prerequisiteRoomId }) => [roomId, prerequisiteRoomId]), [['b', 'a']]);
  const open = new Set(view.cells.filter(([, , reading]) => reading === 'f').map(([x, z]) => `${x},${z}`));
  const gate = view.gates[0];
  assert.ok(open.has(`${gate.x},${gate.z}`));
});

test('soft-door portals are proximity ordered and capped per chamber', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const doors = ids.slice(1).map((to) => ({ from: 'a', to, weight: 'soft', reason: 'link' }));
  const halls = [{ id: 'near', rooms: ['a', 'c'], intent: [], stable: true }, { id: 'wide', rooms: ids, intent: [], stable: true }];
  const view = voxelizeWorld(world(ids, doors, { halls }), layout(Object.fromEntries(ids.map((id, index) => [id, { x: index * 10, y: 0 }]))), { portalsPerChamber: 2 });
  const portals = view.portals.filter(({ roomId, reading }) => roomId === 'a' && reading === 'f');
  assert.equal(portals.length, 2);
  assert.equal(portals[0].to, 'c');
});

test('an indistinct warning becomes a top portal carrying the reason and both witnesses', () => {
  const view = voxelizeWorld(world(['a', 'b'], [], {
    warnings: ['indistinct rooms: a ~ b (same-definition)'],
  }), layout({ a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }));
  const portal = view.portals.find(({ reading }) => reading === 'top');
  assert.deepEqual(portal.witnesses, ['a', 'b']);
  assert.equal(portal.reason, 'same-definition');
});

test('voxel projection and chunking are byte-deterministic', () => {
  const fixture = world(['a', 'b'], [{ from: 'a', to: 'b', weight: 'hard', reason: 'r' }]);
  const positions = layout({ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } });
  const first = chunkVoxelView(voxelizeWorld(fixture, positions));
  const second = chunkVoxelView(voxelizeWorld(fixture, positions));
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test('abrash walks carved cells from spawn and its ray stops on implicit stone', () => {
  const fixture = world(['a', 'b'], [{ from: 'a', to: 'b', weight: 'hard', reason: 'r' }]);
  const view = voxelizeWorld(fixture, layout({ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }));
  const grid = gridFromCells(view.cells, view.defaultReading);
  assert.equal(grid.at(Math.floor(view.spawn.x), Math.floor(view.spawn.z)).reading, 'f');
  const hit = castRay(grid, view.spawn.x, view.spawn.z, 1, 0, 128);
  assert.equal(hit.hit, true);
  assert.equal(hit.reading, 't');
});

test('measures a 558-room force-style layout with a handful of near-coincident pairs', () => {
  const count = 558;
  const ids = Array.from({ length: count }, (_, index) => `room-${String(index).padStart(3, '0')}`);
  const positions = Object.fromEntries(ids.map((id, index) => {
    const angle = index * 2.399963229728653;
    const radius = 18 * Math.sqrt(index);
    return [id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }];
  }));
  for (const index of [17, 113, 271, 419, 517]) {
    positions[ids[index]] = { x: positions[ids[index - 1]].x + 0.001, y: positions[ids[index - 1]].y + 0.001 };
  }
  const view = voxelizeWorld(world(ids), layout(positions));
  const chunkCount = chunkVoxelView(view).index.chunks.length;
  console.log(`558-room measurement: resolution=${view.resolution}, chunks=${chunkCount}, displaced=${view.displaced.length}`);
  assert.ok(chunkCount < 1_000, `expected fewer than 1,000 chunks, got ${chunkCount}`);
});

test('5,000 rooms and 10,000 hard doors voxelize within the bounded budget', () => {
  const count = 5_000;
  const ids = Array.from({ length: count }, (_, index) => `room-${String(index).padStart(5, '0')}`);
  const doors = Array.from({ length: 10_000 }, (_, index) => ({
    from: ids[index % count], to: ids[(index + 1) % count], weight: 'hard', reason: 'chain',
  }));
  const positions = Object.fromEntries(ids.map((id, index) => [id, { x: index, y: 0 }]));
  const started = performance.now();
  const view = voxelizeWorld(world(ids, doors), layout(positions));
  const elapsed = performance.now() - started;
  assert.equal(view.chambers.length, count);
  assert.ok(elapsed < 3_000, `voxelization took ${elapsed.toFixed(1)} ms`);
});
