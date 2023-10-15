import type { LessActionsParser as P, TokenMap, RuleContext } from './lessActionsParser'
import {
  tokenMatcher,
  type IToken
} from 'chevrotain'
import {
  main as cssMain,
  declaration as cssDeclaration,
  mediaInParens as cssMediaInParens,
  simpleSelector as cssSimpleSelector,
  unknownAtRule as cssUnknownAtRule,
  nthValue as cssNthValue,
  knownFunctions as cssKnownFunctions,
} from '@jesscss/css-parser'

import {
  TreeContext,
  Node,
  type LocationInfo,
  type AssignmentType,
  type Operator,
  General,
  Block,
  Anonymous,
  Ruleset,
  Declaration,
  Scope,
  type SimpleSelector,
  SelectorList,
  SelectorSequence,
  type Rules,
  Combinator,
  BasicSelector,
  Ampersand,
  List,
  Sequence,
  Call,
  Paren,
  Operation,
  Quoted,
  PseudoSelector,
  AttributeSelector,
  AtRule,
  QueryCondition,
  Token,
  Interpolated,
  Name,
  Reference,
  Extend,
  ExtendList,
  Negative,
  Mixin,
  Import,
  Condition,
  VarDeclaration
} from '@jesscss/core'


const isEscapedString = function(this: P, T: TokenMap) {
  const next = this.LA(1)
  return tokenMatcher(next, T.QuoteStart) && next.image.startsWith('~')
}

export function main(this: P, T: TokenMap) {
  const $ = this

  let ruleAlt = [
    { ALT: () => $.SUBRULE($.mixinDefinition) },
    { ALT: () => $.SUBRULE($.functionCall) },
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
    { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [{ inner: true }] }) },
    { ALT: () => $.CONSUME2(T.Semi) }
  ]

  return cssMain.call(this, T, ruleAlt)
}

let interpolatedRegex = /([$@]){([^}]+)}/
let charPlaceholder = String.fromCharCode(0)

export function declaration(this: P, T: TokenMap) {
  const $ = this

  const getInterpolated = (name: string, location: LocationInfo): Interpolated => {
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
    ], undefined, location, this.context)
  }

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
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name!))
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
        $.MANY(() => {
          let val = $.SUBRULE($.customValue)
          if (!RECORDING_PHASE) {
            nodes!.push(val)
          }
        })
        if (!RECORDING_PHASE) {
          let location = $.endRule()
          let nameNode: Name
          let nameValue = name!.image
          if (nameValue.includes('@') || nameValue.includes('$')) {
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name!))
          } else {
            nameNode = $.wrap(new General(name!.image, { type: 'Name' }, $.getLocationInfo(name!), this.context), true)
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
      { ALT: () => $.SUBRULE($.valueReference) },
      {
        ALT: cssMediaInParens.bind(this, T)
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

// const getRuleContext = (ctx: RuleContext): RuleContext => ({
//   mixinCandidate: {
//     call: false,
//     definition: false
//   },
//   ...ctx
// })

export function qualifiedRule(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    ctx.qualifiedRule = true
    let selectorList: SelectorList = $.OR([
      {
        GATE: () => !ctx.inner,
        ALT: () => $.SUBRULE($.selectorList, { ARGS: [ctx] })
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => {
          ctx.firstSelector = true
          $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] })
        }
      }
    ])

    let guard: Condition | undefined
    let semi = false
    let rules: Rules | undefined

    $.OR2([
      {
        /**
         * :extend at the end of a qualified rule selector
         *
         * @note - this should be tweaked so that each
         * complex selector in a list is required to
         * have an extend in order to end in a semi-colon. 
         */
        GATE: () => !!ctx.hasExtend,
        ALT: () => semi = !!$.CONSUME(T.Semi)
      },
      {
        ALT: () => {
          $.OPTION(() => guard = $.SUBRULE($.guard))
          $.CONSUME(T.LCurly)
          rules = $.SUBRULE($.declarationList)
          $.CONSUME(T.RCurly)
        }
      }
    ])

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      if (semi) {
        return new ExtendList(selectorList, undefined, location, this.context)
      }
      return new Ruleset([
        ['selector', selectorList],
        ['rules', rules!],
        ['guard', guard]
      ], undefined, location, this.context)
    }
  }
}

