
import { JessParser } from '../jessParser'
import { EMPTY_ALT } from 'chevrotain'
import { CstChild, IToken, CstNode } from '@jesscss/css-parser'

export default function (this: JessParser, $: JessParser) {
  $.atLet = $.RULE('atLet', () => {
    $.CONSUME($.T.AtLet)
    $._()
    $.SUBRULE($.atLetValue)
  })

  $.atLetValue = $.RULE('atLetValue', () => {
    /** JS ident */
    $.CONSUME($.T.PlainIdent)
    $._(1)
    $.OR([
      {
        ALT: () => {
          $.CONSUME($.T.Colon)
          $._(2)
          $.SUBRULE($.expressionList)
          $.OPTION(() => $.CONSUME($.T.SemiColon))
        }
      },
      { ALT: () => $.SUBRULE($.jsCollection) }
    ])
  })

  $.jsCollection = $.RULE('jsCollection', () => {
    $.CONSUME($.T.LCurly)
    $._()
    $.MANY(() => {
      $.SUBRULE($.atLetValue)
      $._(1)
    })
    $.CONSUME($.T.RCurly)
  })
}