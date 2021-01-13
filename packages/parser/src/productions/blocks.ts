import { EMPTY_ALT } from 'chevrotain'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {
  $.testQualifiedRule = $.OVERRIDE_RULE('testQualifiedRule', () => {
    $.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        { ALT: () => $.CONSUME($.T.Dot) },
        { ALT: () => $.CONSUME($.T.HashName) },
        { ALT: () => $.CONSUME($.T.Colon) },
        { ALT: () => $.CONSUME($.T.LSquare) },
        {
          ALT: () => {
            $.SUBRULE($.testQualifiedRuleExpression)
            $.CONSUME($.T.LCurly)
          }
        }
      ]
    })
  })

  $.testQualifiedRuleExpression = $.OVERRIDE_RULE('testQualifiedRuleExpression', () => {
    $.MANY(() => {
      $.OR([
        { ALT: () => $.CONSUME($.T.Value) },
        { ALT: () => $.SUBRULE($.jsExpression) },
        { ALT: () => $.CONSUME($.T.Comma) },
        { ALT: () => $.CONSUME($.T.Colon) },
        { ALT: () => $.CONSUME($.T.WS) },
        { ALT: () => {
          $.OR2([
            { ALT: () => $.CONSUME($.T.Function) },
            { ALT: () => $.CONSUME($.T.LParen) }
          ])
          $.SUBRULE($.testQualifiedRuleExpression)
          $.CONSUME($.T.RParen)
        }},
        { ALT: () => {
          $.CONSUME($.T.LSquare)
          $.SUBRULE2($.testQualifiedRuleExpression)
          $.CONSUME($.T.RSquare)
        }}
      ])
    })
  })
}