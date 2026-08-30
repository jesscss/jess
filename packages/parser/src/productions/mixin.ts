import { CstChild, CstNode } from '@jesscss/css-parser'
import type { JessParser } from '../jessParser'

export default function (this: JessParser, $: JessParser) {
  $.mixin = $.RULE('mixin',
    () => ({
      name: 'atRule',
      children: [
        $.CONSUME($.T.AtMixin),
        {
          name: 'prelude',
          children: $.SUBRULE($.mixinPrelude)
        },
        $.SUBRULE($.curlyBlock)
      ]
    })
  )

  $.mixinPrelude = $.RULE('mixinPrelude', () => {
    const prelude = [$._()]
    /** @todo - identify these pieces better */
    $.OR([
      { ALT: () => {
        /** JS ident */
        prelude.push(
          $.CONSUME($.T.PlainIdent),
          $._(1)
        )
        $.OPTION3(() => {
          prelude.push(
            $.CONSUME($.T.LParen),
            $.SUBRULE($.mixinArgs),
            $.CONSUME($.T.RParen)
          )
        })
      }},
      { ALT: () => {
        prelude.push(
          $.CONSUME($.T.Function),
          undefined,
          undefined,
          $.SUBRULE2($.mixinArgs),
          $.CONSUME2($.T.RParen)
        )
      }}
    ])

    $.OPTION4(() => prelude.push($.CONSUME3($.T.WS)))

    return prelude
  })

  $.mixinArgs = $.RULE('mixinArgs', () => {
    const children: CstChild[] = [
      $._()
    ]
    $.OPTION(() => {
      children.push($.SUBRULE($.mixinArg))
      $.MANY(() => {
        children.push(
          {
            name: 'delimiter',
            children: [
              $.CONSUME($.T.Comma),
              $._(1)
            ]
          },
          $.SUBRULE2($.mixinArg)
        )
      })
    })
    return {
      name: 'mixinArgs',
      children
    }
  })

  $.mixinArg = $.RULE('mixinArg', () => {
    const children: CstChild[] = [
      /** JS ident */
      $.CONSUME($.T.PlainIdent),
      $._()
    ]

    $.OPTION(() => {
      children.push(
        $.CONSUME($.T.Colon),
        $._(1),
        $.SUBRULE($.expression)
      )
    })
    return {
      name: 'mixinArg',
      children
    }
  })

  $.atInclude = $.RULE('atInclude',
    () => ({
      name: 'atInclude',
      children: [
        $.CONSUME($.T.AtInclude),
        $._(),
        /** JS function */
        $.OR([
          {
            ALT: () => ({
              name: 'function',
              children: [
                $.CONSUME($.T.Function),
                $.SUBRULE($.expressionList),
                $.CONSUME($.T.RParen)
              ]
            })
          },
          {
            ALT: () => $.SUBRULE($.jsExpression)
          }
        ]),

        $.OPTION(() => $.CONSUME($.T.SemiColon))
      ]
    })
  )
}