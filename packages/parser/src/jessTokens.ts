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
// Fragments.push(['interpolated', '[@$]\\{({{ident}})\\}'])

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
  Ident: [
    {
      name: 'JsIdent',
      pattern: /[a-zA-Z_]+/,
      categories: ['Ident']
    }
  ],
  PlainIdent: [
    /** For import statements */
    {
      name: 'From',
      pattern: /from\(/,
      longer_alt: 'PlainIdent',
      categories: ['Ident']
    },
    {
      name: 'As',
      pattern: /as\(/,
      longer_alt: 'PlainIdent',
      categories: ['Ident']
    },
  ],
  Uri: [
    {
      name: 'JSStringLiteral',
      pattern: /`[^`]*`/,
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
