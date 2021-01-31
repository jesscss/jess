import { CstChild, CstNode } from '@jesscss/css-parser'
import { EMPTY_ALT, IToken } from 'chevrotain'
import { Declaration } from 'css-parser/src/productions/declarations'
import type { LessParser } from '../lessParser'

export default function(this: LessParser, $: LessParser) {
  /**
   * .mixin .foo la (@foo: bar, blah, ...;)
   */

  /**
   * Test for mixin start
   */
  $.testMixin = $.RULE('testMixin', () => {
    $.SUBRULE($.mixinStart)
    $._()
    $.OR([
      { ALT: () => $.CONSUME($.T.SemiColon) },
      { ALT: () => $.CONSUME($.T.LParen) }
    ])
  })

  /**
   * To avoid a lot of back-tracking, we parse the mixin start
   * and mixin arguments equally for mixin calls, as it's only
   * the final curlyBlock that determines if this is a definition
   * or a call.
   * 
   * During CST-to-AST, we can throw an error if a mixin definition
   * doesn't have valid selectors or arguments, or if, say, a mixin
   * call has a guard and shouldn't.
   */
  $.mixin = $.RULE<CstNode>('mixin', () => {
    const children: CstChild[] = [
      $.SUBRULE($.mixinStart)
    ]
    $.OR([
      { ALT: () => {
        children.push(
          $.CONSUME($.T.LParen),
          $.SUBRULE($.mixinArgs),
          $.CONSUME($.T.RParen)
        )
      }},
      { ALT: () => {
        children.push(undefined, undefined, undefined)
        return EMPTY_ALT
      }}
    ])
    
    children.push(
      $._(1),
      $.OPTION(() => ({
        name: 'important',
        children: [
          $.CONSUME($.T.Important),
          $._(2)
        ]
      })),
      $.OPTION4(() => $.SUBRULE($.guard))
    )
    
    $.OR2([
      {
        ALT: () => {
          children.push($.CONSUME($.T.SemiColon))
        }
      },
      {
        ALT: () => {
          children.push($.SUBRULE($.curlyBlock))
        }
      },
      { ALT: () => EMPTY_ALT }
    ])
  
    return {
      name: 'mixin',
      children
    }
  })

  $.mixinStart = $.RULE('mixinStart', () => {
    const children: CstChild[] = [
      $.SUBRULE($.mixinName),
      $._()
    ]
    $.MANY(() => {
      children.push(
        $.OPTION(() => ({
          name: 'combinator',
          children: [
            $.CONSUME($.T.Gt),
            $._(1)
          ]
        })),
        $.SUBRULE2($.mixinName),
        $._(2)
      )
    })
    return {
      name: 'mixinStart',
      children
    }
  })

  $.mixinName = $.RULE('mixinName',
    () => $.OR([
      { ALT: () => $.CONSUME($.T.DotName) },
      { ALT: () => $.CONSUME($.T.HashName) },
      { ALT: () => $.CONSUME($.T.ColorIdentStart) },
      { ALT: () => $.CONSUME($.T.Interpolated) }
    ])
  )

  /**
   * This code gets a bit complicated. Less 2.x-4.x uses
   * lookaheads to find semi-colons, and if found, parses
   * arguments differently.
   * 
   * Instead, here we just allow for semi-colon or comma
   * separators, and if BOTH, then we MERGE comma-separated
   * arguments into the initial expression as an expression
   * list.
   * 
   * This allows us to have one parsing "pass" on arguments
   * without any back-tracking.
   * 
   * Is this premature optimization? Possibly. It would depend
   * on the performance of backtracking and the potential
   * length of mixin args.
   */
  $.mixinArgs = $.RULE('mixinArgs', () => {
    let childrenGroups: any[][] = [[
      $.SUBRULE($.mixinArg)
    ]]
    let children: CstChild[] = childrenGroups[0]
    let groupIndex = 0

    $.MANY(() => {
      $.OR([
        { ALT: () => {
          children.push(
            $.CONSUME($.T.Comma),
            $.SUBRULE2($.mixinArg)
          )
        }},
        { ALT: () => {
          children.push(
            $.CONSUME($.T.SemiColon)
          )

          childrenGroups.push([
            $.SUBRULE3($.mixinArg)
          ])
          groupIndex++
          children = childrenGroups[groupIndex]
        }}
      ])
    })

    if (!this.RECORDING_PHASE && childrenGroups.length !== 1) {
      children = []
      childrenGroups.forEach(group => {
        const length = group.length
        const value: CstNode = group[0].children[1]
        let expr: CstNode
        let exprList: CstNode[] = []

        if (value.name === 'declaration') {
          expr = (<Declaration>value).children[4]
        } else {
          expr = value
        }

        exprList.push(expr)

        for (let i = 1; i < length - 1; i += 2) {
          /** Comma separator */
          exprList.push(group[i])
          expr = group[i + 1].children[1]
          exprList.push(expr)
        }

        const exprListNode = {
          name: 'expressionList',
          children: exprList
        }
        if (value.name === 'declaration') {
          value.children[4] = exprListNode
        } else {
          group[0].children[1] = exprListNode
        }
        children.push(group[0])
        const semi = group[group.length - 1]
        if (semi?.image === ';') {
          children.push(semi)
        }
      })
    }

    return {
      name: 'mixinArgs',
      children
    }
  })


  /**
   * This will return a mixin arg containing
   * a declaration, an expression, or a rest
   *   (e.g. `@var...`)
   */
  $.mixinArg = $.RULE('mixinArg', () => {
    let pre = $._(0)

    let varName: IToken
    let ws: IToken
    let assign: IToken
    let postAssign: IToken
    let isDeclaration = false

    $.OPTION(() => {
      /** 
       * In a mixin definition, this is the variable declaration.
       * In a mixin call, this is either assignment to a variable, OR
       * could be part of the expression value.
       */
      varName = $.CONSUME($.T.AtKeyword)
      ws = $._(1)

      $.OPTION2(() => {
        isDeclaration = true
        assign = $.CONSUME($.T.Assign)
        postAssign = $._(2)
      })
    })

    let value: CstChild = $.OR2([
      {
        GATE: () => !isDeclaration && !ws,
        ALT: () => ({
          name: 'rest',
          children: [
            varName,
            $.CONSUME2($.T.Ellipsis)
          ]
        })
      },
      {
        GATE: () => !varName || isDeclaration,
        ALT: () => ({
          name: 'expression',
          children: [$.SUBRULE($.curlyBlock)]
        })
      },
      {
        ALT: () => {
          const expr: CstNode = $.SUBRULE($.expression)
          if (!isDeclaration) {
            if (varName) {
              if (ws) {
                expr.children.unshift(ws)
              }
              expr.children.unshift(varName)
            }
            if (pre) {
              expr.children.unshift(pre)
              pre = undefined
            }
          }
          return expr
        }
      }
    ])

    const post = $._(3)
    let chunk = value

    if (isDeclaration) {
      chunk = <Declaration>{
        name: 'declaration',
        children: [
          varName,
          ws,
          assign,
          postAssign,
          value,
          undefined,
          undefined
        ]
      }
    } else {
      chunk = value
    }

    return {
      name: 'mixinArg',
      children: [
        pre,
        chunk,
        post
      ]
    }
  })

  $.anonMixin = $.RULE('anonMixin',
    () => ({
      name: 'anonMixin',
      children: [
        $.CONSUME($.T.AnonMixinStart),
        $.SUBRULE($.mixinArgs),
        $.CONSUME($.T.RParen),
        $._(),
        $.SUBRULE($.curlyBlock)
      ]
    })
  )

  /**
   * @note - Guards do not require parens during parsing,
   *         in order to handle recursive nesting.
   *         They should be evaluated during post-processing
   *         (CST visitor?)
   */
  $.guard = $.RULE('guard',
    () => ({
      name: 'guard',
      children: [
        $.CONSUME($.T.When),
        $._(),
        $.SUBRULE($.guardOr)
      ]
    })
  )

  /** 'or' expression */
  $.guardOr = $.RULE('guardOr', (disallowComma: boolean) => {
    let expr = $.SUBRULE($.guardAnd)
    $.MANY({
      GATE: () => $.LA(1).tokenType !== $.T.Comma || !disallowComma,
      DEF: () => {
        /**
         * Nest expressions within expressions for correct
         * order of operations.
         */
        expr = {
          name: 'or',
          children: [
            expr,
            {
              name: 'combinator',
              children: [
                $.OR([
                  { ALT: () => $.CONSUME($.T.Comma) },
                  { ALT: () => $.CONSUME($.T.Or) }
                ]),
                $._()
              ]
            },
            $.SUBRULE2($.guardAnd)
          ]
        }
      }
    })

    return expr
  })

  /** 
   * 'and' and 'or' expressions
   * 
   *  In Media queries level 4, you cannot have
   *  `([expr]) or ([expr]) and ([expr])` because
   *  of evaluation order ambiguity.
   *  However, Less allows it.
   */
  $.guardAnd = $.RULE('guardAnd', () => {
    let expr = $.SUBRULE($.guardExpression)
    $.MANY(() => {
      expr = {
        name: 'and',
        children: [
          expr,
          {
            name: 'combinator',
            children: [
              $.CONSUME($.T.And),
              $._(1)
            ]
          },
          $.SUBRULE2($.guardExpression)
        ]
      }
    })
    return expr
  })

  $.guardExpression = $.RULE('guardExpression', () => {
    let expr = $.OPTION(() => [
      $.CONSUME($.T.Not),
      $._()
    ])

    const guard = {
      name: 'guardExpression',
      children: [
        $.SUBRULE($.compare),
        $._(1)
      ]
    }
    if (expr) {
      return {
        name: 'not',
        children: [
          {
            name: 'combinator',
            children: expr
          },
          guard
        ]
      }
    }
    return guard
  })
}