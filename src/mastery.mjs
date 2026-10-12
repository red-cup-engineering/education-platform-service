/**
 * `mastery` -- self-education-platform-design.md §5. A disclosed synthesis, built from two
 * already-real numbers: per-exercise recall probability from FSRS-lite (srs.mts) and hall
 * stability from the pebble game (stability.mts). The *aggregate* below is this platform's own
 * design, not lifted from a corpus.
 */
import { recallProbability, STAGE_CUTS } from './srs.mjs';


/**
 * Recall mastery: the MINIMUM `R(t)` across a room's exercises, at `now`. Minimum, not mean,
 * because a room is only as strong as its weakest remembered piece -- a player who aced the
 * measure exercise but never reviewed the settle exercise has not mastered the room, and a mean
 * would hide that. An un-reviewed exercise contributes `R = 0` (never reviewed = never recalled),
 * matching `lightcone.mts`'s own defensive aggregation. A room with zero exercises has no
 * meaningful recall reading -- `undefined`, not a manufactured 0 or 1.
 */
export function recallMastery(exercises, now) {
  if (exercises.length === 0) return undefined;
  let minR = 1;
  for (const e of exercises) {
    if (e.lastReviewedAt === undefined) {
      minR = Math.min(minR, 0);
      continue;
    }
    const t = Math.max(0, now - e.lastReviewedAt);
    minR = Math.min(minR, recallProbability(t, e.stability));
  }
  return minR;
}

/**
 * Structural mastery: a HALL-level signal (whether the hall a room belongs to is a stable hall,
 * `stability.mts`'s pebble-game check), never itself a pass/fail gate on an individual room --
 * it is a graph property of the hall, not a fact about any one room in isolation. Exposed here
 * only as `hallBracing`, an explicit alias, so a caller cannot mistake it for a per-room gate.
 */
export function hallBracing(hallStable) {
  return hallStable;
}

export const MASTERY_RECALL_THRESHOLD = STAGE_CUTS.full; // 0.9, the same "full"-light cut, §3/§5.

/**
 * Room mastery = `recallMastery >= 0.9` AND the room has passed its gate at least once.
 * Deliberately does NOT take hall stability as an argument -- platform §5 states explicitly that
 * conflating hall bracing with room mastery "would misattribute a group property to an
 * individual." A caller wanting to show bracing alongside mastery calls `hallBracing` separately.
 */
export function roomMastery(recall, gatedAtLeastOnce) {
  if (recall === undefined) return false;
  return gatedAtLeastOnce && recall >= MASTERY_RECALL_THRESHOLD;
}
