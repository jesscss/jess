/* eslint-disable @typescript-eslint/restrict-plus-operands */
import {
  cssFragments,
  cssTokens,
  LexerType,
  groupCapture,
  type RawTokenConfig,
  type RawToken,
  type TokenNames,
  type CssTokenType
} from '@jesscss/css-parser'
import type { WritableDeep } from 'type-fest'

type IMerges = Partial<Record<CssTokenType, RawTokenConfig>>

export const Fragments = cssFragments()
export const Tokens = cssTokens()

Fragments.unshift(['lineComment', '\\/\\/[^\\n\\r]*'])
Fragments.push(['interpolated', '[@$]\\{({{ident}})\\}'])

/** Keyed by what to insert after */
const merges = {
  Assign: [
    { name: 'Ellipsis', pattern: /\.\.\./ }
  ],
  PlainIdent: [
    { name: 'Interpolated', pattern: LexerType.NA },
    {
      name: 'LineComment',
      pattern: '{{lineComment}}',
      group: 'Skipped'
    },
    {
      name: 'InterpolatedIdent',
      pattern: ['{{interpolated}}', groupCapture],
      categories: ['Interpolated', 'Selector'],
      start_chars_hint: ['@', '$'],
      line_breaks: true
    },
    /**
     * Unfortunately, there's grammatical ambiguity between
     * interpolated props and a naked interpolated selector name,
     * making this awkward token necessary.
     */
    {
      name: 'InterpolatedSelector',
      pattern: ['[.#]{{interpolated}}', groupCapture],
      categories: ['Interpolated', 'Selector'],
      start_chars_hint: ['.', '#'],
      line_breaks: true
    },
    { name: 'PlusAssign', pattern: '\\+{{whitespace}}*:', categories: ['BlockMarker', 'Assign'] },
    {
      name: 'UnderscoreAssign',
      pattern: '\\+{{whitespace}}*_{{whitespace}}*:',
      categories: ['BlockMarker', 'Assign']
    },
    { name: 'AnonMixinStart', pattern: /[.#]\(/, categories: ['BlockMarker'] },
    { name: 'GtEqAlias', pattern: /=>/, categories: ['CompareOperator'] },
    { name: 'LtEqAlias', pattern: /=</, categories: ['CompareOperator'] },
    {
      name: 'Extend',
      pattern: /:extend\(/,
      categories: ['BlockMarker']
    },
    {
      name: 'When',
      pattern: /when/i,
      longer_alt: 'PlainIdent',
      categories: ['BlockMarker']
    },
    {
      name: 'VarOrProp',
      pattern: LexerType.NA
    },
    {
      name: 'NestedReference',
      pattern: ['([@$]+{{ident}}?){2,}', groupCapture],
      start_chars_hint: ['@', '$'],
      categories: ['VarOrProp'],
      line_breaks: true
    },
    {
      name: 'PropertyReference',
      // eslint-disable-next-line no-template-curly-in-string
      pattern: '\\${{ident}}',
      categories: ['VarOrProp']
    },
    /** Can be used in unit function */
    {
      name: 'Percent',
      pattern: /%/
    },
    {
      name: 'FormatFunction',
      pattern: /%\(/,
      categories: ['BlockMarker', 'Function']
    },
    {
      name: 'IfFunction',
      pattern: /if\(/,
      categories: ['BlockMarker', 'Function']
    },
    {
      name: 'BooleanFunction',
      pattern: /boolean\(/,
      categories: ['BlockMarker', 'Function']
    }
  ],
  UrlStart: [
    {
      name: 'JavaScript',
      pattern: /`[^`]*`/,
      group: LexerType.SKIPPED,
      line_breaks: true
    }
  ]
} as const satisfies IMerges

let defaultTokens: WritableDeep<RawToken[]> = Tokens.modes.Default

let tokenLength = defaultTokens.length
for (let i = 0; i < tokenLength; i++) {
  let token = defaultTokens[i]

  const { name, categories } = token
  const copyToken = () => {
    token = structuredClone(token)
  }

  let alterations = true

  switch (name) {
    // Removed in Less v5
    // case 'Divide':
    //   copyToken()
    //   token.pattern = /\.?\//
    //   break
    case 'SingleQuoteStart':
      copyToken()
      token.pattern = /~?'/
      break
    case 'DoubleQuoteStart':
      copyToken()
      token.pattern = /~?"/
      break
    case 'CustomProperty':
      copyToken()
      token.pattern = '--(?:{{nmstart}}{{nmchar}}*)?'
      break
    case 'AtKeyword':
      copyToken()
      token.categories = categories ? categories.concat(['VarOrProp']) : ['VarOrProp']
      break
    default:
      alterations = false
  }
  if (alterations) {
    defaultTokens[i] = token
  }
  // @ts-expect-error - Suppress index warning
  const merge = merges[name]
  if (merge) {
    /** Insert after current token */
    defaultTokens = defaultTokens.slice(0, i + 1).concat(merge, defaultTokens.slice(i + 1))
    ;(Tokens.modes.Default as WritableDeep<RawToken[]>) = defaultTokens
    const mergeLength = merge.length
    tokenLength += mergeLength
    i += mergeLength
  }
}

type MergeMap = {
  [K in keyof typeof merges]: typeof merges[K]
}

export type LessTokenType = CssTokenType | TokenNames<MergeMap[keyof MergeMap]>

export const lessFragments = () => Fragments
export const lessTokens = () => Tokens