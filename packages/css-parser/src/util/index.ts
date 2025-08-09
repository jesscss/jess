import type {
  ITokenConfig,
  TokenType,
  IMultiModeLexerDefinition,
  TokenPattern,
  CustomPatternMatcherFunc
} from 'chevrotain';
import {
  Lexer,
  createToken
} from 'chevrotain';
import { type WritableDeep } from 'type-fest';

// TODO: get rid of xRegExp dep
import * as XRegExp from 'xregexp';

export enum LexerType {
  NA,
  SKIPPED
}

export interface RawToken
  extends Omit<ITokenConfig, 'longer_alt' | 'categories' | 'pattern' | 'group' | 'start_chars_hint'> {
  pattern: TokenPattern | LexerType | readonly [string, (this: RegExp, text: string, startOffset: number) => any];
  group?: ITokenConfig['group'] | LexerType;
  longer_alt?: string | readonly string[];
  categories?: readonly string[];
  start_chars_hint?: readonly string[];
}
export type RawTokenConfig = Readonly<RawToken[]>;
export type RawModeConfig = Readonly<{
  modes: {
    Default: ReadonlyArray<Readonly<RawToken>>;
    [k: string]: ReadonlyArray<string | Readonly<RawToken>>;
  };
  defaultMode: 'Default';
}>;

interface ILexer {
  T: Record<string, TokenType>;
  lexer: IMultiModeLexerDefinition;
}
