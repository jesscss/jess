import { type ILexingResult, type IRecognitionException, type IToken } from 'chevrotain';
import type { Node } from '../tree';

export * from './modes';
export * from './config';

export interface IParseResult<T extends Node = Node> {
  lexerResult: ILexingResult;
  errors: IRecognitionException[];
  tree: T;
  warnings?: Array<{ message: string; token?: IToken; deprecation?: string }>;
}