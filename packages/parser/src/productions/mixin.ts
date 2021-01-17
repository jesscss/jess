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
    const prelude = []
    /** @todo - identify these pieces better */
    $.OPTION(() => prelude.push($.CONSUME($.T.WS)))
    $.OR([
      { ALT: () => {
        /** JS ident */
        prelude.push($.CONSUME($.T.PlainIdent))
        $.OPTION2(() => prelude.push($.CONSUME2($.T.WS)))
        $.OPTION3(() => {
          prelude.push($.CONSUME($.T.LParen))
          prelude.push($.SUBRULE($.mixinArgs))
          prelude.push($.CONSUME($.T.RParen))
        })
      }},
      { ALT: () => {
        prelude.push($.CONSUME($.T.Function))
        prelude.push($.SUBRULE2($.mixinArgs))
        prelude.push($.CONSUME2($.T.RParen))
      }}
    ])

    $.OPTION4(() => prelude.push($.CONSUME3($.T.WS)))

    return prelude
  })

  $.mixinArgs = $.RULE('mixinArgs', () => {
    $._()
    $.OPTION(() => {
      $.SUBRULE($.mixinArg)
      $.MANY(() => {
        $.CONSUME($.T.Comma)
        $._(1)
        $.SUBRULE2($.mixinArg)
      })
    })
  })

  $.mixinArg = $.RULE('mixinArg', () => {
    /** JS ident */
    $.CONSUME($.T.PlainIdent)
    $._()
    $.OPTION(() => {
      $.CONSUME($.T.Colon)
      $._(1)
      $.SUBRULE($.expression)
    })
  })

  $.atInclude = $.RULE('atInclude', () => {
    $.CONSUME($.T.AtInclude)
    $._()
    /** JS function */
    $.CONSUME($.T.Function)
    $.SUBRULE($.expressionList)
    $.CONSUME($.T.RParen)
    $.OPTION(() => $.CONSUME($.T.SemiColon))
  })
}