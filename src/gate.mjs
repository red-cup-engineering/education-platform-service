/**
 * `gate` — pure queue-building logic for the card interaction (DESIGN.md §3, face-spec item
 * 2). "Entering a room the player hasn't yet gated requires clearing every generated card for
 * that room once, in an ungraded practice pass; passing seeds each card straight into
 * FSRS-lite at its grade's S0/D0 — the gate-pass *is* the first SRS review, not a separate
 * system bolted in front of one." Concretely: the player self-grades every card exactly once
 * with the same Again/Hard/Good/Easy buttons whether it's the very first pass (gate) or a
 * later spaced repeat (review) — one component, the room's review interface, drives both.
 */
import { recallProbability } from './srs.mjs';

/**
 * Decide what clicking a room should present, from that room's effective cards (compiled
 * baseline + local review history merged, layered over the compiled baseline) at `now`.
 *
 * - `mode: 'gate'` — one or more cards have never been reviewed. Queue = every ungated card,
 *   compiler order preserved (DESIGN.md §3's priority order: exercise > dependency > cloze >
 *   term-from-def > teaches).
 * - `mode: 'review'` — every card has been reviewed at least once; queue = every card whose
 *   `R(t) < 0.9` right now (a room's light state is its *weakest* card, so relighting it fully
 *   means clearing every card currently dragging it down, not just one).
 * - `mode: 'lit'` — every card is at full light already; queue is empty (nothing due), but the
 *   room can still be opened for a look (`allowEarlyReview` cards let the player review ahead
 *   of schedule if they choose).
 */
export function buildRoomQueue(effCardsForRoom, now) {
  const ungated = effCardsForRoom.filter((c) => c.lastReviewedAt === undefined);
  if (ungated.length > 0) {
    return { mode: 'gate', cards: ungated };
  }
  const due = effCardsForRoom.filter((c) => {
    const t = Math.max(0, now - c.lastReviewedAt);
    return recallProbability(t, c.stability) < 0.9;
  });
  if (due.length > 0) {
    return { mode: 'review', cards: due };
  }
  return { mode: 'lit', cards: [], allowEarlyReview: [...effCardsForRoom] };
}
