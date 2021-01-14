import { IToken } from 'chevrotain'
import type { CssParser, CstChild, CstNode } from '../cssParser'

export default function (this: CssParser, $: CssParser) {
  $.atRule = $.RULE('atRule',
    () => $.OR([
      { ALT: () => $.SUBRULE($.knownAtRule) },
      { ALT: () => $.SUBRULE($.unknownAtRule) }
    ])
  )

  $.knownAtRule = $.RULE('knownAtRule',
    () => $.OR([
      { ALT: () => $.SUBRULE($.atImport) },
      { ALT: () => $.SUBRULE($.atMedia) },
      { ALT: () => $.SUBRULE($.atSupports) },
      { ALT: () => $.SUBRULE($.atNested) },
      { ALT: () => $.SUBRULE($.atNonNested) }
    ])
  )

  $.atNested = $.RULE('atNested',
    () => ({
      name: 'atRule',
      children: [
        $.CONSUME($.T.AtNested),
        $.SUBRULE($.customPrelude),
        $.SUBRULE($.curlyBlock)
      ]
    })
  )

  $.atNonNested = $.RULE('atNonNested',
    () => ({
      name: 'atRule',
      children: [
        $.CONSUME($.T.AtNonNested),
        $.SUBRULE($.customPrelude),
        $.OPTION(() => $.CONSUME($.T.SemiColon))
      ]
    })
  )

  $.atImport = $.RULE('atImport',
    () => ({
      name: 'atRule',
      children: [
        $.CONSUME($.T.AtImport),
        {
          name: 'prelude',
          children: [
            $._(),
            $.OR([
              { ALT: () => $.CONSUME($.T.StringLiteral) },
              { ALT: () => $.CONSUME($.T.Uri) }
            ]),
            $._(1),
            /** @todo - add tests for media query post-import */
            $.MANY_SEP({
              SEP: $.T.Comma,
              DEF: () => $.SUBRULE($.mediaQuery)
            })
          ]
        },
        $.OPTION(() => $.CONSUME($.T.SemiColon))
      ]
    })
  )

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media
   */
  $.atMedia = $.RULE('atMedia',
    () => ({
      name: 'atRule',
      children: [
        $.CONSUME($.T.AtMedia),
        {
          name: 'prelude',
          children: [
            $._(),
            $.SUBRULE($.mediaQueryList)
          ]
        },
        $.SUBRULE($.curlyBlock)
      ]
    })
  )

  $.atSupports = $.RULE('atSupports',
    () => ({
      name: 'atRule',
      children: [
        $.CONSUME($.T.AtSupports),
        {
          name: 'prelude',
          children: [
            $._(),
            $.SUBRULE($.mediaCondition),
            $._(1)
          ]
        },
        $.SUBRULE($.curlyBlock)
      ]
    })
  )

  $.mediaQueryList = $.RULE('mediaQueryList', () => {
    const children: CstChild[] = [
      $.SUBRULE($.mediaQuery),
      $._(1)
    ]

    $.MANY(() => {
      children.push(
        $.CONSUME($.T.Comma),
        $._(2),
        $.SUBRULE2($.mediaQuery),
        $._(3)
      )
    })
    return {
      name: 'mediaQueryList',
      children
    }
  })

  $.mediaQuery = $.RULE('mediaQuery', () => {
    return {
      name: 'mediaQuery',
      children: [
        $.OPTION(() => {
          $.CONSUME($.T.Only)
          $._()
        }),
        $.SUBRULE($.mediaCondition)
      ]
    }
  })

  $.mediaCondition = $.RULE('mediaCondition',
    () => ({
      name: 'mediaCondition',
      children: [
        $.OR([
          {
            ALT: () => ({
              name: 'mediaNot',
              children: [
                $.CONSUME($.T.Not),
                $._(),
                $.SUBRULE($.mediaFeature)
              ]
            })
          },
          { ALT: () => $.SUBRULE2($.mediaAnd) }
        ])
      ]
    })
  )

  $.mediaAnd = $.RULE('mediaAnd',
    () => {
      let expr = $.SUBRULE($.mediaFeature)
      $.MANY(() => {
        expr = {
          name: 'mediaAnd',
          children: [
            expr,
            {
              name: 'combinator',
              children: [
                $.OR([
                  { ALT: () => $.CONSUME($.T.And) },
                  { ALT: () => $.CONSUME($.T.Or) }
                ]),
                $._(1)
              ]
            },
            $.SUBRULE2($.mediaFeature, { ARGS: [true] })
          ]
        }
      })
      return expr
    }
  )

  $.mediaFeature = $.RULE('mediaFeature',
    (afterAnd: boolean) => ({
      name: 'mediaFeature',
      children: [
        $.OR([
          {
            GATE: () => !afterAnd,
            ALT: () => $.CONSUME($.T.PlainIdent)
          },
          {
            ALT: () => {
              return {
                name: 'block',
                children: [
                  $.CONSUME($.T.LParen),
                  /**
                   * This generically parses expressions that are nested.
                   * Would normally be either a nested media condition
                   * (`not (screen)`) OR an expression like:
                   *  `(min-width: 640px)` or `(640px < width < 968px)`
                   */
                  $.SUBRULE($.expression),
                  $.CONSUME($.T.RParen)
                ]
              }
            }
          }
        ]),
        $._()
      ]
    })
  )

  /**
   * Everything up to an (outer) ';' or '{' is the AtRule's prelude
   */
  $.unknownAtRule = $.RULE('unknownAtRule',
    () => ({
      name: 'atRule',
      children: [
        $.CONSUME($.T.AtKeyword),
        $.SUBRULE($.customPrelude),
        $.OR2([
          { ALT: () => $.SUBRULE($.curlyBlock) },
          {
            ALT: () => $.OPTION(() => $.CONSUME($.T.SemiColon))
          }
        ])
      ]
    })
  )
}