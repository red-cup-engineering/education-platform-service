import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rootRooms, revealedTerritory, roomLightStates, computeLightCone, classifyStage } from './lightcone.mjs';

function room(id) {
  return { id, wingId: 'w', title: id, aliases: [], kind: 'lesson', body: '', frontmatter: {} };
}

test('classifyStage boundaries match STAGE_CUTS exactly', () => {
  assert.equal(classifyStage(0.95), 'full');
  assert.equal(classifyStage(0.9), 'full');
  assert.equal(classifyStage(0.89), 'embers');
  assert.equal(classifyStage(0.7), 'embers');
  assert.equal(classifyStage(0.69), 'dim');
  assert.equal(classifyStage(0.5), 'dim');
  assert.equal(classifyStage(0.49), 'fogged');
});

test('rootRooms: rooms with zero incoming doors are always-open entry points', () => {
  const rooms = [room('a'), room('b'), room('c')];
  const doors = [{ from: 'a', to: 'b', weight: 'hard', reason: 'x' }];
  const roots = rootRooms(rooms, doors);
  assert.ok(roots.has('a'));
  assert.ok(roots.has('c')); // no door at all
  assert.ok(!roots.has('b'));
});

test('revealedTerritory is monotonic: only reviewed exercises count, never un-marked', () => {
  const revealed = revealedTerritory([
    { roomId: 'a', stability: 1, lastReviewedAt: 5 },
    { roomId: 'b', stability: 1 }, // never reviewed
  ]);
  assert.deepEqual([...revealed], ['a']);
});

test('roomLightStates: an un-gated room reports gated:false, not R=0', () => {
  const rooms = [room('a')];
  const states = roomLightStates(rooms, [], [], 100);
  assert.deepEqual(states.get('a'), { gated: false });
});

test('roomLightStates: a room is only as lit as its weakest exercise (min R, not mean)', () => {
  const rooms = [room('a')];
  const exercises = [
    { roomId: 'a', stability: 1000, lastReviewedAt: 0 }, // strong
    { roomId: 'a', stability: 0.001, lastReviewedAt: 0 }, // very weak
  ];
  const states = roomLightStates(rooms, exercises, [], 5);
  const st = states.get('a');
  assert.ok(st?.gated);
  if (st?.gated) assert.ok(st.R < 0.5, `expected weak min R, got ${st.R}`);
});

test('roomLightStates: a stable hall boosts effective stability (dims more slowly)', () => {
  const rooms = [room('a')];
  const exercises = [{ roomId: 'a', stability: 5, lastReviewedAt: 0 }];
  const halls = [{ id: 'h', intent: [], rooms: ['a'], stable: true }];
  const now = 5;
  const boosted = roomLightStates(rooms, exercises, halls, now).get('a');
  const unboosted = roomLightStates(rooms, exercises, [], now).get('a');
  assert.ok(boosted?.gated && unboosted?.gated);
  if (boosted?.gated && unboosted?.gated) assert.ok(boosted.R > unboosted.R);
});

test('computeLightCone: frontier expands from full/embers rooms, stalls behind dim/fogged', () => {
  const rooms = [room('a'), room('b'), room('c')];
  const doors = [
    { from: 'a', to: 'b', weight: 'hard', reason: 'x' },
    { from: 'b', to: 'c', weight: 'hard', reason: 'x' },
  ];
  // 'a' is a root (always reachable). 'a' reviewed long enough ago at low stability -> fogged,
  // so 'b' should NOT be reachable, and 'c' (behind 'b') should not either.
  const exercises = [{ roomId: 'a', stability: 0.01, lastReviewedAt: 0 }];
  const cone = computeLightCone(rooms, doors, exercises, [], 1000);
  assert.ok(cone.reachable.has('a'));
  assert.ok(!cone.reachable.has('b'));
  assert.ok(!cone.reachable.has('c'));
});
