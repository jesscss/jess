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
Fragments.push(['jsident', '[_a-zA-Z]\\w*'])
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
    },
    {
      name: 'AtNest',
      pattern: /@nest/,
      longer_alt: 'AtKeyword',
      categories: ['BlockMarker', 'AtName']
    }
  ],
  PlainIdent: [
    {
      name: 'JsIdent',
      pattern: LexerType.NA
    }
  ],
  DashIdent: [
    // {
    //   name: 'JsIdentMatch',
    //   pattern: '{{jsident}}',
    //   categories: ['Ident', 'JsIdent', 'PropertyName', 'Selector'],
    //   longer_alt: 'PlainIdent'
    // },
    /** For import statements */
    {
      name: 'From',
      pattern: /from/,
      longer_alt: 'DashIdent',
      categories: ['Ident', 'JsIdent']
    },
    {
      name: 'As',
      pattern: /as/,
      longer_alt: 'DashIdent',
      categories: ['Ident', 'JsIdent']
    }
  ],
  PlainFunction: [
    {
      name: 'JsFunction',
      pattern: '{{jsident}}\\(',
      categories: ['BlockMarker', 'Function']
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
      pattern: /\./
    }
  ],
  /** 
   * @todo - allow JS expressions within string literals
   * Result will be a CSS string literal with a J.call() in it
  */
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
    /** Escape quotes like Less? */
    case 'StringLiteral':
      copyToken()
      token.pattern = '~?(?:{{string1}}|{{string2}}|{{string3}})'
      break
    /** We need to identify these as JS identifiers */
    case 'NonDashIdent':
      copyToken()
      token.categories = categories.concat(['JsIdent'])
      break
    case 'AttrFlag':
    case 'And':
    case 'Or':
    case 'Not':
    case 'Only':
      copyToken()
      token.longer_alt = 'DashIdent'
      token.categories = categories.concat(['JsIdent'])
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
