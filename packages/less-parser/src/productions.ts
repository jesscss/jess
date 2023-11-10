/* eslint-disable no-cond-assign */
import { type LessActionsParser as P, type TokenMap, type RuleContext } from './lessActionsParser'
import {
  tokenMatcher,
  type IToken,
  EMPTY_ALT
} from 'chevrotain'
import {
  main as cssMain,
  declaration as cssDeclaration,
  mediaInParens as cssMediaInParens,
  simpleSelector as cssSimpleSelector,
  unknownAtRule as cssUnknownAtRule,
  nthValue as cssNthValue,
  knownFunctions as cssKnownFunctions,
  mathValue as cssMathValue,
  innerAtRule as cssInnerAtRule
} from '@jesscss/css-parser'

import {
  type TreeContext,
  type Scope,
  Node,
  Ampersand,
  Block,
  Token,
  type LocationInfo,
  type Operator,
  General,
  Ruleset,
  type SimpleSelector,
  SelectorSequence,
  Combinator,
  List,
  Sequence,
  Call,
  Paren,
  Operation,
  Quoted,
  AtRule,
  Interpolated,
  type Name,
  Reference,
  Extend,
  ExtendList,
  Negative,
  Mixin,
  Import,
  Condition,
  VarDeclaration,
  DefaultGuard,
  Lookup,
  Rest
} from '@jesscss/core'

const isEscapedString = function(this: P, T: TokenMap) {
  const next = this.LA(1)
  return tokenMatcher(next, T.QuoteStart) && next.image.startsWith('~')
}

/** Charset moved within `main` (explained in that rule) */
export function stylesheet(this: P, T: TokenMap) {
  const $ = this

  // stylesheet
  //   : CHARSET? main EOF
  //   ;
  return (options: Record<string, any> = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    let context: TreeContext
    let initialScope: Scope
    if (!RECORDING_PHASE) {
      if (options.context) {
        context = this._context = options.context
      } else {
        context = this.context
      }
      initialScope = context.scope
    }

    let charset: IToken | undefined

    $.OPTION({
      GATE: () => !$.looseMode,
      DEF: () => {
        charset = $.CONSUME(T.Charset)
      }
    })

    let root: Node = $.SUBRULE($.main, { ARGS: [{ isRoot: true }] })

    if (!RECORDING_PHASE) {
      let rules: Node[] = root.value

      if (charset) {
        let loc = $.getLocationInfo(charset)
        let rootLoc = root.location
        rules.unshift(new Token(charset.image, { type: 'Charset' }, loc, context!))
        rootLoc[0] = loc[0]
        rootLoc[1] = loc[1]
        rootLoc[2] = loc[2]
      }

      this.context.scope = initialScope!
      return root
    }
  }
}

export function main(this: P, T: TokenMap) {
  const $ = this

  let ruleAlt = [
    { ALT: () => $.SUBRULE($.mixinDefinition) },
    { ALT: () => $.SUBRULE($.functionCall) },
    { ALT: () => $.SUBRULE($.extendList) },
    { ALT: () => $.SUBRULE($.qualifiedRule) },
    { ALT: () => $.SUBRULE($.atRule) },

    /**
     * Historically, Less allows `@charset` anywhere,
     * to avoid outputting it in the wrong place.
     * Ideally, this would result in an error if, say,
     * the `@charset` was defined at the bottom of the file,
     * but that wasn't the solution made.
     * @see https://github.com/less/less.js/issues/2126
     */
    {
      GATE: () => $.looseMode,
      ALT: () => $.CONSUME(T.Charset)
    },
    { ALT: () => $.CONSUME2(T.Semi) },
    { ALT: () => $.SUBRULE($.mixinCall) }
  ]

  return cssMain.call(this, T, ruleAlt)
}

export function declarationList(this: P, T: TokenMap) {
  const $ = this

  let ruleAlt = [
    { ALT: () => $.SUBRULE($.declaration) },
    { ALT: () => $.SUBRULE($.mixinCall) },
    { ALT: () => $.SUBRULE($.functionCall) },
    { ALT: () => $.SUBRULE($.mixinDefinition) },
    { ALT: () => $.SUBRULE($.innerAtRule) },
    { ALT: () => $.SUBRULE($.extendList) },
    { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [{ inner: true }] }) },
    { ALT: () => $.CONSUME2(T.Semi) }
  ]

  return cssMain.call(this, T, ruleAlt)
}

let interpolatedRegex = /([$@]){([^}]+)}/g
let charPlaceholder = String.fromCharCode(0)

const getInterpolated = (name: string, location: LocationInfo, context: TreeContext): Interpolated => {
  let nodes: Node[] = []
  let result: RegExpExecArray | null

  let outputName = name

  while (result = interpolatedRegex.exec(name)) {
    let [match, propOrVar, value] = result
    outputName = outputName.replace(match, charPlaceholder)
    nodes.push(new Reference(value!, { type: propOrVar === '$' ? 'property' : 'variable' }))
  }
  return new Interpolated([
    ['value', outputName],
    ['replacements', nodes]
  ], undefined, location, context)
}

export function declaration(this: P, T: TokenMap) {
  const $ = this

  let ruleAlt = [
    {
      ALT: () => {
        let name: IToken
        $.OR2([
          {
            ALT: () => name = $.CONSUME(T.Ident)
          },
          {
            GATE: () => $.legacyMode,
            ALT: () => name = $.CONSUME(T.LegacyPropIdent)
          }
        ])
        let assign = $.CONSUME(T.Assign)
        let value = $.SUBRULE($.valueList)
        let important: IToken | undefined

        $.OPTION(() => {
          important = $.CONSUME(T.Important)
        })
        if (!$.RECORDING_PHASE) {
          let nameNode: Name
          let nameValue = name!.image
          if (nameValue.includes('@') || nameValue.includes('$')) {
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name!), this.context)
          } else {
            nameNode = $.wrap(new General(name!.image, { type: 'Name' }, $.getLocationInfo(name!), this.context), true)
          }
          return [nameNode, assign, value, important]
        }
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE
        let nodes: Node[]
        if (!RECORDING_PHASE) {
          nodes = []
        }
        let name = $.OR3([
          { ALT: () => $.CONSUME(T.InterpolatedCustomProperty) },
          { ALT: () => $.CONSUME(T.CustomProperty) }
        ])
        let assign = $.CONSUME2(T.Assign)
        $.startRule()
        $.MANY(() => {
          let val = $.SUBRULE($.customValue)
          if (!RECORDING_PHASE) {
            nodes!.push(val)
          }
        })
        if (!RECORDING_PHASE) {
          let location = $.endRule()
          let nameNode: Name
          let nameValue = name.image
          if (nameValue.includes('@') || nameValue.includes('$')) {
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name), this.context)
          } else {
            nameNode = $.wrap(new General(name.image, { type: 'Name' }, $.getLocationInfo(name), this.context), true)
          }
          let value = new Sequence(nodes!, undefined, location, this.context)
          return [nameNode, assign, value]
        }
      }
    }
  ]

  return cssDeclaration.call(this, T, ruleAlt)
}

export function mediaInParens(this: P, T: TokenMap) {
  const $ = this

  let isEscaped = isEscapedString.bind(this, T)

  return () =>
    $.OR([
      /**
       * It's up to the Less author to validate that this will produce
       * valid media queries.
       */
      {
        /** Allow escaped strings */
        GATE: isEscaped,
        ALT: () => $.SUBRULE($.string)
      },
      /**
       * After Less evaluation, should throw an error
       * if the value of `@myvar` is a ruleset
       */
      { ALT: () => $.SUBRULE($.valueReference, { ARGS: [{ requireAccessorsAfterMixinCall: true }] }) },
      {
        ALT: cssMediaInParens.call(this, T)
      }
    ])
}

export function mfValue(this: P, T: TokenMap) {
  const $ = this

  return () =>
    /**
     * Like the original Less Parser, we're
     * going to allow any value expression,
     * and it's up to the Less author to know
     * if it's valid.
     */
    $.SUBRULE($.expressionSum)
}

