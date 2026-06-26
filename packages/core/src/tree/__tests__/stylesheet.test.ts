import {
  any,
  decl,
  Rules,
  rules,
  ruleset,
  stylesheet
} from '../index.js';
import { Context } from '../../context.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

describe('Stylesheet', () => {
  it('is a slim Rules root with a distinct type', () => {
    const declaration = decl({ name: 'color', value: any('red') });
    const root = stylesheet([declaration]);

    expect(root).toBeInstanceOf(Rules);
    expect(root.type).toBe('Stylesheet');
    // Slim Rules root: children live in `rules`; there is no `value` payload.
    expect(root.rules[0]).toBe(declaration);
    expect(Reflect.get(root, 'value')).toBeUndefined();
    expect(isNode(root, N.Rules)).toBe(true);
    expect(root.sourceRoot).toBe(root);
    expect(declaration.rulesParent).toBe(root);
    expect(declaration.sourceRoot).toBe(root);
    expect(declaration.depth).toBe(1);
    expect(root.toTrimmedString()).toBe('color: red;');
  });

  it('serializes cheap string-backed stylesheet nodes', () => {
    const root = stylesheet([
      ruleset({
        selector: '.a',
        rules: [
          decl({ name: 'color', value: 'red' }),
          decl({ name: 'background', value: 'blue', important: '!important' }),
          decl({ name: '--gap', value: '  1px 2px' })
        ]
      })
    ]);

    expect(root.toTrimmedString()).toBe('.a {\n  color: red;\n  background: blue !important;\n  --gap:  1px 2px;\n}\n');
  });

  it('requires hydration before evaluating string-backed fields', () => {
    const stringDeclaration = decl({ name: 'color', value: 'red' });
    const stringRuleset = ruleset({
      selector: '.a',
      rules: [stringDeclaration]
    });
    const context = new Context();

    // Declaration values can be arbitrary expressions and must be hydrated to
    // nodes before evaluation.
    expect(() => stringDeclaration.evalNode(context)).toThrow('String-backed declaration values must be hydrated');
    // String-backed ruleset selectors, by contrast, materialize lazily on
    // demand (createRawSelectorNode), so evaluation does not require them to be
    // pre-hydrated and does not throw.
    expect(() => stringRuleset.eval(context)).not.toThrow();
  });
});
