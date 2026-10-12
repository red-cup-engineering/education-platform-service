import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateExercises, gradeExercise, roomGateStatus, exercisesByRoom, exerciseId,                      } from './checker.mjs';

const echoRegistry = {
  echo: (spec, answer) => ({ pass: spec === answer, diagnosis: spec === answer ? 'match' : 'no match' }),
};

test('hydrateExercises attaches the registered checker by kind', () => {
  const compiled = [{ id: exerciseId('r', 'echo', 0), roomId: 'r', kind: 'echo', spec: 'x', prompt: 'p' }];
  const { exercises, unregisteredKinds } = hydrateExercises(compiled, echoRegistry);
  assert.equal(exercises.length, 1);
  assert.equal(unregisteredKinds.length, 0);
  assert.equal(gradeExercise(exercises[0] , 'x').pass, true);
  assert.equal(gradeExercise(exercises[0] , 'y').pass, false);
});

test('hydrateExercises surfaces unregistered kinds loudly, never silently drops', () => {
  const compiled = [
    { id: exerciseId('r', 'echo', 0), roomId: 'r', kind: 'echo', spec: 'x', prompt: 'p' },
    { id: exerciseId('r', 'mystery', 0), roomId: 'r', kind: 'mystery', spec: 'x', prompt: 'p' },
  ];
  const { exercises, unregisteredKinds } = hydrateExercises(compiled, echoRegistry);
  assert.equal(exercises.length, 1);
  assert.deepEqual(unregisteredKinds, ['mystery']);
});

test('roomGateStatus: gate minimum is 1 exercise, or 2+ distinct kinds once there are 2+', () => {
  const compiled = [
    { id: exerciseId('r', 'echo', 0), roomId: 'r', kind: 'echo', spec: 'x', prompt: 'p' },
  ];
  const { exercises: one } = hydrateExercises(compiled, echoRegistry);
  assert.equal(roomGateStatus('r', one).meetsMinimum, true); // 1 exercise, 1 kind: satisfies minimum

  const twoSameKind = [
    { id: exerciseId('r', 'echo', 0), roomId: 'r', kind: 'echo', spec: 'x', prompt: 'p' },
    { id: exerciseId('r', 'echo', 1), roomId: 'r', kind: 'echo', spec: 'y', prompt: 'p' },
  ];
  const { exercises: two } = hydrateExercises(twoSameKind, echoRegistry);
  assert.equal(roomGateStatus('r', two).meetsMinimum, false); // 2 exercises, same kind: fails

  const registry2 = { ...echoRegistry, other: (s, a) => ({ pass: s === a, diagnosis: '' }) };
  const twoDiffKind = [
    { id: exerciseId('r', 'echo', 0), roomId: 'r', kind: 'echo', spec: 'x', prompt: 'p' },
    { id: exerciseId('r', 'other', 0), roomId: 'r', kind: 'other', spec: 'y', prompt: 'p' },
  ];
  const { exercises: diff } = hydrateExercises(twoDiffKind, registry2);
  assert.equal(roomGateStatus('r', diff).meetsMinimum, true);
});

test('roomGateStatus: a room with zero exercises never meets the minimum', () => {
  assert.equal(roomGateStatus('nowhere', []).meetsMinimum, false);
});

test('exercisesByRoom groups and preserves compiled order', () => {
  const compiled = [
    { id: exerciseId('r1', 'echo', 0), roomId: 'r1', kind: 'echo', spec: 'a', prompt: 'p' },
    { id: exerciseId('r2', 'echo', 0), roomId: 'r2', kind: 'echo', spec: 'b', prompt: 'p' },
    { id: exerciseId('r1', 'echo', 1), roomId: 'r1', kind: 'echo', spec: 'c', prompt: 'p' },
  ];
  const { exercises } = hydrateExercises(compiled, echoRegistry);
  const grouped = exercisesByRoom(exercises);
  assert.deepEqual(grouped.get('r1') .map((e) => e.spec), ['a', 'c']);
  assert.deepEqual(grouped.get('r2') .map((e) => e.spec), ['b']);
});

test('exerciseId follows the roomId#kind#index scheme', () => {
  assert.equal(exerciseId('unit-1/room', 'measure', 2), 'unit-1/room#measure#2');
});

test('a checker is pure: same spec/answer, same verdict, every call', () => {
  const registry = { echo: echoRegistry.echo };
  const [ex] = hydrateExercises([{ id: 'x#echo#0', roomId: 'x', kind: 'echo', spec: 42, prompt: 'p' }], registry).exercises;
  const v1 = gradeExercise(ex , 42);
  const v2 = gradeExercise(ex , 42);
  assert.deepEqual(v1, v2);
});