export function wrappedDeclarationList(this: P, T: TokenMap) {
  const $ = this
  return () => {
    $.CONSUME(T.LCurly)
    let rules = $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
    return rules
  }
}

export function qualifiedRule(this: P, T: TokenMap) {
  const $ = this

  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  return (ctx: RuleContext = {}) => {
    $.startRule()

    let selector = $.OR([
      {
        GATE: () => !ctx.inner,
        ALT: () => $.SUBRULE($.selectorList, { ARGS: [{ ...ctx, qualifiedRule: true }] })
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => $.SUBRULE($.forgivingSelectorList, { ARGS: [{ ...ctx, firstSelector: true, qualifiedRule: true }] })
      }
    ])

    let guard: Condition | undefined

    $.OPTION(() => {
      guard = $.SUBRULE($.guard)
    })

    $.CONSUME(T.LCurly)
    let rules = $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new Ruleset([
        ['selector', selector],
        ['rules', rules],
        ['guard', guard]
      ], undefined, location, this.context)
    }
  }
}

export function complexSelector(this: P, T: TokenMap) {
  const $ = this

  /**
      A sequence of one or more simple and/or compound selectors
      that are separated by combinators.
        .e.g. a#selected > .icon
    */
  // complexSelector
  //   : compoundSelector (WS* (combinator WS*)? compoundSelector)*
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let selectors: Node[] = $.SUBRULE($.compoundSelector, { ARGS: [ctx] })

    /**
     * Only space combinators and specified combinators will enter the MANY
     */
    $.MANY({
      GATE: () => $.hasWS() || tokenMatcher($.LA(1), T.Combinator),
      DEF: () => {
        let co: IToken | undefined
        let combinator: Node
        $.OPTION(() => {
          co = $.CONSUME(T.Combinator)
        })
        if (!RECORDING_PHASE) {
          if (co) {
            combinator = $.wrap(new Combinator(co.image, undefined, $.getLocationInfo(co), this.context), 'both')
          } else {
            let startOffset = this.LA(1).startOffset
            combinator = new Combinator('', undefined, 0, this.context)
            combinator.pre = $.getPrePost(startOffset)
          }
        }
        let compound = $.SUBRULE2($.compoundSelector, { ARGS: [ctx] })
        if (!RECORDING_PHASE) {
          selectors.push(
            combinator!,
            ...compound
          )
        }
      }
    })

    let node: SelectorSequence | Extend

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      node = new SelectorSequence(selectors as Array<SimpleSelector | Combinator>, undefined, location, this.context)
    }

    $.OPTION2({
      GATE: () => !!ctx.qualifiedRule,
      DEF: () => {
        node = $.SUBRULE($.extend, { ARGS: [node as SelectorSequence] })
      }
    })
    return node!
  }
}

/**
 * A list of selectors, all with extends, ending with
 * a semi-colon.
 */
export function extendList(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let nodes: Array<SelectorSequence | Extend>

    if (!RECORDING_PHASE) {
      nodes = []
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let node: SelectorSequence | Extend | undefined
        $.OPTION(() => {
          node = $.OR([
            {
              GATE: () => !!ctx.inner,
              ALT: () => $.SUBRULE($.relativeSelector, { ARGS: [ctx] })
            },
            {
              GATE: () => !ctx.inner,
              ALT: () => $.SUBRULE($.complexSelector, { ARGS: [ctx] })
            }
          ])
        })
        node = $.SUBRULE($.extend, { ARGS: [node as SelectorSequence | undefined] })
        if (!RECORDING_PHASE) {
          nodes.push(node as Extend)
        }
      }
    })

    $.CONSUME(T.Semi)

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      return new ExtendList(nodes! as Extend[], undefined, location, this.context)
    }
  }
}

export function extend(this: P, T: TokenMap) {
  const $ = this

  return (selector: SelectorSequence | undefined) => {
    let start = $.CONSUME(T.Extend)
    let target = $.SUBRULE($.selectorList)
    let flag: IToken | undefined
    $.OPTION(() => flag = $.CONSUME(T.All))
    let end = $.CONSUME(T.RParen)
    if (!$.RECORDING_PHASE) {
      let startOffset: number
      let startLine: number
      let startColumn: number
      if (selector) {
        let location = selector.location
        startOffset = location[0]!
        startLine = location[1]!
        startColumn = location[2]!
      } else {
        let loc = start
        startOffset = loc.startOffset
        startLine = loc.startLine!
        startColumn = loc.startColumn!
      }
      let { endOffset, endLine, endColumn } = end
      return new Extend(
        [
          ['selector', selector],
          ['target', target],
          ['flag', flag ? '!all' : undefined]
        ],
        undefined,
        [startOffset, startLine, startColumn, endOffset!, endLine!, endColumn!],
        this.context
      )
    }
  }
}

export function simpleSelector(this: P, T: TokenMap) {
  const $ = this

  let selectorAlt = (ctx: RuleContext) => [
    {
      /** In Less/Sass (and now CSS), the first inner selector can be an identifier */
      ALT: () => $.CONSUME(T.Ident)
    },
    {
      /**
       * Unlike CSS Nesting, Less allows outer qualified rules
       * to have `&`, and it is just silently absorbed if there
       * is no parent selector.
       */
      ALT: () => {
        let amp = $.CONSUME(T.Ampersand)
        if (!$.RECORDING_PHASE) {
          let ampImg = amp.image
          let value = ampImg.slice(1)
          return new Ampersand(value || undefined, undefined, $.getLocationInfo(amp), this.context)
        }
      }
    },
    { ALT: () => $.CONSUME(T.InterpolatedSelector) },
    { ALT: () => $.SUBRULE($.classSelector) },
    { ALT: () => $.SUBRULE($.idSelector) },
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.attributeSelector) }
  ]

  return cssSimpleSelector.call(this, T, selectorAlt)
}

export function anonymousMixinDefinition(this: P, T: TokenMap) {
  const $ = this

  return () => {
    $.startRule()
    let params: List | undefined
    $.OPTION(() => {
      $.CONSUME(T.AnonMixinStart)
      params = $.SUBRULE($.mixinArgList, { ARGS: [{ isDefinition: true }] })
      $.CONSUME(T.RParen)
    })
    let rules = $.SUBRULE($.wrappedDeclarationList)

    if (!$.RECORDING_PHASE) {
      return new Mixin([
        ['params', params],
        ['rules', rules]
      ], undefined, $.endRule(), this.context)
    }
  }
}

/**
 * Mostly copied from css importAtRule, but it maps
 * differently to Jess nodes depending on if it's meant
 * to be a Jess-style import or just an at-rule
 */
