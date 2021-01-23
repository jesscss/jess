import type { LessParser } from '../lessParser'

export default function(this: LessParser, $: LessParser) {
  const resetState = () => {
    $.hasExtend = false
  }

  $.qualifiedRule = $.OVERRIDE_RULE('qualifiedRule', () => {
    const sel = $.SUBRULE($.selectorList)
    const hasExtend = $.hasExtend
    resetState()

    return {
      name: 'qualifiedRule',
      children: [
        sel,
        $.OR([
          {
            GATE: () => hasExtend,
            ALT: () => $.OR2([
              { ALT: () => $.SUBRULE($.curlyBlock) },
              { ALT: () => $.CONSUME($.T.SemiColon) }
            ])
          },
          {
            ALT: () => $.SUBRULE2($.curlyBlock)
          }
        ])
      ]
    }
  })

  $.testQualifiedRule = $.OVERRIDE_RULE('testQualifiedRule', () => {
    $.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        { ALT: () => $.CONSUME($.T.DotName) },
        { ALT: () => $.CONSUME($.T.HashName) },
        { ALT: () => $.CONSUME($.T.Colon) },
        { ALT: () => $.CONSUME($.T.Ampersand) },
        {
          ALT: () => {
            $.SUBRULE($.testQualifiedRuleExpression)
            $.OR2([
              { ALT: () => $.CONSUME($.T.LCurly) },
              { ALT: () => $.CONSUME($.T.Extend) },
              { ALT: () => {
                $.CONSUME($.T.When)
                $._()
                $.OPTION(() => {
                  $.CONSUME($.T.Not)
                  $._(1)
                })
                $.CONSUME($.T.LParen)
              }}
            ])
          }
        }
      ]
    })
  })
}