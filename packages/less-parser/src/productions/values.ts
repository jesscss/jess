import { LessParser } from '../lessParser'
import { EMPTY_ALT } from 'chevrotain'
import { CstChild, IToken, CstNode } from '@jesscss/css-parser'

export default function (this: LessParser, $: LessParser) {
  const compareGate = () => $.inCompareBlock

  /**
   * @todo - rewrite to capture all guard expressions
   */
  $.expression = $.OVERRIDE_RULE('expression', () => {
    const children: CstChild[] = [
      $._(0)
    ]
    $.OR([
      {
        GATE: compareGate,
        ALT: () => $.MANY(() => children.push($.SUBRULE($.compare)))
      },
      { ALT: () => $.MANY2(() => children.push($.SUBRULE($.addition))) }
    ])
  
    return {
      name: 'expression',
      children
    }
  })

  $.function = $.RULE('function',
    () => ({
      name: 'function',
      children: $.OR([
        {
          ALT: () => [
            $.OR2([
              { ALT: () => $.CONSUME($.T.PlainFunction) },
              { ALT: () => $.CONSUME($.T.FormatFunction) }
            ]),
            $.SUBRULE($.functionArgs),
            $.CONSUME($.T.RParen)
          ]
        },
        /**
         * Special parsing of `if` and `boolean`
         */
        {
          ALT: () => [
            $.CONSUME($.T.BooleanFunction),
            $.SUBRULE($.guardOr, { ARGS: [true] }),
            $.CONSUME2($.T.RParen)
          ]
        },
        {
          ALT: () => {
            const functionArgs: CstChild[] = []
            const func: CstChild = $.CONSUME($.T.IfFunction)
            
            functionArgs.push(
              $.SUBRULE2($.guardOr, { ARGS: [true] }),
              $._()
            )
            $.MANY(() => {
              functionArgs.push(
                {
                  name: 'delimiter',
                  children: [
                    $.OR3([{
                      ALT: () => $.CONSUME($.T.Comma) },
                    { ALT: () => $.CONSUME($.T.SemiColon)
                    }]),
                    $._(1)
                  ]
                },
                $.SUBRULE2($.functionArg),
                $._(2)
              )
            })
            return [
              func,
              {
                name: 'functionArgs',
                children: functionArgs
              },
              $.CONSUME3($.T.RParen)
            ]
          }
        }
      ])
    })
  )

  $.functionArgs = $.RULE('functionArgs', () => {
    const children: CstChild[] = [
      $.SUBRULE($.functionArg),
      $._()
    ]
    $.MANY(() => {
      children.push(
        {
          name: 'delimiter',
          children: [
            $.OR([
              { ALT: () => $.CONSUME($.T.Comma) },
              { ALT: () => $.CONSUME($.T.SemiColon)
              }]),
            $._(1)
          ]
        },

        $.SUBRULE2($.functionArg),
        $._(2)
      )
    })

    return {
      name: 'functionArgs',
      children
    }
  })

  $.functionArg = $.RULE('functionArg',
    () => $.OR([
      { ALT: () => $.SUBRULE($.anonMixin) },
      { ALT: () => $.SUBRULE($.curlyBlock) },
      { ALT: () => $.SUBRULE($.expression) }
    ])
  )

  /**
   * Can be in the form of:
   *   @var
   *   #selector()[lookup]
   *   #selector(args)[lookup]
   *   @var[lookup]
   *   @var[lookup][lookup2]
   */
  $.variable = $.RULE('variable', () => {
    let selectors: IToken[]
    
    let node: CstNode = $.OR([
      { ALT: () => ({
        name: 'variable',
        children: [$.CONSUME($.T.VarOrProp)]
      })
      },
      {
        ALT: () => {
          selectors = []
          $.AT_LEAST_ONE(() => selectors.push($.CONSUME($.T.Selector)))
          const expr = {
            name: 'expression',
            children: selectors
          }
          /**
           * @note - if there are no parens or accessors, then
           *         it's a plain selector
           */
          const children = $.OPTION(() => [
            $.CONSUME($.T.LParen),
            $.SUBRULE($.mixinArgs),
            $.CONSUME($.T.RParen)
          ])
          if (!this.RECORDING_PHASE && children) {
            return {
              name: 'mixinCall',
              children: [
                expr,
                ...children
              ]
            }
          }
          return expr
        }
      }
    ])
    $.MANY(() => {
      const L = $.CONSUME($.T.LSquare)
      let lookup = $.OR2([
        { ALT: () => $.CONSUME2($.T.VarOrProp) },
        { ALT: () => $.CONSUME($.T.Ident) },
        { ALT: () => EMPTY_ALT }
      ])
      const R = $.CONSUME($.T.RSquare)

      if (lookup === EMPTY_ALT) {
        lookup = undefined
      }
      /**
       * Nest accessors so we can evaluate inner-most first,
       * and then successive accessors.
       */
      node = {
        name: 'accessor',
        children: [node, L, lookup, R]
      }
    })

    return node
  })

  $.valueBlock = $.RULE('valueBlock',
    () => ({
      name: 'block',
      children: $.OR([
        {
          ALT: () => [
            $.CONSUME($.T.LParen),
            $.OR2([
              {
                GATE: compareGate,
                ALT: () => $.SUBRULE($.guardOr)
              },
              { ALT: () => $.SUBRULE($.expressionList) }
            ]),
            $.CONSUME($.T.RParen)
          ]
        },
        {
          ALT: () => [
            $.CONSUME($.T.LSquare),
            $.SUBRULE2($.expressionList),
            $.CONSUME($.T.RSquare)
          ]
        }
      ])
    })
  )

  /** This is more specific than the CSS parser */
  $.value = $.OVERRIDE_RULE('value', () => {
    let op = $.OPTION(() => 
      /** Applying negative or positive to a value */
      $.CONSUME($.T.AdditionOperator)
    )
    let value = {
      name: 'value',
      children: [
        $.OR([
          { ALT: () => $.SUBRULE($.valueBlock) },
          { ALT: () => $.SUBRULE($.function) },
          { ALT: () => $.CONSUME($.T.Ident) },
          { ALT: () => $.SUBRULE($.variable) },
          { ALT: () => $.CONSUME($.T.CustomProperty) },
          { ALT: () => $.CONSUME($.T.Dimension) },
          { ALT: () => $.CONSUME($.T.Number) },
          { ALT: () => $.CONSUME($.T.Percent) },
          { ALT: () => $.CONSUME($.T.StringLiteral) },
          { ALT: () => $.CONSUME($.T.Uri) },
          { ALT: () => $.CONSUME($.T.ColorIntStart) },
          { ALT: () => $.CONSUME($.T.UnicodeRange) },
          { ALT: () => $.CONSUME($.T.When) },

          /** Can be found in selector expressions */
          { ALT: () => $.CONSUME($.T.AttrMatchOperator) },
          { ALT: () => $.CONSUME($.T.Colon) },
          { ALT: () => $.CONSUME($.T.Combinator) }
        ]),
        $._()
      ]
    }
    if (op) {
      return {
        name: 'sign',
        children: [
          op,
          value
        ]
      }
    }
    return value
  })

  $.compare = $.RULE('compare', () => {
    const compareValue = $.inCompareBlock
    $.inCompareBlock = true
    let expr = $.SUBRULE($.addition)
    $.MANY(() => {
      expr = {
        name: 'compare',
        children: [
          expr,
          {
            name: 'op',
            children: [
              $.CONSUME($.T.CompareOperator),
              $._(0)
            ]
          },
          $.SUBRULE2($.addition)
        ]
      }
    })
    /** Restore to value on entry */
    $.inCompareBlock = compareValue
    return expr
  })

  $.addition = $.RULE('addition', () => {
    let expr = $.SUBRULE($.multiplication)
    $.MANY(() => {
      expr = {
        name: 'addition',
        children: [
          expr,
          {
            name: 'op',
            children: [
              $.CONSUME($.T.AdditionOperator),
              $._(0)
            ]
          },
          $.SUBRULE2($.multiplication)
        ]
      }
    })
    return expr
  })

  $.multiplication = $.RULE('multiplication', () => {
    let expr = $.SUBRULE($.value)
    $.MANY(() => {
      expr = {
        name: 'multiplication',
        children: [
          expr,
          {
            name: 'op',
            children: [
              $.CONSUME($.T.MultiplicationOperator),
              $._(0)
            ]
          },
          $.SUBRULE2($.value)
        ]
      }
    })
    return expr
  })
}
