import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHalls,                } from './fca.mjs';

test('two objects sharing an attribute form one closed concept', () => {
  const objects                      = [
    { id: 'a', attrs: new Set(['type:lesson', 'tags:foo']) },
    { id: 'b', attrs: new Set(['type:lesson', 'tags:bar']) },
  ];
  const { concepts } = computeHalls(objects, (id) => id);
  assert.equal(concepts.length, 1);
  assert.deepEqual(concepts[0]?.intent, ['type:lesson']);
  assert.deepEqual(concepts[0]?.extent, ['a', 'b']);
});

test('no shared attributes produces no concepts (extent >= 2 required)', () => {
  const objects                      = [
    { id: 'a', attrs: new Set(['tags:foo']) },
    { id: 'b', attrs: new Set(['tags:bar']) },
  ];
  const { concepts } = computeHalls(objects, (id) => id);
  assert.equal(concepts.length, 0);
});

test('closure is exact, not a superset match: three objects, two intersections', () => {
  const objects                      = [
    { id: 'a', attrs: new Set(['x', 'y', 'z']) },
    { id: 'b', attrs: new Set(['x', 'y']) },
    { id: 'c', attrs: new Set(['x']) },
  ];
  const { concepts } = computeHalls(objects, (id) => id);
  // {a,b} share {x,y} exactly; {a,b,c} share {x} exactly. Both are real closed concepts.
  const byExtent = new Map(concepts.map((c) => [c.extent.join(','), c.intent]));
  assert.deepEqual(byExtent.get('a,b'), ['x', 'y']);
  assert.deepEqual(byExtent.get('a,b,c'), ['x']);
});

test('a single object with unique attributes never forms a concept alone', () => {
  const objects                      = [{ id: 'a', attrs: new Set(['solo']) }];
  const { concepts, fellBackToGreedy } = computeHalls(objects, (id) => id);
  assert.equal(concepts.length, 0);
  assert.equal(fellBackToGreedy, false);
});