/** Mostly copied from the CSS production, with alterations */
export function complexSelector(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE

    let selectors: Node[] = $.SUBRULE($.compoundSelector, { ARGS: [ctx] })

    $.MANY({
      GATE: () => $.hasWS() || $.LA(1).tokenType === T.Combinator,
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
        let compound = $.SUBRULE2($.compoundSelector, { ARGS: [{ ...ctx, firstSelector: false }] })
        if (!RECORDING_PHASE) {
          selectors.push(
            combinator!,
            ...compound
          )
        }
      }
    })

    let extendSelector: SelectorList | SelectorSequence | undefined
    let extendFlag: IToken | undefined
    let extendLocation: LocationInfo | undefined
    
    $.OPTION({
      GATE: () => !!ctx.qualifiedRule,
      DEF: () => {
        $.startRule()
        let value = $.SUBRULE($.extend, { ARGS: [ctx] })
        if (!RECORDING_PHASE) {
          extendLocation = $.endRule()
          extendSelector = value[0]
          extendFlag = value[1]
        }
      }
    })
  
    if (!RECORDING_PHASE) {
      let sequence = new SelectorSequence(selectors as Array<SimpleSelector | Combinator>, undefined, $.getLocationFromNodes(selectors), this.context)
      if (extendSelector) {
        return new Extend([
          ['target', sequence],
          ['extendList', extendSelector],
          /** @todo - should support more flags in the future? */
          ['flag', extendFlag ? '!all' : undefined]
        ], undefined, extendLocation!, this.context)
      }
      return sequence
    }
  }
}

export function extend(this: P, T: TokenMap) {
  const $ = this

  return (ctx: RuleContext = {}) => {
    ctx.hasExtend = true
    $.CONSUME(T.Extend)
    let selector = $.SUBRULE($.selectorList)
    let flag: IToken | undefined
    $.OPTION(() => flag = $.CONSUME(T.All))
    $.CONSUME(T.RParen)
    if (!$.RECORDING_PHASE) {
      return [selector, flag]
    }
  }
}

export function simpleSelector(this: P, T: TokenMap) {
  const $ = this

  let selectorAlt = ((ctx: RuleContext) => [
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
      ALT: () => $.CONSUME(T.Ampersand)
    },
    { ALT: () => $.CONSUME(T.InterpolatedSelector) },
    { ALT: () => $.SUBRULE($.classSelector) },
    { ALT: () => $.SUBRULE($.idSelector) },
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.attributeSelector) }
  ])
  
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
    $.CONSUME(T.LCurly)
    let rules = $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)

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

    let isAtRule = false
    
    if (options!.includes('css')) {
      isAtRule = true
    } else {
      let url = getUrlFromNode(urlNode)
      isAtRule = isCssUrl(url)
    }

    let preludeNodes: Node[]

    if (isAtRule) {
      preludeNodes = [$.wrap(urlNode)]
    }

    $.OPTION2({
      GATE: () => isAtRule,
      DEF: () => {
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
      }
    })

    $.OPTION3({
      GATE: () => isAtRule,
      DEF: () => {
        let node = $.SUBRULE($.mediaQuery)
        if (!RECORDING_PHASE) {
          preludeNodes!.push(node)
        }
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
      return new Import([
        ['path', getUrlFromNode(urlNode)],
        ['importType', 'less'],
        /**
         * If this is inline, it will end up using Jess's text plugin,
         * but the Less plugin handles url resolving.
         */
        ['pluginOptions', options!.includes('inline') ? { inline: true } : {}]
      ], {
        reference: true,
        include: !options!.includes('reference'),
        useParentScope: true
      })
    }
  }
}

