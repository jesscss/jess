import type { CssParser, CstChild } from '../cssParser'

export default function(this: CssParser, $: CssParser) {
  /**
   * A custom property's (or unknown at-rule's) outer value
   */
  $.customValue = $.RULE('customValue', () => {
    const children: CstChild[] = []
    $.MANY(
      () => children.push($.OR([
        { ALT: () => $.SUBRULE($.anyToken) },
        { ALT: () => $.SUBRULE($.extraTokens) },
        { ALT: () => $.SUBRULE($.customBlock) }
      ]))
    )
    return {
      name: 'customValue',
      children
    }
  })

  $.customPrelude = $.RULE('customPrelude', () => {
    const children: CstChild[] = []
    $.MANY(
      () => children.push($.OR([
        { ALT: () => $.SUBRULE($.anyToken) },
        { ALT: () => $.SUBRULE($.extraTokens) },
        { ALT: () => $.SUBRULE($.customPreludeBlock) }
      ]))
    )
    return {
      name: 'customPrelude',
      children
    }
  })

  /** 
   * A custom value within a block 
   */
  $.customValueOrSemi = $.RULE('customValueOrSemi', () => {
    const children: CstChild[] = []
    $.MANY(
      () => children.push($.OR([
        { ALT: () => $.CONSUME($.T.SemiColon) },
        { ALT: () => $.SUBRULE($.anyToken) },
        { ALT: () => $.SUBRULE($.extraTokens) },
        { ALT: () => $.SUBRULE($.customBlock) }
      ]))
    )
    return {
      name: 'customValue',
      children
    }
  })

  /**
   * Expressions separated by commas
   * e.g. `one, two, three`
   */
  $.expressionList = $.RULE('expressionList', () => {
    const children = [$.SUBRULE($.expression)]
    $.MANY(() => {
      children.push(
        $.CONSUME($.T.Comma),
        $.SUBRULE2($.expression)
      )
    })
    if (children.length === 1) {
      return children[0]
    }
    return {
      name: 'expressionList',
      children
    }
  })

  /**
   *  An expression contains values and spaces
   */
  $.expression = $.RULE('expression', () => {
    const children: CstChild[] = []
    $.MANY(() => children.push($.SUBRULE($.value)))
    if (children.length === 1) {
      return children[0]
    }
    return {
      name: 'expression',
      children
    }
  })

  /**
   * According to a reading of the spec, whitespace is a valid
   * value in a CSS list, e.g. in the custom properties spec,
   * `--custom: ;` has a value of ' '
   *
   * However, a property's grammar may discard whitespace between values.
   * e.g. for `color: black`, the value in the browser will resolve to `black`
   * and not ` black`. The CSS spec is rather hand-wavy about whitespace,
   * sometimes mentioning it specifically, sometimes not representing it
   * in grammar even though it's expected to be present.
   *
   * Strictly speaking, though, a property's value begins _immediately_
   * following a ':' and ends at ';' (or until automatically closed by
   * '}', ']', ')' or the end of a file).
   */
  $.value = $.RULE('value',
    () => $.OR([
      { ALT: () => $.SUBRULE($.block) },
      { ALT: () => $.SUBRULE($.anyToken) }
    ])
  )

  $.anyToken = $.RULE('anyToken', () =>
    $.OR([
      { ALT: () => $.CONSUME($.T.Value) },
      { ALT: () => $.CONSUME($.T.Important) },
      /** Can be in a var() function */
      { ALT: () => $.CONSUME($.T.CustomProperty) },
      { ALT: () => $.CONSUME($.T.Colon) },
      { ALT: () => $.CONSUME($.T.WS) }
    ])
  )

  /**
   * Extra tokens in a custom property. Should include any
   * and every token possible, including unknown tokens.
   */
  $.extraTokens = $.RULE('extraTokens', () =>
    $.OR([
      { ALT: () => $.CONSUME($.T.AtName) },
      { ALT: () => $.CONSUME($.T.Comma) }
    ])
  )
}