export function importAtRule(this: P, T: TokenMap) {
  const $ = this

  const isCssUrl = (url: string) =>
    url.endsWith('.css') || url.startsWith('http')

  const getUrlFromNode = (urlNode: Quoted | Call): string => {
    let url: string = ''
    if (urlNode instanceof Quoted) {
      let contents = urlNode.value
      url = contents.value
    } else {
      let innerUrlNode = urlNode.args!.value[0]!
      /**
       * A url function will have either a quoted value
       * or a general (un-quoted) value
       */
      if (innerUrlNode instanceof Quoted) {
        let contents = innerUrlNode.value
        url = contents.value
      } else if (innerUrlNode instanceof General) {
        url = innerUrlNode.value
      }
    }
    return url
  }

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let name = $.CONSUME(T.AtImport)

    let options: string[]

    if (!RECORDING_PHASE) {
      options = []
    }

    $.OPTION(() => {
      $.CONSUME(T.LParen)
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          let opt = $.CONSUME(T.PlainIdent)
          if (!RECORDING_PHASE) {
            options!.push(opt.image)
          }
        }
      })
      $.CONSUME(T.RParen)
    })

    let urlNode: Quoted | Call = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction) },
      { ALT: () => $.SUBRULE($.string) }
    ])

    let isAtRule: boolean | undefined

    if (!RECORDING_PHASE) {
      if (options!.includes('css')) {
        isAtRule = true
      } else {
        let url = getUrlFromNode(urlNode)
        if (isCssUrl(url)) {
          isAtRule = true
        }
      }
    }

    let preludeNodes: Node[]

    if (!RECORDING_PHASE) {
      preludeNodes = [$.wrap(urlNode)]
    }

    $.OPTION2(() => {
      isAtRule = true
      let start = $.CONSUME(T.Supports)
      let value = $.OR2([
        { ALT: () => $.SUBRULE($.supportsCondition) },
        { ALT: () => $.SUBRULE($.declaration) }
      ])
      let end = $.CONSUME2(T.RParen)

      if (!RECORDING_PHASE) {
        let { startOffset, startLine, startColumn } = start
        let { endOffset, endLine, endColumn } = end
        preludeNodes.push(
          $.wrap(
            new Call(
              [
                ['name', 'supports'],
                ['args', $.wrap(value, 'both')]
              ],
              undefined,
              [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!],
              this.context
            )
          )
        )
      }
    })

    $.OPTION3(() => {
      isAtRule = true
      let node = $.SUBRULE($.mediaQuery)
      if (!RECORDING_PHASE) {
        preludeNodes.push(node)
      }
    })

    $.CONSUME(T.Semi)

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      if (isAtRule) {
        return new AtRule([
          ['name', $.wrap(new General(name.image, { type: 'Name' }, $.getLocationInfo(name), this.context), true)],
          ['prelude', new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context)]
        ], undefined, location, this.context)
      }
      return new Import(
        [
          ['path', getUrlFromNode(urlNode)],
          ['importType', 'less'],
          /**
           * If this is inline, it will end up using Jess's text plugin,
           * but the Less plugin handles url resolving.
           */
          ['pluginOptions', options!.includes('inline') ? { inline: true } : {}]
        ],
        {
          reference: true,
          include: !options!.includes('reference'),
          useParentScope: true
        },
        location,
        this.context
      )
    }
  }
}

/* This is for variable variables (e.g. `@id-@num`) */
const getInterpolatedOrString = (name: string): Interpolated | string => {
  let nextPos = name.indexOf('@', 1)
  if (nextPos === -1) {
    nextPos = name.indexOf('$', 1)
  }
  if (nextPos === -1) {
    return name.slice(1)
  }
  let start = name.slice(1, nextPos)
  let end = name.slice(nextPos)

  return new Interpolated([
    ['value', start + charPlaceholder],
    ['replacements', [
      new Reference(
        getInterpolatedOrString(end),
        { type: end.startsWith('@') ? 'variable' : 'property' }
      )
    ]]
  ])
}

/** Less variables */
export function unknownAtRule(this: P, T: TokenMap) {
  const $ = this

  /**
   * Starts with a colon, with these conditions
   *  1. It is not preceded by a space or
   *  2. If it is preceded by a space, then it is
   *     followed by a space.
   */
  const isVariableLike = () => {
    if ($.LA(1).tokenType === T.AtKeywordLessExtension) {
      return true
    }
    let token = $.LA(2)
    let isColon = token.tokenType === T.Colon
    if (!isColon) {
      return false
    }
    let isVariable = !$.preSkippedTokenMap.has(token.startOffset) ||
      $.postSkippedTokenMap.has(token.endOffset!)
    return isVariable
  }

  const isNotVariableLike = () => !isVariableLike()

  let nameAlt = [
    { ALT: () => $.SUBRULE($.varName) },
    { ALT: () => $.CONSUME(T.NestedReference) }
  ]

  return () => {
    $.startRule()

    let name: IToken
    let value: Node | undefined
    let args: List | undefined
    let important: IToken | undefined

    let returnVal: Node | undefined = $.OR2([
      {
        /**
         * This is a variable declaration
         * Disallows `@atrule :foo;` because it resembles a pseudo-selector
         */
        GATE: isVariableLike,
        ALT: () => {
          name = $.OR3(nameAlt)
          $.CONSUME(T.Colon)
          return $.OR4([
            /**
             * This needs to be gated early, even though it is
             * gated again in the valueList production, because
             * chevrotain-allstar needs to pick a path first.
             */
            {
              GATE: () => {
                let type = $.LA(1).tokenType
                return type === T.AnonMixinStart || type === T.LCurly
              },
              ALT: () => {
                value = $.SUBRULE($.anonymousMixinDefinition)
                $.OPTION2(() => $.CONSUME2(T.Semi))
                return value
              }
            },
            {
              GATE: () => {
                let type = $.LA(1).tokenType
                return type !== T.AnonMixinStart && type !== T.LCurly
              },
              ALT: () => {
                value = $.SUBRULE($.valueList, { ARGS: [{ allowMixinCallWithoutAccessor: true }] })
                $.OPTION(() => {
                  important = $.CONSUME(T.Important)
                })
                return value
              }
            }
          ])
        }
      },
      /** This is a variable call */
      {
        GATE: () => $.noSep(1) && $.LA(2).tokenType === T.LParen,
        /**
         * This is a change from Less 1.x-4.x
         * e.g.
         * ```
         * @dr: #(@var1, @var2) {
         *   // ...
         * }
         * @dr(arg1, arg2);
         */
        ALT: () => {
          name = $.SUBRULE2($.varName)
          args = $.SUBRULE($.mixinArgs)
          return args
        }
      },
      /** Just a regular unknown at-rule */
      {
        GATE: isNotVariableLike,
        ALT: cssUnknownAtRule.call(this, T)
      }
    ])

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      if (returnVal instanceof AtRule) {
        return returnVal
      }
      let nameVal: string | Interpolated = getInterpolatedOrString(name!.image)
      let nameNode: Interpolated | General<'Name'>
      if (!(nameVal instanceof Interpolated)) {
        nameNode = new General(nameVal, { type: 'Name' }, $.getLocationInfo(name!), this.context)
      } else {
        nameNode = nameVal
      }

      /** An anonymous mixin call */
      if (!value) {
        return new Call([
          ['name', nameNode],
          ['args', args!]
        ], undefined, location, this.context)
      }

      return new VarDeclaration([
        ['name', $.wrap(nameNode, true)],
        ['value', $.wrap(value, true)],
        ['important', important ? $.wrap(new General(important.image, { type: 'Flag' }, $.getLocationInfo(important), this.context), true) : undefined]
      ], undefined, location, this.context)
    }
  }
}

export function valueSequence(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let nodes: Node[]

    if (!RECORDING_PHASE) {
      nodes = []
    }

    $.OR([
      {
        GATE: () => $.looseMode,
        ALT: () => {
          $.MANY(() => {
            let value = $.SUBRULE($.expressionSum, { ARGS: [ctx] })
            if (!RECORDING_PHASE) {
              nodes.push(value)
            }
          })
        }
      },
      {
        GATE: () => !$.looseMode,
        /** @todo - create warning if there isn't a value */
        ALT: () => {
          $.AT_LEAST_ONE(() => {
            let value = $.SUBRULE2($.expressionSum, { ARGS: [ctx] })
            if (!RECORDING_PHASE) {
              nodes.push(value)
            }
          })
        }
      }
    ])

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      if (nodes!.length === 1) {
        return nodes![0]
      }
      return new Sequence(nodes!, undefined, location, this.context)
    }
  }
}