/** Less variables */
export function unknownAtRule(this: P, T: TokenMap) {
  const $ = this

  /** Starts with a colon, followed by white space */
  const isVariableLike = () => {
    let token = $.LA(1)
    return token.tokenType === T.Colon &&
      $.postSkippedTokenMap.has(token.endOffset!)
  }

  /** Doesn't start with a colon or DOES, but it is NOT followed by a space */
  const isNotVariableLike = () => {
    let token = $.LA(1)
    return token.tokenType !== T.Colon ||
      !$.postSkippedTokenMap.has(token.endOffset!)
  }

  const getNodeFromString = (name: string): Interpolated | string => {
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
          getNodeFromString(end),
          { type: end === '@' ? 'property' : 'variable' }
        )
      ]]
    ])
  }

  return () => {
    $.startRule()

    let name = $.OR([
      { ALT: () => $.CONSUME(T.AtKeyword) },
      { ALT: () => $.CONSUME(T.NestedReference) }
    ])
    let value: Node | undefined
    let args: List | undefined
    let important: IToken | undefined

    let returnVal: Node = $.OR([
      {
        /**
         * This is a variable declaration
         * Disallows `@atrule :foo;` because it resembles a pseudo-selector
         */
        GATE: isVariableLike,
        ALT: () => {
          $.CONSUME(T.Colon)
          return $.OR2([
            {
              ALT: () => {
                value = $.SUBRULE($.anonymousMixinDefinition)
                $.OPTION2(() => $.CONSUME(T.Semi))
                return value
              }
            },
            {
              ALT: () => {
                value = $.SUBRULE($.valueList)
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
        GATE: () => $.noSep() && $.LA(1).tokenType === T.LParen,
        /**
         * This is a change from Less 1.x-4.x
         * e.g.
         * ```
         * @dr: #(@var1, @var2) {
         *   // ...
         * }
         * @dr(arg1, arg2);
         */
        ALT: () => args = $.SUBRULE($.mixinArgs)
      },
      /** Just a regular unknown at-rule */
      {
        GATE: isNotVariableLike,
        ALT: cssUnknownAtRule.bind(this, T)
      }
    ])

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      if (returnVal instanceof AtRule) {
        return returnVal
      }
      let nameVal: string | Interpolated = getNodeFromString(name.image)
      let nameNode: Interpolated | General<'Name'>
      if (!(nameVal instanceof Interpolated)) {
        nameNode = new General(nameVal, { type: 'Name' }, $.getLocationInfo(name), this.context)
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
        ['value', $.wrap(value!, true)],
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
                signed.image = str.slice(1)
                signed.startOffset += 1
                signed.startColumn! += 1
                right = $.processValueToken(signed)
              }
            }
          }
        ])

        if (!RECORDING_PHASE) {
          left = $.wrap(new Operation([$.wrap(left, true), op as Operator, $.wrap(right!)], undefined, 0, this.context))
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
        left = $.wrap(new Operation([$.wrap(left, true), op.image as Operator, $.wrap(right!)], undefined, 0, this.context))
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

          $.CONSUME(T.LParen)
          let node = $.SUBRULE($.expressionSum, { ARGS: [ctx] })
          $.CONSUME(T.RParen)

          if (!RECORDING_PHASE) {
            let location = $.endRule()
            node = $.wrap(node, 'both')
            return new Paren(node, undefined, location, this.context)
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
  ]

  return cssKnownFunctions.call(this, T, functions)
}

export function ifFunction(this: P, T: TokenMap) {
  const $ = this

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    $.CONSUME(T.IfFunction)
    $.startRule()

    let node: Node = $.SUBRULE($.guardOr, { ARGS: [{ inValueList: true }] })
    let values: Node[]

    if (!RECORDING_PHASE) {
      values = [node]
    }

    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Semi)
          node = $.SUBRULE($.valueList, { ARGS: [{ allowAnonymousMixins: true }] })
          if (!RECORDING_PHASE) {
            values.push(node)
          }
          $.OPTION(() => {
            $.CONSUME2(T.Semi)
            node = $.SUBRULE2($.valueList, { ARGS: [{ allowAnonymousMixins: true }] })
            if (!RECORDING_PHASE) {
              values.push(node)
            }
          })
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.Comma)
          node = $.SUBRULE($.valueSequence, { ARGS: [{ allowAnonymousMixins: true }] })
          if (!RECORDING_PHASE) {
            values.push(node)
          }
          $.OPTION2(() => {
            $.CONSUME2(T.Comma)
            node = $.SUBRULE2($.valueSequence, { ARGS: [{ allowAnonymousMixins: true }] })
            if (!RECORDING_PHASE) {
              values.push(node)
            }
          })
        }
      }
    ])
    $.CONSUME(T.RParen)
  }
}

  $.RULE('booleanFunction', () => {
    $.CONSUME(T.BooleanFunction)
    $.SUBRULE($.guardOr, { ARGS: [{ inValueList: true }] })
    $.CONSUME(T.RParen)
  })

  /** At AST time, join comma-lists together if separated by semis */
  $.RULE('functionValueList', (ctx: RuleContext = {}) => {
    ctx.allowAnonymousMixins = true
    $.SUBRULE($.valueSequence, { ARGS: [ctx] })
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Comma) },
        { ALT: () => $.CONSUME(T.Semi) }
      ])
      $.SUBRULE2($.valueSequence, { ARGS: [ctx] })
    })
  })

  $.RULE('valueReference', () => {
    $.OR([
      {
        ALT: () => {
          $.SUBRULE($.mixinReference)
          $.OPTION(() => $.SUBRULE($.mixinArgs))
          $.SUBRULE($.accessors)
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.AtKeyword)
          $.OPTION2(() => $.SUBRULE2($.accessors))
        }
      }
    ])
  })

  $.OVERRIDE_RULE('value', (ctx: RuleContext = {}) => {
    $.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        /** Function should appear before Ident */
        { ALT: () => $.SUBRULE($.function) },
        { ALT: () => $.SUBRULE($.inlineMixinCall) },
        /**
         * Functions can pass anonymous mixin definitions
         * as arguments. (Used with `each`)
         */
        {
          GATE: () => !!ctx.allowAnonymousMixins,
          ALT: () => $.SUBRULE($.anonymousMixinDefinition)
        },
        {
          ALT: () => {
            $.CONSUME(T.AtKeyword)
            $.OPTION(() => $.SUBRULE($.accessors))
          }
        },
        { ALT: () => $.SUBRULE($.string) },
        { ALT: () => $.CONSUME(T.Value) },
        /** Explicitly not marked as an ident */
        { ALT: () => $.CONSUME(T.When) },
        {
          ALT: () => {
            $.CONSUME(T.LSquare)
            $.CONSUME2(T.Ident)
            $.CONSUME(T.RSquare)
          }
        },
        {
          /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
          GATE: () => $.legacyMode,
          ALT: () => $.CONSUME(T.LegacyMSFilter)
        }
      ]
    })
  })

  $.OVERRIDE_RULE('mathValue', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.AtKeyword) },
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.SUBRULE($.function) },
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
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.SUBRULE($.mathSum)
          $.CONSUME(T.RParen)
        }
      }
    ])
  })

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
}

