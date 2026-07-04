import { parseCssFn } from '../src/functional-parser.js';
import { serializeTypes } from '@jesscss/core';

describe('functional CSS grammar — core', () => {
  test('single rule with declaration', () => {
    const { tree, errors } = parseCssFn('a { b: c; }');
    expect(errors).toEqual([]);
    expect(serializeTypes(tree)).toBeString(`
      (Rules
        rules:
          [
            (Ruleset
              selector: 'a'
              rules:
                [
                  (Declaration
                    name: 'b'
                    value:
                      (Keyword [role=keyword] 'c')
                  )
                ]
            )
          ]
      )
    `);
  });

  test('numbers and dimensions', () => {
    const { tree, errors } = parseCssFn('a{ w: 10px; z: 2 }');
    expect(errors).toEqual([]);
    const out = serializeTypes(tree);
    expect(out).toContainString(`
      (Declaration
        name:
          'w'
        value:
          (Dimension
            number: 10
            unit: 'px'
          )
    `);
    expect(out).toContainString(`
      (Declaration
        name:
          'z'
        value:
          (Num 2)
    `);
  });
});
