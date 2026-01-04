import { type ILexingResult, type IRecognitionException } from 'chevrotain';
import type { Node } from '../tree';

export * from './modes';
export * from './config';

export interface IParseResult<T extends Node = Node> {
  lexerResult: ILexingResult;
  errors: IRecognitionException[];
  tree: T;
}