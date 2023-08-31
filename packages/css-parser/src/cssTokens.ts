/* eslint no-control-regex: "off" */
import { type WritableDeep } from 'type-fest'
import type { RawModeConfig } from './util'
import { LexerType } from './util'
import { SKIPPED_LABEL } from './advancedCstParser'

/**
 * references:
 * https://github.com/antlr/grammars-v4/blob/master/css3/css3.g4
 * https://www.lifewire.com/css2-vs-css3-3466978
 * https://www.w3.org/TR/css-syntax-3/
 *
 * Fragments and Tokens must be defined in order
 * ({{references}} must follow definitions)
 */
const fragments = () => [
  ['newline', '\\n|\\r\\n?|\\f'],
  ['whitespace', '[ ]|\\t|{{newline}}'],
  ['ws', '{{whitespace}}+'],
  ['comment', '\\/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*\\/'],
  ['hex', '[\\da-fA-F]'],
  ['unicode', '\\\\{{hex}}{1,6}{{whitespace}}?'],
  ['escape', '{{unicode}}|\\\\[^\\r\\n\\f0-9a-fA-F]'],
  ['nonascii', '[\\u0240-\\uffff]'],
  ['nmstart', '[_a-zA-Z]|{{nonascii}}|{{escape}}'],
  ['nmchar', '[_a-zA-Z0-9-]|{{nonascii}}|{{escape}}'],
  ['ident', '-?{{nmstart}}{{nmchar}}*'],
  ['string1', '\\"(\\\\"|[^\\n\\r\\f\\"]|{{newline}}|{{escape}})*\\"'],
  ['string2', "\\'(\\\\'|[^\\n\\r\\f\\']|{{newline}}|{{escape}})*\\'"],

  ['integer', '[+-]?\\d+'],
  /**
   * Any (signless) number that's not simply an integer e.g. 1.1 or 1e+1
  */
  ['number', '(?:\\d*\\.\\d+(?:[eE][+-]\\d+)?|\\d+(?:[eE][+-]\\d+))'],
  ['wsorcomment', '({{ws}})|({{comment}})']
]

interface Match { value: string, index: number }

class MatchValue implements Match {
  value: string
  index: number

  constructor(str: string, index: number) {
    this.value = str
    this.index = index
  }
}

/**
 * When bound to a Regular Expression, it will aggregrate capture groups onto the payload
 */
export function groupCapture(this: RegExp, text: string, startOffset: number) {
  let endOffset = startOffset
  let match: RegExpExecArray | null
  let lastMatch: RegExpExecArray | null = null
  const matches: RegExpExecArray[] = []

  this.lastIndex = startOffset

  while ((match = this.exec(text))) {
    endOffset = this.lastIndex
    lastMatch = match
    matches.push(match)
  }

  if (lastMatch !== null) {
    const payload: Match[][] = new Array(lastMatch.length - 1)
    matches.forEach(match => {
      match.forEach((group, i) => {
        if (i > 0 && group) {
          const item = payload[i - 1]
          /* c8 ignore next 2 */
          if (item) {
            item.push(new MatchValue(group, match.index))
          } else {
            payload[i - 1] = [new MatchValue(group, match.index)]
          }
        }
      })
    })

    const returnObj: [string] & any = [text.substring(startOffset, endOffset)]
    returnObj.payload = payload
    return returnObj
  }
  return lastMatch
}

/**
 * Anything that is not 'BlockMarker' will be parsed as a generic 'Value',
 * so 'Value' can be considered `!BlockMarker`
 *
 * @todo Change to Map implementation? May allow easier replacement of
 * tokens, in extended parsers, as well as easier TokenMap.
 */
