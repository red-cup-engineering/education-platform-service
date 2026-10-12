import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTerm, isFullyAbsent,                           } from './register.mjs';


test('renderTerm returns the term text for a present entry', () => {
  const register = {
    id: 'test',
    terms: {
      distinguish: { state: 'present', term: 'Mark', source: 'x.tex' },
      relate: { state: 'absent', reason: 'no attested vocabulary' },
    },
  };
  assert.equal(renderTerm(register, 'distinguish'), 'Mark');
});

test('renderTerm never fabricates a term for an absent entry -- renders the reason instead', () => {
  const register = {
    id: 'test',
    terms: {
      distinguish: { state: 'present', term: 'Mark' },
      relate: { state: 'absent', reason: 'zero corpus vocabulary at this row' },
    },
  };
  const rendered = renderTerm(register, 'relate');
  assert.ok(rendered.includes('zero corpus vocabulary at this row'));
  assert.ok(!rendered.includes('Mark')); // must not fall back to another entry's term
});

test('isFullyAbsent is true only when every row is absent', () => {
  const allAbsent = {
    id: 'lakotaean',
    terms: {
      distinguish: { state: 'absent', reason: 'r1' },
      relate: { state: 'absent', reason: 'r2' },
    },
  };
  const oneReal = {
    id: 'obsmetrologia',
    terms: {
      distinguish: { state: 'present', term: 'Mark' },
      relate: { state: 'absent', reason: 'r2' },
    },
  };
  assert.equal(isFullyAbsent(allAbsent), true);
  assert.equal(isFullyAbsent(oneReal), false);
});
