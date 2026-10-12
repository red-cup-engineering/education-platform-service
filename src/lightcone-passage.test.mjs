import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLightCone, revealedTerritory, rootRooms, classifyStage } from './lightcone.mjs';
import { reviewCard } from './srs.mjs';

function room(id) {
  return { id, wingId: 'fixture', title: id, aliases: [], kind: 'term', body: '', frontmatter: {} };
}

// A -> B -> C: a linear prerequisite chain fixture graph.
const rooms = [room('a'), room('b'), room('c')];
const doors = [
  { from: 'a', to: 'b', weight: 'hard', reason: 'fixture' },
  { from: 'b', to: 'c', weight: 'hard', reason: 'fixture' },
];
const halls = [];

function cardFor(roomId, overrides = {}) {
  return { id: `${roomId}#c`, roomId, kind: 'cloze', front: 'f', back: 'b', stability: 5, difficulty: 5, ...overrides };
}

test('root rooms are rooms with zero incoming doors of any kind', () => {
  const roots = rootRooms(rooms, doors);
  assert.deepEqual([...roots], ['a']);
});

test('unreachable-until-remembered: B is unreachable before A is ever reviewed', () => {
  const cards = [cardFor('a'), cardFor('b'), cardFor('c')];
  const { reachable } = computeLightCone(rooms, doors, cards, halls, 0);
  assert.ok(reachable.has('a'));
  assert.ok(!reachable.has('b'));
  assert.ok(!reachable.has('c'));
});

test('reviewing A opens B; B still gates C until B itself is reviewed', () => {
  let a = { stability: 0, difficulty: 0 };
  a = reviewCard(a, 4, 0); // Easy, now=0 -> stability 4.5, lastReviewedAt 0
  const cards = [cardFor('a', { stability: a.stability, lastReviewedAt: a.lastReviewedAt }), cardFor('b'), cardFor('c')];

  const soonAfter = computeLightCone(rooms, doors, cards, halls, 0);
  assert.ok(soonAfter.reachable.has('a'));
  assert.ok(soonAfter.reachable.has('b'), 'B should become reachable once A is lit');
  assert.ok(!soonAfter.reachable.has('c'), 'C requires B itself to be lit, not just reachable');
});

test('forgetting A (long t) drops B and C out of the light cone, but A itself is always reachable (root)', () => {
  const cards = [cardFor('a', { stability: 1, lastReviewedAt: 0 }), cardFor('b'), cardFor('c')];
  const farLater = computeLightCone(rooms, doors, cards, halls, 1000); // t=1000 days since review, S=1 -> deeply fogged
  assert.ok(farLater.reachable.has('a'));
  assert.ok(!farLater.reachable.has('b'));
});

test('territory revealed is permanent and monotonic even after the room fogs back out of the light cone', () => {
  // A reviewed once at t=0 with low stability, then far later (t=1000) it is fogged / out of
  // the light cone -- but it must still show up as revealed territory forever.
  const cards = [cardFor('a', { stability: 1, lastReviewedAt: 0 })];
  const territory = revealedTerritory(cards);
  assert.ok(territory.has('a'));

  const { states } = computeLightCone(rooms, doors, cards, [], 1000);
  const stateA = states.get('a');
  assert.ok(stateA && stateA.gated && stateA.stage === 'fogged', 'A should be fogged (out of the light cone)');
  // ...yet revealedTerritory (derived independently from card history) is unaffected by fogging.
  assert.ok(revealedTerritory(cards).has('a'));
});

test('a room with no cards at all is reported ungated, not fogged', () => {
  const { states } = computeLightCone(rooms, doors, [], [], 0);
  const stateA = states.get('a');
  assert.deepEqual(stateA, { gated: false });
});

test('classifyStage matches the R thresholds 0.9/0.7/0.5 from DESIGN.md §2', () => {
  assert.equal(classifyStage(0.95), 'full');
  assert.equal(classifyStage(0.9), 'full');
  assert.equal(classifyStage(0.89), 'embers');
  assert.equal(classifyStage(0.7), 'embers');
  assert.equal(classifyStage(0.69), 'dim');
  assert.equal(classifyStage(0.5), 'dim');
  assert.equal(classifyStage(0.49), 'fogged');
});

test('a stable hall applies the 1.25x effective-stability bonus to dimming, without mutating stored S', () => {
  const stableHall = { id: 'h', intent: ['x'], rooms: ['a'], stable: true };
  const t = 5;
  const S = 5; // R(t=S)=0.9 exactly at the raw stability
  const cards = [cardFor('a', { stability: S, lastReviewedAt: 0 })];
  const withoutBonus = computeLightCone(rooms, doors, cards, [], t);
  const withBonus = computeLightCone(rooms, doors, cards, [stableHall], t);
  const stateNoBonus = withoutBonus.states.get('a');
  const stateBonus = withBonus.states.get('a');
  assert.ok(stateNoBonus?.gated && stateBonus?.gated);
  assert.ok((stateBonus).R > (stateNoBonus).R, 'bonus should raise effective R');
  // raw stored stability on the card itself is untouched
  assert.equal(cards[0].stability, S);
});

test('determinism: same inputs + now always produce the same light cone', () => {
  const cards = [cardFor('a', { stability: 3, lastReviewedAt: 0 }), cardFor('b')];
  const x = computeLightCone(rooms, doors, cards, halls, 10);
  const y = computeLightCone(rooms, doors, cards, halls, 10);
  assert.deepEqual([...x.reachable].sort(), [...y.reachable].sort());
  assert.deepEqual(x.states, y.states);
});
