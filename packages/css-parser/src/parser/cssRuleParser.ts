import { TokenType, IParserConfig, IToken, CstNode, CstElement } from 'chevrotain'
import { CssStructureParser } from './cssStructureParser'
import { TokenMap } from '../util'

/**
 * This class further parses general rules into known rules
 */
export class CssRuleParser extends CssStructureParser {
  T: TokenMap

  constructor(
    tokens: TokenType[],
    T: TokenMap,
    config: IParserConfig = { maxLookahead: 1, recoveryEnabled: true }
  ) {
    super(tokens, T, config)
    this.T = T
    if (this.constructor === CssRuleParser) {
      this.performSelfAnalysis()
    }
  }

  /** A comma-separated list of selectors */
  selectorList = this.RULE(
    'selectorList',
    (): CstNode => {
      let selectors: CstNode[]
      let Comma: IToken[]
      let sel: CstNode

      this.OPTION(() => {
        sel = this.SUBRULE(this.selector)
        if (sel) {
          selectors = [sel]
        } else {
          selectors = []
        }
        Comma = []
        this.MANY(() => {
          const comma = this.CONSUME(this.T.Comma)
          Comma.push(comma)
          sel = this.SUBRULE(this.selector)
          selectors.push(sel)
        })
      })

      if (sel) {
        return {
          name: 'selectorList',
          children: {
            ...(Comma && Comma.length > 0 ? { Comma } : {}),
            ...(selectors ? { selectors } : {})
          }
        }
      }
    }
  )

  /**
   * AKA a 'complex selector' --
   * "A complex selector is a sequence of one or more compound selectors
   *  separated by combinators. It represents a set of simultaneous
   *  conditions on a set of elements in the particular relationships
   *  described by its combinators."
   *
   * @see https://www.w3.org/TR/selectors-4/#structure
   */
  selector = this.RULE(
    'selector',
    (): CstNode => {
      let selector: CstElement[] = [this.SUBRULE(this.compoundSelector)]

      this.MANY(() => {
        this.OR([
          {
            ALT: () => {
              /**
               * Combinator with optional whitespace
               */
              selector.push(this.CONSUME(this.T.Combinator))
              this.OPTION(() => {
                selector.push(this.CONSUME(this.T.WS))
              })
            }
          },
          {
            /**
             * Combinator with optional whitespace
             */
            ALT: () => {
              selector.push(this.CONSUME2(this.T.WS))
              this.OPTION2(() => {
                selector.push(this.CONSUME2(this.T.Combinator))
                this.OPTION(() => {
                  selector.push(this.CONSUME3(this.T.WS))
                })
              })
            }
          }
        ])
        selector.push(this.SUBRULE2(this.compoundSelector))
      })
      return {
        name: 'selector',
        children: { selector }
      }
    }
  )

  /**
   * "A compound selector is a sequence of simple selectors that are not separated by a combinator,
   * and represents a set of simultaneous conditions on a single element. If it contains a type
   * selector or universal selector, that selector must come first in the sequence."
   *
   * @see https://www.w3.org/TR/selectors-4/#structure
   */
  compoundSelector = this.RULE(
    'compoundSelector',
    (): CstNode => {
      let selector: CstElement[] = []

      this.OR([
        { ALT: () => selector.push(this.CONSUME(this.T.Star)) },
        {
          ALT: () => {
            this.MANY(() => selector.push(this.SUBRULE(this.simpleSelector)))
          }
        }
      ])

      return {
        name: 'compoundSelector',
        children: { selector }
      }
    }
  )