export function squareValue(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    $.startRule()
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.CONSUME(T.LSquare)
    let node: Node = $.OR([
      {
        GATE: () => !$.looseMode,
        ALT: () => {
          let ident = $.CONSUME(T.Ident)
          if (!RECORDING_PHASE) {
            return new General(ident.image, { type: 'CustomIdent' }, $.getLocationInfo(ident), this.context)
          }
        }
      },
      {
        GATE: () => !!$.looseMode,
        ALT: () => {
          let nodes: Node[]
          if (!RECORDING_PHASE) {
            nodes = []
          }
          $.MANY(() => {
            let node = $.SUBRULE($.anyInnerValue)
            if (!RECORDING_PHASE) {
              nodes.push($.wrap(node))
            }
          })
          if (!RECORDING_PHASE) {
            return new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context)
          }
        }
      }
    ])
    $.CONSUME(T.RSquare)
    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new Block(node, { type: 'square' }, location, this.context)
    }
  }
}

/**
 * In CSS, would be a single value.
 * In Less, these are math expressions which
 * represent a single value. During AST construction,
 * these will be grouped by order of operations.
 */
export function expressionSum(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let left = $.SUBRULE($.expressionProduct, { ARGS: [ctx] })

    $.MANY({
      /**
       * What this GATE does. We need to dis-ambiguate
       * 1 -1 (a value sequence) from 1-1 (a Less expression),
       * so Less is white-space sensitive here.
       */
      GATE: () => {
        const next = $.LA(1)
        const nextType = next.tokenType
        return (
          nextType === T.Plus ||
          nextType === T.Minus
        ) || ($.noSep() && tokenMatcher(next, T.Signed))
      },
      DEF: () => {
        let op: string | undefined
        let signed: IToken | undefined
        let right: Node

        $.OR([
          {
            ALT: () => {
              let opToken = $.OR2([
                { ALT: () => $.CONSUME(T.Plus) },
                { ALT: () => $.CONSUME(T.Minus) }
              ])
              if (!RECORDING_PHASE) {
                op = opToken.image
              }
              right = $.SUBRULE2($.expressionProduct, { ARGS: [ctx] })
            }
          },
          /** This will be interpreted by Less as a complete expression */
          {
            ALT: () => {
              signed = $.CONSUME(T.Signed)
              if (!RECORDING_PHASE) {
                let str = signed.image
                op = str[0]
                /** Alter the token (removing the sign) and continue processing */
                signed.image = str.slice(1)
                /** For dimensions with captured units */
                if (signed.payload) {
                  signed.payload[0] = signed.payload[0].slice(1)
                }
                signed.startOffset += 1
                signed.startColumn! += 1
                /**
                 * Back up the parser and re-parse the value
                 * with the sign removed
                 */
                $.currIdx -= 1
                right = $.SUBRULE3($.expressionProduct, { ARGS: [ctx] })
              }
            }
          }
        ])

        if (!RECORDING_PHASE) {
          left = $.wrap(
            new Operation(
              [$.wrap(left, true), op as Operator, $.wrap(right!)],
              undefined,
              $.getLocationFromNodes([left, right!]),
              this.context
            )
          )
          return left
        }
      }
    })

    if (!RECORDING_PHASE) {
      left.location = $.endRule()
      return left
    }
  }
}

export function expressionProduct(this: P, T: TokenMap) {
  const $ = this

  let opAlt = [
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.CONSUME(T.Slash) },
    { ALT: () => $.CONSUME(T.Percent) }
  ]

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let left = $.SUBRULE($.expressionValue, { ARGS: [ctx] })

    $.MANY(() => {
      let op = $.OR(opAlt)
      let right: Node = $.SUBRULE2($.expressionValue, { ARGS: [ctx] })

      if (!RECORDING_PHASE) {
        left = $.wrap(
          new Operation(
            [$.wrap(left, true), op.image as Operator, $.wrap(right)],
            undefined,
            $.getLocationFromNodes([left, right]),
            this.context
          )
        )
      }
    })

    if (!RECORDING_PHASE) {
      left.location = $.endRule()
      return left
    }
  }
}

export function expressionValue(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    /** Can create a negative expression */
    let minus = $.OPTION(() => $.CONSUME(T.Minus))
    let node = $.OR([
      {
        ALT: () => {
          $.startRule()
          let escape: IToken | undefined
          $.OPTION2(() => {
            escape = $.CONSUME(T.Tilde)
          })

          $.CONSUME(T.LParen)
          let node = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] })
          $.CONSUME(T.RParen)

          if (!RECORDING_PHASE) {
            let location = $.endRule()
            node = $.wrap(node, 'both')
            return new Paren(node, { escaped: !!escape }, location, this.context)
          }
        }
      },
      { ALT: () => $.SUBRULE($.value, { ARGS: [ctx] }) }
    ])
    if (!RECORDING_PHASE) {
      let location = $.endRule()
      if (minus) {
        return new Negative(node, undefined, location, this.context)
      }
      return node
    }
  }
}

/**
 * Add interpolation
 */
export function nthValue(this: P, T: TokenMap) {
  const $ = this

  let nthValueAlt = [
    { ALT: () => $.CONSUME(T.InterpolatedIdent) },
    { ALT: () => $.CONSUME(T.NthOdd) },
    { ALT: () => $.CONSUME(T.NthEven) },
    { ALT: () => $.CONSUME(T.Integer) },
    {
      ALT: () => {
        $.OR2([
          { ALT: () => $.CONSUME(T.NthDimension) },
          { ALT: () => $.CONSUME(T.NthDimensionSigned) }
        ])
        $.OPTION(() => {
          $.OR3([
            { ALT: () => $.CONSUME(T.SignedInt) },
            {
              ALT: () => {
                $.CONSUME(T.Minus)
                $.CONSUME(T.UnsignedInt)
              }
            }
          ])
        })
        $.OPTION2(() => {
          $.CONSUME(T.Of)
          $.SUBRULE($.complexSelector)
        })
      }
    }
  ]

  return cssNthValue.call(this, T, nthValueAlt)
}

export function knownFunctions(this: P, T: TokenMap) {
  const $ = this

  let functions = [
    { ALT: () => $.SUBRULE($.urlFunction) },
    { ALT: () => $.SUBRULE($.varFunction) },
    { ALT: () => $.SUBRULE($.calcFunction) },
    { ALT: () => $.SUBRULE($.ifFunction) },
    { ALT: () => $.SUBRULE($.booleanFunction) }
    /** @todo - add custom() and selector() */
  ]

  return cssKnownFunctions.call(this, T, functions)
}

export function ifFunction(this: P, T: TokenMap) {
  const $ = this

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let name = $.CONSUME(T.IfFunction)

    $.startRule()

    let node: Node = $.SUBRULE($.guardOr, { ARGS: [{ inValueList: true }] })
    let args: Node[]

    if (!RECORDING_PHASE) {
      args = [node]
    }

    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Semi)
          node = $.SUBRULE($.valueList, { ARGS: [{ allowAnonymousMixins: true }] })
          if (!RECORDING_PHASE) {
            args.push(node)
          }
          $.OPTION(() => {
            $.CONSUME2(T.Semi)
            node = $.SUBRULE2($.valueList, { ARGS: [{ allowAnonymousMixins: true }] })
            if (!RECORDING_PHASE) {
              args.push(node)
            }
          })
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.Comma)
          node = $.SUBRULE($.valueSequence, { ARGS: [{ allowAnonymousMixins: true }] })
          if (!RECORDING_PHASE) {
            args.push(node)
          }
          $.OPTION2(() => {
            $.CONSUME2(T.Comma)
            node = $.SUBRULE2($.valueSequence, { ARGS: [{ allowAnonymousMixins: true }] })
            if (!RECORDING_PHASE) {
              args.push(node)
            }
          })
        }
      }
    ])
    let argsLocation: LocationInfo | undefined
    if (!RECORDING_PHASE) {
      argsLocation = $.endRule()
    }

    $.CONSUME(T.RParen)

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      let nameNode = new Reference('if', { type: 'variable', optional: true }, $.getLocationInfo(name), this.context)
      return new Call([
        ['name', nameNode],
        ['args', new List(args!, undefined, argsLocation, this.context)]
      ], undefined, location, this.context)
    }
  }
}

