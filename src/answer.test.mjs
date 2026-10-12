import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeResponse } from './answer.mjs';

const choiceCard = {
  roomId: 'a',
  choices: [{ label: 'Alpha', roomId: 'a' }, { label: 'Beta', roomId: 'b' }],
};

test('gradeResponse derives Good for a right choice and Again for a wrong choice', () => {
  assert.deepEqual(gradeResponse(choiceCard, { roomId: 'a' }), { correct: true, grade: 3, expected: 'Alpha' });
  assert.deepEqual(gradeResponse(choiceCard, { roomId: 'b' }), { correct: false, grade: 1, expected: 'Alpha', chosenRoomId: 'b' });
});

test('gradeResponse normalizes diacritics and assigns Hard only to a one-edit near miss', () => {
  const card = { accepts: ['café society'] };
  assert.deepEqual(gradeResponse(card, { text: '  CAFÉ, SOCIETY! ' }), { correct: true, grade: 3, expected: 'café society' });
  assert.deepEqual(gradeResponse(card, { text: 'cafe societ' }), { correct: false, grade: 2, expected: 'café society' });
  assert.deepEqual(gradeResponse(card, { text: 'coffee' }), { correct: false, grade: 1, expected: 'café society' });
});

test('gradeResponse refuses cards whose grade still belongs to the reader', () => {
  assert.throws(() => gradeResponse({}, { text: 'anything' }), TypeError);
});
