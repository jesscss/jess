import { type ILexingResult, type IRecognitionException, type IToken } from 'chevrotain';
import type { Node } from '../tree/index.js';

export * from './modes.js';
export * from './config.js';

export type TriviaLookup = 'before' | 'after';

export interface TriviaMap {
  /** The single owned set of continuous whitespace/comment runs for a file. */
  runs: Set<IToken[]>;
  /**
   * Find a run keyed before or after a source offset. Parser-backed trivia may
   * index the same run from both adjacent offsets; serializers should use the
   * needed side directly instead of rediscovering the opposite key by scanning.
   */
  lookup(offset: number | undefined, direction: TriviaLookup): IToken[] | undefined;
  /** Iterate one lookup index for public inspection and diagnostics. */
  entries(direction: TriviaLookup): IterableIterator<[number, IToken[]]>;
  has(offset: number | undefined, direction: TriviaLookup): boolean;
}

export interface IParseResult<T extends Node = Node> {
  lexerResult: ILexingResult;
  errors: IRecognitionException[];
  tree: T;
  trivia: TriviaMap;
  warnings?: Array<{ message: string; token?: IToken; deprecation?: string }>;
}
