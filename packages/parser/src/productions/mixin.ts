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
        $.SUBRULE($.rulePrimary)
      ]
    })
  )

  $.mixinPrelude = $.RULE('mixinPrelude', () => {
    const prelude = []
    /** @todo - identify these pieces better */
    $.OPTION(() => prelude.push($.CONSUME($.T.WS)))
    $.OR([
      { ALT: () => {
        prelude.push($.CONSUME($.T.JsIdent))
        $.OPTION2(() => prelude.push($.CONSUME2($.T.WS)))
        $.OPTION3(() => {
          prelude.push($.CONSUME($.T.LParen))
          prelude.push($.SUBRULE($.mixinArgs))
          prelude.push($.CONSUME($.T.RParen))
        })
      }},
      { ALT: () => {
        prelude.push($.CONSUME($.T.JsFunction))
        prelude.push($.SUBRULE2($.mixinArgs))
        prelude.push($.CONSUME2($.T.RParen))
      }}
    ])

    $.OPTION4(() => prelude.push($.CONSUME3($.T.WS)))

    return prelude
  })

  /**
   * Pretty identical to mixin, except for rule parsing
   */
  $.rulesMixin = $.RULE('rulesMixin',
    () => ({
      name: 'atRule',
      children: [
        $.CONSUME($.T.AtRules),
        {
          name: 'prelude',
          children: $.SUBRULE($.mixinPrelude)
        },
        $.SUBRULE($.curlyBlock)
      ]
    })
  )

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
    $.CONSUME($.T.JsIdent)
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
    $.CONSUME($.T.JsFunction)
    $.SUBRULE($.expressionList)
    $.CONSUME($.T.RParen)
    $.OPTION(() => $.CONSUME($.T.SemiColon))
  })
}