import type {
  ITokenConfig,
  TokenType,
  IMultiModeLexerDefinition,
  TokenPattern,
  CustomPatternMatcherFunc
} from 'chevrotain'
import {
  Lexer,
  createToken
} from 'chevrotain'
import { type WritableDeep } from 'type-fest'

// TODO: get rid of xRegExp dep
import * as XRegExp from 'xregexp'

export enum LexerType {
  NA,
  SKIPPED
}

interface RawToken
  extends Omit<ITokenConfig, 'longer_alt' | 'categories' | 'pattern' | 'group' | 'start_chars_hint'> {
  pattern: TokenPattern | LexerType | readonly [string, (this: RegExp, text: string, startOffset: number) => any]
  group?: ITokenConfig['group'] | LexerType
  longer_alt?: string | readonly string[]
  categories?: readonly string[]
  start_chars_hint?: readonly string[]
}
export type RawTokenConfig = Readonly<RawToken[]>
export type RawModeConfig = Readonly<{
  modes: {
    default: ReadonlyArray<string | Readonly<RawToken>>
    [k: string]: ReadonlyArray<string | Readonly<RawToken>>
  }
  defaultMode: 'default'
}>

interface ILexer {
  T: Record<string, TokenType>
  lexer: IMultiModeLexerDefinition
}

const $buildFragments = (rawFragments: string[][]) => {
  const fragments: Record<string, RegExp> = {}
  rawFragments.forEach(fragment => {
    fragments[fragment[0]] = XRegExp.build(fragment[1], fragments)
  })
  return fragments
}

/**
 * Builds proper tokens from a raw token definition.
 * This allows us to extend / modify tokens before creating them
 */
export const createLexerDefinition = (rawFragments: string[][], rawTokens: WritableDeep<RawModeConfig>): ILexer => {
  /**
   * @todo - get ts-macros working to eliminate XRegExp dependency
   * @see https://github.com/GoogleFeud/ts-macros/issues/66
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const fragments: Record<string, RegExp> = $buildFragments(rawFragments)
  const T: Record<string, TokenType> = {}
  const lexer: IMultiModeLexerDefinition = {
    modes: {
      default: []
    },
    defaultMode: 'default'
  }

  /** Build fragment replacements */
  const entries = Object.entries(rawTokens.modes)
  entries.forEach(([mode, modeTokens]) => {
    modeTokens.forEach(rawToken => {
      const addToken = (token: TokenType) => {
        if (lexer.modes[mode] === undefined) {
          lexer.modes[mode] = [token]
        } else {
          /** Build tokens from bottom to top */
          lexer.modes[mode].unshift(token)
        }
      }
      if (typeof rawToken === 'string') {
        const token = lexer.modes.default.find(token => token.name === rawToken)!
        addToken(token)
        return
      }
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
          regExpPattern = pattern[1].bind(XRegExp.build(pattern[0], fragments, 'yi'))
        } else {
          regExpPattern = XRegExp.build(pattern as string, fragments, 'i')
        }
      } else {
        regExpPattern = Lexer.NA
      }

      const longerAlt = longer_alt
        ? {
            longer_alt: Array.isArray(longer_alt)
              ? longer_alt.map(val => T[val])
              : T[longer_alt]
          }
        : {}
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
      addToken(token)
    })
  })

  return {
    lexer,
    T
  }
}