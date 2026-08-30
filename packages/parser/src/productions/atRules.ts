import { CstChild, CstNode } from '@jesscss/css-parser'
import type { JessParser } from '../jessParser'

export default function (this: JessParser, $: JessParser) {
  $.knownAtRule = $.OVERRIDE_RULE('knownAtRule',
    () => $.OR([
      { ALT: () => $.SUBRULE($.mixin) },
      
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
        $.OPTION3(() => prelude.push($.SUBRULE($.mediaQueryList)))
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

  /**
   * @todo - for now, just capture the stream of tokens
   * In the future, this should be more structured to do
   * some static analysis at the AST phase.
   */
  $.atImportJs = $.RULE('atImportJs',
    () => {
      const children: CstChild[] = []
      $.OR([
        { 
          ALT: () => {
            children.push(
              $.CONSUME($.T.Star),
              $._(),
              $.CONSUME($.T.As),
              $._(1),
              /** JS ident */
              $.CONSUME($.T.Ident)
            )
          }
        },
        {
          ALT: () => {
            /** JS ident */
            children.push(
              $.CONSUME2($.T.Ident),
              $._(2)
            )
            $.OPTION(() => {
              children.push(
                $.CONSUME($.T.Comma),
                $._(3),
                $.SUBRULE($.atImportJsBlock)
              )
            })
          }
        },
        {
          ALT: () => {
            children.push($.SUBRULE2($.atImportJsBlock))
          }
        }
      ])
      children.push(
        $._(4),
        $.CONSUME($.T.From),
        $._(5),
        $.CONSUME($.T.StringLiteral)
      )
      return {
        name: 'atImportJs',
        children
      }
    }
  )

  $.atImportJsBlock = $.RULE('atImportJsBlock', () => {
    const children: CstChild[] = [
      $.CONSUME($.T.LCurly),
      $._(),
      $.SUBRULE($.atImportJsArg)
    ]
    
    $.MANY(() => {
      children.push(
        {
          name: 'delimiter',
          children: [
            $.CONSUME($.T.Comma),
            $._(1)
          ]
        },
        $.SUBRULE2($.atImportJsArg)
      )
    })
    children.push($.CONSUME($.T.RCurly))
    
    return {
      name: 'atImportJsBlock',
      children
    }
  })

  $.atImportJsArg = $.RULE('atImportJsArg', () => {
    /** JS ident */
    const children: CstChild[] = [
      $.CONSUME($.T.PlainIdent),
      $._()
    ]
    $.OPTION(() => {
      children.push(
        $.CONSUME($.T.As),
        $._(1),
        /** JS ident */
        $.CONSUME2($.T.PlainIdent),
        $._(2)
      )
    })
    return {
      name: 'atImportJsArg',
      children
    }
  })
}