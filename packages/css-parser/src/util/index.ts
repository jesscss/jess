import type {
  ITokenConfig,
  TokenType,
  TokenPattern,
  CustomPatternMatcherFunc
} from 'chevrotain'
import {
  Lexer,
  createToken
} from 'chevrotain'

// TODO: get rid of xRegExp dep
import * as XRegExp from 'xregexp'

export enum LexerType {
  NA,
  SKIPPED
}

export type TokenMap = Record<string, TokenType>

export interface rawTokenConfig
  extends Omit<ITokenConfig, 'longer_alt' | 'categories' | 'pattern' | 'group' | 'start_chars_hint'> {
  pattern: TokenPattern | LexerType | readonly [string, Function]
  group?: ITokenConfig['group'] | LexerType
  longer_alt?: string
  categories?: readonly string[]
  start_chars_hint?: readonly string[]
}

interface ILexer {
  T: TokenMap
  tokens: TokenType[]
}

/**
 * Builds proper tokens from a raw token definition.
 * This allows us to extend / modify tokens before creating them
 */
export const createTokens = (rawFragments: string[][], rawTokens: rawTokenConfig[]): ILexer => {
  const fragments: Record<string, RegExp> = {}
  const T: TokenMap = {}
  const tokens: TokenType[] = []

  /** Build fragment replacements */
  rawFragments.forEach(fragment => {
    fragments[fragment[0]] = XRegExp.build(fragment[1], fragments)
  })
  rawTokens.forEach((rawToken: rawTokenConfig) => {
    let { name, pattern, longer_alt, categories, group, ...rest } = rawToken
    let regExpPattern: RegExp | CustomPatternMatcherFunc
    if (pattern !== LexerType.NA) {
      const category = !categories || categories[0]
      if (!category || (group !== LexerType.SKIPPED && category !== 'BlockMarker')) {
        if (categories) {
          categories.push('Value')
        } else {
          categories = ['Value']
        }
        if (category !== 'Ident') {
          categories.push('NonIdent')
        }
      }
      if (pattern instanceof RegExp) {
        regExpPattern = pattern
      } else if (Array.isArray(pattern)) {
        regExpPattern = pattern[1].bind(XRegExp.build(pattern[0], fragments, 'y'))
      } else {
        regExpPattern = XRegExp.build(pattern as string, fragments)
      }
    } else {
      regExpPattern = Lexer.NA
    }

    const longerAlt = longer_alt ? { longer_alt: T[longer_alt] } : {}
    const groupValue = group === LexerType.SKIPPED
      ? { group: Lexer.SKIPPED }
      : group ? { group } : {}
    const tokenCategories = categories
      ? {
          categories: categories.map(category => {
            return T[category]
          })
        }
      : {}
    const token = createToken({
      name,
      pattern: regExpPattern,
      ...longerAlt,
      ...groupValue,
      ...tokenCategories,
      ...rest
    })
    T[name] = token
    /** Build tokens from bottom to top */
    tokens.unshift(token)
  })

  return {
    tokens,
    T
  }
}