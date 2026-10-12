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

export type RoomId = string; // wing-relative, forward-slashed path -- e.g. "unit-1-the-descent/marks-and-kinds.md"
export type WingId = string;
export type ThemeId = string;
export type ExerciseId = string;
export type HallId = string;

/** Anki-style four-button self-grade, platform §3. 1=Again, 2=Hard, 3=Good, 4=Easy. */
export type Grade = 1 | 2 | 3 | 4;

export type LightStage = 'full' | 'embers' | 'dim' | 'fogged';

/** Frontmatter values as the hand-rolled parser (frontmatter.mts) produces them: every key maps
 * to either a single scalar string or a flat list of strings. Nested maps are deliberately not
 * represented -- platform §2, §4 (this is exactly why exercise specs live in the body, not
 * frontmatter). */
export type FrontmatterData = Record<string, string | string[]>;

export interface Room {
  id: RoomId;
  wingId: WingId;
  title: string;
  aliases: string[];
  kind: string;
  description?: string;
  body: string;
  /** Raw frontmatter, retained for hall attribute extraction (platform §2) and available to a
   * theme's own exercise-extraction rule. */
  frontmatter: FrontmatterData;
  dateCreated?: string;
}

export interface Door {
  from: RoomId; // prerequisite
  to: RoomId; // dependent
  weight: 'hard' | 'soft';
  reason: string;
}

export interface Hall {
  id: HallId;
  intent: string[];
  rooms: RoomId[];
  stable: boolean;
}

/**
 * One exercise, as COMPILED, JSON-safe data -- platform §4's `GateExercise` minus its `checker`
 * field. The compiler never resolves `kind` to a function; that lookup happens at hydration time
 * against the active theme's `CheckerRegistry` (checker.mts), which is how a theme's checker
 * registry stays swappable without recompiling the corpus.
 */
export interface CompiledExercise<Spec = unknown> {
  id: ExerciseId; // `${roomId}#${kind}#${index}`, matching Lantern's existing id scheme (cards.mts)
  roomId: RoomId;
  kind: string;
  spec: Spec;
  prompt: string;
}

export interface WingConfig {
  id: WingId;
  /** Frontmatter fields to treat as hard-door candidates. Default: every field whose value(s)
   * are shaped like a `*.md` path (case-insensitive), minus `excludeFields`. */
  hardLinkFields?: string[];
  /** Fields never treated as doors even if `.md`-shaped -- platform §2 "Not doors" list. */
  excludeFields?: string[];
  /** Attribute fields FCA draws from. Default: ['cites', 'type', 'tags']. */
  attributeFields?: string[];
  /** Curator override groups (platform §2): offered back to the compiler, never replacing the
   * derived halls, only supplementing them. */
  groups?: { name: string; match: (attrs: ReadonlySet<string>) => boolean }[];
}

export interface World {
  wingId: WingId;
  rooms: Room[];
  doors: Door[];
  halls: Hall[];
  exercises: CompiledExercise[];
  warnings: string[];
}

export const DEFAULT_ATTRIBUTE_FIELDS: readonly string[] = ['cites', 'type', 'tags'];
export const DEFAULT_EXCLUDE_FIELDS: readonly string[] = ['cites', 'references', 'defines', 'aliases', 'teaches'];