  /**
   * "A simple selector is a single condition on an element. A type selector,
   * universal selector, attribute selector, class selector, ID selector,
   * or pseudo-class is a simple selector."
   *
   * @see https://www.w3.org/TR/selectors-4/#structure
   */
  simpleSelector = this.RULE(
    'simpleSelector',
    (): CstNode => {
      let values: CstElement[]
      this.OR([
        {
          /** e.g. :pseudo */
          ALT: () => {
            values = [this.CONSUME(this.T.Colon), this.CONSUME(this.T.Ident)]
            /** e.g. :pseudo(...) */
            this.OPTION(() => {
              values.push(this.CONSUME(this.T.LParen))
              values.push(this.SUBRULE(this.expressionListGroup))
              values.push(this.CONSUME(this.T.RParen))
            })
          }
        },
        {
          /** e.g. [id^="bar"] */
          ALT: () => {
            values = [this.CONSUME(this.T.LSquare), this.CONSUME2(this.T.Ident)]
            this.OPTION2(() => {
              this.OR2([
                {
                  ALT: () => {
                    values.push(this.CONSUME(this.T.Eq))
                  }
                },
                {
                  ALT: () => {
                    values.push(this.CONSUME(this.T.AttrMatchOperator))
                    values.push(this.CONSUME(this.T.Eq))
                  }
                }
              ])
              this.OR3([
                {
                  ALT: () => {
                    values.push(this.CONSUME3(this.T.Ident))
                  }
                },
                {
                  ALT: () => {
                    values.push(this.CONSUME(this.T.StringLiteral))
                  }
                }
              ])
            })
            values.push(this.CONSUME(this.T.RSquare))
          }
        },
        {
          ALT: () => {
            values = [this.CONSUME(this.T.Selector)]
          }
        }
      ])
      return {
        name: 'simpleSelector',
        children: {
          values
        }
      }
    }
  )

  /** A property is a collection of tokens in case we need to process segments */
  property = this.RULE('property', () => {
    return [this.CONSUME(this.T.PropertyName)]
  })

  expression = this.RULE('expression', () => {
    let values: CstElement[] = []
    this.AT_LEAST_ONE(() => {
      const tmpValues = this.SUBRULE(this.valueExpression)
      this.ACTION(() => {
        values = values.concat(tmpValues)
      })
    })
    return {
      name: 'expression',
      children: { values }
    }
  })

  valueExpression = this.RULE('valueExpression', (): CstElement[] => {
    let values: CstElement[] = []
    let val: CstElement
    val = this.WS()
    this.ACTION(() => val && values.push(val))

    this.OPTION(() => {
      val = this.SUBRULE(this.addition)
      this.ACTION(() => val && values.push(val))
    })

    return values
  })

  addition = this.RULE(
    'addition',
    (): CstElement => {
      let rhs: CstElement[] = []
      let val: CstElement
      let op: IToken
      let ws: IToken
      const lhs = this.SUBRULE(this.multiplication)
      this.MANY(() => {
        op = this.CONSUME(this.T.AdditionOperator)
        ws = this.WS()
        val = this.SUBRULE2(this.multiplication)
        this.ACTION(() => {
          rhs.push({
            name: 'rhs',
            children: {
              op: [op],
              ...(ws ? { ws: [ws] } : {}),
              expression: [val]
            }
          })
        })
      })
      const post = this.WS(1)
      if (rhs?.length > 0) {
        return {
          name: 'addition',
          children: {
            lhs: [lhs],
            rhs,
            ...(post ? { post: [post] } : {})
          }
        } as CstNode
      } else {
        return lhs
      }
    }
  )

  multiplication = this.RULE(
    'multiplication',
    (): CstElement => {
      let rhs: CstElement[] = []
      let val: CstElement
      let op: IToken
      let ws: IToken
      const lhs = this.SUBRULE(this.compare)
      this.MANY(() => {
        op = this.CONSUME(this.T.MultiplicationOperator)
        ws = this.WS()
        val = this.SUBRULE2(this.compare)
        this.ACTION(() => {
          rhs.push({
            name: 'rhs',
            children: {
              op: [op],
              ...(ws ? { ws: [ws] } : {}),
              expression: [val]
            }
          })
        })
      })
      const post = this.WS(1)
      if (rhs.length > 0) {
        return {
          name: 'multiplication',
          children: {
            lhs: [lhs],
            rhs,
            ...(post ? { post: [post] } : {})
          }
        }
      } else {
        return lhs
      }
    }
  )

  compare = this.RULE(
    'compare',
    (): CstElement => {
      let rhs: CstElement[] = []
      let val: CstElement
      let op: IToken
      let ws: IToken
      const lhs = this.SUBRULE(this.value)
      this.MANY(() => {
        op = this.CONSUME(this.T.CompareOperator)
        ws = this.WS()
        val = this.SUBRULE2(this.value)
        this.ACTION(() => {
          rhs.push({
            name: 'rhs',
            children: {
              op: [op],
              ...(ws ? { ws: [ws] } : {}),
              expression: [val]
            }
          })
        })
      })
      const post = this.WS(2)
      if (rhs.length > 0) {
        return {
          name: 'compare',
          children: {
            lhs: [lhs],
            rhs,
            ...(post ? { post: [post] } : {})
          }
        }
      } else {
        return lhs
      }
    }
  )

