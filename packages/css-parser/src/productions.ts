/* eslint-disable no-return-assign */
import type { CssActionsParser, TokenMap, RuleContext } from './cssActionsParser'
import { type IToken } from 'chevrotain'
import {
  TreeContext,
  Node,
  type LocationInfo,
  type AssignmentType,
  type Operator,
  Root,
  Anonymous,
  Ruleset,
  Declaration,
  Scope,
  type SimpleSelector,
  SelectorList,
  SelectorSequence,
  Rules,
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
  Keyword
} from '@jesscss/core'

export function productions(this: CssActionsParser, T: TokenMap) {
  const $ = this

  // stylesheet
  //   : CHARSET? main EOF
  //   ;
  $.RULE('stylesheet', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    let context: TreeContext
    let initialScope: Scope
    if (!RECORDING_PHASE) {
      // @ts-expect-error - Not exported with `export type`
      context = this.context = new TreeContext()
      initialScope = context.scope
    }
    $.startRule()

    let charset: IToken | undefined
    let root: Node | undefined

    $.OPTION(() => {
      charset = $.CONSUME(T.Charset)
    })
    $.OPTION2(() => {
      root = $.SUBRULE($.main, { ARGS: [{ isRoot: true }] })
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      root ??= new Root([], undefined, location, context!)
      if (charset) {
        root.value.unshift(new Anonymous(charset.image, undefined, $.getLocationInfo(charset), context!))
      }
      this.context.scope = initialScope!
      return root
    }
  })

  // main
  //   : (WS
  //     | qualifiedRule
  //     | atRule
  //   )*
  //   ;
  $.RULE('main', (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    const isRoot = !!ctx.isRoot
    let context = this.context
    let initialScope: Scope

    if (!RECORDING_PHASE) {
      context = this.context

      if (!isRoot) {
        initialScope = context.scope
        context.scope = new Scope(initialScope)
      }
    }
    let rules: Node[]

    if (!RECORDING_PHASE) {
      rules = []
    }

    $.MANY(() => {
      let rule = $.OR([
        { ALT: () => $.SUBRULE($.qualifiedRule) },
        { ALT: () => $.SUBRULE($.atRule) }
      ])
      if (!RECORDING_PHASE) {
        rules.push(rule)
      }
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      let finalRules = $.getRulesWithComments(rules!)
      let returnNode: Node
      if (isRoot) {
        returnNode = new Root(finalRules, undefined, location, context)
      } else {
        returnNode = new Rules(finalRules, undefined, location, context)
      }
      if (!isRoot) {
        context.scope = initialScope!
      }
      // Attaches remaining whitespace at the end of rules
      return $.wrap(returnNode, true)
    }
  })

  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  $.RULE('qualifiedRule', (ctx: RuleContext = {}) => {
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
    ]) as SelectorList

    $.CONSUME(T.LCurly)
    let rules = $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new Ruleset([
        ['selector', selector],
        ['rules', rules]
      ], undefined, location, this.context)
    }
  })

  /** * SELECTORS ***/
  /** @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors  */
  /**
      A selector with a single component, such as a single id selector
      or type selector, that's not used in combination with or contains
      any other selector component or combinator
        .e.g `a` | `#selected` | `.foo`

      @todo Define known pseudos

      NOTE: A COLOR_IDENT_START token is a valid ID
    */
  // simpleSelector
  //   : classSelector
  //   | ID
  //   | COLOR_IDENT_START
  //   | identifier
  //   | AMPERSAND
  //   | STAR
  //   | pseudoSelector
  //   | attributeSelector
  //   ;
  $.RULE('simpleSelector', (ctx: RuleContext = {}) => {
    let selector = $.OR([
      {
        /**
         * It used to be the case that, in CSS Nesting, the first selector
         * could not be an identifier. However, it looks like that's no
         * longer the case.
         *
         * @see: https://github.com/w3c/csswg-drafts/issues/9317
         */
        // GATE: () => !ctx.firstSelector,
        ALT: () => $.CONSUME(T.Ident)
      },
      {
        /** In CSS Nesting, outer selector can't contain an ampersand */
        GATE: () => !!ctx.inner,
        ALT: () => $.CONSUME(T.Ampersand)
      },
      { ALT: () => $.SUBRULE($.classSelector) },
      { ALT: () => $.SUBRULE($.idSelector) },
      { ALT: () => $.CONSUME(T.Star) },
      { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.attributeSelector) }
    ])

    if (!$.RECORDING_PHASE) {
      if ($.isToken(selector)) {
        if (selector.tokenType.name === 'Ampersand') {
          return new Ampersand(selector.image, undefined, $.getLocationInfo(selector), this.context)
        }
        return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context)
      }
      return selector as Node
    }
  })

  // classSelector
  //   : DOT identifier
  //   ;
  $.RULE('classSelector', () => {
    let selector = $.CONSUME(T.DotName)
    if (!$.RECORDING_PHASE) {
      return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context)
    }
  })

  /** #id, #FF0000 are both valid ids */
  $.RULE('idSelector', () => {
    let selector = $.OR([
      { ALT: () => $.CONSUME(T.HashName) },
      { ALT: () => $.CONSUME(T.ColorIdentStart) }
    ])
    if (!$.RECORDING_PHASE) {
      return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context)
    }
  })

  // pseudoSelector
  //   : NTH_PSEUDO_CLASS '(' WS* nthValue WS* ')'
  //   | FUNCTIONAL_PSEUDO_CLASS '(' WS* forgivingSelectorList WS* ')'
  //   | COLON COLON? identifier ('(' anyInnerValue* ')')?
  //   ;
  $.RULE('pseudoSelector', (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    const createPseudo = (name: string, value?: Node) => {
      if (!RECORDING_PHASE) {
        let location = $.endRule()
        return new PseudoSelector([
          ['name', name],
          ['value', value]
        ], undefined, location, this.context)
      }
    }

    return $.OR([
      {
        ALT: () => {
          let name = $.CONSUME(T.NthPseudoClass)
          let val = $.SUBRULE($.nthValue)
          $.CONSUME(T.RParen)

          return createPseudo(name.image.slice(0, -1), val)
        }
      },
      {
        ALT: () => {
          let name = $.CONSUME(T.SelectorPseudoClass)
          let val = $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] })
          $.CONSUME2(T.RParen)

          return createPseudo(name.image.slice(0, -1), val)
        }
      },
      {
        ALT: () => {
          let name = $.CONSUME(T.Colon).image
          $.OPTION({
            GATE: $.noSep,
            DEF: () => {
              name += $.CONSUME2(T.Colon).image
            }
          })
          /**
           * We use OR often to assert that no whitespace is allowed.
           * There's no other way currently to do a positive-assertion Gate
           * in Chevrotain.
           */
          let values = $.OR4([
            {
              GATE: $.noSep,
              ALT: () => {
                name += $.CONSUME(T.Ident).image
                let values: Node[]
                if (!RECORDING_PHASE) {
                  values = []
                }
                let valuesLocation: LocationInfo
                $.OPTION2(() => {
                  $.CONSUME(T.LParen)
                  $.startRule()
                  $.MANY(() => {
                    let val = $.SUBRULE($.anyInnerValue)
                    if (!RECORDING_PHASE) {
                      values!.push(val)
                    }
                  })
                  if (!RECORDING_PHASE) {
                    valuesLocation = $.endRule()
                  }
                  $.CONSUME3(T.RParen)
                })
                if (!RECORDING_PHASE && values!.length) {
                  return new Sequence(values!, undefined, valuesLocation!, this.context)
                }
              }
            }
          ])
          return createPseudo(name, values)
        }
      }
    ])
  })

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/:nth-child
   */
  $.RULE('nthValue', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let startTokenOffset: number | undefined
    if (!RECORDING_PHASE) {
      startTokenOffset = this.LA(1).startOffset
    }

    $.OR([
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
    ])

    if (!RECORDING_PHASE) {
      /** Coelesce all token values into one value */
      let endTokenOffset = $.LA(-1).startOffset
      let location = $.endRule()
      let origTokens = this.originalInput
      let origLength = origTokens.length
      let tokenValues = ''
      for (let i = 0; i < origLength; i++) {
        let token = origTokens[i]!
        if (token.startOffset >= startTokenOffset!) {
          tokenValues += token.image
        }
        if (token.startOffset > endTokenOffset) {
          break
        }
      }
      return $.wrap(new Anonymous(tokenValues, undefined, location, this.context), 'both')
    }
  })

  // attributeSelector
  //   : LSQUARE WS* identifier (STAR | TILDE | CARET | DOLLAR | PIPE)? EQ WS* (identifier | STRING) WS* (ATTRIBUTE_FLAG WS*)? RSQUARE
  //   ;
  $.RULE('attributeSelector', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    $.CONSUME(T.LSquare)
    let key = $.CONSUME(T.Ident)
    let op: IToken | undefined
    let value: Node | undefined
    let mod: IToken | undefined
    $.OPTION(() => {
      op = $.OR([
        { ALT: () => $.CONSUME(T.Eq) },
        { ALT: () => $.CONSUME(T.AttrMatch) }
      ])
      value = $.OR2([
        {
          ALT: () => {
            let token = $.CONSUME2(T.Ident)
            if (!RECORDING_PHASE) {
              return new Anonymous(token.image, undefined, $.getLocationInfo(token), this.context)
            }
          }
        },
        { ALT: () => $.SUBRULE($.string) }
      ])
    })
    $.OPTION2(() => mod = $.CONSUME(T.AttrFlag))
    $.CONSUME(T.RSquare)

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      return new AttributeSelector([
        ['key', key.image],
        ['op', op?.image],
        ['value', value],
        ['mod', mod?.image]
      ], undefined, location, this.context)
    }
  })

  /**
      A sequence of simple selectors that are not separated by
      a combinator.
        .e.g. `a#selected`
    */
  // compoundSelector
  //   : simpleSelector+
  //   ;
  $.RULE('compoundSelector', (ctx: RuleContext = {}) => {
    let selectors: Node[] = []
    selectors.push($.SUBRULE($.simpleSelector, { ARGS: [ctx] }))
    $.MANY({
      /** Make sure we don't ignore space combinators */
      GATE: () => !$.hasWS(),
      DEF: () => selectors.push($.SUBRULE2($.simpleSelector, { ARGS: [{ ...ctx, firstSelector: false }] }))
    })
    return selectors
  })

  /**
      A sequence of one or more simple and/or compound selectors
      that are separated by combinators.
        .e.g. a#selected > .icon
    */
  // complexSelector
  //   : compoundSelector (WS* (combinator WS*)? compoundSelector)*
  //   ;
  $.RULE('complexSelector', (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let selectors: Node[] = $.SUBRULE($.compoundSelector, { ARGS: [ctx] })

    /**
     * Only space combinators and specified combinators will enter the MANY
     */
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

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      return new SelectorSequence(selectors as Array<SimpleSelector | Combinator>, undefined, location, this.context)
    }
  })

  /**
      A selector representing an element relative to one or more
      anchor elements preceded by a combinator.
        e.g. + div#topic > #reference
    */
  // relativeSelector
  //   : (combinator WS*)? complexSelector
  //   ;
  $.RULE('relativeSelector', (ctx: RuleContext = {}) => {
    return $.OR([
      {
        ALT: () => {
          let co = $.CONSUME(T.Combinator)
          let sequence: SelectorSequence = $.SUBRULE($.complexSelector, { ARGS: [{ ...ctx, firstSelector: false }] })

          if (!$.RECORDING_PHASE) {
            sequence.value.unshift(new Combinator(co.image, undefined, $.getLocationInfo(co), this.context))
            let location = sequence.location
            location[0] = co.startOffset
            location[1] = co.startLine
            location[2] = co.startColumn
          }
          return sequence
        }
      },
      {
        ALT: () => $.SUBRULE2($.complexSelector, { ARGS: [ctx] })
      }
    ])
  })

  /**
      https://www.w3.org/TR/css-nesting-1/

      NOTE: implementers should throw a parsing
      error if the selectorlist starts with an identifier
    */
  // forgivingSelectorList
  //   : relativeSelector (WS* COMMA WS* relativeSelector)*
  //   ;
  $.RULE('forgivingSelectorList', (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let sequences: SelectorSequence[]
    let selector = $.SUBRULE($.relativeSelector, { ARGS: [ctx] })

    if (!RECORDING_PHASE) {
      sequences = [$.wrap(selector, true)]
    }

    $.MANY(() => {
      $.CONSUME(T.Comma)
      let selector = $.SUBRULE2($.relativeSelector, { ARGS: [{ ...ctx, firstSelector: false }] })
      if (!RECORDING_PHASE) {
        sequences.push($.wrap(selector, 'both'))
      }
    })

    if (!RECORDING_PHASE) {
      if (sequences!.length === 1) {
        return sequences![0]
      }
      let location = $.endRule()
      return new SelectorList(sequences!, undefined, location, this.context)
    }
  })

  // selectorList
  //   : complexSelector (WS* COMMA WS* complexSelector)*
  //   ;
  $.RULE('selectorList', (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let sequences: SelectorSequence[]
    let sel = $.SUBRULE($.complexSelector, { ARGS: [ctx] })

    if (!RECORDING_PHASE) {
      sequences = [$.wrap(sel, true)]
    }

    $.MANY(() => {
      $.CONSUME(T.Comma)
      let sel = $.SUBRULE2($.complexSelector, { ARGS: [ctx] })
      if (!RECORDING_PHASE) {
        sequences.push($.wrap(sel, 'both'))
      }
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      if (sequences!.length === 1) {
        return sequences![0]!
      }
      return new SelectorList(sequences!, undefined, location, this.context)
    }
  })

  /** * Declarations ***/
  // https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
  // declarationList
  //   : WS* (
  //     declaration? (WS* SEMI declarationList)*
  //     | innerAtRule declarationList
  //     | innerQualifiedRule declarationList
  //   )
  //   ;
  /**
   * Originally this was structured much like the CSS spec,
   * like this:
   *  $.OPTION(() => $.SUBRULE($.declaration))
   *  $.OPTION2(() => {
   *     $.CONSUME(T.Semi)
   *     $.SUBRULE3($.declarationList)
   *   })
   * ...but chevrotain-allstar doesn't deal well with
   * recursivity, as it predicts the ENTIRE path for
   * each alt
   */
  $.RULE('declarationList', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE

    $.startRule()

    let context = this.context
    let initialScope: Scope
    let rules: Node[]

    if (!RECORDING_PHASE) {
      initialScope = context.scope
      context.scope = new Scope(initialScope)
      rules = []
    }
    let needsSemi = false
    $.MANY({
      GATE: () => !needsSemi || (needsSemi && $.LA(1).tokenType === T.Semi),
      DEF: () => {
        $.OR([
          {
            ALT: () => {
              let decl = $.SUBRULE($.declaration)
              needsSemi = true
              $.OPTION(() => {
                $.CONSUME(T.Semi)
                needsSemi = false
              })

              if (!RECORDING_PHASE) {
                if (!needsSemi) {
                  let options = decl.options ?? {}
                  options.semi = true
                  decl.options = options
                }
                rules.push(decl)
              }
            }
          },
          {
            ALT: () => {
              let value = $.OR2([
                { ALT: () => $.SUBRULE($.innerAtRule) },
                { ALT: () => $.SUBRULE2($.qualifiedRule, { ARGS: [{ inner: true }] }) },
                { ALT: () => $.CONSUME2(T.Semi) }
              ])
              if (!RECORDING_PHASE && value instanceof Node) {
                rules.push(value)
              }
              needsSemi = false
            }
          }
        ])
      }
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      let finalRules = $.getRulesWithComments(rules!)
      let returnRules = new Rules(finalRules, undefined, location, this.context)
      context.scope = initialScope!
      // Attaches remaining whitespace at the end of rules
      return $.wrap(returnRules, true)
    }
  })

  // declaration
  //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
  //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
  //   ;
  $.RULE('declaration', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let name: IToken | undefined
    let assign: IToken | undefined
    let value: Node | undefined
    let important: IToken | undefined
    $.OR([
      {
        ALT: () => {
          $.OR2([
            {
              ALT: () => name = $.CONSUME(T.Ident)
            },
            {
              GATE: () => $.legacyMode,
              ALT: () => name = $.CONSUME(T.LegacyPropIdent)
            }
          ])
          assign = $.CONSUME(T.Assign)
          value = $.SUBRULE($.valueList)
          $.OPTION(() => {
            important = $.CONSUME(T.Important)
          })
        }
      },
      {
        ALT: () => {
          name = $.CONSUME(T.CustomProperty)
          assign = $.CONSUME2(T.Assign)
          let nodes: Node[] = []
          $.startRule()
          /** @todo - should collect ALL tokens in a stream, including whitespace */
          $.MANY(() => nodes.push($.SUBRULE($.customValue)))
          if (!RECORDING_PHASE) {
            let location = $.endRule()
            value = new Sequence(nodes, undefined, location, this.context)
          }
        }
      }
    ])

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      return new Declaration([
        ['name', name!.image],
        ['value', $.wrap(value!, true)],
        ['important', important ? $.wrap(new Anonymous(important.image), true) : undefined]
      ], { assign: assign!.image as AssignmentType }, location, this.context)
    }
  })

  /**
   * @todo - This could be implemented with a multi-mode lexer?
   * Multi-modes was the right way to do it with Antlr, but
   * Chevrotain does not support recursive tokens very well.
   */
  $.RULE('customValue', () =>
    $.OR([
      { ALT: () => $.SUBRULE($.extraTokens) },
      { ALT: () => $.SUBRULE($.customBlock) }
    ])
  )

  /** Can also have semi-colons */
  $.RULE('innerCustomValue', () => {
    $.OR([
      {
        ALT: () => {
          let semi = $.CONSUME(T.Semi)
          if (!$.RECORDING_PHASE) {
            return $.wrap(new Anonymous(semi.image, undefined, $.getLocationInfo(semi), this.context))
          }
        }
      },
      { ALT: () => $.SUBRULE($.extraTokens) },
      { ALT: () => $.SUBRULE($.customBlock) }
    ])
  })

  /**
   * Extra tokens in a custom property or general enclosed. Should include any
   * and every token possible (except semis), including unknown tokens.
   *
   * @todo - In tests, is there a way to test that every token is captured?
   */
  $.RULE('extraTokens', () => {
    let token: IToken | undefined
    let node: Node | undefined
    $.OR([
      { ALT: () => node = $.SUBRULE($.knownFunctions) },
      { ALT: () => token = $.CONSUME(T.Value) },
      { ALT: () => token = $.CONSUME(T.CustomProperty) },
      { ALT: () => token = $.CONSUME(T.Colon) },
      { ALT: () => token = $.CONSUME(T.AtName) },
      { ALT: () => token = $.CONSUME(T.Comma) },
      { ALT: () => token = $.CONSUME(T.Important) },
      { ALT: () => token = $.CONSUME(T.Unknown) }
    ])
    if (!$.RECORDING_PHASE) {
      if (token) {
        node = $.wrap($.processValueToken(token))
      }
      return node
    }
  })

  $.RULE('customBlock', () => {
    $.startRule()
    let start: IToken | undefined
    let end: IToken | undefined
    let nodes: Node[] = []
    $.OR([
      {
        ALT: () => {
          $.OR2([
            /**
             * All tokens that have a left parentheses.
             * These need to match a right parentheses.
             */
            { ALT: () => start = $.CONSUME(T.LParen) },
            { ALT: () => start = $.CONSUME(T.Function) },
            { ALT: () => start = $.CONSUME(T.FunctionalPseudoClass) }
          ])

          $.MANY(() => nodes.push($.SUBRULE($.innerCustomValue)))
          end = $.CONSUME(T.RParen)
        }
      },
      {
        ALT: () => {
          start = $.CONSUME(T.LSquare)
          $.MANY2(() => nodes.push($.SUBRULE2($.innerCustomValue)))
          end = $.CONSUME(T.RSquare)
        }
      },
      {
        ALT: () => {
          start = $.CONSUME(T.LCurly)
          $.MANY3(() => nodes.push($.SUBRULE3($.innerCustomValue)))
          end = $.CONSUME(T.RCurly)
        }
      }
    ])

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      let startNode = $.wrap(new Anonymous(start!.image, undefined, $.getLocationInfo(start!), this.context))
      let endNode = $.wrap(new Anonymous(end!.image, undefined, $.getLocationInfo(end!), this.context))
      nodes = [startNode, ...nodes, endNode]
      return new Sequence(nodes, undefined, location, this.context)
    }
  })

  /** Values separated by commas */
  // valueList
  //   : value+ (, value+)*
  //   ;
  $.RULE('valueList', (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let nodes: Node[]
    if (!RECORDING_PHASE) {
      nodes = []
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let seq = $.SUBRULE($.valueSequence, { ARGS: [ctx] })
        if (!RECORDING_PHASE) {
          nodes!.push(seq)
        }
      }
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      if (nodes!.length === 1) {
        return nodes![0]
      }
      return new List(nodes!, undefined, location, this.context)
    }
  })

  /** Often space-separated */
  $.RULE('valueSequence', (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let nodes: Node[]

    if (!RECORDING_PHASE) {
      nodes = []
    }

    $.AT_LEAST_ONE(() => {
      let value = $.SUBRULE($.value, { ARGS: [ctx] })

      if (!RECORDING_PHASE) {
        nodes.push(value)
      }
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      if (nodes!.length === 1) {
        return nodes![0]
      }
      return new Sequence(nodes!, undefined, location, this.context)
    }
  })

  $.RULE('squareValue', (ctx: RuleContext = {}) => {
    $.CONSUME(T.LSquare)
    $.CONSUME(T.Ident)
    $.CONSUME(T.RSquare)
  })

  // value
  //   : WS
  //   | identifier
  //   | integer
  //   | number
  //   | dimension
  //   | COLOR_IDENT_START
  //   | COLOR_INT_START
  //   | STRING
  //   | function
  //   | '[' identifier ']'
  //   | unknownValue
  //   ;
  $.RULE('value', (ctx: RuleContext = {}) => {
    $.startRule()
    let token: IToken | undefined
    let node: Node | undefined
    $.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        /** Function should appear before Ident */
        { ALT: () => node = $.SUBRULE($.function) },
        { ALT: () => token = $.CONSUME(T.Ident) },
        { ALT: () => token = $.CONSUME(T.Dimension) },
        { ALT: () => token = $.CONSUME(T.Number) },
        { ALT: () => token = $.CONSUME(T.Color) },
        { ALT: () => node = $.SUBRULE($.string) },
        { ALT: () => node = $.SUBRULE($.squareValue) },
        {
          /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
          GATE: () => $.legacyMode,
          ALT: () => token = $.CONSUME(T.LegacyMSFilter)
        }
      ]
    })
    /**
     * Allows slash separators. Note that, structurally, the meaning
     * of slash separators in CSS is inconsistent and ambiguous. It
     * could separate a sequence of tokens from another sequence,
     * or it could separate ONE token from another, with other tokens
     * not included in the "slash list", OR it can represent division
     * in a math expression. CSS is just, unfortunately, not a very
     * syntactically-consistent language, and each property's value
     * essentially has a defined "micro-syntax".
     */
    let additionalValue: Node | undefined
    $.OPTION(() => {
      $.CONSUME(T.Slash)
      additionalValue = $.SUBRULE($.value)
    })
    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      if (token) {
        node = $.processValueToken(token)
      }
      if (additionalValue) {
        return $.wrap(new List([$.wrap(node!, true), additionalValue], { sep: '/' }, location, this.context))
      }
      return $.wrap(node!)
    }
  })

  $.RULE('string', () => {
    $.startRule()
    let quote: IToken | undefined
    let contents: IToken | undefined
    $.OR([
      {
        ALT: () => {
          quote = $.CONSUME(T.SingleQuoteStart)
          $.OPTION(() => contents = $.CONSUME(T.SingleQuoteStringContents))
          $.CONSUME(T.SingleQuoteEnd)
        }
      },
      {
        ALT: () => {
          quote = $.CONSUME(T.DoubleQuoteStart)
          $.OPTION2(() => contents = $.CONSUME(T.DoubleQuoteStringContents))
          $.CONSUME(T.DoubleQuoteEnd)
        }
      }
    ])
    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      let value = contents?.image
      return new Quoted(new Anonymous(value ?? ''), { quote: quote!.image as '"' | "'" }, location, this.context)
    }
  })

  /** Implementers can decide to throw errors or warnings or not */
  // unknownValue
  //   : COLON
  //   | EQ
  //   | DOT
  //   | ID
  //   | UNKNOWN
  //   | AT_RULE
  //   ;
  // $.RULE('unknownValue', () => {
  //   $.OR([
  //     { ALT: () => $.CONSUME(T.Colon) },
  //     { ALT: () => $.CONSUME(T.Eq) },
  //     { ALT: () => $.CONSUME(T.DotName) },
  //     { ALT: () => $.CONSUME(T.HashName) },
  //     { ALT: () => $.CONSUME(T.Unknown) },
  //     { ALT: () => $.CONSUME(T.AtName) }
  //   ])
  // })

  /** Abstracted for easy over-ride */
  // $.RULE('expression', () => {
  //   $.SUBRULE($.mathSum)
  // })

  // mathSum
  //   : mathProduct (WS* ('+' | '-') WS* mathProduct)*
  //   ;
  $.RULE('mathSum', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let op: IToken | undefined
    let left: Node = $.SUBRULE($.mathProduct)

    $.MANY(() => {
      $.OR([
        { ALT: () => op = $.CONSUME(T.Plus) },
        { ALT: () => op = $.CONSUME(T.Minus) }
      ])
      let right: Node = $.SUBRULE2($.mathProduct)

      if (!RECORDING_PHASE) {
        left = new Operation([left, op!.image as Operator, right], undefined, 0, this.context)
      }
    })
    if (!RECORDING_PHASE) {
      left.location = $.endRule()
      return left
    }
  })

  // mathProduct
  //   : mathValue (WS* ('*' | '/') WS* mathValue)*
  //   ;
  $.RULE('mathProduct', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let op: IToken | undefined
    let left: Node = $.SUBRULE($.mathValue)

    $.MANY(() => {
      $.OR([
        { ALT: () => op = $.CONSUME(T.Star) },
        { ALT: () => op = $.CONSUME(T.Divide) }
      ])
      let right: Node = $.SUBRULE2($.mathValue)

      if (!RECORDING_PHASE) {
        left = new Operation([left, op!.image as Operator, right], undefined, 0, this.context)
      }
    })

    if (!RECORDING_PHASE) {
      left.location = $.endRule()
      return left
    }
  })

  // mathValue
  //   : number
  //   | dimension
  //   | percentage
  //   | mathConstant
  //   | '(' WS* mathSum WS* ')'
  //   ;
  $.RULE('mathValue', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    let token: IToken | undefined
    let node: Node | undefined
    $.OR([
      { ALT: () => token = $.CONSUME(T.Number) },
      { ALT: () => token = $.CONSUME(T.Dimension) },
      { ALT: () => token = $.CONSUME(T.MathConstant) },
      { ALT: () => node = $.SUBRULE($.knownFunctions) },
      {
        ALT: () => {
          $.startRule()
          $.CONSUME(T.LParen)
          node = $.SUBRULE($.mathSum)
          $.CONSUME(T.RParen)
          if (!RECORDING_PHASE) {
            let location = $.endRule()
            node = new Paren(node, undefined, location, this.context)
          }
        }
      }
    ])
    if (!RECORDING_PHASE) {
      if (token) {
        node = $.processValueToken(token)
      }
      return $.wrap(node!, 'both')
    }
  })

  // function
  //   : URL_FUNCTION
  //   | VAR_FUNCTION '(' WS* CUSTOM_IDENT (WS* COMMA WS* valueList)? ')'
  //   | CALC_FUNCTION '(' WS* mathSum WS* ')'
  //   | identifier '(' valueList ')'
  //   ;
  // These have special parsing rules
  $.RULE('knownFunctions', () =>
    $.OR([
      { ALT: () => $.SUBRULE($.urlFunction) },
      { ALT: () => $.SUBRULE($.varFunction) },
      { ALT: () => $.SUBRULE($.calcFunction) }
    ])
  )

  $.RULE('varFunction', () => {
    $.startRule()
    $.CONSUME(T.Var)
    let prop = $.CONSUME(T.CustomProperty)
    let args: List | undefined
    $.OPTION(() => {
      $.CONSUME(T.Comma)
      args = $.SUBRULE($.valueList)
    })
    $.CONSUME(T.RParen)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      let propNode = $.wrap(new Anonymous(prop.image, undefined, $.getLocationInfo(prop), this.context), 'both')
      if (!args) {
        args = new List([propNode], undefined, $.getLocationInfo(prop), this.context)
      } else {
        let { startOffset, startLine, startColumn } = prop
        args.value.unshift(propNode)
        args.location[0] = startOffset
        args.location[1] = startLine!
        args.location[2] = startColumn!
      }
      return new Call([
        ['name', 'var'],
        ['args', args]
      ], undefined, location, this.context)
    }
  })

  $.RULE('calcFunction', () => {
    $.startRule()

    $.CONSUME(T.Calc)
    let args = $.SUBRULE($.mathSum)
    $.CONSUME2(T.RParen)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new Call([
        ['name', 'calc'],
        ['args', new List([args]).inherit(args)]
      ], undefined, location, this.context)
    }
  })

  $.RULE('urlFunction', () => {
    $.startRule()

    let token: IToken | undefined
    let node: Node | undefined

    $.CONSUME(T.UrlStart)
    $.OR([
      { ALT: () => node = $.SUBRULE($.string) },
      { ALT: () => token = $.CONSUME(T.NonQuotedUrl) }
    ])
    $.CONSUME(T.UrlEnd)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      if (token) {
        /** Whitespace should be included in the NonQuotedUrl */
        node = new Anonymous(token.image, undefined, $.getLocationInfo(token), this.context)
      }
      return new Call([
        ['name', 'url'],
        ['args', new List([node!]).inherit(node!)]
      ], undefined, location, this.context)
    }
  })

  /**
      All At-rules according to spec are supposed to end with either
      a semi-colon or a curly-braced block. Some pre-processors
      (like PostCSS) allow the semi-colon to be optional, so we also
      allow it and insert it if it's missing.
    */
  // atRule
  //   : importAtRule
  //   | mediaAtRule
  //   | unknownAtRule
  //   | pageAtRule
  //   | fontFaceAtRule
  //   | supportsAtRule
  //   ;
  $.RULE('atRule', () =>
    $.OR([
      { ALT: () => $.SUBRULE($.importAtRule) },
      { ALT: () => $.SUBRULE($.mediaAtRule) },
      { ALT: () => $.SUBRULE($.pageAtRule) },
      { ALT: () => $.SUBRULE($.fontFaceAtRule) },
      { ALT: () => $.SUBRULE($.supportsAtRule) },
      { ALT: () => $.SUBRULE($.nestedAtRule) },
      { ALT: () => $.SUBRULE($.nonNestedAtRule) },
      { ALT: () => $.SUBRULE($.unknownAtRule) }
    ])
  )

  /**
      Inner rules are mostly the same except they have a declarationList
      instead of a main block within {}
      @todo - Add `@container` `@layer` `@scope`
    */
  // innerAtRule
  //   : innerMediaAtRule
  //   | unknownAtRule
  //   ;
  $.RULE('innerAtRule', () =>
    $.OR([
      { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.unknownAtRule) }
    ])
  )

  /**
   * @see https://www.w3.org/TR/css-nesting-1/#conditionals
   */
  $.RULE('atRuleBody', (inner: boolean = false) =>
    $.OR([
      {
        GATE: () => !inner,
        ALT: () => $.SUBRULE($.main)
      },
      {
        GATE: () => inner,
        ALT: () => $.SUBRULE($.declarationList)
      }
    ])
  )

  // mediaAtRule
  //   : MEDIA_RULE WS* mediaQuery WS* LCURLY main RCURLY
  //   ;
  $.RULE('mediaAtRule', (inner?: boolean) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let name = $.CONSUME(T.AtMedia)
    let queries: Node[]
    let value: Rules
    if (!RECORDING_PHASE) {
      queries = []
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let query = $.SUBRULE($.mediaQuery)
        if (!RECORDING_PHASE) {
          queries.push(query)
        }
      }
    })
    $.CONSUME(T.LCurly)
    value = $.SUBRULE($.atRuleBody, { ARGS: [inner] })
    $.CONSUME(T.RCurly)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      let prelude: Node
      if (queries!.length === 1) {
        prelude = queries![0]!
      } else {
        prelude = new List(queries!)
      }
      return new AtRule([
        ['name', $.wrap(new Anonymous(name.image, undefined, $.getLocationInfo(name), this.context), true)],
        ['prelude', prelude],
        ['rules', value]
      ], undefined, location, this.context)
    }
  })

  /**
   * @see https://w3c.github.io/csswg-drafts/mediaqueries/#mq-syntax
   * Note, some of the spec had to be re-written for less ambiguity.
   * However, this is a spec-compliant implementation.
   */
  // mediaQuery
  //   : mediaCondition
  //   | ((NOT | ONLY) WS*)? mediaType (WS* AND WS* mediaConditionWithoutOr)?
  //   ;
  $.RULE('mediaQuery', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    return $.OR([
      { ALT: () => $.SUBRULE($.mediaCondition) },
      {
        ALT: () => {
          $.startRule()

          let token: IToken | undefined
          let node: Node | undefined
          let nodes: Node[]

          if (!RECORDING_PHASE) {
            nodes = []
          }

          $.OPTION(() => {
            $.OR2([
              { ALT: () => token = $.CONSUME(T.Not) },
              { ALT: () => token = $.CONSUME(T.Only) }
            ])
          })

          if (token && !RECORDING_PHASE) {
            token = undefined
          }
          let type = $.SUBRULE($.mediaType)

          if (!RECORDING_PHASE) {
            nodes!.push(type)
          }

          $.OPTION2(() => {
            token = $.CONSUME(T.And)
            node = $.SUBRULE($.mediaConditionWithoutOr)
          })
          if (!RECORDING_PHASE) {
            if (token) {
              nodes!.push($.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), this.context)))
            }
            if (node) {
              nodes!.push(node)
            }
          }
          if (!RECORDING_PHASE) {
            let location = $.endRule()
            return new QueryCondition(nodes!, undefined, location, this.context)
          }
        }
      }
    ])
  })

  /** Doesn't include only, not, and, or, layer */
  // mediaType
  //   : IDENT
  //   | SCREEN
  //   | PRINT
  //   | ALL
  //   ;
  $.RULE('mediaType', () => {
    let token = $.OR([
      { ALT: () => $.CONSUME(T.PlainIdent) },
      { ALT: () => $.CONSUME(T.Screen) },
      { ALT: () => $.CONSUME(T.Print) },
      { ALT: () => $.CONSUME(T.All) }
    ])
    if (!$.RECORDING_PHASE) {
      return $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), this.context))
    }
  })

  // mediaCondition
  //   : mediaNot | mediaInParens ( WS* (mediaAnd* | mediaOr* ))
  //   ;
  $.RULE('mediaCondition', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    return $.OR([
      { ALT: () => $.SUBRULE($.mediaNot) },
      {
        ALT: () => {
          let nodes: Node[]
          if (!RECORDING_PHASE) {
            nodes = []
          }
          let node = $.SUBRULE($.mediaInParens)
          if (!RECORDING_PHASE) {
            nodes!.push(node)
          }
          $.MANY(() => {
            let rule =
              $.OR2([
                { ALT: () => $.SUBRULE($.mediaAnd) },
                { ALT: () => $.SUBRULE($.mediaOr) }
              ])
            if (!RECORDING_PHASE) {
              nodes!.push(...rule)
            }
          })
          if (!RECORDING_PHASE) {
            return nodes!
          }
        }
      }
    ])
  })

  // mediaConditionWithoutOr
  //   : mediaNot | mediaInParens (WS* mediaAnd)*
  //   ;
  $.RULE('mediaConditionWithoutOr', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    return $.OR([
      { ALT: () => $.SUBRULE($.mediaNot) },
      {
        ALT: () => {
          let nodes: Node[]
          if (!RECORDING_PHASE) {
            nodes = []
          }
          let node = $.SUBRULE($.mediaInParens)
          if (!RECORDING_PHASE) {
            nodes!.push(node)
          }
          $.MANY(() => {
            let rule = $.SUBRULE($.mediaAnd)
            if (!RECORDING_PHASE) {
              nodes!.push(...rule)
            }
          })

          if (!RECORDING_PHASE) {
            return nodes!
          }
        }
      }
    ])
  })

  // mediaNot
  //   : NOT WS* mediaInParens
  //   ;
  $.RULE('mediaNot', () => {
    let token = $.CONSUME(T.Not)
    let node = $.SUBRULE($.mediaInParens)

    if (!$.RECORDING_PHASE) {
      return [
        $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), this.context)),
        node
      ]
    }
  })

  // mediaAnd
  //   : AND WS* mediaInParens
  //   ;
  $.RULE('mediaAnd', () => {
    let token = $.CONSUME(T.And)
    let node = $.SUBRULE($.mediaInParens)

    if (!$.RECORDING_PHASE) {
      return [
        $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), this.context)),
        node
      ]
    }
  })

  // mediaOr
  //   : OR WS* mediaInParens
  //   ;
  $.RULE('mediaOr', () => {
    let token = $.CONSUME(T.Or)
    let node = $.SUBRULE($.mediaInParens)

    if (!$.RECORDING_PHASE) {
      return [
        $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), this.context)),
        node
      ]
    }
  })

  // mediaInParens
  //   : '(' WS* (mediaCondition | mediaFeature) WS* ')'
  //   | generalEnclosed
  //   ;
  $.RULE('mediaInParens', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    $.CONSUME(T.LParen)

    let node = $.OR([
      { ALT: () => $.SUBRULE($.mediaCondition) },
      { ALT: () => $.SUBRULE($.mediaFeature) },
      // in the CSS @media spec, is defined as "generalEnclosed"
      {
        ALT: () => {
          $.startRule()
          let values: Node[]
          if (!RECORDING_PHASE) {
            values = []
          }

          $.AT_LEAST_ONE(() => {
            let val = $.SUBRULE($.anyInnerValue)
            if (!RECORDING_PHASE) {
              values.push(val)
            }
          })

          if (!RECORDING_PHASE) {
            let location = $.endRule()
            return new Sequence(values!, undefined, location, this.context)
          }
        }
      }
    ])
    $.CONSUME(T.RParen)

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      return $.wrap(new Paren($.wrap(node, 'both'), undefined, location, this.context))
    }
  })

  /**
      An identifier is a legal value, so it can be
      ambiguous which side of the expression we're on
      while parsing. The browser figures this out
      post-parsing.
    */
  // mediaFeature
  // : identifier (WS* (
  //   COLON WS* mfValue
  //   | mediaRange
  //   | mfComparison WS* mfNonIdentifierValue
  // ))?
  // | mfNonIdentifierValue WS* (
  //   mfComparison WS* identifier
  //   | mediaRange
  // )
  // ;
  $.RULE('mediaFeature', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    return $.OR([
      {
        ALT: () => {
          let rule: Node | undefined
          let ident = $.CONSUME(T.Ident)
          $.OPTION(() => {
            rule = $.OR2([
              {
                ALT: () => {
                  $.CONSUME(T.Colon)
                  let value = $.SUBRULE($.mfValue)
                  if (!RECORDING_PHASE) {
                    let location = $.endRule()
                    return $.wrap(
                      new Declaration([
                        ['name', ident.image],
                        ['value', value]
                      ], undefined, location, this.context)
                      , 'both')
                  }
                }
              },
              {
                ALT: () => {
                  let seq = $.SUBRULE($.mediaRange)
                  if (!RECORDING_PHASE) {
                    let [startOffset, startLine, startColumn] = $.endRule()
                    seq.value.unshift($.wrap(new Anonymous(ident.image, undefined, $.getLocationInfo(ident), this.context)))
                    seq.location[0] = startOffset
                    seq.location[1] = startLine
                    seq.location[2] = startColumn
                  }
                  return seq
                }
              },
              {
                ALT: () => {
                  let token = $.SUBRULE($.mfComparison)
                  let value = $.SUBRULE($.mfNonIdentifierValue)

                  if (!RECORDING_PHASE) {
                    let location = $.endRule()
                    return new Sequence([
                      $.wrap(new Anonymous(ident.image, undefined, $.getLocationInfo(ident), this.context)),
                      $.wrap(new Anonymous(token.image, undefined, $.getLocationInfo(token), this.context)),
                      value
                    ], undefined, location, this.context)
                  }
                }
              }
            ])
          })
          if (!rule) {
            return $.wrap(new Keyword(ident.image, undefined, $.getLocationInfo(ident), this.context))
          }
          return rule
        }
      },
      {
        ALT: () => {
          let rule1 = $.SUBRULE2($.mfNonIdentifierValue)
          return $.OR3([
            {
              ALT: () => {
                let op = $.SUBRULE2($.mfComparison)
                let value = $.CONSUME2(T.Ident)
                if (!RECORDING_PHASE) {
                  let location = $.endRule()
                  return new Sequence([
                    rule1,
                    $.wrap(new Anonymous(op.image, undefined, $.getLocationInfo(op), this.context)),
                    $.wrap(new Anonymous(value.image, undefined, $.getLocationInfo(value), this.context))
                  ], undefined, location, this.context)
                }
              }
            },
            {
              ALT: () => {
                let seq = $.SUBRULE2($.mediaRange)
                if (!RECORDING_PHASE) {
                  let [startOffset, startLine, startColumn] = $.endRule()
                  seq.value.unshift(rule1)
                  seq.location[0] = startOffset
                  seq.location[1] = startLine
                  seq.location[2] = startColumn
                }
              }
            }
          ])
        }
      }
    ])
  })

  /**
   * @note Both comparison operators have to match.
   */
  // mediaRange
  //   : mfLt WS* identifier (WS* mfLt WS* mfValue)?
  //   | mfGt WS* identifier (WS* mfGt WS* mfValue)?
  //   ;
  $.RULE('mediaRange', () => {
    $.startRule()

    let op1: IToken
    let val1: IToken
    let op2: IToken | undefined
    let val2: IToken | undefined

    $.OR([
      {
        ALT: () => {
          op1 = $.CONSUME(T.MfLt)
          val1 = $.CONSUME(T.Ident)
          $.OPTION(() => {
            op2 = $.CONSUME2(T.MfLt)
            val2 = $.SUBRULE($.mfValue)
          })
        }
      },
      {
        ALT: () => {
          op1 = $.CONSUME(T.MfGt)
          val1 = $.CONSUME2(T.Ident)
          $.OPTION2(() => {
            op2 = $.CONSUME2(T.MfGt)
            val2 = $.SUBRULE2($.mfValue)
          })
        }
      }
    ])

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      let nodes: Node[] = [
        $.wrap(new Anonymous(op1!.image, undefined, $.getLocationInfo(op1!), this.context)),
        $.wrap(new Anonymous(val1!.image, undefined, $.getLocationInfo(val1!), this.context))
      ]
      if (op2) {
        nodes.push($.wrap(new Anonymous(op2.image, undefined, $.getLocationInfo(op2), this.context)))
        nodes.push($.wrap($.processValueToken(val2!), 'both'))
      }
      return new Sequence(nodes, undefined, location, this.context)
    }
  })

  // mfNonIdentifierValue
  //   : number (WS* '/' WS* number)?
  //   | dimension
  //   ;
  $.RULE('mfNonIdentifierValue', () =>
    $.OR([
      {
        ALT: () => {
          $.startRule()
          let num1 = $.CONSUME(T.Number)
          let num2: IToken | undefined
          $.OPTION(() => {
            $.CONSUME(T.Slash)
            num2 = $.CONSUME2(T.Number)
          })
          if (!$.RECORDING_PHASE) {
            let location = $.endRule()
            let num1Node = $.wrap($.processValueToken(num1), 'both')
            if (!num2) {
              return num1Node
            }
            let num2Node = $.wrap($.processValueToken(num2), 'both')
            return new List([num1Node, num2Node], { sep: '/' }, location, this.context)
          }
        }
      },
      {
        ALT: () => {
          let dim = $.CONSUME(T.Dimension)
          if (!$.RECORDING_PHASE) {
            return $.wrap($.processValueToken(dim), 'both')
          }
        }
      }
    ])
  )

  // mfValue
  //   : mfNonIdentifierValue | identifier
  //   ;
  $.RULE('mfValue', () =>
    $.OR([
      { ALT: () => $.SUBRULE($.mfNonIdentifierValue) },
      { ALT: () => $.CONSUME(T.Ident) }
    ])
  )

  // mfComparison
  //   : mfLt | mfGt | mfEq
  //   ;
  $.RULE('mfComparison', () =>
    $.OR([
      { ALT: () => $.CONSUME(T.MfLt) },
      { ALT: () => $.CONSUME(T.MfGt) },
      { ALT: () => $.CONSUME(T.Eq) }
    ])
  )

  /**
   * @see https://www.w3.org/TR/css-page-3/
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
   */
  $.RULE('pageAtRule', () => {
    $.startRule()

    let name = $.CONSUME(T.AtPage)
    let selector: Node[] = []
    $.MANY_SEP({
      SEP: T.Comma,
      DEF: () => selector.push($.SUBRULE($.pageSelector))
    })
    $.CONSUME(T.LCurly)
    let rules = $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new AtRule([
        ['name', $.wrap(new Anonymous(name.image, undefined, $.getLocationInfo(name), this.context), true)],
        ['prelude', $.wrap(new List(selector), 'both')],
        ['rules', rules]
      ], undefined, location, this.context)
    }
  })

  $.RULE('pageSelector', () => {
    $.startRule()
    let token = ''

    $.OPTION(() => token += $.CONSUME(T.Ident).image)
    $.MANY({
      GATE: () => $.LA(1).tokenType === T.Colon && $.noSep(1),
      DEF: () => {
        token += $.CONSUME(T.Colon).image
        token += $.CONSUME(T.PagePseudoClassKeywords).image
      }
    })

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return $.wrap(new BasicSelector(token, undefined, location, this.context))
    }
  })

  // fontFaceAtRule
  //   : FONT_FACE_RULE WS* LCURLY declarationList RCURLY
  //   ;
  $.RULE('fontFaceAtRule', () => {
    $.startRule()

    let name = $.CONSUME(T.AtFontFace)
    $.CONSUME(T.LCurly)
    let rules = $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new AtRule([
        ['name', $.wrap(new Anonymous(name.image, undefined, $.getLocationInfo(name), this.context), true)],
        ['rules', rules]
      ], undefined, location, this.context)
    }
  })

  /**
     * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@supports
     */
  // supportsAtRule
  //   : SUPPORTS_RULE WS* supportsCondition WS* LCURLY main RCURLY
  //   ;
  $.RULE('supportsAtRule', (inner?: boolean) => {
    $.startRule()

    let name = $.CONSUME(T.AtSupports)
    let prelude = $.SUBRULE($.supportsCondition)
    $.CONSUME(T.LCurly)
    let rules = $.SUBRULE($.atRuleBody, { ARGS: [inner] })
    $.CONSUME(T.RCurly)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new AtRule([
        ['name', $.wrap(new Anonymous(name.image, undefined, $.getLocationInfo(name), this.context), true)],
        ['prelude', $.wrap(prelude, 'both')],
        ['rules', rules]
      ], undefined, location, this.context)
    }
  })

  /** spec-compliant but simplified */
  // supportsCondition
  //   : NOT supportsInParens
  //   | supportsInParens (WS* AND supportsInParens)*
  //   | supportsInParens (WS* OR supportsInParens)*
  //   ;
  $.RULE('supportsCondition', () => {
    let start = $.startRule()

    return $.OR([
      {
        ALT: () => {
          let keyword = $.CONSUME(T.Not)
          let value = $.SUBRULE($.supportsInParens)

          if (!$.RECORDING_PHASE) {
            let location = $.endRule()
            return new QueryCondition([
              $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context)),
              value
            ], undefined, location, this.context)
          }
        }
      },
      {
        ALT: () => {
          let RECORDING_PHASE = $.RECORDING_PHASE
          let [startOffset, startLine, startColumn] = start ?? []

          let left = $.SUBRULE2($.supportsInParens)

          $.MANY(() => {
            let keyword = $.CONSUME(T.And)
            let right: Node = $.SUBRULE3($.supportsInParens)
            if (!RECORDING_PHASE) {
              let [,,,endOffset, endLine, endColumn] = right.location
              left = new QueryCondition([
                left,
                $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context)),
                right
              ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context)
            }
          })

          return left
        }
      },
      {
        ALT: () => {
          let RECORDING_PHASE = $.RECORDING_PHASE
          let [startOffset, startLine, startColumn] = start ?? []

          let left = $.SUBRULE4($.supportsInParens)

          $.MANY2(() => {
            let keyword = $.CONSUME(T.Or)
            let right: Node = $.SUBRULE5($.supportsInParens)
            if (!RECORDING_PHASE) {
              let [,,,endOffset, endLine, endColumn] = right.location
              left = new QueryCondition([
                left,
                $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context)),
                right
              ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context)
            }
          })

          return left
        }
      }
    ])
  })

  // supportsInParens
  // : '(' WS* supportsCondition WS* ')'
  // | '(' WS* declaration WS* ')'
  // | generalEnclosed
  // ;
  $.RULE('supportsInParens', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    return $.OR([
      {
        ALT: () => {
          /** Function-like call */
          let name = $.CONSUME(T.Ident)
          let args: List | undefined
          $.OR2([
            {
              GATE: $.noSep,
              ALT: () => {
                $.CONSUME(T.LParen)
                args = $.SUBRULE($.valueList)
                $.CONSUME(T.RParen)
              }
            }
          ])

          if (!RECORDING_PHASE) {
            let location = $.endRule()
            return new Call([
              ['name', name.image],
              ['args', args]
            ], undefined, location, this.context)
          }
        }
      },
      {
        ALT: () => {
          let values: Node[] = []
          $.CONSUME2(T.LParen)
          let value = $.OR3([
            { ALT: () => $.SUBRULE($.supportsCondition) },
            { ALT: () => $.SUBRULE($.declaration) },
            // in the CSS @supports spec, is defined as "generalEnclosed"
            { ALT: () => $.MANY(() => values.push($.SUBRULE($.anyInnerValue))) }
          ])
          $.CONSUME2(T.RParen)

          if (!RECORDING_PHASE) {
            let location = $.endRule()
            if (!(value instanceof Node)) {
              value = new Sequence(values, undefined, $.getLocationFromNodes(values), this.context)
            }
            return $.wrap(new Paren($.wrap(value, 'both'), undefined, location, this.context))
          }
        }
      }
    ])
  })

  $.RULE('function', () =>
    $.OR([
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
              $.OPTION(() => args = $.SUBRULE($.functionArgs))
              $.CONSUME(T.RParen)
            }
          }])

          if (!$.RECORDING_PHASE) {
            let location = $.endRule()
            return new Call([
              ['name', name.image],
              ['args', args]
            ], undefined, location, this.context)
          }
        }
      }
    ])
  )

  /**
   * Originally, function arguments always had commas,
   * but it looks like that might be expanded in the
   * future in CSS to allow for semi-colon separators.
   * with the same rationale of why this was introduced
   * by Less (that values can already have commas).
   *
   * @see https://drafts.csswg.org/css-values-4/#interpolate
   *
   * @todo - if a function is introduced where semi-colons
   * are separators AND only 1 argument is required, then
   * that will have to be specially handled.
   */
  $.RULE('functionArgs', (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let commaNodes: Node[] = [$.SUBRULE($.valueSequence, { ARGS: [ctx] })]
    let semiNodes: Node[] = []
    let isSemiList = false

    $.MANY(() => {
      $.OR([
        {
          GATE: () => !isSemiList,
          ALT: () => {
            $.CONSUME(T.Comma)
            commaNodes.push($.SUBRULE2($.valueSequence, { ARGS: [ctx] }))
          }
        },
        {
          ALT: () => {
            isSemiList = true

            $.CONSUME(T.Semi)

            if (!RECORDING_PHASE) {
              /** Aggregate the previous set of comma-nodes */
              if (commaNodes.length > 1) {
                let commaList = $.wrap(new List(commaNodes, { sep: ',' }, $.getLocationFromNodes(commaNodes), this.context), 'both')
                semiNodes.push(commaList)
              } else {
                semiNodes.push(commaNodes[0]!)
              }
            }
            semiNodes.push($.SUBRULE3($.valueList, { ARGS: [ctx] }))
          }
        }
      ])
    })

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      let nodes = isSemiList ? semiNodes : commaNodes
      let sep: ';' | ',' = isSemiList ? ';' : ','
      return $.wrap(new List(nodes, { sep }, location, this.context), 'both')
    }
  })

  // https://www.w3.org/TR/css-cascade-4/#at-import
  // importAtRule
  //   : IMPORT_RULE WS* (URL_FUNCTION | STRING) (WS* SUPPORTS_FUNCTION WS* (supportsCondition | declaration))? (WS* mediaQuery)? SEMI
  //   ;
  $.RULE('importAtRule', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()
    let name = $.CONSUME(T.AtImport)
    let preludeNodes: Node[] = []
    preludeNodes.push(
      $.wrap(
        $.OR([
          { ALT: () => $.SUBRULE($.urlFunction) },
          { ALT: () => $.SUBRULE($.string) }
        ])
      )
    )
    $.OPTION(() => {
      let start = $.CONSUME(T.Supports)
      let value = $.OR2([
        { ALT: () => $.SUBRULE($.supportsCondition) },
        { ALT: () => $.SUBRULE($.declaration) }
      ])
      let end = $.CONSUME(T.RParen)

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
    $.OPTION2(() => {
      preludeNodes.push($.SUBRULE($.mediaQuery))
    })
    $.CONSUME(T.Semi)

    if (!RECORDING_PHASE) {
      let location = $.endRule()
      return new AtRule([
        ['name', $.wrap(new Anonymous(name.image, undefined, $.getLocationInfo(name), this.context), true)],
        ['prelude', new Sequence(preludeNodes)]
      ], undefined, location, this.context)
    }
  })

  /**
   * @todo - add more structure for known nested at-rules.
   */
  $.RULE('nestedAtRule', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let name = $.CONSUME(T.AtNested)
    let preludeNodes: Node[]
    let ruleNodes: Node[]

    if (!RECORDING_PHASE) {
      preludeNodes = []
      ruleNodes = []
    }

    $.MANY(() => {
      let value = $.SUBRULE($.anyOuterValue)
      if (!RECORDING_PHASE) {
        preludeNodes.push($.wrap(value))
      }
    })
    $.CONSUME(T.LCurly)
    /** @todo - add more structure for known rule bodies */
    $.MANY2(() => {
      let value = $.SUBRULE($.anyInnerValue)
      if (!RECORDING_PHASE) {
        ruleNodes.push($.wrap(value))
      }
    })
    $.CONSUME(T.RCurly)

    if (!$.RECORDING_PHASE) {
      return new AtRule([
        ['name', $.wrap(new Anonymous(name.image, undefined, $.getLocationInfo(name), this.context), true)],
        ['prelude', $.wrap(new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context), 'both')],
        ['rules', $.wrap(new Rules(ruleNodes!, undefined, $.getLocationFromNodes(ruleNodes!), this.context), 'both')]
      ], undefined, $.endRule(), this.context)
    }
  })

  $.RULE('nonNestedAtRule', () => {
    $.startRule()
    let preludeNodes: Node[] = []

    let name = $.CONSUME(T.AtNonNested)
    $.MANY(() => preludeNodes.push($.wrap($.SUBRULE($.anyOuterValue))))
    $.CONSUME(T.Semi)

    if (!$.RECORDING_PHASE) {
      return new AtRule([
        ['name', $.wrap(new Anonymous(name.image, undefined, $.getLocationInfo(name), this.context), true)],
        ['prelude', $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context))]
      ], undefined, $.endRule(), this.context)
    }
  })

  // unknownAtRule
  //   : AT_RULE anyOuterValue* (SEMI | LCURLY anyInnerValue* RCURLY)
  //   ;
  $.RULE('unknownAtRule', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    $.startRule()

    let preludeNodes: Node[]
    let ruleNodes: Node[]

    if (!RECORDING_PHASE) {
      preludeNodes = []
      ruleNodes = []
    }

    let name = $.CONSUME(T.AtKeyword)
    $.MANY(() => {
      let val = $.SUBRULE($.anyOuterValue)
      if (!RECORDING_PHASE) {
        preludeNodes.push($.wrap(val, 'both'))
      }
    })
    $.OR([
      { ALT: () => $.CONSUME(T.Semi) },
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.MANY2(() => {
            let rule = $.SUBRULE($.anyInnerValue)
            if (!RECORDING_PHASE) {
              ruleNodes.push($.wrap(rule, 'both'))
            }
          })
          $.CONSUME(T.RCurly)
        }
      }
    ])

    if (!$.RECORDING_PHASE) {
      return new AtRule([
        ['name', $.wrap(new Anonymous(name.image, undefined, $.getLocationInfo(name), this.context), true)],
        ['prelude', preludeNodes!.length ? new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context) : undefined],
        ['rules', ruleNodes!.length ? new Rules(ruleNodes!, undefined, $.getLocationFromNodes(ruleNodes!), this.context) : undefined]
      ], undefined, $.endRule(), this.context)
    }
  })
  /**
    @todo - add all tokens
    @see - https://stackoverflow.com/questions/55594491/antlr-4-parser-match-any-token

    From - https://w3c.github.io/csswg-drafts/css-syntax-3/#typedef-any-value
    The <any-value> production is identical to <declaration-value>, but also allows
    top-level <semicolon-token> tokens and <delim-token> tokens with a value of "!".
    It represents the entirety of what valid CSS can be in any context.

    Parts of the spec that allow any value should not display a warning or error
    for any unknown token.
  */
  // anyOuterValue
  //   : value
  //   | COMMA
  //   | '(' anyInnerValue* ')'
  //   | '[' anyInnerValue* ']'
  //   ;
  $.RULE('anyOuterValue', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    return $.OR([
      { ALT: () => $.SUBRULE($.extraTokens) },
      { ALT: () => $.SUBRULE($.string) },
      {
        ALT: () => {
          $.startRule()
          let nodes: Node[]
          if (!RECORDING_PHASE) {
            nodes = []
          }
          $.CONSUME(T.LParen)
          $.MANY(() => {
            let val = $.SUBRULE($.anyInnerValue)
            if (!RECORDING_PHASE) {
              nodes.push($.wrap(val))
            }
          })
          $.CONSUME(T.RParen)

          if (!RECORDING_PHASE) {
            let location = $.endRule()
            return new Paren(
              [
                ['value', nodes!.length ? new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context) : undefined]
              ],
              undefined,
              location,
              this.context
            )
          }
        }
      },
      {
        ALT: () => {
          $.startRule()
          let nodes: Node[] = []

          $.CONSUME(T.LSquare)
          $.MANY2(() => nodes.push($.wrap($.SUBRULE2($.anyInnerValue))))
          $.CONSUME(T.RSquare)

          if (!RECORDING_PHASE) {
            let location = $.endRule()
            return new Paren(
              $.wrap(new Sequence(nodes, undefined, $.getLocationFromNodes(nodes), this.context), true),
              undefined,
              location,
              this.context
            )
          }
        }
      }
    ])
  })

  /**
     * Same as allowable outer values, but allows
     * semi-colons and curly blocks.
     */
  // anyInnerValue
  //   : anyOuterValue
  //   | '{' anyInnerValue* '}'
  //   | ID
  //   | SEMI
  //   | pseudoSelector
  //   ;
  $.RULE('anyInnerValue', () => {
    let RECORDING_PHASE = $.RECORDING_PHASE
    return $.OR([
      { ALT: () => $.SUBRULE($.anyOuterValue) },
      {
        ALT: () => {
          let start = $.CONSUME(T.LCurly)
          let nodes: Node[] = []
          $.MANY(() => nodes.push($.SUBRULE2($.anyInnerValue)))
          let end = $.CONSUME(T.RCurly)

          if (!RECORDING_PHASE) {
            let { startOffset, startLine, startColumn } = start
            let { endOffset, endLine, endColumn } = end
            nodes.unshift(
              $.wrap(new Anonymous(start.image, undefined, $.getLocationInfo(start), this.context))
            )
            nodes.push(
              $.wrap(new Anonymous(end.image, undefined, $.getLocationInfo(end), this.context))
            )
            return new Sequence(
              nodes,
              undefined,
              [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!],
              this.context
            )
          }
        }
      },
      {
        ALT: () => {
          let semi = $.CONSUME(T.Semi)

          if (!RECORDING_PHASE) {
            return $.wrap(new Anonymous(semi.image, undefined, $.getLocationInfo(semi), this.context))
          }
        }
      }
    ])
  })
}