import { CstChild } from '@jesscss/css-parser'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {
  $.jsExpression = $.RULE('jsExpression', () => {
    $.CONSUME($.T.JsStart)
    $.SUBRULE($.jsValue)
    $.MANY(() => {
      $.OPTION(() => {
        $.CONSUME($.T.Dot)
      })
      $.SUBRULE2($.jsValue)
    })
  })

  $.jsValue = $.RULE('jsValue', () => {
    $.OR([
      { ALT: () => {
          $.CONSUME($.T.JsIdent)
      }},
      { ALT: () => {
        $.CONSUME($.T.StringLiteral)
      }},
      /** I guess this can happen? */
      { ALT: () => {
          $.CONSUME($.T.UriString)
      }},
      // Look for matching blocks
      {
        ALT: () => {
          $.OR2([
            { ALT: () => $.CONSUME($.T.JsFunction) },
            { ALT: () => $.CONSUME($.T.LParen) }
          ])
          $.MANY(() => $.SUBRULE($.jsTokens))
          $.CONSUME($.T.RParen)
        }
      },
      {
        ALT: () => {
          $.CONSUME($.T.LSquare)
          $.MANY2(() => $.SUBRULE2($.jsTokens))
          $.CONSUME($.T.RSquare)
        }
      },
      {
        ALT: () => {
          $.CONSUME($.T.LCurly)
          $.MANY3(() => $.SUBRULE3($.jsTokens))
          $.CONSUME($.T.RCurly)
        }
      }
    ])
  })

  /**
   * For now, we'll just tokenize as CSS tokens, instead of specially
   * parsing JS. This will not check that the JS is valid! Something
   * else should do that?
   */
  $.jsTokens = $.RULE('jsTokens', () => {
    $.OR([
      { ALT: () => $.SUBRULE($.jsValue) },
      { ALT: () => $.CONSUME($.T.WS) },
      { ALT: () => $.CONSUME($.T.Colon) },
      { ALT: () => $.CONSUME($.T.Comma) },
      { ALT: () => $.CONSUME($.T.SemiColon) },
      /** =, >, <, <=, => */
      { ALT: () => $.CONSUME($.T.CompareOperator) },
      { ALT: () => $.CONSUME($.T.AdditionOperator) },
      { ALT: () => $.CONSUME($.T.MultiplicationOperator) },
      { ALT: () => $.CONSUME($.T.Ellipsis) },
      /** Try not to put these in your identifiers, it's confusing */
      { ALT: () => $.CONSUME($.T.JsStart) },
    ])
  })
}