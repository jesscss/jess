import { describe, expect, it } from 'vitest';
import { opaqueAtRuleBlock } from '../at-rule.js';
import { comment, rule, stylesheet } from '../nodes.js';
import { serialize } from '../serialize.js';
import type { ValueEvaluator } from '../value-eval.js';

describe('OpaqueAtRuleBlock', () => {
  it('writes its header, prelude, and raw body verbatim', () => {
    const document = stylesheet([
      opaqueAtRuleBlock('@unknown', 'screen and (color)', '\n  $unparsed: @{still-raw};\n'),
      comment('/* following statement stays after the opaque block */'),
    ]);

    expect(serialize(document)).toEqual({
      css: '@unknown screen and (color) {\n  $unparsed: @{still-raw};\n}\n/* following statement stays after the opaque block */\n',
    });
  });

  it('does not evaluate or recursively walk rawBody', () => {
    let evaluatorCalls = 0;
    const rejectCall = (): never => {
      evaluatorCalls++;
      throw 'opaque rawBody reached evaluator';
    };
    const evaluator = Object.assign(Object.create(null), {
      materialize: rejectCall,
      operate: rejectCall,
      call: rejectCall,
      compare: rejectCall,
      typeCheck: rejectCall,
    }) as ValueEvaluator;
    const document = stylesheet([
      opaqueAtRuleBlock('@vendor-rule', null, '@nested { value: fn(@not-a-variable); }'),
    ]);

    expect(serialize(document, { evaluator })).toEqual({
      css: '@vendor-rule {@nested { value: fn(@not-a-variable); }}\n',
    });
    expect(evaluatorCalls).toBe(0);
  });

  it.each([
    [true, '.host {\n  /* before */\n}\n@vendor nested {raw { bytes }}\n.host {\n  /* after */\n}\n'],
    [false, '.host {\n  /* before */\n  @vendor nested {raw { bytes }}\n  /* after */\n}\n'],
  ])('keeps a nested opaque block terminal and in source order (collapseNesting: %s)', (collapseNesting, css) => {
    const document = stylesheet([
      rule('.host', [
        comment('/* before */'),
        opaqueAtRuleBlock('@vendor', 'nested', 'raw { bytes }'),
        comment('/* after */'),
      ]),
    ]);

    expect(serialize(document, { collapseNesting })).toEqual({ css });
  });
});