export function booleanFunction(this: P, T: TokenMap) {
  const $ = this

  return () => {
    $.startRule()
    let name = $.CONSUME(T.BooleanFunction)
    let arg: Condition = $.SUBRULE($.guardOr, { ARGS: [{ inValueList: true }] })
    $.CONSUME(T.RParen)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      let nameNode = new Reference('boolean', { type: 'variable', optional: true }, $.getLocationInfo(name), this.context)
      return new Call([
        ['name', nameNode],
        ['args', new List([arg], undefined, arg.location as LocationInfo, this.context)]
      ], undefined, location, this.context)
    }
  }
}

/** At AST time, join comma-lists together if separated by semis */
// $.RULE('functionValueList', (ctx: RuleContext = {}) => {
//   ctx.allowAnonymousMixins = true
//   $.SUBRULE($.valueSequence, { ARGS: [ctx] })
//   $.MANY(() => {
//     $.OR([
//       { ALT: () => $.CONSUME(T.Comma) },
//       { ALT: () => $.CONSUME(T.Semi) }
//     ])
//     $.SUBRULE2($.valueSequence, { ARGS: [ctx] })
//   })
// })

export function varReference(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    let node: Node | undefined = $.OR([
      {
        ALT: () => {
          let token = $.CONSUME(T.PropertyReference)
          if (!RECORDING_PHASE) {
            return new Reference(token.image.slice(1), { type: 'property' }, $.getLocationInfo(token), this.context)
          }
        }
      },
      {
        ALT: () => {
          let token = $.CONSUME(T.NestedReference)
          if (!RECORDING_PHASE) {
            let name = token.image
            let type: 'variable' | 'property' = name.startsWith('@') ? 'variable' : 'property'
            return new Reference(getInterpolatedOrString(token.image), { type }, $.getLocationInfo(token), this.context)
          }
        }
      },
      {
        ALT: () => {
          let token = $.CONSUME(T.AtKeyword)
          if (!RECORDING_PHASE) {
            return new Reference(token.image.slice(1), { type: 'variable' }, $.getLocationInfo(token), this.context)
          }
        }
      }
    ])
    $.OR2([
      {
        ALT: () => {
          /** This spreads a (list) value within a containing list when evaluated */
          let token = $.CONSUME(T.Ellipsis)
          if (!RECORDING_PHASE) {
            node = new Rest(node, undefined, $.getLocationFromNodes([node!, token]), this.context)
          }
        }
      },
      {
        /** Only variables can have accessors */
        GATE: () => node!.options.type === 'variable',
        ALT: () => {
          ctx.node = node
          node = $.SUBRULE2($.accessors, { ARGS: [ctx] })
        }
      },
      { ALT: EMPTY_ALT() }
    ])

    if (!RECORDING_PHASE) {
      return $.wrap(node!)
    }
  }
}

export function valueReference(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    return $.OR([
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.inlineMixinCall, { ARGS: [ctx] }) }
    ])
  }
}

export function functionCall(this: P, T: TokenMap) {
  const $ = this

  let funcAlt = [
    { ALT: () => $.SUBRULE($.knownFunctions) },
    {
      ALT: () => {
        $.startRule()

        let name = $.CONSUME(T.Ident)
        let args: List | undefined

        $.OR2([{
          GATE: $.noSep,
          ALT: () => {
            $.CONSUME(T.LParen)
            $.OPTION(() => args = $.SUBRULE($.functionCallArgs))
            $.CONSUME(T.RParen)
          }
        }])

        if (!$.RECORDING_PHASE) {
          let location = $.endRule()
          let nameNode = new Reference(name.image, { type: 'variable', optional: true }, $.getLocationInfo(name), this.context)
          return new Call([
            ['name', nameNode],
            ['args', args]
          ], undefined, location, this.context)
        }
      }
    }
  ]

  return () => $.OR(funcAlt)
}

export function functionCallArgs(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let node = $.SUBRULE($.callArgument, { ARGS: [ctx] })

    let commaNodes: Node[]
    let semiNodes: Node[]
    if (!RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)]
      semiNodes = []
    }
    let isSemiList = false

    $.MANY(() => {
      $.OR([
        {
          GATE: () => !isSemiList,
          ALT: () => {
            $.CONSUME(T.Comma)
            node = $.SUBRULE2($.callArgument, { ARGS: [ctx] })
            if (!RECORDING_PHASE) {
              commaNodes!.push($.wrap(node, true))
            }
          }
        },
        {
          ALT: () => {
            isSemiList = true

            $.CONSUME(T.Semi)

            if (!RECORDING_PHASE) {
              /** Aggregate the previous set of comma-nodes */
              if (commaNodes.length > 1) {
                let commaList = new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), this.context)
                semiNodes.push(commaList)
              } else {
                semiNodes.push(commaNodes[0]!)
              }
            }
            node = $.SUBRULE3($.callArgument, { ARGS: [{ ...ctx, allowComma: true }] })
            if (!RECORDING_PHASE) {
              semiNodes.push($.wrap(node, true))
            }
          }
        }
      ])
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      let nodes = isSemiList ? semiNodes! : commaNodes!
      let sep: ';' | ',' = isSemiList ? ';' : ','
      return $.wrap(new List(nodes, { sep }, location, this.context), 'both')
    }
  }
}

export function value(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let node: Node = $.OR([
      /** Function should appear before Ident */
      { ALT: () => $.SUBRULE($.functionCall) },
      { ALT: () => $.SUBRULE($.inlineMixinCall, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.Ident) },
      { ALT: () => $.CONSUME(T.DefaultGuardFunc) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Color) },
      { ALT: () => $.SUBRULE($.string) },
      { ALT: () => $.CONSUME(T.JavaScript) },
      /** Explicitly not marked as an ident */
      { ALT: () => $.CONSUME(T.When) },
      { ALT: () => $.SUBRULE($.squareValue) },
      {
        GATE: () => $.looseMode && !!ctx.inner,
        ALT: () => $.CONSUME(T.Colon)
      },
      {
        /** Allow plain classes */
        GATE: () => $.looseMode,
        ALT: () => $.CONSUME(T.DotName)
      },
      {
        /** Allow plain Ids */
        GATE: () => $.looseMode,
        ALT: () => $.CONSUME(T.HashName)
      },
      {
        GATE: () => $.looseMode,
        ALT: () => $.CONSUME(T.Unknown)
      },
      {
        /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
        GATE: () => $.legacyMode,
        ALT: () => $.CONSUME(T.LegacyMSFilter)
      }
    ])
    if (!$.RECORDING_PHASE) {
      if (!(node instanceof Node)) {
        node = $.processValueToken(node)
      }
      return $.wrap(node)
    }
  }
}

export function string(this: P, T: TokenMap) {
  const $ = this

  let stringAlt = [
    {
      ALT: () => {
        $.startRule()
        let quote = $.CONSUME(T.SingleQuoteStart)
        let contents: IToken | undefined
        $.OPTION(() => contents = $.CONSUME(T.SingleQuoteStringContents))
        $.CONSUME(T.SingleQuoteEnd)
        if (!$.RECORDING_PHASE) {
          let quoteImg = quote.image
          let escaped = false
          if (quoteImg.startsWith('~')) {
            escaped = true
            quoteImg = quoteImg.slice(1)
          }
          let location = $.endRule()
          let value = contents?.image
          return new Quoted(new General(value ?? ''), { quote: quoteImg as '"' | "'", escaped }, location, this.context)
        }
      }
    },
    {
      ALT: () => {
        $.startRule()
        let quote = $.CONSUME(T.DoubleQuoteStart)
        let contents: IToken | undefined
        $.OPTION2(() => contents = $.CONSUME(T.DoubleQuoteStringContents))
        $.CONSUME(T.DoubleQuoteEnd)
        if (!$.RECORDING_PHASE) {
          let quoteImg = quote.image
          let escaped = false
          if (quoteImg.startsWith('~')) {
            escaped = true
            quoteImg = quoteImg.slice(1)
          }
          let location = $.endRule()
          let value = contents?.image
          return new Quoted(new General(value ?? ''), { quote: quoteImg as '"' | "'", escaped }, location, this.context)
        }
      }
    }
  ]

  return () => $.OR(stringAlt)
}

