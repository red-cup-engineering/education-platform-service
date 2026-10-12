/**
 * Shared types for the self-education platform kernel. Pure type declarations only --
 * `erasableSyntaxOnly` friendly, no runtime code, no `enum`.
 *
 * Generalized from `lantern-service/src/types.mts` (self-education-platform-design.md §9 step
 * 1: "no code moves, this step is a documentation/contract step"). Two real changes from the
 * Lantern original: `CardKind` (a closed, Lantern-specific union of five kinds) is dropped in
 * favor of `kind: string` (platform §4: "kind is the dispatch key a theme's checker registry is
 * keyed by" -- the platform never hard-codes which kinds exist), and `ReviewCard`/`World.cards`
 * become `CompiledExercise`/`World.exercises`, theme-neutral names for the same shape.
 */

                             // wing-relative, forward-slashed path -- e.g. "unit-1-the-descent/marks-and-kinds.md"

/** Anki-style four-button self-grade, platform §3. 1=Again, 2=Hard, 3=Good, 4=Easy. */


/** Frontmatter values as the hand-rolled parser (frontmatter.mts) produces them: every key maps
 * to either a single scalar string or a flat list of strings. Nested maps are deliberately not
 * represented -- platform §2, §4 (this is exactly why exercise specs live in the body, not
 * frontmatter). */




/**
 * One exercise, as COMPILED, JSON-safe data -- platform §4's `GateExercise` minus its `checker`
 * field. The compiler never resolves `kind` to a function; that lookup happens at hydration time
 * against the active theme's `CheckerRegistry` (checker.mts), which is how a theme's checker
 * registry stays swappable without recompiling the corpus.
 */



export const DEFAULT_ATTRIBUTE_FIELDS = ['cites', 'type', 'tags'];
export const DEFAULT_EXCLUDE_FIELDS = ['cites', 'references', 'defines', 'aliases', 'teaches'];
