/**
 * `dailywalk` — the daily lantern-walk (DESIGN.md §6, face-spec item 3): "Due set = every card
 * whose R(t) < 0.9 today, unioned with cards newly crossing into 'dim' at the light-cone
 * boundary — walking those first is what re-expands the frontier. Ordered into a route by a
 * greedy nearest-unvisited-door walk over the room graph" — disclosed as a greedy heuristic,
 * not a claimed TSP-optimal tour.
 */
import { recallProbability } from './srs.mjs';

/** Undirected door-graph adjacency, used only for the stroll's hop-distance metric — the
 * walk's *route*, never the light cone's reachability logic (that stays doors-are-directed,
 * in `lightcone.mjs`). */
function buildAdjacency(rooms, doors) {
  const adj = new Map();
  for (const r of rooms) adj.set(r.id, new Set());
  for (const d of doors) {
    if (adj.has(d.from) && adj.has(d.to)) {
      adj.get(d.from).add(d.to);
      adj.get(d.to).add(d.from);
    }
  }
  return adj;
}

function bfsDistances(adj, start) {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(cur);
    for (const next of adj.get(cur) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

/** The due set: cards whose own R(t) < 0.9 (unboosted — per-card SRS due-ness, distinct from
 * the hall-bonused stage used for map light state), unioned with every card belonging to a
 * room currently in the light cone at 'dim' stage (the boundary the design calls out — those
 * rooms are about to drop out of the light cone, so walking them first is what keeps the
 * frontier from shrinking). */
export function dueCards(effCards, roomLightStates, reachable, now) {
  const due = new Map();
  for (const c of effCards) {
    if (c.lastReviewedAt === undefined) continue;
    const t = Math.max(0, now - c.lastReviewedAt);
    const R = recallProbability(t, c.stability);
    if (R < 0.9) due.set(c.id, c);
  }
  for (const c of effCards) {
    if (due.has(c.id)) continue;
    if (!reachable.has(c.roomId)) continue;
    const state = roomLightStates.get(c.roomId);
    if (state && state.gated && state.stage === 'dim') due.set(c.id, c);
  }
  return [...due.values()];
}

/**
 * Order the due set into a stroll: group by room, then greedily visit the nearest
 * not-yet-visited due room (BFS hop distance over the undirected door graph) starting from
 * `startRoomId`. Ties broken by room id for determinism. Rooms with no path from the current
 * position (disconnected in the door graph) are appended, nearest-first among themselves,
 * after every reachable room has been visited, so the walk always includes every due room.
 */
export function buildWalkRoute(rooms, doors, dueCardList, startRoomId) {
  const adj = buildAdjacency(rooms, doors);
  const byRoom = new Map();
  for (const c of dueCardList) {
    const list = byRoom.get(c.roomId) ?? [];
    list.push(c);
    byRoom.set(c.roomId, list);
  }
  const remaining = new Set(byRoom.keys());
  if (remaining.size === 0) return [];

  let current = remaining.has(startRoomId) ? startRoomId : [...remaining].sort()[0];
  const route = [];

  while (remaining.size > 0) {
    remaining.delete(current);
    route.push({ roomId: current, cards: byRoom.get(current) ?? [] });
    if (remaining.size === 0) break;

    const dist = bfsDistances(adj, current);
    let best = null;
    let bestDist = Infinity;
    for (const roomId of [...remaining].sort()) {
      const d = dist.has(roomId) ? dist.get(roomId) : Infinity;
      if (d < bestDist) {
        bestDist = d;
        best = roomId;
      }
    }
    current = best;
  }

  return route;
}

/** Convenience: due set + route in one call, given the app's current light-cone snapshot. */
export function dailyLanternWalk(rooms, doors, effCards, roomLightStates, reachable, now, startRoomId) {
  const due = dueCards(effCards, roomLightStates, reachable, now);
  const start = startRoomId ?? (due[0] ? due[0].roomId : (rooms[0] ? rooms[0].id : null));
  return buildWalkRoute(rooms, doors, due, start);
}