export function mathValue(this: P, T: TokenMap) {
  const $ = this

  let valueAlt = [
    { ALT: () => $.CONSUME(T.AtKeyword) },
    { ALT: () => $.CONSUME(T.Number) },
    { ALT: () => $.CONSUME(T.Dimension) },
    { ALT: () => $.SUBRULE($.functionCall) },
    {
      /** Only allow escaped strings in calc */
      GATE: () => $.LA(1).image.startsWith('~'),
      ALT: () => $.SUBRULE($.string)
    },
    {
      /** For some reason, e() goes here instead of $.function */
      GATE: () => $.LA(2).tokenType !== T.LParen,
      ALT: () => $.CONSUME(T.MathConstant)
    },
    { ALT: () => $.SUBRULE($.mathParen) }
  ]

  return cssMathValue.call(this, T, valueAlt)
}

/** @todo - add interpolation */
// $.OVERRIDE_RULE('string', () => {
//   $.OR([
//     {
//       ALT: () => {
//         $.CONSUME(T.SingleQuoteStart)
//         $.OPTION(() => $.CONSUME(T.SingleQuoteStringContents))
//         $.CONSUME(T.SingleQuoteEnd)
//       }
//     },
//     {
//       ALT: () => {
//         $.CONSUME(T.DoubleQuoteStart)
//         $.OPTION2(() => $.CONSUME(T.DoubleQuoteStringContents))
//         $.CONSUME(T.DoubleQuoteEnd)
//       }
//     }
//   ])
// })

export function guard(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    $.CONSUME(T.When)
    return $.OR([
      {
        GATE: () => !!ctx.inValueList,
        ALT: () => $.SUBRULE($.comparison, { ARGS: [ctx] })
      },
      {
        ALT: () => {
          ctx.allowComma = true
          $.SUBRULE($.guardOr, { ARGS: [ctx] })
        }
      }
    ])
  }
}

/**
 * 'or' expression
 * Allows an (outer) comma like historical media queries
 */
export function guardOr(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let left = $.SUBRULE($.guardAnd, { ARGS: [ctx] })
    let right: Node | undefined
    $.MANY({
      GATE: () => !!ctx.allowComma || $.LA(1).tokenType !== T.Comma,
      DEF: () => {
        /**
               * Nest expressions within expressions for correct
               * order of operations.
               */
        $.OR3([
          { ALT: () => $.CONSUME($.T.Comma) },
          { ALT: () => $.CONSUME($.T.Or) }
        ])
        right = $.SUBRULE2($.guardAnd, { ARGS: [ctx] })
        if (!RECORDING_PHASE) {
          let location = $.endRule()
          $.startRule()
          left = new Condition(
            [$.wrap(left, true), 'or', $.wrap(right!)],
            undefined,
            location,
            this.context
          )
        }
      }
    })
    if (!RECORDING_PHASE) {
      $.endRule()
    }
    return left
  }
}

export function guardDefault(this: P, T: TokenMap) {
  const $ = this

  let guardAlt = [
    { ALT: () => $.CONSUME(T.DefaultGuardIdent) },
    { ALT: () => $.CONSUME(T.DefaultGuardFunc) }
  ]

  return (ctx: RuleContext = {}) => {
    let guard = $.OR(guardAlt)
    ctx.hasDefault = true
    if (!$.RECORDING_PHASE) {
      return new DefaultGuard(guard.image, undefined, $.getLocationInfo(guard), this.context)
    }
  }
}

/**
 * 'and' and 'or' expressions
 *
 *  In Media queries level 4, you cannot have
 *  `([expr]) or ([expr]) and ([expr])` because
 *  of evaluation order ambiguity.
 *  However, Less allows it.
 */
export function guardAnd(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let left: Node
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.MANY_SEP({
      SEP: T.And,
      DEF: () => {
        let not: IToken | undefined
        $.OPTION(() => not = $.CONSUME(T.Not))
        let allowComma = ctx.allowComma
        ctx.allowComma = false
        let right = $.SUBRULE($.guardInParens, { ARGS: [ctx] })
        ctx.allowComma = allowComma
        if (!RECORDING_PHASE && not) {
          let [,,, endOffset, endLine, endColumn] = right.location!
          let [startOffset, startLine, startColumn] = $.getLocationInfo(not)
          right = new Condition(
            right,
            { negate: true },
            [startOffset, startLine, startColumn, endOffset, endLine, endColumn],
            this.context
          )
        }
        if (!left) {
          left = right
          return
        }
        if (!RECORDING_PHASE) {
          left = new Condition(
            [$.wrap(left, true), 'and', $.wrap(right)],
            undefined,
            $.getLocationFromNodes([left, right]),
            this.context
          )
        }
      }
    })
    return left!
  }
}

export function guardInParens(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext) => {
    $.startRule()
    let node = $.OR([
      { ALT: () => $.SUBRULE($.guardDefault, { ARGS: [ctx] }) },
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          let node = $.OR2([
            { ALT: () => $.SUBRULE($.comparison, { ARGS: [ctx] }) },
            {
              GATE: () => {
                let tokenType = $.LA(1).tokenType
                return tokenType !== T.Not && tokenType !== T.DefaultGuardFunc && tokenType !== T.DefaultGuardIdent
              },
              ALT: () => $.SUBRULE($.value, { ARGS: [ctx] })
            },
            {
              /**
               * This is the only backtracked rule to dis-ambiguate
               * nested parens with no and / or from nested parens
               * in math expressions.
               */
              ALT: () => $.SUBRULE($.guardOr, { ARGS: [ctx] })
            }
          ])
          $.CONSUME(T.RParen)
          return node
        }
      }
    ])

    if (!$.RECORDING_PHASE) {
      node = $.wrap(node, 'both')
      return new Paren(node, undefined, $.endRule(), this.context)
    }
  }
}

export function guardWithConditionValue(this: P, T: TokenMap) {
  const $ = this
  return () => $.OR([
    {
      ALT: () => {
        $.OR2([
          { ALT: () => $.CONSUME(T.DefaultGuardIdent) },
          { ALT: () => $.CONSUME(T.DefaultGuardFunc) }
        ])
      }
    },
    { ALT: () => $.SUBRULE($.guardInParens) }
  ])
}

export function guardWithCondition(this: P, T: TokenMap) {
  const $ = this
  return () => {
    $.SUBRULE($.guardWithConditionValue)
    $.AT_LEAST_ONE(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Or) },
        { ALT: () => $.CONSUME(T.And) },
        { ALT: () => $.CONSUME(T.Comma) }
      ])
      $.SUBRULE2($.guardWithConditionValue)
    })
  }
}

/**
 * Currently, Less only allows a single comparison expression,
 * unlike Media Queries Level 4, which allows a left and right
 * comparison.
 */
export function comparison(this: P, T: TokenMap) {
  const $ = this

  let opAlt = [
    { ALT: () => $.CONSUME(T.Eq) },
    { ALT: () => $.CONSUME(T.Gt) },
    { ALT: () => $.CONSUME(T.GtEq) },
    { ALT: () => $.CONSUME(T.GtEqAlias) },
    { ALT: () => $.CONSUME(T.Lt) },
    { ALT: () => $.CONSUME(T.LtEq) },
    { ALT: () => $.CONSUME(T.LtEqAlias) }
  ]

  return () => {
    let left = $.SUBRULE($.valueList)
    // $.OPTION(() => {
    let op = $.OR(opAlt)
    let right = $.SUBRULE2($.valueList)
    if (!$.RECORDING_PHASE) {
      let opStr = op.image
      if (opStr === '=>') {
        opStr = '>='
      } else if (opStr === '=<') {
        opStr = '<='
      }
      left = new Condition(
        [$.wrap(left, true), opStr as Operator, $.wrap(right)],
        undefined,
        $.getLocationFromNodes([left, right]),
        this.context
      )
    }
    // })
    return left
  }
}

