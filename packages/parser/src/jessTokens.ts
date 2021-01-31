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
// Fragments.push(['jsident', '[_a-zA-Z]\\w*'])
/** Not sure we need all these back-slashes for ` marks */
Fragments.push(['string3', "\\`(\\\\`|[^\\n\\r\\f\\`]|{{newline}}|{{escape}})*\\`"])

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
  AtImport: [
    {
      name: 'AtMixin',
      pattern: /@mixin/,
      longer_alt: 'AtKeyword',
      categories: ['BlockMarker', 'AtName']
    },
    {
      name: 'AtLet',
      pattern: /@let/,
      longer_alt: 'AtKeyword',
      categories: ['BlockMarker', 'AtName']
    },
    {
      name: 'AtInclude',
      pattern: /@include/,
      longer_alt: 'AtKeyword',
      categories: ['BlockMarker', 'AtName']
    }
  ],
  PlainFunction: [
    {
      name: 'From',
      pattern: /from/,
      longer_alt: 'PlainIdent',
      categories: ['Ident']
    },
    {
      name: 'As',
      pattern: /as/,
      longer_alt: 'PlainIdent',
      categories: ['Ident']
    }
  ],
  Tilde: [
    {
      name: 'JsStart',
      pattern: /\$/,
      categories: ['BlockMarker']
    }
  ],
  HashName: [
    /** We'll have to change class name parsing */
    {
      name: 'Dot',
      pattern: /\./,
      longer_alt: 'Ellipsis'
    },
    {
      name: 'NotMark',
      pattern: /!/,
      longer_alt: 'Important'
    }
  ]
  /** 
   * @todo - allow JS expressions within string literals
   * Result will be a CSS string literal with a J.call() in it
  */
  // Uri: [
  //   {
  //     name: 'JSStringLiteral',
  //     pattern: '{{string3}}',
  //     line_breaks: true
  //   }
  // ]
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
    case 'StringLiteral':
      copyToken()
      token.pattern = '~?(?:{{string1}}|{{string2}}|{{string3}})'
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