export function guards(this: LessParser, T: TokenMap) {
  const $ = this

  $.RULE('guard', (ctx: RuleContext = {}) => {
    $.CONSUME(T.When)
    $.OR([
      {
        GATE: () => !!ctx.inValueList,
        ALT: () => $.SUBRULE($.comparison)
      },
      {
        ALT: () => $.SUBRULE($.guardOr, { ARGS: [{ ...ctx, allowComma: true }] })
      }
    ])
  })

  /**
   * 'or' expression
   * Allows an (outer) comma like historical media queries
   */
  $.RULE('guardOr', (ctx: RuleContext = {}) => {
    $.OR([
      { ALT: () => $.CONSUME(T.DefaultGuard) },
      {
        ALT: () => {
          $.SUBRULE($.guardAnd, { ARGS: [ctx] })
          $.MANY({
            GATE: () => !!ctx.allowComma || $.LA(1).tokenType !== T.Comma,
            DEF: () => {
              /**
                     * Nest expressions within expressions for correct
                     * order of operations.
                     */
              $.OR2([
                { ALT: () => $.CONSUME($.T.Comma) },
                { ALT: () => $.CONSUME($.T.Or) }
              ])
              $.SUBRULE2($.guardAnd, { ARGS: [ctx] })
            }
          })
        }
      }
    ])
  })

  /**
   * 'and' and 'or' expressions
   *
   *  In Media queries level 4, you cannot have
   *  `([expr]) or ([expr]) and ([expr])` because
   *  of evaluation order ambiguity.
   *  However, Less allows it.
   */
  $.RULE('guardAnd', (ctx: RuleContext = {}) => {
    $.MANY_SEP({
      SEP: T.And,
      DEF: () => {
        $.OPTION(() => $.CONSUME(T.Not))
        $.SUBRULE($.guardInParens)
      }
    })
  })

  $.RULE('guardInParens', () => {
    $.CONSUME(T.LParen)
    $.OR([
      { ALT: () => $.SUBRULE($.guardOr) },
      { ALT: () => $.SUBRULE($.comparison) }
    ])
    $.CONSUME(T.RParen)
  })

  /** Currently, Less only allows a single comparison expression */
  $.RULE('comparison', () => {
    $.SUBRULE($.valueList, { LABEL: 'L' })
    $.OPTION(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Eq) },
        { ALT: () => $.CONSUME(T.Gt) },
        { ALT: () => $.CONSUME(T.GtEq) },
        { ALT: () => $.CONSUME(T.GtEqAlias) },
        { ALT: () => $.CONSUME(T.Lt) },
        { ALT: () => $.CONSUME(T.LtEq) },
        { ALT: () => $.CONSUME(T.LtEqAlias) }
      ])
      $.SUBRULE2($.valueList, { LABEL: 'R' })
    })
  })

  $.RULE('comparison2', () => {
    $.SUBRULE($.valueList, { LABEL: 'L' })
    $.OPTION(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Eq) },
        { ALT: () => $.CONSUME(T.Gt) },
        { ALT: () => $.CONSUME(T.GtEq) },
        { ALT: () => $.CONSUME(T.GtEqAlias) },
        { ALT: () => $.CONSUME(T.Lt) },
        { ALT: () => $.CONSUME(T.LtEq) },
        { ALT: () => $.CONSUME(T.LtEqAlias) }
      ])
      $.SUBRULE2($.valueList, { LABEL: 'R' })
    })
  })
}

