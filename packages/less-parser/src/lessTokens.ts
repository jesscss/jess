import {
  Fragments as CSSFragments,
  Tokens as CSSTokens,
  rawTokenConfig,
  LexerType,
  groupCapture
} from '@jesscss/css-parser'

interface IMerges {
  [key: string]: rawTokenConfig[]
}

export const Fragments = [...CSSFragments]
export let Tokens = [...CSSTokens]

Fragments.unshift(['lineComment', '\\/\\/[^\\n\\r]*'])
Fragments.push(['interpolated', '[@$]\\{({{ident}})\\}'])

Fragments.forEach(fragment => {
  if (fragment[0].indexOf('wsorcomment') !== -1) {
    fragment[1] = '(?:({{ws}})|({{comment}})|({{lineComment}}))'
  }
})

/** Keyed by what to insert after */
const merges: IMerges = {
  Assign: [
    { name: 'Ampersand', pattern: /&/, categories: ['Selector'] },
    { name: 'Ellipsis', pattern: /\.\.\./ }
  ],
  PlainIdent: [
    { name: 'Interpolated', pattern: LexerType.NA },
    {
      name: 'InterpolatedIdent',
      pattern: ['{{interpolated}}', groupCapture],
      categories: ['Interpolated', 'Selector'],
      start_chars_hint: ['@', '$']
    },
    /**
     * Unfortunately, there's grammatical ambiguity between
     * interpolated props and a naked interpolated selector name,
     * making this awkward token necessary.
     */
    {
      name: 'InterpolatedSelector',
      pattern: ['[.#:]{{interpolated}}', groupCapture],
      categories: ['Interpolated', 'Selector'],
      start_chars_hint: ['.', '#', ':']
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
      pattern: /when/,
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
      categories: ['VarOrProp']
    },
    {
      name: 'PropertyReference',
      pattern: '\\$-?{{ident}}',
      categories: ['VarOrProp']
    }
  ],
  // AtMedia: [
  //   {
  //     name: 'AtPlugin',
  //     pattern: /@plugin/,
  //     longer_alt: 'AtKeyword',
  //     categories: ['BlockMarker', 'AtName']
  //   }
  // ],
  PlainFunction: [
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
  Uri: [
    {
      name: 'JavaScript',
      pattern: /`[^`]*`/,
      group: LexerType.SKIPPED,
      line_breaks: true
    }
  ]
}

let tokenLength = Tokens.length
for (let i = 0; i < tokenLength; i++) {
  let token = Tokens[i]
  let { name, categories } = token
  const copyToken = () => {
    token = { ...token }
    categories = categories ? categories.slice(0) : []
  }
  let alterations = true

  switch (name) {
    // Removed in Less v5
    // case 'Divide':
    //   copyToken()
    //   token.pattern = /\.?\//
    //   break
    case 'StringLiteral':
      copyToken()
      token.pattern = '~?{{string1}}|~?{{string2}}'
      break
    case 'CustomProperty':
      copyToken()
      token.pattern = '--(?:{{nmstart}}{{nmchar}}*)?'
      break
    case 'AtKeyword':
      copyToken()
      token.categories = categories.concat(['VarOrProp'])
      break
    default:
      alterations = false
  }
  if (alterations) {
    Tokens[i] = token
  }
  const merge = merges[name]
  if (merge) {
    /** Insert after current token */
    Tokens = Tokens.slice(0, i + 1).concat(merge, Tokens.slice(i + 1))
    const mergeLength = merge.length
    tokenLength += mergeLength
    i += mergeLength
  }
}
