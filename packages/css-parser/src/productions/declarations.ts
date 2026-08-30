import type { CssParser, CstNode, IToken } from '../cssParser'

export interface Declaration extends CstNode {
  name: 'declaration'
  children: [
    name: IToken,
    postNameWs: IToken,
    assign: IToken,
    preValueWs: IToken,
    value: CstNode,
    important: CstNode,
    semi: IToken
  ]
}

export default function (this: CssParser, $: CssParser) {
  /**
   * e.g.
   *   color: red
   */
  $.declaration = $.RULE('declaration',
    (): Declaration => ({
      name: 'declaration',
      children: [
        $.SUBRULE($.property),
        $._(0),
        $.CONSUME($.T.Assign),
        $._(1),
        $.SUBRULE($.expressionList),
        $.OPTION(() => ({
          name: 'important',
          children: [
            $.CONSUME($.T.Important),
            $._(2)
          ]
        })),
        $.OPTION2(() => $.CONSUME($.T.SemiColon))
      ]
    })
  )

  /**
   * e.g.
   *   --color: { ;red }
   */
  $.customDeclaration = $.RULE('customDeclaration',
    (): Declaration => ({
      name: 'declaration',
      children: [
        $.SUBRULE($.customProperty),
        $._(0),
        $.CONSUME($.T.Assign),
        $._(1),
        $.SUBRULE($.customValue),
        /** !important can be part of customValue */
        undefined,
        $.OPTION(() => $.CONSUME($.T.SemiColon))
      ]
    })
  )

  /** "color" in "color: red" */
  $.property = $.RULE('property',
    () => ({
      name: 'property',
      children: $.OR([
        { ALT: () => [$.CONSUME($.T.Ident)] },
        {
          /** Legacy - remove? */
          ALT: () => [
            $.CONSUME($.T.Star),
            $.CONSUME2($.T.Ident)
          ]
        }
      ])
    })
  )

  $.customProperty = $.RULE('customProperty', () => $.CONSUME($.T.CustomProperty))
}