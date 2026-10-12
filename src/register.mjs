/**
 * `register` -- the theming/presentation contract, self-education-platform-design.md §6. The
 * platform's internal vocabulary (Room, Door, Hall, gate, settle, measure, obstruction) is
 * theme-neutral by design; a `PresentationRegister` is a theme's own lookup table from engine
 * concepts to its own vocabulary and phrasing, applied only at render time -- the compiler,
 * scheduler, checker registry, and persisted state never contain register-translated strings,
 * only the neutral engine vocabulary plus a `registerKey`.
 */

/** Every entry is either a real term or an explicit absence -- never both undefined and silently
 * skipped (§6.3's non-negotiable rule). */


/**
 * §6.3's non-negotiable rendering rule, enforced as code rather than only prose: given a
 * register and a concept key, return the term to render. NEVER falls back to another register,
 * NEVER synthesizes a plausible term for an absent entry -- an absent entry renders its own
 * `reason` as the visible state, exactly as designed.
 */
export function renderTerm                           (register, key) {
  const entry = register.terms[key];
  if (entry.state === 'present') return entry.term;
  return `(not yet available in this lens: ${entry.reason})`;
}

/** True iff every entry in the register is `absent` -- the shape the Lakotaean register must
 * have, and the shape every OTHER shipped register must NOT have (at least one populated row). */
export function isFullyAbsent                           (register) {
  return Object.values(register.terms).every((e) => (e).state === 'absent');
}
