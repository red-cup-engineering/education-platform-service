/**
 * `record` — a thin, honest bridge from FSRS-lite's `CardState` (`./srs.mts`) to the dated
 * review-record convention described at
 * `emsenn-mandarin-services-section/services/emsenn-learning-mandarin-services-section/data/state/README.md`:
 * "spaced-repetition review records (per-card due date, interval, and ease)", filed under
 * `YYYY/MM/DD/YYYY-MM-DD-<language>-review.<extension>`.
 *
 * This module does no scheduling math of its own — it only names, plainly, how FSRS-lite's three
 * state fields map onto that convention's vocabulary:
 *
 *   - `stability`  → `stability`, unchanged (days).
 *   - `difficulty` → this convention's "ease" slot. FSRS-lite does **not** use Anki/SM-2's
 *                    fixed ease-factor concept; its own per-item difficulty parameter (1–10,
 *                    lower = easier) is the nearest thing it tracks, so the record stores it
 *                    honestly under its own name (`difficulty`) rather than relabeling it
 *                    "ease" and implying a concept this module doesn't implement.
 *   - `due`/`interval` → not stored in `CardState` at all; both are *derived*, at record-write
 *                    time only, by asking `daysUntilRetention` how many days from `now` the
 *                    curve predicts recall will fall back to `targetRetention` (default 0.9,
 *                    `DEFAULT_TARGET_RETENTION`). This is the same inversion `srs.mts` already
 *                    exposes for exactly this purpose — no new scheduling formula.
 *
 * Deterministic, same discipline as `srs.mts`: `now` is always caller-supplied, never
 * `Date.now()`.
 */
import {
  reviewCard,
  daysUntilRetention,
  DEFAULT_TARGET_RETENTION,

} from './srs.mjs';

const MS_PER_DAY = 86_400_000;

/** Render an epoch-day integer as an ISO calendar date (`YYYY-MM-DD`), epoch day 0 = 1970-01-01
 * — the same epoch `epochDayOf` (`srs.mts`) converts wall-clock timestamps into. */
export function epochDayToISODate(epochDay) {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

/** One dated review record, shaped to serialize directly into the `data/state/` convention's
 * per-card due/interval/ease/stability fields (see module header for the field-by-field
 * mapping). `recordType` matches the convention's own vocabulary (`session`/`review`/
 * `assessment`/`reflection`) so a record of this shape can be written as-is under a
 * `*-review.<extension>` filename. */

/**
 * Apply one review (via `reviewCard`) and shape the result as a `DatedReviewRecord`. `now` and
 * `priorState.lastReviewedAt` are epoch days; `targetRetention` defaults to FSRS-lite's own
 * `DEFAULT_TARGET_RETENTION` (0.9). `due` is never earlier than `now` — a same-day review always
 * reschedules at least one day out, since `daysUntilRetention` on a freshly grown stability is
 * strictly positive for any `targetRetention < 1`.
 */
export function toDatedReviewRecord(
  cardId,
  priorState,
  grade,
  now,
  targetRetention = DEFAULT_TARGET_RETENTION,
) {
  const next = reviewCard(priorState, grade, now);
  const interval = Math.max(1, Math.round(daysUntilRetention(next.stability, targetRetention)));
  const dueEpochDay = now + interval;

  return {
    recordType: 'review',
    cardId,
    grade,
    reviewedAt: epochDayToISODate(now),
    due: epochDayToISODate(dueEpochDay),
    interval,
    stability: next.stability,
    difficulty: next.difficulty,
  };
}