/**
 * Less (perhaps unwisely) allows bubling of normally document-root
 * at-rules, so we need to override CSS here.
 */
export function innerAtRule(this: P, T: TokenMap) {
  const $ = this

  let ruleAlt = [
    { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.importAtRule) },
    { ALT: () => $.SUBRULE($.pageAtRule) },
    { ALT: () => $.SUBRULE($.fontFaceAtRule) },
    { ALT: () => $.SUBRULE($.nestedAtRule) },
    { ALT: () => $.SUBRULE($.nonNestedAtRule) },
    { ALT: () => $.SUBRULE($.unknownAtRule) }
  ]

  return cssInnerAtRule.call(this, T, ruleAlt)
}

/**
 * One of the rare rules that returns a token, because
 * other rules will transform it differently.
 */
export function mixinName(this: P, T: TokenMap) {
  const $ = this

  let nameAlt = [
    { ALT: () => $.CONSUME(T.HashName) },
    { ALT: () => $.CONSUME(T.ColorIdentStart) },
    { ALT: () => $.CONSUME(T.DotName) },
    { ALT: () => $.CONSUME(T.InterpolatedIdent) }
  ]

  /** e.g. .mixin, #mixin */
  return (asReference?: boolean) => {
    let name = $.OR(nameAlt)
    if (!$.RECORDING_PHASE) {
      let nameNode: Node
      let nameValue = name.image
      let location = $.getLocationInfo(name)
      if (nameValue.includes('@') || nameValue.includes('$')) {
        nameNode = getInterpolated(nameValue, location, this.context)
        if (asReference) {
          nameNode = new Reference(nameNode as Interpolated, { type: 'mixin' }, location, this.context)
        }
      } else {
        if (asReference) {
          nameNode = new Reference(nameValue, { type: 'mixin' }, location, this.context)
        } else {
          nameNode = $.wrap(new General(nameValue, { type: 'Name' }, $.getLocationInfo(name), this.context), true)
        }
      }
      return nameNode
    }
  }
}

/** @todo - should these names be Jess-normalized when saved? */
export function mixinReference(this: P, T: TokenMap) {
  const $ = this

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    let leftNode = $.SUBRULE($.mixinName, { ARGS: [true] })
    $.MANY(() => {
      $.OPTION(() => $.CONSUME(T.Gt))
      let rightNode = $.SUBRULE2($.mixinName, { ARGS: [true] })
      if (!RECORDING_PHASE) {
        let [startOffset, startLine, startColumn] = leftNode.location
        let [,,, endOffset, endLine, endColumn] = rightNode.location
        leftNode = new Lookup(
          [
            ['value', new Call([['name', leftNode]])],
            ['key', rightNode]
          ],
          undefined,
          [startOffset, startLine, startColumn, endOffset, endLine, endColumn],
          this.context
        )
      }
    })
    return leftNode
  }
}

/** e.g. #ns > .mixin() */
export function mixinCall(this: P, T: TokenMap) {
  const $ = this

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let ref = $.SUBRULE($.mixinReference)
    let semi: boolean | undefined
    let argList: List | undefined
    let important: IToken | undefined
    /** Either needs to end in parens or in a semi-colon (or both) */
    $.OR([
      {
        ALT: () => {
          argList = $.SUBRULE($.mixinArgs)
          $.OPTION2(() => important = $.CONSUME(T.Important))
          $.OPTION3(() => {
            semi = true
            $.CONSUME(T.Semi)
          })
        }
      },
      {
        ALT: () => {
          semi = true
          $.CONSUME2(T.Semi)
        }
      }
    ])
    if (!RECORDING_PHASE) {
      let location = $.endRule()
      let node = new Call([
        ['name', ref],
        ['args', argList],
        ['important', !!important]
      ], undefined, location, this.context)
      if (semi) {
        node.options.semi = true
      }
      return node
    }
  }
}

/**
 * Used within a value. These can be
 * chained more recursively, unlike
 * Less 1.x-4.x
 *   e.g. .mixin1() > .mixin2[@val1].ns() > .sub-mixin[@val2]
 *
 * Note: unlike valueReference, an inline mixin call doesn't
 * needs args or accessors.
 */
export function inlineMixinCall(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let nodeContext = ctx.node
    let RECORDING_PHASE = $.RECORDING_PHASE

    let argList: List | undefined
    let node: Node
    let call: Call
    let ref = $.SUBRULE($.mixinReference)
    if (!RECORDING_PHASE) {
      if (nodeContext) {
        ref = new Lookup(
          [
            ['value', new Call([['name', nodeContext]])],
            ['key', ref]
          ]
        )
      }
      call = new Call([['name', ref]], undefined, ref.location, this.context)
      node = call
    }
    $.OR([
      {
        ALT: () => {
          ctx.node = node
          node = $.SUBRULE($.accessors, { ARGS: [ctx] })
        }
      },
      {
        ALT: () => {
          argList = $.SUBRULE($.mixinArgs)
          if (!RECORDING_PHASE) {
            call.args = argList
            let RParen = $.LA(0)
            let [startOffset, startLine, startColumn] = node.location
            let { endOffset, endLine, endColumn } = RParen
            call.location = [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!]
          }
          $.OR2([
            {
              ALT: () => {
                ctx.node = node
                node = $.SUBRULE2($.accessors, { ARGS: [ctx] })
              }
            },
            {
              GATE: () => !ctx.requireAccessorsAfterMixinCall,
              ALT: () => EMPTY_ALT()
            }
          ])
        }
      }
    ])

    return node!
  }
}

export function mixinDefinition(this: P, T: TokenMap) {
  const $ = this

  return () => {
    $.startRule()
    let name = $.SUBRULE($.mixinName)
    let params = $.SUBRULE($.mixinArgs, { ARGS: [{ isDefinition: true }] })
    let guard: Condition | undefined
    let ctx: RuleContext = {}

    $.OPTION(() => guard = $.SUBRULE($.guard, { ARGS: [ctx] }))
    let rules = $.SUBRULE($.wrappedDeclarationList)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new Mixin(
        [
          ['name', name],
          ['params', params],
          ['rules', rules],
          ['guard', guard]
        ],
        { hasDefault: !!ctx.hasDefault },
        location,
        this.context
      )
    }
  }
}

export function mixinArgs(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let args: List | undefined
    $.CONSUME(T.LParen)
    $.OPTION(() => args = $.SUBRULE($.mixinArgList, { ARGS: [ctx] }))
    $.CONSUME(T.RParen)
    return args
  }
}

