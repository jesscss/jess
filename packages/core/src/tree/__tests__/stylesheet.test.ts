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
    expect(root.rules).toBe(root.value);
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
        rules: rules([
          decl({ name: 'color', value: 'red' }),
          decl({ name: 'background', value: 'blue', important: '!important' }),
          decl({ name: '--gap', value: '  1px 2px' })
        ])
      })
    ]);

    expect(root.toTrimmedString()).toBe('.a {\n  color: red;\n  background: blue !important;\n  --gap:  1px 2px;\n}\n');
  });

  it('requires hydration before evaluating string-backed fields', () => {
    const stringDeclaration = decl({ name: 'color', value: 'red' });
    const stringRuleset = ruleset({
      selector: '.a',
      rules: rules([stringDeclaration])
    });
    const context = new Context();

    expect(() => stringDeclaration.evalNode(context)).toThrow('String-backed declaration values must be hydrated');
    expect(() => stringRuleset.eval(context)).toThrow('String-backed ruleset selectors must be hydrated');
  });
});
