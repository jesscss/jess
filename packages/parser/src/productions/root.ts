import { EMPTY_ALT } from 'chevrotain'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {  
  $.rule = $.OVERRIDE_RULE('rule', () => {
    const children = [$._(0)]
    const rule = $.OR([
      { ALT: () => $.SUBRULE($.atRule) },
      { ALT: () => $.SUBRULE($.qualifiedRule) },
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