export function accessors(this: P, T: TokenMap) {
  const $ = this

  const getReferenceFromLookupToken = (token: IToken) => {
    let tokenStr = token.image
    let firstChar = tokenStr[0]
    if (firstChar !== '$' && firstChar !== '@') {
      /** Treat idents as property lookups */
      tokenStr = '$' + tokenStr
    }
    let key = getInterpolatedOrString(tokenStr)
    let type: 'variable' | 'property' = tokenStr.startsWith('@') ? 'variable' : 'property'

    return new Reference(key, { type }, $.getLocationInfo(token), this.context)
  }

  let keyAlt = [
    { ALT: () => $.CONSUME(T.NestedReference) },
    { ALT: () => $.CONSUME(T.AtKeyword) },
    { ALT: () => $.CONSUME(T.PropertyReference) },
    { ALT: () => $.CONSUME(T.Ident) }
  ]

  /** The node passed in is what we're looking up on */
  return (ctx: RuleContext = {}) => {
    let nodeContext = ctx.node!
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let keyToken: IToken | undefined
    let key: string | number | Reference
    let returnNode: Node

    $.CONSUME(T.LSquare)
    $.OPTION(() => keyToken = $.OR(keyAlt))
    $.CONSUME(T.RSquare)

    if (!RECORDING_PHASE) {
      if (keyToken) {
        if (keyToken.tokenType === T.NestedReference) {
          key = getReferenceFromLookupToken(keyToken)
        } else {
          let tokenStr = keyToken.image
          let tokenStart = tokenStr[0]
          if (tokenStart === '@') {
            key = new Reference(tokenStr.slice(1), { type: 'variable' }, $.getLocationInfo(keyToken), this.context)
          } else {
            key = tokenStart === '$' ? tokenStr.slice(1) : tokenStr
            key = new Reference(tokenStr, { type: 'property' }, $.getLocationInfo(keyToken), this.context)
          }
        }
      } else {
        key = -1
      }
      let location = $.endRule()
      returnNode = new Lookup(
        [
          ['value', nodeContext],
          ['key', key]
        ],
        undefined,
        location,
        this.context
      )
    }
    /**
     * Allows chaining of lookups / calls
     * @note - In Less, an additional call or accessor implies
     * that the previous accessor is a mixin call, therefore
     * it should be returned as a Call node.
     */
    $.OPTION2(() => {
      $.OR2([
        {
          ALT: () => {
            let args = $.SUBRULE($.mixinArgs)
            if (!RECORDING_PHASE) {
              let [startOffset, startLine, startColumn] = returnNode.location
              let { endOffset, endLine, endColumn } = $.LA(0)
              returnNode = new Call(
                [
                  ['name', returnNode],
                  ['args', args]
                ],
                undefined,
                [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!],
                this.context
              )
            }
          }
        },
        {
          ALT: () => {
            ctx.node = returnNode
            returnNode = $.SUBRULE($.inlineMixinCall, { ARGS: [ctx] })
            return returnNode
          }
        },
        {
          ALT: () => {
            ctx.node = returnNode
            returnNode = $.SUBRULE($.accessors, { ARGS: [ctx] })
            return returnNode
          }
        }
      ])
    })
    return returnNode!
  }
}

/**
 * @see https://lesscss.org/features/#mixins-feature-mixins-parametric-feature
 *
 * This rule is recursive to allow chevrotain-allstar (hopefully) to lookahead
 * and find semi-colon separators vs. commas.
 */
export function mixinArgList(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let node = $.SUBRULE($.mixinArg, { ARGS: [ctx] })

    let commaNodes: Node[] | undefined
    let semiNodes: Node[]
    if (!RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)]
      semiNodes = []
    }
    let isSemiList = false
    let moreArgs = true

    $.MANY({
      GATE: () => moreArgs,
      DEF: () => {
        $.OR([
          {
            GATE: () => !isSemiList,
            ALT: () => {
              $.CONSUME(T.Comma)
              let node = $.SUBRULE2($.mixinArg, { ARGS: [ctx] })
              if (!RECORDING_PHASE) {
                commaNodes!.push($.wrap(node, true))
              }
            }
          },
          {
            ALT: () => {
              isSemiList = true

              $.CONSUME(T.Semi)

              if (!RECORDING_PHASE) {
                /**
                 * Aggregate the previous set of comma-nodes
                 */
                if (commaNodes) {
                  if (commaNodes.length > 1) {
                    let [first, ...rest] = commaNodes
                    if (first instanceof VarDeclaration) {
                      let nodes = [first.value, ...rest]
                      first.value = new List(nodes, undefined, $.getLocationFromNodes(nodes), this.context)
                      semiNodes.push(first)
                    } else {
                      if (!commaNodes[0]) {
                        console.log('oops')
                      }
                      let commaList = new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), this.context)
                      semiNodes.push(commaList)
                    }
                  } else {
                    semiNodes.push(commaNodes[0]!)
                  }
                  commaNodes = undefined
                }
              }
              $.OR2([
                {
                  GATE: () => $.LA(1).tokenType !== T.RParen,
                  ALT: () => {
                    node = $.SUBRULE3($.mixinArg, { ARGS: [{ ...ctx, allowComma: true }] })
                    if (!RECORDING_PHASE) {
                      semiNodes.push($.wrap(node, true))
                    }
                  }
                },
                {
                  ALT: () => {
                    moreArgs = false
                    EMPTY_ALT()
                  }
                }
              ])
            }
          }
        ])
      }
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      let nodes = isSemiList ? semiNodes! : commaNodes!
      let sep: ';' | ',' = isSemiList ? ';' : ','
      return $.wrap(new List(nodes, { sep }, location, this.context), 'both')
    }
  }
}

export function varName(this: P, T: TokenMap) {
  const $ = this
  let nameAlt = [
    { ALT: () => $.CONSUME(T.AtKeyword) },
    { ALT: () => $.CONSUME(T.AtKeywordLessExtension) }
  ]
  return () => $.OR(nameAlt)
}

export function mixinArg(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    const isDefinition = !!ctx.isDefinition
    let RECORDING_PHASE = $.RECORDING_PHASE
    let firstToken = $.LA(1)

    let atStart = (
      firstToken.tokenType === T.AtKeyword ||
      firstToken.tokenType === T.AtKeywordLessExtension
    )

    let isDeclaration = $.LA(2).tokenType === T.Colon

    /**
     * @todo - determine _values_ (variable references)
     * vs _names_ (variable declarations)
    */
    return $.OR([
      {
        GATE: () => isDefinition && atStart,
        ALT: () => {
          let name = $.SUBRULE($.varName)
          if (!RECORDING_PHASE) {
            return new General(name.image.slice(1), { type: 'Name' }, $.getLocationInfo(name), this.context)
          }
        }
      },
      {
        GATE: () => isDefinition && !atStart,
        ALT: () => $.SUBRULE($.value)
      },
      {
        GATE: () => atStart && isDeclaration,
        ALT: () => {
          $.startRule()
          let name = $.SUBRULE2($.varName)
          $.CONSUME(T.Colon)
          /** Default value */
          let value = $.SUBRULE($.callArgument, { ARGS: [ctx] })

          if (!RECORDING_PHASE) {
            let location = $.endRule()
            return new VarDeclaration(
              [
                ['name', name.image.slice(1)],
                ['value', value]
              ],
              { paramVar: true },
              location,
              this.context
            )
          }
        }
      },
      {
        /**
         * Mixin definitions can have a spread parameter, which
         * means it will match a variable number of elements
         * at the end.
         *
         * However, mixin calls can have a spread argument,
         * which means it will expand a variable representing
         * a list, which, to my knowledge, is an undocumented
         * feature of Less (and only exists in mixin calls?)
         *
         * @todo - Intuitively, shouldn't this be available
         * elsewhere in the language? Or would there be no
         * reason?
         */
        GATE: () => isDefinition,
        ALT: () => {
          $.startRule()
          let name = $.CONSUME(T.AtKeyword)
          $.CONSUME(T.Ellipsis)
          if (!RECORDING_PHASE) {
            let location = $.endRule()
            let varName = name.image.slice(1)
            if (isDefinition) {
              return new Rest(varName, undefined, location, this.context)
            }
            return new Rest(new Reference(varName, { type: 'variable' }, $.getLocationInfo(name), this.context), undefined, location, this.context)
          }
        }
      },
      {
        GATE: () => !isDefinition && !isDeclaration,
        ALT: () => $.SUBRULE2($.callArgument, { ARGS: [ctx] })
      },
      {
        GATE: () => isDefinition,
        ALT: () => {
          let ellipsis = $.CONSUME2(T.Ellipsis)
          return new Rest(undefined, undefined, $.getLocationInfo(ellipsis), this.context)
        }
      }
    ])
  }
}

export function callArgument(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    return $.OR([
      { ALT: () => $.SUBRULE($.anonymousMixinDefinition) },
      {
        GATE: () => !ctx.allowComma,
        ALT: () => $.SUBRULE($.valueSequence)
      },
      {
        GATE: () => !!ctx.allowComma,
        ALT: () => $.SUBRULE($.valueList)
      }
    ])
  }
}