import { type ILexingResult, type IRecognitionException, type IToken } from 'chevrotain';
import type { Node } from '../tree/index.js';

export * from './modes.js';
export * from './config.js';

export interface TriviaMap {
  before: Map<number, IToken[]>;
  after: Map<number, IToken[]>;
}

export interface IParseResult<T extends Node = Node> {
  lexerResult: ILexingResult;
  errors: IRecognitionException[];
  tree: T;
  trivia: TriviaMap;
  warnings?: Array<{ message: string; token?: IToken; deprecation?: string }>;
}
