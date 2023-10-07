/* eslint-disable no-return-assign */
import type { CssActionsParser, TokenMap, RuleContext } from './cssActionsParser'
import { EMPTY_ALT, type IToken } from 'chevrotain'
import {
  type Node,
  type LocationInfo,
  type TreeContext,
  type AssignmentType,
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
  Dimension,
  Color,
  Comment,
  Func,
  Call,
  Paren,
  Operation,
  Quoted,
  PseudoSelector,
  AttributeSelector
} from '@jesscss/core'

export function productions(this: CssActionsParser, T: TokenMap) {
  const $ = this

  // stylesheet
  //   : CHARSET? main EOF
  //   ;
  $.RULE('stylesheet', () => {
    $.startRule()

    let charset: IToken | undefined
    $.OPTION(() => {
      charset = $.CONSUME(T.Charset)
    })
    let root = $.SUBRULE($.main)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      root ??= new Root([], undefined, location, this.context)
      if (charset) {
        root.value.unshift(new Anonymous(charset.image, undefined, $.getLocationInfo(charset), this.context))
      }
      this.context.scope = this.initialScope
      return root
    }
  })

  // main
  //   : (WS
  //     | qualifiedRule
  //     | atRule
  //   )*
  //   ;
  $.RULE('main', () => {
    $.startRule()

    let rules: Node[] = []
    $.MANY(() => {
      $.OR([
        { ALT: () => rules.push($.SUBRULE($.qualifiedRule)) },
        { ALT: () => rules.push($.SUBRULE($.atRule)) }
      ])
    })

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      let finalRules = $.getRulesWithComments(rules)
      return new Root(finalRules, undefined, location, this.context)
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
        ['value', rules]
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
        /** In CSS Nesting, the first selector cannot be an identifier */
        GATE: () => !ctx.firstSelector,
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
    $.startRule()

    const createPseudo = (name: string, value?: Node) => {
      if (!$.RECORDING_PHASE) {
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
                let values: Node[] | undefined
                let valuesLocation: LocationInfo
                $.OPTION2(() => {
                  if (!$.RECORDING_PHASE) {
                    values = []
                  }
                  $.CONSUME(T.LParen)
                  $.startRule()
                  $.MANY(() => values!.push($.SUBRULE($.anyInnerValue)))
                  if (!$.RECORDING_PHASE) {
                    valuesLocation = $.endRule()
                  }
                  $.CONSUME3(T.RParen)
                })
                if (values && !$.RECORDING_PHASE) {
                  return new Sequence(values, undefined, valuesLocation!, this.context)
                }
                return values
              }
            }
          ])
          return createPseudo(name, values as Sequence)
        }
      }
    ])
  })

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/:nth-child
   */
  $.RULE('nthValue', () => {
    $.startRule()
    let startTokenOffset: number | undefined
    if (!$.RECORDING_PHASE) {
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

    if ($.RECORDING_PHASE) {
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
    $.startRule()

    $.CONSUME(T.LSquare)
    let key = $.CONSUME(T.Ident)
    let op: IToken | undefined
    let value: IToken | undefined
    $.OPTION(() => {
      op = $.OR([
        { ALT: () => $.CONSUME(T.Eq) },
        { ALT: () => $.CONSUME(T.AttrMatch) }
      ])
      value = $.OR2([
        { ALT: () => $.CONSUME2(T.Ident) },
        { ALT: () => $.SUBRULE($.string) }
      ])
    })
    let mod = $.OPTION2(() => $.CONSUME(T.AttrFlag))
    $.CONSUME(T.RSquare)

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new AttributeSelector([
        ['key', key],
        ['op', op],
        ['value', value],
        ['mod', mod]
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
    $.MANY(() => selectors.push($.SUBRULE2($.simpleSelector, { ARGS: [{ ...ctx, firstSelector: false }] })))
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
    $.startRule()
    let selectors: Node[] = $.SUBRULE($.compoundSelector, { ARGS: [ctx] })
    $.MANY(() => {
      selectors.push($.SUBRULE($.combinator))
      selectors.push(...$.SUBRULE2($.compoundSelector, { ARGS: [{ ...ctx, firstSelector: false }] }))
    })

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new SelectorSequence(selectors as Array<SimpleSelector | Combinator>, undefined, location, this.context)
    }
  })

  /** We must have a combinator of some kind between compound selectors */
  $.RULE('combinator', () => {
    let co = $.OR([
      {
        ALT: () => $.CONSUME(T.Combinator)
      },
      /**
         * It's not truly empty - we check skipped tokens,
         * so this indicates at least 1 whitespace is present
         */
      {
        GATE: $.hasWS,
        ALT: EMPTY_ALT()
      }
    ])
    if (!$.RECORDING_PHASE) {
      if (co) {
        return $.wrap(new Combinator(co.image, undefined, $.getLocationInfo(co), this.context), 'both')
      }
      let startOffset = this.LA(1).startOffset
      let combinator = new Combinator('', undefined, 0, this.context)
      combinator.pre = $.getPrePost(startOffset)
      return combinator
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
    $.startRule()

    let sequences: SelectorSequence[] = $.SUBRULE($.relativeSelector, { ARGS: [ctx] })

    $.MANY(() => {
      $.CONSUME(T.Comma)
      sequences.push($.SUBRULE2($.relativeSelector, { ARGS: [{ ...ctx, firstSelector: false }] }))
    })

    if (sequences.length === 1) {
      return sequences[0]
    }

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new SelectorList(sequences, undefined, location, this.context)
    }
  })

  // selectorList
  //   : complexSelector (WS* COMMA WS* complexSelector)*
  //   ;
  $.RULE('selectorList', (ctx: RuleContext = {}) => {
    $.startRule()
    let sequences: SelectorSequence[] = []

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => sequences.push($.SUBRULE($.complexSelector, { ARGS: [ctx] }))
    })

    if (sequences.length === 1) {
      return sequences[0]
    }

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new SelectorList(sequences, undefined, location, this.context)
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
    $.startRule()

    let context = this.context
    let initialScope = context.scope
    context.scope = new Scope(initialScope)
    let rules: Node[] = []
    let needsSemi = false
    $.MANY({
      GATE: () => !needsSemi || (needsSemi && $.LA(1).tokenType === T.Semi),
      DEF: () => {
        $.OR([
          {
            ALT: () => {
              rules.push($.SUBRULE($.declaration))
              needsSemi = true
            }
          },
          {
            ALT: () => {
              $.OR2([
                { ALT: () => rules.push($.SUBRULE($.innerAtRule)) },
                { ALT: () => rules.push($.SUBRULE2($.qualifiedRule, { ARGS: [{ inner: true }] })) },
                { ALT: () => $.CONSUME(T.Semi) }
              ])
              needsSemi = false
            }
          }
        ])
      }
    })

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      let finalRules = $.getRulesWithComments(rules)
      let returnRules = new Rules(finalRules, undefined, location, this.context)
      context.scope = initialScope
      return returnRules
    }
  })

  // declaration
  //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
  //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
  //   ;
  $.RULE('declaration', () => {
    $.startRule()
    let name: string | Node | undefined
    let assign: AssignmentType | undefined
    let value: Node | undefined
    let important: IToken | undefined
    $.OR([
      {
        ALT: () => {
          $.OR2([
            {
              ALT: () => name = $.CONSUME(T.Ident).image
            },
            {
              GATE: () => $.legacyMode,
              ALT: () => name = $.CONSUME(T.LegacyPropIdent).image
            }
          ])
          assign = $.CONSUME(T.Assign).image as AssignmentType
          value = $.SUBRULE($.valueList)
          $.OPTION(() => {
            important = $.CONSUME(T.Important)
          })
        }
      },
      {
        ALT: () => {
          name = $.CONSUME(T.CustomProperty).image
          assign = $.CONSUME2(T.Assign).image as AssignmentType
          let nodes: Node[] = []
          $.startRule()
          /** @todo - should collect ALL tokens in a stream, including whitespace */
          $.MANY(() => nodes.push($.SUBRULE($.customValue)))
          if (!$.RECORDING_PHASE) {
            let location = $.endRule()
            value = new Sequence(nodes, undefined, location, this.context)
          }
        }
      }
    ])

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      return new Declaration([
        ['name', name],
        ['value', value],
        ['important', important]
      ], { assign }, location, this.context)
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
        node = $.wrap(new Anonymous(token.image, undefined, $.getLocationInfo(token), this.context))
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
    $.startRule()
    let nodes: Node[] = []

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => nodes.push($.SUBRULE($.valueSequence, { ARGS: [ctx] }))
    })

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      if (nodes.length === 1) {
        return nodes[0]
      }
      return new List(nodes, undefined, location, this.context)
    }
  })

  /** Often space-separated */
  $.RULE('valueSequence', (ctx: RuleContext = {}) => {
    $.startRule()
    let nodes: Node[] = []

    $.AT_LEAST_ONE(() => nodes.push($.SUBRULE($.value, { ARGS: [ctx] })))

    if (!$.RECORDING_PHASE) {
      let location = $.endRule()
      if (nodes.length === 1) {
        return nodes[0]
      }
      return new Sequence(nodes, undefined, location, this.context)
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
        node = $.wrap($.processValueToken(token))
      }
      if (additionalValue) {
        return new List([node!, additionalValue], { slash: true }, location, this.context)
      }
      return node
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
      let value = contents!.image
      return new Quoted(new Anonymous(value), { quote: quote!.image as '"' | "'" }, location, this.context)
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
    $.startRule()

    let op: IToken | undefined
    let left: Node = $.SUBRULE($.mathProduct)

    $.MANY(() => {
      $.OR([
        { ALT: () => op = $.CONSUME(T.Plus) },
        { ALT: () => op = $.CONSUME(T.Minus) }
      ])
      let right: Node = $.SUBRULE2($.mathProduct)

      if (!$.RECORDING_PHASE) {
        left = new Operation([left, op!.image, right])
      }
    })
    if (!$.RECORDING_PHASE) {
      left.location = $.endRule()
      return left
    }
  })

  // mathProduct
  //   : mathValue (WS* ('*' | '/') WS* mathValue)*
  //   ;
  $.RULE('mathProduct', () => {
    $.startRule()

    let op: IToken | undefined
    let left: Node = $.SUBRULE($.mathValue)

    $.MANY(() => {
      $.OR([
        { ALT: () => op = $.CONSUME(T.Star) },
        { ALT: () => op = $.CONSUME(T.Divide) }
      ])
      let right: Node = $.SUBRULE2($.mathValue)

      if (!$.RECORDING_PHASE) {
        left = new Operation([left, op!.image, right])
      }
    })

    if (!$.RECORDING_PHASE) {
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
          if (!$.RECORDING_PHASE) {
            let location = $.endRule()
            return $.wrap(new Paren(node!, undefined, location, this.context), 'both')
          }
        }
      }
    ])
    if (!$.RECORDING_PHASE) {
      if (token) {
        node = $.wrap($.processValueToken(token), 'both')
      }
      return node
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
    $.CONSUME(T.Var)
    $.CONSUME(T.CustomProperty)
    $.OPTION(() => {
      $.CONSUME(T.Comma)
      $.SUBRULE($.valueList)
    })
    $.CONSUME(T.RParen)
  })

  $.RULE('calcFunction', () => {
    $.CONSUME(T.Calc)
    $.SUBRULE($.mathSum)
    $.CONSUME2(T.RParen)
  })

  $.RULE('urlFunction', () => {
    $.CONSUME(T.UrlStart)
    $.OR([
      { ALT: () => $.SUBRULE($.string) },
      { ALT: () => $.CONSUME(T.NonQuotedUrl) }
    ])
    $.CONSUME(T.UrlEnd)
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
  $.RULE('atRule', () => {
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
  })

  /**
      Inner rules are mostly the same except they have a declarationList
      instead of a main block within {}
      @todo - Add `@container` `@layer` `@scope`
    */
  // innerAtRule
  //   : innerMediaAtRule
  //   | unknownAtRule
  //   ;
  $.RULE('innerAtRule', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [true] }) },
      { ALT: () => $.SUBRULE($.unknownAtRule) }
    ])
  })

  /**
     * @see https://www.w3.org/TR/css-nesting-1/#conditionals
     */
  $.RULE('atRuleBody', (inner: boolean = false) => {
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
  })

  // mediaAtRule
  //   : MEDIA_RULE WS* mediaQuery WS* LCURLY main RCURLY
  //   ;
  $.RULE('mediaAtRule', (inner?: boolean) => {
    $.CONSUME(T.AtMedia)
    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => $.SUBRULE($.mediaQuery)
    })
    $.CONSUME(T.LCurly)
    $.SUBRULE($.atRuleBody, { ARGS: [inner] })
    $.CONSUME(T.RCurly)
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
    $.OR([
      { ALT: () => $.SUBRULE($.mediaCondition) },
      {
        ALT: () => {
          $.OPTION(() => {
            $.OR2([
              { ALT: () => $.CONSUME(T.Not) },
              { ALT: () => $.CONSUME(T.Only) }
            ])
          })
          $.SUBRULE($.mediaType)
          $.OPTION2(() => {
            $.CONSUME(T.And)
            $.SUBRULE($.mediaConditionWithoutOr)
          })
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
    $.OR([
      { ALT: () => $.CONSUME(T.PlainIdent) },
      { ALT: () => $.CONSUME(T.Screen) },
      { ALT: () => $.CONSUME(T.Print) },
      { ALT: () => $.CONSUME(T.All) }
    ])
  })

  // mediaCondition
  //   : mediaNot | mediaInParens ( WS* (mediaAnd* | mediaOr* ))
  //   ;
  $.RULE('mediaCondition', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaNot) },
      {
        ALT: () => {
          $.SUBRULE($.mediaInParens)
          $.MANY(() => {
            $.OR2([
              { ALT: () => { $.SUBRULE($.mediaAnd) } },
              { ALT: () => { $.SUBRULE($.mediaOr) } }
            ])
          })
        }
      }
    ])
  })

  // mediaConditionWithoutOr
  //   : mediaNot | mediaInParens (WS* mediaAnd)*
  //   ;
  $.RULE('mediaConditionWithoutOr', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mediaNot) },
      {
        ALT: () => {
          $.SUBRULE($.mediaInParens)
          $.MANY(() => $.SUBRULE($.mediaAnd))
        }
      }
    ])
  })

  // mediaNot
  //   : NOT WS* mediaInParens
  //   ;
  $.RULE('mediaNot', () => {
    $.CONSUME(T.Not)
    $.SUBRULE($.mediaInParens)
  })

  // mediaAnd
  //   : AND WS* mediaInParens
  //   ;
  $.RULE('mediaAnd', () => {
    $.CONSUME(T.And)
    $.SUBRULE($.mediaInParens)
  })

  // mediaOr
  //   : OR WS* mediaInParens
  //   ;
  $.RULE('mediaOr', () => {
    $.CONSUME(T.Or)
    $.SUBRULE($.mediaInParens)
  })

  // mediaInParens
  //   : '(' WS* (mediaCondition | mediaFeature) WS* ')'
  //   | generalEnclosed
  //   ;
  $.RULE('mediaInParens', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.OR2([
            { ALT: () => $.SUBRULE($.mediaCondition) },
            { ALT: () => $.SUBRULE($.mediaFeature) }
          ])
          $.CONSUME(T.RParen)
        }
      },
      { ALT: () => $.SUBRULE($.generalEnclosed) }
    ])
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
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Ident)
          $.OPTION(() => {
            $.OR2([
              {
                ALT: () => {
                  $.CONSUME(T.Colon)
                  $.SUBRULE($.mfValue)
                }
              },
              { ALT: () => $.SUBRULE($.mediaRange) },
              {
                ALT: () => {
                  $.SUBRULE($.mfComparison)
                  $.SUBRULE($.mfNonIdentifierValue)
                }
              }
            ])
          })
        }
      },
      {
        ALT: () => {
          $.SUBRULE2($.mfNonIdentifierValue)
          $.OR3([
            {
              ALT: () => {
                $.SUBRULE2($.mfComparison)
                $.CONSUME2(T.Ident)
              }
            },
            { ALT: () => $.SUBRULE2($.mediaRange) }
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
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Lt, { LABEL: 'L' })
          $.CONSUME(T.Ident)
          $.OPTION(() => {
            $.CONSUME2(T.Lt, { LABEL: 'R' })
            $.SUBRULE($.mfValue)
          })
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.Gt, { LABEL: 'L' })
          $.CONSUME2(T.Ident)
          $.OPTION2(() => {
            $.CONSUME2(T.Gt, { LABEL: 'R' })
            $.SUBRULE2($.mfValue)
          })
        }
      }
    ])
  })

  // mfNonIdentifierValue
  //   : number (WS* '/' WS* number)?
  //   | dimension
  //   ;
  $.RULE('mfNonIdentifierValue', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Number)
          $.OPTION(() => {
            $.CONSUME(T.Slash)
            $.CONSUME2(T.Number)
          })
        }
      },
      { ALT: () => $.CONSUME(T.Dimension) }
    ])
  })

  // mfValue
  //   : mfNonIdentifierValue | identifier
  //   ;
  $.RULE('mfValue', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.mfNonIdentifierValue) },
      { ALT: () => $.CONSUME(T.Ident) }
    ])
  })

  // mfComparison
  //   : mfLt | mfGt | mfEq
  //   ;
  $.RULE('mfComparison', () => {
    $.OR([
      { ALT: () => $.CONSUME(T.Lt) },
      { ALT: () => $.CONSUME(T.Gt) },
      { ALT: () => $.CONSUME(T.Eq) }
    ])
  })

  // generalEnclosed
  //   : function
  //   // The spec allows the following, presumably because
  //   // whether or not a query is valid is up to the user agent.
  //   // However, this makes the grammar more ambiguous,
  //   // and we limit parsing to known query types.
  //   // | '(' WS* anyValue WS* ')'
  //   ;
  $.RULE('generalEnclosed', () => {
    $.CONSUME(T.LParen)
    $.SUBRULE($.anyInnerValue)
    $.CONSUME(T.RParen)
  })

  /**
     * @see https://www.w3.org/TR/css-page-3/
     * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
     */
  $.RULE('pageAtRule', () => {
    $.CONSUME(T.AtPage)
    $.MANY_SEP({
      SEP: T.Comma,
      DEF: () => $.SUBRULE($.pageSelector)
    })
    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  $.RULE('pageSelector', () => {
    $.OPTION(() => $.CONSUME(T.Ident))
    $.MANY({
      GATE: () => $.LA(1).tokenType === T.Colon && $.noSep(1),
      DEF: () => {
        $.CONSUME(T.Colon)
        $.CONSUME(T.PagePseudoClassKeywords)
      }
    })
  })

  // fontFaceAtRule
  //   : FONT_FACE_RULE WS* LCURLY declarationList RCURLY
  //   ;
  $.RULE('fontFaceAtRule', () => {
    $.CONSUME(T.AtFontFace)
    $.CONSUME(T.LCurly)
    $.SUBRULE($.declarationList)
    $.CONSUME(T.RCurly)
  })

  /**
     * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@supports
     */
  // supportsAtRule
  //   : SUPPORTS_RULE WS* supportsCondition WS* LCURLY main RCURLY
  //   ;
  $.RULE('supportsAtRule', (inner?: boolean) => {
    $.CONSUME(T.AtSupports)
    $.SUBRULE($.supportsCondition)
    $.CONSUME(T.LCurly)
    $.SUBRULE($.atRuleBody, { ARGS: [inner] })
    $.CONSUME(T.RCurly)
  })

  // supportsCondition
  //   : NOT supportsInParens
  //   | supportsInParens (WS* AND supportsInParens)*
  //   | supportsInParens (WS* OR supportsInParens)*
  //   ;
  $.RULE('supportsCondition', () => {
    $.OR([
      {
        ALT: () => {
          $.SUBRULE($.supportsNot)
        }
      },
      {
        ALT: () => {
          $.SUBRULE($.supportsInParens)
          $.MANY(() => {
            $.OR2([
              { ALT: () => { $.SUBRULE($.supportsAnd) } },
              { ALT: () => { $.SUBRULE($.supportsOr) } }
            ])
          })
        }
      }
    ])
  })

  $.RULE('function', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.knownFunctions) },
      {
        ALT: () => {
          $.CONSUME(T.Ident)
          $.OR2([{
            GATE: $.noSep,
            ALT: () => {
              $.CONSUME(T.LParen)
              $.OPTION(() => $.SUBRULE($.valueList))
              $.CONSUME(T.RParen)
            }
          }])
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
    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Ident)
          $.OR2([
            {
              GATE: $.noSep,
              ALT: () => {
                $.CONSUME(T.LParen)
                $.SUBRULE($.valueList)
                $.CONSUME(T.RParen)
              }
            }
          ])
        }
      },
      {
        ALT: () => {
          $.CONSUME2(T.LParen)
          $.OR3([
            { ALT: () => $.SUBRULE($.supportsCondition) },
            { ALT: () => $.SUBRULE($.declaration) }
          ])
          $.CONSUME2(T.RParen)
        }
      },
      { ALT: () => $.SUBRULE($.generalEnclosed) }
    ])
  })

  $.RULE('supportsNot', () => {
    $.CONSUME(T.Not)
    $.SUBRULE($.supportsInParens)
  })

  $.RULE('supportsAnd', () => {
    $.CONSUME(T.And)
    $.SUBRULE($.supportsInParens)
  })

  $.RULE('supportsOr', () => {
    $.CONSUME(T.Or)
    $.SUBRULE($.supportsInParens)
  })

  // https://www.w3.org/TR/css-cascade-4/#at-import
  // importAtRule
  //   : IMPORT_RULE WS* (URL_FUNCTION | STRING) (WS* SUPPORTS_FUNCTION WS* (supportsCondition | declaration))? (WS* mediaQuery)? SEMI
  //   ;
  $.RULE('importAtRule', () => {
    $.CONSUME(T.AtImport)
    $.OR([
      { ALT: () => $.SUBRULE($.urlFunction) },
      { ALT: () => $.SUBRULE($.string) }
    ])
    $.OPTION(() => {
      $.CONSUME(T.Supports)
      $.OR2([
        { ALT: () => $.SUBRULE($.supportsCondition) },
        { ALT: () => $.SUBRULE($.declaration) }
      ])
    })
    $.OPTION2(() => {
      $.SUBRULE($.mediaQuery)
    })
    $.CONSUME(T.Semi)
  })

  $.RULE('nestedAtRule', () => {
    $.CONSUME(T.AtNested)
    $.MANY(() => $.SUBRULE($.anyOuterValue))
    $.CONSUME(T.LCurly)
    $.MANY2(() => $.SUBRULE($.anyInnerValue))
    $.CONSUME(T.RCurly)
  })

  $.RULE('nonNestedAtRule', () => {
    $.CONSUME(T.AtNonNested)
    $.MANY(() => $.SUBRULE($.anyOuterValue))
    $.CONSUME(T.Semi)
  })

  // unknownAtRule
  //   : AT_RULE anyOuterValue* (SEMI | LCURLY anyInnerValue* RCURLY)
  //   ;
  $.RULE('unknownAtRule', () => {
    $.CONSUME(T.AtKeyword)
    $.MANY(() => $.SUBRULE($.anyOuterValue))
    $.OR([
      { ALT: () => $.CONSUME(T.Semi) },
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.MANY2(() => $.SUBRULE($.anyInnerValue))
          $.CONSUME(T.RCurly)
        }
      }
    ])
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
    $.OR([
      { ALT: () => $.SUBRULE($.extraTokens) },
      { ALT: () => $.SUBRULE($.string) },
      {
        ALT: () => {
          $.CONSUME(T.LParen)
          $.MANY(() => $.SUBRULE($.anyInnerValue))
          $.CONSUME(T.RParen)
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.LSquare)
          $.MANY2(() => $.SUBRULE2($.anyInnerValue))
          $.CONSUME(T.RSquare)
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
    $.OR([
      { ALT: () => $.SUBRULE($.anyOuterValue) },
      {
        ALT: () => {
          $.CONSUME(T.LCurly)
          $.MANY(() => $.SUBRULE2($.anyInnerValue))
          $.CONSUME(T.RCurly)
        }
      },
      { ALT: () => $.CONSUME(T.Semi) }
    ])
  })
}