export function atRuleBubbling(this: LessParser, T: TokenMap) {
  const $ = this

  /**
   * Less (perhaps unwisely) allows bubling of normally document-root
   * at-rules, so we need to override CSS here.
   */
  $.OVERRIDE_RULE('innerAtRule', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.importAtRule) },
      { ALT: () => $.SUBRULE($.pageAtRule) },
      { ALT: () => $.SUBRULE($.fontFaceAtRule) },
      { ALT: () => $.SUBRULE($.nestedAtRule) },
      { ALT: () => $.SUBRULE($.nonNestedAtRule) },
      { ALT: () => $.SUBRULE($.unknownAtRule) }
    ])
  })
}

export function mixinsAndNamespaces(this: LessParser, T: TokenMap) {
  const $ = this

  /** e.g. .mixin, #mixin */
  $.RULE('mixinName', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.classSelector) },
      { ALT: () => $.SUBRULE($.idSelector) }
    ])
  })

  $.RULE('mixinReference', () => {
    $.SUBRULE($.mixinName)
    $.MANY(() => {
      $.OPTION(() => $.CONSUME(T.Gt))
      $.SUBRULE2($.mixinName)
    })
  })

  /** e.g. #ns > .mixin() */
  $.RULE('mixinCall', () => {
    $.SUBRULE($.mixinReference)

    /** Either needs to end in parens or in a semi-colon (or both) */
    $.OR([
      {
        ALT: () => {
          $.SUBRULE($.mixinArgs)
          $.OPTION2(() => $.CONSUME(T.Important))
          $.OPTION3(() => $.CONSUME(T.Semi))
        }
      },
      { ALT: () => $.CONSUME2(T.Semi) }
    ])
  })

  /**
   * Used within a value. These can be
   * chained more recursively, unlike
   * Less 1.x-4.x
   *   e.g. .mixin1() > .mixin2[@val1].ns() > .sub-mixin[@val2]
   */
  $.RULE('inlineMixinCall', () => {
    $.SUBRULE($.mixinReference)
    $.OPTION(() => $.SUBRULE($.mixinArgs))
    $.OPTION2(() => $.SUBRULE($.accessors))
  })

  $.RULE('mixinDefinition', () => {
    $.SUBRULE($.mixinName)
    $.SUBRULE($.mixinArgs, { ARGS: [{ isDefinition: true }] })
    $.OPTION(() => $.SUBRULE($.guard))
    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  $.RULE('mixinArgs', (ctx: RuleContext = {}) => {
    $.CONSUME(T.LParen)
    $.OPTION(() => $.SUBRULE($.mixinArgList, { ARGS: [ctx] }))
    $.CONSUME(T.RParen)
  })

  $.RULE('accessors', () => {
    $.CONSUME(T.LSquare)
    $.OPTION(() => $.OR([
      { ALT: () => $.CONSUME(T.NestedReference) },
      { ALT: () => $.CONSUME(T.AtKeyword) },
      { ALT: () => $.CONSUME(T.PropertyReference) },
      { ALT: () => $.CONSUME(T.Ident) }
    ]))
    $.CONSUME(T.RSquare)
    /** Allows chaining of lookups / calls */
    $.OPTION2(() => {
      $.OR2([
        { ALT: () => $.SUBRULE($.inlineMixinCall) },
        { ALT: () => $.SUBRULE($.accessors) }
      ])
    })
  })

  /**
   * @see https://lesscss.org/features/#mixins-feature-mixins-parametric-feature
   *
   * Less allows separating with commas or semi-colons, so we sort out
   * the bounds of each argument in the CST Visitor.
   */
  $.RULE('mixinArgList', (ctx: RuleContext = {}) => {
    $.SUBRULE($.mixinArg, { ARGS: [ctx] })
    $.MANY(() => {
      $.OR([
        {
          ALT: () => {
            $.CONSUME(T.Comma)
            $.SUBRULE2($.mixinArg, { ARGS: [ctx] })
          }
        },
        {
          ALT: () => {
            $.CONSUME(T.Semi)
            $.OPTION(() => $.SUBRULE3($.mixinArg, { ARGS: [ctx] }))
          }
        }
      ])
    })
  })

  $.RULE('mixinArg', (ctx: RuleContext = {}) => {
    const definition = !!ctx.isDefinition
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.AtKeyword)
          $.OPTION(() => {
            $.OR2([
              {
                ALT: () => {
                  $.CONSUME(T.Colon)
                  $.SUBRULE($.mixinValue)
                }
              },
              /**
               * Mixin definitions can spread variables, which
               * means it will match a variable number of elements
               * at the end.
               *
               * However, mixin calls can also spread variables,
               * which means it will expand a variable representing
               * a list, which, to my knowledge, is an undocumented
               * feature of Less (and only exists in mixin calls?)
               *
               * @todo - Intuitively, shouldn't this be available
               * elsewhere in the language? Or would there be no
               * reason?
               */
              { ALT: () => $.CONSUME(T.Ellipsis) }
            ])
          })
        }
      },
      { ALT: () => $.SUBRULE2($.mixinValue) },
      {
        GATE: () => definition,
        ALT: () => $.CONSUME2(T.Ellipsis)
      }
    ])
  })

  $.RULE('mixinValue', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.SUBRULE($.declarationList)
          $.CONSUME(T.RCurly)
        }
      },
      { ALT: () => $.SUBRULE($.valueSequence) }
    ])
  })
}