/**
 * `checker` -- the exercise-gate interface, self-education-platform-design.md §4. This is "the
 * one genuinely new platform piece": Lantern's `cards.mts` grades by construction (the back of a
 * card *is* the answer); Equivo's exercises grade by literally running a mathematical descent, a
 * cohomology computation, or a regime classification, so the platform needs a real interface, not
 * an assumption that grading is always string comparison.
 *
 * A `Checker` MUST be synchronous, MUST NOT perform I/O, MUST NOT read wall-clock time or any
 * mutable state outside its two arguments -- the same discipline `srs.mts`'s `now` parameter
 * states, for the same reason: an impure checker can't be replayed, can't be unit-tested without
 * a harness, and can't be trusted inside a gate that also drives SRS state.
 */


/** A pure verdict function. See the module header for the purity discipline. */

/** A theme's checker registry: `Record<kind, Checker>`. The platform's gate runner never
 * hard-codes which kinds exist -- it looks an exercise's `kind` up here. */

/** One exercise, HYDRATED with its checker -- platform §4's full `GateExercise`. Produced by
 * `hydrateExercises`, never by the compiler (compile.mts only ever emits JSON-safe
 * `CompiledExercise`s -- see types.mts's header for why). */


/** Attach each compiled exercise's real checker by looking its `kind` up in `registry`. Pure. */
export function hydrateExercises(compiled, registry) {
  const exercises = [];
  const unregisteredKinds = new Set        ();
  for (const c of compiled) {
    const checker = registry[c.kind];
    if (!checker) {
      unregisteredKinds.add(c.kind);
      continue;
    }
    exercises.push({ ...c, checker });
  }
  return { exercises, unregisteredKinds: [...unregisteredKinds].sort() };
}

/** Run one exercise's checker against a player's answer. Pure (delegates straight to the
 * exercise's own checker, which the purity discipline above already binds). */
export function gradeExercise(exercise, answer) {
  return exercise.checker(exercise.spec, answer);
}


/** platform §4's gate minimum, computed for one room's exercises. */
export function roomGateStatus(roomId, exercises) {
  const forRoom = exercises.filter((e) => e.roomId === roomId);
  const distinctKinds = new Set(forRoom.map((e) => e.kind)).size;
  const meetsMinimum = forRoom.length >= 1 && (forRoom.length < 2 || distinctKinds >= 2);
  return { exerciseCount: forRoom.length, distinctKinds, meetsMinimum };
}

/** Group a flat exercise list by `roomId`, preserving compiled order within each room -- a small
 * convenience every gate runner and session builder needs. */
export function exercisesByRoom(exercises) {
  const out = new Map                        ();
  for (const e of exercises) {
    const list = out.get(e.roomId) ?? [];
    list.push(e);
    out.set(e.roomId, list);
  }
  return out;
}

/** The `roomId#kind#index` id scheme, matching Lantern's existing `cards.mts` id convention so
 * that recompiling an unchanged room reproduces the same ids and player state re-attaches
 * cleanly (self-education-platform-design.md §7). */
export function exerciseId(roomId, kind, index) {
  return `${roomId}#${kind}#${index}`;
}
