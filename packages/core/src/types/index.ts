import { type ILexingResult, type IRecognitionException, type IToken } from 'chevrotain';
import type { Node } from '../tree/index.js';

export * from './modes.js';
export * from './config.js';

export type TriviaLookup = 'before' | 'after';

/**
 * A continuous whitespace/comment run between two source offsets, identified by
 * its source range rather than a token array. The serializer slices its text
 * straight from `src` on demand — no per-token object allocation. Runs are
 * cached per source position, so the same run looked up from either adjacent
 * offset is the SAME object (identity is what `emittedTrivia` dedupes on).
 */
export interface Trivia {
  /** Inclusive source offset where the run begins. */
  readonly start: number;
  /** Exclusive source offset where the run ends. */
  readonly end: number;
  /** True if the run contains any comment (block or line) — not pure whitespace. */
  readonly hasComment: boolean;
  /** The source text the run was sliced from (shared reference, not a copy). */
  readonly src: string;
}

export interface TriviaMap {
  /**
   * Find the run keyed before or after a source offset. Parser-backed trivia may
   * index the same run from both adjacent offsets; serializers should use the
   * needed side directly instead of rediscovering the opposite key by scanning.
   */
  lookup(offset: number | undefined, direction: TriviaLookup): Trivia | undefined;
  /** Iterate one lookup index for public inspection and diagnostics. */
  entries(direction: TriviaLookup): IterableIterator<[number, Trivia]>;
  has(offset: number | undefined, direction: TriviaLookup): boolean;
}

export interface IParseResult<T extends Node = Node> {
  lexerResult: ILexingResult;
  errors: IRecognitionException[];
  tree: T;
  trivia: TriviaMap;
  warnings?: Array<{ message: string; token?: IToken; deprecation?: string }>;
}
