import { recallProbability } from "./srs.mjs";

/**
 * `kata` — timed recall sequences, belts, spaced repeats. DESIGN.md §5. A kata is a named
 * ordered walk through doors, auto-generated per Hall (this module) or curator-authored
 * (out of v1 scope — see DESIGN.md's v1 non-goals). Spaced kata repeats reuse `srs.mjs`
 * wholesale rather than a second scheduler: a `Kata` carries the same `(stability,
 * difficulty)` state shape as a `ReviewCard`.
 */

// ---------------------------------------------------------------------------------------
// Auto-hall kata path
// ---------------------------------------------------------------------------------------

/**
 * Build the auto-generated kata path for a hall: a deterministic DFS-based linearization of
 * the intra-hall door graph (edges `from`=prerequisite -> `to`=dependent), starting DFS roots
 * in ascending `date-created` order (ties broken by room id) per DESIGN.md §5 ("topological
 * order from the hall's earliest-dated room"). The intra-hall subgraph is not guaranteed
 * acyclic (this corpus's `## Related terms` cross-links form genuine cycles) — DESIGN.md makes
 * no acyclicity claim for halls, so this uses the standard DFS-postorder technique, which
 * always yields a valid *true* topological order on a DAG and a deterministic, cycle-tolerant
 * linearization (every room visited exactly once) otherwise.
 */
export function autoKataPath(hall, doors, rooms) {
  const inHall = new Set(hall.rooms);
  const adjacency = new Map();
  for (const d of doors) {
    if (!inHall.has(d.from) || !inHall.has(d.to)) continue;
    const list = adjacency.get(d.from) ?? [];
    list.push(d.to);
    adjacency.set(d.from, list);
  }

  const dateOf = new Map();
  for (const r of rooms) if (inHall.has(r.id)) dateOf.set(r.id, r.dateCreated ?? '9999-99-99');

  const startOrder = [...hall.rooms].sort((a, b) => {
    const da = dateOf.get(a) ?? '9999-99-99';
    const db = dateOf.get(b) ?? '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const visited = new Set();
  const postorder = [];

  function dfs(roomId) {
    if (visited.has(roomId)) return;
    visited.add(roomId);
    const neighbors = [...(adjacency.get(roomId) ?? [])].sort();
    for (const n of neighbors) dfs(n);
    postorder.push(roomId);
  }

  for (const start of startOrder) dfs(start);

  return postorder.reverse();
}

export function makeAutoKata(hall, doors, rooms) {
  return {
    id: `kata:${hall.id}`,
    path: autoKataPath(hall, doors, rooms),
    origin: 'auto-hall',
    stability: 0,
    difficulty: 5,
  };
}

// ---------------------------------------------------------------------------------------
// Per-card scoring and belts
// ---------------------------------------------------------------------------------------

/** Per-card score, DESIGN.md §5 table. */
export function scoreCard(result) {
  if (result.outcome === 'again') return 0;
  if (result.outcome === 'hard') return 0.5;
  // good or easy
  return result.responseTimeMs <= result.tFastMs ? 2 : 1;
}

export function kataRatio(results) {
  if (results.length === 0) return 0;
  const total = results.reduce((sum, r) => sum + scoreCard(r), 0);
  const max = results.length * 2;
  return total / max;
}

export const BELT_THRESHOLDS = [
  { belt: 'black', min: 0.97 },
  { belt: 'brown', min: 0.92 },
  { belt: 'blue', min: 0.85 },
  { belt: 'green', min: 0.75 },
  { belt: 'orange', min: 0.65 },
  { belt: 'yellow', min: 0.5 },
  { belt: 'white', min: 0 },
];

/** Belt tier for a single ratio (a "would-be" tier — awarding requires 3 consecutive clears,
 * see `awardedBelt`). */
export function beltForRatio(ratio) {
  for (const { belt, min } of BELT_THRESHOLDS) {
    if (ratio >= min) return belt;
  }
  return 'white';
}

/** A belt is only *awarded* once it's the minimum of the player's last 3 consecutive kata
 * clears, DESIGN.md §5 — avoids a one-lucky-run fluke. Fewer than 3 clears on record: not yet
 * awardable past white (any completion). */
export function awardedBelt(lastThreeRatios) {
  if (lastThreeRatios.length < 3) return 'white';
  const min = Math.min(...lastThreeRatios);
  return beltForRatio(min);
}

// ---------------------------------------------------------------------------------------
// Kata ratio -> synthetic SRS grade, DESIGN.md §5
// ---------------------------------------------------------------------------------------

export function ratioToGrade(ratio) {
  if (ratio < 0.5) return 1; // Again
  if (ratio < 0.75) return 2; // Hard
  if (ratio < 0.92) return 3; // Good
  return 4; // Easy
}

// ---------------------------------------------------------------------------------------
// Kata runs
// ---------------------------------------------------------------------------------------

/** For each room in a kata's path, pick the card that best represents "what's next due there"
 * — the one with the lowest current `R(t)` (ties broken by card id for determinism). A room
 * with no cards at all (shouldn't happen for a compiled wing, but degenerate-input-safe) is
 * skipped rather than crashing the run. */
export function pickKataCards(path, cardsByRoom, now) {
  const picked = [];
  for (const roomId of path) {
    const cards = cardsByRoom.get(roomId) ?? [];
    if (cards.length === 0) continue;
    let best = null;
    let bestR = Infinity;
    for (const c of [...cards].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const t = c.lastReviewedAt === undefined ? Infinity : Math.max(0, now - c.lastReviewedAt);
      const S = c.stability || 0.01;
      const R = c.lastReviewedAt === undefined ? 0 : recallProbability(t, S);
      if (R < bestR) {
        bestR = R;
        best = c;
      }
    }
    if (best) picked.push({ roomId, card: best });
  }
  return picked;
}

/** A kata is offered as runnable when every room on its path is currently reached (in the
 * light cone) — DESIGN.md's "pick a lit path." Halls smaller than 2 rooms never produce a
 * kata (see `vault-compiler/build-layout`), so this only needs the reachability check. */
export function kataIsAvailable(path, reachable) {
  return path.length >= 2 && path.every((roomId) => reachable.has(roomId));
}

/** Fold a finished run's per-card results into the numbers the UI + SRS update need. */
export function summarizeKataRun(results) {
  const ratio = kataRatio(results);
  return {
    ratio,
    beltThisRun: beltForRatio(ratio),
    grade: ratioToGrade(ratio),
  };
}

