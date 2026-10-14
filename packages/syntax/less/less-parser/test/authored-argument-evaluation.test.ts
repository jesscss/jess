import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { parse } from '@jesscss/less-parser';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';

/*
 * A mixin argument bound to a structural value (a space or comma list held in a
 * variable) is evaluated once: its typed value and the bytes it binds as come
 * from the same evaluation, line breaks between its items included.
 */
describe('a structural mixin argument', () => {
  it('is evaluated once, and binds as written', async () => {
    const base = buildEvaluator({ functions: makeLessRegistry() });
    let operations = 0;
    const evaluator = {
      ...base,
      operate: (...args: Parameters<typeof base.operate>) => {
        operations++;
        return base.operate(...args);
      }
    };
    const source = '@l: 1px (2px + 3px);\n@k: 1px,\n  (2px + 3px);\n.m(@a) { b: @a; }\n.x { .m(@l); }\n.y { .m(@k); }\n';
    const { css } = await serialize(parse(source), { evaluator });

    expect(css).toBe('.x {\n  b: 1px 5px;\n}\n.y {\n  b: 1px,\n    5px;\n}\n');
    expect(operations).toBe(2);
  });
});
