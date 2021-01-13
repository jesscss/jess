import { CstChild, CstNode } from '@jesscss/css-parser'
import type { JessParser } from '../jessParser'

export default function (this: JessParser, $: JessParser) {
  $.knownAtRule = $.OVERRIDE_RULE('knownAtRule',
    () => $.OR([
      { ALT: () => $.SUBRULE($.mixin) },
      { ALT: () => $.SUBRULE($.rulesMixin) },
      
      /** In the mixin section */
      { ALT: () => $.SUBRULE($.atInclude) },

      { ALT: () => $.SUBRULE($.atLet) },
      { ALT: () => $.SUBRULE($.atImport) },
      { ALT: () => $.SUBRULE($.atMedia) },
      { ALT: () => $.SUBRULE($.atSupports) },
      { ALT: () => $.SUBRULE($.atNested) },
      { ALT: () => $.SUBRULE($.atNonNested) }
    ])
  )

  $.atImport = $.OVERRIDE_RULE('atImport', () => {
    const atRule: CstChild[] = [
      $.CONSUME($.T.AtImport)
    ]
    const prelude = []
    $.OPTION(() => prelude.push($.CONSUME($.T.WS)))

    $.OR([
      { ALT: () => {
        prelude.push(
          $.SUBRULE($.atImportCss)
        )
        $.OPTION2(() => prelude.push($.CONSUME2($.T.WS)))
        $.OPTION3(() => $.SUBRULE($.mediaQueryList))
      }},
      { ALT: () => {
        prelude.push(
          $.SUBRULE($.atImportJs)
        )
      }}
    ])

    $.OPTION4(() => prelude.push($.CONSUME3($.T.WS)))

    atRule.push(
      {
        name: 'prelude',
        children: prelude
      },
      $.OPTION5(() => $.CONSUME($.T.SemiColon))
    )
    return {
      name: 'atRule',
      children: atRule
    }
  })

  $.atImportCss = $.RULE('atImportCss',
    () => $.OR([
      { ALT: () => $.CONSUME($.T.StringLiteral) },
      { ALT: () => $.CONSUME($.T.Uri) }
    ])
  )

  $.atImportJs = $.RULE('atImportJs',
    () => {
      $.OR([
        { 
          ALT: () => {
            $.CONSUME($.T.Star)
            $._()
            $.CONSUME($.T.As)
            $._(1)
            $.CONSUME($.T.JsIdent)
          }
        },
        {
          ALT: () => {
            $.CONSUME2($.T.JsIdent)
            $._(2)
            $.OPTION(() => {
              $.CONSUME($.T.Comma)
              $._(3)
              $.SUBRULE($.atImportJsBlock)
            })
          }
        },
        {
          ALT: () => {
            $.SUBRULE2($.atImportJsBlock)
          }
        }
      ])
      $._(4)
      $.CONSUME($.T.From)
      $._(5)
      $.CONSUME($.T.StringLiteral)
    }
  )

  $.atImportJsBlock = $.RULE('atImportJsBlock', () => {
    $.CONSUME($.T.LCurly)
    $._()
    $.SUBRULE($.atImportJsArg)
    $.MANY(() => {
      $.CONSUME($.T.Comma)
      $._(1)
      $.SUBRULE2($.atImportJsArg)
    })
    $.CONSUME($.T.RCurly)
  })

  $.atImportJsArg = $.RULE('atImportJsArg', () => {
    $.CONSUME($.T.JsIdent)
    $._()
    $.OPTION(() => {
      $.CONSUME($.T.As)
      $._(1)
      $.CONSUME2($.T.JsIdent)
      $._(2)
    })
  })
}