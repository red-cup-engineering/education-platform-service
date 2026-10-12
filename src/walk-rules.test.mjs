import assert from 'node:assert/strict';
import test from 'node:test';
import { replayPlay } from '@red-cup-engineering/gaming/running/rules';
import { vaultMazeWalkRules } from './walk-rules.mjs';

const view = {
  spawn: { x: 1.5, z: 1.5, angle: 0 }, defaultReading: 't',
  chambers: [
    { roomId: 'entry', x: 0, z: 0, size: 3 },
    { roomId: 'gate-room', x: 4, z: 0, size: 3 },
    { roomId: 'portal-room', x: 10, z: 0, size: 3 },
  ],
  cells: Array.from({ length: 7 }, (_, x) => [x, 1, 'f']).concat([[11, 1, 'f']]),
  gates: [{ x: 3, z: 1, roomId: 'gate-room', prerequisiteRoomId: 'entry' }],
  portals: [{ x: 4, z: 1, roomId: 'gate-room', to: 'portal-room', reading: 'f', target: { x: 11.5, z: 1.5 } }],
};

const moves = [
  { type: 'turn', dir: 'left' }, { type: 'turn', dir: 'right' },
  { type: 'step', dir: 'forward' },
  { type: 'answer', gate: '3,1', correct: true },
  { type: 'step', dir: 'forward' }, { type: 'step', dir: 'forward' },
  { type: 'portal' },
];

test('turns, blocksteps, a gate answer, and a portal replay to one stable position hash', () => {
  const rules = vaultMazeWalkRules(view);
  const first = replayPlay(rules, 'seed', moves, 'fixture');
  const second = replayPlay(rules, 'seed', moves, 'fixture');
  assert.equal(first.valid, true);
  assert.deepEqual(first.finalState, { x: 11.5, z: 1.5, facing: 0, room: 'portal-room', carved: ['3,1'] });
  assert.equal(first.stateHash, second.stateHash);
  assert.deepEqual(first.events, [
    { type: 'gate-carved', gate: '3,1' },
    { type: 'entered-room', roomId: 'gate-room' },
    { type: 'entered-room', roomId: 'portal-room' },
  ]);
});

test('replay stops at an illegal move and retains the last legal position', () => {
  const result = replayPlay(vaultMazeWalkRules(view), 'seed', [
    { type: 'step', dir: 'forward' }, { type: 'step', dir: 'forward' }, { type: 'turn', dir: 'right' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.finalState.x, 2.5);
});

test('blockstep never enters t or top cells', () => {
  const rules = vaultMazeWalkRules(view);
  const initial = rules.initialPosition('seed');
  const north = rules.extend(initial, { type: 'turn', dir: 'left' }).state;
  assert.throws(() => rules.extend(north, { type: 'step', dir: 'forward' }), /blocked/u);
  const contested = vaultMazeWalkRules({ ...view, cells: view.cells.map((cell) => cell[0] === 2 && cell[1] === 1 ? [2, 1, 'top'] : cell) });
  assert.throws(() => contested.extend(contested.initialPosition('seed'), { type: 'step', dir: 'forward' }), /blocked/u);
});

test('a contested portal is not a door', () => {
  const rules = vaultMazeWalkRules({ ...view, portals: [{ ...view.portals[0], x: 2, reading: 'top' }] });
  assert.throws(() => rules.extend(rules.initialPosition('seed'), { type: 'portal' }), /unavailable/u);
});
