/**
 * Tests for `../src/record.mts` -- the bridge from `CardState` to the `data/state/` dated
 * review-record convention (per-card due/interval/ease/stability; see that module's header for
 * the exact field mapping, including why "ease" is stored honestly as `difficulty`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDatedReviewRecord, epochDayToISODate } from './srs-record.mjs';
import { reviewCard, epochDayOf } from './srs.mjs';

test('epochDayToISODate renders epoch day 0 as the Unix epoch date', () => {
  assert.equal(epochDayToISODate(0), '1970-01-01');
});

test('epochDayToISODate round-trips with epochDayOf for a whole-day timestamp', () => {
  const ms = Date.UTC(2026, 7, 20); // 2026-08-20, UTC midnight
  const day = epochDayOf(ms);
  assert.equal(epochDayToISODate(day), '2026-08-20');
});

test('toDatedReviewRecord carries recordType, cardId, and grade through unchanged', () => {
  const prior = { stability: 0, difficulty: 5 };
  const record = toDatedReviewRecord('hsk1-shi4', prior, 3, 0);
  assert.equal(record.recordType, 'review');
  assert.equal(record.cardId, 'hsk1-shi4');
  assert.equal(record.grade, 3);
});

test('toDatedReviewRecord.stability/difficulty match a direct reviewCard call on the same inputs', () => {
  const prior = { stability: 4, difficulty: 5, lastReviewedAt: 10 };
  const record = toDatedReviewRecord('card', prior, 4, 20);
  const direct = reviewCard(prior, 4, 20);
  assert.equal(record.stability, direct.stability);
  assert.equal(record.difficulty, direct.difficulty);
});

test('toDatedReviewRecord.due is always strictly after reviewedAt -- a same-day review still schedules forward', () => {
  const prior = { stability: 0, difficulty: 5 };
  const record = toDatedReviewRecord('card', prior, 1, 0); // even a lapse (Again) schedules forward
  assert.ok(record.due > record.reviewedAt, `due (${record.due}) should be after reviewedAt (${record.reviewedAt})`);
  assert.ok(record.interval >= 1);
});

test('toDatedReviewRecord.interval grows with a higher grade, same prior state and now', () => {
  const prior = { stability: 6, difficulty: 5, lastReviewedAt: 0 };
  const now = 6;
  const again = toDatedReviewRecord('card', prior, 1, now);
  const easy = toDatedReviewRecord('card', prior, 4, now);
  assert.ok(easy.interval > again.interval, `Easy interval (${easy.interval}) should exceed Again interval (${again.interval})`);
});

test('toDatedReviewRecord respects a non-default targetRetention: a lower (looser) target yields a longer interval -- you can wait longer before recall drops that far', () => {
  const prior = { stability: 6, difficulty: 5, lastReviewedAt: 0 };
  const now = 6;
  const strict = toDatedReviewRecord('card', prior, 3, now, 0.95);
  const loose = toDatedReviewRecord('card', prior, 3, now, 0.8);
  assert.ok(loose.interval > strict.interval, `loose (target 0.8) interval ${loose.interval} should exceed strict (target 0.95) interval ${strict.interval}`);
});

test('toDatedReviewRecord is deterministic: same inputs, same record, every time', () => {
  const prior = { stability: 4, difficulty: 5, lastReviewedAt: 10 };
  const a = toDatedReviewRecord('card', prior, 3, 15);
  const b = toDatedReviewRecord('card', prior, 3, 15);
  assert.deepEqual(a, b);
});