  value = this.RULE(
    'value',
    (): IToken => {
      return this.OR([
        { ALT: () => this.CONSUME(this.T.Unit) },
        { ALT: () => this.CONSUME(this.T.Ident) },
        { ALT: () => this.CONSUME(this.T.StringLiteral) },
        { ALT: () => this.CONSUME(this.T.Uri) },
        { ALT: () => this.CONSUME(this.T.Color) },
        { ALT: () => this.CONSUME(this.T.UnicodeRange) }
      ])
    }
  )

  // value = this.OVERRIDE_RULE('value', () => {
  //   this.OR([
  //     { ALT: () => this.SUBRULE(this.block) },
  //     { ALT: () => this.CONSUME(this.T.Unit) },
  //     { ALT: () => this.CONSUME(this.T.Ident) },
  //     { ALT: () => this.CONSUME(this.T.StringLiteral) },
  //     { ALT: () => this.CONSUME(this.T.Uri) },
  //     { ALT: () => this.CONSUME(this.T.Color) },
  //     { ALT: () => this.CONSUME(this.T.UnicodeRange) },
  //     { ALT: () => this.CONSUME(this.T.WS) }
  //   ])
  // })

  // // ':' [ IDENT | FUNCTION S* [IDENT S*]? ')' ]
  // pseudoSelector = this.RULE('pseudoSelector', () => {
  //   this.OR([
  //     { ALT: () => this.SUBRULE(this.pseudoFunction) },
  //     { ALT: () => {
  //       this.CONSUME(this.T.Colon, { LABEL: 'colon1' })
  //       this.OPTION(() => this.CONSUME2(this.T.Colon, { LABEL: 'colon2' }))
  //       this.CONSUME(this.T.Ident)
  //     }}
  //   ])
  // })

  // pseudoFunction = this.RULE('pseudoFunction', () => {
  //   this.OR([
  //     {
  //       ALT: () => {
  //         this.CONSUME(this.T.PseudoNotNthFunc)
  //         this.WS()
  //         this.SUBRULE(this.compoundSelectorList)
  //         this.SUBRULE2(this._)
  //         this.CONSUME(this.T.RParen)
  //       }
  //     },
  //     {
  //       /**
  //        * :nth* pseudo-function
  //        * @reference https://www.w3.org/TR/css-syntax-3/#anb-microsyntax
  //        */
  //       ALT: () => {
  //         this.CONSUME(this.T.PseudoNthFunc)
  //         this.SUBRULE3(this._)
  //         this.OR2([
  //           { ALT: () => this.CONSUME(this.T.NthIdent) },
  //           {
  //             ALT: () => {
  //               /**
  //                * @todo implement a GATE to check for 'n'
  //                */
  //               this.CONSUME(this.T.DimensionInt)
  //               this.SUBRULE4(this._)
  //               this.OPTION(() => {
  //                 this.OR3([
  //                   {
  //                     ALT: () => {
  //                       this.OR4([
  //                         { ALT: () => this.CONSUME(this.T.Plus) },
  //                         { ALT: () => this.CONSUME(this.T.Minus) }
  //                       ])
  //                       this.CONSUME(this.T.WS)
  //                       this.CONSUME(this.T.UnsignedInt)
  //                     }
  //                   },
  //                   {
  //                     /**
  //                      * A signed int is a single token, so this allows
  //                      * 'n+1', which is [<Ident: 'n'>, <SignedInt: '+1'>]
  //                     */
  //                     ALT: () => this.CONSUME(this.T.SignedInt)
  //                   }
  //                 ])
  //               })
  //             }
  //           }
  //         ])
  //         this.SUBRULE5(this._)
  //         this.OPTION2(() => {
  //           this.CONSUME(this.T.Of)
  //           this.SUBRULE6(this._)
  //           this.SUBRULE2(this.compoundSelectorList)
  //           this.SUBRULE7(this._)
  //         })
  //         this.CONSUME2(this.T.RParen)
  //       }
  //     }
  //   ])
  // })
}