const tokens = () => ({
  modes: {
    Default: [
      { name: 'Value', pattern: LexerType.NA },
      { name: 'NonIdent', pattern: LexerType.NA },
      { name: 'AtName', pattern: LexerType.NA },
      { name: 'MfLt', pattern: LexerType.NA },
      { name: 'MfGt', pattern: LexerType.NA },
      // This can match anything, so it must be given the lowest priority
      { name: 'Unknown', pattern: /[\u0000-\uffff]/ },
      { name: 'BlockMarker', pattern: LexerType.NA },
      { name: 'ListMarker', pattern: LexerType.NA },
      { name: 'CompareOperator', pattern: LexerType.NA },
      { name: 'Slash', pattern: LexerType.NA },
      { name: 'Selector', pattern: LexerType.NA },
      { name: 'Combinator', pattern: LexerType.NA },
      { name: 'Color', pattern: LexerType.NA },
      { name: 'Function', pattern: LexerType.NA },
      { name: 'FunctionalPseudoClass', pattern: LexerType.NA },
      { name: 'Assign', pattern: LexerType.NA },
      { name: 'QuoteStart', pattern: LexerType.NA },
      // TODO: can use string literals for simple patterns (e.g: /\)/ vs ')')
      { name: 'Gt', pattern: />/, categories: ['CompareOperator', 'Combinator', 'MfGt'] },
      { name: 'Lt', pattern: /</, categories: ['CompareOperator', 'MfLt'] },
      { name: 'GtEq', pattern: />=/, categories: ['CompareOperator', 'MfGt'] },
      { name: 'LtEq', pattern: /<=/, categories: ['CompareOperator', 'MfGt'] },
      { name: 'LCurly', pattern: /{/, categories: ['BlockMarker'] },
      { name: 'RCurly', pattern: /}/, categories: ['BlockMarker'] },
      { name: 'LParen', pattern: /\(/, categories: ['BlockMarker'] },
      { name: 'RParen', pattern: /\)/, categories: ['BlockMarker'] },
      { name: 'LSquare', pattern: /\[/, categories: ['BlockMarker'] },
      { name: 'RSquare', pattern: /\]/, categories: ['BlockMarker'] },
      { name: 'Semi', pattern: /;/, categories: ['BlockMarker'] },
      { name: 'AdditionOperator', pattern: LexerType.NA },
      { name: 'MultiplicationOperator', pattern: LexerType.NA },
      { name: 'Plus', pattern: /\+/, categories: ['AdditionOperator', 'Combinator'] },
      { name: 'Minus', pattern: /-/, categories: ['AdditionOperator'] },
      { name: 'Divide', pattern: /\//, categories: ['MultiplicationOperator', 'Slash'] },
      { name: 'Comma', pattern: /,/, categories: ['BlockMarker'] },
      { name: 'Colon', pattern: /:/, categories: ['BlockMarker', 'Assign'] },
      { name: 'AttrMatchOperator', pattern: LexerType.NA },
      // Some tokens have to appear after AttrMatch
      { name: 'Eq', pattern: /=/, categories: ['CompareOperator', 'AttrMatchOperator'] },
      { name: 'Star', pattern: /\*/, categories: ['MultiplicationOperator'] },
      { name: 'Tilde', pattern: /~/, categories: ['Combinator'] },
      /** a namespace or column combinator */
      { name: 'Pipe', pattern: /\|/, categories: ['Combinator'] },
      { name: 'Column', pattern: /\|\|/, categories: ['Combinator'] },
      { name: 'AttrMatch', pattern: /[*~|^$]=/, categories: ['AttrMatchOperator'] },
      { name: 'Ident', pattern: LexerType.NA },
      {
        name: 'PlainIdent',
        pattern: '{{ident}}',
        categories: ['Ident']
      },
      { name: 'LegacyPropIdent', pattern: '(?:\\*|_){{ident}}' },
      { name: 'LegacyMSFilter', pattern: /progid:(?:[\w]\.)*\w(?:\([^)]*\))?/ },
      {
        name: 'CustomProperty',
        pattern: '--{{ident}}',
        categories: ['BlockMarker']
      },
      { name: 'CDOToken', pattern: /<!--/, group: LexerType.SKIPPED },
      { name: 'CDCToken', pattern: /-->/, group: LexerType.SKIPPED },
      /** Ignore BOM */
      { name: 'UnicodeBOM', pattern: /\uFFFE/, group: LexerType.SKIPPED },
      /**
       * Normally this is a CSS token, but it makes downstream parsers much trickier.
       * Instead, we leave parens and idents as separate tokens.
       */
      // { name: 'PlainFunction', pattern: '{{ident}}\\(', categories: ['BlockMarker', 'Function'] },
      { name: 'AttrFlag', pattern: /[is]/i, longer_alt: 'PlainIdent', categories: ['Ident'] },

      /**
       * Needs to appear after keywords like `even` which starts with `e`
       * (Reminder that tokens are in reverse order in this file.)
       */
      {
        name: 'MathConstant',
        pattern: /pi|e|-?infinity|nan/i,
        longer_alt: 'PlainIdent',
        categories: ['Ident']
      },

      /** Logical Keywords */
      { name: 'And', pattern: /and/, longer_alt: 'PlainIdent', categories: ['Ident'] },
      { name: 'Or', pattern: /or/, longer_alt: 'PlainIdent', categories: ['Ident'] },
      { name: 'Not', pattern: /not/, longer_alt: 'PlainIdent', categories: ['Ident'] },
      { name: 'Only', pattern: /only/, longer_alt: 'PlainIdent', categories: ['Ident'] },

      /** Query words */
      { name: 'Screen', pattern: /screen/, longer_alt: 'PlainIdent', categories: ['Ident'] },
      { name: 'Print', pattern: /print/, longer_alt: 'PlainIdent', categories: ['Ident'] },
      { name: 'All', pattern: /all/, longer_alt: 'PlainIdent', categories: ['Ident'] },

      { name: 'AtKeyword', pattern: '@{{ident}}', categories: ['BlockMarker', 'AtName'] },
      {
        name: 'UrlStart',
        pattern: /url\(/i,
        push_mode: 'Url'
      },
      /**
       * Rather than consume the whole string, we push
       * a string mode. This makes string parsing
       * extensible to languages with embedded expressions.
       */
      {
        name: 'SingleQuoteStart',
        pattern: /'/,
        push_mode: 'SingleQuoteString',
        categories: ['BlockMarker', 'QuoteStart']
      },
      {
        name: 'DoubleQuoteStart',
        pattern: /"/,
        push_mode: 'DoubleQuoteString',
        categories: ['BlockMarker', 'QuoteStart']
      },
      {
        name: 'Important',
        pattern: '!(?:{{ws}}|{{comment}})*important',
        categories: ['BlockMarker']
      },
      {
        name: 'AtImport',
        pattern: /@import/i,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
      },
      {
        name: 'AtMedia',
        pattern: /@media/i,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
      },
      {
        name: 'AtSupports',
        pattern: /@supports/i,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
      },
      {
        name: 'AtPage',
        pattern: /@page/i,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
      },
      {
        name: 'AtFontFace',
        pattern: /@font-face/i,
        categories: ['BlockMarker', 'AtName']
      },
      {
        name: 'AtNested',
        pattern: /@keyframes|@viewport|@document/i,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
      },
      {
        name: 'AtNonNested',
        pattern: /@namespace/i,
        longer_alt: 'AtKeyword',
        categories: ['BlockMarker', 'AtName']
      },
      /** Not a rule, but a special token */
      {
        name: 'Charset',
        pattern: '@charset{{ws}}?(?:{{string1}}|{{string2}});'
      },
      {
        name: 'UnicodeRange',
        pattern: /[uU]\+[0-9a-fA-F?]+(-[0-9a-fA-F?]+)?/
      },
      /** Selectors */
      {
        name: 'Ampersand',
        pattern: /&/,
        categories: ['Selector']
      },
      {
        name: 'Dot',
        pattern: '\\.'
      },
      {
        name: 'HashName',
        pattern: '#{{ident}}',
        categories: ['Selector']
      },
      {
        name: 'NthPseudoClass',
        pattern: /:(?:nth-child|nth-last-child|nth-of-type|nth-last-of-type)\(/i,
        categories: ['BlockMarker', 'FunctionalPseudoClass']
      },
      {
        name: 'SelectorPseudoClass',
        pattern: /:(?:is|not|where|has)\(/i,
        categories: ['BlockMarker', 'FunctionalPseudoClass']
      },

      /** @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page */
      {
        name: 'PagePseudoClass',
        pattern: /:(?:first|left|right|blank)/i
      },

      /** Nth Keywords */
      { name: 'NthOdd', pattern: /odd/, longer_alt: 'PlainIdent', categories: ['Ident'] },
      { name: 'NthEven', pattern: /even/, longer_alt: 'PlainIdent', categories: ['Ident'] },
      { name: 'Of', pattern: /of/, longer_alt: 'PlainIdent', categories: ['Ident'] },

      {
        name: 'ColorIntStart',
        pattern: /#(?:(?:[0-9][0-9a-f]{7})|(?:[0-9][0-9a-f]{5})|(?:[0-9][0-9a-f]{2,3}))/i,
        categories: ['Color']
      },
      // This is in the Selector category because a value may get lexed as a color,
      // but will be intended as an ID selector. ONLY valid as ID if it doesn't start with a number
      {
        name: 'ColorIdentStart',
        pattern: /#(?:(?:[a-f][0-9a-f]{7})|(?:[a-f][0-9a-f]{5})|(?:[a-f][0-9a-f]{2,3}))/i,
        longer_alt: 'HashName',
        categories: ['Color', 'Selector']
      },
      /**
       * CSS syntax says we should identify integers as separate from numbers,
       * probably because there are parts of the syntax where one is allowed but not the other?
       */
      { name: 'Number', pattern: LexerType.NA },
      { name: 'Dimension', pattern: LexerType.NA },
      { name: 'Integer', pattern: LexerType.NA },
      { name: 'Signed', pattern: LexerType.NA },
      {
        name: 'DimensionNum',
        pattern: ['({{number}})({{ident}}|%)', groupCapture],
        start_chars_hint: [
          '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
        ],
        line_breaks: false,
        categories: ['Dimension']
      },
      {
        name: 'DimensionInt',
        pattern: ['({{integer}})({{ident}}|%)', groupCapture],
        start_chars_hint: [
          '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
        ],
        line_breaks: false,
        categories: ['Dimension', 'Integer']
      },
      {
        name: 'SignedDimensionNum',
        pattern: ['([+-]{{number}})({{ident}}|%)', groupCapture],
        start_chars_hint: ['-', '+'],
        line_breaks: false,
        categories: ['Dimension', 'Signed']
      },
      {
        name: 'SignedDimensionInt',
        pattern: ['([+-]{{integer}})({{ident}}|%)', groupCapture],
        start_chars_hint: ['-', '+'],
        line_breaks: false,
        categories: ['Dimension', 'Integer', 'Signed']
      },
      {
        name: 'SignedInt',
        pattern: /[+-]\d+/,
        longer_alt: 'SignedDimensionInt',
        categories: ['Integer', 'Number', 'Signed']
      },
      {
        name: 'UnsignedInt',
        pattern: /\d+/,
        longer_alt: 'DimensionInt',
        categories: ['Integer', 'Number']
      },
      {
        name: 'SignedNum',
        pattern: '[+-]{{number}}',
        longer_alt: 'SignedDimensionNum',
        categories: ['Integer', 'Number', 'Signed']
      },
      {
        name: 'UnsignedNum',
        pattern: '{{number}}',
        longer_alt: 'DimensionNum',
        categories: ['Number']
      },
      {
        name: 'NthDimensionSigned',
        pattern: /[+-]\d+n/
      },
      {
        name: 'NthDimension',
        pattern: /\d+n/
      },
      /** Special functions */
      {
        name: 'Calc',
        pattern: /calc\(/i,
        categories: ['BlockMarker', 'Function']
      },
      {
        name: 'Var',
        pattern: /var\(/i,
        categories: ['BlockMarker', 'Function']
      },
      {
        name: 'Supports',
        pattern: /supports\(/i,
        categories: ['BlockMarker', 'Function']
      },
      {
        name: 'WS',
        pattern: '{{ws}}',
        line_breaks: true,
        label: SKIPPED_LABEL
      },
      {
        name: 'Comment',
        pattern: '{{comment}}',
        line_breaks: true,
        label: SKIPPED_LABEL
      }
    ],
    SingleQuoteString: [
      /**
       * Note that:
       *  - "\u0022" === `"`
       *  - "\u0027" === `'`
       *  - "\u005C" === `\`
       */
      {
        name: 'SingleQuoteStringContents',
        pattern: "(?:[\\u0000-\\u0026\\u0028-\\u005B\\u005D-\\uFFFF]|\\\\'|{{newline}}|{{escape}})+"
      },
      {
        name: 'SingleQuoteEnd',
        pattern: /'/,
        pop_mode: true
      }
    ],
    DoubleQuoteString: [
      {
        name: 'DoubleQuoteStringContents',
        pattern: '(?:[\\u0000-\\u0021\\u0023-\\u005B\\u005D-\\uFFFF]|\\\\"|{{newline}}|{{escape}})+'
      },
      {
        name: 'DoubleQuoteEnd',
        pattern: /"/,
        pop_mode: true
      }
    ],
    Url: [
      /** Reference: https://www.w3.org/TR/css-syntax-3/#consume-url-token */
      {
        name: 'NonQuotedUrl',
        /**
         * Equivalent to: /[^)(\'"]+/ but a-lot less clear :(
         * @see https://chevrotain.io/docs/guide/resolving_lexer_errors.html#COMPLEMENT
         *
         * Note that:
         *  - "\u0022" === `"`
         *  - "\u0027" === `'`
         *  - "\u0028" === `(`
         *  - "\u0029" === `)`
         *  - "\u005C" === `\`
         */
        pattern: '(?:[\\u0000-\\u0021\\u0023-\\u0026\\u002A-\\u005B\\u005D-\\uFFFF]|{{escape}})+'
      },
      {
        name: 'UrlEnd',
        pattern: /\)/,
        pop_mode: true
      },
      'SingleQuoteStart',
      'DoubleQuoteStart',
      'WS'
    ]
  },
  defaultMode: 'Default'
}) as const satisfies RawModeConfig

type TokenModes = ReturnType<typeof tokens>['modes']

export type TokenNameMap<T extends readonly any[]> = {
  [P in keyof T]: T[P] extends { name: string }
    ? T[P]['name']
    : T[P]
}
export type TokenNames<T extends readonly any[]> = TokenNameMap<T>[number]

/** Join all modes to get strong indexing */
export type CssTokenType = TokenNames<TokenModes[keyof TokenModes]>

export const cssTokens = () => tokens() as WritableDeep<ReturnType<typeof tokens>>
export const cssFragments = () => fragments()
