import { CstChild, CstNode } from '@jesscss/css-parser'
import { Declaration } from 'css-parser/src/productions/declarations'
import type { LessParser } from '../lessParser'

export default function (this: LessParser, $: LessParser) {
  $.atImport = $.OVERRIDE_RULE('atImport', () => {
    const atRuleChildren: CstChild[] = [
      $.CONSUME($.T.AtImport)
    ]

    const preludeChildren = [$._()]
    $.OPTION(() => {
      const L = $.CONSUME($.T.LParen)
      const listChildren: CstChild[] = [{
        name: 'expression',
        children: [
          $._(1),
          $.CONSUME($.T.Ident),
          $._(2)
        ]
      }]

      $.MANY(() => {
        listChildren.push(
          $.CONSUME($.T.Comma),
          {
            name: 'expression',
            children: [
              $._(3),
              $.CONSUME2($.T.Ident),
              $._(4)
            ]
          }
        )
      }),
      preludeChildren.push(
        {
          name: 'block',
          children: [
            L,
            {
              name: 'expressionList',
              children: listChildren
            },
            $.CONSUME($.T.RParen)
          ]
        },
        $._(5)
      )
    })

    preludeChildren.push(
      $.OR([
        { ALT: () => $.CONSUME($.T.StringLiteral) },
        { ALT: () => $.CONSUME($.T.Uri) }
      ]),
      $._(6)
    )
    preludeChildren.push(
      $.OPTION2(() => $.SUBRULE($.mediaQueryList))
    )
    atRuleChildren.push(
      {
        name: 'prelude',
        children: preludeChildren
      },
      $.OPTION3(() => $.CONSUME($.T.SemiColon))
    )
    return {
      name: 'atRule',
      children: atRuleChildren
    }
  })

  $.mediaFeature = $.OVERRIDE_RULE('mediaFeature',
    (afterAnd: boolean) => ({
      name: 'mediaFeature',
      children: [
        $.OR([
          {
            GATE: () => !afterAnd,
            ALT: () => $.CONSUME($.T.PlainIdent)
          },
          { ALT: () => $.SUBRULE($.variable) },
          {
            ALT: () => ({
              name: 'block',
              children: [
                $.CONSUME($.T.LParen),
                $.SUBRULE($.expression),
                $.CONSUME($.T.RParen)
              ]
            })
          }
        ]),
        $._()
      ]
    })
  )

  $.unknownAtRule = $.OVERRIDE_RULE('unknownAtRule', () => {
    const name = $.CONSUME($.T.AtKeyword)
    const ws = $._(0)
    return $.OR({
      /**
       * A prelude could have a colon too, so the last two rules are
       * ambiguous, but any unknown at-rule in the form of `@rule:`
       * is assumed to be a variable assignment
       */
      IGNORE_AMBIGUITIES: true,
      DEF: [
        {
          GATE: () => !ws,
          /** Variable call */
          ALT: () => {
            return {
              name: 'variableCall',
              children: [
                name,
                $.CONSUME($.T.LParen),
                $.CONSUME($.T.RParen)
              ]
            }
          }
        },
        {
          /** Variable assignment */
          ALT: () => {
            const children: CstChild[] = [
              name,
              ws,
              $.CONSUME($.T.Colon),
              $._(1)
            ]
            $.OR2([
              {
                ALT: () => {
                  children.push(
                    $.SUBRULE($.curlyBlock),
                    undefined
                  )
                }
              },
              {
                ALT: () => {
                  children.push(
                    $.SUBRULE($.expressionList),
                    $.OPTION(() => ({
                      name: 'important',
                      children: [
                        $.CONSUME($.T.Important),
                        $._(2)
                      ]
                    }))
                  )
                }
              }
            ])
            children.push($.OPTION2(() => $.CONSUME($.T.SemiColon)))
            return {
              name: 'declaration',
              children
            }
          }
        },
        {
          ALT: () => {
            const prelude: CstNode = $.SUBRULE($.customPrelude)
            prelude.children?.unshift(ws)

            return {
              name: 'atRule',
              children: [
                name,
                prelude,
                $.OR3([
                  { ALT: () => $.SUBRULE2($.curlyBlock) },
                  { ALT: () =>
                    $.OPTION3(() => $.CONSUME2($.T.SemiColon))
                  }
                ])
              ]
            }
          }
        }
      ]
    })
  })
}