import { any, atrulestatement, quoted, rules } from '../src/tree/index.js';
import { serializeTypes } from '../src/tree/util/serialize-types.js';

describe('AtRuleStatement', () => {
  test('serializes statement-form at-rules without block machinery', () => {
    const statement = atrulestatement({
      name: '@import',
      prelude: '"theme.css" screen'
    });

    expect(statement.type).toBe('AtRuleStatement');
    expect(statement.toTrimmedString()).toBe('@import "theme.css" screen;');
    expect(serializeTypes(statement)).toBeString(`
      (AtRuleStatement
        name: '@import'
        prelude: '"theme.css" screen'
      )
    `);
  });

  test('renders as a root rules child', () => {
    const root = rules([
      atrulestatement({
        name: '@charset',
        prelude: '"utf-8"'
      })
    ]);

    expect(root.toTrimmedString()).toBe('@charset "utf-8";');
  });

  test('serializes node fields as syntax, not valueOf text', () => {
    const statement = atrulestatement({
      name: '@import',
      prelude: quoted('x.css')
    });

    expect(statement.toTrimmedString()).toBe('@import "x.css";');
  });
});
