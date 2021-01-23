import { EMPTY_ALT } from 'chevrotain'
import type { LessParser } from '../lessParser'

export default function(this: LessParser, $: LessParser) {
  $.rule = $.OVERRIDE_RULE('rule', () => {
    const children = [$._(0)]
    const rule = $.OR([
      { ALT: () => $.SUBRULE($.atRule) },
      { ALT: () => $.SUBRULE($.customDeclaration) },
      {
        GATE: $.BACKTRACK($.testMixin),
        ALT: () => $.SUBRULE($.mixin)
      },
      {
        GATE: $.BACKTRACK($.testQualifiedRule),
        ALT: () => $.SUBRULE($.qualifiedRule)
      },
      { ALT: () => $.SUBRULE2($.declaration) },
      { ALT: () => $.SUBRULE($.function) },

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