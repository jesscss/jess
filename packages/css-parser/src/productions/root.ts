import { EMPTY_ALT, ConsumeMethodOpts } from 'chevrotain'
import type { CssParser, CstChild, CstNode } from '../cssParser'

export default function(this: CssParser, $: CssParser) {
  /** Optional whitespace */
  $._ = function(idx: number = 0, options?: ConsumeMethodOpts) {
    // +10 to avoid conflicts with other OPTION in the calling rule.
    return $.option(idx + 10, () => $.consume(idx + 10, $.T.WS, options))
  }

  /** Stylesheet */
  $.root = $.RULE('root',
    () => ({
      name: 'root',
      children: $.SUBRULE($.primary)
    })
  )

  /** List of rules */
  $.primary = $.RULE<CstChild[]>('primary', () => {
    const rules = []
    $.MANY(() => rules.push($.SUBRULE($.rule)))
    
    const ws = $._()
    if (ws) {
      rules.push(ws)
    }
    
    return rules
  })

  /** Rule with leading ws / comments */
  $.rule = $.RULE<CstNode>('rule', () => {
    const children = [$._()]
    const rule = $.OR([
      { ALT: () => $.SUBRULE($.atRule) },
      { ALT: () => $.SUBRULE($.customDeclaration) },
      {
        GATE: $.BACKTRACK($.testQualifiedRule),
        ALT: () => $.SUBRULE($.qualifiedRule)
      },
      { ALT: () => $.SUBRULE($.declaration) },

      /** Capture any isolated / redundant semi-colons */
      { ALT: () => $.CONSUME($.T.SemiColon) },
      { ALT: () => EMPTY_ALT }
    ])
    if (rule !== EMPTY_ALT) {
      children.push(rule)
    }
    
    return {
      name: 'rule',
      children
    }
  })
}