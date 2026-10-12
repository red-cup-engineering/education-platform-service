/**
 * Genuine Formal Concept Analysis -- self-education-platform-design.md §2. Context `(G, M, I)`:
 * `G` = objects (rooms), `M` = attribute universe, `I` = incidence (object carries attribute). A
 * closed concept is a pair `(extent, intent)` where `intent` is exactly the set of attributes
 * common to every object in `extent`, and `extent` is exactly the set of objects carrying every
 * attribute in `intent` -- closure, not a superset match.
 *
 * Vendored verbatim from `lantern-service/src/fca.mts` (platform §9 step 1: already theme-
 * neutral, declared as platform surface, no code moves).
 *
 * Algorithm: the set of all closed intents realizable by some extent of size >= 1 is exactly the
 * intersection-closure of the family `{ intent(g) : g in G }` (standard Galois-connection fact).
 * Computing that closure by repeated pairwise intersection to a fixpoint is fine at this corpus's
 * scale; a capped greedy grouping fallback exists past a configurable attribute-count ceiling,
 * disclosed, not silently capped.
 */
import { settle } from '@lenticule-science/metrologic/settlement';

                                
         
                             
 

                                    
                   
               
 

function keyOfAttrs(s                     )         {
  return [...s].sort().join('');
}

function keyOfExtent(ids                   )         {
  return ids.slice().sort().join('');
}

function intersect(a                     , b                     )              {
  const out = new Set        ();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

/** Attribute-count ceiling past which the compiler warns and falls back to a capped greedy
 * grouping rather than risk a combinatorial hang. Not exercised by the Equivo wing (small
 * attribute universe). */
export const ATTRIBUTE_CEILING = 500;

                                         
                                
                            
 

/**
 * Compute every closed concept `(extent, intent)` with `|extent| >= 2` and `intent != ∅` over
 * the given objects. `idOf` extracts a stable string key from an object id for dedup/sorting.
 */
export function computeHalls    (
  objects                          ,
  idOf                    ,
)                         {
  const attributeUniverse = new Set        ();
  for (const o of objects) for (const a of o.attrs) attributeUniverse.add(a);

  if (attributeUniverse.size > ATTRIBUTE_CEILING) {
    return { concepts: greedyFallback(objects, idOf), fellBackToGreedy: true };
  }

  // Intersection-closure of the family of object intents.
  const seenKeys = new Set        ();
  const family                = [];
  const add = (s             )       => {
    if (s.size === 0) return;
    const k = keyOfAttrs(s);
    if (seenKeys.has(k)) return;
    seenKeys.add(k);
    family.push(s);
  };
  for (const o of objects) add(new Set(o.attrs));

  // The intersection-closure is the least fixed point of one pairwise-intersection pass over
  // the family, in the knowledge order that orders intent families by inclusion: a pass only
  // ever adds intents, so it is monotone and inflationary. Reaching that fixed point is the
  // settlement node, `@lenticule-science/obsmetrologic-settlement`; what is this compiler's own
  // is the STEP (pairwise intersection, deduped by sorted-attribute key) and the fiber.
  const closurePass = (current               )                => {
    const next = current.slice();
    const keys = new Set(next.map(keyOfAttrs));
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        if (!a || !b) continue;
        const inter = intersect(a, b);
        if (inter.size === 0) continue;
        const k = keyOfAttrs(inter);
        if (keys.has(k)) continue;
        keys.add(k);
        next.push(inter);
      }
    }
    return next;
  };
  const { state: closedFamily } = settle(closurePass, family, {
    // union of two intent families, the earlier family's order kept
    merge: (before               , after               )                => {
      const out = before.slice();
      const keys = new Set(out.map(keyOfAttrs));
      for (const s of after) {
        const k = keyOfAttrs(s);
        if (keys.has(k)) continue;
        keys.add(k);
        out.push(s);
      }
      return out;
    },
    equal: (a               , b               )          => a.length === b.length,
  })                            ;

  // For each candidate closed intent, derive its extent, then re-close the intent from that
  // extent (exact closure, never a superset match), filter, and dedupe by extent.
  const byExtent = new Map                           ();
  for (const candidateIntent of closedFamily) {
    const extentObjs = objects.filter((o) => isSubset(candidateIntent, o.attrs));
    if (extentObjs.length < 2) continue;
    let closed                         ;
    for (const o of extentObjs) {
      closed = closed === undefined ? new Set(o.attrs) : intersect(closed, o.attrs);
    }
    if (!closed || closed.size === 0) continue;
    const extentIds = extentObjs.map((o) => o.id);
    const extentKey = keyOfExtent(extentIds.map(idOf));
    if (byExtent.has(extentKey)) continue;
    byExtent.set(extentKey, {
      intent: [...closed].sort(),
      extent: extentIds.slice().sort((x, y) => (idOf(x) < idOf(y) ? -1 : idOf(x) > idOf(y) ? 1 : 0)),
    });
  }

  return { concepts: [...byExtent.values()], fellBackToGreedy: false };
}

function isSubset(sub                     , sup                     )          {
  for (const x of sub) if (!sup.has(x)) return false;
  return true;
}

/** Capped greedy grouping fallback for pathologically large attribute universes: one group per
 * attribute value, capped extent size, no closure guarantee. Never exercised by the Equivo
 * wing. */
function greedyFallback    (objects                          , idOf                    )                      {
  const GREEDY_CAP = 200;
  const byAttr = new Map              ();
  for (const o of objects) {
    for (const a of o.attrs) {
      const list = byAttr.get(a) ?? [];
      if (list.length < GREEDY_CAP) list.push(o.id);
      byAttr.set(a, list);
    }
  }
  const out                      = [];
  for (const [attr, ids] of byAttr) {
    if (ids.length < 2) continue;
    out.push({ intent: [attr], extent: ids.slice().sort((x, y) => (idOf(x) < idOf(y) ? -1 : idOf(x) > idOf(y) ? 1 : 0)) });
  }
  return out;
}
