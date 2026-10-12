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
import type { CompiledExercise, ExerciseId, RoomId } from './types.mts';

export interface Verdict {
  pass: boolean;
  /** Human-legible, always present -- even on pass. Never a bare boolean in the UI. */
  diagnosis: string;
}

/** A pure verdict function. See the module header for the purity discipline. */
export type Checker<Spec = unknown, Answer = unknown> = (spec: Spec, answer: Answer) => Verdict;

/** A theme's checker registry: `Record<kind, Checker>`. The platform's gate runner never
 * hard-codes which kinds exist -- it looks an exercise's `kind` up here. */
export type CheckerRegistry = Record<string, Checker<unknown, unknown>>;

/** One exercise, HYDRATED with its checker -- platform §4's full `GateExercise`. Produced by
 * `hydrateExercises`, never by the compiler (compile.mts only ever emits JSON-safe
 * `CompiledExercise`s -- see types.mts's header for why). */
export interface GateExercise<Spec = unknown, Answer = unknown> extends CompiledExercise<Spec> {
  checker: Checker<Spec, Answer>;
}

export interface HydrationResult {
  exercises: GateExercise[];
  /** Compiled exercises whose `kind` has no entry in the supplied registry -- surfaced, never
   * silently dropped, so an author typo or a theme registering the wrong kind name is loud. */
  unregisteredKinds: string[];
}

/** Attach each compiled exercise's real checker by looking its `kind` up in `registry`. Pure. */
export function hydrateExercises(compiled: readonly CompiledExercise[], registry: CheckerRegistry): HydrationResult {
  const exercises: GateExercise[] = [];
  const unregisteredKinds = new Set<string>();
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
export function gradeExercise(exercise: GateExercise, answer: unknown): Verdict {
  return exercise.checker(exercise.spec, answer);
}

export interface GateStatus {
  exerciseCount: number;
  distinctKinds: number;
  /** platform §4's gate minimum: at least 1 exercise, at least 2 distinct kinds where the room
   * supports it -- kept exactly as Lantern already states it. A room with exactly one exercise
   * (one kind) still satisfies the minimum: "where the room supports it" means the 2-kind bar
   * only binds once a room has produced 2+ exercises at all. */
  meetsMinimum: boolean;
}

/** platform §4's gate minimum, computed for one room's exercises. */
export function roomGateStatus(roomId: RoomId, exercises: readonly GateExercise[]): GateStatus {
  const forRoom = exercises.filter((e) => e.roomId === roomId);
  const distinctKinds = new Set(forRoom.map((e) => e.kind)).size;
  const meetsMinimum = forRoom.length >= 1 && (forRoom.length < 2 || distinctKinds >= 2);
  return { exerciseCount: forRoom.length, distinctKinds, meetsMinimum };
}

/** Group a flat exercise list by `roomId`, preserving compiled order within each room -- a small
 * convenience every gate runner and session builder needs. */
export function exercisesByRoom(exercises: readonly GateExercise[]): Map<RoomId, GateExercise[]> {
  const out = new Map<RoomId, GateExercise[]>();
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
export function exerciseId(roomId: RoomId, kind: string, index: number): ExerciseId {
  return `${roomId}#${kind}#${index}`;
}
